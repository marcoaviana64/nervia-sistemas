-- Mídia Indoor 2.6: aviso por e-mail antes de acabarem os dias de uso de uma TV (pedido do Marco em 19/11/2026:
-- "faz o aviso por e-mail antes de acabar os dias").
-- Etapas, por TV (faltam = dias de uso que sobram, contando hoje; mesma conta da coluna "Dias de uso" do painel):
--    7 = faltam 7 dias ou menos · 3 = faltam 3 ou menos · 1 = último dia
--    0 = os dias acabaram (a TV ainda passa, na tolerância, e diz quando vai pausar)
--   -1 = a TV pausou (só nos 7 dias depois da pausa; depois para de avisar)
-- Cada etapa vai uma vez por TV e por "válida até" (pôr dias muda a data e recomeça as etapas). Se a rodada pula uma
-- etapa (ex.: pôs só 2 dias), manda só a etapa atual. TV isenta, sem dias (nunca recebeu) e conta inativa ficam de fora.
-- Destinatários: a equipe Nervia (admin) e os logins com a conta liberada (mi_acessos) E o app Mídia Indoor.
-- Envio pela função midia-aviso (Microsoft 365, _shared/email.ts): UM e-mail por destinatário e conta, com todas as TVs
-- da rodada; pg_cron "midia-avisos" todo dia às 10h45 UTC (07h45 de Brasília). Registro em email_envios (tipo midia_dias).
-- Nada muda nas tabelas que já existem.

create table if not exists public.mi_cred_avisos (
  tela_id    uuid not null references public.mi_telas on delete cascade,
  valida_ate date not null,
  etapa      int  not null check (etapa in (7, 3, 1, 0, -1)),
  enviado_em timestamptz not null default now(),
  primary key (tela_id, valida_ate, etapa)
);
alter table public.mi_cred_avisos enable row level security;
revoke all on public.mi_cred_avisos from anon, authenticated;

-- etapa de hoje para uma TV (null = nada a avisar)
create or replace function public._mi_cred_etapa(p_valida date, p_tol int, p_hoje date) returns int
language sql immutable as $$
  select case
    when p_valida is null then null
    when p_hoje > p_valida + coalesce(p_tol, 0) + 7 then null                  -- pausada há mais de uma semana
    when p_hoje > p_valida + coalesce(p_tol, 0) then -1                        -- pausada
    when p_hoje > p_valida then 0                                              -- acabou, na tolerância
    when p_valida - p_hoje + 1 <= 1 then 1
    when p_valida - p_hoje + 1 <= 3 then 3
    when p_valida - p_hoje + 1 <= 7 then 7
  end
$$;

-- quem recebe os avisos de uma conta
create or replace function public._mi_aviso_emails(p_conta uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array(select distinct lower(p.email) from public.perfis p
     where coalesce(p.email, '') <> ''
       and (p.admin or (exists (select 1 from public.mi_acessos a where a.user_id = p.user_id and a.conta_id = p_conta)
                        and exists (select 1 from public.app_acessos x where x.user_id = p.user_id and x.app_id = 'midia')))
     order by 1), '{}')
$$;
revoke execute on function public._mi_aviso_emails(uuid) from public, anon, authenticated;

-- o que avisar hoje: [{conta_id, conta, tolerancia, emails, telas:[{tela_id, tela, valida_ate, faltam, etapa, pausa_em}]}]
create or replace function public.mi_avisos_pendentes(p_hoje date default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with h as (select coalesce(p_hoje, public.mi_hoje()) as hoje),
  t as (
    select t.id, t.nome, t.conta_id, t.valida_ate, c.nome as conta, c.tolerancia_dias as tol,
           public._mi_cred_etapa(t.valida_ate, c.tolerancia_dias, h.hoje) as etapa, h.hoje
      from public.mi_telas t join public.mi_contas c on c.id = t.conta_id, h
     where not t.isenta and c.ativo and t.valida_ate is not null
  ), p as (
    select * from t
     where etapa is not null
       and not exists (select 1 from public.mi_cred_avisos a where a.tela_id = t.id and a.valida_ate = t.valida_ate and a.etapa <= t.etapa)
  )
  select coalesce(jsonb_agg(jsonb_build_object('conta_id', g.conta_id, 'conta', g.conta, 'tolerancia', g.tol,
           'emails', to_jsonb(public._mi_aviso_emails(g.conta_id)), 'telas', g.telas) order by g.conta), '[]'::jsonb)
    from (select conta_id, conta, tol,
                 jsonb_agg(jsonb_build_object('tela_id', id, 'tela', nome, 'valida_ate', valida_ate,
                   'faltam', greatest(valida_ate - hoje + 1, 0), 'etapa', etapa, 'pausa_em', valida_ate + tol + 1)
                   order by etapa, nome) as telas
            from p group by conta_id, conta, tol) g
$$;
revoke execute on function public.mi_avisos_pendentes(date) from public, anon, authenticated;

create or replace function public.mi_cred_aviso_marcar(p_tela uuid, p_valida date, p_etapa int) returns void
language sql security definer set search_path = public as $$
  insert into public.mi_cred_avisos (tela_id, valida_ate, etapa) values (p_tela, p_valida, p_etapa) on conflict do nothing
$$;
revoke execute on function public.mi_cred_aviso_marcar(uuid, date, int) from public, anon, authenticated;
grant execute on function public.mi_avisos_pendentes(date), public.mi_cred_aviso_marcar(uuid, date, int) to service_role;

-- quem recebe (para a tela do painel: só a equipe Nervia ou quem vê a conta)
create or replace function public.mi_avisos_destinos(p_conta uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case when public.mi_pode_ver(p_conta) then public._mi_aviso_emails(p_conta) else '{}'::text[] end
$$;
revoke execute on function public.mi_avisos_destinos(uuid) from public, anon;

-- ---------------------------------------------------------------- agenda: todo dia às 10h45 UTC (07h45 de Brasília)
-- Mesmos segredos do Vault do cron do Buscador (buscador_url e buscador_cron_secret, ver agendar_busca.sql).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('midia-avisos', '45 10 * * *', $c$
      select net.http_post(
        url     := (select decrypted_secret from vault.decrypted_secrets where name = 'buscador_url') || '/functions/v1/midia-aviso',
        headers := jsonb_build_object('Content-Type', 'application/json',
                     'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'buscador_cron_secret')),
        body    := '{"origem": "cron"}'::jsonb,
        timeout_milliseconds := 30000)
      where exists (select 1 from public.mi_telas where not isenta and valida_ate is not null)
    $c$);
  end if;
end $$;
