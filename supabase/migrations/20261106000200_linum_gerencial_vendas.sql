-- Sistema Linum 2.37: Gerencial, fase 2 — Vendas Rede e Análise de Vendas (autorizada pelo Marco em 06/11/2026: "siga com a
-- próxima fase e já aplica"). Mesmas regras do painel antigo (HISTORICO_LINUM.md):
--   * lin_ger_rede = uma venda da maquininha Rede (data e hora REAIS da venda, não a do crédito no banco): terminal, loja,
--     modalidade (crédito/débito/Pix), tipo (à vista, parcelado…), parcelas, bandeira, bruto, taxas MDR e de antecipação (% e R$),
--     líquido, prazo. A loja vem do terminal (lin_ger_terminais; o nome do estabelecimento vem sempre "LINUM IPANEMA" nos dois).
--     "chave" única (data|hora|terminal|bruto|nº) e o NSU, quando o arquivo tem, impedem a mesma venda duas vezes.
--     O Pix mensal da maquininha entra como uma venda do último dia do mês (terminal PIX-QR, loja Não identificada, sem taxa).
--   * lin_ger_outras_vendas = vendas fora da maquininha (caderno: dinheiro, Pix direto), uma por loja e mês, no último dia do
--     mês. Entram nos totais e no gráfico por mês da Análise de Vendas, NUNCA nas estatísticas por dia.
--   * lin_ger_terminais = terminal da maquininha → loja (carga pelo SQL; a tela do Dono pode corrigir).
-- Só o Dono (lin_eh_dono) lê; escrita só pelas funções, auditadas (linum_gerencial_*). Só tabelas novas.

alter table public.lin_ger_importacoes drop constraint if exists lin_ger_importacoes_conta_check;
alter table public.lin_ger_importacoes add constraint lin_ger_importacoes_conta_check check (conta in ('itau', 'nubank', 'rede'));

create table if not exists public.lin_ger_terminais (
  terminal      text primary key check (length(btrim(terminal)) > 0),
  loja          text not null check (length(btrim(loja)) > 0),
  observacao    text not null default '',
  alterado_em   timestamptz not null default now(),
  alterado_nome text not null default ''
);

create table if not exists public.lin_ger_rede (
  id            bigserial primary key,
  data          date not null,
  hora          time,
  terminal      text not null default '',
  loja          text not null default 'Não identificada',
  modalidade    text not null default '',
  tipo          text not null default '',
  parcelas      int not null default 1 check (parcelas between 0 and 99),
  bandeira      text not null default '',
  bruto         numeric(14,2) not null check (bruto <> 0),
  mdr_pct       numeric(8,4) not null default 0,
  mdr_val       numeric(14,2) not null default 0,
  ant_pct       numeric(8,4) not null default 0,
  ant_val       numeric(14,2) not null default 0,
  tx_pct        numeric(8,4) not null default 0,
  tx_val        numeric(14,2) not null default 0,
  liquido       numeric(14,2) not null default 0,
  prazo         text not null default '',
  nsu           text,
  chave         text not null unique,
  importacao_id bigint references public.lin_ger_importacoes on delete set null,
  criado_em     timestamptz not null default now(),
  criado_nome   text not null default ''
);
create unique index if not exists lin_ger_rede_nsu on public.lin_ger_rede (nsu) where nsu is not null and nsu <> '';
create index if not exists lin_ger_rede_data on public.lin_ger_rede (data);

create table if not exists public.lin_ger_outras_vendas (
  id          bigserial primary key,
  data        date not null,
  loja        text not null check (length(btrim(loja)) > 0),
  valor       numeric(14,2) not null check (valor <> 0),   -- negativo = desconto (ex.: venda-teste da maquininha)
  descricao   text not null default '',
  criado_em   timestamptz not null default now(),
  criado_nome text not null default ''
);
create index if not exists lin_ger_outras_data on public.lin_ger_outras_vendas (data);

alter table public.lin_ger_terminais     enable row level security;
alter table public.lin_ger_rede          enable row level security;
alter table public.lin_ger_outras_vendas enable row level security;
revoke all on public.lin_ger_terminais, public.lin_ger_rede, public.lin_ger_outras_vendas from anon;
revoke insert, update, delete, truncate on public.lin_ger_terminais, public.lin_ger_rede, public.lin_ger_outras_vendas from authenticated;
grant select on public.lin_ger_terminais, public.lin_ger_rede, public.lin_ger_outras_vendas to authenticated;
drop policy if exists lin_ger_terminais_ler on public.lin_ger_terminais;
create policy lin_ger_terminais_ler on public.lin_ger_terminais for select using (public.lin_eh_dono());
drop policy if exists lin_ger_rede_ler on public.lin_ger_rede;
create policy lin_ger_rede_ler on public.lin_ger_rede for select using (public.lin_eh_dono());
drop policy if exists lin_ger_outras_ler on public.lin_ger_outras_vendas;
create policy lin_ger_outras_ler on public.lin_ger_outras_vendas for select using (public.lin_eh_dono());

-- ---------------------------------------------------------------- importar vendas da Rede (tudo ou nada; repetidas puladas)
-- p = {arquivo, vendas:[{chave, nsu?, data, hora?, terminal, loja?, modalidade, tipo, parcelas, bandeira, bruto, mdr_pct, mdr_val,
--      ant_pct, ant_val, tx_pct, tx_val, liquido, prazo}]}; loja vazia = a do terminal (lin_ger_terminais) ou "Não identificada"
create or replace function public.lin_ger_rede_importar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_imp bigint; v jsonb; v_novos int := 0; v_rep int := 0; v_sem int := 0; v_de date; v_ate date; v_data date; v_chave text; v_nsu text;
        v_bruto numeric; v_loja text; v_term text; v_tot numeric := 0; n numeric;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera o Gerencial'; end if;
  if jsonb_typeof(p -> 'vendas') <> 'array' or jsonb_array_length(p -> 'vendas') = 0 then raise exception 'O arquivo não tem vendas para importar'; end if;
  insert into public.lin_ger_importacoes (conta, arquivo, criado_nome) values ('rede', left(coalesce(p ->> 'arquivo', ''), 200), public._lin_nome())
  returning id into v_imp;
  for v in select * from jsonb_array_elements(p -> 'vendas') loop
    v_chave := public._lin_txt(v, 'chave');
    if v_chave is null then raise exception 'Venda sem chave'; end if;
    begin v_data := (v ->> 'data')::date; exception when others then raise exception 'Data inválida: %', v ->> 'data'; end;
    if v_data is null then raise exception 'Venda sem data'; end if;
    begin v_bruto := round((v ->> 'bruto')::numeric, 2); exception when others then raise exception 'Valor inválido em %', to_char(v_data, 'DD/MM/YYYY'); end;
    if coalesce(v_bruto, 0) = 0 then raise exception 'Venda sem valor em %', to_char(v_data, 'DD/MM/YYYY'); end if;
    v_nsu := public._lin_txt(v, 'nsu');
    if exists (select 1 from public.lin_ger_rede where chave = v_chave) or (v_nsu is not null and exists (select 1 from public.lin_ger_rede where nsu = v_nsu)) then
      v_rep := v_rep + 1; continue;
    end if;
    v_term := coalesce(public._lin_txt(v, 'terminal'), '');
    v_loja := coalesce(public._lin_txt(v, 'loja'), (select loja from public.lin_ger_terminais where terminal = v_term), 'Não identificada');
    if v_loja = 'Não identificada' then v_sem := v_sem + 1; end if;
    insert into public.lin_ger_rede (data, hora, terminal, loja, modalidade, tipo, parcelas, bandeira, bruto, mdr_pct, mdr_val, ant_pct, ant_val,
                                     tx_pct, tx_val, liquido, prazo, nsu, chave, importacao_id, criado_nome)
    values (v_data, nullif(v ->> 'hora', '')::time, v_term, v_loja, coalesce(public._lin_txt(v, 'modalidade'), ''), coalesce(public._lin_txt(v, 'tipo'), ''),
            coalesce(nullif(v ->> 'parcelas', '')::int, 1), coalesce(public._lin_txt(v, 'bandeira'), ''), v_bruto,
            coalesce(nullif(v ->> 'mdr_pct', '')::numeric, 0), coalesce(nullif(v ->> 'mdr_val', '')::numeric, 0),
            coalesce(nullif(v ->> 'ant_pct', '')::numeric, 0), coalesce(nullif(v ->> 'ant_val', '')::numeric, 0),
            coalesce(nullif(v ->> 'tx_pct', '')::numeric, 0), coalesce(nullif(v ->> 'tx_val', '')::numeric, 0),
            coalesce(nullif(v ->> 'liquido', '')::numeric, v_bruto), coalesce(public._lin_txt(v, 'prazo'), ''), v_nsu, v_chave, v_imp, public._lin_nome());
    v_novos := v_novos + 1; v_tot := v_tot + v_bruto;
    v_de := least(coalesce(v_de, v_data), v_data); v_ate := greatest(coalesce(v_ate, v_data), v_data);
  end loop;
  update public.lin_ger_importacoes set novos = v_novos, repetidos = v_rep, de = v_de, ate = v_ate where id = v_imp;
  perform public._lin_auditar('linum_gerencial_rede_importada', null, jsonb_build_object('importacao_id', v_imp, 'arquivo', p ->> 'arquivo',
    'de', v_de, 'ate', v_ate, 'novas', v_novos, 'repetidas', v_rep, 'sem_loja', v_sem, 'bruto', round(v_tot, 2)));
  return jsonb_build_object('importacao_id', v_imp, 'novas', v_novos, 'repetidas', v_rep, 'sem_loja', v_sem);
end $$;

-- excluir uma venda importada por engano (ex.: a sócia passou o próprio cartão para levantar caixa), com motivo
create or replace function public.lin_ger_rede_excluir(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.lin_ger_rede;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera o Gerencial'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escreva o motivo da exclusão (ao menos 5 letras)'; end if;
  delete from public.lin_ger_rede where id = p_id returning * into r;
  if not found then raise exception 'Venda não encontrada'; end if;
  perform public._lin_auditar('linum_gerencial_rede_excluida', null, jsonb_build_object('motivo', btrim(p_motivo), 'venda', to_jsonb(r) - array['criado_em']));
end $$;

-- ---------------------------------------------------------------- outras vendas (fora da maquininha)
create or replace function public.lin_ger_outra_venda_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_data date; v_valor numeric; v_loja text := public._lin_txt(p, 'loja'); v_id bigint;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera o Gerencial'; end if;
  begin v_data := (p ->> 'data')::date; exception when others then raise exception 'Data inválida'; end;
  if v_data is null then raise exception 'Informe a data (o último dia do mês da venda)'; end if;
  begin v_valor := round((p ->> 'valor')::numeric, 2); exception when others then raise exception 'Valor inválido'; end;
  if coalesce(v_valor, 0) = 0 then raise exception 'Informe o valor'; end if;
  if v_loja is null then raise exception 'Escolha a loja'; end if;
  insert into public.lin_ger_outras_vendas (data, loja, valor, descricao, criado_nome)
  values (v_data, v_loja, v_valor, coalesce(public._lin_txt(p, 'descricao'), 'Venda no caderno'), public._lin_nome()) returning id into v_id;
  perform public._lin_auditar('linum_gerencial_outra_venda_incluida', null, jsonb_build_object('id', v_id, 'data', v_data, 'loja', v_loja, 'valor', v_valor,
    'descricao', public._lin_txt(p, 'descricao')));
  return v_id;
end $$;

create or replace function public.lin_ger_outra_venda_excluir(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.lin_ger_outras_vendas;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera o Gerencial'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escreva o motivo da exclusão (ao menos 5 letras)'; end if;
  delete from public.lin_ger_outras_vendas where id = p_id returning * into o;
  if not found then raise exception 'Venda não encontrada'; end if;
  perform public._lin_auditar('linum_gerencial_outra_venda_excluida', null, jsonb_build_object('motivo', btrim(p_motivo), 'venda', to_jsonb(o) - array['criado_em']));
end $$;

-- ---------------------------------------------------------------- terminal → loja (vale para as próximas importações)
create or replace function public.lin_ger_terminal_salvar(p_terminal text, p_loja text, p_observacao text default '') returns void
language plpgsql security definer set search_path = public as $$
declare v_antes text;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera o Gerencial'; end if;
  if length(btrim(coalesce(p_terminal, ''))) = 0 then raise exception 'Informe o código do terminal'; end if;
  if length(btrim(coalesce(p_loja, ''))) = 0 then raise exception 'Escolha a loja do terminal'; end if;
  select loja into v_antes from public.lin_ger_terminais where terminal = btrim(p_terminal);
  insert into public.lin_ger_terminais (terminal, loja, observacao, alterado_nome) values (btrim(p_terminal), btrim(p_loja), coalesce(p_observacao, ''), public._lin_nome())
  on conflict (terminal) do update set loja = excluded.loja, observacao = excluded.observacao, alterado_em = now(), alterado_nome = excluded.alterado_nome;
  perform public._lin_auditar('linum_gerencial_terminal', null, jsonb_build_object('terminal', btrim(p_terminal), 'loja', btrim(p_loja), 'loja_antes', v_antes));
end $$;

revoke execute on function public.lin_ger_rede_importar(jsonb), public.lin_ger_rede_excluir(bigint, text), public.lin_ger_outra_venda_salvar(jsonb),
  public.lin_ger_outra_venda_excluir(bigint, text), public.lin_ger_terminal_salvar(text, text, text) from public, anon;
grant execute on function public.lin_ger_rede_importar(jsonb), public.lin_ger_rede_excluir(bigint, text), public.lin_ger_outra_venda_salvar(jsonb),
  public.lin_ger_outra_venda_excluir(bigint, text), public.lin_ger_terminal_salvar(text, text, text) to authenticated;
