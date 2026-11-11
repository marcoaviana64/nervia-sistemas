-- Sistema Linum 2.46 — MALINHA (condicional) e RESERVA (pedido do Marco em 10–11/11/2026):
--   "Frequentemente separamos algumas peças e enviamos para a casa da cliente; ela experimenta, escolhe a peça que deseja
--    comprar e devolve o que não quer, ou devolve tudo, ou compra tudo." e "também tem que controlar reservas: a cliente
--    pede para reservar a(s) peça(s) para pegar depois."
-- Decisões (sugeridas ao Marco e aprovadas com "pode fazer", 11/11/2026):
--   * Toda a equipe envia, reserva e registra a volta (lin_vende()); a cliente tem de estar cadastrada.
--   * As peças SAEM do estoque da loja na hora (movimento cond_saida) e ficam "com a cliente" (malinha) ou "reservadas".
--     Toda a equipe vê o resumo no Estoque (lin_cond_no_estoque: peças, tipo, primeiro nome da cliente, prazo).
--   * Prazo: malinha padrão = hoje + 3 dias; reserva = hoje + 7 (a tela sugere; até 60 dias; pode mudar depois).
--   * Volta peça por peça e em partes: "devolveu" volta ao estoque (cond_volta); "comprou" vira VENDA normal pela
--     lin_condicional_venda, numa transação só (as peças voltam ao estoque e a venda baixa de novo, com o mesmo histórico
--     de sempre): a comissão é de quem montou a malinha/reserva (a lin_venda_registrar passa a aceitar isso só por aqui),
--     a data é a do dia da compra, a loja e a cliente são as da malinha.
--   * Concluída quando todas as peças foram compradas ou devolvidas. Nada se apaga; a volta é SOMENTE INCLUSÃO.
--   * CRM: anotação automática no histórico da cliente ao enviar/reservar e ao concluir (sem valores).
--   * Auditoria: linum_malinha_enviada / linum_reserva_criada / linum_condicional_devolvida / linum_condicional_comprada /
--     linum_condicional_prazo.
-- Só acrescenta tabelas, uma coluna com padrão nulo, dois tipos de movimento e troca uma linha da lin_venda_registrar
-- (mesmo comportamento para todas as vendas de hoje): nenhum dado existente muda.

create table if not exists public.lin_condicionais (
  id               bigint generated always as identity primary key,
  tipo             text not null check (tipo in ('malinha', 'reserva')),
  loja_id          uuid not null references public.lin_lojas,
  cliente_id       uuid not null references public.lin_clientes,
  responsavel_id   uuid references auth.users on delete set null,   -- quem montou (comissão do que for comprado)
  responsavel_nome text not null default '',
  prazo            date not null,
  observacao       text not null default '',
  situacao         text not null default 'aberta' check (situacao in ('aberta', 'concluida')),
  criado_por       uuid references auth.users on delete set null,
  criado_nome      text not null default '',
  criado_em        timestamptz not null default now(),
  concluido_em     timestamptz,
  prazo_alterado_em timestamptz
);
create index if not exists lin_condicionais_sit on public.lin_condicionais (situacao, prazo);
create index if not exists lin_condicionais_cli on public.lin_condicionais (cliente_id);

create table if not exists public.lin_cond_itens (
  id             bigint generated always as identity primary key,
  condicional_id bigint not null references public.lin_condicionais,
  variante_id    uuid not null references public.lin_variantes,
  quantidade     int not null check (quantidade > 0),
  compradas      int not null default 0 check (compradas >= 0),
  devolvidas     int not null default 0 check (devolvidas >= 0),
  referencia     text not null default '',
  descricao      text not null default '',
  cor            text not null default '',
  tamanho        text not null default '',
  edicao         text not null default '',
  preco_venda    numeric,
  check (compradas + devolvidas <= quantidade),
  unique (condicional_id, variante_id)
);
create index if not exists lin_cond_itens_c on public.lin_cond_itens (condicional_id);

create table if not exists public.lin_cond_baixas (
  id             bigint generated always as identity primary key,
  condicional_id bigint not null references public.lin_condicionais,
  item_id        bigint not null references public.lin_cond_itens,
  resultado      text not null check (resultado in ('comprou', 'devolveu')),
  quantidade     int not null check (quantidade > 0),
  venda_id       bigint references public.lin_vendas,
  observacao     text not null default '',
  criado_por     uuid references auth.users on delete set null,
  criado_nome    text not null default '',
  criado_em      timestamptz not null default now(),
  check ((resultado = 'comprou') = (venda_id is not null))
);
create index if not exists lin_cond_baixas_c on public.lin_cond_baixas (condicional_id);

create or replace function public.lin_cond_imutavel() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'lin_cond_baixas' then raise exception 'A volta da malinha/reserva não pode ser alterada nem apagada'; end if;
  if tg_op = 'DELETE' then raise exception 'Malinhas e reservas não podem ser apagadas'; end if;
  if tg_table_name = 'lin_condicionais' then
    if old.situacao = 'concluida' then raise exception 'Esta malinha/reserva já foi concluída e não muda'; end if;
    if new.tipo <> old.tipo or new.loja_id <> old.loja_id or new.cliente_id <> old.cliente_id or new.criado_em <> old.criado_em then
      raise exception 'Tipo, loja e cliente não mudam depois de registrados';
    end if;
  else
    if new.variante_id <> old.variante_id or new.quantidade <> old.quantidade or new.compradas < old.compradas or new.devolvidas < old.devolvidas then
      raise exception 'As peças da malinha/reserva não podem ser alteradas';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists lin_condicionais_imutavel on public.lin_condicionais;
create trigger lin_condicionais_imutavel before update or delete on public.lin_condicionais for each row execute function public.lin_cond_imutavel();
drop trigger if exists lin_cond_itens_imutavel on public.lin_cond_itens;
create trigger lin_cond_itens_imutavel before update or delete on public.lin_cond_itens for each row execute function public.lin_cond_imutavel();
drop trigger if exists lin_cond_baixas_imutavel on public.lin_cond_baixas;
create trigger lin_cond_baixas_imutavel before update or delete on public.lin_cond_baixas for each row execute function public.lin_cond_imutavel();

-- toda a equipe lê (é ela quem atende); escrita só pelas funções
alter table public.lin_condicionais enable row level security;
alter table public.lin_cond_itens   enable row level security;
alter table public.lin_cond_baixas  enable row level security;
drop policy if exists lin_condicionais_ler on public.lin_condicionais;
create policy lin_condicionais_ler on public.lin_condicionais for select using (public.lin_papel() is not null);
drop policy if exists lin_cond_itens_ler on public.lin_cond_itens;
create policy lin_cond_itens_ler on public.lin_cond_itens for select using (public.lin_papel() is not null);
drop policy if exists lin_cond_baixas_ler on public.lin_cond_baixas;
create policy lin_cond_baixas_ler on public.lin_cond_baixas for select using (public.lin_papel() is not null);
revoke all on public.lin_condicionais, public.lin_cond_itens, public.lin_cond_baixas from anon, authenticated;
grant select on public.lin_condicionais, public.lin_cond_itens, public.lin_cond_baixas to authenticated;

alter table public.lin_movimentos add column if not exists condicional_id bigint references public.lin_condicionais;
alter table public.lin_movimentos drop constraint if exists lin_movimentos_tipo_check;
alter table public.lin_movimentos add constraint lin_movimentos_tipo_check
  check (tipo in ('entrada', 'saida', 'transferencia', 'ajuste', 'venda', 'devolucao', 'producao',
                  'transf_envio', 'transf_recebida', 'transf_retorno', 'benef_envio', 'benef_retorno',
                  'brinde', 'brinde_cancelado', 'cond_saida', 'cond_volta'));

create or replace function public._lin_cond_nome(t text) returns text
language sql immutable as $$ select case t when 'malinha' then 'Malinha' else 'Reserva' end $$;

create or replace function public._lin_cond_resumo(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('referencia', i.referencia, 'peca', i.descricao, 'cor', i.cor, 'tamanho', i.tamanho,
           'edicao', i.edicao, 'quantidade', i.quantidade, 'compradas', i.compradas, 'devolvidas', i.devolvidas) order by i.id), '[]')
    from public.lin_cond_itens i where i.condicional_id = p_id
$$;
revoke execute on function public._lin_cond_resumo(bigint) from public, anon, authenticated;

create or replace function public._lin_cond_pecas_txt(p_id bigint) returns text
language sql stable security definer set search_path = public as $$
  select string_agg(i.quantidade || '× ' || i.descricao || coalesce(' ' || nullif(concat_ws(' ', nullif(i.cor, ''), nullif(i.tamanho, ''), nullif(i.edicao, '')), ''), ''), ', ' order by i.id)
    from public.lin_cond_itens i where i.condicional_id = p_id
$$;
revoke execute on function public._lin_cond_pecas_txt(bigint) from public, anon, authenticated;

-- anotação no histórico da cliente (sem valores)
create or replace function public._lin_cond_contato(c public.lin_condicionais, p_txt text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.lin_contatos (cliente_id, por, por_nome, canal, resultado, texto)
  values (c.cliente_id, auth.uid(), public._lin_nome(), 'loja', 'outro', left(p_txt, 1000));
  update public.lin_clientes set ultimo_contato = now() where id = c.cliente_id;
end $$;
revoke execute on function public._lin_cond_contato(public.lin_condicionais, text) from public, anon, authenticated;

-- concluída quando todas as peças foram compradas ou devolvidas
create or replace function public._lin_cond_fechar(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare c public.lin_condicionais; v_comp int; v_dev int;
begin
  if exists (select 1 from public.lin_cond_itens where condicional_id = p_id and compradas + devolvidas < quantidade) then return 'aberta'; end if;
  update public.lin_condicionais set situacao = 'concluida', concluido_em = now() where id = p_id returning * into c;
  select sum(compradas), sum(devolvidas) into v_comp, v_dev from public.lin_cond_itens where condicional_id = p_id;
  perform public._lin_cond_contato(c, format('%s nº %s concluída: %s', public._lin_cond_nome(c.tipo), p_id,
    case when v_dev = 0 then format('comprou tudo (%s peça(s))', v_comp) when v_comp = 0 then format('devolveu tudo (%s peça(s))', v_dev)
         else format('comprou %s e devolveu %s peça(s)', v_comp, v_dev) end));
  return 'concluida';
end $$;
revoke execute on function public._lin_cond_fechar(bigint) from public, anon, authenticated;

-- enviar malinha / reservar: p = {tipo, loja, cliente_id, prazo, observacao, itens: [{variante_id, quantidade}]}
create or replace function public.lin_condicional_criar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_tipo text := coalesce(p ->> 'tipo', ''); v_loja uuid := nullif(p ->> 'loja', '')::uuid; v_cli uuid := nullif(p ->> 'cliente_id', '')::uuid;
  v_prazo date := nullif(p ->> 'prazo', '')::date; v_obs text := left(coalesce(trim(p ->> 'observacao'), ''), 300);
  v_id bigint; r record; v_disp int; v_total int := 0; v_cli_nome text; c public.lin_condicionais;
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  if v_tipo not in ('malinha', 'reserva') then raise exception 'Escolha malinha ou reserva'; end if;
  if v_loja is null or not exists (select 1 from public.lin_lojas where id = v_loja) then raise exception 'Escolha a loja de onde as peças saem'; end if;
  select nome into v_cli_nome from public.lin_clientes where id = v_cli;
  if v_cli_nome is null then raise exception 'Escolha a cliente (ela precisa estar cadastrada)'; end if;
  v_prazo := coalesce(v_prazo, public._lin_hoje() + case when v_tipo = 'malinha' then 3 else 7 end);
  if v_prazo < public._lin_hoje() then raise exception 'O prazo não pode ser antes de hoje'; end if;
  if v_prazo > public._lin_hoje() + 60 then raise exception 'O prazo pode ser de no máximo 60 dias'; end if;
  if jsonb_typeof(p -> 'itens') is distinct from 'array' or jsonb_array_length(p -> 'itens') = 0 then raise exception 'Escolha as peças'; end if;
  if jsonb_array_length(p -> 'itens') > 100 then raise exception 'No máximo 100 variações'; end if;

  insert into public.lin_condicionais (tipo, loja_id, cliente_id, responsavel_id, responsavel_nome, prazo, observacao, criado_por, criado_nome)
  values (v_tipo, v_loja, v_cli, auth.uid(), public._lin_nome(), v_prazo, v_obs, auth.uid(), public._lin_nome()) returning id into v_id;

  for r in select (x ->> 'variante_id')::uuid as variante_id, sum((x ->> 'quantidade')::int) as q
             from jsonb_array_elements(p -> 'itens') x group by 1 order by 1 loop
    if r.variante_id is null or coalesce(r.q, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero em cada peça'; end if;
    if not exists (select 1 from public.lin_variantes where id = r.variante_id) then raise exception 'Variação não encontrada'; end if;
    select quantidade into v_disp from public.lin_estoque where variante_id = r.variante_id and loja_id = v_loja for update;
    if coalesce(v_disp, 0) < r.q then
      raise exception 'Estoque insuficiente em %: % tem % peça(s) e foram pedidas %', public._lin_loja(v_loja),
        (select p2.descricao || ' ' || concat_ws(' ', nullif(v.cor, ''), nullif(v.tamanho, ''), nullif(v.edicao, ''))
           from public.lin_variantes v join public.lin_produtos p2 on p2.id = v.produto_id where v.id = r.variante_id),
        coalesce(v_disp, 0), r.q;
    end if;
    update public.lin_estoque set quantidade = quantidade - r.q, atualizado_em = now() where variante_id = r.variante_id and loja_id = v_loja;
    insert into public.lin_cond_itens (condicional_id, variante_id, quantidade, referencia, descricao, cor, tamanho, edicao, preco_venda)
    select v_id, v.id, r.q, coalesce(p2.referencia, ''), coalesce(p2.descricao, ''), coalesce(v.cor, ''), coalesce(v.tamanho, ''), coalesce(v.edicao, ''),
           coalesce(v.preco_venda, p2.preco_venda)
      from public.lin_variantes v join public.lin_produtos p2 on p2.id = v.produto_id where v.id = r.variante_id;
    insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, data, observacao, criado_por, criado_nome, condicional_id)
    values (r.variante_id, v_loja, 'cond_saida', r.q, public._lin_hoje(),
            format('%s nº %s para %s (até %s)', public._lin_cond_nome(v_tipo), v_id, v_cli_nome, to_char(v_prazo, 'DD/MM')),
            auth.uid(), public._lin_nome(), v_id);
    v_total := v_total + r.q;
  end loop;

  select * into c from public.lin_condicionais where id = v_id;
  perform public._lin_cond_contato(c, format('%s nº %s: %s (%s até %s)%s',
    case when v_tipo = 'malinha' then 'Levou malinha' else 'Reservou peças' end, v_id, public._lin_cond_pecas_txt(v_id),
    case when v_tipo = 'malinha' then 'devolver' else 'retirar' end, to_char(v_prazo, 'DD/MM'), case when v_obs <> '' then ' · ' || v_obs else '' end));
  perform public._lin_auditar(case when v_tipo = 'malinha' then 'linum_malinha_enviada' else 'linum_reserva_criada' end, null,
    jsonb_build_object('condicional', v_id, 'loja', public._lin_loja(v_loja), 'cliente', v_cli_nome, 'prazo', v_prazo, 'pecas', v_total,
                       'observacao', v_obs, 'itens', public._lin_cond_resumo(v_id)));
  return v_id;
end $$;

-- devolveu: itens = [{item_id, quantidade}] (vazio/nulo = todas as peças que ainda estão com a cliente)
create or replace function public.lin_condicional_devolver(p_id bigint, p_itens jsonb default null, p_obs text default '') returns text
language plpgsql security definer set search_path = public as $$
declare c public.lin_condicionais; it public.lin_cond_itens; x jsonb; v_q int; v_pend int; v_obs text := left(coalesce(trim(p_obs), ''), 300);
        v_total int := 0; v_cli text; v_sit text; v_lista jsonb;
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  select * into c from public.lin_condicionais where id = p_id for update;
  if c.id is null then raise exception 'Malinha/reserva não encontrada'; end if;
  if c.situacao <> 'aberta' then raise exception 'Esta malinha/reserva já foi concluída'; end if;
  select nome into v_cli from public.lin_clientes where id = c.cliente_id;
  v_lista := case when p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0
    then (select jsonb_agg(jsonb_build_object('item_id', i.id, 'quantidade', i.quantidade - i.compradas - i.devolvidas))
            from public.lin_cond_itens i where i.condicional_id = p_id and i.quantidade - i.compradas - i.devolvidas > 0)
    else p_itens end;
  if v_lista is null then raise exception 'Não há peças com a cliente nesta malinha/reserva'; end if;
  for x in select * from jsonb_array_elements(v_lista) loop
    v_q := nullif(x ->> 'quantidade', '')::int;
    if coalesce(v_q, 0) = 0 then continue; end if;
    select * into it from public.lin_cond_itens where id = nullif(x ->> 'item_id', '')::bigint and condicional_id = p_id for update;
    if it.id is null then raise exception 'Peça não pertence a esta malinha/reserva'; end if;
    v_pend := it.quantidade - it.compradas - it.devolvidas;
    if v_q < 0 or v_q > v_pend then raise exception '%: só % peça(s) ainda estão com a cliente', it.descricao || ' ' || concat_ws(' ', nullif(it.cor, ''), nullif(it.tamanho, '')), v_pend; end if;
    update public.lin_cond_itens set devolvidas = devolvidas + v_q where id = it.id;
    insert into public.lin_estoque (variante_id, loja_id, quantidade) values (it.variante_id, c.loja_id, v_q)
    on conflict (variante_id, loja_id) do update set quantidade = lin_estoque.quantidade + excluded.quantidade, atualizado_em = now();
    insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, data, observacao, criado_por, criado_nome, condicional_id)
    values (it.variante_id, c.loja_id, 'cond_volta', v_q, public._lin_hoje(),
            format('%s nº %s: %s devolveu', public._lin_cond_nome(c.tipo), p_id, v_cli) || case when v_obs <> '' then ' · ' || v_obs else '' end,
            auth.uid(), public._lin_nome(), p_id);
    insert into public.lin_cond_baixas (condicional_id, item_id, resultado, quantidade, observacao, criado_por, criado_nome)
    values (p_id, it.id, 'devolveu', v_q, v_obs, auth.uid(), public._lin_nome());
    v_total := v_total + v_q;
  end loop;
  if v_total = 0 then raise exception 'Informe quantas peças voltaram'; end if;
  v_sit := public._lin_cond_fechar(p_id);
  perform public._lin_auditar('linum_condicional_devolvida', null, jsonb_build_object('condicional', p_id, 'tipo', public._lin_cond_nome(c.tipo),
    'loja', public._lin_loja(c.loja_id), 'cliente', v_cli, 'devolvidas', v_total, 'situacao', v_sit, 'observacao', v_obs, 'itens', public._lin_cond_resumo(p_id)));
  return v_sit;
end $$;

-- comprou: as peças voltam ao estoque e a venda é registrada na mesma transação (se a venda falhar, nada muda)
-- itens = [{item_id, quantidade}]; p = os mesmos dados da lin_venda_registrar (loja e cliente vêm da malinha)
create or replace function public.lin_condicional_venda(p_id bigint, p_itens jsonb, p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare c public.lin_condicionais; it public.lin_cond_itens; x jsonb; v_q int; v_pend int; v_cli text; v_venda bigint; v_vend uuid;
        v_esperado jsonb := '{}'; k text; v_total int := 0; v_sit text;
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  select * into c from public.lin_condicionais where id = p_id for update;
  if c.id is null then raise exception 'Malinha/reserva não encontrada'; end if;
  if c.situacao <> 'aberta' then raise exception 'Esta malinha/reserva já foi concluída'; end if;
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Escolha as peças que a cliente comprou'; end if;
  select nome into v_cli from public.lin_clientes where id = c.cliente_id;

  for x in select * from jsonb_array_elements(p_itens) loop
    v_q := nullif(x ->> 'quantidade', '')::int;
    if coalesce(v_q, 0) = 0 then continue; end if;
    select * into it from public.lin_cond_itens where id = nullif(x ->> 'item_id', '')::bigint and condicional_id = p_id for update;
    if it.id is null then raise exception 'Peça não pertence a esta malinha/reserva'; end if;
    v_pend := it.quantidade - it.compradas - it.devolvidas;
    if v_q < 0 or v_q > v_pend then raise exception '%: só % peça(s) ainda estão com a cliente', it.descricao || ' ' || concat_ws(' ', nullif(it.cor, ''), nullif(it.tamanho, '')), v_pend; end if;
    update public.lin_cond_itens set compradas = compradas + v_q where id = it.id;
    insert into public.lin_estoque (variante_id, loja_id, quantidade) values (it.variante_id, c.loja_id, v_q)
    on conflict (variante_id, loja_id) do update set quantidade = lin_estoque.quantidade + excluded.quantidade, atualizado_em = now();
    insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, data, observacao, criado_por, criado_nome, condicional_id)
    values (it.variante_id, c.loja_id, 'cond_volta', v_q, public._lin_hoje(),
            format('%s nº %s: %s comprou (sai na venda)', public._lin_cond_nome(c.tipo), p_id, v_cli), auth.uid(), public._lin_nome(), p_id);
    v_esperado := v_esperado || jsonb_build_object(it.variante_id::text, coalesce((v_esperado ->> it.variante_id::text)::int, 0) + v_q);
    v_total := v_total + v_q;
  end loop;
  if v_total = 0 then raise exception 'Informe quantas peças a cliente comprou'; end if;

  -- comissão de quem montou a malinha/reserva (o Dono pode escolher outra pessoa na venda)
  v_vend := case when public.lin_eh_dono() then coalesce(nullif(p ->> 'vendedora_id', '')::uuid, c.responsavel_id, auth.uid())
                 else coalesce(c.responsavel_id, auth.uid()) end;
  if not exists (select 1 from public.lin_membros m where m.user_id = v_vend) then v_vend := auth.uid(); end if;
  perform set_config('lin.cond_vendedora', v_vend::text, true);
  v_venda := public.lin_venda_registrar(p || jsonb_build_object('loja_id', c.loja_id, 'cliente_id', c.cliente_id, 'vendedora_id', v_vend,
    'data', coalesce(nullif(p ->> 'data', ''), public._lin_hoje()::text),
    'observacao', trim(format('%s nº %s. %s', public._lin_cond_nome(c.tipo), p_id, coalesce(p ->> 'observacao', '')))));
  perform set_config('lin.cond_vendedora', '', true);

  for k in select jsonb_object_keys(v_esperado) loop
    if coalesce((select sum(quantidade) from public.lin_venda_itens where venda_id = v_venda and variante_id = k::uuid), 0) < (v_esperado ->> k)::int then
      raise exception 'A venda precisa ter as peças que a cliente comprou da malinha/reserva (faltou %)',
        (select it2.descricao || ' ' || concat_ws(' ', nullif(it2.cor, ''), nullif(it2.tamanho, '')) from public.lin_cond_itens it2 where it2.condicional_id = p_id and it2.variante_id = k::uuid);
    end if;
  end loop;
  insert into public.lin_cond_baixas (condicional_id, item_id, resultado, quantidade, venda_id, criado_por, criado_nome)
  select p_id, nullif(e ->> 'item_id', '')::bigint, 'comprou', (e ->> 'quantidade')::int, v_venda, auth.uid(), public._lin_nome()
    from jsonb_array_elements(p_itens) e where coalesce(nullif(e ->> 'quantidade', '')::int, 0) > 0;
  v_sit := public._lin_cond_fechar(p_id);
  perform public._lin_auditar('linum_condicional_comprada', null, jsonb_build_object('condicional', p_id, 'tipo', public._lin_cond_nome(c.tipo),
    'loja', public._lin_loja(c.loja_id), 'cliente', v_cli, 'venda', v_venda, 'compradas', v_total, 'situacao', v_sit, 'itens', public._lin_cond_resumo(p_id)));
  return v_venda;
end $$;

-- mudar o prazo (a cliente pediu mais uns dias)
create or replace function public.lin_condicional_prazo(p_id bigint, p_prazo date) returns void
language plpgsql security definer set search_path = public as $$
declare c public.lin_condicionais;
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  select * into c from public.lin_condicionais where id = p_id for update;
  if c.id is null then raise exception 'Malinha/reserva não encontrada'; end if;
  if c.situacao <> 'aberta' then raise exception 'Esta malinha/reserva já foi concluída'; end if;
  if p_prazo is null or p_prazo < public._lin_hoje() then raise exception 'O prazo não pode ser antes de hoje'; end if;
  if p_prazo > public._lin_hoje() + 60 then raise exception 'O prazo pode ser de no máximo 60 dias'; end if;
  if p_prazo = c.prazo then return; end if;
  update public.lin_condicionais set prazo = p_prazo, prazo_alterado_em = now() where id = p_id;
  perform public._lin_auditar('linum_condicional_prazo', null, jsonb_build_object('condicional', p_id, 'tipo', public._lin_cond_nome(c.tipo),
    'cliente', (select nome from public.lin_clientes where id = c.cliente_id), 'antes', jsonb_build_object('prazo', c.prazo), 'depois', jsonb_build_object('prazo', p_prazo)));
end $$;

-- resumo para a marca no Estoque: [{variante_id, loja_id, pecas, itens: [{tipo, cliente (primeiro nome), prazo, pecas}]}]
create or replace function public.lin_cond_no_estoque() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.lin_papel() is null then raise exception 'Seu login não tem acesso ao Sistema Linum agora'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('variante_id', x.variante_id, 'loja_id', x.loja_id, 'pecas', x.pecas, 'itens', x.itens))
    from (select i.variante_id, c.loja_id, sum(i.quantidade - i.compradas - i.devolvidas)::int pecas,
                 jsonb_agg(jsonb_build_object('n', c.id, 'tipo', c.tipo, 'cliente', split_part(trim(cl.nome), ' ', 1), 'prazo', c.prazo,
                   'pecas', i.quantidade - i.compradas - i.devolvidas) order by c.prazo, c.id) itens
            from public.lin_cond_itens i join public.lin_condicionais c on c.id = i.condicional_id join public.lin_clientes cl on cl.id = c.cliente_id
           where c.situacao = 'aberta' and i.quantidade - i.compradas - i.devolvidas > 0
           group by 1, 2) x), '[]');
end $$;

revoke execute on function public.lin_condicional_criar(jsonb) from public, anon;
revoke execute on function public.lin_condicional_devolver(bigint, jsonb, text) from public, anon;
revoke execute on function public.lin_condicional_venda(bigint, jsonb, jsonb) from public, anon;
revoke execute on function public.lin_condicional_prazo(bigint, date) from public, anon;
revoke execute on function public.lin_cond_no_estoque() from public, anon;
grant execute on function public.lin_condicional_criar(jsonb) to authenticated;
grant execute on function public.lin_condicional_devolver(bigint, jsonb, text) to authenticated;
grant execute on function public.lin_condicional_venda(bigint, jsonb, jsonb) to authenticated;
grant execute on function public.lin_condicional_prazo(bigint, date) to authenticated;
grant execute on function public.lin_cond_no_estoque() to authenticated;

-- venda: igual à da 2.4 (crédito da cliente); a ÚNICA mudança é aceitar como vendedora quem montou a malinha/reserva,
-- e só quando a venda vem da lin_condicional_venda (ela marca lin.cond_vendedora na transação)
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
    if v_vend <> auth.uid() and coalesce(current_setting('lin.cond_vendedora', true), '') <> v_vend::text then raise exception 'Você só registra as próprias vendas'; end if;
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
