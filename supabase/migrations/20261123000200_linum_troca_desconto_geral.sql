-- Sistema Linum 2.59 — crédito da devolução = valor LÍQUIDO pago (pedido do Marco em 23/11/2026: "em uma troca o valor de
-- crédito da cliente é sempre o valor líquido pago"). Até aqui a peça devolvida valia o preço cobrado nela (já com a
-- promoção e o desconto da peça), mas o DESCONTO GERAL da venda não era repartido: 2 peças de R$ 500 com R$ 100 de desconto
-- geral (pago R$ 900) davam R$ 500 de crédito por peça. Agora o desconto geral é repartido pelo valor das peças (como no
-- relatório de Lucro): cada peça vale R$ 450.
-- Única mudança: a lin_venda_trocavel (igual à da 1.5, só o cálculo do valor_unitario); a lin_troca_registrar já usa o valor
-- dela para as peças de venda do sistema. Trocas já registradas não mudam.
create or replace function public.lin_venda_trocavel(p_venda bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v public.lin_vendas; v_fator numeric;
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  select * into v from public.lin_vendas where id = p_venda;
  if v.id is null then raise exception 'Venda nº % não encontrada', p_venda; end if;
  if v.cancelada_em is not null then raise exception 'A venda nº % foi cancelada', p_venda; end if;
  -- parte de cada real das peças que a cliente pagou de fato (valor pago ÷ valor das peças)
  v_fator := case when coalesce(v.valor_itens, 0) > 0 then least(1, greatest(0, v.valor_total / v.valor_itens)) else 1 end;
  return jsonb_build_object('venda', p_venda, 'data', v.data, 'loja_id', v.loja_id, 'vendedora', v.vendedora_nome, 'cliente_id', v.cliente_id,
    'desconto_geral', coalesce(v.desconto, 0),
    'itens', coalesce((select jsonb_agg(jsonb_build_object('variante_id', i.variante_id, 'referencia', i.referencia, 'descricao', i.descricao,
               'cor', i.cor, 'tamanho', i.tamanho, 'edicao', i.edicao, 'valor_unitario', i.valor_unitario, 'vendida', i.q,
               'trocavel', i.q - coalesce((select sum(ti.quantidade) from public.lin_troca_itens ti join public.lin_trocas t on t.id = ti.troca_id
                                             where t.venda_id = p_venda and t.cancelada_em is null and ti.tipo = 'devolvida'
                                               and ti.variante_id = i.variante_id), 0)))
             from (select variante_id, max(referencia) referencia, max(descricao) descricao, max(cor) cor, max(tamanho) tamanho, max(edicao) edicao,
                          round(sum(valor_total) * v_fator / sum(quantidade), 2) valor_unitario, sum(quantidade)::int q
                     from public.lin_venda_itens where venda_id = p_venda and variante_id is not null group by variante_id) i), '[]'));
end $$;
