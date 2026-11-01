-- Sistema Linum 2.21: trava contra atualizar a peça errada (pedido do Marco em 29/10/2026: "faça, se vai evitar atualizar
-- errado"). Uma ficha de versão (artesanal, bordada, blend…) com o campo Versão preenchido e SEM a peça especial escolhida
-- não atualiza mais o cadastro: antes ela gravava o preço/custo da versão na peça normal (ex.: "A12 artesanal" na A12).
-- Exceção: Versão igual ao nome da ficha, à referência ou à descrição (abas da planilha cujo nome foi copiado para a versão).
-- Vale para "Atualizar no cadastro" e para "Atualizar em Produtos" (lin_custo_enviar chama esta função).

create or replace function public.lin_custos_aplicar(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare c record; p public.lin_produtos; v_prod uuid; v_usados text[] := '{}'; v_n int := 0; v_chave text; v_ed text; v_q int; v_antes jsonb;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera os custos'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'Marque ao menos uma ficha'; end if;
  for c in select * from public.lin_custos where id = any(p_ids) order by ficha for update loop
    if c.rascunho then raise exception 'A ficha % é uma cópia/simulação: não atualiza o cadastro', c.ficha; end if;
    v_prod := coalesce(c.produto_id, (select x.id from public.lin_produtos x
                where upper(btrim(x.referencia)) = upper(coalesce(nullif(btrim(c.referencia), ''), btrim(c.ficha))) limit 1));
    if v_prod is null then raise exception 'A ficha % não tem peça no cadastro', c.ficha; end if;
    v_ed := lower(btrim(coalesce(c.edicao, '')));
    -- ficha de uma versão (artesanal, bordada, blend…) sem a peça especial escolhida não mexe na peça normal
    if v_ed = '' and btrim(coalesce(c.versao, '')) <> ''
       and lower(btrim(c.versao)) not in (lower(btrim(c.ficha)), lower(btrim(coalesce(c.referencia, ''))), lower(btrim(coalesce(c.descricao, '')))) then
      raise exception 'A ficha % é da versão "%": escolha na ficha a peça especial no cadastro (se a peça ainda não tem, crie em Produtos → Nova peça especial). Se esta ficha é a da peça normal, apague o campo Versão.', c.ficha, btrim(c.versao);
    end if;
    v_chave := v_prod::text || '|' || v_ed;
    if v_chave = any(v_usados) then
      raise exception 'Duas fichas marcadas são da mesma peça (%): marque só uma', (select referencia from public.lin_produtos where id = v_prod)
        || case when v_ed <> '' then ' — ' || c.edicao else '' end;
    end if;
    v_usados := v_usados || v_chave;
    if coalesce(c.venda, 0) <= 0 then raise exception 'A ficha % está sem valor de venda', c.ficha; end if;
    if coalesce(c.custo, 0) <= 0 then raise exception 'A ficha % está com custo zero', c.ficha; end if;
    select * into p from public.lin_produtos where id = v_prod for update;
    if v_ed <> '' then
      -- ficha de peça especial (artesanal, bordada…): o preço e o custo vão para as variações com essa edição
      select jsonb_build_object('preco_venda', min(preco_venda), 'preco_custo', min(preco_custo)) into v_antes
        from public.lin_variantes where produto_id = v_prod and lower(btrim(edicao)) = v_ed;
      update public.lin_variantes set preco_venda = round(c.venda, 2), preco_custo = round(c.custo, 2)
       where produto_id = v_prod and lower(btrim(edicao)) = v_ed;
      get diagnostics v_q = row_count;
      if v_q = 0 then raise exception 'A peça % não tem peças especiais "%": crie em Produtos (Nova peça especial) ou escolha outra na ficha %', p.referencia, c.edicao, c.ficha; end if;
      if c.produto_id is distinct from v_prod then update public.lin_custos set produto_id = v_prod where id = c.id; end if;
      perform public._lin_auditar('linum_variante_alterada', null, jsonb_build_object('produto_id', v_prod, 'referencia', p.referencia,
        'descricao', p.descricao, 'edicao', c.edicao, 'variacoes', v_q, 'pela_ficha_custo', c.ficha, 'antes', v_antes,
        'depois', jsonb_build_object('preco_venda', round(c.venda, 2), 'preco_custo', round(c.custo, 2))));
      v_n := v_n + 1;
      continue;
    end if;
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

