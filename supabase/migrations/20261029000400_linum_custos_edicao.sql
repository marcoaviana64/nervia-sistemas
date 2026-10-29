-- Sistema Linum 2.20: ficha de custo de peça especial (pedido do Marco em 29/10/2026: "na lista, uma peça que é Artesanal
-- tem a mesma referência, mas o valor é diferente; não vi como atualizar ela no cadastro de produtos").
-- No cadastro, a versão artesanal/bordada/pintada de uma peça é uma PEÇA ESPECIAL: variação da mesma referência com
-- edição e preço próprios (ex.: A13 com "Arte Costela de Adão" a R$ 819). A ficha passa a dizer qual edição ela é:
--   * lin_custos.edicao (vazio = a peça normal, como antes); gravada por lin_custo_salvar (chave 'edicao').
--   * lin_custos_aplicar: ficha com edição grava preço de venda e custo em TODAS as variações da peça com essa edição
--     (sem diferença de maiúsculas/espaços); recusa se a peça não tiver essa edição. Duas fichas só conflitam se forem da
--     mesma peça E da mesma edição. Auditoria linum_variante_alterada com edição, nº de variações e pela_ficha_custo.
--   * lin_custo_enviar: ficha com edição de peça que não existe é recusada (cadastre a peça primeiro).

alter table public.lin_custos add column if not exists edicao text not null default '';

create or replace function public.lin_custo_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; c public.lin_custos; v_antes jsonb; v_ficha text := public._lin_txt(p, 'ficha');
        v_prod uuid;
        nums text[] := array['qtd', 'mp_metro', 'gasto', 'qtd_risco', 'risco', 'risco_peca_manual', 'modelagem', 'corte', 'lavanderia',
                             'costura', 'aviamentos', 'passadoria', 'logistica', 'comissao', 'pagamento', 'venda', 'markup_alvo', 'desconto_pct'];
        rot jsonb := '{"qtd":"Quantidade de peças","mp_metro":"Preço do metro","gasto":"Gasto (metros por peça)","qtd_risco":"Peças do risco",
          "risco":"Custo do risco","risco_peca_manual":"Risco por peça","modelagem":"Modelagem e pilotagem","corte":"Corte",
          "lavanderia":"Lavanderia","costura":"Costura","aviamentos":"Aviamentos","passadoria":"Passadoria","logistica":"Logística",
          "comissao":"Comissão","pagamento":"Pagamento / cartão / contador","venda":"Valor de venda","markup_alvo":"Markup alvo","desconto_pct":"Desconto %"}';
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera os custos'; end if;
  if v_id is null then
    if v_ficha is null then raise exception 'Dê um nome à ficha (ex.: a referência da peça)'; end if;
    if exists (select 1 from public.lin_custos where lower(ficha) = lower(v_ficha)) then raise exception 'Já existe uma ficha com o nome %', v_ficha; end if;
    insert into public.lin_custos (ficha, criado_nome, atualizado_nome) values (v_ficha, public._lin_nome(), public._lin_nome())
    returning * into c;
    v_id := c.id;
  else
    select * into c from public.lin_custos where id = v_id for update;
    if not found then raise exception 'Ficha de custo não encontrada'; end if;
    v_antes := public._lin_custo_json(c);
    if p ? 'ficha' then
      if v_ficha is null then raise exception 'Dê um nome à ficha (ex.: a referência da peça)'; end if;
      c.ficha := v_ficha;
    end if;
  end if;
  if exists (select 1 from public.lin_custos where lower(ficha) = lower(c.ficha) and id <> v_id) then
    raise exception 'Já existe uma ficha com o nome %', c.ficha;
  end if;
  if p ? 'produto_id' then
    v_prod := nullif(p ->> 'produto_id', '')::uuid;
    if v_prod is not null and not exists (select 1 from public.lin_produtos where id = v_prod) then raise exception 'Peça não encontrada no cadastro'; end if;
    c.produto_id := v_prod;
  end if;
  if p ? 'referencia' then c.referencia := coalesce(public._lin_txt(p, 'referencia'), ''); end if;
  if p ? 'descricao' then c.descricao := coalesce(public._lin_txt(p, 'descricao'), ''); end if;
  if p ? 'versao' then c.versao := coalesce(public._lin_txt(p, 'versao'), ''); end if;
  if p ? 'materia' then c.materia := coalesce(public._lin_txt(p, 'materia'), ''); end if;
  if p ? 'observacoes' then c.observacoes := coalesce(public._lin_txt(p, 'observacoes'), ''); end if;
  if p ? 'edicao' then c.edicao := coalesce(public._lin_txt(p, 'edicao'), ''); end if;
  if p ? 'rascunho' then c.rascunho := coalesce((p ->> 'rascunho')::boolean, false); end if;
  c := jsonb_populate_record(c, (select coalesce(jsonb_object_agg(k2, public._lin_num(p, k2, rot ->> k2)), '{}'::jsonb)
                                   from unnest(nums) k2 where p ? k2));
  if c.desconto_pct >= 100 then raise exception 'O desconto tem de ser menor que 100%%'; end if;
  update public.lin_custos set ficha = c.ficha, produto_id = c.produto_id, referencia = c.referencia, descricao = c.descricao,
         versao = c.versao, edicao = c.edicao, materia = c.materia, rascunho = c.rascunho, observacoes = c.observacoes,
         qtd = c.qtd, mp_metro = c.mp_metro, gasto = c.gasto, qtd_risco = c.qtd_risco, risco = c.risco, risco_peca_manual = c.risco_peca_manual,
         modelagem = c.modelagem, corte = c.corte, lavanderia = c.lavanderia, costura = c.costura, aviamentos = c.aviamentos,
         passadoria = c.passadoria, logistica = c.logistica, comissao = c.comissao, pagamento = c.pagamento, venda = c.venda,
         markup_alvo = c.markup_alvo, desconto_pct = c.desconto_pct,
         atualizado_em = now(), atualizado_nome = public._lin_nome()
   where id = v_id returning * into c;
  if v_antes is null then
    perform public._lin_auditar('linum_custo_criado', null, jsonb_build_object('custo_id', v_id, 'ficha', c.ficha, 'custo', round(c.custo, 2))
      || jsonb_build_object('depois', public._lin_custo_json(c)));
  else
    perform public._lin_auditar('linum_custo_alterado', null, jsonb_build_object('custo_id', v_id, 'ficha', c.ficha, 'custo', round(c.custo, 2),
      'antes', v_antes, 'depois', public._lin_custo_json(c)));
  end if;
  return v_id;
end $$;


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
    v_chave := v_prod::text || '|' || v_ed;
    if v_chave = any(v_usados) then
      raise exception 'Duas fichas marcadas são da mesma peça (%): marque só uma', (select referencia from public.lin_produtos where id = v_prod)
        || case when v_ed <> '' then ' — ' || c.edicao else '' end;
    end if;
    v_usados := v_usados || v_chave;
    if coalesce(c.venda, 0) <= 0 then raise exception 'A ficha % está sem valor de venda', c.ficha; end if;
    if coalesce(c.custo, 0) <= 0 then raise exception 'A ficha % está com custo zero', c.ficha; end if;
    select * into p from public.lin_produtos where id = v_prod for update;
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
