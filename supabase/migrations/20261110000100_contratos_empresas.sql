-- Contratos 2.0: VÁRIAS EMPRESAS (pedido do Marco em 09/11/2026). O app deixa de ser só da Nervia: outras empresas contratam
-- e usam o app para os contratos de prestação de serviço delas.
--
-- Decisões do Marco (09/11/2026):
--   * cada empresa contratada é um cadastro próprio (ctr_empresas): razão social, CNPJ, endereço, Junta, e-mail de quem assina,
--     serviços, dia da NF, tolerância, foro padrão, sede da arbitragem padrão — o que antes ficava no ctr_config de linha única —,
--     e as alíquotas de imposto e o modelo do Word próprios;
--   * clientes, contratos, histórico, cobranças, extrato, importações, modelos e impostos separados por empresa (empresa_id), com
--     RLS: o login só enxerga as empresas em que é membro; a equipe Nervia (eh_admin()) vê todas;
--   * papéis por empresa (ctr_membros): gestor (faz tudo) e consulta (só lê). Toda função ctr_* exige gestor da empresa do
--     registro (ou a equipe Nervia) e grava auditoria contratos_* com a empresa no detalhe;
--   * só a equipe Nervia cadastra empresas e define papéis; quem recebe papel ganha o app em app_acessos;
--   * a Nervia vira a PRIMEIRA empresa: criada a partir do ctr_config, recebe TODOS os dados que já existem (nada é apagado;
--     o ctr_config fica guardado, sem uso, para conferência);
--   * arquivos do bucket ctr-arquivos por empresa: os novos vão para a pasta <empresa_id>/…; os que já existem (modelos/…,
--     contratos/<id>/…) continuam onde estão e são lidos pelo vínculo com o modelo/contrato da empresa;
--   * o app vai para a vitrine como "disponível" (sem demonstração pública e sem preço público).
-- Só mexe em tabelas ctr_*, na linha do app "contratos" em apps e nas policies do bucket ctr-arquivos.

-- ---------------------------------------------------------------- empresas e membros
create table if not exists public.ctr_empresas (
  id                  bigint generated always as identity primary key,
  nome                text not null check (length(trim(nome)) > 0),   -- nome curto (seletor do topo)
  contratada_nome     text not null default '',                       -- razão social (campo CTRA-NOME)
  contratada_cnpj     text not null default '',
  contratada_endereco text not null default '',
  contratada_junta    text not null default '',
  contratada_email    text not null default '',
  servicos_esp        text not null default '',
  dia_nf              int not null default 5 check (dia_nf between 1 and 28),
  tolerancia          numeric(8,2) not null default 0.05 check (tolerancia >= 0),
  foro_padrao         text not null default '',
  foro_local_padrao   text not null default '',
  ativo               boolean not null default true,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz
);
create unique index if not exists ctr_empresas_nome on public.ctr_empresas (lower(nome));

create table if not exists public.ctr_membros (
  empresa_id bigint not null references public.ctr_empresas on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  papel      text not null check (papel in ('gestor', 'consulta')),
  criado_em  timestamptz not null default now(),
  primary key (empresa_id, user_id)
);
create index if not exists ctr_membros_user on public.ctr_membros (user_id);

-- a Nervia (primeira empresa) a partir do ctr_config, e empresa_id em todas as tabelas com ela como valor das linhas que já
-- existem (coluna nova com valor constante: nenhuma linha é reescrita, nem o histórico somente inclusão)
do $$
declare v_id bigint; t text;
begin
  select id into v_id from public.ctr_empresas order by id limit 1;
  if v_id is null then
    insert into public.ctr_empresas (nome, contratada_nome, contratada_cnpj, contratada_endereco, contratada_junta, contratada_email,
      servicos_esp, dia_nf, tolerancia, foro_padrao, foro_local_padrao, atualizado_em)
    select 'Nervia', contratada_nome, contratada_cnpj, contratada_endereco, contratada_junta, contratada_email, servicos_esp, dia_nf, tolerancia,
           foro_padrao, foro_local_padrao, atualizado_em
      from public.ctr_config where id = 1
    returning id into v_id;
  end if;
  foreach t in array array['ctr_impostos','ctr_clientes','ctr_modelos','ctr_contratos','ctr_eventos','ctr_importacoes','ctr_extrato','ctr_cobrancas'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'empresa_id') then
      execute format('alter table public.%I add column empresa_id bigint not null default %s references public.ctr_empresas', t, v_id);
      execute format('alter table public.%I alter column empresa_id drop default', t);
      execute format('create index if not exists %I on public.%I (empresa_id)', t || '_empresa', t);
    end if;
  end loop;
end $$;

-- unicidades passam a valer por empresa
alter table public.ctr_impostos drop constraint if exists ctr_impostos_pkey;
alter table public.ctr_impostos add primary key (empresa_id, vale_desde);
drop index if exists public.ctr_clientes_apelido;
create unique index if not exists ctr_clientes_apelido_emp on public.ctr_clientes (empresa_id, lower(apelido));
drop index if exists public.ctr_clientes_cnpj;
create unique index if not exists ctr_clientes_cnpj_emp on public.ctr_clientes (empresa_id, cnpj) where cnpj is not null;
drop index if exists public.ctr_modelos_padrao;
create unique index if not exists ctr_modelos_padrao_emp on public.ctr_modelos (empresa_id) where padrao;
alter table public.ctr_extrato drop constraint if exists ctr_extrato_chave_key;
create unique index if not exists ctr_extrato_chave_emp on public.ctr_extrato (empresa_id, chave);
drop index if exists public.ctr_extrato_fitid;
create unique index if not exists ctr_extrato_fitid_emp on public.ctr_extrato (empresa_id, conta, fitid) where fitid <> '';
alter table public.ctr_importacoes alter column conta set default 'banco';
alter table public.ctr_extrato alter column conta set default 'banco';

comment on table public.ctr_config is 'Contratos 1.x (só a Nervia). Desde a 2.0 os dados estão em ctr_empresas; guardado sem uso.';

-- ---------------------------------------------------------------- acesso
-- papel do login na empresa: 'admin' (equipe Nervia), 'gestor', 'consulta' ou null
create or replace function public.ctr_papel(p_empresa bigint) returns text
language sql stable security definer set search_path = public as $$
  select case when public.eh_admin() then 'admin'
    else (select m.papel from public.ctr_membros m join public.ctr_empresas e on e.id = m.empresa_id
           where m.empresa_id = p_empresa and m.user_id = auth.uid() and e.ativo) end
$$;
revoke execute on function public.ctr_papel(bigint) from public, anon;
grant execute on function public.ctr_papel(bigint) to authenticated;

create or replace function public.ctr_pode_ver(p_empresa bigint) returns boolean
language sql stable security definer set search_path = public as $$ select public.ctr_papel(p_empresa) is not null $$;
revoke execute on function public.ctr_pode_ver(bigint) from public, anon;
grant execute on function public.ctr_pode_ver(bigint) to authenticated;

create or replace function public.ctr_eh_gestor(p_empresa bigint) returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.ctr_papel(p_empresa) in ('admin', 'gestor'), false) $$;
revoke execute on function public.ctr_eh_gestor(bigint) from public, anon;
grant execute on function public.ctr_eh_gestor(bigint) to authenticated;

create or replace function public._ctr_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia cadastra empresas e define quem usa o app Contratos.'; end if;
end $$;
revoke execute on function public._ctr_admin() from public, anon, authenticated;

create or replace function public._ctr_gestor(p_empresa bigint) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_empresa is null or not exists (select 1 from public.ctr_empresas where id = p_empresa) then raise exception 'Empresa não encontrada.'; end if;
  if not public.ctr_eh_gestor(p_empresa) then
    raise exception 'Somente o gestor da empresa (ou a equipe Nervia) altera os contratos. Seu acesso a esta empresa é só de consulta.';
  end if;
end $$;
revoke execute on function public._ctr_gestor(bigint) from public, anon, authenticated;

-- auditoria com a empresa no detalhe (só os campos que mudaram; sem mudança, não registra)
create or replace function public._ctr_auditar(p_acao text, p_det jsonb, p_empresa bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._ctr_auditar(p_acao, coalesce(p_det, '{}'::jsonb) || jsonb_build_object('empresa_id', p_empresa,
    'empresa', (select nome from public.ctr_empresas where id = p_empresa)));
end $$;
revoke execute on function public._ctr_auditar(text, jsonb, bigint) from public, anon, authenticated;

create or replace function public._ctr_evento(p_contrato bigint, p_evento text, p_detalhe text default '', p_data date default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ctr_eventos (empresa_id, contrato_id, data, evento, detalhe, criado_nome)
  values ((select empresa_id from public.ctr_contratos where id = p_contrato), p_contrato, coalesce(p_data, public._ctr_hoje()), p_evento, coalesce(p_detalhe, ''),
          coalesce((select coalesce(nullif(nome, ''), email) from public.perfis where user_id = auth.uid()), 'sistema'));
end $$;
revoke execute on function public._ctr_evento(bigint, text, text, date) from public, anon, authenticated;

-- RLS: cada tabela pela empresa da linha
alter table public.ctr_empresas enable row level security;
alter table public.ctr_membros enable row level security;
revoke all on public.ctr_empresas, public.ctr_membros from anon;
revoke insert, update, delete, truncate on public.ctr_empresas, public.ctr_membros from authenticated;
grant select on public.ctr_empresas, public.ctr_membros to authenticated;
drop policy if exists ctr_empresas_ler on public.ctr_empresas;
create policy ctr_empresas_ler on public.ctr_empresas for select using (public.ctr_pode_ver(id));
drop policy if exists ctr_membros_ler on public.ctr_membros;
create policy ctr_membros_ler on public.ctr_membros for select using (public.eh_admin() or user_id = auth.uid());

do $$ declare t text; begin
  foreach t in array array['ctr_impostos','ctr_clientes','ctr_modelos','ctr_contratos','ctr_eventos','ctr_importacoes','ctr_extrato','ctr_cobrancas'] loop
    execute format('drop policy if exists %1$s_ler on public.%1$s', t);
    execute format('create policy %1$s_ler on public.%1$s for select using (public.ctr_pode_ver(empresa_id))', t);
  end loop;
end $$;

-- alíquota por empresa; a view passa a usar os dados da empresa da cobrança
drop view if exists public.ctr_cobrancas_v;
drop function if exists public.ctr_aliquota(date);
create or replace function public.ctr_aliquota(p_empresa bigint, p_data date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select pct from public.ctr_impostos where empresa_id = p_empresa and vale_desde <= p_data order by vale_desde desc limit 1), 0)
$$;
revoke execute on function public.ctr_aliquota(bigint, date) from public, anon;
grant execute on function public.ctr_aliquota(bigint, date) to authenticated;

create view public.ctr_cobrancas_v with (security_invoker = true) as
select c.*, cl.apelido as cliente, k.situacao as contrato_situacao,
  public.ctr_aliquota(c.empresa_id, coalesce(c.pago_em, c.vencimento)) as imposto_pct,
  round(coalesce(c.valor_pago, 0) * public.ctr_aliquota(c.empresa_id, coalesce(c.pago_em, c.vencimento)) / 100, 2) as imposto,
  coalesce(c.valor_pago, 0) - round(coalesce(c.valor_pago, 0) * public.ctr_aliquota(c.empresa_id, coalesce(c.pago_em, c.vencimento)) / 100, 2) as liquido,
  make_date(left(c.competencia, 4)::int, least(right(c.competencia, 2)::int, 12), e.dia_nf) as nf_prazo,
  case when c.pago_em is null then case when c.vencimento >= public._ctr_hoje() then 'a_vencer' else 'atrasada' end
       when abs(c.valor_pago - c.valor) > e.tolerancia then 'diferenca'
       when c.pago_em <= c.vencimento then 'paga' else 'paga_atraso' end as situacao,
  case when c.nf_emitida then 'emitida'
       when public._ctr_hoje() > make_date(left(c.competencia, 4)::int, least(right(c.competencia, 2)::int, 12), e.dia_nf) then 'atrasada'
       else 'pendente' end as nf_situacao,
  case when c.pago_em is null and c.vencimento < public._ctr_hoje() then public._ctr_hoje() - c.vencimento else 0 end as dias_atraso
from public.ctr_cobrancas c
join public.ctr_clientes cl on cl.id = c.cliente_id
join public.ctr_empresas e on e.id = c.empresa_id
left join public.ctr_contratos k on k.id = c.contrato_id;
revoke all on public.ctr_cobrancas_v from anon;
grant select on public.ctr_cobrancas_v to authenticated;

-- ---------------------------------------------------------------- empresas e equipe (equipe Nervia; o gestor altera os dados da própria empresa)
drop function if exists public.ctr_config_salvar(jsonb);
create or replace function public.ctr_empresa_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p ->> 'id', '')::bigint; a public.ctr_empresas; d public.ctr_empresas;
begin
  if v_id is null then
    perform public._ctr_admin();
    if coalesce(public._ctr_t(p, 'nome'), '') = '' then raise exception 'Informe o nome curto da empresa.'; end if;
    if exists (select 1 from public.ctr_empresas where lower(nome) = lower(public._ctr_t(p, 'nome'))) then raise exception 'Já existe uma empresa com o nome %.', public._ctr_t(p, 'nome'); end if;
    insert into public.ctr_empresas (nome, contratada_nome, contratada_cnpj, contratada_endereco, contratada_junta, contratada_email, servicos_esp,
      dia_nf, tolerancia, foro_padrao, foro_local_padrao)
    values (public._ctr_t(p, 'nome'), coalesce(public._ctr_t(p, 'contratada_nome'), ''), coalesce(public._ctr_t(p, 'contratada_cnpj'), ''),
      coalesce(public._ctr_t(p, 'contratada_endereco'), ''), coalesce(public._ctr_t(p, 'contratada_junta'), ''), coalesce(public._ctr_t(p, 'contratada_email'), ''),
      coalesce(public._ctr_t(p, 'servicos_esp'), ''), coalesce(nullif(public._ctr_t(p, 'dia_nf'), '')::int, 5), coalesce(nullif(public._ctr_t(p, 'tolerancia'), '')::numeric, 0.05),
      coalesce(public._ctr_t(p, 'foro_padrao'), ''), coalesce(public._ctr_t(p, 'foro_local_padrao'), ''))
    returning * into d;
    perform public._ctr_auditar('contratos_empresa_criada', jsonb_build_object('razao_social', d.contratada_nome, 'cnpj', d.contratada_cnpj), d.id);
    return d.id;
  end if;
  perform public._ctr_gestor(v_id);
  if p ? 'ativo' and not public.eh_admin() then raise exception 'Somente a equipe Nervia ativa ou desativa uma empresa.'; end if;
  if p ? 'nome' and exists (select 1 from public.ctr_empresas where lower(nome) = lower(public._ctr_t(p, 'nome')) and id <> v_id) then
    raise exception 'Já existe uma empresa com o nome %.', public._ctr_t(p, 'nome');
  end if;
  select * into a from public.ctr_empresas where id = v_id for update;
  update public.ctr_empresas set
    nome = coalesce(nullif(public._ctr_t(p, 'nome'), ''), nome),
    contratada_nome = coalesce(public._ctr_t(p, 'contratada_nome'), contratada_nome),
    contratada_cnpj = coalesce(public._ctr_t(p, 'contratada_cnpj'), contratada_cnpj),
    contratada_endereco = coalesce(public._ctr_t(p, 'contratada_endereco'), contratada_endereco),
    contratada_junta = coalesce(public._ctr_t(p, 'contratada_junta'), contratada_junta),
    contratada_email = coalesce(public._ctr_t(p, 'contratada_email'), contratada_email),
    servicos_esp = coalesce(public._ctr_t(p, 'servicos_esp'), servicos_esp),
    dia_nf = coalesce(nullif(public._ctr_t(p, 'dia_nf'), '')::int, dia_nf),
    tolerancia = coalesce(nullif(public._ctr_t(p, 'tolerancia'), '')::numeric, tolerancia),
    foro_padrao = coalesce(public._ctr_t(p, 'foro_padrao'), foro_padrao),
    foro_local_padrao = coalesce(public._ctr_t(p, 'foro_local_padrao'), foro_local_padrao),
    ativo = coalesce((p ->> 'ativo')::boolean, ativo),
    atualizado_em = now()
  where id = v_id returning * into d;
  perform public._ctr_auditar('contratos_empresa_alterada', jsonb_build_object('antes', to_jsonb(a) - 'atualizado_em' - 'criado_em', 'depois', to_jsonb(d) - 'atualizado_em' - 'criado_em'), v_id);
  return v_id;
end $$;

-- logins e papéis de uma empresa (equipe Nervia): todos os logins, com o papel nesta empresa e as outras empresas
create or replace function public.ctr_equipe(p_empresa bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._ctr_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'email', p.email, 'nome', p.nome, 'admin', p.admin,
             'papel', (select papel from public.ctr_membros where empresa_id = p_empresa and user_id = p.user_id),
             'outras', (select coalesce(jsonb_agg(e.nome order by e.nome), '[]') from public.ctr_membros m join public.ctr_empresas e on e.id = m.empresa_id
                         where m.user_id = p.user_id and m.empresa_id <> p_empresa))
           order by (select papel from public.ctr_membros where empresa_id = p_empresa and user_id = p.user_id) is null, coalesce(nullif(p.nome, ''), p.email))
    from public.perfis p), '[]');
end $$;

-- papel vazio = retira; quem recebe papel ganha o app em app_acessos; quem perde o último papel perde o app (exceto a equipe Nervia)
create or replace function public.ctr_membro_salvar(p_empresa bigint, p_user uuid, p_papel text) returns void
language plpgsql security definer set search_path = public as $$
declare v_antes text; v_email text;
begin
  perform public._ctr_admin();
  if not exists (select 1 from public.ctr_empresas where id = p_empresa) then raise exception 'Empresa não encontrada.'; end if;
  select email into v_email from public.perfis where user_id = p_user;
  if not found then raise exception 'Login não encontrado.'; end if;
  select papel into v_antes from public.ctr_membros where empresa_id = p_empresa and user_id = p_user;
  if coalesce(p_papel, '') = '' then
    if v_antes is null then return; end if;
    delete from public.ctr_membros where empresa_id = p_empresa and user_id = p_user;
    if not exists (select 1 from public.ctr_membros where user_id = p_user)
       and not coalesce((select admin from public.perfis where user_id = p_user), false) then
      delete from public.app_acessos where user_id = p_user and app_id = 'contratos';
    end if;
  else
    if p_papel not in ('gestor', 'consulta') then raise exception 'Papel inválido (gestor ou consulta).'; end if;
    if v_antes is not distinct from p_papel then return; end if;
    insert into public.ctr_membros (empresa_id, user_id, papel) values (p_empresa, p_user, p_papel)
      on conflict (empresa_id, user_id) do update set papel = excluded.papel;
    insert into public.app_acessos (user_id, app_id) values (p_user, 'contratos') on conflict do nothing;
  end if;
  perform public._ctr_auditar(case when coalesce(p_papel, '') = '' then 'contratos_membro_retirado' else 'contratos_membro_definido' end,
    jsonb_build_object('login', v_email, 'login_id', p_user, 'papel', nullif(p_papel, ''), 'papel_antes', v_antes), p_empresa);
end $$;

-- ---------------------------------------------------------------- impostos
drop function if exists public.ctr_imposto_salvar(date, numeric);
drop function if exists public.ctr_imposto_excluir(date);
create or replace function public.ctr_imposto_salvar(p_empresa bigint, p_desde date, p_pct numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_antes numeric;
begin
  perform public._ctr_gestor(p_empresa);
  if p_desde is null or p_pct is null or p_pct < 0 or p_pct >= 100 then raise exception 'Informe a data e a alíquota (0 a 99,99%%).'; end if;
  select pct into v_antes from public.ctr_impostos where empresa_id = p_empresa and vale_desde = p_desde;
  insert into public.ctr_impostos (empresa_id, vale_desde, pct) values (p_empresa, p_desde, p_pct)
    on conflict (empresa_id, vale_desde) do update set pct = excluded.pct;
  perform public._ctr_auditar('contratos_imposto_salvo', jsonb_build_object('vale_desde', p_desde, 'antes', jsonb_build_object('pct', v_antes), 'depois', jsonb_build_object('pct', p_pct)), p_empresa);
end $$;

create or replace function public.ctr_imposto_excluir(p_empresa bigint, p_desde date) returns void
language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  perform public._ctr_gestor(p_empresa);
  delete from public.ctr_impostos where empresa_id = p_empresa and vale_desde = p_desde returning pct into v;
  if not found then raise exception 'Alíquota não encontrada.'; end if;
  perform public._ctr_auditar('contratos_imposto_excluido', jsonb_build_object('vale_desde', p_desde, 'pct', v), p_empresa);
end $$;

-- ---------------------------------------------------------------- clientes
create or replace function public.ctr_cliente_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p ->> 'id', '')::bigint; a public.ctr_clientes; d public.ctr_clientes; v_doc text; v_emp bigint;
begin
  if v_id is null then v_emp := nullif(p ->> 'empresa_id', '')::bigint;
  else select empresa_id into v_emp from public.ctr_clientes where id = v_id;
       if not found then raise exception 'Cliente não encontrado.'; end if; end if;
  perform public._ctr_gestor(v_emp);
  v_doc := public._ctr_doc(p ->> 'cnpj');
  if p ? 'cnpj' and v_doc is not null and length(v_doc) not in (11, 14) then raise exception 'CNPJ (14 dígitos) ou CPF (11 dígitos) inválido.'; end if;
  if v_id is null then
    if coalesce(public._ctr_t(p, 'apelido'), '') = '' or coalesce(public._ctr_t(p, 'razao_social'), '') = '' then
      raise exception 'Informe o nome curto e a razão social do cliente.';
    end if;
    if exists (select 1 from public.ctr_clientes where empresa_id = v_emp and lower(apelido) = lower(public._ctr_t(p, 'apelido'))) then raise exception 'Já existe um cliente com o nome %.', public._ctr_t(p, 'apelido'); end if;
    if v_doc is not null and exists (select 1 from public.ctr_clientes where empresa_id = v_emp and cnpj = v_doc) then raise exception 'Já existe um cliente com este CNPJ.'; end if;
    insert into public.ctr_clientes (empresa_id, apelido, sigla, razao_social, cnpj, endereco, email_cobranca, resp_financeiro, extrato_textos, obs, foro, foro_local)
    values (v_emp, public._ctr_t(p, 'apelido'), coalesce(public._ctr_t(p, 'sigla'), ''), public._ctr_t(p, 'razao_social'), v_doc,
            coalesce(public._ctr_t(p, 'endereco'), ''), coalesce(public._ctr_t(p, 'email_cobranca'), ''), coalesce(public._ctr_t(p, 'resp_financeiro'), ''),
            coalesce((select array_agg(trim(x)) from jsonb_array_elements_text(case when jsonb_typeof(p -> 'extrato_textos') = 'array' then p -> 'extrato_textos' else '[]' end) x where trim(x) <> ''), '{}'),
            coalesce(public._ctr_t(p, 'obs'), ''), coalesce(public._ctr_t(p, 'foro'), ''), coalesce(public._ctr_t(p, 'foro_local'), ''))
    returning * into d;
    perform public._ctr_auditar('contratos_cliente_criado', jsonb_build_object('cliente', d.apelido, 'razao_social', d.razao_social, 'cnpj', d.cnpj), v_emp);
    return d.id;
  end if;
  select * into a from public.ctr_clientes where id = v_id;
  if p ? 'apelido' and exists (select 1 from public.ctr_clientes where empresa_id = v_emp and lower(apelido) = lower(public._ctr_t(p, 'apelido')) and id <> v_id) then
    raise exception 'Já existe um cliente com o nome %.', public._ctr_t(p, 'apelido');
  end if;
  if p ? 'cnpj' and v_doc is not null and exists (select 1 from public.ctr_clientes where empresa_id = v_emp and cnpj = v_doc and id <> v_id) then raise exception 'Já existe um cliente com este CNPJ.'; end if;
  update public.ctr_clientes set
    apelido = coalesce(nullif(public._ctr_t(p, 'apelido'), ''), apelido),
    sigla = coalesce(public._ctr_t(p, 'sigla'), sigla),
    razao_social = coalesce(nullif(public._ctr_t(p, 'razao_social'), ''), razao_social),
    cnpj = case when p ? 'cnpj' then v_doc else cnpj end,
    endereco = coalesce(public._ctr_t(p, 'endereco'), endereco),
    email_cobranca = coalesce(public._ctr_t(p, 'email_cobranca'), email_cobranca),
    resp_financeiro = coalesce(public._ctr_t(p, 'resp_financeiro'), resp_financeiro),
    extrato_textos = case when jsonb_typeof(p -> 'extrato_textos') = 'array'
      then coalesce((select array_agg(trim(x)) from jsonb_array_elements_text(p -> 'extrato_textos') x where trim(x) <> ''), '{}') else extrato_textos end,
    ativo = coalesce((p ->> 'ativo')::boolean, ativo),
    obs = coalesce(public._ctr_t(p, 'obs'), obs),
    foro = coalesce(public._ctr_t(p, 'foro'), foro),
    foro_local = coalesce(public._ctr_t(p, 'foro_local'), foro_local)
  where id = v_id returning * into d;
  perform public._ctr_auditar('contratos_cliente_alterado', jsonb_build_object('cliente', d.apelido, 'antes', to_jsonb(a) - 'criado_em', 'depois', to_jsonb(d) - 'criado_em'), v_emp);
  return v_id;
end $$;

-- ---------------------------------------------------------------- modelos do contrato (pasta <empresa>/modelos/ no bucket)
create or replace function public.ctr_modelo_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_emp bigint := nullif(p ->> 'empresa_id', '')::bigint;
begin
  perform public._ctr_gestor(v_emp);
  if coalesce(public._ctr_t(p, 'caminho'), '') !~ ('^' || v_emp || '/modelos/[^/]+\.docx$') then raise exception 'Caminho do modelo inválido.'; end if;
  update public.ctr_modelos set padrao = false where empresa_id = v_emp and padrao;
  insert into public.ctr_modelos (empresa_id, nome, caminho, campos, padrao)
  values (v_emp, coalesce(nullif(public._ctr_t(p, 'nome'), ''), 'Modelo'), public._ctr_t(p, 'caminho'),
          coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p -> 'campos') = 'array' then p -> 'campos' else '[]' end) x), '{}'), true)
  returning id into v_id;
  perform public._ctr_auditar('contratos_modelo_enviado', jsonb_build_object('modelo', public._ctr_t(p, 'nome'), 'caminho', public._ctr_t(p, 'caminho'), 'campos', p -> 'campos'), v_emp);
  return v_id;
end $$;

-- ---------------------------------------------------------------- contratos
create or replace function public.ctr_contrato_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p ->> 'id', '')::bigint; a public.ctr_contratos; d public.ctr_contratos; v_mot text := coalesce(public._ctr_t(p, 'motivo'), ''); v_emp bigint;
begin
  if v_id is null then
    select empresa_id into v_emp from public.ctr_clientes where id = nullif(p ->> 'cliente_id', '')::bigint;
    if not found then raise exception 'Escolha o cliente.'; end if;
    perform public._ctr_gestor(v_emp);
    if nullif(p ->> 'modelo_id', '') is not null and not exists (select 1 from public.ctr_modelos where id = (p ->> 'modelo_id')::bigint and empresa_id = v_emp) then
      raise exception 'O modelo não é desta empresa.';
    end if;
    if public._ctr_t(p, 'inicio') is null then raise exception 'Informe o início do contrato.'; end if;
    if coalesce(public._ctr_t(p, 'valor_mensal')::numeric, 0) <= 0 then raise exception 'Informe o valor mensal.'; end if;
    insert into public.ctr_contratos (empresa_id, cliente_id, modelo_id, objeto, servicos_esp, inicio, fim, valor_mensal, dia_vencimento, parcela_extra, assinantes,
      testemunha1, testemunha1_doc, testemunha2, testemunha2_doc, local_assinatura, data_assinatura, obs)
    values (v_emp, (p ->> 'cliente_id')::bigint, nullif(p ->> 'modelo_id', '')::bigint, coalesce(public._ctr_t(p, 'objeto'), ''), coalesce(public._ctr_t(p, 'servicos_esp'), ''),
      public._ctr_t(p, 'inicio')::date, nullif(public._ctr_t(p, 'fim'), '')::date, public._ctr_t(p, 'valor_mensal')::numeric,
      coalesce(nullif(public._ctr_t(p, 'dia_vencimento'), '')::int, 30), coalesce((p ->> 'parcela_extra')::boolean, true), coalesce(public._ctr_t(p, 'assinantes'), ''),
      coalesce(public._ctr_t(p, 'testemunha1'), ''), coalesce(public._ctr_t(p, 'testemunha1_doc'), ''),
      coalesce(public._ctr_t(p, 'testemunha2'), ''), coalesce(public._ctr_t(p, 'testemunha2_doc'), ''),
      coalesce(nullif(public._ctr_t(p, 'local_assinatura'), ''), 'Rio de Janeiro'), nullif(public._ctr_t(p, 'data_assinatura'), '')::date, coalesce(public._ctr_t(p, 'obs'), ''))
    returning * into d;
    perform public._ctr_evento(d.id, 'Contrato criado (rascunho)', format('Valor mensal R$ %s', to_char(d.valor_mensal, 'FM999G999G990D00')));
    perform public._ctr_auditar('contratos_contrato_criado', jsonb_build_object('contrato', public._ctr_contrato_nome(d.id), 'contrato_id', d.id, 'valor_mensal', d.valor_mensal), v_emp);
    return d.id;
  end if;
  select * into a from public.ctr_contratos where id = v_id for update;
  if not found then raise exception 'Contrato não encontrado.'; end if;
  v_emp := a.empresa_id;
  perform public._ctr_gestor(v_emp);
  if p ? 'cliente_id' and (p ->> 'cliente_id')::bigint <> a.cliente_id then
    if not exists (select 1 from public.ctr_clientes where id = (p ->> 'cliente_id')::bigint and empresa_id = v_emp) then raise exception 'O cliente não é desta empresa.'; end if;
    if exists (select 1 from public.ctr_cobrancas where contrato_id = v_id) then raise exception 'O contrato já tem cobranças: o cliente não pode mudar.'; end if;
  end if;
  if nullif(p ->> 'modelo_id', '') is not null and not exists (select 1 from public.ctr_modelos where id = (p ->> 'modelo_id')::bigint and empresa_id = v_emp) then
    raise exception 'O modelo não é desta empresa.';
  end if;
  update public.ctr_contratos set
    cliente_id = coalesce((p ->> 'cliente_id')::bigint, cliente_id),
    modelo_id = case when p ? 'modelo_id' then nullif(p ->> 'modelo_id', '')::bigint else modelo_id end,
    objeto = coalesce(public._ctr_t(p, 'objeto'), objeto), servicos_esp = coalesce(public._ctr_t(p, 'servicos_esp'), servicos_esp),
    inicio = coalesce(nullif(public._ctr_t(p, 'inicio'), '')::date, inicio),
    fim = case when p ? 'fim' then nullif(public._ctr_t(p, 'fim'), '')::date else fim end,
    valor_mensal = coalesce(nullif(public._ctr_t(p, 'valor_mensal'), '')::numeric, valor_mensal),
    dia_vencimento = coalesce(nullif(public._ctr_t(p, 'dia_vencimento'), '')::int, dia_vencimento),
    parcela_extra = coalesce((p ->> 'parcela_extra')::boolean, parcela_extra),
    assinantes = coalesce(public._ctr_t(p, 'assinantes'), assinantes),
    testemunha1 = coalesce(public._ctr_t(p, 'testemunha1'), testemunha1), testemunha1_doc = coalesce(public._ctr_t(p, 'testemunha1_doc'), testemunha1_doc),
    testemunha2 = coalesce(public._ctr_t(p, 'testemunha2'), testemunha2), testemunha2_doc = coalesce(public._ctr_t(p, 'testemunha2_doc'), testemunha2_doc),
    local_assinatura = coalesce(nullif(public._ctr_t(p, 'local_assinatura'), ''), local_assinatura),
    data_assinatura = case when p ? 'data_assinatura' then nullif(public._ctr_t(p, 'data_assinatura'), '')::date else data_assinatura end,
    obs = coalesce(public._ctr_t(p, 'obs'), obs), atualizado_em = now()
  where id = v_id returning * into d;
  if d.valor_mensal <= 0 then raise exception 'Informe o valor mensal.'; end if;
  if a.situacao in ('assinado', 'encerrado', 'rescindido')
     and (a.valor_mensal, a.inicio, a.fim, a.dia_vencimento, a.parcela_extra) is distinct from (d.valor_mensal, d.inicio, d.fim, d.dia_vencimento, d.parcela_extra) then
    if length(v_mot) < 5 then raise exception 'O contrato já foi assinado: para mudar valor, prazo ou vencimento, informe o motivo (ex.: aditivo assinado em …).'; end if;
    perform public._ctr_evento(v_id, 'Alterado depois da assinatura', v_mot);
  end if;
  perform public._ctr_auditar('contratos_contrato_alterado', jsonb_build_object('contrato', public._ctr_contrato_nome(v_id), 'contrato_id', v_id,
    'motivo', nullif(v_mot, ''), 'antes', to_jsonb(a) - 'atualizado_em', 'depois', to_jsonb(d) - 'atualizado_em'), v_emp);
  return v_id;
end $$;

create or replace function public.ctr_contrato_etapa(p_id bigint, p_etapa text, p_data date default null, p_obs text default '') returns text
language plpgsql security definer set search_path = public as $$
declare k public.ctr_contratos; v_data date := coalesce(p_data, public._ctr_hoje()); v_nova text; v_obs text := coalesce(trim(p_obs), '');
begin
  select * into k from public.ctr_contratos where id = p_id for update;
  if not found then raise exception 'Contrato não encontrado.'; end if;
  perform public._ctr_gestor(k.empresa_id);
  if v_data > public._ctr_hoje() then raise exception 'A data não pode ser no futuro.'; end if;
  if p_etapa = 'gerado' then
    if k.situacao in ('encerrado', 'rescindido') then raise exception 'Contrato encerrado: não se gera de novo.'; end if;
    v_nova := case when k.situacao = 'rascunho' then 'gerado' else k.situacao end;
    update public.ctr_contratos set situacao = v_nova, gerado_em = v_data where id = p_id;
  elsif p_etapa = 'enviado' then
    if k.situacao not in ('rascunho', 'gerado', 'enviado') then raise exception 'Só contrato ainda não assinado é enviado para assinatura.'; end if;
    v_nova := 'enviado';
    update public.ctr_contratos set situacao = v_nova, enviado_em = v_data, gerado_em = coalesce(gerado_em, v_data) where id = p_id;
  elsif p_etapa = 'assinado' then
    if k.situacao not in ('rascunho', 'gerado', 'enviado') then raise exception 'O contrato já está %.', k.situacao; end if;
    v_nova := 'assinado';
    update public.ctr_contratos set situacao = v_nova, assinado_em = v_data, enviado_em = coalesce(enviado_em, v_data), gerado_em = coalesce(gerado_em, v_data) where id = p_id;
  elsif p_etapa = 'encerrado' then
    if k.situacao <> 'assinado' then raise exception 'Só contrato assinado é encerrado (para os outros, use Rescindir).'; end if;
    v_nova := 'encerrado';
    update public.ctr_contratos set situacao = v_nova, encerrado_em = v_data, motivo_encerramento = v_obs where id = p_id;
  elsif p_etapa = 'rescindido' then
    if k.situacao in ('encerrado', 'rescindido') then raise exception 'O contrato já está %.', k.situacao; end if;
    if length(v_obs) < 5 then raise exception 'Informe o motivo da rescisão.'; end if;
    v_nova := 'rescindido';
    update public.ctr_contratos set situacao = v_nova, encerrado_em = v_data, motivo_encerramento = v_obs where id = p_id;
  elsif p_etapa = 'voltar' then
    if length(v_obs) < 5 then raise exception 'Informe o motivo para voltar a etapa.'; end if;
    v_nova := case k.situacao when 'gerado' then 'rascunho' when 'enviado' then 'gerado' when 'assinado' then 'enviado'
                              when 'encerrado' then 'assinado' when 'rescindido' then case when k.assinado_em is not null then 'assinado' else 'gerado' end end;
    if v_nova is null then raise exception 'O contrato já está em rascunho.'; end if;
    update public.ctr_contratos set situacao = v_nova,
      gerado_em = case when v_nova = 'rascunho' then null else gerado_em end,
      enviado_em = case when v_nova in ('rascunho', 'gerado') then null else enviado_em end,
      assinado_em = case when v_nova in ('rascunho', 'gerado', 'enviado') then null else assinado_em end,
      encerrado_em = null, motivo_encerramento = '' where id = p_id;
  else
    raise exception 'Etapa desconhecida: %', p_etapa;
  end if;
  perform public._ctr_evento(p_id, case p_etapa when 'gerado' then 'Contrato gerado (Word)' when 'enviado' then 'Enviado para assinatura'
    when 'assinado' then 'Assinado' when 'encerrado' then 'Encerrado' when 'rescindido' then 'Rescindido'
    else 'Voltou de ' || k.situacao || ' para ' || v_nova end, v_obs, v_data);
  perform public._ctr_auditar('contratos_etapa', jsonb_build_object('contrato', public._ctr_contrato_nome(p_id), 'contrato_id', p_id,
    'etapa', p_etapa, 'data', v_data, 'obs', nullif(v_obs, ''), 'antes', jsonb_build_object('situacao', k.situacao), 'depois', jsonb_build_object('situacao', v_nova)), k.empresa_id);
  return v_nova;
end $$;

-- PDF assinado: arquivos novos na pasta <empresa>/contratos/<id>/ (os da 1.x, em contratos/<id>/, continuam valendo)
create or replace function public.ctr_contrato_documento(p_id bigint, p_caminho text, p_nome text default '') returns void
language plpgsql security definer set search_path = public as $$
declare v_antes text; v_emp bigint;
begin
  select documento, empresa_id into v_antes, v_emp from public.ctr_contratos where id = p_id for update;
  if not found then raise exception 'Contrato não encontrado.'; end if;
  perform public._ctr_gestor(v_emp);
  if coalesce(p_caminho, '') !~ ('^' || v_emp || '/contratos/' || p_id || '/[^/]+\.pdf$') then raise exception 'Caminho do PDF inválido.'; end if;
  update public.ctr_contratos set documento = p_caminho where id = p_id;
  perform public._ctr_evento(p_id, case when v_antes is null then 'PDF assinado guardado' else 'PDF assinado substituído' end, coalesce(p_nome, ''));
  perform public._ctr_auditar('contratos_documento', jsonb_build_object('contrato', public._ctr_contrato_nome(p_id), 'contrato_id', p_id, 'arquivo', p_nome,
    'antes', jsonb_build_object('documento', v_antes), 'depois', jsonb_build_object('documento', p_caminho)), v_emp);
end $$;

create or replace function public.ctr_contrato_renovar(p_id bigint, p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare k public.ctr_contratos; v_novo bigint;
begin
  select * into k from public.ctr_contratos where id = p_id;
  if not found then raise exception 'Contrato não encontrado.'; end if;
  perform public._ctr_gestor(k.empresa_id);
  if public._ctr_t(p, 'inicio') is null then raise exception 'Informe o início do novo contrato.'; end if;
  if k.fim is not null and public._ctr_t(p, 'inicio')::date <= k.fim and coalesce((p ->> 'sobrepor')::boolean, false) is false then
    raise exception 'O novo contrato começa antes do fim do atual (%).', to_char(k.fim, 'DD/MM/YYYY');
  end if;
  insert into public.ctr_contratos (empresa_id, cliente_id, modelo_id, objeto, servicos_esp, inicio, fim, valor_mensal, dia_vencimento, parcela_extra, assinantes,
    testemunha1, testemunha1_doc, testemunha2, testemunha2_doc, local_assinatura, anterior_id)
  values (k.empresa_id, k.cliente_id, k.modelo_id, k.objeto, k.servicos_esp, public._ctr_t(p, 'inicio')::date, nullif(public._ctr_t(p, 'fim'), '')::date,
    coalesce(nullif(public._ctr_t(p, 'valor_mensal'), '')::numeric, k.valor_mensal), k.dia_vencimento, k.parcela_extra, k.assinantes,
    k.testemunha1, k.testemunha1_doc, k.testemunha2, k.testemunha2_doc, k.local_assinatura, k.id)
  returning id into v_novo;
  perform public._ctr_evento(v_novo, 'Renovação do contrato anterior (rascunho)', public._ctr_contrato_nome(k.id));
  perform public._ctr_evento(k.id, 'Renovado', public._ctr_contrato_nome(v_novo));
  perform public._ctr_auditar('contratos_renovado', jsonb_build_object('contrato', public._ctr_contrato_nome(v_novo), 'contrato_id', v_novo, 'anterior_id', k.id,
    'antes', jsonb_build_object('valor_mensal', k.valor_mensal), 'depois', jsonb_build_object('valor_mensal', (select valor_mensal from public.ctr_contratos where id = v_novo))), k.empresa_id);
  return v_novo;
end $$;

-- ---------------------------------------------------------------- cobranças
create or replace function public.ctr_cobrancas_gerar(p_contrato bigint, p_ate date default null) returns int
language plpgsql security definer set search_path = public as $$
declare k public.ctr_contratos; v_fim date; m date; v_n int := 0; v_meses int; v_comp text; v_venc date;
begin
  select * into k from public.ctr_contratos where id = p_contrato for update;
  if not found then raise exception 'Contrato não encontrado.'; end if;
  perform public._ctr_gestor(k.empresa_id);
  if k.situacao = 'rascunho' then raise exception 'Gere o contrato (Word) antes de criar as cobranças.'; end if;
  v_fim := coalesce(p_ate, k.fim, make_date(extract(year from public._ctr_hoje())::int, 12, 31));
  v_fim := least(v_fim, coalesce(k.fim, v_fim), coalesce(k.encerrado_em, v_fim));
  m := date_trunc('month', k.inicio)::date;
  while m <= v_fim loop
    v_comp := to_char(m, 'YYYY/MM');
    v_venc := make_date(extract(year from m)::int, extract(month from m)::int,
                        least(k.dia_vencimento, extract(day from (m + interval '1 month - 1 day'))::int));
    if not exists (select 1 from public.ctr_cobrancas where contrato_id = k.id and competencia = v_comp) then
      insert into public.ctr_cobrancas (empresa_id, cliente_id, contrato_id, competencia, vencimento, valor) values (k.empresa_id, k.cliente_id, k.id, v_comp, v_venc, k.valor_mensal);
      v_n := v_n + 1;
    end if;
    if extract(month from m) = 12 and k.parcela_extra then
      v_comp := to_char(m, 'YYYY') || '/13';
      v_meses := 12 - extract(month from greatest(k.inicio, make_date(extract(year from m)::int, 1, 1)))::int + 1;
      if not exists (select 1 from public.ctr_cobrancas where contrato_id = k.id and competencia = v_comp) then
        insert into public.ctr_cobrancas (empresa_id, cliente_id, contrato_id, competencia, vencimento, valor, descricao)
        values (k.empresa_id, k.cliente_id, k.id, v_comp, v_venc, round(k.valor_mensal * v_meses / 12, 2),
                case when v_meses < 12 then format('Parcela extra proporcional (%s/12)', v_meses) else 'Parcela extra de dezembro' end);
        v_n := v_n + 1;
      end if;
    end if;
    m := (m + interval '1 month')::date;
  end loop;
  if v_n > 0 then
    perform public._ctr_evento(k.id, format('%s cobrança(s) criada(s)', v_n), 'até ' || to_char(v_fim, 'MM/YYYY'));
    perform public._ctr_auditar('contratos_cobrancas_geradas', jsonb_build_object('contrato', public._ctr_contrato_nome(k.id), 'contrato_id', k.id, 'quantidade', v_n, 'ate', v_fim), k.empresa_id);
  end if;
  return v_n;
end $$;

create or replace function public.ctr_cobranca_avulsa(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_cli bigint := nullif(p ->> 'cliente_id', '')::bigint; v_k bigint := nullif(p ->> 'contrato_id', '')::bigint; v_emp bigint;
begin
  select empresa_id into v_emp from public.ctr_clientes where id = v_cli;
  if not found then raise exception 'Escolha o cliente.'; end if;
  perform public._ctr_gestor(v_emp);
  if v_k is not null and not exists (select 1 from public.ctr_contratos where id = v_k and cliente_id = v_cli) then raise exception 'O contrato não é deste cliente.'; end if;
  if coalesce(public._ctr_t(p, 'valor')::numeric, 0) <= 0 then raise exception 'Informe o valor.'; end if;
  if public._ctr_t(p, 'vencimento') is null then raise exception 'Informe o vencimento.'; end if;
  if coalesce(public._ctr_t(p, 'descricao'), '') = '' then raise exception 'Descreva a cobrança (ex.: projeto, visita extra).'; end if;
  insert into public.ctr_cobrancas (empresa_id, cliente_id, contrato_id, competencia, vencimento, valor, descricao)
  values (v_emp, v_cli, v_k, coalesce(nullif(public._ctr_t(p, 'competencia'), ''), to_char(public._ctr_t(p, 'vencimento')::date, 'YYYY/MM')),
          public._ctr_t(p, 'vencimento')::date, public._ctr_t(p, 'valor')::numeric, public._ctr_t(p, 'descricao'))
  returning id into v_id;
  perform public._ctr_auditar('contratos_cobranca_avulsa', jsonb_build_object('cobranca_id', v_id, 'cliente', (select apelido from public.ctr_clientes where id = v_cli),
    'valor', public._ctr_t(p, 'valor')::numeric, 'descricao', public._ctr_t(p, 'descricao')), v_emp);
  return v_id;
end $$;

create or replace function public.ctr_cobranca_salvar(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a public.ctr_cobrancas; d public.ctr_cobrancas; v_id bigint := (p ->> 'id')::bigint;
begin
  select * into a from public.ctr_cobrancas where id = v_id for update;
  if not found then raise exception 'Cobrança não encontrada.'; end if;
  perform public._ctr_gestor(a.empresa_id);
  if a.pago_em is not null and (p ? 'valor' or p ? 'vencimento' or p ? 'competencia') then
    raise exception 'Cobrança já paga: desfaça a baixa antes de mudar valor, vencimento ou mês.';
  end if;
  update public.ctr_cobrancas set
    valor = coalesce(nullif(public._ctr_t(p, 'valor'), '')::numeric, valor),
    vencimento = coalesce(nullif(public._ctr_t(p, 'vencimento'), '')::date, vencimento),
    competencia = coalesce(nullif(public._ctr_t(p, 'competencia'), ''), competencia),
    descricao = coalesce(public._ctr_t(p, 'descricao'), descricao),
    obs = coalesce(public._ctr_t(p, 'obs'), obs)
  where id = v_id returning * into d;
  perform public._ctr_auditar('contratos_cobranca_alterada', jsonb_build_object('cobranca_id', v_id,
    'cliente', (select apelido from public.ctr_clientes where id = a.cliente_id), 'competencia', a.competencia,
    'antes', to_jsonb(a) - 'criado_em', 'depois', to_jsonb(d) - 'criado_em'), a.empresa_id);
end $$;

-- NF em lote: todas as cobranças precisam ser da mesma empresa
create or replace function public.ctr_nf_marcar(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_ids bigint[]; v_emit boolean := coalesce((p ->> 'emitida')::boolean, true); v_data date := nullif(public._ctr_t(p, 'data'), '')::date;
  v_num text := coalesce(public._ctr_t(p, 'numero'), ''); v_n int; v_emps bigint[];
begin
  select array_agg(x::bigint) into v_ids from jsonb_array_elements_text(case when jsonb_typeof(p -> 'ids') = 'array' then p -> 'ids' else '[]' end) x;
  if v_ids is null then raise exception 'Escolha as cobranças.'; end if;
  select array_agg(distinct empresa_id) into v_emps from public.ctr_cobrancas where id = any (v_ids);
  if v_emps is null then raise exception 'Cobrança não encontrada.'; end if;
  if array_length(v_emps, 1) > 1 then raise exception 'Escolha cobranças de uma empresa só.'; end if;
  perform public._ctr_gestor(v_emps[1]);
  if v_num <> '' and array_length(v_ids, 1) > 1 then raise exception 'O número da NF só pode ser informado para uma cobrança por vez.'; end if;
  if v_emit and v_data is not null and v_data > public._ctr_hoje() then raise exception 'A data da NF não pode ser no futuro.'; end if;
  update public.ctr_cobrancas set nf_emitida = v_emit,
    nf_data = case when v_emit then coalesce(v_data, nf_data, public._ctr_hoje()) end,
    nf_numero = case when v_emit then case when v_num <> '' then v_num else nf_numero end else '' end
  where id = any (v_ids);
  get diagnostics v_n = row_count;
  if v_n <> array_length(v_ids, 1) then raise exception 'Cobrança não encontrada.'; end if;
  perform public._ctr_auditar('contratos_nf_marcada', jsonb_build_object('emitida', v_emit, 'data', v_data, 'numero', nullif(v_num, ''),
    'cobrancas', (select jsonb_agg(jsonb_build_object('id', c.id, 'cliente', cl.apelido, 'competencia', c.competencia, 'valor', c.valor) order by c.competencia, cl.apelido)
                    from public.ctr_cobrancas c join public.ctr_clientes cl on cl.id = c.cliente_id where c.id = any (v_ids))), v_emps[1]);
  return v_n;
end $$;

create or replace function public.ctr_baixa(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a public.ctr_cobrancas; v_id bigint := (p ->> 'id')::bigint; v_data date := nullif(public._ctr_t(p, 'pago_em'), '')::date;
  v_val numeric := nullif(public._ctr_t(p, 'valor_pago'), '')::numeric; v_obs text := coalesce(public._ctr_t(p, 'obs'), '');
begin
  select * into a from public.ctr_cobrancas where id = v_id for update;
  if not found then raise exception 'Cobrança não encontrada.'; end if;
  perform public._ctr_gestor(a.empresa_id);
  if a.pago_em is not null then raise exception 'Esta cobrança já tem baixa.'; end if;
  if v_data is null or v_val is null or v_val <= 0 then raise exception 'Informe a data e o valor recebido.'; end if;
  if v_data > public._ctr_hoje() then raise exception 'A data do recebimento não pode ser no futuro.'; end if;
  if abs(v_val - a.valor) > (select tolerancia from public.ctr_empresas where id = a.empresa_id) and length(v_obs) < 3 then
    raise exception 'O valor recebido é diferente do cobrado: explique a diferença na observação.';
  end if;
  update public.ctr_cobrancas set pago_em = v_data, valor_pago = v_val, nf_emitida = true, nf_data = coalesce(nf_data, v_data),
    obs = case when v_obs <> '' then v_obs else obs end where id = v_id;
  perform public._ctr_auditar('contratos_baixa', jsonb_build_object('cobranca_id', v_id, 'cliente', (select apelido from public.ctr_clientes where id = a.cliente_id),
    'competencia', a.competencia, 'valor', a.valor, 'valor_pago', v_val, 'pago_em', v_data, 'obs', nullif(v_obs, ''), 'pelo_extrato', false), a.empresa_id);
end $$;

create or replace function public.ctr_baixa_desfazer(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.ctr_cobrancas;
begin
  select * into a from public.ctr_cobrancas where id = p_id for update;
  if not found then raise exception 'Cobrança não encontrada.'; end if;
  perform public._ctr_gestor(a.empresa_id);
  if length(coalesce(trim(p_motivo), '')) < 5 then raise exception 'Informe o motivo para desfazer a baixa.'; end if;
  if a.pago_em is null then raise exception 'Esta cobrança não tem baixa.'; end if;
  update public.ctr_cobrancas set pago_em = null, valor_pago = null, extrato_id = null where id = p_id;
  perform public._ctr_auditar('contratos_baixa_desfeita', jsonb_build_object('cobranca_id', p_id, 'cliente', (select apelido from public.ctr_clientes where id = a.cliente_id),
    'competencia', a.competencia, 'motivo', trim(p_motivo), 'antes', jsonb_build_object('pago_em', a.pago_em, 'valor_pago', a.valor_pago, 'extrato_id', a.extrato_id)), a.empresa_id);
end $$;

create or replace function public.ctr_cobranca_excluir(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.ctr_cobrancas;
begin
  select * into a from public.ctr_cobrancas where id = p_id for update;
  if not found then raise exception 'Cobrança não encontrada.'; end if;
  perform public._ctr_gestor(a.empresa_id);
  if length(coalesce(trim(p_motivo), '')) < 5 then raise exception 'Informe o motivo para excluir a cobrança.'; end if;
  if a.pago_em is not null then raise exception 'Cobrança paga não se exclui (desfaça a baixa antes, se foi engano).'; end if;
  delete from public.ctr_cobrancas where id = p_id;
  perform public._ctr_auditar('contratos_cobranca_excluida', jsonb_build_object('cobranca_id', p_id, 'motivo', trim(p_motivo),
    'cobranca', to_jsonb(a) || jsonb_build_object('cliente', (select apelido from public.ctr_clientes where id = a.cliente_id))), a.empresa_id);
  if a.contrato_id is not null then perform public._ctr_evento(a.contrato_id, 'Cobrança ' || a.competencia || ' excluída', trim(p_motivo)); end if;
end $$;

-- ---------------------------------------------------------------- extrato (OFX de qualquer banco) e conferência
create or replace function public.ctr_extrato_importar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_imp bigint; l jsonb; v_novos int := 0; v_rep int := 0; v_de date; v_ate date; v_conta text := coalesce(nullif(public._ctr_t(p, 'conta'), ''), 'banco');
  v_emp bigint := nullif(p ->> 'empresa_id', '')::bigint;
begin
  perform public._ctr_gestor(v_emp);
  if jsonb_typeof(p -> 'linhas') <> 'array' then raise exception 'Nenhum lançamento.'; end if;
  insert into public.ctr_importacoes (empresa_id, arquivo, conta, saldo_final, saldo_data)
  values (v_emp, coalesce(public._ctr_t(p, 'arquivo'), ''), v_conta, nullif(public._ctr_t(p, 'saldo_final'), '')::numeric, nullif(public._ctr_t(p, 'saldo_data'), '')::date)
  returning id into v_imp;
  for l in select * from jsonb_array_elements(p -> 'linhas') loop
    if (l ->> 'valor')::numeric <= 0 then continue; end if;
    if coalesce(l ->> 'chave', '') = '' or (l ->> 'data') is null then raise exception 'Lançamento sem data ou chave.'; end if;
    if exists (select 1 from public.ctr_extrato where empresa_id = v_emp and (chave = l ->> 'chave' or (coalesce(l ->> 'fitid', '') <> '' and conta = v_conta and fitid = l ->> 'fitid'))) then
      v_rep := v_rep + 1; continue;
    end if;
    insert into public.ctr_extrato (empresa_id, conta, data, valor, descricao, fitid, chave, importacao_id)
    values (v_emp, v_conta, (l ->> 'data')::date, (l ->> 'valor')::numeric, coalesce(l ->> 'descricao', ''), coalesce(l ->> 'fitid', ''), l ->> 'chave', v_imp);
    v_novos := v_novos + 1;
    v_de := least(v_de, (l ->> 'data')::date); v_ate := greatest(v_ate, (l ->> 'data')::date);
  end loop;
  update public.ctr_importacoes set novos = v_novos, repetidos = v_rep, de = v_de, ate = v_ate where id = v_imp;
  perform public._ctr_auditar('contratos_extrato_importado', jsonb_build_object('arquivo', public._ctr_t(p, 'arquivo'), 'conta', v_conta,
    'novos', v_novos, 'repetidos', v_rep, 'de', v_de, 'ate', v_ate), v_emp);
  return jsonb_build_object('importacao', v_imp, 'novos', v_novos, 'repetidos', v_rep);
end $$;

create or replace function public.ctr_conciliar(p_extrato bigint, p_cobrancas bigint[], p_obs text default '') returns void
language plpgsql security definer set search_path = public as $$
declare e public.ctr_extrato; v_soma numeric; v_n int; v_tol numeric; v_obs text := coalesce(trim(p_obs), '');
begin
  select * into e from public.ctr_extrato where id = p_extrato for update;
  if not found then raise exception 'Lançamento do extrato não encontrado.'; end if;
  perform public._ctr_gestor(e.empresa_id);
  v_tol := (select tolerancia from public.ctr_empresas where id = e.empresa_id);
  if e.ignorado_motivo <> '' then raise exception 'Este crédito foi marcado como "não é de contrato".'; end if;
  if exists (select 1 from public.ctr_cobrancas where extrato_id = p_extrato) then raise exception 'Este crédito já foi ligado a cobranças.'; end if;
  select count(*), sum(valor) into v_n, v_soma from public.ctr_cobrancas where id = any (p_cobrancas) and pago_em is null and empresa_id = e.empresa_id;
  if v_n = 0 or v_n <> coalesce(array_length(p_cobrancas, 1), 0) then raise exception 'Escolha cobranças em aberto desta empresa.'; end if;
  perform 1 from public.ctr_cobrancas where id = any (p_cobrancas) for update;
  if v_n > 1 and abs(v_soma - e.valor) > v_tol then
    raise exception 'A soma das cobranças (R$ %) não bate com o crédito (R$ %). Com valor diferente, ligue uma cobrança por vez.', v_soma, e.valor;
  end if;
  if v_n = 1 and abs(v_soma - e.valor) > v_tol and length(v_obs) < 3 then
    raise exception 'O crédito é diferente do valor cobrado: explique a diferença na observação.';
  end if;
  update public.ctr_cobrancas set pago_em = e.data, valor_pago = case when v_n = 1 then e.valor else valor end, extrato_id = e.id,
    nf_emitida = true, nf_data = coalesce(nf_data, e.data), obs = case when v_obs <> '' then v_obs else obs end
  where id = any (p_cobrancas);
  perform public._ctr_auditar('contratos_conciliado', jsonb_build_object('extrato_id', e.id, 'data', e.data, 'valor', e.valor, 'descricao', e.descricao,
    'obs', nullif(v_obs, ''),
    'cobrancas', (select jsonb_agg(jsonb_build_object('id', c.id, 'cliente', cl.apelido, 'competencia', c.competencia, 'valor', c.valor))
                    from public.ctr_cobrancas c join public.ctr_clientes cl on cl.id = c.cliente_id where c.id = any (p_cobrancas))), e.empresa_id);
end $$;

create or replace function public.ctr_extrato_ignorar(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.ctr_extrato;
begin
  select * into e from public.ctr_extrato where id = p_id for update;
  if not found then raise exception 'Lançamento do extrato não encontrado.'; end if;
  perform public._ctr_gestor(e.empresa_id);
  if exists (select 1 from public.ctr_cobrancas where extrato_id = p_id) then raise exception 'Este crédito já está ligado a cobranças.'; end if;
  update public.ctr_extrato set ignorado_motivo = coalesce(trim(p_motivo), '') where id = p_id;
  perform public._ctr_auditar('contratos_extrato_ignorado', jsonb_build_object('extrato_id', p_id, 'data', e.data, 'valor', e.valor, 'descricao', e.descricao,
    'antes', jsonb_build_object('ignorado', e.ignorado_motivo), 'depois', jsonb_build_object('ignorado', coalesce(trim(p_motivo), ''))), e.empresa_id);
end $$;

-- ---------------------------------------------------------------- carga da planilha: por empresa, só com ela vazia
create or replace function public.ctr_carga(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; cli jsonb := '{}'; kon jsonb := '{}'; v_id bigint; v_n int := 0; v_tot numeric := 0; v_pago numeric := 0;
  v_emp bigint := nullif(p ->> 'empresa_id', '')::bigint;
begin
  perform public._ctr_gestor(v_emp);
  if exists (select 1 from public.ctr_clientes where empresa_id = v_emp) or exists (select 1 from public.ctr_cobrancas where empresa_id = v_emp) then
    raise exception 'A carga só pode ser feita com a empresa vazia (ela já tem clientes ou cobranças).';
  end if;
  if jsonb_typeof(p -> 'config') = 'object' then perform public.ctr_empresa_salvar((p -> 'config') - 'ativo' - 'nome' || jsonb_build_object('id', v_emp)); end if;
  for x in select * from jsonb_array_elements(coalesce(p -> 'impostos', '[]')) loop
    insert into public.ctr_impostos (empresa_id, vale_desde, pct) values (v_emp, (x ->> 'desde')::date, (x ->> 'pct')::numeric)
      on conflict (empresa_id, vale_desde) do update set pct = excluded.pct;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'clientes', '[]')) loop
    insert into public.ctr_clientes (empresa_id, apelido, sigla, razao_social, cnpj, endereco, email_cobranca, resp_financeiro, extrato_textos, ativo, obs)
    values (v_emp, x ->> 'apelido', coalesce(x ->> 'sigla', ''), x ->> 'razao_social', public._ctr_doc(x ->> 'cnpj'), coalesce(x ->> 'endereco', ''),
      coalesce(x ->> 'email_cobranca', ''), coalesce(x ->> 'resp_financeiro', ''),
      coalesce((select array_agg(t) from jsonb_array_elements_text(coalesce(x -> 'extrato_textos', '[]')) t where t <> ''), '{}'),
      coalesce((x ->> 'ativo')::boolean, true), coalesce(x ->> 'obs', ''))
    returning id into v_id;
    cli := cli || jsonb_build_object(x ->> 'ref', v_id);
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'contratos', '[]')) loop
    if cli ->> (x ->> 'cliente_ref') is null then raise exception 'Carga: contrato de cliente desconhecido (%).', x ->> 'cliente_ref'; end if;
    insert into public.ctr_contratos (empresa_id, cliente_id, objeto, servicos_esp, inicio, fim, valor_mensal, dia_vencimento, parcela_extra, assinantes,
      testemunha1, testemunha1_doc, testemunha2, testemunha2_doc, local_assinatura, data_assinatura, situacao, gerado_em, encerrado_em, historico, obs)
    values (v_emp, (cli ->> (x ->> 'cliente_ref'))::bigint, coalesce(x ->> 'objeto', ''), coalesce(x ->> 'servicos_esp', ''), (x ->> 'inicio')::date, nullif(x ->> 'fim', '')::date,
      (x ->> 'valor_mensal')::numeric, coalesce((x ->> 'dia_vencimento')::int, 30), coalesce((x ->> 'parcela_extra')::boolean, true), coalesce(x ->> 'assinantes', ''),
      coalesce(x ->> 'testemunha1', ''), coalesce(x ->> 'testemunha1_doc', ''), coalesce(x ->> 'testemunha2', ''), coalesce(x ->> 'testemunha2_doc', ''),
      coalesce(nullif(x ->> 'local_assinatura', ''), 'Rio de Janeiro'), nullif(x ->> 'data_assinatura', '')::date, coalesce(x ->> 'situacao', 'gerado'),
      case when coalesce(x ->> 'situacao', 'gerado') <> 'rascunho' then nullif(x ->> 'inicio', '')::date end,
      case when x ->> 'situacao' in ('encerrado', 'rescindido') then nullif(x ->> 'fim', '')::date end,
      coalesce((x ->> 'historico')::boolean, false), coalesce(x ->> 'obs', ''))
    returning id into v_id;
    kon := kon || jsonb_build_object(x ->> 'ref', v_id);
    perform public._ctr_evento(v_id, 'Trazido da planilha ' || coalesce(nullif(p ->> 'arquivo', ''), ''), coalesce(x ->> 'obs', ''), least((x ->> 'inicio')::date, public._ctr_hoje()));
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'cobrancas', '[]')) loop
    if cli ->> (x ->> 'cliente_ref') is null then raise exception 'Carga: cobrança de cliente desconhecido (%).', x ->> 'cliente_ref'; end if;
    insert into public.ctr_cobrancas (empresa_id, cliente_id, contrato_id, competencia, descricao, vencimento, valor, nf_emitida, nf_data, pago_em, valor_pago, obs)
    values (v_emp, (cli ->> (x ->> 'cliente_ref'))::bigint, (kon ->> (x ->> 'contrato_ref'))::bigint, x ->> 'competencia', coalesce(x ->> 'descricao', ''),
      (x ->> 'vencimento')::date, (x ->> 'valor')::numeric, coalesce((x ->> 'nf_emitida')::boolean, false), null,
      nullif(x ->> 'pago_em', '')::date, nullif(x ->> 'valor_pago', '')::numeric, coalesce(x ->> 'obs', ''));
    v_n := v_n + 1; v_tot := v_tot + (x ->> 'valor')::numeric; v_pago := v_pago + coalesce(nullif(x ->> 'valor_pago', '')::numeric, 0);
  end loop;
  if p ? 'conferir' and (abs(v_tot - (p -> 'conferir' ->> 'cobrado')::numeric) > 0.01 or abs(v_pago - (p -> 'conferir' ->> 'pago')::numeric) > 0.01
                         or v_n <> (p -> 'conferir' ->> 'cobrancas')::int) then
    raise exception 'Carga: os totais gravados (% cobranças, cobrado %, pago %) não batem com a planilha.', v_n, v_tot, v_pago;
  end if;
  perform public._ctr_auditar('contratos_carga', jsonb_build_object('arquivo', p ->> 'arquivo', 'clientes', jsonb_array_length(coalesce(p -> 'clientes', '[]')),
    'contratos', jsonb_array_length(coalesce(p -> 'contratos', '[]')), 'cobrancas', v_n, 'cobrado', v_tot, 'pago', v_pago), v_emp);
  return jsonb_build_object('clientes', jsonb_array_length(coalesce(p -> 'clientes', '[]')), 'contratos', jsonb_array_length(coalesce(p -> 'contratos', '[]')),
    'cobrancas', v_n, 'cobrado', v_tot, 'pago', v_pago);
end $$;

do $$ declare f text; begin
  foreach f in array array['ctr_empresa_salvar(jsonb)', 'ctr_equipe(bigint)', 'ctr_membro_salvar(bigint, uuid, text)',
    'ctr_imposto_salvar(bigint, date, numeric)', 'ctr_imposto_excluir(bigint, date)', 'ctr_cliente_salvar(jsonb)',
    'ctr_modelo_salvar(jsonb)', 'ctr_contrato_salvar(jsonb)', 'ctr_contrato_etapa(bigint, text, date, text)', 'ctr_contrato_documento(bigint, text, text)',
    'ctr_contrato_renovar(bigint, jsonb)', 'ctr_cobrancas_gerar(bigint, date)', 'ctr_cobranca_avulsa(jsonb)', 'ctr_cobranca_salvar(jsonb)',
    'ctr_nf_marcar(jsonb)', 'ctr_baixa(jsonb)', 'ctr_baixa_desfazer(bigint, text)', 'ctr_cobranca_excluir(bigint, text)',
    'ctr_extrato_importar(jsonb)', 'ctr_conciliar(bigint, bigint[], text)', 'ctr_extrato_ignorar(bigint, text)', 'ctr_carga(jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- arquivos por empresa
-- ler: pasta <empresa> em que o login é membro, ou arquivo antigo (1.x) ligado a um modelo/contrato de empresa visível
-- enviar: só na pasta de empresa em que o login é gestor (ou equipe Nervia)
drop policy if exists ctr_arquivos_ler on storage.objects;
create policy ctr_arquivos_ler on storage.objects for select to authenticated using (bucket_id = 'ctr-arquivos' and (
  public.eh_admin()
  or (split_part(objects.name, '/', 1) ~ '^\d{1,18}$' and public.ctr_pode_ver(split_part(objects.name, '/', 1)::bigint))
  or exists (select 1 from public.ctr_modelos m where m.caminho = objects.name and public.ctr_pode_ver(m.empresa_id))
  or exists (select 1 from public.ctr_contratos k where k.documento = objects.name and public.ctr_pode_ver(k.empresa_id))));
drop policy if exists ctr_arquivos_enviar on storage.objects;
create policy ctr_arquivos_enviar on storage.objects for insert to authenticated with check (bucket_id = 'ctr-arquivos' and (
  public.eh_admin()
  or (split_part(objects.name, '/', 1) ~ '^\d{1,18}$' and public.ctr_eh_gestor(split_part(objects.name, '/', 1)::bigint))));

-- ---------------------------------------------------------------- vitrine: disponível para contratar (sem demonstração e sem preço públicos)
update public.apps set situacao = 'disponivel',
  descricao = 'Contratos de prestação de serviço da sua empresa, do contrato ao recebimento: gera o contrato pelo seu modelo do Word, acompanha envio e assinatura, cria as cobranças do mês, controla as notas fiscais e confere os recebimentos com o extrato do banco.'
where id = 'contratos';
