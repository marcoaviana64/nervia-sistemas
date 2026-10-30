-- Sistema Linum 2.25: relatório de lucro das vendas (pedido do Marco em 30/10/2026: "comparando por quanto eu vendi o
-- produto, quanto queria vender (sem descontos), quanto é o custo, para ter ideia do lucro direto sem os outros custos").
--   * lin_lucro_itens(de, ate): só o Dono (inclui a equipe Nervia). Uma linha por peça vendida (vendas não canceladas):
--       tabela  = preço de tabela × quantidade (o que queria vender, sem descontos);
--       vendido = valor da peça com o desconto dela, menos a parte do desconto geral da venda (rateado pelo valor das peças);
--       custo   = preço de custo do cadastro VALENDO NA HORA DA VENDA (lin_precos_hist: a peça especial com custo próprio
--                 usa o dela, senão o da peça). Venda de antes do início do histórico (30/10/2026) usa o primeiro custo
--                 registrado; sem histórico, o custo atual do cadastro. Sem custo cadastrado = vazio (a tela avisa).
--   * Lucro direto = vendido − custo (sem comissão separada, cartão, aluguel…; o custo do cadastro vem da ficha de custo).
--   * Trocas e devoluções não entram (a venda continua como foi).

create or replace function public._lin_custo_em(p_produto uuid, p_variante uuid, p_quando timestamptz) returns numeric
language sql stable security definer set search_path = public as $$
  -- custo no momento: último registro até a hora; antes do primeiro registro, o valor "antes" dele (ou o próprio, se é o início do histórico)
  -- a variação com custo próprio naquele momento usa o dela; senão o da peça
  select coalesce(
    case when exists (select 1 from public.lin_precos_hist h where h.variante_id = p_variante and h.vale_desde <= p_quando)
      then (select h.preco_custo from public.lin_precos_hist h where h.variante_id = p_variante and h.vale_desde <= p_quando order by h.vale_desde desc, h.id desc limit 1)
      else (select case when h.origem like 'preço já cadastrado%' then h.preco_custo else h.preco_custo_antes end
              from public.lin_precos_hist h where h.variante_id = p_variante and h.vale_desde > p_quando order by h.vale_desde, h.id limit 1) end,
    case when exists (select 1 from public.lin_precos_hist h where h.produto_id = p_produto and h.variante_id is null and h.vale_desde <= p_quando)
      then (select h.preco_custo from public.lin_precos_hist h where h.produto_id = p_produto and h.variante_id is null and h.vale_desde <= p_quando order by h.vale_desde desc, h.id desc limit 1)
      else (select case when h.origem like 'preço já cadastrado%' then h.preco_custo else h.preco_custo_antes end
              from public.lin_precos_hist h where h.produto_id = p_produto and h.variante_id is null and h.vale_desde > p_quando order by h.vale_desde, h.id limit 1) end)
$$;
revoke execute on function public._lin_custo_em(uuid, uuid, timestamptz) from public, anon, authenticated;

create or replace function public.lin_lucro_itens(p_de date, p_ate date)
returns table (venda_id bigint, data date, loja_id uuid, vendedora_id uuid, vendedora_nome text, produto_id uuid, variante_id uuid,
               referencia text, descricao text, cor text, tamanho text, edicao text, quantidade int,
               tabela numeric, vendido numeric, custo_unitario numeric, custo numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê o lucro das vendas'; end if;
  if p_de is null or p_ate is null or p_ate < p_de then raise exception 'Informe o período'; end if;
  if p_ate - p_de > 800 then raise exception 'Período de no máximo 2 anos'; end if;
  return query
  select x.venda_id, x.data, x.loja_id, x.vendedora_id, x.vendedora_nome, x.produto_id, x.variante_id, x.referencia, x.descricao,
         x.cor, x.tamanho, x.edicao, x.quantidade, x.tabela, x.vendido, x.cu, round(x.cu * x.quantidade, 2)
    from (select i.id item_id, v.id venda_id, v.data, v.loja_id, v.vendedora_id, v.vendedora_nome, va.produto_id, i.variante_id, i.referencia, i.descricao,
                 i.cor, i.tamanho, i.edicao, i.quantidade,
                 round(i.preco_tabela * i.quantidade, 2) tabela,
                 round(i.valor_total - case when coalesce(v.valor_itens, 0) > 0 then coalesce(v.desconto, 0) * i.valor_total / v.valor_itens else 0 end, 2) vendido,
                 case when va.id is not null then coalesce(public._lin_custo_em(va.produto_id, va.id, v.criado_em), va.preco_custo, pr.preco_custo) end cu
            from public.lin_vendas v
            join public.lin_venda_itens i on i.venda_id = v.id
            left join public.lin_variantes va on va.id = i.variante_id
            left join public.lin_produtos pr on pr.id = va.produto_id
           where v.cancelada_em is null and v.data between p_de and p_ate) x
   order by x.data, x.venda_id, x.item_id;   -- ordem fixa: a tela lê em páginas de 1000
end $$;
revoke execute on function public.lin_lucro_itens(date, date) from public, anon;
grant execute on function public.lin_lucro_itens(date, date) to authenticated;
