-- Sistema Linum 2.70: Gerencial → Contas a pagar (pedido do Marco em 26/11/2026).
-- "O fluxo de pagamento do antigo dashboard estava confuso para definir o que eu tinha para pagar nos meses; pensei numa
-- consulta com os meses no cabeçalho e a lista de contas a pagar por fornecedor, somando no mês/ano o valor a pagar ao
-- fornecedor, e ao clicar no valor abrir o desmembramento daquele valor."
-- Fontes (decisão do Marco): as NF-e de compra que o Buscador de NF baixa (as duplicatas do XML: parcela, vencimento e valor;
-- a tela lê o XML guardado e manda as parcelas) e o XML que ele importar à mão quando a nota chegar por e-mail; contas sem NF-e
-- (aluguel…) lançadas à mão, com repetição mensal. O ERP Olist foi só a carga inicial: as contas do painel antigo entram uma vez
-- pelo SQL do Supabase (origem 'carga', dados reais fora do GitHub).
-- Contas recorrentes (pedido do Marco no mesmo dia: "pelas contas pagas podemos prever contas que são recorrentes e gerar conta
-- recorrente com uma média de valor se o mesmo não for informado ou não for fixo, ex.: conta de luz"): a tela acha no histórico
-- (extratos do Gerencial e contas pagas) o que se repete e propõe gerar as próximas com a média; estimado = true até alguém
-- informar o valor certo (editar) ou pagar.
--   * lin_ger_pagar = uma parcela a pagar. situacao aberta | paga | cancelada. Paga = data e valor pagos e, quando houver,
--     o lançamento do extrato (lin_ger_lancamentos) que pagou. chave única (NF-e: chave da nota|nº da duplicata) impede
--     importar a mesma parcela duas vezes; a mesma NF + parcela do mesmo fornecedor (carga antiga × NF-e) também é repetida.
-- Leitura e escrita só do Dono (lin_eh_dono, inclui a equipe Nervia); escrita só pelas funções, auditadas
-- (linum_gerencial_pagar_*). Nada se apaga: cancelar com motivo. Só tabela nova: não mexe em nenhum dado do Linum.

create table if not exists public.lin_ger_pagar (
  id             bigserial primary key,
  origem         text not null check (origem in ('nfe', 'manual', 'carga')),
  fornecedor     text not null check (length(btrim(fornecedor)) > 0),
  fornecedor_doc text not null default '' check (fornecedor_doc ~ '^[0-9A-Z]*$'),   -- CNPJ/CPF só dígitos (ou alfanumérico)
  documento      text not null default '',                 -- nº da NF ou do boleto
  nfe_chave      text not null default '',
  parcela        text not null default '',                 -- "1/3", "001"…
  vencimento     date not null,
  valor          numeric(14,2) not null check (valor > 0),
  categoria      text not null default '',
  historico      text not null default '',
  situacao       text not null default 'aberta' check (situacao in ('aberta', 'paga', 'cancelada')),
  pago_em        date,
  valor_pago     numeric(14,2),
  lancamento_id  bigint references public.lin_ger_lancamentos on delete set null,
  pago_obs       text not null default '',
  cancelado_motivo text not null default '',
  serie          uuid,                                      -- contas lançadas juntas pela repetição mensal
  estimado       boolean not null default false,            -- valor previsto (média das contas recorrentes), a confirmar
  chave          text unique,
  criado_em      timestamptz not null default now(),
  criado_nome    text not null default '',
  alterado_em    timestamptz,
  alterado_nome  text not null default '',
  constraint lin_ger_pagar_paga check (situacao <> 'paga' or (pago_em is not null and valor_pago is not null and valor_pago > 0))
);
create index if not exists lin_ger_pagar_venc on public.lin_ger_pagar (vencimento);

alter table public.lin_ger_pagar enable row level security;
revoke all on public.lin_ger_pagar from anon;
revoke insert, update, delete, truncate on public.lin_ger_pagar from authenticated;
grant select on public.lin_ger_pagar to authenticated;
drop policy if exists lin_ger_pagar_ler on public.lin_ger_pagar;
create policy lin_ger_pagar_ler on public.lin_ger_pagar for select using ((select public.lin_eh_dono()));

create or replace function public._lin_ger_doc(t text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(t, ''), '[^0-9A-Za-z]', '', 'g')) $$;
-- 1ª palavra do nome sem acento (para reconhecer o mesmo fornecedor escrito de outro jeito)
create or replace function public._lin_ger_forn1(t text) returns text
language sql immutable as $$
  select split_part(btrim(regexp_replace(upper(translate(coalesce(t, ''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                                                                           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
                                         '[^A-Z0-9 ]', ' ', 'g')), ' ', 1) $$;

-- ---------------------------------------------------------------- importar parcelas (NF-e ou carga); repetidas são puladas
-- p = {origem: 'nfe'|'carga', arquivo, contas: [{chave, fornecedor, fornecedor_doc, documento, nfe_chave, parcela,
--      vencimento, valor, categoria?, historico?, situacao?, pago_em?, valor_pago?, pago_obs?}]}
create or replace function public.lin_ger_pagar_importar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_origem text := coalesce(p ->> 'origem', ''); c jsonb; v_novos int := 0; v_rep int := 0; v_total numeric := 0;
        v_venc date; v_valor numeric; v_chave text; v_forn text; v_doc text; v_docnf text; v_parc text; v_sit text;
        v_pago date; v_vpago numeric; v_notas text[] := '{}';
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera o Gerencial'; end if;
  if v_origem not in ('nfe', 'carga') then raise exception 'Origem inválida'; end if;
  if jsonb_typeof(p -> 'contas') <> 'array' or jsonb_array_length(p -> 'contas') = 0 then
    raise exception 'Nenhuma parcela para importar';
  end if;
  for c in select * from jsonb_array_elements(p -> 'contas') loop
    v_chave := public._lin_txt(c, 'chave');
    v_forn := public._lin_txt(c, 'fornecedor');
    if v_forn is null then raise exception 'Parcela sem fornecedor'; end if;
    begin v_venc := (c ->> 'vencimento')::date; exception when others then raise exception 'Vencimento inválido: %', c ->> 'vencimento'; end;
    if v_venc is null then raise exception 'Informe o vencimento da parcela de %', v_forn; end if;
    begin v_valor := round((c ->> 'valor')::numeric, 2); exception when others then raise exception 'Valor inválido: %', c ->> 'valor'; end;
    if coalesce(v_valor, 0) <= 0 then raise exception 'Valor da parcela de % precisa ser maior que zero', v_forn; end if;
    v_doc := public._lin_ger_doc(c ->> 'fornecedor_doc');
    v_docnf := coalesce(public._lin_txt(c, 'documento'), '');
    v_parc := coalesce(public._lin_txt(c, 'parcela'), '');
    if (v_chave is not null and exists (select 1 from public.lin_ger_pagar where chave = v_chave))
       or (v_docnf <> '' and exists (select 1 from public.lin_ger_pagar g where g.situacao <> 'cancelada'
             and ltrim(g.documento, '0') = ltrim(v_docnf, '0') and ltrim(g.parcela, '0') = ltrim(v_parc, '0')
             and ((v_doc <> '' and g.fornecedor_doc = v_doc) or public._lin_ger_forn1(g.fornecedor) = public._lin_ger_forn1(v_forn)))) then
      v_rep := v_rep + 1; continue;
    end if;
    v_sit := 'aberta'; v_pago := null; v_vpago := null;
    if v_origem = 'carga' and c ->> 'situacao' = 'paga' then
      v_sit := 'paga'; v_pago := (c ->> 'pago_em')::date; v_vpago := coalesce(round(nullif(c ->> 'valor_pago', '')::numeric, 2), v_valor);
    end if;
    insert into public.lin_ger_pagar (origem, fornecedor, fornecedor_doc, documento, nfe_chave, parcela, vencimento, valor, categoria,
                                      historico, situacao, pago_em, valor_pago, pago_obs, chave, criado_nome)
    values (v_origem, left(v_forn, 200), v_doc, left(v_docnf, 60), coalesce(public._lin_txt(c, 'nfe_chave'), ''), left(v_parc, 20),
            v_venc, v_valor, left(coalesce(public._lin_txt(c, 'categoria'), ''), 80), left(coalesce(public._lin_txt(c, 'historico'), ''), 500),
            v_sit, v_pago, v_vpago, left(coalesce(public._lin_txt(c, 'pago_obs'), ''), 300), v_chave, public._lin_nome());
    v_novos := v_novos + 1; v_total := v_total + v_valor;
    if v_docnf <> '' and not (v_docnf = any(v_notas)) then v_notas := v_notas || v_docnf; end if;
  end loop;
  if v_novos > 0 then
    perform public._lin_auditar('linum_gerencial_pagar_importadas', null, jsonb_build_object('origem', v_origem,
      'arquivo', left(coalesce(p ->> 'arquivo', ''), 200), 'parcelas', v_novos, 'repetidas', v_rep, 'valor', v_total, 'notas', to_jsonb(v_notas)));
  end if;
  return jsonb_build_object('novos', v_novos, 'repetidos', v_rep, 'valor', v_total);
end $$;

-- ---------------------------------------------------------------- conta à mão (nova ou edição de uma em aberto)
-- p = {id?, fornecedor, fornecedor_doc?, documento?, parcela?, vencimento, valor, categoria?, historico?, estimado?, repetir? (1–36 meses,
--      só na nova: uma por mês no mesmo dia, ou no último dia do mês)}
create or replace function public.lin_ger_pagar_salvar(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p ->> 'id', '')::bigint; g public.lin_ger_pagar; v_antes jsonb; v_venc date; v_valor numeric;
        v_forn text := public._lin_txt(p, 'fornecedor'); v_rep int := coalesce(nullif(p ->> 'repetir', '')::int, 1); v_serie uuid;
        i int; v_d date;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera o Gerencial'; end if;
  if v_forn is null then raise exception 'Informe o fornecedor'; end if;
  begin v_venc := (p ->> 'vencimento')::date; exception when others then raise exception 'Vencimento inválido'; end;
  if v_venc is null then raise exception 'Informe o vencimento'; end if;
  begin v_valor := round((p ->> 'valor')::numeric, 2); exception when others then raise exception 'Valor inválido'; end;
  if coalesce(v_valor, 0) <= 0 then raise exception 'Informe o valor (maior que zero)'; end if;
  if v_id is not null then
    select * into g from public.lin_ger_pagar where id = v_id for update;
    if not found then raise exception 'Conta não encontrada'; end if;
    if g.situacao <> 'aberta' then raise exception 'Só dá para alterar conta em aberto (reabra antes)'; end if;
    v_antes := to_jsonb(g);
    update public.lin_ger_pagar set fornecedor = left(v_forn, 200), fornecedor_doc = public._lin_ger_doc(p ->> 'fornecedor_doc'),
      documento = left(coalesce(public._lin_txt(p, 'documento'), ''), 60), parcela = left(coalesce(public._lin_txt(p, 'parcela'), ''), 20),
      vencimento = v_venc, valor = v_valor, categoria = left(coalesce(public._lin_txt(p, 'categoria'), ''), 80),
      historico = left(coalesce(public._lin_txt(p, 'historico'), ''), 500), estimado = coalesce((p ->> 'estimado')::boolean, false),
      alterado_em = now(), alterado_nome = public._lin_nome()
    where id = v_id returning * into g;
    perform public._lin_auditar('linum_gerencial_pagar_alterada', null, jsonb_build_object('id', v_id, 'fornecedor', g.fornecedor,
      'antes', v_antes - array['alterado_em', 'alterado_nome'], 'depois', to_jsonb(g) - array['alterado_em', 'alterado_nome']));
    return 1;
  end if;
  if v_rep < 1 or v_rep > 36 then raise exception 'Repetir: de 1 a 36 meses'; end if;
  if v_rep > 1 then v_serie := gen_random_uuid(); end if;
  for i in 0 .. v_rep - 1 loop
    v_d := (v_venc + make_interval(months => i))::date;   -- 31/01 + 1 mês = 28/02 (último dia do mês)
    insert into public.lin_ger_pagar (origem, fornecedor, fornecedor_doc, documento, parcela, vencimento, valor, categoria, historico,
                                      serie, estimado, criado_nome)
    values ('manual', left(v_forn, 200), public._lin_ger_doc(p ->> 'fornecedor_doc'), left(coalesce(public._lin_txt(p, 'documento'), ''), 60),
            case when v_rep > 1 then (i + 1) || '/' || v_rep else left(coalesce(public._lin_txt(p, 'parcela'), ''), 20) end,
            v_d, v_valor, left(coalesce(public._lin_txt(p, 'categoria'), ''), 80), left(coalesce(public._lin_txt(p, 'historico'), ''), 500),
            v_serie, coalesce((p ->> 'estimado')::boolean, false), public._lin_nome());
  end loop;
  perform public._lin_auditar('linum_gerencial_pagar_criada', null, jsonb_build_object('fornecedor', v_forn, 'valor', v_valor,
    'vencimento', v_venc, 'meses', v_rep, 'estimado', coalesce((p ->> 'estimado')::boolean, false), 'categoria', coalesce(public._lin_txt(p, 'categoria'), ''), 'historico', coalesce(public._lin_txt(p, 'historico'), '')));
  return v_rep;
end $$;

-- ---------------------------------------------------------------- dar baixa (pagar) — uma ou várias parcelas pelo mesmo lançamento
-- p = {ids: [..], pago_em, valor_pago? (só com uma parcela; vazio = o valor da parcela), lancamento_id?, obs?}
create or replace function public.lin_ger_pagar_baixa(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_ids bigint[]; v_pago date; v_vp numeric; v_lanc bigint := nullif(p ->> 'lancamento_id', '')::bigint; g public.lin_ger_pagar;
        v_n int := 0; v_soma numeric := 0; l public.lin_ger_lancamentos; v_det jsonb := '[]';
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera o Gerencial'; end if;
  select array_agg(x::bigint) into v_ids from jsonb_array_elements_text(coalesce(p -> 'ids', '[]')) x;
  if coalesce(array_length(v_ids, 1), 0) = 0 then raise exception 'Escolha a(s) conta(s)'; end if;
  begin v_pago := (p ->> 'pago_em')::date; exception when others then raise exception 'Data do pagamento inválida'; end;
  if v_pago is null then raise exception 'Informe a data do pagamento'; end if;
  if v_pago > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'A data do pagamento não pode ser futura'; end if;
  v_vp := round(nullif(p ->> 'valor_pago', '')::numeric, 2);
  if v_vp is not null and array_length(v_ids, 1) > 1 then raise exception 'Valor pago diferente só com uma conta de cada vez'; end if;
  if v_vp is not null and v_vp <= 0 then raise exception 'Valor pago precisa ser maior que zero'; end if;
  if v_lanc is not null then
    select * into l from public.lin_ger_lancamentos where id = v_lanc;
    if not found then raise exception 'Lançamento do extrato não encontrado'; end if;
    if l.debito <= 0 then raise exception 'O lançamento escolhido não é uma saída'; end if;
  end if;
  for g in select * from public.lin_ger_pagar where id = any(v_ids) order by vencimento, id for update loop
    if g.situacao <> 'aberta' then raise exception 'A conta de % (venc. %) não está em aberto', g.fornecedor, to_char(g.vencimento, 'DD/MM/YYYY'); end if;
    update public.lin_ger_pagar set situacao = 'paga', pago_em = v_pago, valor_pago = coalesce(v_vp, g.valor), lancamento_id = v_lanc, estimado = false,
      pago_obs = left(coalesce(public._lin_txt(p, 'obs'), ''), 300), alterado_em = now(), alterado_nome = public._lin_nome()
    where id = g.id;
    v_n := v_n + 1; v_soma := v_soma + coalesce(v_vp, g.valor);
    v_det := v_det || jsonb_build_object('id', g.id, 'fornecedor', g.fornecedor, 'documento', g.documento, 'parcela', g.parcela,
                                         'vencimento', g.vencimento, 'valor', g.valor);
  end loop;
  if v_n <> array_length(v_ids, 1) then raise exception 'Conta não encontrada'; end if;
  perform public._lin_auditar('linum_gerencial_pagar_paga', null, jsonb_build_object('pago_em', v_pago, 'valor_pago', v_soma,
    'lancamento', case when v_lanc is null then null else jsonb_build_object('id', l.id, 'conta', l.conta, 'data', l.data,
      'descricao', l.descricao, 'debito', l.debito) end, 'obs', coalesce(public._lin_txt(p, 'obs'), ''), 'contas', v_det));
  return v_n;
end $$;

-- ---------------------------------------------------------------- cancelar / reabrir (paga ou cancelada volta a ficar em aberto)
create or replace function public.lin_ger_pagar_situacao(p_id bigint, p_acao text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare g public.lin_ger_pagar; v_antes jsonb;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera o Gerencial'; end if;
  if p_acao not in ('cancelar', 'reabrir') then raise exception 'Ação inválida'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escreva o motivo (ao menos 5 letras)'; end if;
  select * into g from public.lin_ger_pagar where id = p_id for update;
  if not found then raise exception 'Conta não encontrada'; end if;
  v_antes := to_jsonb(g) - array['criado_em', 'alterado_em'];
  if p_acao = 'cancelar' then
    if g.situacao <> 'aberta' then raise exception 'Só dá para cancelar conta em aberto'; end if;
    update public.lin_ger_pagar set situacao = 'cancelada', cancelado_motivo = left(btrim(p_motivo), 300),
      alterado_em = now(), alterado_nome = public._lin_nome() where id = p_id;
  else
    if g.situacao = 'aberta' then raise exception 'A conta já está em aberto'; end if;
    update public.lin_ger_pagar set situacao = 'aberta', pago_em = null, valor_pago = null, lancamento_id = null, pago_obs = '',
      cancelado_motivo = '', alterado_em = now(), alterado_nome = public._lin_nome() where id = p_id;
  end if;
  perform public._lin_auditar(case when p_acao = 'cancelar' then 'linum_gerencial_pagar_cancelada' else 'linum_gerencial_pagar_reaberta' end,
    null, jsonb_build_object('id', p_id, 'fornecedor', g.fornecedor, 'motivo', btrim(p_motivo), 'conta', v_antes));
end $$;

revoke execute on function public.lin_ger_pagar_importar(jsonb), public.lin_ger_pagar_salvar(jsonb), public.lin_ger_pagar_baixa(jsonb),
  public.lin_ger_pagar_situacao(bigint, text, text) from public, anon;
grant execute on function public.lin_ger_pagar_importar(jsonb), public.lin_ger_pagar_salvar(jsonb), public.lin_ger_pagar_baixa(jsonb),
  public.lin_ger_pagar_situacao(bigint, text, text) to authenticated;
