-- Sistema Linum: Troca (a opção "Troca" da Boleta de Venda; pedido do Marco em 22/10/2026, "pode fazer" com as
-- regras propostas):
--   * a cliente devolve peça(s) e leva outra(s); a devolvida VOLTA ao estoque da loja da troca (movimento "devolucao")
--     e a nova SAI (movimento "venda"), tudo na mesma operação; falta de estoque da peça nova recusa a troca inteira;
--   * venda original opcional: ligada a uma venda do sistema, só aceita peças daquela venda e até a quantidade
--     comprada menos o que já foi trocado; o valor da devolvida vem do que foi pago. Sem venda (compra antiga, de antes
--     do sistema), escolhe-se a peça e o valor;
--   * diferença = novas − devolvidas: > 0 a cliente paga (pagamentos, soma = diferença); < 0 a loja devolve (forma:
--     dinheiro, pix, estorno no cartão ou vale-troca); = 0 nada;
--   * a troca NÃO mexe na comissão da venda original nem gera comissão;
--   * qualquer pessoa da equipe faz troca; cada um vê as próprias, o Dono vê todas; só o Dono cancela (com motivo),
--     e o cancelamento desfaz o estoque; troca e itens não se alteram nem se apagam; tudo na auditoria.

create table if not exists public.lin_trocas (
  id                  bigint generated always as identity primary key,   -- número da troca
  loja_id             uuid not null references public.lin_lojas,
  atendente_id        uuid references auth.users on delete set null,
  atendente_nome      text not null default '',
  cliente_id          uuid references public.lin_clientes on delete set null,
  venda_id            bigint references public.lin_vendas,
  data                date not null default current_date,
  valor_devolvido     numeric(12,2) not null default 0,
  valor_novas         numeric(12,2) not null default 0,
  diferenca           numeric(12,2) not null default 0,   -- > 0 cliente paga; < 0 loja devolve
  pagamentos          jsonb not null default '[]',
  devolucao_forma     text check (devolucao_forma in ('dinheiro', 'pix', 'estorno', 'vale')),
  observacao          text not null default '',
  criado_por          uuid references auth.users on delete set null,
  criado_nome         text not null default '',
  criado_em           timestamptz not null default now(),
  cancelada_em        timestamptz,
  cancelada_por       uuid references auth.users on delete set null,
  cancelada_nome      text,
  motivo_cancelamento text
);
create index if not exists lin_trocas_data on public.lin_trocas (data desc);
create index if not exists lin_trocas_venda on public.lin_trocas (venda_id);

create table if not exists public.lin_troca_itens (
  id             bigint generated always as identity primary key,
  troca_id       bigint not null references public.lin_trocas on delete cascade,
  tipo           text not null check (tipo in ('devolvida', 'nova')),
  variante_id    uuid references public.lin_variantes on delete set null,
  referencia     text not null default '',
  descricao      text not null default '',
  cor            text not null default '',
  tamanho        text not null default '',
  edicao         text not null default '',
  quantidade     int not null check (quantidade > 0),
  valor_unitario numeric(12,2) not null check (valor_unitario >= 0),
  valor_total    numeric(12,2) not null
);
create index if not exists lin_troca_itens_troca on public.lin_troca_itens (troca_id);

drop trigger if exists lin_trocas_imutavel on public.lin_trocas;
create trigger lin_trocas_imutavel before update or delete on public.lin_trocas for each row execute function public.lin_vendas_imutavel();
drop trigger if exists lin_troca_itens_imutavel on public.lin_troca_itens;
create trigger lin_troca_itens_imutavel before update or delete on public.lin_troca_itens for each row execute function public.lin_vendas_imutavel();

alter table public.lin_trocas      enable row level security;
alter table public.lin_troca_itens enable row level security;
create policy lin_trocas_ler on public.lin_trocas for select
  using (public.lin_eh_dono() or (public.lin_vende() and atendente_id = auth.uid()));
create policy lin_troca_itens_ler on public.lin_troca_itens for select
  using (exists (select 1 from public.lin_trocas t where t.id = troca_id));

-- a imutabilidade usa a mesma função das vendas: ela trata lin_venda_itens pelo nome; os itens da troca também
create or replace function public.lin_vendas_imutavel() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Venda ou troca não se apaga: cancele com motivo'; end if;
  if tg_table_name in ('lin_venda_itens', 'lin_troca_itens') then raise exception 'Os itens não podem ser alterados'; end if;
  if old.criado_em = now() then return new; end if;   -- a própria função de registro fecha os totais na mesma transação
  if (to_jsonb(new) - array['cancelada_em', 'cancelada_por', 'cancelada_nome', 'motivo_cancelamento'])
     is distinct from (to_jsonb(old) - array['cancelada_em', 'cancelada_por', 'cancelada_nome', 'motivo_cancelamento']) then
    raise exception 'Não pode ser alterada: cancele com motivo e registre de novo';
  end if;
  return new;
end $$;

-- quanto de cada peça de uma venda ainda pode ser trocado (vendido − já devolvido em trocas não canceladas)
create or replace function public.lin_venda_trocavel(p_venda bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v public.lin_vendas;
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  select * into v from public.lin_vendas where id = p_venda;
  if v.id is null then raise exception 'Venda nº % não encontrada', p_venda; end if;
  if v.cancelada_em is not null then raise exception 'A venda nº % foi cancelada', p_venda; end if;
  return jsonb_build_object('venda', p_venda, 'data', v.data, 'loja_id', v.loja_id, 'vendedora', v.vendedora_nome, 'cliente_id', v.cliente_id,
    'itens', coalesce((select jsonb_agg(jsonb_build_object('variante_id', i.variante_id, 'referencia', i.referencia, 'descricao', i.descricao,
               'cor', i.cor, 'tamanho', i.tamanho, 'edicao', i.edicao, 'valor_unitario', i.valor_unitario, 'vendida', i.q,
               'trocavel', i.q - coalesce((select sum(ti.quantidade) from public.lin_troca_itens ti join public.lin_trocas t on t.id = ti.troca_id
                                             where t.venda_id = p_venda and t.cancelada_em is null and ti.tipo = 'devolvida'
                                               and ti.variante_id = i.variante_id), 0)))
             from (select variante_id, max(referencia) referencia, max(descricao) descricao, max(cor) cor, max(tamanho) tamanho, max(edicao) edicao,
                          round(sum(valor_total) / sum(quantidade), 2) valor_unitario, sum(quantidade)::int q
                     from public.lin_venda_itens where venda_id = p_venda and variante_id is not null group by variante_id) i), '[]'));
end $$;

-- p: {loja_id, atendente_id?, cliente_id?, venda_id?, data?, observacao?, devolucao_forma?,
--     devolvidas:[{variante_id, quantidade, valor_unitario}], novas:[{variante_id, quantidade, valor_unitario}],
--     pagamentos:[{forma, valor, parcelas?}]}
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
  if jsonb_typeof(p -> 'novas') is distinct from 'array' or jsonb_array_length(p -> 'novas') = 0 then raise exception 'Informe a peça que a cliente leva'; end if;

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
  for v_it in select * from jsonb_array_elements(p -> 'novas') loop
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

  update public.lin_trocas set valor_devolvido = v_dev, valor_novas = v_nov, diferenca = v_dif, pagamentos = v_pags, devolucao_forma = v_forma
   where id = v_troca;
  perform public._lin_auditar('linum_troca_registrada', null, jsonb_build_object('troca', v_troca, 'loja', public._lin_loja(v_loja), 'atendente', v_at_nome,
    'data', v_data, 'venda', v_venda, 'cliente', (select nome from public.lin_clientes where id = v_cli), 'itens', v_resumo,
    'valor_devolvido', v_dev, 'valor_novas', v_nov, 'diferenca', v_dif, 'pagamentos', v_pags, 'devolucao_forma', v_forma));
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
  foreach f in array array['lin_venda_trocavel(bigint)', 'lin_troca_registrar(jsonb)', 'lin_troca_cancelar(bigint, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
