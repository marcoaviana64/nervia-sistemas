-- Sistema Linum 2.42 — beneficiamento só para Dono e Estoque + marca no Estoque (pedido do Marco em 10/11/2026):
--   "o beneficiamento só ser visto por dona e estoque, vendedoras não podem ver. Na lista de estoque, uma marcação
--    indicando que aquele produto, na cor e tamanho, está em beneficiamento (como a estrela dos especiais); ao apontar
--    o mouse, um texto com a condição da peça — isso a vendedora pode ver, para saber que a peça vai voltar ao estoque —,
--    o que vai virar a peça e a previsão de retorno."
--   * Leitura de lin_beneficiamentos / lin_benef_itens / lin_benef_retornos só para Dono e Estoque (lin_controla_estoque());
--     lin_benef_valores só para quem controla o estoque E tem "Valores da produção" (o Dono tem).
--   * lin_benef_no_estoque(): para toda a equipe, só o resumo do que está fora por variação × loja de origem
--     (quantas peças, serviço, o que vai virar, volta prevista); sem beneficiador, valores nem quem enviou.
--   * lin_beneficiamentos.vai_virar (texto livre opcional, padrão vazio): no envio e na edição.
--   * lin_beneficiamento_editar(id, previsto, vai_virar): Dono/Estoque, só no beneficiamento; auditoria
--     linum_beneficiamento_editado com o antes e o depois.
-- Só acrescenta uma coluna com padrão vazio e troca políticas de leitura: nenhum dado muda.

alter table public.lin_beneficiamentos add column if not exists vai_virar text not null default '';

drop policy if exists lin_beneficiamentos_ler on public.lin_beneficiamentos;
create policy lin_beneficiamentos_ler on public.lin_beneficiamentos for select using (public.lin_controla_estoque());
drop policy if exists lin_benef_itens_ler on public.lin_benef_itens;
create policy lin_benef_itens_ler on public.lin_benef_itens for select using (public.lin_controla_estoque());
drop policy if exists lin_benef_retornos_ler on public.lin_benef_retornos;
create policy lin_benef_retornos_ler on public.lin_benef_retornos for select using (public.lin_controla_estoque());
drop policy if exists lin_benef_valores_ler on public.lin_benef_valores;
create policy lin_benef_valores_ler on public.lin_benef_valores for select using (public.lin_controla_estoque() and public.lin_pode('producao_valores'));

-- resumo para a marca no Estoque (toda a equipe): [{variante_id, loja_id, pecas, itens: [{servico, vai_virar, previsto, pecas}]}]
create or replace function public.lin_benef_no_estoque() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.lin_papel() is null then raise exception 'Seu login não tem acesso ao Sistema Linum agora'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('variante_id', x.variante_id, 'loja_id', x.loja_id, 'pecas', x.pecas, 'itens', x.itens))
    from (select i.variante_id, b.loja_id, sum(i.quantidade - i.voltaram - i.perdidas)::int pecas,
                 jsonb_agg(jsonb_build_object('servico', b.servico, 'vai_virar', b.vai_virar, 'previsto', b.previsto,
                   'pecas', i.quantidade - i.voltaram - i.perdidas) order by b.previsto nulls last, b.id) itens
            from public.lin_benef_itens i join public.lin_beneficiamentos b on b.id = i.beneficiamento_id
           where b.situacao = 'no_beneficiamento' and i.quantidade - i.voltaram - i.perdidas > 0
           group by 1, 2) x), '[]');
end $$;
revoke execute on function public.lin_benef_no_estoque() from public, anon;
grant execute on function public.lin_benef_no_estoque() to authenticated;

-- envio: igual ao da 2.38, com o "vai virar" opcional
create or replace function public.lin_beneficiamento_enviar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_loja uuid := nullif(p ->> 'loja', '')::uuid;
  v_benef text := left(coalesce(trim(p ->> 'beneficiador'), ''), 120);
  v_serv text := left(coalesce(trim(p ->> 'servico'), ''), 200);
  v_prev date := nullif(p ->> 'previsto', '')::date;
  v_obs text := left(coalesce(trim(p ->> 'observacao'), ''), 300);
  v_virar text := left(coalesce(trim(p ->> 'vai_virar'), ''), 120);
  v_valores boolean := public.lin_pode('producao_valores');
  v_id bigint; v_item bigint; r record; v_disp int; v_total int := 0; v_val numeric; v_soma numeric := 0;
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque envia peças para o beneficiamento'; end if;
  if v_loja is null or not exists (select 1 from public.lin_lojas where id = v_loja) then raise exception 'Escolha a loja de onde as peças saem'; end if;
  if length(v_benef) < 2 then raise exception 'Informe quem vai fazer o beneficiamento'; end if;
  if length(v_serv) < 3 then raise exception 'Informe o serviço (ex.: bordado, tingimento, estampa)'; end if;
  if v_prev is not null and v_prev < public._lin_hoje() then raise exception 'A volta prevista não pode ser antes de hoje'; end if;
  if jsonb_typeof(p -> 'itens') <> 'array' or jsonb_array_length(p -> 'itens') = 0 then raise exception 'Escolha as peças do beneficiamento'; end if;
  if jsonb_array_length(p -> 'itens') > 300 then raise exception 'No máximo 300 variações por envio'; end if;

  insert into public.lin_beneficiamentos (loja_id, beneficiador, servico, previsto, vai_virar, observacao, enviado_por, enviado_nome)
  values (v_loja, v_benef, v_serv, v_prev, v_virar, v_obs, auth.uid(), public._lin_nome()) returning id into v_id;

  -- a mesma variação repetida soma (o valor é o primeiro informado)
  for r in select (x ->> 'variante_id')::uuid as variante_id, sum((x ->> 'quantidade')::int) as q,
                  (array_agg(x -> 'valor_unitario') filter (where coalesce(x ->> 'valor_unitario', '') <> ''))[1] as valor
             from jsonb_array_elements(p -> 'itens') x group by 1 order by 1 loop
    if r.variante_id is null or coalesce(r.q, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero em cada peça'; end if;
    if not exists (select 1 from public.lin_variantes where id = r.variante_id) then raise exception 'Variação não encontrada'; end if;
    select quantidade into v_disp from public.lin_estoque where variante_id = r.variante_id and loja_id = v_loja for update;
    if coalesce(v_disp, 0) < r.q then
      raise exception 'Estoque insuficiente em %: % tem % peça(s) e o envio pede %', public._lin_loja(v_loja),
        (select p2.descricao || ' ' || concat_ws(' ', nullif(v.cor, ''), nullif(v.tamanho, ''), nullif(v.edicao, ''))
           from public.lin_variantes v join public.lin_produtos p2 on p2.id = v.produto_id where v.id = r.variante_id),
        coalesce(v_disp, 0), r.q;
    end if;
    update public.lin_estoque set quantidade = quantidade - r.q, atualizado_em = now()
      where variante_id = r.variante_id and loja_id = v_loja;
    insert into public.lin_benef_itens (beneficiamento_id, variante_id, quantidade, referencia, descricao, cor, tamanho, edicao)
    select v_id, v.id, r.q, coalesce(p2.referencia, ''), coalesce(p2.descricao, ''), coalesce(v.cor, ''), coalesce(v.tamanho, ''), coalesce(v.edicao, '')
      from public.lin_variantes v join public.lin_produtos p2 on p2.id = v.produto_id where v.id = r.variante_id
    returning id into v_item;
    v_val := public._lin_valor_txt(r.valor);
    if v_val is not null then
      if not v_valores then raise exception 'Seu login não registra valores do beneficiamento'; end if;
      insert into public.lin_benef_valores (item_id, valor_unitario, atualizado_por, atualizado_nome) values (v_item, v_val, auth.uid(), public._lin_nome());
      v_soma := v_soma + v_val * r.q;
    end if;
    insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, data, observacao, criado_por, criado_nome, beneficiamento_id)
    values (r.variante_id, v_loja, 'benef_envio', r.q, public._lin_hoje(),
            format('Beneficiamento nº %s (%s) com %s', v_id, v_serv, v_benef) || case when v_obs <> '' then ' · ' || v_obs else '' end,
            auth.uid(), public._lin_nome(), v_id);
    v_total := v_total + r.q;
  end loop;

  perform public._lin_auditar('linum_beneficiamento_enviado', null, jsonb_build_object('beneficiamento', v_id,
    'loja', public._lin_loja(v_loja), 'beneficiador', v_benef, 'servico', v_serv, 'previsto', v_prev, 'vai_virar', nullif(v_virar, ''), 'pecas', v_total,
    'observacao', v_obs, 'itens', public._lin_benef_resumo(v_id))
    || case when v_valores and v_soma > 0 then jsonb_build_object('valor_total', v_soma) else '{}'::jsonb end);
  return v_id;
end $$;

-- editar a previsão (volta prevista e o que vai virar) enquanto as peças estão fora
create or replace function public.lin_beneficiamento_editar(p_id bigint, p_previsto date, p_vai_virar text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.lin_beneficiamentos; v_virar text := left(coalesce(trim(p_vai_virar), ''), 120);
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque altera o beneficiamento'; end if;
  select * into b from public.lin_beneficiamentos where id = p_id for update;
  if not found then raise exception 'Beneficiamento não encontrado'; end if;
  if b.situacao <> 'no_beneficiamento' then raise exception 'Este beneficiamento já foi concluído'; end if;
  if p_previsto is not null and p_previsto < public._lin_hoje() and p_previsto is distinct from b.previsto then
    raise exception 'A volta prevista não pode ser antes de hoje';
  end if;
  update public.lin_beneficiamentos set previsto = p_previsto, vai_virar = v_virar where id = p_id;
  perform public._lin_auditar('linum_beneficiamento_editado', null, jsonb_build_object('beneficiamento', p_id,
    'servico', b.servico, 'beneficiador', b.beneficiador,
    'antes', jsonb_build_object('previsto', b.previsto, 'vai_virar', b.vai_virar),
    'depois', jsonb_build_object('previsto', p_previsto, 'vai_virar', v_virar)));
end $$;
revoke execute on function public.lin_beneficiamento_editar(bigint, date, text) from public, anon;
grant execute on function public.lin_beneficiamento_editar(bigint, date, text) to authenticated;
