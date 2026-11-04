-- Monitor de Links: aviso por e-mail quando um link cai ou o roteador fica sem contato, e quando volta
-- (pedido do Marco em 04/11/2026; o aviso por WhatsApp já é feito pelo próprio MikroTik).
--
-- Quem recebe: mon_avisos_destinos (e-mail × local; local vazio = todos os locais). Só a equipe Nervia lê e altera.
-- Quando: queda aberta há pelo menos 5 min (quedas curtas não geram e-mail) e, depois, a volta da mesma queda.
-- Como: pg_cron "monitor-avisos" a cada 2 min; só chama a função monitor-aviso quando há aviso na fila
-- (mon_avisos_tem). A função manda pelo Microsoft 365 (_shared/email.ts), registra em email_envios
-- e marca a queda (mon_aviso_marcar). Falhou 3 vezes = desiste daquele aviso (fica em email_envios).
-- Nada muda para quem não cadastrar destinatário.

create table if not exists public.mon_avisos_destinos (
  id        bigint generated always as identity primary key,
  email     text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and email = lower(email)),
  local_id  uuid references public.mon_locais on delete cascade,   -- vazio = todos os locais
  criado_em timestamptz not null default now()
);
create unique index if not exists mon_avisos_destinos_unico on public.mon_avisos_destinos (email, coalesce(local_id, '00000000-0000-0000-0000-000000000000'));

alter table public.mon_avisos_destinos enable row level security;
revoke all on public.mon_avisos_destinos from anon;
drop policy if exists mon_avisos_destinos_admin on public.mon_avisos_destinos;
create policy mon_avisos_destinos_admin on public.mon_avisos_destinos for all using (public.eh_admin()) with check (public.eh_admin());

-- controle do aviso em cada queda (só o servidor mexe: a tela continua podendo alterar só a obs)
alter table public.mon_quedas add column if not exists aviso_inicio_em timestamptz;
alter table public.mon_quedas add column if not exists aviso_fim_em timestamptz;
alter table public.mon_quedas add column if not exists aviso_tentativas int not null default 0;
-- quedas já encerradas não geram aviso; as que estão abertas agora geram (se houver destinatário)
update public.mon_quedas set aviso_inicio_em = inicio, aviso_fim_em = fim where fim is not null and aviso_inicio_em is null;

-- fila: o que falta avisar (mesma regra para a função e para o cron)
create or replace function public._mon_avisos_fila(p_min int default 5)
returns table (queda_id bigint, evento text, tipo text, inicio timestamptz, fim timestamptz, local_id uuid, local text, cliente text,
  equipamento text, link text, operadora text, emails text[])
language sql stable security definer set search_path = public as $$
  select q.id, case when q.fim is null then 'caiu' else 'voltou' end, q.tipo, q.inicio, q.fim, lo.id, lo.nome, lo.cliente, e.nome,
    coalesce(nullif(l.nome, ''), l.chave, ''), coalesce(l.operadora, ''),
    array(select distinct d.email from public.mon_avisos_destinos d where d.local_id is null or d.local_id = lo.id order by 1)
  from public.mon_quedas q
  join public.mon_equipamentos e on e.id = q.equipamento_id
  join public.mon_locais lo on lo.id = e.local_id
  left join public.mon_links l on l.id = q.link_id
  where e.ativo and lo.ativo and (q.tipo <> 'link' or l.ativo) and q.aviso_tentativas < 3
    and ((q.fim is null and q.aviso_inicio_em is null and q.inicio <= now() - make_interval(mins => p_min))
      or (q.fim is not null and q.aviso_inicio_em is not null and q.aviso_fim_em is null))
    and exists (select 1 from public.mon_avisos_destinos d where d.local_id is null or d.local_id = lo.id)
  order by q.inicio
  limit 50
$$;
revoke execute on function public._mon_avisos_fila(int) from public, anon, authenticated;

create or replace function public.mon_avisos_tem() returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from public._mon_avisos_fila()) $$;
revoke execute on function public.mon_avisos_tem() from public, anon, authenticated;

create or replace function public.mon_avisos_pendentes(p_min int default 5) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from public._mon_avisos_fila(p_min) f
$$;
revoke execute on function public.mon_avisos_pendentes(int) from public, anon, authenticated;

-- p_ok = algum destinatário recebeu: marca o aviso; senão soma uma tentativa
create or replace function public.mon_aviso_marcar(p_ids bigint[], p_evento text, p_ok boolean) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_evento not in ('caiu', 'voltou') then raise exception 'evento inválido'; end if;
  if p_ok then
    update public.mon_quedas set aviso_tentativas = 0,
      aviso_inicio_em = case when p_evento = 'caiu' then now() else aviso_inicio_em end,
      aviso_fim_em    = case when p_evento = 'voltou' then now() else aviso_fim_em end
     where id = any(p_ids);
  else
    update public.mon_quedas set aviso_tentativas = aviso_tentativas + 1 where id = any(p_ids);
  end if;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.mon_aviso_marcar(bigint[], text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- auditoria dos destinatários
create or replace function public.auditar_mon_avisos_destinos() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  perform public.auditar(case when tg_op = 'INSERT' then 'monitor_aviso_destino_incluido' else 'monitor_aviso_destino_retirado' end, null,
    jsonb_build_object('email', r.email, 'local_id', r.local_id,
      'local', coalesce((select nome from public.mon_locais where id = r.local_id), 'todos os locais')));
  return r;
end $$;
drop trigger if exists auditoria_mon_avisos_destinos on public.mon_avisos_destinos;
create trigger auditoria_mon_avisos_destinos after insert or delete on public.mon_avisos_destinos
  for each row execute function public.auditar_mon_avisos_destinos();

-- ---------------------------------------------------------------- agenda (a cada 2 min, só chama a função se há aviso)
-- Usa os mesmos segredos do Vault do cron do Buscador (buscador_url e buscador_cron_secret, ver agendar_busca.sql).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('monitor-avisos', '1-59/2 * * * *', $c$
      select net.http_post(
        url     := (select decrypted_secret from vault.decrypted_secrets where name = 'buscador_url') || '/functions/v1/monitor-aviso',
        headers := jsonb_build_object('Content-Type', 'application/json',
                     'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'buscador_cron_secret')),
        body    := '{"origem": "cron"}'::jsonb,
        timeout_milliseconds := 10000)
      where public.mon_avisos_tem()
    $c$);
  end if;
end $$;
