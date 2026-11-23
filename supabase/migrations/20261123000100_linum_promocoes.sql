-- Sistema Linum 2.58 — PROMOÇÕES (pedido do Marco em 23/11/2026: "estamos fazendo uma promoção de uma semana e algumas peças
-- estão com preços diferenciados; a estoquista escolhe a peça, informa o valor da promoção, dá um nome e as datas de início
-- e fim; o valor deve refletir na venda e no relatório; com mais de uma promoção válida, aplicar o maior desconto").
--
--   * lin_promocoes: nome, loja (vazio = as duas lojas), início e fim (datas de Brasília, inclusive), cancelamento.
--   * lin_promo_itens: peça (produto) com o preço da promoção; variante vazia = todas as cores e tamanhos NORMAIS da peça
--     (peça especial, que tem preço próprio, só entra quando escolhida uma a uma).
--   * Quem cria, altera e encerra: Dono e Estoque (lin_controla_estoque()). Toda a equipe lê (a venda precisa).
--   * A venda: a tela põe o preço da promoção na peça (o menor preço válido para a loja e a data da venda). O banco NÃO
--     muda a lin_venda_registrar: um gatilho na inclusão de cada peça vendida marca a promoção (lin_venda_itens.promocao_id/
--     promocao_nome) quando o valor cobrado é o da promoção (ou menor). É isso que alimenta o relatório da promoção.
--   * Colunas novas são nulas: as vendas antigas e o comportamento atual não mudam.

create table if not exists public.lin_promocoes (
  id                  bigint generated always as identity primary key,
  nome                text not null check (length(trim(nome)) between 2 and 80),
  loja_id             uuid references public.lin_lojas on delete restrict,   -- vazio = todas as lojas
  inicio              date not null,
  fim                 date not null,
  observacao          text not null default '',
  criado_por          uuid,
  criado_nome         text not null default '',
  criado_em           timestamptz not null default now(),
  alterado_em         timestamptz,
  alterado_nome       text,
  cancelada_em        timestamptz,
  cancelada_nome      text,
  motivo_cancelamento text,
  constraint lin_promocoes_datas check (fim >= inicio)
);
create table if not exists public.lin_promo_itens (
  id          bigint generated always as identity primary key,
  promocao_id bigint not null references public.lin_promocoes on delete cascade,
  produto_id  uuid not null references public.lin_produtos on delete cascade,
  variante_id uuid references public.lin_variantes on delete cascade,     -- vazio = todas as cores/tamanhos normais da peça
  preco       numeric(12,2) not null check (preco >= 0)
);
create unique index if not exists lin_promo_itens_unico on public.lin_promo_itens (promocao_id, produto_id, coalesce(variante_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists lin_promo_itens_produto on public.lin_promo_itens (produto_id);

alter table public.lin_venda_itens add column if not exists promocao_id bigint references public.lin_promocoes on delete set null;
alter table public.lin_venda_itens add column if not exists promocao_nome text;

alter table public.lin_promocoes enable row level security;
alter table public.lin_promo_itens enable row level security;
drop policy if exists lin_promocoes_ler on public.lin_promocoes;
create policy lin_promocoes_ler on public.lin_promocoes for select to authenticated using ((select public.lin_papel()) is not null);
drop policy if exists lin_promo_itens_ler on public.lin_promo_itens;
create policy lin_promo_itens_ler on public.lin_promo_itens for select to authenticated using ((select public.lin_papel()) is not null);
revoke all on public.lin_promocoes, public.lin_promo_itens from anon;
revoke insert, update, delete on public.lin_promocoes, public.lin_promo_itens from authenticated;
grant select on public.lin_promocoes, public.lin_promo_itens to authenticated;

-- preço da promoção de uma variação numa loja e data (o MENOR entre as promoções válidas; nulo = sem promoção)
create or replace function public._lin_promo_da(p_variante uuid, p_loja uuid, p_data date)
returns table (promocao_id bigint, nome text, preco numeric)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.nome, i.preco
    from public.lin_promo_itens i
    join public.lin_promocoes pr on pr.id = i.promocao_id
    join public.lin_variantes v on v.id = p_variante and v.produto_id = i.produto_id
   where pr.cancelada_em is null and p_data between pr.inicio and pr.fim
     and (pr.loja_id is null or pr.loja_id = p_loja)
     and (i.variante_id = p_variante or (i.variante_id is null and coalesce(trim(v.edicao), '') = ''))
   order by i.preco, pr.id
   limit 1
$$;
revoke execute on function public._lin_promo_da(uuid, uuid, date) from public, anon, authenticated;

-- marca a promoção na peça vendida (só na inclusão; a peça vendida não muda depois)
create or replace function public.lin_venda_itens_promo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_loja uuid; v_data date; r record;
begin
  if new.variante_id is null or new.promocao_id is not null then return new; end if;
  select loja_id, data into v_loja, v_data from public.lin_vendas where id = new.venda_id;
  select * into r from public._lin_promo_da(new.variante_id, v_loja, v_data);
  if r.promocao_id is not null and new.valor_unitario <= r.preco + 0.005 and new.valor_unitario < new.preco_tabela then
    new.promocao_id := r.promocao_id; new.promocao_nome := r.nome;
  end if;
  return new;
end $$;
drop trigger if exists lin_venda_itens_promo on public.lin_venda_itens;
create trigger lin_venda_itens_promo before insert on public.lin_venda_itens for each row execute function public.lin_venda_itens_promo();

-- criar / alterar (p: {id?, nome, loja_id, inicio, fim, observacao, itens: [{produto_id, variante_id?, preco}]})
create or replace function public.lin_promocao_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p ->> 'id', '')::bigint; v_nome text := trim(coalesce(p ->> 'nome', ''));
        v_loja uuid := nullif(p ->> 'loja_id', '')::uuid; v_ini date := nullif(p ->> 'inicio', '')::date; v_fim date := nullif(p ->> 'fim', '')::date;
        v_obs text := trim(coalesce(p ->> 'observacao', '')); v_it jsonb; v_prod uuid; v_var uuid; v_preco numeric; v_tab numeric;
        v_antes jsonb; v_ant record; v_n int := 0; v_itens jsonb := '[]';
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque cria e altera promoções'; end if;
  if length(v_nome) < 2 then raise exception 'Dê um nome à promoção'; end if;
  if length(v_nome) > 80 then raise exception 'Nome da promoção muito longo (até 80 letras)'; end if;
  if v_ini is null or v_fim is null then raise exception 'Informe o início e o fim da promoção'; end if;
  if v_fim < v_ini then raise exception 'O fim da promoção não pode ser antes do início'; end if;
  if v_fim - v_ini > 366 then raise exception 'A promoção pode durar no máximo um ano'; end if;
  if v_loja is not null and not exists (select 1 from public.lin_lojas where id = v_loja) then raise exception 'Loja não encontrada'; end if;
  if jsonb_typeof(p -> 'itens') is distinct from 'array' or jsonb_array_length(p -> 'itens') = 0 then raise exception 'Escolha pelo menos uma peça'; end if;

  if v_id is not null then
    select * into v_ant from public.lin_promocoes where id = v_id for update;
    if v_ant.id is null then raise exception 'Promoção não encontrada'; end if;
    if v_ant.cancelada_em is not null then raise exception 'Promoção cancelada não se altera'; end if;
    v_antes := jsonb_build_object('nome', v_ant.nome, 'loja_id', v_ant.loja_id, 'inicio', v_ant.inicio, 'fim', v_ant.fim, 'observacao', v_ant.observacao,
      'itens', (select coalesce(jsonb_agg(jsonb_build_object('produto_id', produto_id, 'variante_id', variante_id, 'preco', preco) order by id), '[]') from public.lin_promo_itens where promocao_id = v_id));
    update public.lin_promocoes set nome = v_nome, loja_id = v_loja, inicio = v_ini, fim = v_fim, observacao = v_obs,
           alterado_em = now(), alterado_nome = public._lin_nome() where id = v_id;
    delete from public.lin_promo_itens where promocao_id = v_id;
  else
    insert into public.lin_promocoes (nome, loja_id, inicio, fim, observacao, criado_por, criado_nome)
    values (v_nome, v_loja, v_ini, v_fim, v_obs, auth.uid(), public._lin_nome()) returning id into v_id;
  end if;

  for v_it in select * from jsonb_array_elements(p -> 'itens') loop
    v_prod := nullif(v_it ->> 'produto_id', '')::uuid; v_var := nullif(v_it ->> 'variante_id', '')::uuid;
    v_preco := round(nullif(v_it ->> 'preco', '')::numeric, 2);
    select preco_venda into v_tab from public.lin_produtos where id = v_prod;
    if not found then raise exception 'Peça não encontrada'; end if;
    if v_var is not null then
      select coalesce(v.preco_venda, v_tab) into v_tab from public.lin_variantes v where v.id = v_var and v.produto_id = v_prod;
      if not found then raise exception 'Cor/tamanho não é desta peça'; end if;
    end if;
    if v_preco is null or v_preco < 0 then raise exception 'Informe o preço da promoção de cada peça'; end if;
    if v_tab is not null and v_preco >= v_tab then
      raise exception 'O preço da promoção (R$ %) tem de ser menor que o preço de tabela (R$ %) em %', to_char(v_preco, 'FM999G990D00'),
        to_char(v_tab, 'FM999G990D00'), (select referencia || ' ' || descricao from public.lin_produtos where id = v_prod);
    end if;
    begin
      insert into public.lin_promo_itens (promocao_id, produto_id, variante_id, preco) values (v_id, v_prod, v_var, v_preco);
    exception when unique_violation then
      raise exception 'A mesma peça (ou cor/tamanho) está duas vezes na promoção: %', (select referencia || ' ' || descricao from public.lin_produtos where id = v_prod);
    end;
    v_n := v_n + 1;
    v_itens := v_itens || jsonb_build_object('produto_id', v_prod, 'variante_id', v_var, 'preco', v_preco);
  end loop;

  perform public._lin_auditar(case when v_antes is null then 'linum_promocao_criada' else 'linum_promocao_alterada' end, null,
    jsonb_build_object('promocao', v_id, 'nome', v_nome, 'pecas', v_n, 'papel_linum', public.lin_papel(),
      'antes', v_antes,
      'depois', jsonb_build_object('nome', v_nome, 'loja_id', v_loja, 'inicio', v_ini, 'fim', v_fim, 'observacao', v_obs, 'itens', v_itens)));
  return v_id;
end $$;

create or replace function public.lin_promocao_cancelar(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque cancela promoções'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escreva o motivo do cancelamento'; end if;
  select * into v from public.lin_promocoes where id = p_id for update;
  if v.id is null then raise exception 'Promoção não encontrada'; end if;
  if v.cancelada_em is not null then raise exception 'Esta promoção já foi cancelada'; end if;
  update public.lin_promocoes set cancelada_em = now(), cancelada_nome = public._lin_nome(), motivo_cancelamento = trim(p_motivo) where id = p_id;
  perform public._lin_auditar('linum_promocao_cancelada', null, jsonb_build_object('promocao', p_id, 'nome', v.nome, 'motivo', trim(p_motivo), 'papel_linum', public.lin_papel()));
end $$;

-- resumo das vendas de cada promoção (Dono e Estoque): peças, vendas, valor vendido e desconto dado (tabela − cobrado)
create or replace function public.lin_promocoes_resumo() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque vê o resultado das promoções'; end if;
  return coalesce((select jsonb_object_agg(x.promocao_id, jsonb_build_object('pecas', x.pecas, 'vendas', x.vendas, 'vendido', x.vendido, 'desconto', x.desconto))
    from (select i.promocao_id, sum(i.quantidade)::int pecas, count(distinct i.venda_id)::int vendas, sum(i.valor_total) vendido,
                 sum(greatest(i.preco_tabela - i.valor_unitario, 0) * i.quantidade) desconto
            from public.lin_venda_itens i join public.lin_vendas v on v.id = i.venda_id
           where i.promocao_id is not null and v.cancelada_em is null
           group by i.promocao_id) x), '{}');
end $$;

revoke execute on function public.lin_promocao_salvar(jsonb) from public, anon;
revoke execute on function public.lin_promocao_cancelar(bigint, text) from public, anon;
revoke execute on function public.lin_promocoes_resumo() from public, anon;
grant execute on function public.lin_promocao_salvar(jsonb) to authenticated;
grant execute on function public.lin_promocao_cancelar(bigint, text) to authenticated;
grant execute on function public.lin_promocoes_resumo() to authenticated;
