-- Sistema Linum 2.15: referência provisória no cadastro de produto (pedido do Marco em 27/10/2026: a Beatriz cadastrou
-- peças sem saber a referência e inventou "00lm"/"01lm" para achar depois e trocar pela correta).
--   * lin_produto_salvar: produto NOVO com a referência vazia recebe a automática "NOVA-<ano>-<nº>", a mesma da
--     "+ Peça nova" da Produção (lin_producao_peca_nova); troca-se depois no Editar (o código de barras não muda).
--   * Na edição a referência continua obrigatória (não dá para apagar a de um produto que já tem).
--   * Trava (advisory lock) para dois cadastros ao mesmo tempo não pegarem o mesmo número.
--   * Só muda a função; nenhum dado é alterado.

create or replace function public._lin_ref_provisoria() returns text
language plpgsql security definer set search_path = public as $$
declare v_ano text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY'); v_ref text;
begin
  perform pg_advisory_xact_lock(hashtext('lin_ref_provisoria'));
  select 'NOVA-' || v_ano || '-' || lpad((coalesce(max(regexp_replace(referencia, '^NOVA-' || v_ano || '-', '')::int), 0) + 1)::text, 3, '0')
    into v_ref from public.lin_produtos where referencia ~ ('^NOVA-' || v_ano || '-[0-9]+$');
  return v_ref;
end $$;
revoke execute on function public._lin_ref_provisoria() from public, anon, authenticated;

create or replace function public.lin_produto_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_ref text := public._lin_txt(p, 'referencia');
        v_desc text := public._lin_txt(p, 'descricao'); v_antes jsonb;
        v_dono boolean := public.lin_eh_dono();   -- só o Dono vê e grava custo; para o Estoque o custo gravado fica como está
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque cadastra produtos'; end if;
  if v_ref is null and v_id is not null then raise exception 'Informe o código / referência'; end if;
  if v_desc is null then raise exception 'Informe a descrição (nome da peça)'; end if;
  if v_ref is null then v_ref := public._lin_ref_provisoria(); end if;   -- produto novo sem referência = provisória
  if exists (select 1 from public.lin_produtos where lower(referencia) = lower(v_ref) and id is distinct from v_id) then
    raise exception 'Já existe um produto com a referência %', v_ref;
  end if;
  if v_id is null then
    insert into public.lin_produtos (referencia, descricao, categoria, colecao, fornecedor, tecido, preco_custo, preco_venda, consumo_metros, ativo)
    values (v_ref, v_desc, public._lin_txt(p, 'categoria'), public._lin_txt(p, 'colecao'), public._lin_txt(p, 'fornecedor'),
            public._lin_txt(p, 'tecido'), case when v_dono then public._lin_num(p, 'preco_custo', 'Preço de custo') end,
            coalesce(public._lin_num(p, 'preco_venda', 'Preço de venda'), 0), public._lin_num(p, 'consumo_metros', 'Consumo de tecido'),
            coalesce((p ->> 'ativo')::boolean, true))
    returning id into v_id;
    perform public._lin_auditar('linum_produto_criado', null, jsonb_build_object('produto_id', v_id, 'referencia', v_ref, 'descricao', v_desc)
      || case when public._lin_txt(p, 'referencia') is null then jsonb_build_object('referencia_provisoria', true) else '{}'::jsonb end);
  else
    select to_jsonb(x) - 'atualizado_em' - 'criado_em' into v_antes from public.lin_produtos x where id = v_id for update;
    if v_antes is null then raise exception 'Produto não encontrado'; end if;
    update public.lin_produtos set referencia = v_ref, descricao = v_desc, categoria = public._lin_txt(p, 'categoria'),
      colecao = public._lin_txt(p, 'colecao'), fornecedor = public._lin_txt(p, 'fornecedor'), tecido = public._lin_txt(p, 'tecido'),
      preco_custo = case when v_dono then public._lin_num(p, 'preco_custo', 'Preço de custo') else preco_custo end,
      preco_venda = coalesce(public._lin_num(p, 'preco_venda', 'Preço de venda'), 0),
      consumo_metros = public._lin_num(p, 'consumo_metros', 'Consumo de tecido'),
      ativo = coalesce((p ->> 'ativo')::boolean, true)
    where id = v_id;
    perform public._lin_auditar('linum_produto_alterado', null, jsonb_build_object('produto_id', v_id, 'referencia', v_ref,
      'antes', case when v_dono then v_antes else v_antes - 'preco_custo' end,
      'depois', (select case when v_dono then to_jsonb(x) else to_jsonb(x) - 'preco_custo' end - 'atualizado_em' - 'criado_em' from public.lin_produtos x where id = v_id)));
  end if;
  return v_id;
end $$;
