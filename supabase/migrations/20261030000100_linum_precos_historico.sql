-- Sistema Linum 2.22: histórico de preços da peça (pedido do Marco em 30/10/2026: "na ficha do produto ter um histórico de
-- valores; quando alterar valor, registrar na ficha do produto, até os artesanais; assim podemos controlar em que momento
-- os valores são válidos").
--   * lin_precos_hist: SOMENTE INCLUSÃO. Uma linha a cada mudança do preço de venda ou do custo — da peça (variante_id
--     vazio) ou de uma variação com preço próprio (peças especiais: edição, cor, tamanho) —, com o valor antes e depois,
--     "vale desde" (hora do servidor), de onde veio (cadastro, ficha de custo <nome>…) e quem fez.
--   * Gravado por GATILHO em lin_produtos e lin_variantes: vale para qualquer caminho (aba Produtos, peça especial,
--     ficha de custo, Produção). A origem vem de set_config('lin.preco_origem'), posta pelas funções da ficha de custo;
--     sem ela = "cadastro". Variação criada sem preço próprio não entra (usa o da peça).
--   * Situação inicial: os preços que já estavam cadastrados entram com a origem "preço já cadastrado (início do histórico)".
--   * Leitura: tabela só para o Dono; a tela lê por lin_precos_historico(produto), que mostra a venda para quem cadastra
--     (Dono e Estoque) e o custo só para o Dono.

create table if not exists public.lin_precos_hist (
  id                bigint generated always as identity primary key,
  produto_id        uuid not null,
  variante_id       uuid,
  referencia        text not null default '',
  peca              text not null default '',   -- cor, tamanho e edição da variação (vazio = a peça)
  edicao            text not null default '',
  preco_venda_antes numeric,
  preco_venda       numeric,
  preco_custo_antes numeric,
  preco_custo       numeric,
  vale_desde        timestamptz not null default now(),
  origem            text not null default 'cadastro',
  quem_id           uuid,
  quem_nome         text not null default ''
);
create index if not exists lin_precos_hist_produto on public.lin_precos_hist (produto_id, vale_desde desc);
alter table public.lin_precos_hist enable row level security;
revoke insert, update, delete on public.lin_precos_hist from anon, authenticated;
revoke all on public.lin_precos_hist from anon;
drop policy if exists lin_precos_hist_ler on public.lin_precos_hist;
create policy lin_precos_hist_ler on public.lin_precos_hist for select using (public.lin_eh_dono());

create or replace function public.lin_precos_hist_imutavel() returns trigger
language plpgsql as $$ begin raise exception 'O histórico de preços não pode ser alterado nem apagado'; end $$;
drop trigger if exists lin_precos_hist_imutavel on public.lin_precos_hist;
create trigger lin_precos_hist_imutavel before update or delete on public.lin_precos_hist
  for each row execute function public.lin_precos_hist_imutavel();

create or replace function public._lin_preco_origem() returns text
language sql stable as $$ select coalesce(nullif(current_setting('lin.preco_origem', true), ''), 'cadastro') $$;

create or replace function public.lin_produtos_preco_hist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.preco_venda, 0) = 0 and new.preco_custo is null then return new; end if;
  elsif new.preco_venda is not distinct from old.preco_venda and new.preco_custo is not distinct from old.preco_custo then
    return new;
  end if;
  insert into public.lin_precos_hist (produto_id, referencia, preco_venda_antes, preco_venda, preco_custo_antes, preco_custo, origem, quem_id, quem_nome)
  values (new.id, new.referencia, case when tg_op = 'UPDATE' then old.preco_venda end, new.preco_venda,
          case when tg_op = 'UPDATE' then old.preco_custo end, new.preco_custo, public._lin_preco_origem(), auth.uid(), coalesce(public._lin_nome(), ''));
  return new;
end $$;
drop trigger if exists lin_produtos_preco_hist on public.lin_produtos;
create trigger lin_produtos_preco_hist after insert or update of preco_venda, preco_custo on public.lin_produtos
  for each row execute function public.lin_produtos_preco_hist();

create or replace function public.lin_variantes_preco_hist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.preco_venda is null and new.preco_custo is null then return new; end if;
  elsif new.preco_venda is not distinct from old.preco_venda and new.preco_custo is not distinct from old.preco_custo then
    return new;
  end if;
  insert into public.lin_precos_hist (produto_id, variante_id, referencia, peca, edicao, preco_venda_antes, preco_venda, preco_custo_antes, preco_custo,
                                      origem, quem_id, quem_nome)
  values (new.produto_id, new.id, coalesce((select referencia from public.lin_produtos where id = new.produto_id), ''),
          concat_ws(' ', nullif(new.cor, ''), nullif(new.tamanho, '')), coalesce(new.edicao, ''),
          case when tg_op = 'UPDATE' then old.preco_venda end, new.preco_venda,
          case when tg_op = 'UPDATE' then old.preco_custo end, new.preco_custo, public._lin_preco_origem(), auth.uid(), coalesce(public._lin_nome(), ''));
  return new;
end $$;
drop trigger if exists lin_variantes_preco_hist on public.lin_variantes;
create trigger lin_variantes_preco_hist after insert or update of preco_venda, preco_custo on public.lin_variantes
  for each row execute function public.lin_variantes_preco_hist();

-- situação inicial (uma vez): os preços que já estão no cadastro
insert into public.lin_precos_hist (produto_id, referencia, preco_venda, preco_custo, origem, quem_nome)
select id, referencia, preco_venda, preco_custo, 'preço já cadastrado (início do histórico)', 'Sistema'
  from public.lin_produtos where (coalesce(preco_venda, 0) <> 0 or preco_custo is not null)
   and not exists (select 1 from public.lin_precos_hist h where h.produto_id = lin_produtos.id and h.variante_id is null);
insert into public.lin_precos_hist (produto_id, variante_id, referencia, peca, edicao, preco_venda, preco_custo, origem, quem_nome)
select v.produto_id, v.id, p.referencia, concat_ws(' ', nullif(v.cor, ''), nullif(v.tamanho, '')), coalesce(v.edicao, ''), v.preco_venda, v.preco_custo,
       'preço já cadastrado (início do histórico)', 'Sistema'
  from public.lin_variantes v join public.lin_produtos p on p.id = v.produto_id
 where (v.preco_venda is not null or v.preco_custo is not null)
   and not exists (select 1 from public.lin_precos_hist h where h.variante_id = v.id);

-- leitura pela tela: venda para quem cadastra (Dono e Estoque), custo só para o Dono
create or replace function public.lin_precos_historico(p_produto uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_dono boolean := public.lin_eh_dono();
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque vê o histórico de preços'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('vale_desde', h.vale_desde, 'variante_id', h.variante_id, 'peca', h.peca, 'edicao', h.edicao,
           'preco_venda_antes', h.preco_venda_antes, 'preco_venda', h.preco_venda, 'origem', h.origem, 'quem', h.quem_nome)
           || case when v_dono then jsonb_build_object('preco_custo_antes', h.preco_custo_antes, 'preco_custo', h.preco_custo) else '{}'::jsonb end
           order by h.vale_desde desc, h.id desc)
    from public.lin_precos_hist h where h.produto_id = p_produto
     and (v_dono or h.preco_venda is distinct from h.preco_venda_antes or h.preco_venda_antes is null)), '[]'::jsonb);
end $$;
revoke execute on function public.lin_precos_historico(uuid) from public, anon;
grant execute on function public.lin_precos_historico(uuid) to authenticated;
revoke execute on function public._lin_preco_origem() from public, anon, authenticated;

-- as funções da ficha de custo dizem a origem ("ficha de custo <nome>") para o histórico
create or replace function public.lin_custos_aplicar(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare c record; p public.lin_produtos; v_prod uuid; v_usados text[] := '{}'; v_n int := 0; v_chave text; v_ed text; v_q int; v_antes jsonb;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera os custos'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'Marque ao menos uma ficha'; end if;
  for c in select * from public.lin_custos where id = any(p_ids) order by ficha for update loop
    if c.rascunho then raise exception 'A ficha % é uma cópia/simulação: não atualiza o cadastro', c.ficha; end if;
    v_prod := coalesce(c.produto_id, (select x.id from public.lin_produtos x
                where upper(btrim(x.referencia)) = upper(coalesce(nullif(btrim(c.referencia), ''), btrim(c.ficha))) limit 1));
    if v_prod is null then raise exception 'A ficha % não tem peça no cadastro', c.ficha; end if;
    v_ed := lower(btrim(coalesce(c.edicao, '')));
    -- ficha de uma versão (artesanal, bordada, blend…) sem a peça especial escolhida não mexe na peça normal
    if v_ed = '' and btrim(coalesce(c.versao, '')) <> ''
       and lower(btrim(c.versao)) not in (lower(btrim(c.ficha)), lower(btrim(coalesce(c.referencia, ''))), lower(btrim(coalesce(c.descricao, '')))) then
      raise exception 'A ficha % é da versão "%": escolha na ficha a peça especial no cadastro (se a peça ainda não tem, crie em Produtos → Nova peça especial). Se esta ficha é a da peça normal, apague o campo Versão.', c.ficha, btrim(c.versao);
    end if;
    v_chave := v_prod::text || '|' || v_ed;
    if v_chave = any(v_usados) then
      raise exception 'Duas fichas marcadas são da mesma peça (%): marque só uma', (select referencia from public.lin_produtos where id = v_prod)
        || case when v_ed <> '' then ' — ' || c.edicao else '' end;
    end if;
    v_usados := v_usados || v_chave;
    if coalesce(c.venda, 0) <= 0 then raise exception 'A ficha % está sem valor de venda', c.ficha; end if;
    if coalesce(c.custo, 0) <= 0 then raise exception 'A ficha % está com custo zero', c.ficha; end if;
    select * into p from public.lin_produtos where id = v_prod for update;
    perform set_config('lin.preco_origem', 'ficha de custo ' || c.ficha, true);
    if v_ed <> '' then
      -- ficha de peça especial (artesanal, bordada…): o preço e o custo vão para as variações com essa edição
      select jsonb_build_object('preco_venda', min(preco_venda), 'preco_custo', min(preco_custo)) into v_antes
        from public.lin_variantes where produto_id = v_prod and lower(btrim(edicao)) = v_ed;
      update public.lin_variantes set preco_venda = round(c.venda, 2), preco_custo = round(c.custo, 2)
       where produto_id = v_prod and lower(btrim(edicao)) = v_ed;
      get diagnostics v_q = row_count;
      if v_q = 0 then raise exception 'A peça % não tem peças especiais "%": crie em Produtos (Nova peça especial) ou escolha outra na ficha %', p.referencia, c.edicao, c.ficha; end if;
      if c.produto_id is distinct from v_prod then update public.lin_custos set produto_id = v_prod where id = c.id; end if;
      perform public._lin_auditar('linum_variante_alterada', null, jsonb_build_object('produto_id', v_prod, 'referencia', p.referencia,
        'descricao', p.descricao, 'edicao', c.edicao, 'variacoes', v_q, 'pela_ficha_custo', c.ficha, 'antes', v_antes,
        'depois', jsonb_build_object('preco_venda', round(c.venda, 2), 'preco_custo', round(c.custo, 2))));
      v_n := v_n + 1;
      continue;
    end if;
    update public.lin_produtos set preco_venda = round(c.venda, 2), preco_custo = round(c.custo, 2) where id = v_prod;
    if c.produto_id is distinct from v_prod then update public.lin_custos set produto_id = v_prod where id = c.id; end if;
    perform public._lin_auditar('linum_produto_alterado', null, jsonb_build_object('produto_id', v_prod, 'referencia', p.referencia,
      'descricao', p.descricao, 'pela_ficha_custo', c.ficha,
      'antes', jsonb_build_object('preco_venda', p.preco_venda, 'preco_custo', p.preco_custo),
      'depois', jsonb_build_object('preco_venda', round(c.venda, 2), 'preco_custo', round(c.custo, 2))));
    v_n := v_n + 1;
  end loop;
  if v_n <> cardinality(p_ids) then raise exception 'Ficha de custo não encontrada'; end if;
  return v_n;
end $$;

create or replace function public.lin_custo_enviar(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.lin_custos; v_prod uuid; v_ref text;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera os custos'; end if;
  select * into c from public.lin_custos where id = p_id for update;
  if not found then raise exception 'Ficha de custo não encontrada'; end if;
  if c.rascunho then raise exception 'A ficha % é uma cópia/simulação: não vai para Produtos', c.ficha; end if;
  v_prod := coalesce(c.produto_id, (select x.id from public.lin_produtos x
              where upper(btrim(x.referencia)) = upper(coalesce(nullif(btrim(c.referencia), ''), btrim(c.ficha))) limit 1));
  if v_prod is not null then
    perform public.lin_custos_aplicar(array[p_id]);
    return jsonb_build_object('produto_id', v_prod, 'criado', false);
  end if;
  if btrim(c.edicao) <> '' then raise exception 'A ficha % é de peça especial (%), mas a peça % não está cadastrada: cadastre a peça em Produtos primeiro', c.ficha, c.edicao, coalesce(nullif(btrim(c.referencia), ''), c.ficha); end if;
  if coalesce(c.venda, 0) <= 0 then raise exception 'A ficha % está sem valor de venda', c.ficha; end if;
  if coalesce(c.custo, 0) <= 0 then raise exception 'A ficha % está com custo zero', c.ficha; end if;
  v_ref := coalesce(nullif(btrim(c.referencia), ''), public._lin_ref_provisoria());
  perform set_config('lin.preco_origem', 'ficha de custo ' || c.ficha, true);
  insert into public.lin_produtos (referencia, descricao, tecido, preco_custo, preco_venda, consumo_metros, ativo)
  values (v_ref, coalesce(nullif(btrim(c.descricao), ''), c.ficha), nullif(btrim(c.materia), ''), round(c.custo, 2), round(c.venda, 2),
          case when c.gasto > 0 then c.gasto end, true)
  returning id into v_prod;
  update public.lin_custos set produto_id = v_prod, referencia = v_ref where id = p_id;
  perform public._lin_auditar('linum_produto_criado', null, jsonb_build_object('produto_id', v_prod, 'referencia', v_ref,
    'descricao', coalesce(nullif(btrim(c.descricao), ''), c.ficha), 'pela_ficha_custo', c.ficha, 'preco_venda', round(c.venda, 2),
    'preco_custo', round(c.custo, 2)) || case when nullif(btrim(c.referencia), '') is null then jsonb_build_object('referencia_provisoria', true) else '{}'::jsonb end);
  return jsonb_build_object('produto_id', v_prod, 'criado', true, 'referencia', v_ref);
end $$;
