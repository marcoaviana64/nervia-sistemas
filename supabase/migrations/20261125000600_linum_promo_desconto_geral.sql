-- Sistema Linum 2.64 (pedido do Marco em 25/11/2026): a venda nº 25 (Vestido Graça, Black Friday) foi registrada
-- com a peça pelo preço cheio e o desconto como DESCONTO GERAL da venda; a promoção só era reconhecida quando o
-- preço da PEÇA ficava no preço da promoção, então a boleta e as impressões não mostravam a Black Friday.
-- Agora a peça também é marcada quando o valor dela DEPOIS do desconto geral (repartido pelo valor das peças,
-- como no Lucro e na troca) fica no preço da promoção válida na loja e na data. `promocao_desconto_geral` diz que
-- foi por esse caminho. Nada de valores, estoque ou comissão muda; só as colunas da promoção na peça vendida.

alter table public.lin_venda_itens add column if not exists promocao_desconto_geral boolean not null default false;

-- 1) a regra "itens não se alteram" ganha UMA exceção: marcar a promoção (só promocao_*), com lin.marcar_promo na transação
create or replace function public.lin_vendas_imutavel() returns trigger
language plpgsql as $$
declare v_livres text[] := array['cancelada_em', 'cancelada_por', 'cancelada_nome', 'motivo_cancelamento', 'valor_nf'];
begin
  if tg_op = 'DELETE' then raise exception 'Venda ou troca não se apaga: cancele com motivo'; end if;
  if tg_table_name = 'lin_venda_itens' and current_setting('lin.marcar_promo', true) = 'sim'
     and (to_jsonb(new) - array['promocao_id', 'promocao_nome', 'promocao_desconto_geral'])
         = (to_jsonb(old) - array['promocao_id', 'promocao_nome', 'promocao_desconto_geral']) then
    return new;                                              -- só pela _lin_venda_marcar_promo
  end if;
  if tg_table_name in ('lin_venda_itens', 'lin_troca_itens') then raise exception 'Os itens não podem ser alterados'; end if;
  if old.criado_em = now() then return new; end if;   -- a própria função de registro fecha os totais na mesma transação
  if tg_table_name = 'lin_vendas' and current_setting('lin.corrigir_data', true) = 'sim' then
    v_livres := v_livres || 'data'::text;                   -- só pela lin_venda_corrigir_data
  end if;
  if tg_table_name = 'lin_vendas' and current_setting('lin.corrigir_cliente', true) = 'sim' then
    v_livres := v_livres || 'cliente_id'::text;             -- só pela lin_venda_cliente
  end if;
  if tg_table_name = 'lin_vendas' and current_setting('lin.corrigir_cv', true) = 'sim'
     and public._lin_pag_sem_cv(to_jsonb(new) -> 'pagamentos') = public._lin_pag_sem_cv(to_jsonb(old) -> 'pagamentos') then
    v_livres := v_livres || 'pagamentos'::text;             -- só pela lin_venda_comprovante, e só o CV
  end if;
  if tg_table_name = 'lin_vendas' and current_setting('lin.corrigir_comissao', true) = 'sim' then
    v_livres := v_livres || array['comissao_pct', 'comissao_valor'];   -- só pelo recálculo das regras de comissão
  end if;
  if (to_jsonb(new) - v_livres) is distinct from (to_jsonb(old) - v_livres) then
    raise exception 'Não pode ser alterada: cancele com motivo e registre de novo';
  end if;
  return new;
end $$;

-- 2) marca as peças da venda que ficaram no preço da promoção pelo desconto geral; devolve as peças marcadas
create or replace function public._lin_venda_marcar_promo(p_venda bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v record; i record; r record; v_fator numeric; v_res jsonb := '[]';
begin
  select id, loja_id, data, valor_itens, valor_total, cancelada_em into v from public.lin_vendas where id = p_venda;
  if v.id is null or v.cancelada_em is not null or coalesce(v.valor_itens, 0) <= 0 or v.valor_total >= v.valor_itens then return v_res; end if;
  v_fator := v.valor_total / v.valor_itens;
  perform set_config('lin.marcar_promo', 'sim', true);
  for i in select * from public.lin_venda_itens where venda_id = p_venda and promocao_id is null and variante_id is not null order by id loop
    select * into r from public._lin_promo_da(i.variante_id, v.loja_id, v.data);
    if r.promocao_id is not null and r.preco < i.preco_tabela and round(i.valor_unitario * v_fator, 2) <= r.preco + 0.005 then
      update public.lin_venda_itens set promocao_id = r.promocao_id, promocao_nome = r.nome, promocao_desconto_geral = true where id = i.id;
      v_res := v_res || jsonb_build_object('item', i.id, 'peca', i.descricao, 'cor', i.cor, 'tamanho', i.tamanho, 'promocao', r.nome,
        'preco_promocao', r.preco, 'valor_peca', i.valor_unitario, 'valor_com_desconto_geral', round(i.valor_unitario * v_fator, 2));
    end if;
  end loop;
  perform set_config('lin.marcar_promo', '', true);
  return v_res;
end $$;
revoke execute on function public._lin_venda_marcar_promo(bigint) from public, anon, authenticated;

-- 3) no registro (a lin_venda_registrar grava as peças e depois fecha os totais com um update): marca ali
create or replace function public.lin_vendas_promo_geral() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cancelada_em is null and new.valor_total is distinct from old.valor_total then
    perform public._lin_venda_marcar_promo(new.id);
  end if;
  return null;
end $$;
drop trigger if exists lin_vendas_promo_geral on public.lin_vendas;
create trigger lin_vendas_promo_geral after update of valor_total on public.lin_vendas
  for each row execute function public.lin_vendas_promo_geral();

-- 4) vendas já feitas durante as promoções (a nº 25): marca e registra na auditoria
do $$
declare v record; v_res jsonb;
begin
  for v in select id, data from public.lin_vendas
            where cancelada_em is null and data >= coalesce((select min(inicio) from public.lin_promocoes), current_date)
            order by id loop
    v_res := public._lin_venda_marcar_promo(v.id);
    if jsonb_array_length(v_res) > 0 then
      perform public.auditar('linum_venda_promocao_marcada', null, jsonb_build_object('venda', v.id, 'data', v.data, 'pecas', v_res,
        'motivo', 'Desconto dado como desconto geral da venda deixou a peça no preço da promoção (Linum 2.64)',
        'feito_por', 'Equipe Nervia (correção pela migração)'));
    end if;
  end loop;
end $$;

-- 5) resultado das promoções: valor vendido e desconto pelo valor LÍQUIDO da peça (desconto geral repartido)
create or replace function public.lin_promocoes_resumo() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque vê o resultado das promoções'; end if;
  return coalesce((select jsonb_object_agg(x.promocao_id, jsonb_build_object('pecas', x.pecas, 'vendas', x.vendas, 'vendido', x.vendido, 'desconto', x.desconto))
    from (select y.promocao_id, sum(y.quantidade)::int pecas, count(distinct y.venda_id)::int vendas, round(sum(y.liq * y.quantidade), 2) vendido,
                 round(sum(greatest(y.preco_tabela - y.liq, 0) * y.quantidade), 2) desconto
            from (select i.promocao_id, i.venda_id, i.quantidade, i.preco_tabela,
                         case when v.valor_itens > 0 then i.valor_unitario * v.valor_total / v.valor_itens else i.valor_unitario end liq
                    from public.lin_venda_itens i join public.lin_vendas v on v.id = i.venda_id
                   where i.promocao_id is not null and v.cancelada_em is null) y
           group by y.promocao_id) x), '{}');
end $$;
