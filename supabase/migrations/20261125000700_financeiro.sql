-- App "Financeiro Nervia" (prefixo fin_): custos, contas a pagar, contas a receber e saldo das contas da Nervia.
-- Pedido do Marco em 25/11/2026: "um local no ecossistema Nervia para controle dos custos, contas a pagar, contas a
-- receber, fluxo financeiro, tudo para gerenciar a área financeira da Nervia".
--
-- Decisões do Marco (25/11/2026):
--   * só a equipe Nervia (admin); app oculto, fora da vitrine;
--   * contas a RECEBER = as cobranças do app Contratos (empresa Nervia): o financeiro só LÊ (ctr_cobrancas_v); a baixa
--     continua no Contratos; recebimento fora de contrato (avulso) é lançado aqui;
--   * contas acompanhadas: Nubank PJ, o CARTÃO PESSOAL do Marco (pessoa física; por enquanto as contas no cartão são
--     pagas nele — lançamento manual, sem importação; o saldo negativo = quanto a Nervia deve ao Marco; o reembolso é uma
--     transferência do Nubank para o cartão) e "dinheiro / fora do banco" (aporte, despesa paga do bolso);
--   * saldo na fase 1 = saldo inicial informado + o que for pago/recebido pelo app (e os recebimentos do Contratos na
--     conta dos contratos) + "Acertar saldo" (motivo obrigatório) para conferir com o banco; extratos na fase 2;
--   * o imposto (DAS) é uma conta a pagar de verdade (recorrente); o imposto estimado do Contratos é só referência;
--   * CUSTOS RECORRENTES de qualquer tipo, cada um num grupo; o grupo "Plataforma" é o que entra no custo por CNPJ e
--     na margem dos apps (comparação com preco_itens). Toda mudança de custo vai para fin_custos_hist (SOMENTE INCLUSÃO);
--   * a planilha "Plataforma Nervia - Investimento.xlsx" vem para o app pela carga (_fin_carga, só pelo SQL do Supabase,
--     auditoria financeiro_carga); os dados reais não vão para o GitHub.
--
-- Regras: a tela só LÊ; toda escrita é por função security definer que confere eh_admin() e grava auditoria (financeiro_*).
-- Nada se apaga: lançamento aberto é CANCELADO com motivo; baixa desfeita com motivo; transferência cancelada com motivo.

-- ---------------------------------------------------------------- tabelas
create table if not exists public.fin_contas (
  id               bigint generated always as identity primary key,
  nome             text not null check (length(trim(nome)) > 0),
  tipo             text not null check (tipo in ('banco', 'cartao_pessoal', 'dinheiro')),
  saldo_inicial    numeric(12,2) not null default 0,
  saldo_inicial_em date not null default (now() at time zone 'America/Sao_Paulo')::date,   -- o saldo conta a partir deste dia
  ordem            int not null default 0,
  ativo            boolean not null default true,
  obs              text not null default '',
  criado_em        timestamptz not null default now()
);
create unique index if not exists fin_contas_nome on public.fin_contas (lower(nome));

create table if not exists public.fin_categorias (
  id           bigint generated always as identity primary key,
  nome         text not null check (length(trim(nome)) > 0),
  tipo         text not null default 'despesa' check (tipo in ('despesa', 'receita', 'ambos')),
  entra_resultado boolean not null default true,     -- false = fica fora do resultado do mês (ex.: aporte do sócio)
  ordem        int not null default 0,
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now()
);
create unique index if not exists fin_categorias_nome on public.fin_categorias (lower(nome));

-- linha única: conta onde caem os recebimentos do Contratos e a empresa do Contratos que é a Nervia
create table if not exists public.fin_config (
  id               int primary key default 1 check (id = 1),
  ctr_empresa_id   bigint references public.ctr_empresas,
  conta_contratos  bigint references public.fin_contas,
  atualizado_em    timestamptz
);

create table if not exists public.fin_custos (
  id              bigint generated always as identity primary key,
  nome            text not null check (length(trim(nome)) > 0),
  fornecedor      text not null default '',
  grupo           text not null default 'Plataforma' check (length(trim(grupo)) > 0),
  categoria_id    bigint references public.fin_categorias,
  conta_id        bigint references public.fin_contas,          -- conta em que costuma ser pago
  moeda           text not null default 'BRL' check (moeda in ('BRL', 'USD')),
  valor           numeric(12,2) not null check (valor >= 0),      -- na moeda, por período
  cambio          numeric(10,4) check (cambio is null or cambio > 0),   -- R$ por US$ (informado)
  periodicidade   text not null default 'mensal' check (periodicidade in ('mensal', 'anual')),
  desde           date not null,
  ate             date,                                           -- vazio = continua
  obs             text not null default '',
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  valor_brl       numeric(12,2) generated always as (round(valor * case when moeda = 'USD' then coalesce(cambio, 0) else 1 end, 2)) stored,
  mensal_brl      numeric(12,2) generated always as (round(valor * case when moeda = 'USD' then coalesce(cambio, 0) else 1 end
                                                          / case when periodicidade = 'anual' then 12 else 1 end, 2)) stored,
  check (moeda = 'BRL' or cambio is not null),
  check (ate is null or ate >= desde)
);

create table if not exists public.fin_custos_hist (
  id        bigint generated always as identity primary key,
  custo_id  bigint not null,
  em        timestamptz not null default now(),
  quem      text,
  motivo    text not null default '',
  antes     jsonb,
  depois    jsonb
);
create index if not exists fin_custos_hist_custo on public.fin_custos_hist (custo_id, em desc);

create table if not exists public.fin_lancamentos (
  id               bigint generated always as identity primary key,
  tipo             text not null check (tipo in ('pagar', 'receber')),
  descricao        text not null check (length(trim(descricao)) > 0),
  contraparte      text not null default '',      -- fornecedor (pagar) ou pagador (receber)
  categoria_id     bigint references public.fin_categorias,
  conta_id         bigint references public.fin_contas,   -- conta prevista
  vencimento       date not null,
  valor            numeric(12,2) not null check (valor > 0),
  recorrencia      text not null default 'nenhuma' check (recorrencia in ('nenhuma', 'mensal', 'anual')),
  serie_id         bigint,                         -- id do primeiro da série (recorrência)
  custo_id         bigint references public.fin_custos,
  pago_em          date,
  valor_pago       numeric(12,2) check (valor_pago is null or valor_pago > 0),
  conta_pago_id    bigint references public.fin_contas,
  anexo            text not null default '',       -- caminho no bucket fin-arquivos
  obs              text not null default '',
  cancelado_em     timestamptz,
  cancelado_motivo text not null default '',
  criado_em        timestamptz not null default now(),
  criado_nome      text,
  check ((pago_em is null) = (valor_pago is null) and (pago_em is null) = (conta_pago_id is null)),
  check (cancelado_em is null or pago_em is null)
);
create index if not exists fin_lancamentos_venc on public.fin_lancamentos (vencimento) where pago_em is null and cancelado_em is null;
create index if not exists fin_lancamentos_serie on public.fin_lancamentos (serie_id);
create index if not exists fin_lancamentos_pago on public.fin_lancamentos (conta_pago_id, pago_em);

create table if not exists public.fin_transferencias (
  id               bigint generated always as identity primary key,
  data             date not null,
  de_conta         bigint not null references public.fin_contas,
  para_conta       bigint not null references public.fin_contas,
  valor            numeric(12,2) not null check (valor > 0),
  descricao        text not null default '',
  cancelado_em     timestamptz,
  cancelado_motivo text not null default '',
  criado_em        timestamptz not null default now(),
  criado_nome      text,
  check (de_conta <> para_conta)
);

-- "Acertar saldo": guarda o saldo informado, o calculado e a diferença (que vira movimento da conta). SOMENTE INCLUSÃO.
create table if not exists public.fin_ajustes (
  id               bigint generated always as identity primary key,
  conta_id         bigint not null references public.fin_contas,
  data             date not null,
  saldo_informado  numeric(12,2) not null,
  saldo_calculado  numeric(12,2) not null,
  diferenca        numeric(12,2) generated always as (saldo_informado - saldo_calculado) stored,
  motivo           text not null check (length(trim(motivo)) >= 5),
  criado_em        timestamptz not null default now(),
  criado_nome      text
);

-- carga da planilha (investimento inicial, cenários e limites): guardada como veio, para a fase 3
create table if not exists public.fin_planilha (
  id         bigint generated always as identity primary key,
  aba        text not null,
  dados      jsonb not null,
  criado_em  timestamptz not null default now()
);

-- somente inclusão
create or replace function public._fin_somente_inclusao() returns trigger language plpgsql as $$
begin
  raise exception 'Registro somente inclusão: não pode ser alterado nem apagado (%).', tg_table_name;
end $$;
drop trigger if exists fin_custos_hist_imutavel on public.fin_custos_hist;
create trigger fin_custos_hist_imutavel before update or delete on public.fin_custos_hist for each row execute function public._fin_somente_inclusao();
drop trigger if exists fin_ajustes_imutavel on public.fin_ajustes;
create trigger fin_ajustes_imutavel before update or delete on public.fin_ajustes for each row execute function public._fin_somente_inclusao();
-- lançamento e transferência não se apagam (só cancelar)
create or replace function public._fin_sem_apagar() returns trigger language plpgsql as $$
begin
  raise exception 'Não se apaga: cancele com motivo (%).', tg_table_name;
end $$;
drop trigger if exists fin_lancamentos_sem_apagar on public.fin_lancamentos;
create trigger fin_lancamentos_sem_apagar before delete on public.fin_lancamentos for each row execute function public._fin_sem_apagar();
drop trigger if exists fin_transferencias_sem_apagar on public.fin_transferencias;
create trigger fin_transferencias_sem_apagar before delete on public.fin_transferencias for each row execute function public._fin_sem_apagar();
drop trigger if exists fin_custos_sem_apagar on public.fin_custos;
create trigger fin_custos_sem_apagar before delete on public.fin_custos for each row execute function public._fin_sem_apagar();

-- ---------------------------------------------------------------- acesso: só a equipe Nervia lê; ninguém grava pela tela
do $$
declare t text;
begin
  foreach t in array array['fin_contas','fin_categorias','fin_config','fin_custos','fin_custos_hist','fin_lancamentos','fin_transferencias','fin_ajustes','fin_planilha'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.eh_admin()))', t || '_ler', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- dados iniciais
insert into public.fin_contas (nome, tipo, ordem) values
  ('Nubank PJ', 'banco', 1), ('Cartão pessoal do Marco', 'cartao_pessoal', 2), ('Dinheiro / fora do banco', 'dinheiro', 3)
on conflict do nothing;
insert into public.fin_categorias (nome, tipo, entra_resultado, ordem) values
  ('Infraestrutura / plataforma', 'despesa', true, 1), ('Impostos', 'despesa', true, 2), ('Contabilidade', 'despesa', true, 3),
  ('Bancos e tarifas', 'despesa', true, 4), ('Ferramentas e software', 'despesa', true, 5), ('Equipamentos', 'despesa', true, 6),
  ('Pró-labore / retiradas', 'despesa', true, 7), ('Aportes', 'receita', false, 8), ('Marketing', 'despesa', true, 9),
  ('Serviços prestados', 'receita', true, 10), ('Outros', 'ambos', true, 99)
on conflict do nothing;
insert into public.fin_config (id, ctr_empresa_id, conta_contratos)
select 1, (select min(id) from public.ctr_empresas), (select id from public.fin_contas where nome = 'Nubank PJ')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- auxiliares
create or replace function public._fin_hoje() returns date
language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

create or replace function public._fin_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia usa o Financeiro.' using errcode = '42501'; end if;
end $$;

create or replace function public._fin_quem() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(nome, ''), email) from public.perfis where user_id = auth.uid()), 'sistema')
$$;

create or replace function public._fin_t(p jsonb, k text) returns text
language sql immutable as $$ select nullif(trim(p ->> k), '') $$;

-- auditoria: em alteração guarda só os campos que mudaram (antes/depois); sem mudança não grava
create or replace function public._fin_auditar(p_acao text, p_det jsonb) returns void
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

do $$
declare f text;
begin
  foreach f in array array['_fin_admin()', '_fin_quem()', '_fin_auditar(text, jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- movimentos (base do saldo e do resultado)
-- uma linha por entrada (+) ou saída (−) em cada conta: lançamentos pagos, transferências, acertos de saldo e os
-- recebimentos do Contratos (empresa da fin_config) na conta dos contratos.
create or replace view public.fin_movimentos_v with (security_invoker = true) as
select 'lancamento'::text as origem, l.id as origem_id, l.conta_pago_id as conta_id, l.pago_em as data,
       case when l.tipo = 'receber' then l.valor_pago else -l.valor_pago end as valor,
       l.descricao, l.contraparte, l.categoria_id, l.tipo
  from public.fin_lancamentos l where l.pago_em is not null
union all
select 'transferencia', t.id, t.de_conta, t.data, -t.valor, coalesce(nullif(t.descricao, ''), 'Transferência'), '', null, 'transferencia'
  from public.fin_transferencias t where t.cancelado_em is null
union all
select 'transferencia', t.id, t.para_conta, t.data, t.valor, coalesce(nullif(t.descricao, ''), 'Transferência'), '', null, 'transferencia'
  from public.fin_transferencias t where t.cancelado_em is null
union all
select 'ajuste', a.id, a.conta_id, a.data, a.diferenca, 'Acerto de saldo: ' || a.motivo, '', null, 'ajuste'
  from public.fin_ajustes a where a.diferenca <> 0
union all
select 'contratos', c.id, cf.conta_contratos, c.pago_em, c.valor_pago,
       coalesce(nullif(c.descricao, ''), 'Contrato ' || c.competencia), cl.apelido, null, 'receber'
  from public.ctr_cobrancas c
  join public.fin_config cf on cf.id = 1 and cf.ctr_empresa_id = c.empresa_id and cf.conta_contratos is not null
  join public.ctr_clientes cl on cl.id = c.cliente_id
 where c.pago_em is not null;
revoke all on public.fin_movimentos_v from anon;
grant select on public.fin_movimentos_v to authenticated;

-- saldo de uma conta até uma data (inclusive): saldo inicial + movimentos a partir do dia do saldo inicial
create or replace function public._fin_saldo(p_conta bigint, p_ate date) returns numeric
language sql stable security definer set search_path = public as $$
  select k.saldo_inicial + coalesce((select sum(m.valor) from public.fin_movimentos_v m
                                      where m.conta_id = k.id and m.data >= k.saldo_inicial_em and m.data <= p_ate), 0)
    from public.fin_contas k where k.id = p_conta
$$;
revoke execute on function public._fin_saldo(bigint, date) from public, anon, authenticated;

create or replace function public.fin_saldos(p_ate date default null)
returns table (conta_id bigint, nome text, tipo text, saldo numeric, ultimo_acerto date)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._fin_admin();
  return query select k.id, k.nome, k.tipo, public._fin_saldo(k.id, coalesce(p_ate, public._fin_hoje())),
                      (select max(a.data) from public.fin_ajustes a where a.conta_id = k.id)
                 from public.fin_contas k order by k.ordem, k.nome;
end $$;

-- ---------------------------------------------------------------- cadastros
create or replace function public.fin_conta_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := (p ->> 'id')::bigint; a public.fin_contas; d public.fin_contas;
begin
  perform public._fin_admin();
  if v_id is null then
    if public._fin_t(p, 'nome') is null then raise exception 'Informe o nome da conta.'; end if;
    if exists (select 1 from public.fin_contas where lower(nome) = lower(public._fin_t(p, 'nome'))) then raise exception 'Já existe uma conta com esse nome.'; end if;
    insert into public.fin_contas (nome, tipo, saldo_inicial, saldo_inicial_em, ordem, obs)
    values (public._fin_t(p, 'nome'), coalesce(public._fin_t(p, 'tipo'), 'banco'), coalesce(public._fin_t(p, 'saldo_inicial')::numeric, 0),
            coalesce(public._fin_t(p, 'saldo_inicial_em')::date, public._fin_hoje()), coalesce(public._fin_t(p, 'ordem')::int, 50), coalesce(p ->> 'obs', ''))
    returning * into d;
    perform public._fin_auditar('financeiro_conta_criada', jsonb_build_object('conta', to_jsonb(d)));
    return d.id;
  end if;
  select * into a from public.fin_contas where id = v_id for update;
  if not found then raise exception 'Conta não encontrada.'; end if;
  if public._fin_t(p, 'nome') is not null and exists (select 1 from public.fin_contas where lower(nome) = lower(public._fin_t(p, 'nome')) and id <> v_id) then
    raise exception 'Já existe uma conta com esse nome.';
  end if;
  update public.fin_contas set
    nome = coalesce(public._fin_t(p, 'nome'), nome),
    tipo = coalesce(public._fin_t(p, 'tipo'), tipo),
    saldo_inicial = coalesce(public._fin_t(p, 'saldo_inicial')::numeric, saldo_inicial),
    saldo_inicial_em = coalesce(public._fin_t(p, 'saldo_inicial_em')::date, saldo_inicial_em),
    ordem = coalesce(public._fin_t(p, 'ordem')::int, ordem),
    ativo = coalesce((p ->> 'ativo')::boolean, ativo),
    obs = coalesce(p ->> 'obs', obs)
  where id = v_id returning * into d;
  perform public._fin_auditar('financeiro_conta_alterada', jsonb_build_object('conta_id', v_id, 'nome', d.nome,
    'antes', to_jsonb(a) - 'criado_em', 'depois', to_jsonb(d) - 'criado_em'));
  return v_id;
end $$;

create or replace function public.fin_categoria_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := (p ->> 'id')::bigint; a public.fin_categorias; d public.fin_categorias;
begin
  perform public._fin_admin();
  if public._fin_t(p, 'nome') is not null and exists (select 1 from public.fin_categorias where lower(nome) = lower(public._fin_t(p, 'nome')) and id is distinct from v_id) then
    raise exception 'Já existe uma categoria com esse nome.';
  end if;
  if v_id is null then
    if public._fin_t(p, 'nome') is null then raise exception 'Informe o nome da categoria.'; end if;
    insert into public.fin_categorias (nome, tipo, entra_resultado, ordem)
    values (public._fin_t(p, 'nome'), coalesce(public._fin_t(p, 'tipo'), 'despesa'), coalesce((p ->> 'entra_resultado')::boolean, true), coalesce(public._fin_t(p, 'ordem')::int, 50))
    returning * into d;
    perform public._fin_auditar('financeiro_categoria_criada', jsonb_build_object('categoria', to_jsonb(d)));
    return d.id;
  end if;
  select * into a from public.fin_categorias where id = v_id for update;
  if not found then raise exception 'Categoria não encontrada.'; end if;
  update public.fin_categorias set
    nome = coalesce(public._fin_t(p, 'nome'), nome), tipo = coalesce(public._fin_t(p, 'tipo'), tipo),
    entra_resultado = coalesce((p ->> 'entra_resultado')::boolean, entra_resultado), ordem = coalesce(public._fin_t(p, 'ordem')::int, ordem),
    ativo = coalesce((p ->> 'ativo')::boolean, ativo)
  where id = v_id returning * into d;
  perform public._fin_auditar('financeiro_categoria_alterada', jsonb_build_object('categoria_id', v_id, 'nome', d.nome,
    'antes', to_jsonb(a) - 'criado_em', 'depois', to_jsonb(d) - 'criado_em'));
  return v_id;
end $$;

create or replace function public.fin_config_salvar(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a public.fin_config; d public.fin_config;
begin
  perform public._fin_admin();
  select * into a from public.fin_config where id = 1 for update;
  update public.fin_config set
    ctr_empresa_id = case when p ? 'ctr_empresa_id' then public._fin_t(p, 'ctr_empresa_id')::bigint else ctr_empresa_id end,
    conta_contratos = case when p ? 'conta_contratos' then public._fin_t(p, 'conta_contratos')::bigint else conta_contratos end,
    atualizado_em = now()
  where id = 1 returning * into d;
  perform public._fin_auditar('financeiro_config_alterada', jsonb_build_object('antes', to_jsonb(a) - 'atualizado_em', 'depois', to_jsonb(d) - 'atualizado_em'));
end $$;

-- ---------------------------------------------------------------- custos recorrentes
-- chave ausente = mantém; histórico só com os campos que mudaram
create or replace function public.fin_custo_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := (p ->> 'id')::bigint; a public.fin_custos; d public.fin_custos;
        ja jsonb; jd jsonb; na jsonb := '{}'; nd jsonb := '{}'; k text;
        ign text[] := array['criado_em', 'atualizado_em', 'valor_brl', 'mensal_brl'];
begin
  perform public._fin_admin();
  if v_id is null then
    if public._fin_t(p, 'nome') is null then raise exception 'Informe o nome do custo.'; end if;
    if public._fin_t(p, 'valor') is null then raise exception 'Informe o valor.'; end if;
    if public._fin_t(p, 'moeda') = 'USD' and public._fin_t(p, 'cambio') is null then raise exception 'Custo em dólar: informe o câmbio (R$ por US$).'; end if;
    insert into public.fin_custos (nome, fornecedor, grupo, categoria_id, conta_id, moeda, valor, cambio, periodicidade, desde, ate, obs)
    values (public._fin_t(p, 'nome'), coalesce(p ->> 'fornecedor', ''), coalesce(public._fin_t(p, 'grupo'), 'Plataforma'),
            public._fin_t(p, 'categoria_id')::bigint, public._fin_t(p, 'conta_id')::bigint, coalesce(public._fin_t(p, 'moeda'), 'BRL'),
            public._fin_t(p, 'valor')::numeric, public._fin_t(p, 'cambio')::numeric, coalesce(public._fin_t(p, 'periodicidade'), 'mensal'),
            coalesce(public._fin_t(p, 'desde')::date, public._fin_hoje()), public._fin_t(p, 'ate')::date, coalesce(p ->> 'obs', ''))
    returning * into d;
    insert into public.fin_custos_hist (custo_id, quem, motivo, antes, depois)
    values (d.id, public._fin_quem(), coalesce(p ->> 'motivo', ''), null, to_jsonb(d) - ign);
    perform public._fin_auditar('financeiro_custo_criado', jsonb_build_object('custo_id', d.id, 'custo', to_jsonb(d) - ign));
    return d.id;
  end if;
  select * into a from public.fin_custos where id = v_id for update;
  if not found then raise exception 'Custo não encontrado.'; end if;
  update public.fin_custos set
    nome = coalesce(public._fin_t(p, 'nome'), nome),
    fornecedor = coalesce(p ->> 'fornecedor', fornecedor),
    grupo = coalesce(public._fin_t(p, 'grupo'), grupo),
    categoria_id = case when p ? 'categoria_id' then public._fin_t(p, 'categoria_id')::bigint else categoria_id end,
    conta_id = case when p ? 'conta_id' then public._fin_t(p, 'conta_id')::bigint else conta_id end,
    moeda = coalesce(public._fin_t(p, 'moeda'), moeda),
    valor = coalesce(public._fin_t(p, 'valor')::numeric, valor),
    cambio = case when p ? 'cambio' then public._fin_t(p, 'cambio')::numeric else cambio end,
    periodicidade = coalesce(public._fin_t(p, 'periodicidade'), periodicidade),
    desde = coalesce(public._fin_t(p, 'desde')::date, desde),
    ate = case when p ? 'ate' then public._fin_t(p, 'ate')::date else ate end,
    obs = coalesce(p ->> 'obs', obs),
    atualizado_em = now()
  where id = v_id returning * into d;
  if d.moeda = 'USD' and d.cambio is null then raise exception 'Custo em dólar: informe o câmbio (R$ por US$).'; end if;
  ja := to_jsonb(a) - ign; jd := to_jsonb(d) - ign;
  for k in select jsonb_object_keys(ja || jd) loop
    if (ja -> k) is distinct from (jd -> k) then na := na || jsonb_build_object(k, ja -> k); nd := nd || jsonb_build_object(k, jd -> k); end if;
  end loop;
  if na = '{}' then return v_id; end if;
  insert into public.fin_custos_hist (custo_id, quem, motivo, antes, depois) values (v_id, public._fin_quem(), coalesce(p ->> 'motivo', ''), na, nd);
  perform public._fin_auditar('financeiro_custo_alterado', jsonb_build_object('custo_id', v_id, 'nome', d.nome, 'motivo', coalesce(p ->> 'motivo', ''),
    'antes', na, 'depois', nd));
  return v_id;
end $$;

-- ---------------------------------------------------------------- contas a pagar / a receber
create or replace function public._fin_lanc_json(l public.fin_lancamentos) returns jsonb
language sql immutable as $$ select to_jsonb(l) - 'criado_em' - 'criado_nome' $$;
revoke execute on function public._fin_lanc_json(public.fin_lancamentos) from public, anon, authenticated;

create or replace function public.fin_lancamento_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := (p ->> 'id')::bigint; a public.fin_lancamentos; d public.fin_lancamentos; v_cat public.fin_categorias;
begin
  perform public._fin_admin();
  if v_id is null then
    if public._fin_t(p, 'descricao') is null then raise exception 'Informe a descrição.'; end if;
    if public._fin_t(p, 'vencimento') is null then raise exception 'Informe o vencimento.'; end if;
    if coalesce(public._fin_t(p, 'valor')::numeric, 0) <= 0 then raise exception 'Informe o valor (maior que zero).'; end if;
    insert into public.fin_lancamentos (tipo, descricao, contraparte, categoria_id, conta_id, vencimento, valor, recorrencia, custo_id, obs, criado_nome)
    values (coalesce(public._fin_t(p, 'tipo'), 'pagar'), public._fin_t(p, 'descricao'), coalesce(p ->> 'contraparte', ''),
            public._fin_t(p, 'categoria_id')::bigint, public._fin_t(p, 'conta_id')::bigint, public._fin_t(p, 'vencimento')::date,
            public._fin_t(p, 'valor')::numeric, coalesce(public._fin_t(p, 'recorrencia'), 'nenhuma'), public._fin_t(p, 'custo_id')::bigint,
            coalesce(p ->> 'obs', ''), public._fin_quem())
    returning * into d;
    update public.fin_lancamentos set serie_id = id where id = d.id returning * into d;
    select * into v_cat from public.fin_categorias where id = d.categoria_id;
    perform public._fin_auditar(case when d.tipo = 'pagar' then 'financeiro_conta_pagar_criada' else 'financeiro_receber_criado' end,
      jsonb_build_object('lancamento_id', d.id, 'lancamento', public._fin_lanc_json(d), 'categoria', v_cat.nome));
    -- "já pago" (ex.: compra no cartão pessoal): lança e dá baixa junto
    if public._fin_t(p, 'pago_em') is not null then
      perform public.fin_lancamento_pagar(d.id, public._fin_t(p, 'pago_em')::date, coalesce(public._fin_t(p, 'valor_pago')::numeric, d.valor),
        coalesce(public._fin_t(p, 'conta_pago_id')::bigint, d.conta_id), '');
    end if;
    return d.id;
  end if;
  select * into a from public.fin_lancamentos where id = v_id for update;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  if a.cancelado_em is not null then raise exception 'Lançamento cancelado não se altera.'; end if;
  if a.pago_em is not null then raise exception 'Lançamento já baixado: desfaça a baixa (com motivo) antes de alterar.'; end if;
  update public.fin_lancamentos set
    descricao = coalesce(public._fin_t(p, 'descricao'), descricao),
    contraparte = coalesce(p ->> 'contraparte', contraparte),
    categoria_id = case when p ? 'categoria_id' then public._fin_t(p, 'categoria_id')::bigint else categoria_id end,
    conta_id = case when p ? 'conta_id' then public._fin_t(p, 'conta_id')::bigint else conta_id end,
    vencimento = coalesce(public._fin_t(p, 'vencimento')::date, vencimento),
    valor = coalesce(public._fin_t(p, 'valor')::numeric, valor),
    recorrencia = coalesce(public._fin_t(p, 'recorrencia'), recorrencia),
    obs = coalesce(p ->> 'obs', obs)
  where id = v_id returning * into d;
  perform public._fin_auditar('financeiro_lancamento_alterado', jsonb_build_object('lancamento_id', v_id, 'descricao', d.descricao,
    'antes', public._fin_lanc_json(a), 'depois', public._fin_lanc_json(d)));
  return v_id;
end $$;

-- próximo vencimento da série (mensal: mesmo dia, ou o último do mês; anual: +1 ano)
create or replace function public._fin_proximo(p_venc date, p_rec text) returns date
language sql immutable as $$
  select case p_rec when 'mensal' then (p_venc + interval '1 month')::date when 'anual' then (p_venc + interval '1 year')::date end
$$;

create or replace function public.fin_lancamento_pagar(p_id bigint, p_pago_em date, p_valor numeric, p_conta bigint, p_obs text default '')
returns bigint language plpgsql security definer set search_path = public as $$
declare a public.fin_lancamentos; d public.fin_lancamentos; v_prox date; v_valor numeric; c public.fin_custos; v_novo bigint;
begin
  perform public._fin_admin();
  select * into a from public.fin_lancamentos where id = p_id for update;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  if a.cancelado_em is not null then raise exception 'Lançamento cancelado não recebe baixa.'; end if;
  if a.pago_em is not null then raise exception 'Este lançamento já foi baixado.'; end if;
  if p_pago_em is null then raise exception 'Informe a data do pagamento.'; end if;
  if p_pago_em > public._fin_hoje() then raise exception 'A data do pagamento não pode ser futura.'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Informe o valor pago.'; end if;
  if p_conta is null then raise exception 'Informe a conta do pagamento.'; end if;
  if not exists (select 1 from public.fin_contas where id = p_conta) then raise exception 'Conta não encontrada.'; end if;
  update public.fin_lancamentos set pago_em = p_pago_em, valor_pago = p_valor, conta_pago_id = p_conta,
    obs = case when coalesce(trim(p_obs), '') = '' then obs else trim(both from obs || E'\n' || p_obs) end
  where id = p_id returning * into d;
  perform public._fin_auditar(case when d.tipo = 'pagar' then 'financeiro_pagamento_baixado' else 'financeiro_recebimento_baixado' end,
    jsonb_build_object('lancamento_id', p_id, 'descricao', d.descricao, 'vencimento', d.vencimento, 'valor', d.valor,
      'pago_em', p_pago_em, 'valor_pago', p_valor, 'conta', (select nome from public.fin_contas where id = p_conta)));
  -- recorrência: sempre existe a próxima em aberto
  if d.recorrencia <> 'nenhuma' and not exists (select 1 from public.fin_lancamentos x where x.serie_id = d.serie_id and x.id <> d.id
        and x.vencimento > d.vencimento and x.cancelado_em is null) then
    v_prox := public._fin_proximo(d.vencimento, d.recorrencia); v_valor := d.valor;
    if d.custo_id is not null then
      select * into c from public.fin_custos where id = d.custo_id;
      if c.ate is not null and v_prox > c.ate then return null; end if;
      if c.valor_brl > 0 then v_valor := c.valor_brl; end if;
    end if;
    insert into public.fin_lancamentos (tipo, descricao, contraparte, categoria_id, conta_id, vencimento, valor, recorrencia, serie_id, custo_id, criado_nome)
    values (d.tipo, d.descricao, d.contraparte, d.categoria_id, d.conta_id, v_prox, v_valor, d.recorrencia, d.serie_id, d.custo_id, 'recorrência')
    returning id into v_novo;
    perform public._fin_auditar('financeiro_recorrencia_gerada', jsonb_build_object('lancamento_id', v_novo, 'de', d.id,
      'descricao', d.descricao, 'vencimento', v_prox, 'valor', v_valor));
  end if;
  return v_novo;
end $$;

create or replace function public.fin_lancamento_desfazer(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.fin_lancamentos;
begin
  perform public._fin_admin();
  if length(coalesce(trim(p_motivo), '')) < 5 then raise exception 'Informe o motivo para desfazer a baixa (pelo menos 5 letras).'; end if;
  select * into a from public.fin_lancamentos where id = p_id for update;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  if a.pago_em is null then raise exception 'Este lançamento não tem baixa.'; end if;
  update public.fin_lancamentos set pago_em = null, valor_pago = null, conta_pago_id = null where id = p_id;
  perform public._fin_auditar('financeiro_baixa_desfeita', jsonb_build_object('lancamento_id', p_id, 'descricao', a.descricao, 'motivo', trim(p_motivo),
    'pago_em', a.pago_em, 'valor_pago', a.valor_pago, 'conta', (select nome from public.fin_contas where id = a.conta_pago_id)));
end $$;

create or replace function public.fin_lancamento_cancelar(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.fin_lancamentos;
begin
  perform public._fin_admin();
  if length(coalesce(trim(p_motivo), '')) < 5 then raise exception 'Informe o motivo do cancelamento (pelo menos 5 letras).'; end if;
  select * into a from public.fin_lancamentos where id = p_id for update;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  if a.cancelado_em is not null then raise exception 'Este lançamento já está cancelado.'; end if;
  if a.pago_em is not null then raise exception 'Lançamento baixado: desfaça a baixa antes de cancelar.'; end if;
  update public.fin_lancamentos set cancelado_em = now(), cancelado_motivo = trim(p_motivo) where id = p_id;
  perform public._fin_auditar('financeiro_lancamento_cancelado', jsonb_build_object('lancamento_id', p_id, 'descricao', a.descricao,
    'vencimento', a.vencimento, 'valor', a.valor, 'motivo', trim(p_motivo)));
end $$;

create or replace function public.fin_lancamento_anexo(p_id bigint, p_caminho text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.fin_lancamentos;
begin
  perform public._fin_admin();
  select * into a from public.fin_lancamentos where id = p_id for update;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  if coalesce(p_caminho, '') <> '' and p_caminho not like 'lancamentos/' || p_id || '/%' then raise exception 'Caminho do anexo inválido.'; end if;
  update public.fin_lancamentos set anexo = coalesce(p_caminho, '') where id = p_id;
  perform public._fin_auditar('financeiro_anexo', jsonb_build_object('lancamento_id', p_id, 'descricao', a.descricao, 'antes', a.anexo, 'depois', coalesce(p_caminho, '')));
end $$;

-- custo recorrente → conta a pagar (com a recorrência do custo); a próxima nasce a cada baixa
create or replace function public.fin_custo_gerar_conta(p_custo bigint, p_vencimento date) returns bigint
language plpgsql security definer set search_path = public as $$
declare c public.fin_custos;
begin
  perform public._fin_admin();
  select * into c from public.fin_custos where id = p_custo;
  if not found then raise exception 'Custo não encontrado.'; end if;
  if p_vencimento is null then raise exception 'Informe o vencimento.'; end if;
  if c.valor_brl <= 0 then raise exception 'Custo sem valor em reais.'; end if;
  if exists (select 1 from public.fin_lancamentos where custo_id = p_custo and pago_em is null and cancelado_em is null) then
    raise exception 'Este custo já tem uma conta a pagar em aberto.';
  end if;
  return public.fin_lancamento_salvar(jsonb_build_object('tipo', 'pagar', 'descricao', c.nome, 'contraparte', c.fornecedor,
    'categoria_id', c.categoria_id, 'conta_id', c.conta_id, 'vencimento', p_vencimento, 'valor', c.valor_brl,
    'recorrencia', c.periodicidade, 'custo_id', c.id));
end $$;

-- ---------------------------------------------------------------- transferências e acerto de saldo
create or replace function public.fin_transferir(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare d public.fin_transferencias;
begin
  perform public._fin_admin();
  if public._fin_t(p, 'de_conta') is null or public._fin_t(p, 'para_conta') is null then raise exception 'Informe as duas contas.'; end if;
  if public._fin_t(p, 'de_conta') = public._fin_t(p, 'para_conta') then raise exception 'As contas de origem e destino são a mesma.'; end if;
  if coalesce(public._fin_t(p, 'valor')::numeric, 0) <= 0 then raise exception 'Informe o valor (maior que zero).'; end if;
  if coalesce(public._fin_t(p, 'data')::date, public._fin_hoje()) > public._fin_hoje() then raise exception 'A data não pode ser futura.'; end if;
  insert into public.fin_transferencias (data, de_conta, para_conta, valor, descricao, criado_nome)
  values (coalesce(public._fin_t(p, 'data')::date, public._fin_hoje()), public._fin_t(p, 'de_conta')::bigint, public._fin_t(p, 'para_conta')::bigint,
          public._fin_t(p, 'valor')::numeric, coalesce(p ->> 'descricao', ''), public._fin_quem())
  returning * into d;
  perform public._fin_auditar('financeiro_transferencia', jsonb_build_object('transferencia_id', d.id, 'data', d.data, 'valor', d.valor,
    'de', (select nome from public.fin_contas where id = d.de_conta), 'para', (select nome from public.fin_contas where id = d.para_conta), 'descricao', d.descricao));
  return d.id;
end $$;

create or replace function public.fin_transferencia_cancelar(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.fin_transferencias;
begin
  perform public._fin_admin();
  if length(coalesce(trim(p_motivo), '')) < 5 then raise exception 'Informe o motivo do cancelamento (pelo menos 5 letras).'; end if;
  select * into a from public.fin_transferencias where id = p_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  if a.cancelado_em is not null then raise exception 'Esta transferência já está cancelada.'; end if;
  update public.fin_transferencias set cancelado_em = now(), cancelado_motivo = trim(p_motivo) where id = p_id;
  perform public._fin_auditar('financeiro_transferencia_cancelada', jsonb_build_object('transferencia_id', p_id, 'data', a.data, 'valor', a.valor, 'motivo', trim(p_motivo)));
end $$;

create or replace function public.fin_saldo_acertar(p_conta bigint, p_data date, p_saldo numeric, p_motivo text) returns numeric
language plpgsql security definer set search_path = public as $$
declare d public.fin_ajustes; k public.fin_contas;
begin
  perform public._fin_admin();
  if length(coalesce(trim(p_motivo), '')) < 5 then raise exception 'Informe o motivo do acerto (pelo menos 5 letras).'; end if;
  if p_saldo is null then raise exception 'Informe o saldo do banco.'; end if;
  select * into k from public.fin_contas where id = p_conta for update;
  if not found then raise exception 'Conta não encontrada.'; end if;
  if coalesce(p_data, public._fin_hoje()) > public._fin_hoje() then raise exception 'A data não pode ser futura.'; end if;
  if coalesce(p_data, public._fin_hoje()) < k.saldo_inicial_em then raise exception 'A data é anterior ao saldo inicial da conta.'; end if;
  insert into public.fin_ajustes (conta_id, data, saldo_informado, saldo_calculado, motivo, criado_nome)
  values (p_conta, coalesce(p_data, public._fin_hoje()), p_saldo, public._fin_saldo(p_conta, coalesce(p_data, public._fin_hoje())), trim(p_motivo), public._fin_quem())
  returning * into d;
  perform public._fin_auditar('financeiro_saldo_acertado', jsonb_build_object('conta', k.nome, 'data', d.data, 'saldo_informado', d.saldo_informado,
    'saldo_calculado', d.saldo_calculado, 'diferenca', d.diferenca, 'motivo', d.motivo));
  return d.diferenca;
end $$;

-- ---------------------------------------------------------------- carga da planilha (só pelo SQL do Supabase)
-- p = {"custos": [{nome, fornecedor, grupo, categoria, moeda, valor, cambio, periodicidade, desde, ate, obs, historico:[{em, motivo, antes, depois}]}],
--      "abas": [{aba, dados}], "arquivo": "nome do arquivo"}
-- recusa se já houver custos; tudo numa transação; auditoria financeiro_carga com as contagens
create or replace function public._fin_carga(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; h jsonb; v_id bigint; n_c int := 0; n_h int := 0; n_a int := 0; v_cat bigint;
begin
  if exists (select 1 from public.fin_custos) then raise exception 'Carga recusada: já há custos cadastrados.'; end if;
  for c in select * from jsonb_array_elements(coalesce(p -> 'custos', '[]')) loop
    select id into v_cat from public.fin_categorias where lower(nome) = lower(coalesce(c ->> 'categoria', 'Infraestrutura / plataforma'));
    insert into public.fin_custos (nome, fornecedor, grupo, categoria_id, conta_id, moeda, valor, cambio, periodicidade, desde, ate, obs)
    values (c ->> 'nome', coalesce(c ->> 'fornecedor', ''), coalesce(nullif(c ->> 'grupo', ''), 'Plataforma'), v_cat,
            (select id from public.fin_contas where lower(nome) = lower(coalesce(c ->> 'conta', ''))),
            coalesce(nullif(c ->> 'moeda', ''), 'BRL'), (c ->> 'valor')::numeric, nullif(c ->> 'cambio', '')::numeric,
            coalesce(nullif(c ->> 'periodicidade', ''), 'mensal'), (c ->> 'desde')::date, nullif(c ->> 'ate', '')::date, coalesce(c ->> 'obs', ''))
    returning id into v_id;
    n_c := n_c + 1;
    if jsonb_array_length(coalesce(c -> 'historico', '[]')) = 0 then
      insert into public.fin_custos_hist (custo_id, em, quem, motivo, depois)
      select v_id, now(), 'carga da planilha', 'carga da planilha', to_jsonb(x) - array['criado_em', 'atualizado_em', 'valor_brl', 'mensal_brl'] from public.fin_custos x where x.id = v_id;
      n_h := n_h + 1;
    end if;
    for h in select * from jsonb_array_elements(coalesce(c -> 'historico', '[]')) loop
      insert into public.fin_custos_hist (custo_id, em, quem, motivo, antes, depois)
      values (v_id, coalesce((h ->> 'em')::timestamptz, now()), 'carga da planilha', coalesce(h ->> 'motivo', ''), h -> 'antes', h -> 'depois');
      n_h := n_h + 1;
    end loop;
  end loop;
  for c in select * from jsonb_array_elements(coalesce(p -> 'abas', '[]')) loop
    insert into public.fin_planilha (aba, dados) values (c ->> 'aba', c -> 'dados'); n_a := n_a + 1;
  end loop;
  perform public.auditar('financeiro_carga', null, jsonb_build_object('arquivo', coalesce(p ->> 'arquivo', ''), 'custos', n_c, 'historico', n_h, 'abas', n_a,
    'mensal_plataforma', (select sum(mensal_brl) from public.fin_custos where grupo = 'Plataforma' and ate is null)));
  return jsonb_build_object('custos', n_c, 'historico', n_h, 'abas', n_a);
end $$;
revoke execute on function public._fin_carga(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- permissões das funções
do $$
declare f text;
begin
  foreach f in array array['fin_saldos(date)', 'fin_conta_salvar(jsonb)', 'fin_categoria_salvar(jsonb)', 'fin_config_salvar(jsonb)',
    'fin_custo_salvar(jsonb)', 'fin_lancamento_salvar(jsonb)', 'fin_lancamento_pagar(bigint, date, numeric, bigint, text)',
    'fin_lancamento_desfazer(bigint, text)', 'fin_lancamento_cancelar(bigint, text)', 'fin_lancamento_anexo(bigint, text)',
    'fin_custo_gerar_conta(bigint, date)', 'fin_transferir(jsonb)', 'fin_transferencia_cancelar(bigint, text)',
    'fin_saldo_acertar(bigint, date, numeric, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- anexos (boleto, nota, comprovante): privado, só admin
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fin-arquivos', 'fin-arquivos', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
drop policy if exists fin_arquivos_ler on storage.objects;
create policy fin_arquivos_ler on storage.objects for select to authenticated using (bucket_id = 'fin-arquivos' and (select public.eh_admin()));
drop policy if exists fin_arquivos_enviar on storage.objects;
create policy fin_arquivos_enviar on storage.objects for insert to authenticated with check (bucket_id = 'fin-arquivos' and (select public.eh_admin()));

-- ---------------------------------------------------------------- cadastro do app (oculto, só a equipe Nervia)
insert into public.apps (id, nome, descricao, url, icone, ordem, ativo, cartao_url, manual_url, situacao)
values ('financeiro', 'Financeiro Nervia', 'Custos, contas a pagar, contas a receber e saldo das contas da Nervia.',
        '/apps/financeiro/', 'FN', 96, true, '/apps/financeiro/ajuda/cartao.html', '/apps/financeiro/ajuda/manual.html', 'oculto')
on conflict (id) do nothing;
