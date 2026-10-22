-- Sistema Linum: aba Produtos (pedido do Marco em 22/10/2026, antes de liberar o app para a Linum cadastrar o estoque).
-- Mesmas regras do sistema atual (banco linum-produtos: products_set_barcode, next_barcode, variants_set_barcode,
-- delete_product, delete_variant, set_variant_active e a migração 20260928000000_pecas_especiais_e_custo_protegido):
--   * código de barras automático = ano + 7 dígitos (ex.: 20260000236), numeração única para produtos e peças
--     especiais, reinicia a cada ano; depois de gravado não muda;
--   * cada cor × tamanho é uma variação; peça especial (bordada, pintada...) = variação com "edição" preenchida, que
--     pode repetir cor e tamanho, ganha código de barras próprio e pode ter preço de venda/custo próprios
--     (vazio = preço do produto);
--   * excluir só sem movimentação e sem estoque; com histórico, desativa (some do estoque e das vendas).
-- Escrita só pelas funções abaixo (Dono), com auditoria.

create table if not exists public.lin_codigos (
  ano    int primary key,
  ultimo int not null default 0
);
alter table public.lin_codigos enable row level security;   -- sem policy: só as funções mexem

create or replace function public.lin_proximo_codigo() returns text
language plpgsql security definer set search_path = public as $$
declare v_ano int := extract(year from now() at time zone 'America/Sao_Paulo')::int; v_seq int;
begin
  insert into public.lin_codigos (ano, ultimo) values (v_ano, 1)
  on conflict (ano) do update set ultimo = lin_codigos.ultimo + 1
  returning ultimo into v_seq;
  return v_ano::text || lpad(v_seq::text, 7, '0');
end $$;
revoke execute on function public.lin_proximo_codigo() from public, anon, authenticated;

create or replace function public.lin_produtos_codigo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(btrim(new.codigo_barras), '') = '' then new.codigo_barras := public.lin_proximo_codigo(); end if;
  else
    new.codigo_barras := old.codigo_barras;   -- o código impresso na etiqueta não muda
    new.atualizado_em := now();
  end if;
  return new;
end $$;
drop trigger if exists lin_produtos_codigo on public.lin_produtos;
create trigger lin_produtos_codigo before insert or update on public.lin_produtos
  for each row execute function public.lin_produtos_codigo();

create or replace function public.lin_variantes_codigo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.edicao <> '' and coalesce(btrim(new.codigo_barras), '') = '' then new.codigo_barras := public.lin_proximo_codigo(); end if;
  elsif coalesce(btrim(old.codigo_barras), '') = '' and new.edicao <> '' then
    new.codigo_barras := public.lin_proximo_codigo();   -- variação que virou peça especial ganha código próprio
  else
    new.codigo_barras := old.codigo_barras;
  end if;
  return new;
end $$;
drop trigger if exists lin_variantes_codigo on public.lin_variantes;
create trigger lin_variantes_codigo before insert or update on public.lin_variantes
  for each row execute function public.lin_variantes_codigo();

-- ---------------------------------------------------------------- funções da tela (Dono)
create or replace function public._lin_txt(p jsonb, k text) returns text
language sql immutable as $$ select nullif(btrim(coalesce(p ->> k, '')), '') $$;
create or replace function public._lin_num(p jsonb, k text, rotulo text) returns numeric
language plpgsql immutable as $$
declare v numeric;
begin
  if public._lin_txt(p, k) is null then return null; end if;
  begin v := (p ->> k)::numeric; exception when others then raise exception '% inválido', rotulo; end;
  if v < 0 then raise exception '% não pode ser negativo', rotulo; end if;
  return v;
end $$;

-- novo (sem "id") ou edição; devolve o id
create or replace function public.lin_produto_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_ref text := public._lin_txt(p, 'referencia');
        v_desc text := public._lin_txt(p, 'descricao'); v_antes jsonb;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono cadastra produtos'; end if;
  if v_ref is null then raise exception 'Informe o código / referência'; end if;
  if v_desc is null then raise exception 'Informe a descrição (nome da peça)'; end if;
  if exists (select 1 from public.lin_produtos where lower(referencia) = lower(v_ref) and id is distinct from v_id) then
    raise exception 'Já existe um produto com a referência %', v_ref;
  end if;
  if v_id is null then
    insert into public.lin_produtos (referencia, descricao, categoria, colecao, fornecedor, tecido, preco_custo, preco_venda, consumo_metros, ativo)
    values (v_ref, v_desc, public._lin_txt(p, 'categoria'), public._lin_txt(p, 'colecao'), public._lin_txt(p, 'fornecedor'),
            public._lin_txt(p, 'tecido'), public._lin_num(p, 'preco_custo', 'Preço de custo'),
            coalesce(public._lin_num(p, 'preco_venda', 'Preço de venda'), 0), public._lin_num(p, 'consumo_metros', 'Consumo de tecido'),
            coalesce((p ->> 'ativo')::boolean, true))
    returning id into v_id;
    perform public.auditar('linum_produto_criado', null, jsonb_build_object('produto_id', v_id, 'referencia', v_ref, 'descricao', v_desc));
  else
    select to_jsonb(x) - 'atualizado_em' - 'criado_em' into v_antes from public.lin_produtos x where id = v_id for update;
    if v_antes is null then raise exception 'Produto não encontrado'; end if;
    update public.lin_produtos set referencia = v_ref, descricao = v_desc, categoria = public._lin_txt(p, 'categoria'),
      colecao = public._lin_txt(p, 'colecao'), fornecedor = public._lin_txt(p, 'fornecedor'), tecido = public._lin_txt(p, 'tecido'),
      preco_custo = public._lin_num(p, 'preco_custo', 'Preço de custo'),
      preco_venda = coalesce(public._lin_num(p, 'preco_venda', 'Preço de venda'), 0),
      consumo_metros = public._lin_num(p, 'consumo_metros', 'Consumo de tecido'),
      ativo = coalesce((p ->> 'ativo')::boolean, true)
    where id = v_id;
    perform public.auditar('linum_produto_alterado', null, jsonb_build_object('produto_id', v_id, 'referencia', v_ref, 'antes', v_antes,
      'depois', (select to_jsonb(x) - 'atualizado_em' - 'criado_em' from public.lin_produtos x where id = v_id)));
  end if;
  return v_id;
end $$;

-- cria as combinações cor × tamanho que ainda não existem (sem edição); devolve quantas criou
create or replace function public.lin_variantes_criar(p_produto uuid, p_cores text[], p_tamanhos text[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono cadastra variações'; end if;
  if not exists (select 1 from public.lin_produtos where id = p_produto) then raise exception 'Produto não encontrado'; end if;
  if coalesce(cardinality(array_remove(p_cores, '')), 0) = 0 or coalesce(cardinality(array_remove(p_tamanhos, '')), 0) = 0 then
    raise exception 'Informe ao menos uma cor e um tamanho';
  end if;
  insert into public.lin_variantes (produto_id, cor, tamanho)
  select distinct p_produto, btrim(c), btrim(t) from unnest(p_cores) c, unnest(p_tamanhos) t
  where btrim(c) <> '' and btrim(t) <> ''
  on conflict (produto_id, cor, tamanho, edicao) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- peça especial nova (sem "id") ou preços/edição de uma variação; devolve o id
create or replace function public.lin_variante_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_prod uuid := nullif(p ->> 'produto_id', '')::uuid; v_ed text := coalesce(public._lin_txt(p, 'edicao'), '');
        v_cor text := public._lin_txt(p, 'cor'); v_tam text := public._lin_txt(p, 'tamanho'); v_atual public.lin_variantes;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono cadastra variações'; end if;
  if v_id is null then
    if not exists (select 1 from public.lin_produtos where id = v_prod) then raise exception 'Produto não encontrado'; end if;
    if v_cor is null or v_tam is null then raise exception 'Informe a cor e o tamanho'; end if;
    if v_ed = '' then raise exception 'Informe a edição da peça especial (ex.: Bordada, Pintura artística)'; end if;
    if exists (select 1 from public.lin_variantes where produto_id = v_prod and cor = v_cor and tamanho = v_tam and edicao = v_ed) then
      raise exception 'Já existe % % %', v_cor, v_tam, v_ed;
    end if;
    insert into public.lin_variantes (produto_id, cor, tamanho, edicao, preco_venda, preco_custo)
    values (v_prod, v_cor, v_tam, v_ed, public._lin_num(p, 'preco_venda', 'Preço de venda'), public._lin_num(p, 'preco_custo', 'Preço de custo'))
    returning id into v_id;
  else
    select * into v_atual from public.lin_variantes where id = v_id for update;
    if v_atual.id is null then raise exception 'Variação não encontrada'; end if;
    if v_ed <> v_atual.edicao and exists (select 1 from public.lin_variantes where produto_id = v_atual.produto_id
         and cor = v_atual.cor and tamanho = v_atual.tamanho and edicao = v_ed and id <> v_id) then
      raise exception 'Já existe % % %', v_atual.cor, v_atual.tamanho, v_ed;
    end if;
    update public.lin_variantes set edicao = v_ed, preco_venda = public._lin_num(p, 'preco_venda', 'Preço de venda'),
      preco_custo = public._lin_num(p, 'preco_custo', 'Preço de custo') where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.lin_variante_ativar(p_variante uuid, p_ativo boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono altera variações'; end if;
  update public.lin_variantes set ativo = coalesce(p_ativo, true) where id = p_variante;
  if not found then raise exception 'Variação não encontrada'; end if;
end $$;

create or replace function public.lin_variante_excluir(p_variante uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.lin_variantes;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono exclui variações'; end if;
  select * into v from public.lin_variantes where id = p_variante for update;
  if v.id is null then raise exception 'Variação não encontrada'; end if;
  if exists (select 1 from public.lin_movimentos where variante_id = p_variante) then
    raise exception 'Esta cor/tamanho tem movimentações de estoque. Desative em vez de excluir.';
  end if;
  if exists (select 1 from public.lin_estoque where variante_id = p_variante and quantidade <> 0) then
    raise exception 'Esta cor/tamanho ainda tem estoque. Zere o estoque antes de excluir.';
  end if;
  delete from public.lin_variantes where id = p_variante;
  perform public.auditar('linum_variante_excluida', null, jsonb_build_object('produto_id', v.produto_id,
    'referencia', (select referencia from public.lin_produtos where id = v.produto_id), 'cor', v.cor, 'tamanho', v.tamanho, 'edicao', v.edicao));
end $$;

create or replace function public.lin_produto_excluir(p_produto uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.lin_produtos;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono exclui produtos'; end if;
  select * into v from public.lin_produtos where id = p_produto for update;
  if v.id is null then raise exception 'Produto não encontrado'; end if;
  if exists (select 1 from public.lin_movimentos m join public.lin_variantes x on x.id = m.variante_id where x.produto_id = p_produto) then
    raise exception 'Esta peça tem movimentações registradas e não pode ser excluída. Desative em vez de excluir.';
  end if;
  if exists (select 1 from public.lin_estoque e join public.lin_variantes x on x.id = e.variante_id where x.produto_id = p_produto and e.quantidade <> 0) then
    raise exception 'Esta peça ainda tem estoque. Zere o estoque antes de excluir.';
  end if;
  delete from public.lin_produtos where id = p_produto;
  perform public.auditar('linum_produto_excluido', null, jsonb_build_object('produto_id', v.id, 'referencia', v.referencia, 'descricao', v.descricao));
end $$;

do $$ declare f text; begin
  foreach f in array array['lin_produto_salvar(jsonb)', 'lin_variantes_criar(uuid, text[], text[])', 'lin_variante_salvar(jsonb)',
                           'lin_variante_ativar(uuid, boolean)', 'lin_variante_excluir(uuid)', 'lin_produto_excluir(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
