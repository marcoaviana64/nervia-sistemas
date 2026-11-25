-- Sistema Linum 2.65 (pedido do Marco em 25/11/2026): consulta gerencial das vendas de cada promoção, com relatório em PDF.
-- Uma linha por peça vendida (venda não cancelada) marcada com a promoção. Só Dono e Estoque (como o resultado das promoções).
-- O nome de quem vendeu só vai para o Dono (o Estoque não lê as vendas das outras pessoas). Só leitura; nada muda no banco.

create or replace function public.lin_promocao_vendas(p_promocao bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_dono boolean := public.lin_eh_dono();
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque vê as vendas das promoções'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'venda', v.id, 'data', v.data, 'loja_id', v.loja_id, 'loja', l.nome,
      'vendedora', case when v_dono then v.vendedora_nome end,
      'variante_id', i.variante_id, 'produto_id', va.produto_id,
      'referencia', i.referencia, 'descricao', i.descricao, 'cor', i.cor, 'tamanho', i.tamanho, 'edicao', i.edicao,
      'quantidade', i.quantidade, 'preco_tabela', i.preco_tabela, 'valor_unitario', i.valor_unitario,
      'liquido', round(case when v.valor_itens > 0 then i.valor_unitario * v.valor_total / v.valor_itens else i.valor_unitario end, 2),
      'desconto_geral', i.promocao_desconto_geral) order by v.data, v.id, i.id)
    from public.lin_venda_itens i
    join public.lin_vendas v on v.id = i.venda_id
    join public.lin_lojas l on l.id = v.loja_id
    left join public.lin_variantes va on va.id = i.variante_id
   where i.promocao_id = p_promocao and v.cancelada_em is null), '[]');
end $$;
revoke execute on function public.lin_promocao_vendas(bigint) from public, anon;
grant execute on function public.lin_promocao_vendas(bigint) to authenticated;
