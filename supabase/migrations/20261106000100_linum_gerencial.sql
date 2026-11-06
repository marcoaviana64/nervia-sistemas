-- Sistema Linum 2.36: Gerencial (fase 1) — o "Dashboard Gerencial" da Linum (arquivo HTML com os dados escritos dentro,
-- atualizado à mão no computador do Marco) passa para dentro do app. Pedido do Marco em 06/11/2026: "só admin e dono veem";
-- as Considerações continuam escritas pela Nervia (Claude), a pedido.
-- Fase 1 = extratos bancários (Itaú e Nubank): Visão geral, Categorias, Lançamentos, Considerações e Importar.
--   * lin_ger_lancamentos  = um lançamento do extrato (data do extrato, nunca calculada), crédito OU débito, classe
--     (ex.: Insumos) e classificação (ex.: Costureira). "chave" única (conta|data|valor|descrição|nº) e, quando o
--     arquivo tem, o FITID do OFX impedem importar o mesmo lançamento duas vezes. revisar = ainda "a classificar".
--   * lin_ger_regras       = regras fixas de classificação (trecho da descrição → classe/classificação), as mesmas
--     que o Marco foi confirmando no painel antigo; a tela aplica na importação. Regras com nomes/CPF reais entram
--     pela carga no SQL do Supabase (dados reais não vão para o GitHub).
--     Conta "socia" = lançamento fora do banco (ex.: a sócia pagou uma conta da empresa com dinheiro dela = Aporte), só à mão
--     (lin_ger_lancamento_incluir), com motivo.
--   * lin_ger_importacoes  = cada arquivo importado (conta, período, quantos entraram, saldo do extrato).
--   * lin_ger_consideracoes = análise do mês (nota A–D, números da análise e o texto), e "final" = avaliação executiva.
--     Escrita só pelo SQL da equipe Nervia (_lin_ger_consideracao_gravar), com auditoria.
-- Leitura e escrita: só o Dono (inclui a equipe Nervia, lin_eh_dono). Escrita só pelas funções, todas auditadas
-- (linum_gerencial_*). Classes neutras (fora de receita e despesa): Transferência Interna, Aportes, Retiradas.
-- Só tabelas novas: não mexe em nenhum dado do Linum. Entram sozinhas na cópia noturna (lin_copia_fazer copia public.lin_*).

create table if not exists public.lin_ger_importacoes (
  id           bigserial primary key,
  conta        text not null check (conta in ('itau', 'nubank')),
  arquivo      text not null default '',
  de           date,
  ate          date,
  novos        int not null default 0,
  repetidos    int not null default 0,
  saldo_final  numeric(14,2),                 -- saldo informado no extrato (OFX: LEDGERBAL), se houver
  saldo_data   date,
  observacao   text not null default '',
  criado_em    timestamptz not null default now(),
  criado_nome  text not null default ''
);

create table if not exists public.lin_ger_regras (
  id            bigserial primary key,
  padrao        text not null check (length(btrim(padrao)) >= 3),   -- trecho da descrição (sem diferença de acento/maiúscula)
  conta         text not null default '' check (conta in ('', 'itau', 'nubank')),   -- vazio = as duas
  tipo          text not null default '' check (tipo in ('', 'credito', 'debito')), -- vazio = os dois
  classe        text not null check (length(btrim(classe)) > 0),
  classificacao text not null default '',
  prioridade    int not null default 100,     -- menor = vale antes
  ativo         boolean not null default true,
  observacao    text not null default '',
  criado_em     timestamptz not null default now(),
  criado_nome   text not null default '',
  alterado_em   timestamptz not null default now(),
  alterado_nome text not null default ''
);

create table if not exists public.lin_ger_lancamentos (
  id             bigserial primary key,
  conta          text not null check (conta in ('itau', 'nubank', 'socia')),   -- socia = fora do banco (ex.: aporte pago pela sócia direto)
  data           date not null,
  descricao      text not null default '',
  credito        numeric(14,2) not null default 0 check (credito >= 0),
  debito         numeric(14,2) not null default 0 check (debito >= 0),
  classe         text not null default 'A classificar' check (length(btrim(classe)) > 0),
  classificacao  text not null default '',
  revisar        boolean not null default false,
  chave          text not null unique,
  fitid          text,
  importacao_id  bigint references public.lin_ger_importacoes on delete set null,
  regra_id       bigint references public.lin_ger_regras on delete set null,
  observacao     text not null default '',
  criado_em      timestamptz not null default now(),
  criado_nome    text not null default '',
  alterado_em    timestamptz,
  alterado_nome  text not null default ''
);
create unique index if not exists lin_ger_lanc_fitid on public.lin_ger_lancamentos (conta, fitid) where fitid is not null and fitid <> '';
create index if not exists lin_ger_lanc_data on public.lin_ger_lancamentos (data);

create table if not exists public.lin_ger_consideracoes (
  mes           text primary key check (mes ~ '^\d{4}-\d{2}$' or mes = 'final'),
  titulo        text not null default '',
  nota          text not null default '' check (nota in ('', 'A', 'B', 'C', 'D')),
  nota_texto    text not null default '',      -- ex.: "Bom", "Recuperação, Caixa Apertado"
  metricas      jsonb not null default '[]',   -- [{"rot":"Receita total","val":"R$ 77.988","cor":"pos|neg|neu|ins"}] da data da análise
  corpo         text not null default '',      -- HTML simples (p, ul, li, strong, h4…); a tela limpa antes de mostrar
  atualizado_em timestamptz not null default now(),
  atualizado_nome text not null default ''
);

alter table public.lin_ger_importacoes   enable row level security;
alter table public.lin_ger_regras        enable row level security;
alter table public.lin_ger_lancamentos   enable row level security;
alter table public.lin_ger_consideracoes enable row level security;
revoke all on public.lin_ger_importacoes, public.lin_ger_regras, public.lin_ger_lancamentos, public.lin_ger_consideracoes from anon;
revoke insert, update, delete, truncate on public.lin_ger_importacoes, public.lin_ger_regras, public.lin_ger_lancamentos, public.lin_ger_consideracoes from authenticated;
grant select on public.lin_ger_importacoes, public.lin_ger_regras, public.lin_ger_lancamentos, public.lin_ger_consideracoes to authenticated;
drop policy if exists lin_ger_importacoes_ler on public.lin_ger_importacoes;
create policy lin_ger_importacoes_ler on public.lin_ger_importacoes for select using (public.lin_eh_dono());
drop policy if exists lin_ger_regras_ler on public.lin_ger_regras;
create policy lin_ger_regras_ler on public.lin_ger_regras for select using (public.lin_eh_dono());
drop policy if exists lin_ger_lancamentos_ler on public.lin_ger_lancamentos;
create policy lin_ger_lancamentos_ler on public.lin_ger_lancamentos for select using (public.lin_eh_dono());
drop policy if exists lin_ger_consideracoes_ler on public.lin_ger_consideracoes;
create policy lin_ger_consideracoes_ler on public.lin_ger_consideracoes for select using (public.lin_eh_dono());

-- ---------------------------------------------------------------- importar um extrato (tudo ou nada; repetidos são pulados)
-- p = {conta, arquivo, saldo_final?, saldo_data?, lancamentos:[{chave, fitid?, data, descricao, credito, debito,
--      classe?, classificacao?, regra_id?, revisar?}]}
create or replace function public.lin_ger_importar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_conta text := lower(coalesce(p ->> 'conta', '')); v_imp bigint; l jsonb; v_novos int := 0; v_rep int := 0;
        v_de date; v_ate date; v_c numeric; v_d numeric; v_data date; v_chave text; v_fitid text; v_cred numeric := 0; v_deb numeric := 0;
        v_rev int := 0; v_ids bigint;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera o Gerencial'; end if;
  if v_conta not in ('itau', 'nubank') then raise exception 'Escolha a conta do extrato (Itaú ou Nubank)'; end if;
  if jsonb_typeof(p -> 'lancamentos') <> 'array' or jsonb_array_length(p -> 'lancamentos') = 0 then
    raise exception 'O arquivo não tem lançamentos para importar';
  end if;
  insert into public.lin_ger_importacoes (conta, arquivo, saldo_final, saldo_data, criado_nome)
  values (v_conta, left(coalesce(p ->> 'arquivo', ''), 200), nullif(p ->> 'saldo_final', '')::numeric,
          nullif(p ->> 'saldo_data', '')::date, public._lin_nome())
  returning id into v_imp;
  for l in select * from jsonb_array_elements(p -> 'lancamentos') loop
    v_chave := public._lin_txt(l, 'chave');
    if v_chave is null then raise exception 'Lançamento sem chave'; end if;
    begin v_data := (l ->> 'data')::date; exception when others then raise exception 'Data inválida: %', l ->> 'data'; end;
    if v_data is null then raise exception 'Lançamento sem data'; end if;
    v_c := coalesce(nullif(l ->> 'credito', '')::numeric, 0); v_d := coalesce(nullif(l ->> 'debito', '')::numeric, 0);
    if v_c < 0 or v_d < 0 then raise exception 'Crédito e débito não podem ser negativos'; end if;
    if v_c = 0 and v_d = 0 then raise exception 'Lançamento sem valor em %', to_char(v_data, 'DD/MM/YYYY'); end if;
    v_fitid := public._lin_txt(l, 'fitid');
    if exists (select 1 from public.lin_ger_lancamentos where chave = v_chave)
       or (v_fitid is not null and exists (select 1 from public.lin_ger_lancamentos where conta = v_conta and fitid = v_fitid)) then
      v_rep := v_rep + 1; continue;
    end if;
    insert into public.lin_ger_lancamentos (conta, data, descricao, credito, debito, classe, classificacao, revisar, chave, fitid,
                                            importacao_id, regra_id, criado_nome)
    values (v_conta, v_data, left(coalesce(l ->> 'descricao', ''), 500), round(v_c, 2), round(v_d, 2),
            coalesce(public._lin_txt(l, 'classe'), 'A classificar'), coalesce(public._lin_txt(l, 'classificacao'), ''),
            coalesce((l ->> 'revisar')::boolean, public._lin_txt(l, 'classe') is null), v_chave, v_fitid, v_imp,
            (select id from public.lin_ger_regras where id = nullif(l ->> 'regra_id', '')::bigint), public._lin_nome())
    returning id into v_ids;
    v_novos := v_novos + 1; v_cred := v_cred + v_c; v_deb := v_deb + v_d;
    v_de := least(coalesce(v_de, v_data), v_data); v_ate := greatest(coalesce(v_ate, v_data), v_data);
    if (select revisar from public.lin_ger_lancamentos where id = v_ids) then v_rev := v_rev + 1; end if;
  end loop;
  update public.lin_ger_importacoes set novos = v_novos, repetidos = v_rep, de = v_de, ate = v_ate where id = v_imp;
  perform public._lin_auditar('linum_gerencial_importado', null, jsonb_build_object('importacao_id', v_imp, 'conta', v_conta,
    'arquivo', p ->> 'arquivo', 'de', v_de, 'ate', v_ate, 'novos', v_novos, 'repetidos', v_rep, 'a_classificar', v_rev,
    'creditos', round(v_cred, 2), 'debitos', round(v_deb, 2), 'saldo_final', p ->> 'saldo_final'));
  return jsonb_build_object('importacao_id', v_imp, 'novos', v_novos, 'repetidos', v_rep, 'a_classificar', v_rev);
end $$;

-- ---------------------------------------------------------------- classificar (um ou vários)
-- p = {ids:[…], classe, classificacao, observacao?}
create or replace function public.lin_ger_classificar(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_classe text := public._lin_txt(p, 'classe'); v_clas text := coalesce(public._lin_txt(p, 'classificacao'), '');
        v_ids bigint[]; v_itens jsonb; v_n int;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera o Gerencial'; end if;
  if v_classe is null then raise exception 'Escolha a classe (ex.: Insumos, Salários, Receitas)'; end if;
  if v_classe = 'A classificar' then raise exception 'Escolha uma classe de verdade'; end if;
  select array_agg(x::bigint) into v_ids from jsonb_array_elements_text(coalesce(p -> 'ids', '[]')) x;
  if v_ids is null then raise exception 'Marque ao menos um lançamento'; end if;
  select jsonb_agg(jsonb_build_object('id', id, 'data', data, 'conta', conta, 'valor', credito - debito, 'descricao', left(descricao, 120),
           'antes', jsonb_build_object('classe', classe, 'classificacao', classificacao)) order by data, id)
    into v_itens from public.lin_ger_lancamentos where id = any(v_ids) and (classe, classificacao) is distinct from (v_classe, v_clas);
  update public.lin_ger_lancamentos set classe = v_classe, classificacao = v_clas, revisar = false,
         observacao = case when p ? 'observacao' then coalesce(public._lin_txt(p, 'observacao'), '') else observacao end,
         alterado_em = now(), alterado_nome = public._lin_nome()
   where id = any(v_ids);
  get diagnostics v_n = row_count;
  if v_n <> cardinality(v_ids) then raise exception 'Lançamento não encontrado'; end if;
  if v_itens is not null then
    perform public._lin_auditar('linum_gerencial_classificado', null, jsonb_build_object('quantidade', jsonb_array_length(v_itens),
      'classe', v_classe, 'classificacao', v_clas, 'lancamentos', v_itens));
  end if;
  return v_n;
end $$;

-- ---------------------------------------------------------------- excluir um lançamento (ex.: transferência que falhou), com motivo
create or replace function public.lin_ger_lancamento_excluir(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare l public.lin_ger_lancamentos;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera o Gerencial'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escreva o motivo da exclusão (ao menos 5 letras)'; end if;
  delete from public.lin_ger_lancamentos where id = p_id returning * into l;
  if not found then raise exception 'Lançamento não encontrado'; end if;
  perform public._lin_auditar('linum_gerencial_lancamento_excluido', null, jsonb_build_object('motivo', btrim(p_motivo),
    'lancamento', to_jsonb(l) - array['criado_em', 'alterado_em']));
end $$;

-- ---------------------------------------------------------------- lançamento fora do banco (à mão)
-- p = {data, descricao, valor (+ entra, − sai), classe, classificacao, observacao (motivo, obrigatório)}
create or replace function public.lin_ger_lancamento_incluir(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_data date; v_valor numeric; v_classe text := public._lin_txt(p, 'classe'); v_desc text := public._lin_txt(p, 'descricao');
        v_obs text := public._lin_txt(p, 'observacao'); v_id bigint;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera o Gerencial'; end if;
  begin v_data := (p ->> 'data')::date; exception when others then raise exception 'Data inválida'; end;
  if v_data is null then raise exception 'Informe a data'; end if;
  if v_data > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'A data não pode ser futura'; end if;
  begin v_valor := round((p ->> 'valor')::numeric, 2); exception when others then raise exception 'Valor inválido'; end;
  if coalesce(v_valor, 0) = 0 then raise exception 'Informe o valor (positivo = entrou, negativo = saiu)'; end if;
  if v_desc is null then raise exception 'Descreva o lançamento'; end if;
  if v_classe is null or v_classe = 'A classificar' then raise exception 'Escolha a classe (ex.: Aportes)'; end if;
  if length(coalesce(v_obs, '')) < 5 then raise exception 'Escreva por que o lançamento não está no extrato (ao menos 5 letras)'; end if;
  insert into public.lin_ger_lancamentos (conta, data, descricao, credito, debito, classe, classificacao, chave, observacao, criado_nome)
  values ('socia', v_data, left(v_desc, 500), greatest(v_valor, 0), greatest(-v_valor, 0), v_classe, coalesce(public._lin_txt(p, 'classificacao'), ''),
          'manual|' || gen_random_uuid(), v_obs, public._lin_nome())
  returning id into v_id;
  perform public._lin_auditar('linum_gerencial_lancamento_incluido', null, jsonb_build_object('lancamento_id', v_id, 'data', v_data,
    'valor', v_valor, 'descricao', v_desc, 'classe', v_classe, 'classificacao', public._lin_txt(p, 'classificacao'), 'motivo', v_obs));
  return v_id;
end $$;

-- ---------------------------------------------------------------- regras de classificação
create or replace function public.lin_ger_regra_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p ->> 'id', '')::bigint; r public.lin_ger_regras; v_antes jsonb;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera o Gerencial'; end if;
  if v_id is null then
    r.padrao := ''; r.classe := ''; r.classificacao := ''; r.conta := ''; r.tipo := ''; r.prioridade := 100; r.ativo := true; r.observacao := '';
  else
    select * into r from public.lin_ger_regras where id = v_id for update;
    if not found then raise exception 'Regra não encontrada'; end if;
    v_antes := to_jsonb(r) - array['id', 'criado_em', 'criado_nome', 'alterado_em', 'alterado_nome'];
  end if;
  if p ? 'padrao' then r.padrao := coalesce(public._lin_txt(p, 'padrao'), ''); end if;
  if length(r.padrao) < 3 then raise exception 'O trecho da descrição precisa de ao menos 3 letras'; end if;
  if p ? 'classe' then r.classe := coalesce(public._lin_txt(p, 'classe'), ''); end if;
  if r.classe = '' or r.classe = 'A classificar' then raise exception 'Escolha a classe da regra'; end if;
  if p ? 'classificacao' then r.classificacao := coalesce(public._lin_txt(p, 'classificacao'), ''); end if;
  if p ? 'conta' then r.conta := lower(coalesce(public._lin_txt(p, 'conta'), '')); end if;
  if p ? 'tipo' then r.tipo := lower(coalesce(public._lin_txt(p, 'tipo'), '')); end if;
  if p ? 'prioridade' then r.prioridade := coalesce(nullif(p ->> 'prioridade', '')::int, 100); end if;
  if p ? 'ativo' then r.ativo := coalesce((p ->> 'ativo')::boolean, true); end if;
  if p ? 'observacao' then r.observacao := coalesce(public._lin_txt(p, 'observacao'), ''); end if;
  if r.conta not in ('', 'itau', 'nubank') then raise exception 'Conta inválida'; end if;
  if r.tipo not in ('', 'credito', 'debito') then raise exception 'Tipo inválido'; end if;
  if v_id is null then
    insert into public.lin_ger_regras (padrao, classe, classificacao, conta, tipo, prioridade, ativo, observacao, criado_nome, alterado_nome)
    values (r.padrao, r.classe, r.classificacao, r.conta, r.tipo, r.prioridade, r.ativo, r.observacao, public._lin_nome(), public._lin_nome())
    returning * into r;
    v_id := r.id;
  else
    update public.lin_ger_regras set padrao = r.padrao, classe = r.classe, classificacao = r.classificacao, conta = r.conta, tipo = r.tipo,
           prioridade = r.prioridade, ativo = r.ativo, observacao = r.observacao, alterado_em = now(), alterado_nome = public._lin_nome()
     where id = v_id returning * into r;
  end if;
  perform public._lin_auditar(case when v_antes is null then 'linum_gerencial_regra_criada' else 'linum_gerencial_regra_alterada' end, null,
    jsonb_build_object('regra_id', v_id, 'padrao', r.padrao, 'classe', r.classe, 'classificacao', r.classificacao, 'antes', v_antes,
      'depois', to_jsonb(r) - array['id', 'criado_em', 'criado_nome', 'alterado_em', 'alterado_nome']));
  return v_id;
end $$;

create or replace function public.lin_ger_regra_excluir(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r public.lin_ger_regras;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera o Gerencial'; end if;
  delete from public.lin_ger_regras where id = p_id returning * into r;
  if not found then raise exception 'Regra não encontrada'; end if;
  perform public._lin_auditar('linum_gerencial_regra_excluida', null, jsonb_build_object('regra_id', r.id, 'padrao', r.padrao,
    'classe', r.classe, 'classificacao', r.classificacao, 'regra', to_jsonb(r) - array['criado_em', 'alterado_em']));
end $$;

-- ---------------------------------------------------------------- considerações (só pelo SQL da equipe Nervia; a tela só lê)
create or replace function public._lin_ger_consideracao_gravar(p_mes text, p_titulo text, p_nota text, p_nota_texto text,
                                                                p_metricas jsonb, p_corpo text, p_autor text) returns void
language plpgsql security definer set search_path = public as $$
declare v_antes public.lin_ger_consideracoes;
begin
  select * into v_antes from public.lin_ger_consideracoes where mes = p_mes;
  insert into public.lin_ger_consideracoes (mes, titulo, nota, nota_texto, metricas, corpo, atualizado_em, atualizado_nome)
  values (p_mes, coalesce(p_titulo, ''), coalesce(p_nota, ''), coalesce(p_nota_texto, ''), coalesce(p_metricas, '[]'), coalesce(p_corpo, ''), now(), coalesce(p_autor, ''))
  on conflict (mes) do update set titulo = excluded.titulo, nota = excluded.nota, nota_texto = excluded.nota_texto,
     metricas = excluded.metricas, corpo = excluded.corpo, atualizado_em = now(), atualizado_nome = excluded.atualizado_nome;
  perform public.auditar('linum_gerencial_consideracao', null, jsonb_build_object('mes', p_mes, 'titulo', p_titulo, 'autor', p_autor,
    'nota', p_nota, 'nota_antes', v_antes.nota, 'nova', v_antes.mes is null, 'tamanho', length(coalesce(p_corpo, '')), 'papel_linum', 'sistema'));
end $$;

revoke execute on function public._lin_ger_consideracao_gravar(text, text, text, text, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.lin_ger_importar(jsonb), public.lin_ger_classificar(jsonb), public.lin_ger_lancamento_excluir(bigint, text),
  public.lin_ger_lancamento_incluir(jsonb), public.lin_ger_regra_salvar(jsonb), public.lin_ger_regra_excluir(bigint) from public, anon;
grant execute on function public.lin_ger_importar(jsonb), public.lin_ger_classificar(jsonb), public.lin_ger_lancamento_excluir(bigint, text),
  public.lin_ger_lancamento_incluir(jsonb), public.lin_ger_regra_salvar(jsonb), public.lin_ger_regra_excluir(bigint) to authenticated;
