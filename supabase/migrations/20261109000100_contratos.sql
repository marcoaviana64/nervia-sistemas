-- App "Contratos" (prefixo ctr_): contratos de prestação de serviço da Nervia com os clientes, do contrato ao recebimento.
-- Pedido do Marco em 09/11/2026: trocar a planilha ContratoDados.xlsx (mala direta do Word + conferência de
-- recebimentos + resumo gerencial) por um app do ecossistema, só para uso da Nervia.
--
-- Decisões do Marco (09/11/2026):
--   * só a equipe Nervia (admin) vê e mexe; fora da vitrine;
--   * o contrato continua sendo assinado pelo DocuSign: o app gera o Word pelo modelo de mala direta, registra
--     enviado/assinado e guarda o PDF assinado (bucket privado ctr-arquivos);
--   * a NF de cada mês deve ser emitida até o dia 5 (ctr_config.dia_nf); o número da NF é opcional;
--   * imposto em média 16%, configurável por período (ctr_impostos); a planilha usava 16,5%;
--   * o recebimento é conferido com o extrato OFX do Nubank (ctr_extrato: só os CRÉDITOS vão para o banco);
--   * a carga traz todo o histórico da planilha (desde 04/2024, inclusive os clientes antigos), pela tela (ctr_carga).
--
-- Regras:
--   * a tela só LÊ; toda escrita é por função (security definer, só admin) e vai para a auditoria (contratos_*);
--   * ctr_eventos (histórico de cada contrato) é SOMENTE INCLUSÃO;
--   * cobrança paga não se altera nem se apaga (desfazer a baixa exige motivo); cobrança aberta só se apaga com motivo;
--   * mais de uma cobrança no mesmo mês é permitido (ex.: complemento de reajuste, como em 01/2025 na planilha);
--   * a parcela extra de dezembro (cláusula 3.1) tem competência AAAA/13; num ano incompleto ela é proporcional
--     aos meses do contrato naquele ano (valor × meses ÷ 12), e pode ser ajustada antes do pagamento;
--   * situação da cobrança (a vencer, atrasada, paga, paga com atraso, diferença) e situação da NF são calculadas
--     na view ctr_cobrancas_v (diferença = mais que a tolerância, padrão R$ 0,05).

-- ---------------------------------------------------------------- tabelas
create table if not exists public.ctr_config (
  id                 int primary key default 1 check (id = 1),
  contratada_nome    text not null default '',
  contratada_cnpj    text not null default '',
  contratada_endereco text not null default '',
  contratada_junta   text not null default '',     -- "Rio de Janeiro sob o número …" (campo CTRA-JUNTA)
  contratada_email   text not null default '',
  servicos_esp       text not null default 'de Tecnologia da Informação',
  dia_nf             int not null default 5 check (dia_nf between 1 and 28),
  tolerancia         numeric(8,2) not null default 0.05 check (tolerancia >= 0),
  atualizado_em      timestamptz
);
insert into public.ctr_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.ctr_impostos (
  vale_desde date primary key,
  pct        numeric(5,2) not null check (pct >= 0 and pct < 100),
  criado_em  timestamptz not null default now()
);

create table if not exists public.ctr_clientes (
  id              bigint generated always as identity primary key,
  apelido         text not null check (length(trim(apelido)) > 0),   -- nome curto usado nas listas
  sigla           text not null default '',
  razao_social    text not null check (length(trim(razao_social)) > 0),
  cnpj            text check (cnpj ~ '^(\d{11}|\d{14})$'),           -- só dígitos (CNPJ ou CPF); vazio nos antigos
  endereco        text not null default '',
  email_cobranca  text not null default '',
  resp_financeiro text not null default '',                          -- campo RESP-FINAN do contrato
  extrato_textos  text[] not null default '{}',                      -- trechos que aparecem no extrato (conferência)
  ativo           boolean not null default true,
  obs             text not null default '',
  criado_em       timestamptz not null default now()
);
create unique index if not exists ctr_clientes_apelido on public.ctr_clientes (lower(apelido));
create unique index if not exists ctr_clientes_cnpj on public.ctr_clientes (cnpj) where cnpj is not null;

create table if not exists public.ctr_modelos (
  id        bigint generated always as identity primary key,
  nome      text not null,
  caminho   text not null,            -- bucket ctr-arquivos
  campos    text[] not null default '{}',
  padrao    boolean not null default false,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid()
);
create unique index if not exists ctr_modelos_padrao on public.ctr_modelos (padrao) where padrao;

create table if not exists public.ctr_contratos (
  id               bigint generated always as identity primary key,
  cliente_id       bigint not null references public.ctr_clientes,
  modelo_id        bigint references public.ctr_modelos,   -- vazio = o modelo padrão
  objeto           text not null default '',                -- campo CTRA-PRESTACAO
  servicos_esp     text not null default '',                -- campo CTRA-SERVICOSESP (vazio = o da configuração)
  inicio           date not null,
  fim              date,                                    -- vazio = prazo indeterminado
  valor_mensal     numeric(12,2) not null check (valor_mensal > 0),
  dia_vencimento   int not null default 30 check (dia_vencimento between 1 and 31),
  parcela_extra    boolean not null default true,           -- contraprestação extra em dezembro (cláusula 3.1)
  assinantes       text not null default '',                -- e-mails de quem assina pelo cliente (CTT-EMAIL)
  testemunha1      text not null default '', testemunha1_doc text not null default '',
  testemunha2      text not null default '', testemunha2_doc text not null default '',
  local_assinatura text not null default 'Rio de Janeiro',
  data_assinatura  date,                                    -- vazio = a data de início
  situacao         text not null default 'rascunho'
                   check (situacao in ('rascunho', 'gerado', 'enviado', 'assinado', 'encerrado', 'rescindido')),
  gerado_em        date, enviado_em date, assinado_em date, encerrado_em date,
  motivo_encerramento text not null default '',
  documento        text,                                    -- PDF assinado (bucket ctr-arquivos)
  anterior_id      bigint references public.ctr_contratos,  -- renovação de
  historico        boolean not null default false,          -- veio da carga da planilha (contrato anterior)
  obs              text not null default '',
  criado_em        timestamptz not null default now(),
  criado_por       uuid default auth.uid(),
  atualizado_em    timestamptz,
  check (fim is null or fim >= inicio)
);
create index if not exists ctr_contratos_cliente on public.ctr_contratos (cliente_id, inicio);

create table if not exists public.ctr_eventos (
  id          bigint generated always as identity primary key,
  contrato_id bigint not null references public.ctr_contratos,
  data        date not null,
  evento      text not null,
  detalhe     text not null default '',
  criado_em   timestamptz not null default now(),
  criado_por  uuid default auth.uid(),
  criado_nome text not null default ''
);
create index if not exists ctr_eventos_contrato on public.ctr_eventos (contrato_id, id);

create table if not exists public.ctr_importacoes (
  id          bigint generated always as identity primary key,
  arquivo     text not null default '',
  conta       text not null default 'nubank',
  de          date, ate date,
  novos       int not null default 0,
  repetidos   int not null default 0,
  saldo_final numeric(14,2), saldo_data date,
  criado_em   timestamptz not null default now(),
  criado_por  uuid default auth.uid()
);

create table if not exists public.ctr_extrato (
  id             bigint generated always as identity primary key,
  conta          text not null default 'nubank',
  data           date not null,
  valor          numeric(12,2) not null check (valor > 0),   -- só créditos
  descricao      text not null default '',
  fitid          text not null default '',
  chave          text not null unique,
  importacao_id  bigint references public.ctr_importacoes,
  ignorado_motivo text not null default '',                  -- crédito que não é de contrato
  criado_em      timestamptz not null default now()
);
create unique index if not exists ctr_extrato_fitid on public.ctr_extrato (conta, fitid) where fitid <> '';
create index if not exists ctr_extrato_data on public.ctr_extrato (data);

create table if not exists public.ctr_cobrancas (
  id          bigint generated always as identity primary key,
  cliente_id  bigint not null references public.ctr_clientes,
  contrato_id bigint references public.ctr_contratos,       -- vazio = cobrança avulsa
  competencia text not null check (competencia ~ '^\d{4}/(0[1-9]|1[0-3])$'),   -- AAAA/13 = parcela extra de dezembro
  descricao   text not null default '',
  vencimento  date not null,
  valor       numeric(12,2) not null check (valor > 0),
  nf_emitida  boolean not null default false,
  nf_numero   text not null default '',
  nf_data     date,
  pago_em     date,
  valor_pago  numeric(12,2) check (valor_pago >= 0),
  extrato_id  bigint references public.ctr_extrato,
  obs         text not null default '',
  criado_em   timestamptz not null default now(),
  check ((pago_em is null) = (valor_pago is null)),
  check (extrato_id is null or pago_em is not null)
);
create index if not exists ctr_cobrancas_comp on public.ctr_cobrancas (competencia, cliente_id);
create index if not exists ctr_cobrancas_contrato on public.ctr_cobrancas (contrato_id, competencia);
create index if not exists ctr_cobrancas_extrato on public.ctr_cobrancas (extrato_id);

-- ---------------------------------------------------------------- ajudantes
create or replace function public._ctr_hoje() returns date
language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

create or replace function public._ctr_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia usa o app Contratos.'; end if;
end $$;
revoke execute on function public._ctr_admin() from public, anon, authenticated;

-- texto do jsonb sem espaços nas pontas; ausente = null
create or replace function public._ctr_t(p jsonb, k text) returns text
language sql immutable as $$ select case when p ? k and jsonb_typeof(p -> k) <> 'null' then trim(p ->> k) end $$;

create or replace function public._ctr_doc(p text) returns text
language sql immutable as $$ select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '') $$;

-- auditoria com só os campos que mudaram (mesma ideia do _atd_auditar); sem mudança, não registra
create or replace function public._ctr_auditar(p_acao text, p_det jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a jsonb := p_det -> 'antes'; d jsonb := p_det -> 'depois'; na jsonb := '{}'; nd jsonb := '{}'; k text;
begin
  if jsonb_typeof(a) = 'object' and jsonb_typeof(d) = 'object' then
    for k in select jsonb_object_keys(a || d) loop
      if (a -> k) is distinct from (d -> k) then
        na := na || jsonb_build_object(k, coalesce(a -> k, 'null'::jsonb));
        nd := nd || jsonb_build_object(k, coalesce(d -> k, 'null'::jsonb));
      end if;
    end loop;
    if na = '{}' then return; end if;
    p_det := p_det || jsonb_build_object('antes', na, 'depois', nd);
  end if;
  perform public.auditar(p_acao, null, coalesce(p_det, '{}'::jsonb));
end $$;
revoke execute on function public._ctr_auditar(text, jsonb) from public, anon, authenticated;

create or replace function public._ctr_evento(p_contrato bigint, p_evento text, p_detalhe text default '', p_data date default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ctr_eventos (contrato_id, data, evento, detalhe, criado_nome)
  values (p_contrato, coalesce(p_data, public._ctr_hoje()), p_evento, coalesce(p_detalhe, ''),
          coalesce((select coalesce(nullif(nome, ''), email) from public.perfis where user_id = auth.uid()), 'sistema'));
end $$;
revoke execute on function public._ctr_evento(bigint, text, text, date) from public, anon, authenticated;

create or replace function public._ctr_fixo() returns trigger
language plpgsql as $$
begin raise exception 'O histórico do contrato não pode ser alterado nem apagado.'; end $$;
drop trigger if exists ctr_eventos_fixo on public.ctr_eventos;
create trigger ctr_eventos_fixo before update or delete on public.ctr_eventos
  for each row execute function public._ctr_fixo();

create or replace function public._ctr_contrato_nome(p_id bigint) returns text
language sql stable security definer set search_path = public as $$
  select c.apelido || ' · ' || to_char(k.inicio, 'DD/MM/YYYY') || coalesce(' a ' || to_char(k.fim, 'DD/MM/YYYY'), ' (indeterminado)')
    from public.ctr_contratos k join public.ctr_clientes c on c.id = k.cliente_id where k.id = p_id
$$;
revoke execute on function public._ctr_contrato_nome(bigint) from public, anon, authenticated;

-- alíquota de imposto vigente numa data (a mais recente com vale_desde <= data); sem cadastro = 0
create or replace function public.ctr_aliquota(p_data date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select pct from public.ctr_impostos where vale_desde <= p_data order by vale_desde desc limit 1), 0)
$$;
revoke execute on function public.ctr_aliquota(date) from public, anon;
grant execute on function public.ctr_aliquota(date) to authenticated;

-- ---------------------------------------------------------------- acesso: só a equipe Nervia
alter table public.ctr_config enable row level security;
alter table public.ctr_impostos enable row level security;
alter table public.ctr_clientes enable row level security;
alter table public.ctr_modelos enable row level security;
alter table public.ctr_contratos enable row level security;
alter table public.ctr_eventos enable row level security;
alter table public.ctr_importacoes enable row level security;
alter table public.ctr_extrato enable row level security;
alter table public.ctr_cobrancas enable row level security;

revoke all on public.ctr_config, public.ctr_impostos, public.ctr_clientes, public.ctr_modelos, public.ctr_contratos,
  public.ctr_eventos, public.ctr_importacoes, public.ctr_extrato, public.ctr_cobrancas from anon;
revoke insert, update, delete, truncate on public.ctr_config, public.ctr_impostos, public.ctr_clientes, public.ctr_modelos,
  public.ctr_contratos, public.ctr_eventos, public.ctr_importacoes, public.ctr_extrato, public.ctr_cobrancas from authenticated;
grant select on public.ctr_config, public.ctr_impostos, public.ctr_clientes, public.ctr_modelos, public.ctr_contratos,
  public.ctr_eventos, public.ctr_importacoes, public.ctr_extrato, public.ctr_cobrancas to authenticated;

do $$ declare t text; begin
  foreach t in array array['ctr_config','ctr_impostos','ctr_clientes','ctr_modelos','ctr_contratos','ctr_eventos','ctr_importacoes','ctr_extrato','ctr_cobrancas'] loop
    execute format('drop policy if exists %1$s_ler on public.%1$s', t);
    execute format('create policy %1$s_ler on public.%1$s for select using (public.eh_admin())', t);
  end loop;
end $$;

-- cobranças com situação, imposto e prazo da NF calculados
create or replace view public.ctr_cobrancas_v with (security_invoker = true) as
select c.*, cl.apelido as cliente, k.situacao as contrato_situacao,
  public.ctr_aliquota(coalesce(c.pago_em, c.vencimento)) as imposto_pct,
  round(coalesce(c.valor_pago, 0) * public.ctr_aliquota(coalesce(c.pago_em, c.vencimento)) / 100, 2) as imposto,
  coalesce(c.valor_pago, 0) - round(coalesce(c.valor_pago, 0) * public.ctr_aliquota(coalesce(c.pago_em, c.vencimento)) / 100, 2) as liquido,
  make_date(left(c.competencia, 4)::int, least(right(c.competencia, 2)::int, 12), cf.dia_nf) as nf_prazo,
  case when c.pago_em is null then case when c.vencimento >= public._ctr_hoje() then 'a_vencer' else 'atrasada' end
       when abs(c.valor_pago - c.valor) > cf.tolerancia then 'diferenca'
       when c.pago_em <= c.vencimento then 'paga' else 'paga_atraso' end as situacao,
  case when c.nf_emitida then 'emitida'
       when public._ctr_hoje() > make_date(left(c.competencia, 4)::int, least(right(c.competencia, 2)::int, 12), cf.dia_nf) then 'atrasada'
       else 'pendente' end as nf_situacao,
  case when c.pago_em is null and c.vencimento < public._ctr_hoje() then public._ctr_hoje() - c.vencimento else 0 end as dias_atraso
from public.ctr_cobrancas c
join public.ctr_clientes cl on cl.id = c.cliente_id
left join public.ctr_contratos k on k.id = c.contrato_id
cross join public.ctr_config cf;
revoke all on public.ctr_cobrancas_v from anon;
grant select on public.ctr_cobrancas_v to authenticated;

-- ---------------------------------------------------------------- configuração e impostos
create or replace function public.ctr_config_salvar(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a public.ctr_config; d public.ctr_config;
begin
  perform public._ctr_admin();
  select * into a from public.ctr_config where id = 1;
  update public.ctr_config set
    contratada_nome = coalesce(public._ctr_t(p, 'contratada_nome'), contratada_nome),
    contratada_cnpj = coalesce(public._ctr_t(p, 'contratada_cnpj'), contratada_cnpj),
    contratada_endereco = coalesce(public._ctr_t(p, 'contratada_endereco'), contratada_endereco),
    contratada_junta = coalesce(public._ctr_t(p, 'contratada_junta'), contratada_junta),
    contratada_email = coalesce(public._ctr_t(p, 'contratada_email'), contratada_email),
    servicos_esp = coalesce(public._ctr_t(p, 'servicos_esp'), servicos_esp),
    dia_nf = coalesce(public._ctr_t(p, 'dia_nf')::int, dia_nf),
    tolerancia = coalesce(public._ctr_t(p, 'tolerancia')::numeric, tolerancia),
    atualizado_em = now()
  where id = 1 returning * into d;
  perform public._ctr_auditar('contratos_config_alterada', jsonb_build_object('antes', to_jsonb(a) - 'atualizado_em', 'depois', to_jsonb(d) - 'atualizado_em'));
end $$;

create or replace function public.ctr_imposto_salvar(p_desde date, p_pct numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_antes numeric;
begin
  perform public._ctr_admin();
  if p_desde is null or p_pct is null or p_pct < 0 or p_pct >= 100 then raise exception 'Informe a data e a alíquota (0 a 99,99%%).'; end if;
  select pct into v_antes from public.ctr_impostos where vale_desde = p_desde;
  insert into public.ctr_impostos (vale_desde, pct) values (p_desde, p_pct)
    on conflict (vale_desde) do update set pct = excluded.pct;
  perform public._ctr_auditar('contratos_imposto_salvo', jsonb_build_object('vale_desde', p_desde, 'antes', jsonb_build_object('pct', v_antes), 'depois', jsonb_build_object('pct', p_pct)));
end $$;

create or replace function public.ctr_imposto_excluir(p_desde date) returns void
language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  perform public._ctr_admin();
  delete from public.ctr_impostos where vale_desde = p_desde returning pct into v;
  if not found then raise exception 'Alíquota não encontrada.'; end if;
  perform public._ctr_auditar('contratos_imposto_excluido', jsonb_build_object('vale_desde', p_desde, 'pct', v));
end $$;

-- ---------------------------------------------------------------- clientes
create or replace function public.ctr_cliente_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p ->> 'id', '')::bigint; a public.ctr_clientes; d public.ctr_clientes; v_doc text;
begin
  perform public._ctr_admin();
  v_doc := public._ctr_doc(p ->> 'cnpj');
  if p ? 'cnpj' and v_doc is not null and length(v_doc) not in (11, 14) then raise exception 'CNPJ (14 dígitos) ou CPF (11 dígitos) inválido.'; end if;
  if v_id is null then
    if coalesce(public._ctr_t(p, 'apelido'), '') = '' or coalesce(public._ctr_t(p, 'razao_social'), '') = '' then
      raise exception 'Informe o nome curto e a razão social do cliente.';
    end if;
    if exists (select 1 from public.ctr_clientes where lower(apelido) = lower(public._ctr_t(p, 'apelido'))) then raise exception 'Já existe um cliente com o nome %.', public._ctr_t(p, 'apelido'); end if;
    if v_doc is not null and exists (select 1 from public.ctr_clientes where cnpj = v_doc) then raise exception 'Já existe um cliente com este CNPJ.'; end if;
    insert into public.ctr_clientes (apelido, sigla, razao_social, cnpj, endereco, email_cobranca, resp_financeiro, extrato_textos, obs)
    values (public._ctr_t(p, 'apelido'), coalesce(public._ctr_t(p, 'sigla'), ''), public._ctr_t(p, 'razao_social'), v_doc,
            coalesce(public._ctr_t(p, 'endereco'), ''), coalesce(public._ctr_t(p, 'email_cobranca'), ''), coalesce(public._ctr_t(p, 'resp_financeiro'), ''),
            coalesce((select array_agg(trim(x)) from jsonb_array_elements_text(case when jsonb_typeof(p -> 'extrato_textos') = 'array' then p -> 'extrato_textos' else '[]' end) x where trim(x) <> ''), '{}'),
            coalesce(public._ctr_t(p, 'obs'), ''))
    returning * into d;
    perform public._ctr_auditar('contratos_cliente_criado', jsonb_build_object('cliente', d.apelido, 'razao_social', d.razao_social, 'cnpj', d.cnpj));
    return d.id;
  end if;
  select * into a from public.ctr_clientes where id = v_id;
  if not found then raise exception 'Cliente não encontrado.'; end if;
  if p ? 'apelido' and exists (select 1 from public.ctr_clientes where lower(apelido) = lower(public._ctr_t(p, 'apelido')) and id <> v_id) then
    raise exception 'Já existe um cliente com o nome %.', public._ctr_t(p, 'apelido');
  end if;
  if p ? 'cnpj' and v_doc is not null and exists (select 1 from public.ctr_clientes where cnpj = v_doc and id <> v_id) then raise exception 'Já existe um cliente com este CNPJ.'; end if;
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
    obs = coalesce(public._ctr_t(p, 'obs'), obs)
  where id = v_id returning * into d;
  perform public._ctr_auditar('contratos_cliente_alterado', jsonb_build_object('cliente', d.apelido, 'antes', to_jsonb(a) - 'criado_em', 'depois', to_jsonb(d) - 'criado_em'));
  return v_id;
end $$;

-- ---------------------------------------------------------------- modelos do contrato (arquivo .docx no bucket)
create or replace function public.ctr_modelo_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform public._ctr_admin();
  if coalesce(public._ctr_t(p, 'caminho'), '') !~ '^modelos/[^/]+\.docx$' then raise exception 'Caminho do modelo inválido.'; end if;
  update public.ctr_modelos set padrao = false where padrao;
  insert into public.ctr_modelos (nome, caminho, campos, padrao)
  values (coalesce(nullif(public._ctr_t(p, 'nome'), ''), 'Modelo'), public._ctr_t(p, 'caminho'),
          coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p -> 'campos') = 'array' then p -> 'campos' else '[]' end) x), '{}'), true)
  returning id into v_id;
  perform public._ctr_auditar('contratos_modelo_enviado', jsonb_build_object('modelo', public._ctr_t(p, 'nome'), 'caminho', public._ctr_t(p, 'caminho'), 'campos', p -> 'campos'));
  return v_id;
end $$;

-- ---------------------------------------------------------------- contratos
create or replace function public.ctr_contrato_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p ->> 'id', '')::bigint; a public.ctr_contratos; d public.ctr_contratos; v_mot text := coalesce(public._ctr_t(p, 'motivo'), '');
begin
  perform public._ctr_admin();
  if v_id is null then
    if not exists (select 1 from public.ctr_clientes where id = (p ->> 'cliente_id')::bigint) then raise exception 'Escolha o cliente.'; end if;
    if public._ctr_t(p, 'inicio') is null then raise exception 'Informe o início do contrato.'; end if;
    if coalesce(public._ctr_t(p, 'valor_mensal')::numeric, 0) <= 0 then raise exception 'Informe o valor mensal.'; end if;
    insert into public.ctr_contratos (cliente_id, modelo_id, objeto, servicos_esp, inicio, fim, valor_mensal, dia_vencimento, parcela_extra, assinantes,
      testemunha1, testemunha1_doc, testemunha2, testemunha2_doc, local_assinatura, data_assinatura, obs)
    values ((p ->> 'cliente_id')::bigint, nullif(p ->> 'modelo_id', '')::bigint, coalesce(public._ctr_t(p, 'objeto'), ''), coalesce(public._ctr_t(p, 'servicos_esp'), ''),
      public._ctr_t(p, 'inicio')::date, nullif(public._ctr_t(p, 'fim'), '')::date, public._ctr_t(p, 'valor_mensal')::numeric,
      coalesce(nullif(public._ctr_t(p, 'dia_vencimento'), '')::int, 30), coalesce((p ->> 'parcela_extra')::boolean, true), coalesce(public._ctr_t(p, 'assinantes'), ''),
      coalesce(public._ctr_t(p, 'testemunha1'), ''), coalesce(public._ctr_t(p, 'testemunha1_doc'), ''),
      coalesce(public._ctr_t(p, 'testemunha2'), ''), coalesce(public._ctr_t(p, 'testemunha2_doc'), ''),
      coalesce(nullif(public._ctr_t(p, 'local_assinatura'), ''), 'Rio de Janeiro'), nullif(public._ctr_t(p, 'data_assinatura'), '')::date, coalesce(public._ctr_t(p, 'obs'), ''))
    returning * into d;
    perform public._ctr_evento(d.id, 'Contrato criado (rascunho)', format('Valor mensal R$ %s', to_char(d.valor_mensal, 'FM999G999G990D00')));
    perform public._ctr_auditar('contratos_contrato_criado', jsonb_build_object('contrato', public._ctr_contrato_nome(d.id), 'contrato_id', d.id, 'valor_mensal', d.valor_mensal));
    return d.id;
  end if;
  select * into a from public.ctr_contratos where id = v_id for update;
  if not found then raise exception 'Contrato não encontrado.'; end if;
  if p ? 'cliente_id' and (p ->> 'cliente_id')::bigint <> a.cliente_id and exists (select 1 from public.ctr_cobrancas where contrato_id = v_id) then
    raise exception 'O contrato já tem cobranças: o cliente não pode mudar.';
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
  -- depois de assinado, mudar valor, prazo ou vencimento só com motivo (normalmente é um aditivo)
  if a.situacao in ('assinado', 'encerrado', 'rescindido')
     and (a.valor_mensal, a.inicio, a.fim, a.dia_vencimento, a.parcela_extra) is distinct from (d.valor_mensal, d.inicio, d.fim, d.dia_vencimento, d.parcela_extra) then
    if length(v_mot) < 5 then raise exception 'O contrato já foi assinado: para mudar valor, prazo ou vencimento, informe o motivo (ex.: aditivo assinado em …).'; end if;
    perform public._ctr_evento(v_id, 'Alterado depois da assinatura', v_mot);
  end if;
  perform public._ctr_auditar('contratos_contrato_alterado', jsonb_build_object('contrato', public._ctr_contrato_nome(v_id), 'contrato_id', v_id,
    'motivo', nullif(v_mot, ''), 'antes', to_jsonb(a) - 'atualizado_em', 'depois', to_jsonb(d) - 'atualizado_em'));
  return v_id;
end $$;

-- etapas: gerado | enviado | assinado | encerrado | rescindido | voltar (desfaz a última etapa, com motivo)
create or replace function public.ctr_contrato_etapa(p_id bigint, p_etapa text, p_data date default null, p_obs text default '') returns text
language plpgsql security definer set search_path = public as $$
declare k public.ctr_contratos; v_data date := coalesce(p_data, public._ctr_hoje()); v_nova text; v_obs text := coalesce(trim(p_obs), '');
begin
  perform public._ctr_admin();
  select * into k from public.ctr_contratos where id = p_id for update;
  if not found then raise exception 'Contrato não encontrado.'; end if;
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
    'etapa', p_etapa, 'data', v_data, 'obs', nullif(v_obs, ''), 'antes', jsonb_build_object('situacao', k.situacao), 'depois', jsonb_build_object('situacao', v_nova)));
  return v_nova;
end $$;

create or replace function public.ctr_contrato_documento(p_id bigint, p_caminho text, p_nome text default '') returns void
language plpgsql security definer set search_path = public as $$
declare v_antes text;
begin
  perform public._ctr_admin();
  if coalesce(p_caminho, '') !~ ('^contratos/' || p_id || '/[^/]+\.pdf$') then raise exception 'Caminho do PDF inválido.'; end if;
  select documento into v_antes from public.ctr_contratos where id = p_id for update;
  if not found then raise exception 'Contrato não encontrado.'; end if;
  update public.ctr_contratos set documento = p_caminho where id = p_id;
  perform public._ctr_evento(p_id, case when v_antes is null then 'PDF assinado guardado' else 'PDF assinado substituído' end, coalesce(p_nome, ''));
  perform public._ctr_auditar('contratos_documento', jsonb_build_object('contrato', public._ctr_contrato_nome(p_id), 'contrato_id', p_id, 'arquivo', p_nome,
    'antes', jsonb_build_object('documento', v_antes), 'depois', jsonb_build_object('documento', p_caminho)));
end $$;

-- renovação: contrato novo (rascunho) com os mesmos dados, novo prazo e valor
create or replace function public.ctr_contrato_renovar(p_id bigint, p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare k public.ctr_contratos; v_novo bigint;
begin
  perform public._ctr_admin();
  select * into k from public.ctr_contratos where id = p_id;
  if not found then raise exception 'Contrato não encontrado.'; end if;
  if public._ctr_t(p, 'inicio') is null then raise exception 'Informe o início do novo contrato.'; end if;
  if k.fim is not null and public._ctr_t(p, 'inicio')::date <= k.fim and coalesce((p ->> 'sobrepor')::boolean, false) is false then
    raise exception 'O novo contrato começa antes do fim do atual (%).', to_char(k.fim, 'DD/MM/YYYY');
  end if;
  insert into public.ctr_contratos (cliente_id, modelo_id, objeto, servicos_esp, inicio, fim, valor_mensal, dia_vencimento, parcela_extra, assinantes,
    testemunha1, testemunha1_doc, testemunha2, testemunha2_doc, local_assinatura, anterior_id)
  values (k.cliente_id, k.modelo_id, k.objeto, k.servicos_esp, public._ctr_t(p, 'inicio')::date, nullif(public._ctr_t(p, 'fim'), '')::date,
    coalesce(nullif(public._ctr_t(p, 'valor_mensal'), '')::numeric, k.valor_mensal), k.dia_vencimento, k.parcela_extra, k.assinantes,
    k.testemunha1, k.testemunha1_doc, k.testemunha2, k.testemunha2_doc, k.local_assinatura, k.id)
  returning id into v_novo;
  perform public._ctr_evento(v_novo, 'Renovação do contrato anterior (rascunho)', public._ctr_contrato_nome(k.id));
  perform public._ctr_evento(k.id, 'Renovado', public._ctr_contrato_nome(v_novo));
  perform public._ctr_auditar('contratos_renovado', jsonb_build_object('contrato', public._ctr_contrato_nome(v_novo), 'contrato_id', v_novo, 'anterior_id', k.id,
    'antes', jsonb_build_object('valor_mensal', k.valor_mensal), 'depois', jsonb_build_object('valor_mensal', (select valor_mensal from public.ctr_contratos where id = v_novo))));
  return v_novo;
end $$;

-- ---------------------------------------------------------------- cobranças
-- gera as cobranças mensais (e a parcela extra de dezembro) que faltam, do início até p_ate (padrão: o fim do contrato,
-- ou 31/12 do ano corrente se for por prazo indeterminado); não repete competência que o contrato já tem
create or replace function public.ctr_cobrancas_gerar(p_contrato bigint, p_ate date default null) returns int
language plpgsql security definer set search_path = public as $$
declare k public.ctr_contratos; v_fim date; m date; v_n int := 0; v_meses int; v_comp text; v_venc date;
begin
  perform public._ctr_admin();
  select * into k from public.ctr_contratos where id = p_contrato for update;
  if not found then raise exception 'Contrato não encontrado.'; end if;
  if k.situacao = 'rascunho' then raise exception 'Gere o contrato (Word) antes de criar as cobranças.'; end if;
  v_fim := coalesce(p_ate, k.fim, make_date(extract(year from public._ctr_hoje())::int, 12, 31));
  v_fim := least(v_fim, coalesce(k.fim, v_fim), coalesce(k.encerrado_em, v_fim));
  m := date_trunc('month', k.inicio)::date;
  while m <= v_fim loop
    v_comp := to_char(m, 'YYYY/MM');
    v_venc := make_date(extract(year from m)::int, extract(month from m)::int,
                        least(k.dia_vencimento, extract(day from (m + interval '1 month - 1 day'))::int));
    if not exists (select 1 from public.ctr_cobrancas where contrato_id = k.id and competencia = v_comp) then
      insert into public.ctr_cobrancas (cliente_id, contrato_id, competencia, vencimento, valor) values (k.cliente_id, k.id, v_comp, v_venc, k.valor_mensal);
      v_n := v_n + 1;
    end if;
    -- parcela extra de dezembro: proporcional aos meses do contrato naquele ano
    if extract(month from m) = 12 and k.parcela_extra then
      v_comp := to_char(m, 'YYYY') || '/13';
      v_meses := 12 - extract(month from greatest(k.inicio, make_date(extract(year from m)::int, 1, 1)))::int + 1;
      if not exists (select 1 from public.ctr_cobrancas where contrato_id = k.id and competencia = v_comp) then
        insert into public.ctr_cobrancas (cliente_id, contrato_id, competencia, vencimento, valor, descricao)
        values (k.cliente_id, k.id, v_comp, v_venc, round(k.valor_mensal * v_meses / 12, 2),
                case when v_meses < 12 then format('Parcela extra proporcional (%s/12)', v_meses) else 'Parcela extra de dezembro' end);
        v_n := v_n + 1;
      end if;
    end if;
    m := (m + interval '1 month')::date;
  end loop;
  if v_n > 0 then
    perform public._ctr_evento(k.id, format('%s cobrança(s) criada(s)', v_n), 'até ' || to_char(v_fim, 'MM/YYYY'));
    perform public._ctr_auditar('contratos_cobrancas_geradas', jsonb_build_object('contrato', public._ctr_contrato_nome(k.id), 'contrato_id', k.id, 'quantidade', v_n, 'ate', v_fim));
  end if;
  return v_n;
end $$;

create or replace function public.ctr_cobranca_avulsa(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_cli bigint := (p ->> 'cliente_id')::bigint; v_k bigint := nullif(p ->> 'contrato_id', '')::bigint;
begin
  perform public._ctr_admin();
  if not exists (select 1 from public.ctr_clientes where id = v_cli) then raise exception 'Escolha o cliente.'; end if;
  if v_k is not null and not exists (select 1 from public.ctr_contratos where id = v_k and cliente_id = v_cli) then raise exception 'O contrato não é deste cliente.'; end if;
  if coalesce(public._ctr_t(p, 'valor')::numeric, 0) <= 0 then raise exception 'Informe o valor.'; end if;
  if public._ctr_t(p, 'vencimento') is null then raise exception 'Informe o vencimento.'; end if;
  if coalesce(public._ctr_t(p, 'descricao'), '') = '' then raise exception 'Descreva a cobrança (ex.: projeto, visita extra).'; end if;
  insert into public.ctr_cobrancas (cliente_id, contrato_id, competencia, vencimento, valor, descricao)
  values (v_cli, v_k, coalesce(nullif(public._ctr_t(p, 'competencia'), ''), to_char(public._ctr_t(p, 'vencimento')::date, 'YYYY/MM')),
          public._ctr_t(p, 'vencimento')::date, public._ctr_t(p, 'valor')::numeric, public._ctr_t(p, 'descricao'))
  returning id into v_id;
  perform public._ctr_auditar('contratos_cobranca_avulsa', jsonb_build_object('cobranca_id', v_id, 'cliente', (select apelido from public.ctr_clientes where id = v_cli),
    'valor', public._ctr_t(p, 'valor')::numeric, 'descricao', public._ctr_t(p, 'descricao')));
  return v_id;
end $$;

create or replace function public.ctr_cobranca_salvar(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a public.ctr_cobrancas; d public.ctr_cobrancas; v_id bigint := (p ->> 'id')::bigint;
begin
  perform public._ctr_admin();
  select * into a from public.ctr_cobrancas where id = v_id for update;
  if not found then raise exception 'Cobrança não encontrada.'; end if;
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
    'antes', to_jsonb(a) - 'criado_em', 'depois', to_jsonb(d) - 'criado_em'));
end $$;

-- NF: marca (ou desmarca) várias cobranças de uma vez; número opcional (só com uma cobrança)
create or replace function public.ctr_nf_marcar(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_ids bigint[]; v_emit boolean := coalesce((p ->> 'emitida')::boolean, true); v_data date := nullif(public._ctr_t(p, 'data'), '')::date;
  v_num text := coalesce(public._ctr_t(p, 'numero'), ''); v_n int;
begin
  perform public._ctr_admin();
  select array_agg(x::bigint) into v_ids from jsonb_array_elements_text(case when jsonb_typeof(p -> 'ids') = 'array' then p -> 'ids' else '[]' end) x;
  if v_ids is null then raise exception 'Escolha as cobranças.'; end if;
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
                    from public.ctr_cobrancas c join public.ctr_clientes cl on cl.id = c.cliente_id where c.id = any (v_ids))));
  return v_n;
end $$;

-- baixa manual (sem o extrato); diferença acima da tolerância exige observação
create or replace function public.ctr_baixa(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a public.ctr_cobrancas; v_id bigint := (p ->> 'id')::bigint; v_data date := nullif(public._ctr_t(p, 'pago_em'), '')::date;
  v_val numeric := nullif(public._ctr_t(p, 'valor_pago'), '')::numeric; v_obs text := coalesce(public._ctr_t(p, 'obs'), '');
begin
  perform public._ctr_admin();
  select * into a from public.ctr_cobrancas where id = v_id for update;
  if not found then raise exception 'Cobrança não encontrada.'; end if;
  if a.pago_em is not null then raise exception 'Esta cobrança já tem baixa.'; end if;
  if v_data is null or v_val is null or v_val <= 0 then raise exception 'Informe a data e o valor recebido.'; end if;
  if v_data > public._ctr_hoje() then raise exception 'A data do recebimento não pode ser no futuro.'; end if;
  if abs(v_val - a.valor) > (select tolerancia from public.ctr_config) and length(v_obs) < 3 then
    raise exception 'O valor recebido é diferente do cobrado: explique a diferença na observação.';
  end if;
  update public.ctr_cobrancas set pago_em = v_data, valor_pago = v_val, nf_emitida = true, nf_data = coalesce(nf_data, v_data),
    obs = case when v_obs <> '' then v_obs else obs end where id = v_id;
  perform public._ctr_auditar('contratos_baixa', jsonb_build_object('cobranca_id', v_id, 'cliente', (select apelido from public.ctr_clientes where id = a.cliente_id),
    'competencia', a.competencia, 'valor', a.valor, 'valor_pago', v_val, 'pago_em', v_data, 'obs', nullif(v_obs, ''), 'pelo_extrato', false));
end $$;

create or replace function public.ctr_baixa_desfazer(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.ctr_cobrancas;
begin
  perform public._ctr_admin();
  if length(coalesce(trim(p_motivo), '')) < 5 then raise exception 'Informe o motivo para desfazer a baixa.'; end if;
  select * into a from public.ctr_cobrancas where id = p_id for update;
  if not found then raise exception 'Cobrança não encontrada.'; end if;
  if a.pago_em is null then raise exception 'Esta cobrança não tem baixa.'; end if;
  update public.ctr_cobrancas set pago_em = null, valor_pago = null, extrato_id = null where id = p_id;
  perform public._ctr_auditar('contratos_baixa_desfeita', jsonb_build_object('cobranca_id', p_id, 'cliente', (select apelido from public.ctr_clientes where id = a.cliente_id),
    'competencia', a.competencia, 'motivo', trim(p_motivo), 'antes', jsonb_build_object('pago_em', a.pago_em, 'valor_pago', a.valor_pago, 'extrato_id', a.extrato_id)));
end $$;

create or replace function public.ctr_cobranca_excluir(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.ctr_cobrancas;
begin
  perform public._ctr_admin();
  if length(coalesce(trim(p_motivo), '')) < 5 then raise exception 'Informe o motivo para excluir a cobrança.'; end if;
  select * into a from public.ctr_cobrancas where id = p_id for update;
  if not found then raise exception 'Cobrança não encontrada.'; end if;
  if a.pago_em is not null then raise exception 'Cobrança paga não se exclui (desfaça a baixa antes, se foi engano).'; end if;
  delete from public.ctr_cobrancas where id = p_id;
  perform public._ctr_auditar('contratos_cobranca_excluida', jsonb_build_object('cobranca_id', p_id, 'motivo', trim(p_motivo),
    'cobranca', to_jsonb(a) || jsonb_build_object('cliente', (select apelido from public.ctr_clientes where id = a.cliente_id))));
  if a.contrato_id is not null then perform public._ctr_evento(a.contrato_id, 'Cobrança ' || a.competencia || ' excluída', trim(p_motivo)); end if;
end $$;

-- ---------------------------------------------------------------- extrato e conferência
create or replace function public.ctr_extrato_importar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_imp bigint; l jsonb; v_novos int := 0; v_rep int := 0; v_de date; v_ate date; v_conta text := coalesce(nullif(public._ctr_t(p, 'conta'), ''), 'nubank');
begin
  perform public._ctr_admin();
  if jsonb_typeof(p -> 'linhas') <> 'array' then raise exception 'Nenhum lançamento.'; end if;
  insert into public.ctr_importacoes (arquivo, conta, saldo_final, saldo_data)
  values (coalesce(public._ctr_t(p, 'arquivo'), ''), v_conta, nullif(public._ctr_t(p, 'saldo_final'), '')::numeric, nullif(public._ctr_t(p, 'saldo_data'), '')::date)
  returning id into v_imp;
  for l in select * from jsonb_array_elements(p -> 'linhas') loop
    if (l ->> 'valor')::numeric <= 0 then continue; end if;   -- só créditos
    if coalesce(l ->> 'chave', '') = '' or (l ->> 'data') is null then raise exception 'Lançamento sem data ou chave.'; end if;
    if exists (select 1 from public.ctr_extrato where chave = l ->> 'chave' or (coalesce(l ->> 'fitid', '') <> '' and conta = v_conta and fitid = l ->> 'fitid')) then
      v_rep := v_rep + 1; continue;
    end if;
    insert into public.ctr_extrato (conta, data, valor, descricao, fitid, chave, importacao_id)
    values (v_conta, (l ->> 'data')::date, (l ->> 'valor')::numeric, coalesce(l ->> 'descricao', ''), coalesce(l ->> 'fitid', ''), l ->> 'chave', v_imp);
    v_novos := v_novos + 1;
    v_de := least(v_de, (l ->> 'data')::date); v_ate := greatest(v_ate, (l ->> 'data')::date);
  end loop;
  update public.ctr_importacoes set novos = v_novos, repetidos = v_rep, de = v_de, ate = v_ate where id = v_imp;
  perform public._ctr_auditar('contratos_extrato_importado', jsonb_build_object('arquivo', public._ctr_t(p, 'arquivo'), 'conta', v_conta,
    'novos', v_novos, 'repetidos', v_rep, 'de', v_de, 'ate', v_ate));
  return jsonb_build_object('importacao', v_imp, 'novos', v_novos, 'repetidos', v_rep);
end $$;

-- liga um crédito do extrato a uma ou mais cobranças em aberto (ex.: um Pix pagando dois contratos do mesmo grupo)
create or replace function public.ctr_conciliar(p_extrato bigint, p_cobrancas bigint[], p_obs text default '') returns void
language plpgsql security definer set search_path = public as $$
declare e public.ctr_extrato; v_soma numeric; v_n int; v_tol numeric := (select tolerancia from public.ctr_config); v_obs text := coalesce(trim(p_obs), '');
begin
  perform public._ctr_admin();
  select * into e from public.ctr_extrato where id = p_extrato for update;
  if not found then raise exception 'Lançamento do extrato não encontrado.'; end if;
  if e.ignorado_motivo <> '' then raise exception 'Este crédito foi marcado como "não é de contrato".'; end if;
  if exists (select 1 from public.ctr_cobrancas where extrato_id = p_extrato) then raise exception 'Este crédito já foi ligado a cobranças.'; end if;
  select count(*), sum(valor) into v_n, v_soma from public.ctr_cobrancas where id = any (p_cobrancas) and pago_em is null;
  if v_n = 0 or v_n <> coalesce(array_length(p_cobrancas, 1), 0) then raise exception 'Escolha cobranças em aberto.'; end if;
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
                    from public.ctr_cobrancas c join public.ctr_clientes cl on cl.id = c.cliente_id where c.id = any (p_cobrancas))));
end $$;

create or replace function public.ctr_extrato_ignorar(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.ctr_extrato;
begin
  perform public._ctr_admin();
  select * into e from public.ctr_extrato where id = p_id for update;
  if not found then raise exception 'Lançamento do extrato não encontrado.'; end if;
  if exists (select 1 from public.ctr_cobrancas where extrato_id = p_id) then raise exception 'Este crédito já está ligado a cobranças.'; end if;
  update public.ctr_extrato set ignorado_motivo = coalesce(trim(p_motivo), '') where id = p_id;
  perform public._ctr_auditar('contratos_extrato_ignorado', jsonb_build_object('extrato_id', p_id, 'data', e.data, 'valor', e.valor, 'descricao', e.descricao,
    'antes', jsonb_build_object('ignorado', e.ignorado_motivo), 'depois', jsonb_build_object('ignorado', coalesce(trim(p_motivo), ''))));
end $$;

-- ---------------------------------------------------------------- carga da planilha ContratoDados.xlsx (uma vez, pela tela)
-- p = { config:{…}, impostos:[{desde,pct}], clientes:[{ref,…}], contratos:[{ref,cliente_ref,…,situacao,historico}],
--       cobrancas:[{cliente_ref,contrato_ref,competencia,vencimento,valor,descricao,pago_em,valor_pago,nf_emitida}] }
create or replace function public.ctr_carga(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; cli jsonb := '{}'; kon jsonb := '{}'; v_id bigint; v_n int := 0; v_tot numeric := 0; v_pago numeric := 0;
begin
  perform public._ctr_admin();
  if exists (select 1 from public.ctr_clientes) or exists (select 1 from public.ctr_cobrancas) then
    raise exception 'A carga só pode ser feita com o app vazio (já existem clientes ou cobranças).';
  end if;
  if jsonb_typeof(p -> 'config') = 'object' then perform public.ctr_config_salvar(p -> 'config'); end if;
  for x in select * from jsonb_array_elements(coalesce(p -> 'impostos', '[]')) loop
    insert into public.ctr_impostos (vale_desde, pct) values ((x ->> 'desde')::date, (x ->> 'pct')::numeric) on conflict (vale_desde) do update set pct = excluded.pct;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'clientes', '[]')) loop
    insert into public.ctr_clientes (apelido, sigla, razao_social, cnpj, endereco, email_cobranca, resp_financeiro, extrato_textos, ativo, obs)
    values (x ->> 'apelido', coalesce(x ->> 'sigla', ''), x ->> 'razao_social', public._ctr_doc(x ->> 'cnpj'), coalesce(x ->> 'endereco', ''),
      coalesce(x ->> 'email_cobranca', ''), coalesce(x ->> 'resp_financeiro', ''),
      coalesce((select array_agg(t) from jsonb_array_elements_text(coalesce(x -> 'extrato_textos', '[]')) t where t <> ''), '{}'),
      coalesce((x ->> 'ativo')::boolean, true), coalesce(x ->> 'obs', ''))
    returning id into v_id;
    cli := cli || jsonb_build_object(x ->> 'ref', v_id);
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'contratos', '[]')) loop
    if cli ->> (x ->> 'cliente_ref') is null then raise exception 'Carga: contrato de cliente desconhecido (%).', x ->> 'cliente_ref'; end if;
    insert into public.ctr_contratos (cliente_id, objeto, servicos_esp, inicio, fim, valor_mensal, dia_vencimento, parcela_extra, assinantes,
      testemunha1, testemunha1_doc, testemunha2, testemunha2_doc, local_assinatura, data_assinatura, situacao, gerado_em, encerrado_em, historico, obs)
    values ((cli ->> (x ->> 'cliente_ref'))::bigint, coalesce(x ->> 'objeto', ''), coalesce(x ->> 'servicos_esp', ''), (x ->> 'inicio')::date, nullif(x ->> 'fim', '')::date,
      (x ->> 'valor_mensal')::numeric, coalesce((x ->> 'dia_vencimento')::int, 30), coalesce((x ->> 'parcela_extra')::boolean, true), coalesce(x ->> 'assinantes', ''),
      coalesce(x ->> 'testemunha1', ''), coalesce(x ->> 'testemunha1_doc', ''), coalesce(x ->> 'testemunha2', ''), coalesce(x ->> 'testemunha2_doc', ''),
      coalesce(nullif(x ->> 'local_assinatura', ''), 'Rio de Janeiro'), nullif(x ->> 'data_assinatura', '')::date, coalesce(x ->> 'situacao', 'gerado'),
      case when coalesce(x ->> 'situacao', 'gerado') <> 'rascunho' then nullif(x ->> 'inicio', '')::date end,
      case when x ->> 'situacao' in ('encerrado', 'rescindido') then nullif(x ->> 'fim', '')::date end,
      coalesce((x ->> 'historico')::boolean, false), coalesce(x ->> 'obs', ''))
    returning id into v_id;
    kon := kon || jsonb_build_object(x ->> 'ref', v_id);
    perform public._ctr_evento(v_id, 'Trazido da planilha ContratoDados.xlsx', coalesce(x ->> 'obs', ''), least((x ->> 'inicio')::date, public._ctr_hoje()));
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'cobrancas', '[]')) loop
    if cli ->> (x ->> 'cliente_ref') is null then raise exception 'Carga: cobrança de cliente desconhecido (%).', x ->> 'cliente_ref'; end if;
    insert into public.ctr_cobrancas (cliente_id, contrato_id, competencia, descricao, vencimento, valor, nf_emitida, nf_data, pago_em, valor_pago, obs)
    values ((cli ->> (x ->> 'cliente_ref'))::bigint, (kon ->> (x ->> 'contrato_ref'))::bigint, x ->> 'competencia', coalesce(x ->> 'descricao', ''),
      (x ->> 'vencimento')::date, (x ->> 'valor')::numeric, coalesce((x ->> 'nf_emitida')::boolean, false), null,
      nullif(x ->> 'pago_em', '')::date, nullif(x ->> 'valor_pago', '')::numeric, coalesce(x ->> 'obs', ''));
    v_n := v_n + 1; v_tot := v_tot + (x ->> 'valor')::numeric; v_pago := v_pago + coalesce(nullif(x ->> 'valor_pago', '')::numeric, 0);
  end loop;
  -- conferência com os totais que a tela calculou da planilha (aba Resumo): diferença = desfaz tudo
  if p ? 'conferir' and (abs(v_tot - (p -> 'conferir' ->> 'cobrado')::numeric) > 0.01 or abs(v_pago - (p -> 'conferir' ->> 'pago')::numeric) > 0.01
                         or v_n <> (p -> 'conferir' ->> 'cobrancas')::int) then
    raise exception 'Carga: os totais gravados (% cobranças, cobrado %, pago %) não batem com a planilha.', v_n, v_tot, v_pago;
  end if;
  perform public._ctr_auditar('contratos_carga', jsonb_build_object('arquivo', p ->> 'arquivo', 'clientes', jsonb_array_length(coalesce(p -> 'clientes', '[]')),
    'contratos', jsonb_array_length(coalesce(p -> 'contratos', '[]')), 'cobrancas', v_n, 'cobrado', v_tot, 'pago', v_pago));
  return jsonb_build_object('clientes', jsonb_array_length(coalesce(p -> 'clientes', '[]')), 'contratos', jsonb_array_length(coalesce(p -> 'contratos', '[]')),
    'cobrancas', v_n, 'cobrado', v_tot, 'pago', v_pago);
end $$;

-- funções da tela: só usuário logado (e, dentro, só admin)
do $$ declare f text; begin
  foreach f in array array['ctr_config_salvar(jsonb)', 'ctr_imposto_salvar(date, numeric)', 'ctr_imposto_excluir(date)', 'ctr_cliente_salvar(jsonb)',
    'ctr_modelo_salvar(jsonb)', 'ctr_contrato_salvar(jsonb)', 'ctr_contrato_etapa(bigint, text, date, text)', 'ctr_contrato_documento(bigint, text, text)',
    'ctr_contrato_renovar(bigint, jsonb)', 'ctr_cobrancas_gerar(bigint, date)', 'ctr_cobranca_avulsa(jsonb)', 'ctr_cobranca_salvar(jsonb)',
    'ctr_nf_marcar(jsonb)', 'ctr_baixa(jsonb)', 'ctr_baixa_desfazer(bigint, text)', 'ctr_cobranca_excluir(bigint, text)',
    'ctr_extrato_importar(jsonb)', 'ctr_conciliar(bigint, bigint[], text)', 'ctr_extrato_ignorar(bigint, text)', 'ctr_carga(jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- arquivos: modelo do Word e PDF assinado (privado, só admin)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ctr-arquivos', 'ctr-arquivos', false, 20971520,
        array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;
drop policy if exists ctr_arquivos_ler on storage.objects;
create policy ctr_arquivos_ler on storage.objects for select to authenticated using (bucket_id = 'ctr-arquivos' and public.eh_admin());
drop policy if exists ctr_arquivos_enviar on storage.objects;
create policy ctr_arquivos_enviar on storage.objects for insert to authenticated with check (bucket_id = 'ctr-arquivos' and public.eh_admin());

-- ---------------------------------------------------------------- cadastro do app na Área do Cliente
-- Uso interno da Nervia: fora da vitrine (oculto); só a equipe (admin) vê.
insert into public.apps (id, nome, descricao, url, icone, ordem, ativo, cartao_url, manual_url, situacao)
values ('contratos', 'Contratos', 'Contratos de prestação de serviço da Nervia: geração pelo modelo do Word, envio e assinatura, cobranças, NF e conferência com o extrato.',
        '/apps/contratos/', 'CT', 95, true, '/apps/contratos/ajuda/cartao.html', '/apps/contratos/ajuda/manual.html', 'oculto')
on conflict (id) do nothing;
