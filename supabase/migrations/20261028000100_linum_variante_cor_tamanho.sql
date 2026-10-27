-- Sistema Linum 2.11: corrigir a cor e o tamanho de uma variação já criada (pedido do Marco em 27/10/2026: a peça especial
-- da A34 ficou com a cor "Natural Bordado" — o "Bordada a mão" já está na edição — e a tela não deixava trocar).
--   * lin_variante_salvar com id passa a aceitar também cor e tamanho (chave ausente = mantém). O histórico de estoque
--     continua na mesma variação (movimentos apontam para ela); vendas e trocas antigas guardam a cópia da etiqueta e não
--     mudam. Auditoria linum_variante_alterada com o antes e o depois só do que mudou (_lin_auditar).
--   * Cor ou tamanho com vírgula é recusado (a A34 tinha virado uma peça só com "PP, P, M, G, GG"): cada variação é
--     uma cor e um tamanho; várias de uma vez pelo "Cores e tamanhos" ou pela peça especial com vírgulas (a tela separa).

create or replace function public.lin_variante_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_prod uuid := nullif(p ->> 'produto_id', '')::uuid; v_ed text := coalesce(public._lin_txt(p, 'edicao'), '');
        v_cor text := public._lin_txt(p, 'cor'); v_tam text := public._lin_txt(p, 'tamanho'); v_atual public.lin_variantes; v_dono boolean := public.lin_eh_dono();
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque cadastra variações'; end if;
  if v_cor like '%,%' or v_tam like '%,%' then
    raise exception 'Uma cor e um tamanho por variação (sem vírgula). Para várias de uma vez, use os campos de cores e tamanhos separados por vírgula';
  end if;
  if length(coalesce(v_cor, '')) > 80 or length(coalesce(v_tam, '')) > 20 then raise exception 'Cor ou tamanho longo demais'; end if;
  if v_id is null then
    if not exists (select 1 from public.lin_produtos where id = v_prod) then raise exception 'Produto não encontrado'; end if;
    if v_cor is null or v_tam is null then raise exception 'Informe a cor e o tamanho'; end if;
    if v_ed = '' then raise exception 'Informe a edição da peça especial (ex.: Bordada, Pintura artística)'; end if;
    if exists (select 1 from public.lin_variantes where produto_id = v_prod and cor = v_cor and tamanho = v_tam and edicao = v_ed) then
      raise exception 'Já existe % % %', v_cor, v_tam, v_ed;
    end if;
    insert into public.lin_variantes (produto_id, cor, tamanho, edicao, preco_venda, preco_custo)
    values (v_prod, v_cor, v_tam, v_ed, public._lin_num(p, 'preco_venda', 'Preço de venda'), case when v_dono then public._lin_num(p, 'preco_custo', 'Preço de custo') end)
    returning id into v_id;
    perform public._lin_auditar('linum_peca_especial_criada', v_id, jsonb_build_object('preco_venda', public._lin_num(p, 'preco_venda', 'Preço de venda'))
      || case when v_dono then jsonb_build_object('preco_custo', public._lin_num(p, 'preco_custo', 'Preço de custo')) else '{}'::jsonb end);
  else
    select * into v_atual from public.lin_variantes where id = v_id for update;
    if v_atual.id is null then raise exception 'Variação não encontrada'; end if;
    if p ? 'cor' and v_cor is null then raise exception 'Informe a cor'; end if;
    if p ? 'tamanho' and v_tam is null then raise exception 'Informe o tamanho'; end if;
    v_cor := coalesce(v_cor, v_atual.cor); v_tam := coalesce(v_tam, v_atual.tamanho);
    if exists (select 1 from public.lin_variantes where produto_id = v_atual.produto_id
         and cor = v_cor and tamanho = v_tam and edicao = v_ed and id <> v_id) then
      raise exception 'Já existe % % %', v_cor, v_tam, nullif(v_ed, '');
    end if;
    update public.lin_variantes set cor = v_cor, tamanho = v_tam, edicao = v_ed, preco_venda = public._lin_num(p, 'preco_venda', 'Preço de venda'),
      preco_custo = case when v_dono then public._lin_num(p, 'preco_custo', 'Preço de custo') else preco_custo end where id = v_id;
    perform public._lin_auditar('linum_variante_alterada', v_id, jsonb_build_object(
      'antes', jsonb_build_object('cor', v_atual.cor, 'tamanho', v_atual.tamanho, 'edicao', v_atual.edicao, 'preco_venda', v_atual.preco_venda)
               || case when v_dono then jsonb_build_object('preco_custo', v_atual.preco_custo) else '{}'::jsonb end,
      'depois', (select jsonb_build_object('cor', cor, 'tamanho', tamanho, 'edicao', edicao, 'preco_venda', preco_venda)
                        || case when v_dono then jsonb_build_object('preco_custo', preco_custo) else '{}'::jsonb end
                 from public.lin_variantes where id = v_id)));
  end if;
  return v_id;
end $$;
