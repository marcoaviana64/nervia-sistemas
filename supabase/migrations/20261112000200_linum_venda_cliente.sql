-- Sistema Linum 2.50 — COLOCAR OU TROCAR A CLIENTE DE UMA VENDA JÁ REGISTRADA (pedido do Marco em 12/11/2026:
--   "a vendedora registra a venda, mas esquece de colocar quem é a cliente; o admin, a dona, o estoque ou a vendedora
--    que fez a venda têm de poder alterar e colocar a cliente").
--   * lin_venda_cliente(venda, cliente, motivo): o Dono (inclui a equipe Nervia), o Estoque ou quem fez a venda.
--     Venda sem cliente: motivo opcional. Venda que já tem cliente (cliente errada): motivo com pelo menos 5 letras.
--     Recusa venda cancelada e troca de cliente quando a venda usou o crédito da cliente (o crédito é dela).
--   * A venda continua imutável; a ÚNICA coluna liberada aqui é cliente_id (marca lin.corrigir_cliente na transação).
--     Peças, valores, comissão e estoque não mudam.
--   * CRM: a cliente nova vira "cliente" (se era possível cliente) e ganha no histórico o "Comprou" da venda, com o
--     pós-venda de 7 dias pelas mesmas regras da venda; a cliente antiga (se houver) ganha a anotação de que a venda
--     não era dela. O histórico de contatos continua somente inclusão.
--   * lin_vendas_sem_cliente(dias): vendas não canceladas sem cliente dos últimos dias (padrão 60), sem valores, para o
--     Dono e o Estoque (todas) e para quem vende (só as próprias): o Estoque não lê a tabela de vendas das outras.
--   * Auditoria linum_venda_cliente_corrigida (antes/depois e motivo).
-- Só acrescenta funções e libera uma coluna no gatilho: nenhum dado existente muda.

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
  if tg_table_name = 'lin_vendas' and current_setting('lin.corrigir_cliente', true) = 'sim' then
    v_livres := v_livres || 'cliente_id'::text;             -- só pela lin_venda_cliente
  end if;
  if (to_jsonb(new) - v_livres) is distinct from (to_jsonb(old) - v_livres) then
    raise exception 'Não pode ser alterada: cancele com motivo e registre de novo';
  end if;
  return new;
end $$;

create or replace function public.lin_venda_cliente(p_venda bigint, p_cliente uuid, p_motivo text default '') returns void
language plpgsql security definer set search_path = public as $$
declare v public.lin_vendas; c_novo public.lin_clientes; c_ant public.lin_clientes; v_motivo text := btrim(coalesce(p_motivo, ''));
        v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_pos date; v_prox date; v_quem text := public._lin_nome();
begin
  select * into v from public.lin_vendas where id = p_venda for update;
  if not found then raise exception 'Venda não encontrada'; end if;
  if not (public.lin_controla_estoque() or (public.lin_vende() and v.vendedora_id = auth.uid())) then
    raise exception 'Somente o Dono, o Estoque ou quem fez a venda coloca a cliente';
  end if;
  if v.cancelada_em is not null then raise exception 'A venda nº % está cancelada', v.id; end if;
  select * into c_novo from public.lin_clientes where id = p_cliente;
  if c_novo.id is null then raise exception 'Escolha a cliente'; end if;
  if v.cliente_id = p_cliente then raise exception 'A venda já está com essa cliente'; end if;
  if v.cliente_id is not null then
    if length(v_motivo) < 5 then raise exception 'A venda já tem cliente: escreva o motivo da troca'; end if;
    if coalesce(v.credito_usado, 0) > 0 then
      raise exception 'A venda nº % usou o crédito da cliente: para trocar a cliente, cancele a venda e registre de novo', v.id;
    end if;
    select * into c_ant from public.lin_clientes where id = v.cliente_id;
  end if;

  perform set_config('lin.corrigir_cliente', 'sim', true);
  update public.lin_vendas set cliente_id = p_cliente where id = p_venda;
  perform set_config('lin.corrigir_cliente', '', true);

  -- CRM da cliente nova: vira cliente e ganha o "Comprou" (com o pós-venda, pelas regras da venda)
  update public.lin_clientes set situacao = 'cliente' where id = p_cliente and situacao <> 'cliente';
  v_pos := v.data + 7;
  v_prox := c_novo.proximo_contato;
  if v_pos < v_hoje or (v_prox is not null and v_prox >= v_hoje and v_prox <= v_pos) then v_pos := null; end if;
  insert into public.lin_contatos (cliente_id, em, por, por_nome, canal, resultado, texto, proximo_contato, venda_id)
  values (p_cliente, now(), v.vendedora_id, v.vendedora_nome, 'loja', 'comprou',
          format('Comprou na %s — venda nº %s de %s: %s', public._lin_loja(v.loja_id), v.id, to_char(v.data, 'DD/MM/YYYY'), public._lin_venda_resumo(v.id))
            || format(' (cliente colocada na venda depois, por %s)', v_quem)
            || case when v_pos is not null then '. Pós-venda marcado para ' || to_char(v_pos, 'DD/MM') || '.' else '' end,
          v_pos,
          case when exists (select 1 from public.lin_contatos where venda_id = v.id and resultado = 'comprou') then null else v.id end);
  update public.lin_clientes set ultimo_contato = greatest(coalesce(ultimo_contato, now()), now()),
         proximo_contato = coalesce(v_pos, proximo_contato), atualizado_em = now()
   where id = p_cliente;

  -- cliente antiga: anotação de que a venda não era dela (o histórico não se apaga)
  if c_ant.id is not null then
    insert into public.lin_contatos (cliente_id, por, por_nome, canal, resultado, texto)
    values (c_ant.id, auth.uid(), v_quem, 'outro', 'outro',
            left(format('A venda nº %s de %s não era desta cliente: passou para %s. Motivo: %s', v.id, to_char(v.data, 'DD/MM/YYYY'), c_novo.nome, v_motivo), 1000));
  end if;

  perform public._lin_auditar('linum_venda_cliente_corrigida', null, jsonb_build_object('venda_id', v.id, 'loja', public._lin_loja(v.loja_id),
    'vendedora', v.vendedora_nome, 'data', v.data, 'motivo', nullif(v_motivo, ''),
    'antes', jsonb_build_object('cliente_id', v.cliente_id, 'cliente', c_ant.nome),
    'depois', jsonb_build_object('cliente_id', p_cliente, 'cliente', c_novo.nome)));
end $$;
revoke execute on function public.lin_venda_cliente(bigint, uuid, text) from public, anon;
grant execute on function public.lin_venda_cliente(bigint, uuid, text) to authenticated;

-- vendas sem cliente (sem valores): Dono e Estoque veem todas; quem vende, as próprias
create or replace function public.lin_vendas_sem_cliente(p_dias int default 60)
returns table (id bigint, data date, loja_id uuid, vendedora_id uuid, vendedora_nome text, pecas text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.lin_papel() is null then raise exception 'Seu login não tem acesso ao Sistema Linum agora'; end if;
  return query
    select v.id, v.data, v.loja_id, v.vendedora_id, v.vendedora_nome, public._lin_venda_resumo(v.id)
      from public.lin_vendas v
     where v.cliente_id is null and v.cancelada_em is null
       and v.data >= (now() at time zone 'America/Sao_Paulo')::date - greatest(1, least(coalesce(p_dias, 60), 400))
       and (public.lin_controla_estoque() or v.vendedora_id = auth.uid())
     order by v.data desc, v.id desc;
end $$;
revoke execute on function public.lin_vendas_sem_cliente(int) from public, anon;
grant execute on function public.lin_vendas_sem_cliente(int) to authenticated;
