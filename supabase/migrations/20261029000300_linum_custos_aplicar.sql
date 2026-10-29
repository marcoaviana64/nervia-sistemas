-- Sistema Linum 2.19: levar o preço e o custo da ficha de custo para o cadastro da peça (pedido do Marco em 29/10/2026:
-- "a lista informando que os valores estão diferentes deve ter a possibilidade de eu marcar um ou mais e um botão que,
-- quando eu clicar, atualiza os valores, pois já conferi, inclusive o valor de custo, lá no produto").
--   * lin_custos_aplicar(ids): só o Dono. Para cada ficha marcada, a peça é a escolhida em "Peça no cadastro" ou, sem ela,
--     a de mesma referência (igual à tela). Grava em lin_produtos o preço de venda (= venda da ficha) e o preço de custo
--     (= custo total da ficha), arredondados em centavos, e liga a ficha à peça. Peças especiais com preço próprio não mudam.
--   * Recusa tudo (nada é gravado) se: ficha de cópia/simulação, ficha sem peça no cadastro, sem valor de venda ou com
--     custo zero, ou duas fichas marcadas para a mesma peça.
--   * Auditoria linum_produto_alterado (só o que mudou, antes/depois) com "pela_ficha_custo" = nome da ficha.

create or replace function public.lin_custos_aplicar(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare c record; p public.lin_produtos; v_prod uuid; v_usados uuid[] := '{}'; v_n int := 0;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera os custos'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'Marque ao menos uma ficha'; end if;
  for c in select * from public.lin_custos where id = any(p_ids) order by ficha for update loop
    if c.rascunho then raise exception 'A ficha % é uma cópia/simulação: não atualiza o cadastro', c.ficha; end if;
    v_prod := coalesce(c.produto_id, (select x.id from public.lin_produtos x
                where upper(btrim(x.referencia)) = upper(coalesce(nullif(btrim(c.referencia), ''), btrim(c.ficha))) limit 1));
    if v_prod is null then raise exception 'A ficha % não tem peça no cadastro', c.ficha; end if;
    if v_prod = any(v_usados) then
      raise exception 'Duas fichas marcadas são da mesma peça (%): marque só uma', (select referencia from public.lin_produtos where id = v_prod);
    end if;
    v_usados := v_usados || v_prod;
    if coalesce(c.venda, 0) <= 0 then raise exception 'A ficha % está sem valor de venda', c.ficha; end if;
    if coalesce(c.custo, 0) <= 0 then raise exception 'A ficha % está com custo zero', c.ficha; end if;
    select * into p from public.lin_produtos where id = v_prod for update;
    update public.lin_produtos set preco_venda = round(c.venda, 2), preco_custo = round(c.custo, 2) where id = v_prod;
    if c.produto_id is distinct from v_prod then update public.lin_custos set produto_id = v_prod where id = c.id; end if;
    perform public._lin_auditar('linum_produto_alterado', null, jsonb_build_object('produto_id', v_prod, 'referencia', p.referencia,
      'descricao', p.descricao, 'pela_ficha_custo', c.ficha,
      'antes', jsonb_build_object('preco_venda', p.preco_venda, 'preco_custo', p.preco_custo),
      'depois', jsonb_build_object('preco_venda', round(c.venda, 2), 'preco_custo', round(c.custo, 2))));
    v_n := v_n + 1;
  end loop;
  if v_n <> cardinality(p_ids) then raise exception 'Ficha de custo não encontrada'; end if;
  return v_n;
end $$;
revoke execute on function public.lin_custos_aplicar(uuid[]) from public, anon;
grant execute on function public.lin_custos_aplicar(uuid[]) to authenticated;

-- Botão "Enviar para Produtos" na ficha (pedido do Marco em 29/10/2026: "se já existir atualiza os dados, se não existir
-- cria o produto"). Peça existente = o mesmo que lin_custos_aplicar (preço de venda e custo). Peça nova = criada com a
-- referência da ficha (vazia = provisória NOVA-…), descrição, tecido (= matéria-prima), metragem por peça (= gasto),
-- preço de venda e custo; sem cores/tamanhos (entram depois em Produtos). A ficha fica ligada à peça.
create or replace function public.lin_custo_enviar(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.lin_custos; v_prod uuid; v_ref text;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera os custos'; end if;
  select * into c from public.lin_custos where id = p_id for update;
  if not found then raise exception 'Ficha de custo não encontrada'; end if;
  if c.rascunho then raise exception 'A ficha % é uma cópia/simulação: não vai para Produtos', c.ficha; end if;
  v_prod := coalesce(c.produto_id, (select x.id from public.lin_produtos x
              where upper(btrim(x.referencia)) = upper(coalesce(nullif(btrim(c.referencia), ''), btrim(c.ficha))) limit 1));
  if v_prod is not null then
    perform public.lin_custos_aplicar(array[p_id]);
    return jsonb_build_object('produto_id', v_prod, 'criado', false);
  end if;
  if coalesce(c.venda, 0) <= 0 then raise exception 'A ficha % está sem valor de venda', c.ficha; end if;
  if coalesce(c.custo, 0) <= 0 then raise exception 'A ficha % está com custo zero', c.ficha; end if;
  v_ref := coalesce(nullif(btrim(c.referencia), ''), public._lin_ref_provisoria());
  insert into public.lin_produtos (referencia, descricao, tecido, preco_custo, preco_venda, consumo_metros, ativo)
  values (v_ref, coalesce(nullif(btrim(c.descricao), ''), c.ficha), nullif(btrim(c.materia), ''), round(c.custo, 2), round(c.venda, 2),
          case when c.gasto > 0 then c.gasto end, true)
  returning id into v_prod;
  update public.lin_custos set produto_id = v_prod, referencia = v_ref where id = p_id;
  perform public._lin_auditar('linum_produto_criado', null, jsonb_build_object('produto_id', v_prod, 'referencia', v_ref,
    'descricao', coalesce(nullif(btrim(c.descricao), ''), c.ficha), 'pela_ficha_custo', c.ficha, 'preco_venda', round(c.venda, 2),
    'preco_custo', round(c.custo, 2)) || case when nullif(btrim(c.referencia), '') is null then jsonb_build_object('referencia_provisoria', true) else '{}'::jsonb end);
  return jsonb_build_object('produto_id', v_prod, 'criado', true, 'referencia', v_ref);
end $$;
revoke execute on function public.lin_custo_enviar(uuid) from public, anon;
grant execute on function public.lin_custo_enviar(uuid) to authenticated;
