-- Sistema Linum 2.5 (pedido do Marco em 27/10/2026: "na ficha de produção não consigo escolher o produto"): a peça nova
-- ainda não tem cores e tamanhos, e a ficha só aceita variações já cadastradas. Agora quem tem a permissão Produção
-- também cria as cores × tamanhos de uma peça (direto na nova ficha), além do Dono e do Estoque. Mesma regra e mesma
-- auditoria (linum_variantes_criadas); sem preço nem custo (a variação usa o preço da peça).
create or replace function public.lin_variantes_criar(p_produto uuid, p_cores text[], p_tamanhos text[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not (public.lin_controla_estoque() or public.lin_pode('producao')) then raise exception 'Somente o Dono, o Estoque ou quem tem a permissão Produção cadastra cores e tamanhos'; end if;
  if not exists (select 1 from public.lin_produtos where id = p_produto) then raise exception 'Produto não encontrado'; end if;
  if coalesce(cardinality(array_remove(p_cores, '')), 0) = 0 or coalesce(cardinality(array_remove(p_tamanhos, '')), 0) = 0 then
    raise exception 'Informe ao menos uma cor e um tamanho';
  end if;
  insert into public.lin_variantes (produto_id, cor, tamanho)
  select distinct p_produto, btrim(c), btrim(t) from unnest(p_cores) c, unnest(p_tamanhos) t
  where btrim(c) <> '' and btrim(t) <> ''
  on conflict (produto_id, cor, tamanho, edicao) do nothing;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform public._lin_auditar('linum_variantes_criadas', null, jsonb_build_object('produto_id', p_produto,
      'referencia', (select referencia from public.lin_produtos where id = p_produto), 'cores', p_cores, 'tamanhos', p_tamanhos, 'criadas', v_n,
      'pela_producao', not public.lin_controla_estoque()));
  end if;
  return v_n;
end $$;

-- Peça nova direto na ficha (pedido do Marco no mesmo dia: "na maioria das vezes são produtos novos que vou criar e não
-- têm ainda na lista de produtos; só entram quando estiver pronto na loja"). Cria a peça (sem custo; preço de venda
-- opcional, pode ficar para depois na aba Produtos) e as cores × tamanhos; estoque zero, então ela não aparece no
-- Estoque nem na venda até a produção entregar. Referência vazia = automática "NOVA-<ano>-<nº>" (troca-se depois).
-- p = {referencia?, descricao, categoria?, preco_venda?, consumo_metros?, cores:[...], tamanhos:[...]}
create or replace function public.lin_producao_peca_nova(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ref text := public._lin_txt(p, 'referencia'); v_desc text := public._lin_txt(p, 'descricao'); v_id uuid; v_n int; v_ano text;
        v_cores text[] := array(select btrim(x) from jsonb_array_elements_text(coalesce(p -> 'cores', '[]')) x where btrim(x) <> '');
        v_tams text[] := array(select btrim(x) from jsonb_array_elements_text(coalesce(p -> 'tamanhos', '[]')) x where btrim(x) <> '');
        v_cons numeric := public._lin_num(p, 'consumo_metros', 'Metros por peça');
begin
  if not (public.lin_controla_estoque() or public.lin_pode('producao')) then raise exception 'Somente o Dono, o Estoque ou quem tem a permissão Produção cria peça nova'; end if;
  if v_desc is null then raise exception 'Informe o nome da peça'; end if;
  if cardinality(v_cores) = 0 or cardinality(v_tams) = 0 then raise exception 'Informe ao menos uma cor e um tamanho'; end if;
  if v_cons is not null and (v_cons <= 0 or v_cons > 50) then raise exception 'Metros por peça: entre 0,01 e 50'; end if;
  if v_ref is null then
    v_ano := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY');
    select 'NOVA-' || v_ano || '-' || lpad((coalesce(max(nullif(regexp_replace(referencia, '^NOVA-' || v_ano || '-', ''), referencia)::int), 0) + 1)::text, 3, '0')
      into v_ref from public.lin_produtos where referencia ~ ('^NOVA-' || v_ano || '-[0-9]+$');
  end if;
  if exists (select 1 from public.lin_produtos where lower(referencia) = lower(v_ref)) then
    raise exception 'Já existe um produto com a referência %: procure por ela na ficha', v_ref;
  end if;
  insert into public.lin_produtos (referencia, descricao, categoria, preco_venda, consumo_metros)
  values (v_ref, v_desc, public._lin_txt(p, 'categoria'), coalesce(public._lin_num(p, 'preco_venda', 'Preço de venda'), 0), v_cons)
  returning id into v_id;
  perform public._lin_auditar('linum_produto_criado', null, jsonb_build_object('produto_id', v_id, 'referencia', v_ref, 'descricao', v_desc,
    'pela_producao', true));
  v_n := public.lin_variantes_criar(v_id, v_cores, v_tams);
  return jsonb_build_object('produto_id', v_id, 'referencia', v_ref, 'variantes', v_n);
end $$;
revoke execute on function public.lin_producao_peca_nova(jsonb) from public, anon;
grant execute on function public.lin_producao_peca_nova(jsonb) to authenticated;
