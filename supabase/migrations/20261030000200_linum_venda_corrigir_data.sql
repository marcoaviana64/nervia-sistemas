-- Sistema Linum 2.24: o Dono corrige a data de uma venda (pedido do Marco em 30/10/2026: a venda nº 2 foi em 22/10/2026,
-- a vendedora só consegue lançar até 7 dias atrás e gravou 29/10, "e eu não consigo alterar a data nem como admin").
--   * A venda continua imutável; a ÚNICA exceção é a data, e só pela lin_venda_corrigir_data (marca lin.corrigir_data
--     na transação, que o gatilho lin_vendas_imutavel aceita só para a coluna data).
--   * Só o Dono (inclui a equipe Nervia), venda não cancelada, motivo com pelo menos 5 letras, data até o
--     dia em que a venda foi registrada (horário de Brasília), sem limite para trás (como a boleta antiga do Dono).
--   * Não mexe no estoque, na comissão (o % e o valor ficam), nem no histórico do CRM (o registro "comprou" fica como foi).
--   * Auditoria linum_venda_data_corrigida com a data antes/depois e o motivo.

create or replace function public.lin_vendas_imutavel() returns trigger
language plpgsql as $$
declare v_livres text[] := array['cancelada_em', 'cancelada_por', 'cancelada_nome', 'motivo_cancelamento', 'valor_nf'];
begin
  if tg_op = 'DELETE' then raise exception 'Venda ou troca não se apaga: cancele com motivo'; end if;
  if tg_table_name in ('lin_venda_itens', 'lin_troca_itens') then raise exception 'Os itens não podem ser alterados'; end if;
  if old.criado_em = now() then return new; end if;   -- a própria função de registro fecha os totais na mesma transação
  if tg_table_name = 'lin_vendas' and current_setting('lin.corrigir_data', true) = 'sim' then
    v_livres := v_livres || 'data'::text;                   -- só pela lin_venda_corrigir_data
  end if;
  if (to_jsonb(new) - v_livres) is distinct from (to_jsonb(old) - v_livres) then
    raise exception 'Não pode ser alterada: cancele com motivo e registre de novo';
  end if;
  return new;
end $$;

create or replace function public.lin_venda_corrigir_data(p_venda bigint, p_data date, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.lin_vendas; v_reg date; v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono corrige a data da venda'; end if;
  select * into v from public.lin_vendas where id = p_venda for update;
  if not found then raise exception 'Venda não encontrada'; end if;
  if v.cancelada_em is not null then raise exception 'A venda nº % está cancelada', v.id; end if;
  if p_data is null then raise exception 'Informe a data correta'; end if;
  if length(v_motivo) < 5 then raise exception 'Escreva o motivo da correção'; end if;
  v_reg := (v.criado_em at time zone 'America/Sao_Paulo')::date;
  if p_data > v_reg then raise exception 'A data não pode ser depois do dia em que a venda foi registrada (%)', to_char(v_reg, 'DD/MM/YYYY'); end if;
  if p_data = v.data then raise exception 'A venda já está com essa data'; end if;
  perform set_config('lin.corrigir_data', 'sim', true);
  update public.lin_vendas set data = p_data where id = p_venda;
  perform set_config('lin.corrigir_data', '', true);
  perform public._lin_auditar('linum_venda_data_corrigida', null, jsonb_build_object('venda_id', v.id, 'loja', public._lin_loja(v.loja_id),
    'vendedora', v.vendedora_nome, 'valor_total', v.valor_total, 'motivo', v_motivo,
    'antes', jsonb_build_object('data', v.data), 'depois', jsonb_build_object('data', p_data)));
end $$;
revoke execute on function public.lin_venda_corrigir_data(bigint, date, text) from public, anon;
grant execute on function public.lin_venda_corrigir_data(bigint, date, text) to authenticated;
