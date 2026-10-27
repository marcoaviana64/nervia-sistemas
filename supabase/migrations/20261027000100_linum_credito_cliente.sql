-- Sistema Linum 2.4: crédito da cliente (pedido do Marco em 27/10/2026): "na troca, o sistema vê a peça devolvida, tira
-- da compra da cliente como devolução, volta para o estoque e gera crédito na conta da cliente. Na nova compra usa o
-- crédito; se a compra for maior paga a diferença; se for menor o saldo fica na conta. Na venda, o sistema verifica o
-- saldo e abate se a cliente quiser. A nota fiscal da nova compra sai sem o valor do crédito (prepara para a NF)."
--   * lin_creditos = extrato da conta da cliente, SOMENTE INCLUSÃO: devolucao (+, troca), venda (−, crédito usado),
--     venda_cancelada (+), devolucao_cancelada (−), ajuste (±, só o Dono, com motivo; ex.: vale-troca de papel).
--     Saldo = soma (lin_cliente_saldo), nunca negativo; sem validade (por enquanto).
--   * Troca: a peça levada passou a ser opcional (devolução pura) e a diferença a favor da cliente pode virar
--     "credito_loja" (exige a cliente). As trocas antigas com "vale" e cliente viram crédito nesta migração.
--   * Venda: forma de pagamento "credito_loja" (exige a cliente, até o saldo); lin_vendas.credito_usado e
--     lin_vendas.valor_nf = valor_total − credito_usado (base da futura NF-e/NFC-e: a peça devolvida já teve nota);
--     comissão sobre valor_total − credito_usado (o crédito veio de venda que já teve comissão).
--   * Cancelar a venda devolve o crédito; cancelar a devolução tira o crédito (recusa se já foi usado).
--   * Toda a equipe que vende vê saldo e extrato (precisa para abater na venda); auditoria linum_credito_*.

create table if not exists public.lin_creditos (
  id           bigint generated always as identity primary key,
  cliente_id   uuid not null references public.lin_clientes on delete restrict,
  tipo         text not null check (tipo in ('devolucao', 'venda', 'venda_cancelada', 'devolucao_cancelada', 'ajuste')),
  valor        numeric(12,2) not null check (valor <> 0),
  troca_id     bigint references public.lin_trocas,
  venda_id     bigint references public.lin_vendas,
  loja_id      uuid references public.lin_lojas,
  observacao   text not null default '',
  criado_por   uuid references auth.users on delete set null,
  criado_nome  text not null default '',
  criado_em    timestamptz not null default now()
);
create index if not exists lin_creditos_cliente on public.lin_creditos (cliente_id, criado_em);
create unique index if not exists lin_creditos_um_por_operacao on public.lin_creditos (tipo, coalesce(troca_id, 0), coalesce(venda_id, 0)) where tipo <> 'ajuste';

create or replace function public.lin_creditos_imutavel() returns trigger language plpgsql as $$
begin raise exception 'O extrato de crédito não pode ser alterado nem apagado: lance um ajuste'; end $$;
drop trigger if exists lin_creditos_imutavel on public.lin_creditos;
create trigger lin_creditos_imutavel before update or delete on public.lin_creditos for each row execute function public.lin_creditos_imutavel();
drop trigger if exists lin_creditos_truncate on public.lin_creditos;
create trigger lin_creditos_truncate before truncate on public.lin_creditos for each statement execute function public.lin_creditos_imutavel();

alter table public.lin_creditos enable row level security;
drop policy if exists lin_creditos_ler on public.lin_creditos;
create policy lin_creditos_ler on public.lin_creditos for select using (public.lin_vende());
revoke insert, update, delete on public.lin_creditos from anon, authenticated;

create or replace function public.lin_cliente_saldo(p_cliente uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(valor), 0)::numeric(12,2) from public.lin_creditos where cliente_id = p_cliente $$;

-- saldo e extrato de uma cliente (tela da venda, da troca e ficha da cliente)
create or replace function public.lin_cliente_credito(p_cliente uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  return jsonb_build_object('saldo', public.lin_cliente_saldo(p_cliente),
    'extrato', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'tipo', c.tipo, 'valor', c.valor, 'troca_id', c.troca_id, 'venda_id', c.venda_id,
                 'loja', l.nome, 'observacao', c.observacao, 'por', c.criado_nome, 'em', c.criado_em) order by c.criado_em desc, c.id desc)
               from public.lin_creditos c left join public.lin_lojas l on l.id = c.loja_id where c.cliente_id = p_cliente), '[]'));
end $$;

-- clientes com saldo (lista de clientes)
create or replace function public.lin_creditos_saldos() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  return coalesce((select jsonb_object_agg(cliente_id, s) from (select cliente_id, sum(valor) s from public.lin_creditos group by cliente_id having sum(valor) <> 0) x), '{}');
end $$;

-- ajuste manual (só o Dono): ex.: vale-troca de papel de antes do sistema, correção
create or replace function public.lin_credito_ajustar(p_cliente uuid, p_valor numeric, p_motivo text) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_saldo numeric; v_nome text;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono ajusta o crédito da cliente'; end if;
  select nome into v_nome from public.lin_clientes where id = p_cliente for update;
  if v_nome is null then raise exception 'Cliente não encontrado'; end if;
  if p_valor is null or p_valor = 0 or abs(p_valor) > 100000 then raise exception 'Informe o valor do ajuste (positivo soma, negativo tira)'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo do ajuste'; end if;
  v_saldo := public.lin_cliente_saldo(p_cliente) + round(p_valor, 2);
  if v_saldo < 0 then raise exception 'O saldo ficaria negativo (R$ %)', replace(to_char(v_saldo, 'FM9999990.00'), '.', ','); end if;
  insert into public.lin_creditos (cliente_id, tipo, valor, observacao, criado_por, criado_nome)
  values (p_cliente, 'ajuste', round(p_valor, 2), trim(p_motivo), auth.uid(), public._lin_nome());
  perform public._lin_auditar('linum_credito_ajustado', null, jsonb_build_object('cliente', v_nome, 'valor', round(p_valor, 2), 'saldo', v_saldo, 'motivo', trim(p_motivo)));
  return v_saldo;
end $$;

-- venda: crédito usado e valor da nota fiscal
alter table public.lin_vendas add column if not exists credito_usado numeric(12,2) not null default 0 check (credito_usado >= 0);
alter table public.lin_vendas add column if not exists valor_nf numeric(12,2) generated always as (valor_total - credito_usado) stored;

-- a regra "venda não se altera" ignora valor_nf (coluna calculada: no gatilho BEFORE ela ainda não foi recalculada)
create or replace function public.lin_vendas_imutavel() returns trigger
language plpgsql as $$
declare v_livres text[] := array['cancelada_em', 'cancelada_por', 'cancelada_nome', 'motivo_cancelamento', 'valor_nf'];
begin
  if tg_op = 'DELETE' then raise exception 'Venda ou troca não se apaga: cancele com motivo'; end if;
  if tg_table_name in ('lin_venda_itens', 'lin_troca_itens') then raise exception 'Os itens não podem ser alterados'; end if;
  if old.criado_em = now() then return new; end if;   -- a própria função de registro fecha os totais na mesma transação
  if (to_jsonb(new) - v_livres) is distinct from (to_jsonb(old) - v_livres) then
    raise exception 'Não pode ser alterada: cancele com motivo e registre de novo';
  end if;
  return new;
end $$;

-- troca: "credito_loja" = crédito na conta da cliente ("vale" fica só para as trocas antigas)
alter table public.lin_trocas drop constraint if exists lin_trocas_devolucao_forma_check;
alter table public.lin_trocas add constraint lin_trocas_devolucao_forma_check check (devolucao_forma in ('dinheiro', 'pix', 'estorno', 'vale', 'credito_loja'));

-- trocas antigas com vale-troca e cliente: o vale vira crédito na conta
insert into public.lin_creditos (cliente_id, tipo, valor, troca_id, loja_id, observacao, criado_por, criado_nome, criado_em)
select t.cliente_id, 'devolucao', -t.diferenca, t.id, t.loja_id, 'Vale-troca da troca T' || t.id || ' (de antes do crédito na conta)', t.criado_por, t.criado_nome, t.criado_em
  from public.lin_trocas t
 where t.devolucao_forma = 'vale' and t.cancelada_em is null and t.cliente_id is not null and t.diferenca < 0
   and not exists (select 1 from public.lin_creditos c where c.troca_id = t.id and c.tipo = 'devolucao');

create or replace function public.lin_venda_registrar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_dono boolean := public.lin_eh_dono(); v_loja uuid := nullif(p ->> 'loja_id', '')::uuid;
        v_vend uuid := coalesce(nullif(p ->> 'vendedora_id', '')::uuid, auth.uid()); v_vend_nome text; v_com numeric := 0;
        v_cli uuid := nullif(p ->> 'cliente_id', '')::uuid; v_data date := coalesce(nullif(p ->> 'data', '')::date, current_date);
        v_desc numeric := coalesce(nullif(p ->> 'desconto', '')::numeric, 0); v_venda bigint; v_it jsonb; v_pg jsonb;
        v_var record; v_q int; v_vu numeric; v_pct numeric; v_disp int; v_bruto numeric := 0; v_itens numeric := 0; v_total numeric;
        v_pagos numeric := 0; v_pags jsonb := '[]'; v_parc int; v_resumo jsonb := '[]'; v_cred numeric := 0; v_saldo numeric;
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  if not exists (select 1 from public.lin_lojas where id = v_loja) then raise exception 'Escolha a loja'; end if;
  if not v_dono then
    if v_vend <> auth.uid() then raise exception 'Você só registra as próprias vendas'; end if;
    if v_data < current_date - 7 then raise exception 'Venda com mais de 7 dias: peça ao Dono para lançar'; end if;
  end if;
  if v_data > current_date then raise exception 'A data da venda não pode ser futura'; end if;
  select coalesce(nullif(trim(pe.nome), ''), pe.email), m.comissao_pct into v_vend_nome, v_com from public.lin_membros m join public.perfis pe on pe.user_id = m.user_id
   where m.user_id = v_vend and exists (select 1 from public.app_acessos a where a.user_id = m.user_id and a.app_id = 'linum');
  if v_vend_nome is null and not (v_dono and v_vend = auth.uid()) then raise exception 'Quem vendeu não está na equipe da Linum'; end if;
  v_com := coalesce(v_com, 0);
  v_vend_nome := coalesce(v_vend_nome, public._lin_nome());
  if v_cli is not null and not exists (select 1 from public.lin_clientes where id = v_cli) then raise exception 'Cliente não encontrado'; end if;
  if jsonb_typeof(p -> 'itens') is distinct from 'array' or jsonb_array_length(p -> 'itens') = 0 then raise exception 'Nenhuma peça na venda'; end if;
  if v_desc < 0 then raise exception 'Desconto não pode ser negativo'; end if;

  insert into public.lin_vendas (loja_id, vendedora_id, vendedora_nome, cliente_id, data, observacao, criado_por, criado_nome)
  values (v_loja, v_vend, v_vend_nome, v_cli, v_data, coalesce(trim(p ->> 'observacao'), ''), auth.uid(), public._lin_nome())
  returning id into v_venda;

  for v_it in select * from jsonb_array_elements(p -> 'itens') loop
    select x.id, x.cor, x.tamanho, x.edicao, x.ativo, pr.referencia, pr.descricao, coalesce(x.preco_venda, pr.preco_venda, 0) preco
      into v_var from public.lin_variantes x join public.lin_produtos pr on pr.id = x.produto_id where x.id = (v_it ->> 'variante_id')::uuid;
    if v_var.id is null then raise exception 'Peça não encontrada'; end if;
    v_q := (v_it ->> 'quantidade')::int;
    v_vu := round(coalesce(nullif(v_it ->> 'valor_unitario', '')::numeric, v_var.preco), 2);
    v_pct := coalesce(nullif(v_it ->> 'desconto_pct', '')::numeric, 0);
    if v_q is null or v_q <= 0 then raise exception 'Quantidade inválida em %', v_var.descricao; end if;
    if v_vu < 0 then raise exception 'Valor inválido em %', v_var.descricao; end if;
    if v_pct < 0 or v_pct > 100 then raise exception 'Desconto por peça deve ficar entre 0 e 100%%'; end if;
    select quantidade into v_disp from public.lin_estoque where variante_id = v_var.id and loja_id = v_loja for update;
    if coalesce(v_disp, 0) < v_q then
      raise exception 'Estoque insuficiente: % % % tem % peça(s) em %', v_var.descricao, v_var.cor, v_var.tamanho, coalesce(v_disp, 0),
        (select nome from public.lin_lojas where id = v_loja);
    end if;
    update public.lin_estoque set quantidade = quantidade - v_q, atualizado_em = now() where variante_id = v_var.id and loja_id = v_loja;
    insert into public.lin_venda_itens (venda_id, variante_id, referencia, descricao, cor, tamanho, edicao, quantidade, preco_tabela, desconto_pct, valor_unitario, valor_total)
    values (v_venda, v_var.id, v_var.referencia, v_var.descricao, v_var.cor, v_var.tamanho, v_var.edicao, v_q, v_var.preco, v_pct, v_vu, v_vu * v_q);
    insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, data, observacao, criado_por, criado_nome)
    values (v_var.id, v_loja, 'venda', v_q, v_data, 'Venda nº ' || v_venda, auth.uid(), public._lin_nome());
    v_bruto := v_bruto + v_var.preco * v_q;
    v_itens := v_itens + v_vu * v_q;
    v_resumo := v_resumo || jsonb_build_object('referencia', v_var.referencia, 'peca', v_var.descricao, 'cor', v_var.cor, 'tamanho', v_var.tamanho,
                                               'edicao', v_var.edicao, 'quantidade', v_q, 'valor_unitario', v_vu);
  end loop;

  if v_desc > v_itens then raise exception 'O desconto é maior que o valor das peças'; end if;
  v_total := round(v_itens - v_desc, 2);
  for v_pg in select * from jsonb_array_elements(coalesce(p -> 'pagamentos', '[]')) loop
    if (v_pg ->> 'forma') not in ('dinheiro', 'pix', 'debito', 'credito', 'cheque', 'outro', 'credito_loja') then raise exception 'Forma de pagamento inválida'; end if;
    if coalesce(nullif(v_pg ->> 'valor', '')::numeric, 0) <= 0 then raise exception 'Informe o valor de cada forma de pagamento'; end if;
    v_parc := case when v_pg ->> 'forma' = 'credito' then coalesce(nullif(v_pg ->> 'parcelas', '')::int, 1) else 1 end;
    if v_parc not between 1 and 24 then raise exception 'Parcelas: de 1 a 24'; end if;
    v_pagos := v_pagos + round((v_pg ->> 'valor')::numeric, 2);
    if v_pg ->> 'forma' = 'credito_loja' then v_cred := v_cred + round((v_pg ->> 'valor')::numeric, 2); end if;
    v_pags := v_pags || jsonb_build_object('forma', v_pg ->> 'forma', 'valor', round((v_pg ->> 'valor')::numeric, 2), 'parcelas', v_parc);
  end loop;
  if abs(v_pagos - v_total) > 0.009 then
    raise exception 'A soma dos pagamentos (R$ %) é diferente do total da venda (R$ %)', replace(to_char(v_pagos, 'FM9999990.00'), '.', ','), replace(to_char(v_total, 'FM9999990.00'), '.', ',');
  end if;

  -- crédito da cliente (devoluções): só com a cliente identificada e até o saldo dela; sai do extrato agora
  if v_cred > 0 then
    if v_cli is null then raise exception 'Para usar crédito, identifique a cliente na venda'; end if;
    perform 1 from public.lin_clientes where id = v_cli for update;   -- uma operação de crédito por vez para a mesma cliente
    v_saldo := public.lin_cliente_saldo(v_cli);
    if v_cred > v_saldo then
      raise exception 'A cliente tem R$ % de crédito: não dá para usar R$ %', replace(to_char(v_saldo, 'FM9999990.00'), '.', ','), replace(to_char(v_cred, 'FM9999990.00'), '.', ',');
    end if;
    insert into public.lin_creditos (cliente_id, tipo, valor, venda_id, loja_id, observacao, criado_por, criado_nome)
    values (v_cli, 'venda', -v_cred, v_venda, v_loja, 'Usado na venda nº ' || v_venda, auth.uid(), public._lin_nome());
  end if;
  -- a comissão é sobre o que entrou de novo: o crédito veio de uma venda que já teve comissão
  update public.lin_vendas set valor_bruto = v_bruto, valor_itens = v_itens, desconto = v_desc, valor_total = v_total, pagamentos = v_pags,
         credito_usado = v_cred, comissao_pct = v_com, comissao_valor = round((v_total - v_cred) * v_com / 100, 2)
   where id = v_venda;
  perform public._lin_auditar('linum_venda_registrada', null, jsonb_build_object('venda', v_venda, 'loja', public._lin_loja(v_loja),
    'vendedora', v_vend_nome, 'comissao_pct', v_com, 'comissao_valor', round((v_total - v_cred) * v_com / 100, 2), 'credito_usado', v_cred, 'valor_nf', v_total - v_cred, 'data', v_data, 'cliente', (select nome from public.lin_clientes where id = v_cli), 'itens', v_resumo,
    'valor_bruto', v_bruto, 'desconto', v_desc, 'valor_total', v_total, 'pagamentos', v_pags));
  return v_venda;
end $$;

create or replace function public.lin_venda_cancelar(p_venda bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.lin_vendas; i record;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono cancela vendas'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo do cancelamento'; end if;
  select * into v from public.lin_vendas where id = p_venda for update;
  if v.id is null then raise exception 'Venda não encontrada'; end if;
  if v.cancelada_em is not null then raise exception 'Esta venda já foi cancelada'; end if;
  for i in select variante_id, sum(quantidade)::int q from public.lin_venda_itens where venda_id = p_venda and variante_id is not null group by variante_id loop
    insert into public.lin_estoque (variante_id, loja_id, quantidade) values (i.variante_id, v.loja_id, i.q)
    on conflict (variante_id, loja_id) do update set quantidade = lin_estoque.quantidade + excluded.quantidade, atualizado_em = now();
    insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, observacao, criado_por, criado_nome)
    values (i.variante_id, v.loja_id, 'devolucao', i.q, 'Cancelamento da venda nº ' || p_venda || ': ' || trim(p_motivo), auth.uid(), public._lin_nome());
  end loop;
  -- o crédito usado volta para a cliente
  if coalesce(v.credito_usado, 0) > 0 then
    insert into public.lin_creditos (cliente_id, tipo, valor, venda_id, loja_id, observacao, criado_por, criado_nome)
    values (v.cliente_id, 'venda_cancelada', v.credito_usado, p_venda, v.loja_id, 'Cancelamento da venda nº ' || p_venda || ': ' || trim(p_motivo), auth.uid(), public._lin_nome());
  end if;
  update public.lin_vendas set cancelada_em = now(), cancelada_por = auth.uid(), cancelada_nome = public._lin_nome(), motivo_cancelamento = trim(p_motivo)
   where id = p_venda;
  perform public._lin_auditar('linum_venda_cancelada', null, jsonb_build_object('venda', p_venda, 'loja', public._lin_loja(v.loja_id),
    'vendedora', v.vendedora_nome, 'valor_total', v.valor_total, 'credito_devolvido', nullif(v.credito_usado, 0), 'motivo', trim(p_motivo)));
end $$;

create or replace function public.lin_troca_registrar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_dono boolean := public.lin_eh_dono(); v_loja uuid := nullif(p ->> 'loja_id', '')::uuid;
        v_at uuid := coalesce(nullif(p ->> 'atendente_id', '')::uuid, auth.uid()); v_at_nome text;
        v_cli uuid := nullif(p ->> 'cliente_id', '')::uuid; v_venda bigint := nullif(p ->> 'venda_id', '')::bigint;
        v_data date := coalesce(nullif(p ->> 'data', '')::date, current_date); v_troca bigint; v_it jsonb; v_pg jsonb; v_var record;
        v_q int; v_vu numeric; v_disp int; v_dev numeric := 0; v_nov numeric := 0; v_dif numeric; v_pagos numeric := 0; v_pags jsonb := '[]';
        v_parc int; v_trocavel jsonb; v_lim int; v_resumo jsonb := '[]'; v_forma text := nullif(p ->> 'devolucao_forma', '');
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  if not exists (select 1 from public.lin_lojas where id = v_loja) then raise exception 'Escolha a loja'; end if;
  if not v_dono then
    if v_at <> auth.uid() then raise exception 'Você só registra as próprias trocas'; end if;
    if v_data < current_date - 7 then raise exception 'Troca com mais de 7 dias: peça ao Dono para lançar'; end if;
  end if;
  if v_data > current_date then raise exception 'A data da troca não pode ser futura'; end if;
  select coalesce(nullif(trim(pe.nome), ''), pe.email) into v_at_nome from public.lin_membros m join public.perfis pe on pe.user_id = m.user_id
   where m.user_id = v_at and exists (select 1 from public.app_acessos a where a.user_id = m.user_id and a.app_id = 'linum');
  if v_at_nome is null and not (v_dono and v_at = auth.uid()) then raise exception 'Quem atendeu não está na equipe da Linum'; end if;
  v_at_nome := coalesce(v_at_nome, public._lin_nome());
  if v_venda is not null then
    v_trocavel := public.lin_venda_trocavel(v_venda);   -- confere se existe e não foi cancelada
    if v_cli is null then v_cli := nullif(v_trocavel ->> 'cliente_id', '')::uuid; end if;
  end if;
  if v_cli is not null and not exists (select 1 from public.lin_clientes where id = v_cli) then raise exception 'Cliente não encontrado'; end if;
  if jsonb_typeof(p -> 'devolvidas') is distinct from 'array' or jsonb_array_length(p -> 'devolvidas') = 0 then raise exception 'Informe a peça devolvida'; end if;

  insert into public.lin_trocas (loja_id, atendente_id, atendente_nome, cliente_id, venda_id, data, observacao, criado_por, criado_nome)
  values (v_loja, v_at, v_at_nome, v_cli, v_venda, v_data, coalesce(trim(p ->> 'observacao'), ''), auth.uid(), public._lin_nome())
  returning id into v_troca;

  -- devolvidas: voltam ao estoque da loja da troca
  for v_it in select * from jsonb_array_elements(p -> 'devolvidas') loop
    select x.id, x.cor, x.tamanho, x.edicao, pr.referencia, pr.descricao, coalesce(x.preco_venda, pr.preco_venda, 0) preco
      into v_var from public.lin_variantes x join public.lin_produtos pr on pr.id = x.produto_id where x.id = (v_it ->> 'variante_id')::uuid;
    if v_var.id is null then raise exception 'Peça devolvida não encontrada'; end if;
    v_q := (v_it ->> 'quantidade')::int;
    if v_q is null or v_q <= 0 then raise exception 'Quantidade inválida em %', v_var.descricao; end if;
    v_vu := round(coalesce(nullif(v_it ->> 'valor_unitario', '')::numeric, v_var.preco), 2);
    if v_venda is not null then
      select (e ->> 'trocavel')::int, (e ->> 'valor_unitario')::numeric into v_lim, v_vu
        from jsonb_array_elements(v_trocavel -> 'itens') e where (e ->> 'variante_id')::uuid = v_var.id;
      if v_lim is null then raise exception '% % % não está na venda nº %', v_var.descricao, v_var.cor, v_var.tamanho, v_venda; end if;
      if v_q > v_lim then raise exception '% % %: da venda nº % só restam % peça(s) para trocar', v_var.descricao, v_var.cor, v_var.tamanho, v_venda, v_lim; end if;
      v_trocavel := jsonb_set(v_trocavel, '{itens}', (select jsonb_agg(case when (e ->> 'variante_id')::uuid = v_var.id
                      then jsonb_set(e, '{trocavel}', to_jsonb(v_lim - v_q)) else e end) from jsonb_array_elements(v_trocavel -> 'itens') e));
    end if;
    if v_vu < 0 then raise exception 'Valor inválido em %', v_var.descricao; end if;
    insert into public.lin_estoque (variante_id, loja_id, quantidade) values (v_var.id, v_loja, v_q)
    on conflict (variante_id, loja_id) do update set quantidade = lin_estoque.quantidade + excluded.quantidade, atualizado_em = now();
    insert into public.lin_troca_itens (troca_id, tipo, variante_id, referencia, descricao, cor, tamanho, edicao, quantidade, valor_unitario, valor_total)
    values (v_troca, 'devolvida', v_var.id, v_var.referencia, v_var.descricao, v_var.cor, v_var.tamanho, v_var.edicao, v_q, v_vu, v_vu * v_q);
    insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, data, observacao, criado_por, criado_nome)
    values (v_var.id, v_loja, 'devolucao', v_q, v_data, 'Troca nº ' || v_troca || ' (devolvida)', auth.uid(), public._lin_nome());
    v_dev := v_dev + v_vu * v_q;
    v_resumo := v_resumo || jsonb_build_object('tipo', 'devolvida', 'referencia', v_var.referencia, 'cor', v_var.cor, 'tamanho', v_var.tamanho, 'quantidade', v_q, 'valor_unitario', v_vu);
  end loop;

  -- novas: saem do estoque da loja
  for v_it in select * from jsonb_array_elements(coalesce(p -> 'novas', '[]')) loop
    select x.id, x.cor, x.tamanho, x.edicao, pr.referencia, pr.descricao, coalesce(x.preco_venda, pr.preco_venda, 0) preco
      into v_var from public.lin_variantes x join public.lin_produtos pr on pr.id = x.produto_id where x.id = (v_it ->> 'variante_id')::uuid;
    if v_var.id is null then raise exception 'Peça nova não encontrada'; end if;
    v_q := (v_it ->> 'quantidade')::int;
    v_vu := round(coalesce(nullif(v_it ->> 'valor_unitario', '')::numeric, v_var.preco), 2);
    if v_q is null or v_q <= 0 then raise exception 'Quantidade inválida em %', v_var.descricao; end if;
    if v_vu < 0 then raise exception 'Valor inválido em %', v_var.descricao; end if;
    select quantidade into v_disp from public.lin_estoque where variante_id = v_var.id and loja_id = v_loja for update;
    if coalesce(v_disp, 0) < v_q then
      raise exception 'Estoque insuficiente: % % % tem % peça(s) em %', v_var.descricao, v_var.cor, v_var.tamanho, coalesce(v_disp, 0), public._lin_loja(v_loja);
    end if;
    update public.lin_estoque set quantidade = quantidade - v_q, atualizado_em = now() where variante_id = v_var.id and loja_id = v_loja;
    insert into public.lin_troca_itens (troca_id, tipo, variante_id, referencia, descricao, cor, tamanho, edicao, quantidade, valor_unitario, valor_total)
    values (v_troca, 'nova', v_var.id, v_var.referencia, v_var.descricao, v_var.cor, v_var.tamanho, v_var.edicao, v_q, v_vu, v_vu * v_q);
    insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, data, observacao, criado_por, criado_nome)
    values (v_var.id, v_loja, 'venda', v_q, v_data, 'Troca nº ' || v_troca || ' (levada)', auth.uid(), public._lin_nome());
    v_nov := v_nov + v_vu * v_q;
    v_resumo := v_resumo || jsonb_build_object('tipo', 'nova', 'referencia', v_var.referencia, 'cor', v_var.cor, 'tamanho', v_var.tamanho, 'quantidade', v_q, 'valor_unitario', v_vu);
  end loop;

  v_dif := round(v_nov - v_dev, 2);
  for v_pg in select * from jsonb_array_elements(coalesce(p -> 'pagamentos', '[]')) loop
    if (v_pg ->> 'forma') not in ('dinheiro', 'pix', 'debito', 'credito', 'cheque', 'outro') then raise exception 'Forma de pagamento inválida'; end if;
    if coalesce(nullif(v_pg ->> 'valor', '')::numeric, 0) <= 0 then raise exception 'Informe o valor de cada forma de pagamento'; end if;
    v_parc := case when v_pg ->> 'forma' = 'credito' then coalesce(nullif(v_pg ->> 'parcelas', '')::int, 1) else 1 end;
    if v_parc not between 1 and 24 then raise exception 'Parcelas: de 1 a 24'; end if;
    v_pagos := v_pagos + round((v_pg ->> 'valor')::numeric, 2);
    v_pags := v_pags || jsonb_build_object('forma', v_pg ->> 'forma', 'valor', round((v_pg ->> 'valor')::numeric, 2), 'parcelas', v_parc);
  end loop;
  if v_dif > 0 and abs(v_pagos - v_dif) > 0.009 then
    raise exception 'A cliente paga a diferença de R$ %: a soma dos pagamentos (R$ %) não fecha', replace(to_char(v_dif, 'FM9999990.00'), '.', ','), replace(to_char(v_pagos, 'FM9999990.00'), '.', ',');
  end if;
  if v_dif <= 0 and jsonb_array_length(v_pags) > 0 then raise exception 'Não há diferença a pagar nesta troca'; end if;
  if v_dif < 0 and v_forma is null then raise exception 'Informe como a diferença de R$ % volta para a cliente', replace(to_char(-v_dif, 'FM9999990.00'), '.', ','); end if;
  if v_dif >= 0 then v_forma := null; end if;
  if v_forma is not null and v_forma not in ('dinheiro', 'pix', 'estorno', 'credito_loja') then raise exception 'Forma de devolução inválida'; end if;
  if v_forma = 'credito_loja' then
    if v_cli is null then raise exception 'Para gerar crédito, identifique a cliente'; end if;
    perform 1 from public.lin_clientes where id = v_cli for update;
    insert into public.lin_creditos (cliente_id, tipo, valor, troca_id, loja_id, observacao, criado_por, criado_nome)
    values (v_cli, 'devolucao', -v_dif, v_troca, v_loja, 'Devolução T' || v_troca || coalesce(' da venda nº ' || v_venda, ''), auth.uid(), public._lin_nome());
  end if;

  update public.lin_trocas set valor_devolvido = v_dev, valor_novas = v_nov, diferenca = v_dif, pagamentos = v_pags, devolucao_forma = v_forma
   where id = v_troca;
  perform public._lin_auditar('linum_troca_registrada', null, jsonb_build_object('troca', v_troca, 'loja', public._lin_loja(v_loja), 'atendente', v_at_nome,
    'data', v_data, 'venda', v_venda, 'cliente', (select nome from public.lin_clientes where id = v_cli), 'itens', v_resumo,
    'valor_devolvido', v_dev, 'valor_novas', v_nov, 'diferenca', v_dif, 'pagamentos', v_pags, 'devolucao_forma', v_forma,
    'credito_gerado', case when v_forma = 'credito_loja' then -v_dif end));
  return v_troca;
end $$;

create or replace function public.lin_troca_cancelar(p_troca bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.lin_trocas; i record; v_disp int;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono cancela trocas'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo do cancelamento'; end if;
  select * into t from public.lin_trocas where id = p_troca for update;
  if t.id is null then raise exception 'Troca não encontrada'; end if;
  if t.cancelada_em is not null then raise exception 'Esta troca já foi cancelada'; end if;
  -- o crédito gerado sai da conta da cliente; se ela já usou, o cancelamento é recusado
  if t.devolucao_forma in ('credito_loja', 'vale') and t.cliente_id is not null and exists (select 1 from public.lin_creditos where troca_id = p_troca and tipo = 'devolucao') then
    perform 1 from public.lin_clientes where id = t.cliente_id for update;
    if public.lin_cliente_saldo(t.cliente_id) < -t.diferenca then
      raise exception 'Não dá para cancelar: a cliente já usou parte do crédito desta devolução (saldo R$ %)', replace(to_char(public.lin_cliente_saldo(t.cliente_id), 'FM9999990.00'), '.', ',');
    end if;
    insert into public.lin_creditos (cliente_id, tipo, valor, troca_id, loja_id, observacao, criado_por, criado_nome)
    values (t.cliente_id, 'devolucao_cancelada', t.diferenca, p_troca, t.loja_id, 'Cancelamento da devolução T' || p_troca || ': ' || trim(p_motivo), auth.uid(), public._lin_nome());
  end if;
  -- desfaz: a devolvida sai de novo, a nova volta
  for i in select variante_id, tipo, sum(quantidade)::int q from public.lin_troca_itens where troca_id = p_troca and variante_id is not null group by variante_id, tipo loop
    if i.tipo = 'devolvida' then
      select quantidade into v_disp from public.lin_estoque where variante_id = i.variante_id and loja_id = t.loja_id for update;
      if coalesce(v_disp, 0) < i.q then
        raise exception 'Não dá para cancelar: a peça devolvida já saiu do estoque de % (tem %)', public._lin_loja(t.loja_id), coalesce(v_disp, 0);
      end if;
      update public.lin_estoque set quantidade = quantidade - i.q, atualizado_em = now() where variante_id = i.variante_id and loja_id = t.loja_id;
      insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, observacao, criado_por, criado_nome)
      values (i.variante_id, t.loja_id, 'saida', i.q, 'Cancelamento da troca nº ' || p_troca || ': ' || trim(p_motivo), auth.uid(), public._lin_nome());
    else
      insert into public.lin_estoque (variante_id, loja_id, quantidade) values (i.variante_id, t.loja_id, i.q)
      on conflict (variante_id, loja_id) do update set quantidade = lin_estoque.quantidade + excluded.quantidade, atualizado_em = now();
      insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, observacao, criado_por, criado_nome)
      values (i.variante_id, t.loja_id, 'devolucao', i.q, 'Cancelamento da troca nº ' || p_troca || ': ' || trim(p_motivo), auth.uid(), public._lin_nome());
    end if;
  end loop;
  update public.lin_trocas set cancelada_em = now(), cancelada_por = auth.uid(), cancelada_nome = public._lin_nome(), motivo_cancelamento = trim(p_motivo)
   where id = p_troca;
  perform public._lin_auditar('linum_troca_cancelada', null, jsonb_build_object('troca', p_troca, 'loja', public._lin_loja(t.loja_id),
    'atendente', t.atendente_nome, 'diferenca', t.diferenca, 'motivo', trim(p_motivo)));
end $$;

do $$ declare f text; begin
  foreach f in array array['lin_cliente_credito(uuid)', 'lin_creditos_saldos()', 'lin_credito_ajustar(uuid, numeric, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke execute on function public.lin_cliente_saldo(uuid) from public, anon, authenticated;
end $$;
