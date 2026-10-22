-- Sistema Linum: todos vendem, em qualquer loja, e comissão em % por pessoa (pedido do Marco em 22/10/2026):
--   "uma vendedora pode ser deslocada para qualquer loja"; "qualquer pessoa cadastrada no sistema da Linum pode vender";
--   "uma opção no cadastro da vendedora informando o valor da comissão dela; se tiver zerado ela não tem comissão";
--   "uma vendedora só vê as vendas dela, em qualquer loja; administradores veem todas as vendas de qualquer um".
--   * lin_vende() = qualquer papel da Linum (Dono, Estoque, Vendedora); a loja do membro vira só a LOJA PRINCIPAL;
--   * lin_membros.comissao_pct (0 a 100; 0 = sem comissão), definida pela equipe Nervia na aba Equipe;
--   * lin_vendas.comissao_pct / comissao_valor: cópia no momento da venda (sobre o valor pago), para o cálculo não mudar
--     se o % mudar depois;
--   * cada um vê só as próprias vendas (de qualquer loja); o Dono (e a equipe Nervia) vê todas. Clientes: todos veem.
--   * o Estoque continua sem ver custo.

alter table public.lin_membros add column if not exists comissao_pct numeric(5,2) not null default 0
  check (comissao_pct >= 0 and comissao_pct <= 100);
alter table public.lin_vendas add column if not exists comissao_pct numeric(5,2) not null default 0;
alter table public.lin_vendas add column if not exists comissao_valor numeric(12,2) not null default 0;

create or replace function public.lin_vende() returns boolean
language sql stable security definer set search_path = public as $$ select public.lin_papel() is not null $$;

drop policy if exists lin_vendas_ler on public.lin_vendas;
create policy lin_vendas_ler on public.lin_vendas for select
  using (public.lin_eh_dono() or (public.lin_vende() and vendedora_id = auth.uid()));

drop function if exists public.lin_membro_salvar(uuid, text, uuid);
create or replace function public.lin_membro_salvar(p_user uuid, p_papel text, p_loja uuid default null, p_comissao numeric default null)
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
  if p_comissao is not null and (p_comissao < 0 or p_comissao > 100) then raise exception 'Comissão: de 0 a 100%%'; end if;
  -- comissão vazia = mantém a que já estava (login novo: 0%, sem comissão)
  insert into public.lin_membros (user_id, papel, loja_id, comissao_pct) values (p_user, p_papel, p_loja, coalesce(p_comissao, 0))
  on conflict (user_id) do update set papel = excluded.papel, loja_id = excluded.loja_id,
    comissao_pct = coalesce(p_comissao, lin_membros.comissao_pct), atualizado_em = now();
end $$;

create or replace function public.lin_equipe() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia define a equipe da Linum'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'email', p.email, 'nome', p.nome,
             'papel', m.papel, 'loja_id', m.loja_id, 'comissao_pct', m.comissao_pct) order by coalesce(nullif(p.nome, ''), p.email))
    from public.perfis p join public.app_acessos a on a.user_id = p.user_id and a.app_id = 'linum'
    left join public.lin_membros m on m.user_id = p.user_id), '[]');
end $$;

create or replace function public.lin_vendedoras() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.lin_vende() then raise exception 'Sem acesso às vendas'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nome', coalesce(nullif(trim(p.nome), ''), p.email),
                     'papel', m.papel, 'loja_id', m.loja_id, 'comissao_pct', m.comissao_pct) order by coalesce(nullif(trim(p.nome), ''), p.email))
                   from public.lin_membros m join public.perfis p on p.user_id = m.user_id
                   where exists (select 1 from public.app_acessos a where a.user_id = m.user_id and a.app_id = 'linum')), '[]');
end $$;

create or replace function public.lin_estoque_ler() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_papel text := public.lin_papel();
begin
  if v_papel is null then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  return jsonb_build_object(
    'papel', v_papel,
    'minha_loja', public.lin_minha_loja(),
    'comissao_pct', (select comissao_pct from public.lin_membros where user_id = auth.uid()),
    'lojas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome) order by ordem, nome) from public.lin_lojas), '[]'),
    'produtos', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'referencia', p.referencia, 'descricao', p.descricao,
               'categoria', p.categoria, 'preco_venda', p.preco_venda, 'codigo_barras', p.codigo_barras,
               'variantes', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'cor', v.cor, 'tamanho', v.tamanho,
                                        'edicao', v.edicao, 'preco_venda', v.preco_venda, 'codigo_barras', v.codigo_barras))
                                      from public.lin_variantes v where v.produto_id = p.id and v.ativo), '[]'))
             order by p.descricao, p.referencia)
      from public.lin_produtos p where p.ativo), '[]'),
    'estoque', coalesce((select jsonb_agg(jsonb_build_array(e.variante_id, e.loja_id, e.quantidade))
                         from public.lin_estoque e join public.lin_variantes v on v.id = e.variante_id
                         where e.quantidade <> 0 and v.ativo), '[]'));
end $$;

create or replace function public.lin_membros_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  perform public.auditar(case when tg_op = 'DELETE' then 'linum_papel_retirado' else 'linum_papel_definido' end, null,
    jsonb_build_object('login', (select email from public.perfis where user_id = r.user_id), 'login_id', r.user_id,
      'papel', case when tg_op = 'DELETE' then null else new.papel end,
      'papel_antes', case when tg_op = 'INSERT' then null else old.papel end,
      'loja', (select nome from public.lin_lojas where id = case when tg_op = 'DELETE' then null else new.loja_id end),
      'comissao_pct', case when tg_op = 'DELETE' then null else new.comissao_pct end,
      'comissao_pct_antes', case when tg_op = 'INSERT' then null else old.comissao_pct end));
  return r;
end $$;

create or replace function public.lin_cliente_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_nome text := public._lin_txt(p, 'nome');
        v_tel text := regexp_replace(coalesce(p ->> 'telefone', ''), '\D', '', 'g');
        v_cpf text := nullif(regexp_replace(coalesce(p ->> 'cpf', ''), '\D', '', 'g'), '');
        v_dia int := nullif(p ->> 'aniversario_dia', '')::int; v_mes int := nullif(p ->> 'aniversario_mes', '')::int;
        v_antes jsonb; v_outro text;
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  if v_nome is null or length(v_nome) < 2 then raise exception 'Informe o nome do cliente'; end if;
  if v_tel <> '' and length(v_tel) not between 10 and 13 then raise exception 'Telefone com DDD: 10 ou 11 dígitos'; end if;
  if v_cpf is not null and length(v_cpf) <> 11 then raise exception 'CPF deve ter 11 dígitos'; end if;
  if (v_dia is null) <> (v_mes is null) then raise exception 'Aniversário: informe dia e mês'; end if;
  if v_dia is not null and (v_mes not between 1 and 12 or v_dia < 1 or v_dia > extract(day from (make_date(2024, v_mes, 1) + interval '1 month - 1 day'))) then
    raise exception 'Data de aniversário inválida';
  end if;
  select nome into v_outro from public.lin_clientes where cpf = v_cpf and id is distinct from v_id;
  if v_outro is not null then raise exception 'Este CPF já é do cliente %', v_outro; end if;
  if v_id is null then
    insert into public.lin_clientes (nome, telefone, cpf, email, endereco, aniversario_dia, aniversario_mes, observacoes, loja_id, criado_por, criado_nome)
    values (v_nome, v_tel, v_cpf, coalesce(public._lin_txt(p, 'email'), ''), coalesce(public._lin_txt(p, 'endereco'), ''), v_dia, v_mes,
            coalesce(public._lin_txt(p, 'observacoes'), ''), coalesce(nullif(p ->> 'loja_id', '')::uuid, public.lin_minha_loja()), auth.uid(), public._lin_nome())
    returning id into v_id;
    perform public._lin_auditar('linum_cliente_criado', null, jsonb_build_object('cliente_id', v_id, 'cliente', v_nome));
  else
    select to_jsonb(c) - 'atualizado_em' into v_antes from public.lin_clientes c where id = v_id for update;
    if v_antes is null then raise exception 'Cliente não encontrado'; end if;
    update public.lin_clientes set nome = v_nome, telefone = v_tel, cpf = v_cpf, email = coalesce(public._lin_txt(p, 'email'), ''),
      endereco = coalesce(public._lin_txt(p, 'endereco'), ''), aniversario_dia = v_dia, aniversario_mes = v_mes,
      observacoes = coalesce(public._lin_txt(p, 'observacoes'), ''), atualizado_em = now()
    where id = v_id;
    perform public._lin_auditar('linum_cliente_alterado', null, jsonb_build_object('cliente_id', v_id, 'cliente', v_nome, 'antes', v_antes,
      'depois', (select to_jsonb(c) - 'atualizado_em' from public.lin_clientes c where id = v_id)));
  end if;
  return v_id;
end $$;

create or replace function public.lin_venda_registrar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_dono boolean := public.lin_eh_dono(); v_loja uuid := nullif(p ->> 'loja_id', '')::uuid;
        v_vend uuid := coalesce(nullif(p ->> 'vendedora_id', '')::uuid, auth.uid()); v_vend_nome text; v_com numeric := 0;
        v_cli uuid := nullif(p ->> 'cliente_id', '')::uuid; v_data date := coalesce(nullif(p ->> 'data', '')::date, current_date);
        v_desc numeric := coalesce(nullif(p ->> 'desconto', '')::numeric, 0); v_venda bigint; v_it jsonb; v_pg jsonb;
        v_var record; v_q int; v_vu numeric; v_pct numeric; v_disp int; v_bruto numeric := 0; v_itens numeric := 0; v_total numeric;
        v_pagos numeric := 0; v_pags jsonb := '[]'; v_parc int; v_resumo jsonb := '[]';
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
    if (v_pg ->> 'forma') not in ('dinheiro', 'pix', 'debito', 'credito', 'cheque', 'outro') then raise exception 'Forma de pagamento inválida'; end if;
    if coalesce(nullif(v_pg ->> 'valor', '')::numeric, 0) <= 0 then raise exception 'Informe o valor de cada forma de pagamento'; end if;
    v_parc := case when v_pg ->> 'forma' = 'credito' then coalesce(nullif(v_pg ->> 'parcelas', '')::int, 1) else 1 end;
    if v_parc not between 1 and 24 then raise exception 'Parcelas: de 1 a 24'; end if;
    v_pagos := v_pagos + round((v_pg ->> 'valor')::numeric, 2);
    v_pags := v_pags || jsonb_build_object('forma', v_pg ->> 'forma', 'valor', round((v_pg ->> 'valor')::numeric, 2), 'parcelas', v_parc);
  end loop;
  if abs(v_pagos - v_total) > 0.009 then
    raise exception 'A soma dos pagamentos (R$ %) é diferente do total da venda (R$ %)', replace(to_char(v_pagos, 'FM9999990.00'), '.', ','), replace(to_char(v_total, 'FM9999990.00'), '.', ',');
  end if;

  update public.lin_vendas set valor_bruto = v_bruto, valor_itens = v_itens, desconto = v_desc, valor_total = v_total, pagamentos = v_pags,
         comissao_pct = v_com, comissao_valor = round(v_total * v_com / 100, 2)
   where id = v_venda;
  perform public._lin_auditar('linum_venda_registrada', null, jsonb_build_object('venda', v_venda, 'loja', public._lin_loja(v_loja),
    'vendedora', v_vend_nome, 'comissao_pct', v_com, 'comissao_valor', round(v_total * v_com / 100, 2), 'data', v_data, 'cliente', (select nome from public.lin_clientes where id = v_cli), 'itens', v_resumo,
    'valor_bruto', v_bruto, 'desconto', v_desc, 'valor_total', v_total, 'pagamentos', v_pags));
  return v_venda;
end $$;

revoke execute on function public.lin_membro_salvar(uuid, text, uuid, numeric) from public, anon;
grant execute on function public.lin_membro_salvar(uuid, text, uuid, numeric) to authenticated;
