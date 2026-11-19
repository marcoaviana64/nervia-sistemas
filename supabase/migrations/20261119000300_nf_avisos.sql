-- Buscador de NF 1.9: avisos por e-mail (pedido do Marco em 19/11/2026).
--   * Resumo diário das notas novas: um e-mail por dia, só nos dias com nota nova, com as notas
--     (recebidas e emitidas) das empresas que o login vê. Quem quer receber marca (padrão: desligado).
--   * Certificado A1 vencendo: aviso com 30, 15, 7 e 1 dia(s) antes e no dia em que vence, para a equipe
--     Nervia e para quem vê a empresa (padrão: ligado; cada um pode desligar).
-- Envio pela função nf-aviso (Microsoft 365, _shared/email.ts), chamada uma vez por dia pelo pg_cron "nf-avisos"
-- (07h40 de Brasília). Registro em email_envios (tipos nf_resumo / nf_certificado).
-- Nada muda nas tabelas e regras que já existem: só uma coluna nova em nf_notas (vazia nas notas antigas).

-- quando a nota entrou no Buscador (as antigas ficam vazias: não entram no primeiro resumo)
alter table public.nf_notas add column if not exists criada_em timestamptz;
alter table public.nf_notas alter column criada_em set default now();
create index if not exists nf_notas_criada on public.nf_notas (criada_em) where criada_em is not null;

-- ---------------------------------------------------------------- preferências por login
create table if not exists public.nf_avisos (
  user_id       uuid primary key references auth.users on delete cascade,
  resumo        boolean not null default false,
  certificado   boolean not null default true,
  resumo_ate    timestamptz,                     -- até quando as notas já foram avisadas (só o servidor mexe)
  atualizado_em timestamptz not null default now()
);
alter table public.nf_avisos enable row level security;
revoke all on public.nf_avisos from anon, authenticated;
grant select on public.nf_avisos to authenticated;
drop policy if exists nf_avisos_ler on public.nf_avisos;
create policy nf_avisos_ler on public.nf_avisos for select to authenticated
  using (user_id = (select auth.uid()) or (select public.eh_admin()));

-- p_user vazio = o próprio login; outro login só a equipe Nervia
create or replace function public.nf_avisos_salvar(p_user uuid, p_resumo boolean, p_certificado boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := coalesce(p_user, auth.uid());
  antes public.nf_avisos%rowtype;
  v_email text;
begin
  if auth.uid() is null then raise exception 'Entre na Área do Cliente para alterar os avisos.'; end if;
  if v_user <> auth.uid() and not public.eh_admin() then
    raise exception 'Somente a equipe Nervia altera os avisos de outro login.';
  end if;
  select email into v_email from public.perfis where user_id = v_user;
  if not found then raise exception 'Login não encontrado.'; end if;
  select * into antes from public.nf_avisos where user_id = v_user;
  insert into public.nf_avisos (user_id, resumo, certificado, resumo_ate)
  values (v_user, coalesce(p_resumo, false), coalesce(p_certificado, true), case when p_resumo then now() end)
  on conflict (user_id) do update set
    resumo = excluded.resumo, certificado = excluded.certificado, atualizado_em = now(),
    -- ligar o resumo agora: começa a contar a partir de agora (não manda as notas antigas)
    resumo_ate = case when excluded.resumo and not nf_avisos.resumo then now() else nf_avisos.resumo_ate end;
  if antes.user_id is null or antes.resumo is distinct from coalesce(p_resumo, false)
     or antes.certificado is distinct from coalesce(p_certificado, true) then
    perform public.auditar('nf_avisos_alterados', null, jsonb_build_object('login', v_email,
      'antes', case when antes.user_id is null then jsonb_build_object('resumo', false, 'certificado', true)
                    else jsonb_build_object('resumo', antes.resumo, 'certificado', antes.certificado) end,
      'depois', jsonb_build_object('resumo', coalesce(p_resumo, false), 'certificado', coalesce(p_certificado, true))));
  end if;
  return jsonb_build_object('resumo', coalesce(p_resumo, false), 'certificado', coalesce(p_certificado, true));
end $$;
revoke execute on function public.nf_avisos_salvar(uuid, boolean, boolean) from public, anon;
grant execute on function public.nf_avisos_salvar(uuid, boolean, boolean) to authenticated;

-- quem pode receber aviso de uma empresa: equipe Nervia, ou login com a empresa liberada e com o Buscador ou o Painel
create or replace function public._nf_aviso_ve(p_user uuid, p_cnpj text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select admin from public.perfis where user_id = p_user), false)
      or (exists (select 1 from public.nf_acessos a where a.user_id = p_user and a.cnpj = p_cnpj)
          and exists (select 1 from public.app_acessos x where x.user_id = p_user and x.app_id in ('notas', 'painel-nf')))
$$;
revoke execute on function public._nf_aviso_ve(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- certificados já avisados
create table if not exists public.nf_cert_avisos (
  cnpj      text not null references public.nf_empresas on delete cascade,
  validade  timestamptz not null,
  dias      int not null,                 -- 30, 15, 7, 1 ou 0 (venceu)
  enviado_em timestamptz not null default now(),
  primary key (cnpj, validade, dias)
);
alter table public.nf_cert_avisos enable row level security;
revoke all on public.nf_cert_avisos from anon, authenticated;

-- ---------------------------------------------------------------- o que avisar hoje (só o servidor)
-- resumos: um item por login com o resumo ligado e nota nova desde o último resumo (até 200 notas no e-mail)
-- certificados: um item por empresa ativa cujo A1 chegou a 30/15/7/1/0 dias e ainda não teve aviso dessa etapa
create or replace function public.nf_avisos_pendentes(p_agora timestamptz default now()) returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (
    select av.user_id, p.email, p.nome, coalesce(av.resumo_ate, p_agora - interval '1 day') as desde
      from public.nf_avisos av join public.perfis p on p.user_id = av.user_id
     where av.resumo and coalesce(p.email, '') <> ''
  ), rn as (
    select r.user_id, r.email, r.nome, r.desde,
      (select count(*) from public.nf_notas n join public.nf_empresas e on e.cnpj = n.cnpj_consulta
        where e.ativo and n.criada_em > r.desde and n.criada_em <= p_agora and public._nf_aviso_ve(r.user_id, n.cnpj_consulta)) as total,
      (select coalesce(jsonb_agg(x order by x.empresa, x.papel desc, x.data_emissao desc), '[]'::jsonb) from (
         select e.nome as empresa, n.cnpj_consulta as cnpj, n.tipo, n.papel, n.numero, n.data_emissao, n.valor, n.situacao, n.completo,
                case when n.papel = 'emitida' then n.dest_nome else n.emit_nome end as parte
           from public.nf_notas n join public.nf_empresas e on e.cnpj = n.cnpj_consulta
          where e.ativo and n.criada_em > r.desde and n.criada_em <= p_agora and public._nf_aviso_ve(r.user_id, n.cnpj_consulta)
          order by n.criada_em desc limit 200) x) as notas,
      (select coalesce(jsonb_agg(jsonb_build_object('empresa', e.nome, 'cnpj', e.cnpj, 'papel', g.papel, 'qtd', g.qtd, 'valor', g.valor)
                                 order by e.nome, g.papel desc), '[]'::jsonb)
         from (select n.cnpj_consulta, n.papel, count(*) qtd, sum(coalesce(n.valor, 0)) filter (where n.situacao <> 'Cancelada') valor
                 from public.nf_notas n
                where n.criada_em > r.desde and n.criada_em <= p_agora and public._nf_aviso_ve(r.user_id, n.cnpj_consulta)
                group by 1, 2) g join public.nf_empresas e on e.cnpj = g.cnpj_consulta and e.ativo) as totais
    from r
  ), c as (
    select e.cnpj, e.nome, e.cert_validade, e.cert_titular,
      ceil(extract(epoch from (e.cert_validade - p_agora)) / 86400)::int as faltam,
      (select min(t) from unnest(array[30, 15, 7, 1, 0]) t
        where ceil(extract(epoch from (e.cert_validade - p_agora)) / 86400) <= t) as etapa
    from public.nf_empresas e
    where e.ativo and e.cert_validade is not null and e.cert_validade <= p_agora + interval '30 days'
      and e.cert_validade > p_agora - interval '7 days'   -- vencido há mais de uma semana: para de avisar
  )
  select jsonb_build_object(
    'agora', p_agora,
    'resumos', (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'nome', nome, 'desde', desde,
                  'total', total, 'notas', notas, 'totais', totais)), '[]'::jsonb) from rn where total > 0),
    'certificados', (select coalesce(jsonb_agg(jsonb_build_object('cnpj', c.cnpj, 'empresa', c.nome, 'validade', c.cert_validade,
                  'titular', c.cert_titular, 'faltam', greatest(c.faltam, 0), 'etapa', c.etapa,
                  'emails', array(select distinct p.email from public.perfis p
                                   left join public.nf_avisos av on av.user_id = p.user_id
                                  where coalesce(p.email, '') <> '' and coalesce(av.certificado, true)
                                    and public._nf_aviso_ve(p.user_id, c.cnpj) order by 1))), '[]'::jsonb)
       from c where c.etapa is not null
        and not exists (select 1 from public.nf_cert_avisos a where a.cnpj = c.cnpj and a.validade = c.cert_validade and a.dias <= c.etapa)))
$$;
revoke execute on function public.nf_avisos_pendentes(timestamptz) from public, anon, authenticated;

-- marca o resumo enviado (até o horário da rodada)
create or replace function public.nf_resumo_marcar(p_user uuid, p_ate timestamptz) returns void
language sql security definer set search_path = public as $$
  update public.nf_avisos set resumo_ate = p_ate where user_id = p_user and (resumo_ate is null or resumo_ate < p_ate)
$$;
revoke execute on function public.nf_resumo_marcar(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.nf_cert_aviso_marcar(p_cnpj text, p_validade timestamptz, p_dias int) returns void
language sql security definer set search_path = public as $$
  insert into public.nf_cert_avisos (cnpj, validade, dias) values (p_cnpj, p_validade, p_dias) on conflict do nothing
$$;
revoke execute on function public.nf_cert_aviso_marcar(text, timestamptz, int) from public, anon, authenticated;

grant execute on function public.nf_avisos_pendentes(timestamptz), public.nf_resumo_marcar(uuid, timestamptz),
  public.nf_cert_aviso_marcar(text, timestamptz, int) to service_role;

-- ---------------------------------------------------------------- agenda: todo dia às 10h40 UTC (07h40 de Brasília)
-- Mesmos segredos do Vault do cron do Buscador (buscador_url e buscador_cron_secret, ver agendar_busca.sql).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('nf-avisos', '40 10 * * *', $c$
      select net.http_post(
        url     := (select decrypted_secret from vault.decrypted_secrets where name = 'buscador_url') || '/functions/v1/nf-aviso',
        headers := jsonb_build_object('Content-Type', 'application/json',
                     'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'buscador_cron_secret')),
        body    := '{"origem": "cron"}'::jsonb,
        timeout_milliseconds := 30000)
    $c$);
  end if;
end $$;

-- Painel de Notas 1.2: volta a visão Vendas (só NFS-e emitidas) e entra Compras × Vendas
update public.apps set descricao = 'Compras por fornecedor e vendas de serviços (NFS-e emitidas), mês a mês, a partir das notas baixadas.'
where id = 'painel-nf' and descricao = 'Compras por fornecedor, mês e período, a partir das notas baixadas.';
