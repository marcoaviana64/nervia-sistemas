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
