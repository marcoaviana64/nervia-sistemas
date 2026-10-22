-- Sistema Linum: papel "Estoque" (pedido do Marco em 22/10/2026). Quem controla o estoque: cadastra e edita peças,
-- cores, tamanhos e peças especiais, altera o preço de venda e movimenta o estoque (entrada, saída, transferência,
-- ajuste) e vê o histórico, mas NUNCA vê nem altera preço de custo (decisões do Marco: cadastra produtos = sim; altera
-- preço de venda = sim). Dono continua com tudo; Vendedora só consulta.
--   * lin_produtos / lin_variantes (têm custo) continuam legíveis só pelo Dono; o Estoque lê o catálogo pela
--     lin_catalogo(), sem as colunas de custo;
--   * nas funções de cadastro, o custo só é gravado quando quem chama é o Dono; para o Estoque fica o que já estava.

alter table public.lin_membros drop constraint if exists lin_membros_papel_check;
alter table public.lin_membros add constraint lin_membros_papel_check check (papel in ('dono', 'estoque', 'vendedora'));

create or replace function public.lin_controla_estoque() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.lin_papel() in ('dono', 'estoque'), false) $$;

drop policy if exists lin_movimentos_ler on public.lin_movimentos;
create policy lin_movimentos_ler on public.lin_movimentos for select using (public.lin_controla_estoque());

-- auditoria (pedido do Marco em 22/10/2026: "estes registros devem ficar no log pois são sensíveis"): toda movimentação
-- de estoque e toda mudança de cadastro vai também para a tabela auditoria (somente inclusão), com a peça, a loja,
-- quem fez e o papel dele na Linum. Custo nunca vai para o detalhe quando quem fez não é o Dono.
create or replace function public._lin_auditar(p_acao text, p_variante uuid, p_det jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.auditar(p_acao, null, coalesce(p_det, '{}'::jsonb) || jsonb_build_object('papel_linum', public.lin_papel()) ||
    coalesce((select jsonb_build_object('variante_id', v.id, 'produto_id', p.id, 'referencia', p.referencia, 'peca', p.descricao,
                       'cor', v.cor, 'tamanho', v.tamanho, 'edicao', v.edicao)
              from public.lin_variantes v join public.lin_produtos p on p.id = v.produto_id where v.id = p_variante), '{}'::jsonb));
end $$;
revoke execute on function public._lin_auditar(text, uuid, jsonb) from public, anon, authenticated;
create or replace function public._lin_loja(p uuid) returns text
language sql stable security definer set search_path = public as $$ select nome from public.lin_lojas where id = p $$;

-- catálogo completo (inclusive inativos) SEM custo, para a aba Produtos de quem controla o estoque
create or replace function public.lin_catalogo() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque vê o cadastro de produtos'; end if;
  return jsonb_build_object(
    'produtos', coalesce((select jsonb_agg(to_jsonb(p) - 'preco_custo' order by p.descricao, p.referencia) from public.lin_produtos p), '[]'),
    'variantes', coalesce((select jsonb_agg(to_jsonb(v) - 'preco_custo' order by v.criado_em) from public.lin_variantes v), '[]'));
end $$;
revoke execute on function public.lin_catalogo() from public, anon;
grant execute on function public.lin_catalogo() to authenticated;

create or replace function public.lin_movimentar(p_variante uuid, p_loja uuid, p_tipo text, p_quantidade int,
                                                  p_data date default null, p_observacao text default '')
returns int language plpgsql security definer set search_path = public as $$
declare v_disp int; v_nova int;
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque pode movimentar o estoque'; end if;
  if p_tipo not in ('entrada', 'saida') then raise exception 'Tipo inválido'; end if;
  if coalesce(p_quantidade, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero'; end if;
  if not exists (select 1 from public.lin_variantes where id = p_variante) then raise exception 'Variação não encontrada'; end if;
  if not exists (select 1 from public.lin_lojas where id = p_loja) then raise exception 'Loja não encontrada'; end if;
  if p_tipo = 'entrada' then
    insert into public.lin_estoque (variante_id, loja_id, quantidade) values (p_variante, p_loja, p_quantidade)
    on conflict (variante_id, loja_id) do update set quantidade = lin_estoque.quantidade + excluded.quantidade, atualizado_em = now()
    returning quantidade into v_nova;
  else
    select quantidade into v_disp from public.lin_estoque where variante_id = p_variante and loja_id = p_loja for update;
    if coalesce(v_disp, 0) < p_quantidade then
      raise exception 'Estoque insuficiente: a loja tem % peça(s) desta variação', coalesce(v_disp, 0);
    end if;
    update public.lin_estoque set quantidade = quantidade - p_quantidade, atualizado_em = now()
      where variante_id = p_variante and loja_id = p_loja returning quantidade into v_nova;
  end if;
  insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, data, observacao, criado_por, criado_nome)
  values (p_variante, p_loja, p_tipo, p_quantidade, coalesce(p_data, current_date), coalesce(trim(p_observacao), ''),
          auth.uid(), public._lin_nome());
  perform public._lin_auditar('linum_estoque_' || p_tipo, p_variante, jsonb_build_object('loja', public._lin_loja(p_loja),
    'quantidade', p_quantidade, 'saldo_depois', v_nova, 'data', coalesce(p_data, current_date), 'observacao', coalesce(trim(p_observacao), '')));
  return v_nova;
end $$;

create or replace function public.lin_transferir(p_variante uuid, p_origem uuid, p_destino uuid, p_quantidade int,
                                                  p_data date default null, p_observacao text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_disp int;
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque pode transferir'; end if;
  if coalesce(p_quantidade, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero'; end if;
  if p_origem is null or p_destino is null or p_origem = p_destino then raise exception 'Escolha lojas de origem e destino diferentes'; end if;
  if (select count(*) from public.lin_lojas where id in (p_origem, p_destino)) <> 2 then raise exception 'Loja não encontrada'; end if;
  select quantidade into v_disp from public.lin_estoque where variante_id = p_variante and loja_id = p_origem for update;
  if coalesce(v_disp, 0) < p_quantidade then
    raise exception 'Estoque insuficiente na loja de origem: tem % peça(s) desta variação', coalesce(v_disp, 0);
  end if;
  update public.lin_estoque set quantidade = quantidade - p_quantidade, atualizado_em = now()
    where variante_id = p_variante and loja_id = p_origem;
  insert into public.lin_estoque (variante_id, loja_id, quantidade) values (p_variante, p_destino, p_quantidade)
  on conflict (variante_id, loja_id) do update set quantidade = lin_estoque.quantidade + excluded.quantidade, atualizado_em = now();
  insert into public.lin_movimentos (variante_id, loja_id, loja_destino_id, tipo, quantidade, data, observacao, criado_por, criado_nome)
  values (p_variante, p_origem, p_destino, 'transferencia', p_quantidade, coalesce(p_data, current_date),
          coalesce(trim(p_observacao), ''), auth.uid(), public._lin_nome());
  perform public._lin_auditar('linum_estoque_transferencia', p_variante, jsonb_build_object('loja_origem', public._lin_loja(p_origem),
    'loja_destino', public._lin_loja(p_destino), 'quantidade', p_quantidade, 'data', coalesce(p_data, current_date), 'observacao', coalesce(trim(p_observacao), '')));
end $$;

create or replace function public.lin_ajustar(p_variante uuid, p_loja uuid, p_quantidade int,
                                               p_data date default null, p_observacao text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_atual int;
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque pode ajustar o estoque'; end if;
  if p_quantidade is null or p_quantidade < 0 then raise exception 'A nova quantidade não pode ser negativa'; end if;
  if not exists (select 1 from public.lin_variantes where id = p_variante) then raise exception 'Variação não encontrada'; end if;
  if not exists (select 1 from public.lin_lojas where id = p_loja) then raise exception 'Loja não encontrada'; end if;
  select quantidade into v_atual from public.lin_estoque where variante_id = p_variante and loja_id = p_loja for update;
  v_atual := coalesce(v_atual, 0);
  if v_atual = p_quantidade then raise exception 'A loja já tem % peça(s): nada a ajustar', v_atual; end if;
  insert into public.lin_estoque (variante_id, loja_id, quantidade) values (p_variante, p_loja, p_quantidade)
  on conflict (variante_id, loja_id) do update set quantidade = excluded.quantidade, atualizado_em = now();
  insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, antes, depois, data, observacao, criado_por, criado_nome)
  values (p_variante, p_loja, 'ajuste', abs(p_quantidade - v_atual), v_atual, p_quantidade, coalesce(p_data, current_date),
          coalesce(nullif(trim(p_observacao), ''), format('Ajuste de %s para %s', v_atual, p_quantidade)),
          auth.uid(), public._lin_nome());
  perform public._lin_auditar('linum_estoque_ajuste', p_variante, jsonb_build_object('loja', public._lin_loja(p_loja),
    'antes', v_atual, 'depois', p_quantidade, 'data', coalesce(p_data, current_date), 'observacao', coalesce(trim(p_observacao), '')));
end $$;

create or replace function public.lin_variantes_criar(p_produto uuid, p_cores text[], p_tamanhos text[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque cadastra variações'; end if;
  if not exists (select 1 from public.lin_produtos where id = p_produto) then raise exception 'Produto não encontrado'; end if;
  if coalesce(cardinality(array_remove(p_cores, '')), 0) = 0 or coalesce(cardinality(array_remove(p_tamanhos, '')), 0) = 0 then
    raise exception 'Informe ao menos uma cor e um tamanho';
  end if;
  insert into public.lin_variantes (produto_id, cor, tamanho)
  select distinct p_produto, btrim(c), btrim(t) from unnest(p_cores) c, unnest(p_tamanhos) t
  where btrim(c) <> '' and btrim(t) <> ''
  on conflict (produto_id, cor, tamanho, edicao) do nothing;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform public._lin_auditar('linum_variantes_criadas', null, jsonb_build_object('produto_id', p_produto,
      'referencia', (select referencia from public.lin_produtos where id = p_produto), 'cores', p_cores, 'tamanhos', p_tamanhos, 'criadas', v_n));
  end if;
  return v_n;
end $$;

create or replace function public.lin_variante_ativar(p_variante uuid, p_ativo boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque altera variações'; end if;
  update public.lin_variantes set ativo = coalesce(p_ativo, true) where id = p_variante;
  if not found then raise exception 'Variação não encontrada'; end if;
  perform public._lin_auditar(case when coalesce(p_ativo, true) then 'linum_variante_reativada' else 'linum_variante_desativada' end, p_variante, '{}'::jsonb);
end $$;

create or replace function public.lin_variante_excluir(p_variante uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.lin_variantes;
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque exclui variações'; end if;
  select * into v from public.lin_variantes where id = p_variante for update;
  if v.id is null then raise exception 'Variação não encontrada'; end if;
  if exists (select 1 from public.lin_movimentos where variante_id = p_variante) then
    raise exception 'Esta cor/tamanho tem movimentações de estoque. Desative em vez de excluir.';
  end if;
  if exists (select 1 from public.lin_estoque where variante_id = p_variante and quantidade <> 0) then
    raise exception 'Esta cor/tamanho ainda tem estoque. Zere o estoque antes de excluir.';
  end if;
  delete from public.lin_variantes where id = p_variante;
  perform public._lin_auditar('linum_variante_excluida', null, jsonb_build_object('produto_id', v.produto_id,
    'referencia', (select referencia from public.lin_produtos where id = v.produto_id), 'cor', v.cor, 'tamanho', v.tamanho, 'edicao', v.edicao));
end $$;

create or replace function public.lin_produto_excluir(p_produto uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.lin_produtos;
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque exclui produtos'; end if;
  select * into v from public.lin_produtos where id = p_produto for update;
  if v.id is null then raise exception 'Produto não encontrado'; end if;
  if exists (select 1 from public.lin_movimentos m join public.lin_variantes x on x.id = m.variante_id where x.produto_id = p_produto) then
    raise exception 'Esta peça tem movimentações registradas e não pode ser excluída. Desative em vez de excluir.';
  end if;
  if exists (select 1 from public.lin_estoque e join public.lin_variantes x on x.id = e.variante_id where x.produto_id = p_produto and e.quantidade <> 0) then
    raise exception 'Esta peça ainda tem estoque. Zere o estoque antes de excluir.';
  end if;
  delete from public.lin_produtos where id = p_produto;
  perform public._lin_auditar('linum_produto_excluido', null, jsonb_build_object('produto_id', v.id, 'referencia', v.referencia, 'descricao', v.descricao));
end $$;

create or replace function public.lin_produto_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_ref text := public._lin_txt(p, 'referencia');
        v_desc text := public._lin_txt(p, 'descricao'); v_antes jsonb;
        v_dono boolean := public.lin_eh_dono();   -- só o Dono vê e grava custo; para o Estoque o custo gravado fica como está
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque cadastra produtos'; end if;
  if v_ref is null then raise exception 'Informe o código / referência'; end if;
  if v_desc is null then raise exception 'Informe a descrição (nome da peça)'; end if;
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
    perform public._lin_auditar('linum_produto_criado', null, jsonb_build_object('produto_id', v_id, 'referencia', v_ref, 'descricao', v_desc));
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

create or replace function public.lin_variante_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_prod uuid := nullif(p ->> 'produto_id', '')::uuid; v_ed text := coalesce(public._lin_txt(p, 'edicao'), '');
        v_cor text := public._lin_txt(p, 'cor'); v_tam text := public._lin_txt(p, 'tamanho'); v_atual public.lin_variantes; v_dono boolean := public.lin_eh_dono();
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque cadastra variações'; end if;
  if v_id is null then
    if not exists (select 1 from public.lin_produtos where id = v_prod) then raise exception 'Produto não encontrado'; end if;
    if v_cor is null or v_tam is null then raise exception 'Informe a cor e o tamanho'; end if;
    if v_ed = '' then raise exception 'Informe a edição da peça especial (ex.: Bordada, Pintura artística)'; end if;
    if exists (select 1 from public.lin_variantes where produto_id = v_prod and cor = v_cor and tamanho = v_tam and edicao = v_ed) then
      raise exception 'Já existe % % %', v_cor, v_tam, v_ed;
    end if;
    insert into public.lin_variantes (produto_id, cor, tamanho, edicao, preco_venda, preco_custo)
    values (v_prod, v_cor, v_tam, v_ed, public._lin_num(p, 'preco_venda', 'Preço de venda'), case when v_dono then public._lin_num(p, 'preco_custo', 'Preço de custo') end)
    returning id into v_id;
    perform public._lin_auditar('linum_peca_especial_criada', v_id, jsonb_build_object('preco_venda', public._lin_num(p, 'preco_venda', 'Preço de venda'))
      || case when v_dono then jsonb_build_object('preco_custo', public._lin_num(p, 'preco_custo', 'Preço de custo')) else '{}'::jsonb end);
  else
    select * into v_atual from public.lin_variantes where id = v_id for update;
    if v_atual.id is null then raise exception 'Variação não encontrada'; end if;
    if v_ed <> v_atual.edicao and exists (select 1 from public.lin_variantes where produto_id = v_atual.produto_id
         and cor = v_atual.cor and tamanho = v_atual.tamanho and edicao = v_ed and id <> v_id) then
      raise exception 'Já existe % % %', v_atual.cor, v_atual.tamanho, v_ed;
    end if;
    update public.lin_variantes set edicao = v_ed, preco_venda = public._lin_num(p, 'preco_venda', 'Preço de venda'),
      preco_custo = case when v_dono then public._lin_num(p, 'preco_custo', 'Preço de custo') else preco_custo end where id = v_id;
    perform public._lin_auditar('linum_variante_alterada', v_id, jsonb_build_object(
      'antes', jsonb_build_object('edicao', v_atual.edicao, 'preco_venda', v_atual.preco_venda) || case when v_dono then jsonb_build_object('preco_custo', v_atual.preco_custo) else '{}'::jsonb end,
      'depois', (select jsonb_build_object('edicao', edicao, 'preco_venda', preco_venda) || case when v_dono then jsonb_build_object('preco_custo', preco_custo) else '{}'::jsonb end
                 from public.lin_variantes where id = v_id)));
  end if;
  return v_id;
end $$;

create or replace function public.lin_membro_salvar(p_user uuid, p_papel text, p_loja uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia define a equipe da Linum'; end if;
  if p_papel is null or p_papel = '' then
    delete from public.lin_membros where user_id = p_user;
    return;
  end if;
  if p_papel not in ('dono', 'estoque', 'vendedora') then raise exception 'Papel inválido'; end if;
  if not exists (select 1 from public.app_acessos where user_id = p_user and app_id = 'linum') then
    raise exception 'Libere o app Sistema Linum para este login na Área do Cliente (Administração → Logins) antes';
  end if;
  if p_papel = 'vendedora' and p_loja is null then raise exception 'Escolha a loja da vendedora'; end if;
  insert into public.lin_membros (user_id, papel, loja_id) values (p_user, p_papel, p_loja)
  on conflict (user_id) do update set papel = excluded.papel, loja_id = excluded.loja_id, atualizado_em = now();
end $$;
