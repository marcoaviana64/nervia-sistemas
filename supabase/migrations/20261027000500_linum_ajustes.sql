-- Sistema Linum 2.8: ajustes da peça vendida (pedido do Marco em 27/10/2026): "a pessoa comprou, mas uma, duas ou três
-- peças precisam de ajustes — apertar do lado, na cava, bainha. A loja segura a peça, marca o que fazer e manda para a
-- costureira; demora no máximo uns 10 dias úteis, contando a partir do dia seguinte à compra. Na venda escolhe a peça,
-- diz que vai para ajuste, escolhe a costureira, a data de retorno e o valor que ela cobra, e envia."
--   * lin_ajustes: uma linha por peça da venda que vai para ajuste (pode haver mais de um ajuste na mesma peça, ex.: voltou
--     e precisou de outro). A peça já saiu do estoque na venda: o ajuste não mexe no estoque.
--   * Situação: na_costureira → pronto (voltou para a loja) → entregue (à cliente); ou cancelado (com motivo).
--   * Prazo padrão = 10 dias úteis (seg. a sex.) contados a partir do dia seguinte à compra (_lin_dias_uteis); feriados
--     não entram na conta — a data pode ser trocada no envio.
--   * Costureira = parceira cadastrada (lin_parceiros, tipo costureira) ou um nome escrito na hora; lin_costureiras() dá
--     a lista (nome e telefone, sem preço) a quem vende, que não lê a tabela de parceiros.
--   * valor_costureira = quanto a costureira cobra pelo ajuste (custo da loja); valor_cliente = se a loja cobra da
--     cliente (0 = cortesia).
--   * Quem vende registra e acompanha; toda a equipe que vende vê os ajustes (quem está na loja entrega a peça).
--     Escrita só pelas funções, auditoria linum_ajuste_*.

create table if not exists public.lin_ajustes (
  id                bigint generated always as identity primary key,
  venda_id          bigint not null references public.lin_vendas,
  venda_item_id     bigint not null references public.lin_venda_itens,
  quantidade        int not null default 1 check (quantidade > 0),
  loja_id           uuid not null references public.lin_lojas,
  cliente_id        uuid references public.lin_clientes on delete set null,
  peca              text not null default '',           -- cópia da etiqueta: "REF Descrição — cor tamanho edição"
  servico           text not null check (length(trim(servico)) > 1),   -- o que fazer (bainha, apertar cava…)
  parceiro_id       uuid references public.lin_parceiros on delete set null,
  costureira        text not null check (length(trim(costureira)) > 1),
  prazo             date not null,
  valor_costureira  numeric(10,2) not null default 0 check (valor_costureira >= 0),
  valor_cliente     numeric(10,2) not null default 0 check (valor_cliente >= 0),
  observacao        text not null default '',
  situacao          text not null default 'na_costureira' check (situacao in ('na_costureira', 'pronto', 'entregue', 'cancelado')),
  enviado_em        timestamptz not null default now(),
  enviado_por       uuid references auth.users on delete set null,
  enviado_nome      text not null default '',
  pronto_em         timestamptz,
  pronto_nome       text,
  entregue_em       timestamptz,
  entregue_nome     text,
  cancelado_em      timestamptz,
  cancelado_nome    text,
  motivo_cancelamento text
);
create index if not exists lin_ajustes_situacao on public.lin_ajustes (situacao, prazo);
create index if not exists lin_ajustes_venda on public.lin_ajustes (venda_id);

alter table public.lin_ajustes enable row level security;
revoke insert, update, delete on public.lin_ajustes from anon, authenticated;
drop policy if exists lin_ajustes_ler on public.lin_ajustes;
create policy lin_ajustes_ler on public.lin_ajustes for select using (public.lin_vende());

-- n dias úteis (seg. a sex.) contados a partir do dia seguinte a p_data
create or replace function public._lin_dias_uteis(p_data date, p_n int) returns date
language sql immutable as $$
  select d::date from generate_series(p_data + 1, p_data + p_n * 2 + 10, interval '1 day') d
   where extract(isodow from d) < 6 order by d offset greatest(p_n, 1) - 1 limit 1
$$;

-- costureiras para quem vende (sem preço por peça)
create or replace function public.lin_costureiras() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'telefone', telefone) order by nome)
                     from public.lin_parceiros where tipo = 'costureira' and ativo), '[]');
end $$;

-- p = {venda_item_id, quantidade?, servico, parceiro_id? | costureira?, prazo?, valor_costureira?, valor_cliente?, observacao?}
create or replace function public.lin_ajuste_registrar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_item public.lin_venda_itens; v public.lin_vendas; v_parc uuid := nullif(p ->> 'parceiro_id', '')::uuid; v_cost text := public._lin_txt(p, 'costureira');
        v_q int := coalesce(nullif(p ->> 'quantidade', '')::int, 1); v_prazo date := nullif(p ->> 'prazo', '')::date; v_id bigint; v_peca text;
        v_vc numeric := coalesce(public._lin_num(p, 'valor_costureira', 'Valor da costureira'), 0);
        v_vcli numeric := coalesce(public._lin_num(p, 'valor_cliente', 'Valor cobrado da cliente'), 0);
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  select * into v_item from public.lin_venda_itens where id = nullif(p ->> 'venda_item_id', '')::bigint;
  if v_item.id is null then raise exception 'Peça da venda não encontrada'; end if;
  select * into v from public.lin_vendas where id = v_item.venda_id;
  if v.cancelada_em is not null then raise exception 'A venda nº % foi cancelada', v.id; end if;
  if not public.lin_eh_dono() and v.vendedora_id is distinct from auth.uid() then raise exception 'Só quem fez a venda (ou o Dono) manda a peça para ajuste'; end if;
  if v_q < 1 or v_q > v_item.quantidade then raise exception 'Quantidade: de 1 a % (o que foi comprado dessa peça)', v_item.quantidade; end if;
  if public._lin_txt(p, 'servico') is null then raise exception 'Escreva o que a costureira vai fazer (ex.: bainha, apertar a cava)'; end if;
  if v_parc is not null then
    select nome into v_cost from public.lin_parceiros where id = v_parc and tipo = 'costureira';
    if v_cost is null then raise exception 'Costureira não encontrada'; end if;
  end if;
  if v_cost is null then raise exception 'Escolha a costureira'; end if;
  v_prazo := coalesce(v_prazo, public._lin_dias_uteis(v.data, 10));
  if v_prazo < v.data then raise exception 'A data de retorno não pode ser antes da compra'; end if;
  v_peca := trim(v_item.referencia || ' ' || v_item.descricao || ' — ' || concat_ws(' ', nullif(v_item.cor, ''), nullif(v_item.tamanho, ''), nullif(v_item.edicao, '')));
  insert into public.lin_ajustes (venda_id, venda_item_id, quantidade, loja_id, cliente_id, peca, servico, parceiro_id, costureira, prazo,
                                  valor_costureira, valor_cliente, observacao, enviado_por, enviado_nome)
  values (v.id, v_item.id, v_q, v.loja_id, v.cliente_id, v_peca, public._lin_txt(p, 'servico'), v_parc, v_cost, v_prazo,
          round(v_vc, 2), round(v_vcli, 2), coalesce(public._lin_txt(p, 'observacao'), ''), auth.uid(), public._lin_nome())
  returning id into v_id;
  perform public._lin_auditar('linum_ajuste_enviado', null, jsonb_build_object('ajuste', v_id, 'venda', v.id, 'peca', v_peca, 'quantidade', v_q,
    'servico', public._lin_txt(p, 'servico'), 'costureira', v_cost, 'prazo', v_prazo, 'valor_costureira', round(v_vc, 2), 'valor_cliente', round(v_vcli, 2),
    'cliente', (select nome from public.lin_clientes where id = v.cliente_id)));
  return v_id;
end $$;

-- andamento: 'pronto' (voltou da costureira), 'entregue' (cliente levou), 'cancelar' (com motivo), 'reabrir' (voltou para a costureira)
create or replace function public.lin_ajuste_andamento(p_ajuste bigint, p_acao text, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a public.lin_ajustes;
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  select * into a from public.lin_ajustes where id = p_ajuste for update;
  if a.id is null then raise exception 'Ajuste não encontrado'; end if;
  if p_acao = 'pronto' then
    if a.situacao <> 'na_costureira' then raise exception 'Este ajuste não está com a costureira'; end if;
    update public.lin_ajustes set situacao = 'pronto', pronto_em = now(), pronto_nome = public._lin_nome() where id = p_ajuste;
  elsif p_acao = 'entregue' then
    if a.situacao not in ('pronto', 'na_costureira') then raise exception 'Este ajuste já foi % ', case a.situacao when 'entregue' then 'entregue' else 'cancelado' end; end if;
    update public.lin_ajustes set situacao = 'entregue', pronto_em = coalesce(pronto_em, now()), pronto_nome = coalesce(pronto_nome, public._lin_nome()),
           entregue_em = now(), entregue_nome = public._lin_nome() where id = p_ajuste;
  elsif p_acao = 'reabrir' then
    if a.situacao <> 'pronto' then raise exception 'Só volta para a costureira um ajuste que está pronto na loja'; end if;
    if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Diga o que faltou ajustar'; end if;
    update public.lin_ajustes set situacao = 'na_costureira', pronto_em = null, pronto_nome = null,
           observacao = trim(observacao || E'\n' || 'Voltou para a costureira: ' || trim(p_motivo)) where id = p_ajuste;
  elsif p_acao = 'cancelar' then
    if a.situacao in ('entregue', 'cancelado') then raise exception 'Este ajuste já foi encerrado'; end if;
    if not public.lin_eh_dono() and a.enviado_por is distinct from auth.uid() then raise exception 'Só quem registrou (ou o Dono) cancela o ajuste'; end if;
    if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do cancelamento'; end if;
    update public.lin_ajustes set situacao = 'cancelado', cancelado_em = now(), cancelado_nome = public._lin_nome(), motivo_cancelamento = trim(p_motivo) where id = p_ajuste;
  else
    raise exception 'Ação inválida';
  end if;
  perform public._lin_auditar('linum_ajuste_' || case p_acao when 'pronto' then 'pronto' when 'entregue' then 'entregue' when 'reabrir' then 'reaberto' else 'cancelado' end, null,
    jsonb_build_object('ajuste', p_ajuste, 'venda', a.venda_id, 'peca', a.peca, 'costureira', a.costureira, 'motivo', nullif(trim(coalesce(p_motivo, '')), '')));
end $$;

do $$ declare f text; begin
  foreach f in array array['lin_costureiras()', 'lin_ajuste_registrar(jsonb)', 'lin_ajuste_andamento(bigint, text, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke execute on function public._lin_dias_uteis(date, int) from public, anon;
  grant execute on function public._lin_dias_uteis(date, int) to authenticated;
end $$;
