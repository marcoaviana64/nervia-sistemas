-- Sistema Linum: Vendas e Clientes (pedido do Marco em 22/10/2026, a partir da "Boleta de Venda" de papel da loja:
-- data, vendedora, itens com referência/cor/tamanho/preço, cliente com telefone/CPF/endereço, valor total, valor pago,
-- desconto, observações (ex.: "Niver 21/07") e forma de pagamento com parcelas no cartão de crédito).
-- Regras do sistema antigo (register_sale_order / cancel_sale_order do banco linum-produtos):
--   * a venda baixa o estoque da loja na hora (movimentação "venda"); estoque insuficiente recusa a venda inteira;
--   * Vendedora vende só na loja dela e vê só as vendas dela; Dono vê e lança todas (inclusive boleta antiga, com
--     data passada e escolhendo a vendedora); o papel Estoque não vende nem vê vendas;
--   * só o Dono cancela, com motivo: a venda fica no histórico marcada como cancelada e as peças voltam (movimentação
--     "devolucao");
--   * clientes (lin_clientes) ficam guardados para o CRM futuro: nome, telefone, CPF, e-mail, endereço, aniversário.
-- Tudo com auditoria (venda registrada/cancelada, cliente criado/alterado).

alter table public.lin_movimentos drop constraint if exists lin_movimentos_tipo_check;
alter table public.lin_movimentos add constraint lin_movimentos_tipo_check
  check (tipo in ('entrada', 'saida', 'transferencia', 'ajuste', 'venda', 'devolucao'));

create table if not exists public.lin_clientes (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (length(trim(nome)) > 1),
  telefone       text not null default '' check (telefone ~ '^[0-9]*$'),   -- só dígitos, com DDD
  cpf            text check (cpf is null or cpf ~ '^[0-9]{11}$'),
  email          text not null default '',
  endereco       text not null default '',
  aniversario_dia int check (aniversario_dia between 1 and 31),
  aniversario_mes int check (aniversario_mes between 1 and 12),
  observacoes    text not null default '',
  loja_id        uuid references public.lin_lojas on delete set null,       -- loja onde foi cadastrado
  criado_por     uuid references auth.users on delete set null,
  criado_nome    text not null default '',
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create unique index if not exists lin_clientes_cpf on public.lin_clientes (cpf) where cpf is not null;
create index if not exists lin_clientes_telefone on public.lin_clientes (telefone);

create table if not exists public.lin_vendas (
  id                  bigint generated always as identity primary key,     -- número da venda
  loja_id             uuid not null references public.lin_lojas,
  vendedora_id        uuid references auth.users on delete set null,
  vendedora_nome      text not null default '',
  cliente_id          uuid references public.lin_clientes on delete set null,
  data                date not null default current_date,
  valor_bruto         numeric(12,2) not null default 0,   -- soma do preço de tabela × quantidade
  valor_itens         numeric(12,2) not null default 0,   -- soma do valor cobrado por peça (já com o desconto por peça)
  desconto            numeric(12,2) not null default 0,   -- desconto geral em R$, além do desconto por peça
  valor_total         numeric(12,2) not null default 0,   -- valor pago
  pagamentos          jsonb not null default '[]',        -- [{forma, valor, parcelas}]
  observacao          text not null default '',
  criado_por          uuid references auth.users on delete set null,
  criado_nome         text not null default '',
  criado_em           timestamptz not null default now(),
  cancelada_em        timestamptz,
  cancelada_por       uuid references auth.users on delete set null,
  cancelada_nome      text,
  motivo_cancelamento text
);
create index if not exists lin_vendas_data on public.lin_vendas (data desc);
create index if not exists lin_vendas_cliente on public.lin_vendas (cliente_id);

create table if not exists public.lin_venda_itens (
  id             bigint generated always as identity primary key,
  venda_id       bigint not null references public.lin_vendas on delete cascade,
  variante_id    uuid references public.lin_variantes on delete set null,
  referencia     text not null default '',   -- cópia do que estava na etiqueta (fica igual se o cadastro mudar)
  descricao      text not null default '',
  cor            text not null default '',
  tamanho        text not null default '',
  edicao         text not null default '',
  quantidade     int not null check (quantidade > 0),
  preco_tabela   numeric(12,2) not null default 0,
  desconto_pct   numeric(5,2) not null default 0 check (desconto_pct between 0 and 100),
  valor_unitario numeric(12,2) not null check (valor_unitario >= 0),
  valor_total    numeric(12,2) not null
);
create index if not exists lin_venda_itens_venda on public.lin_venda_itens (venda_id);

-- vendas e itens não se alteram (só o cancelamento, pela função); nada se apaga
create or replace function public.lin_vendas_imutavel() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Venda não se apaga: cancele com motivo'; end if;
  if tg_table_name = 'lin_venda_itens' then raise exception 'Os itens da venda não podem ser alterados'; end if;
  if old.criado_em = now() then return new; end if;   -- a própria lin_venda_registrar fecha os totais na mesma transação
  if (to_jsonb(new) - array['cancelada_em', 'cancelada_por', 'cancelada_nome', 'motivo_cancelamento'])
     is distinct from (to_jsonb(old) - array['cancelada_em', 'cancelada_por', 'cancelada_nome', 'motivo_cancelamento']) then
    raise exception 'A venda não pode ser alterada: cancele com motivo e registre de novo';
  end if;
  return new;
end $$;
drop trigger if exists lin_vendas_imutavel on public.lin_vendas;
create trigger lin_vendas_imutavel before update or delete on public.lin_vendas for each row execute function public.lin_vendas_imutavel();
drop trigger if exists lin_venda_itens_imutavel on public.lin_venda_itens;
create trigger lin_venda_itens_imutavel before update or delete on public.lin_venda_itens for each row execute function public.lin_vendas_imutavel();

-- ---------------------------------------------------------------- permissões
create or replace function public.lin_vende() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.lin_papel() in ('dono', 'vendedora'), false) $$;
create or replace function public.lin_minha_loja() returns uuid
language sql stable security definer set search_path = public as $$ select loja_id from public.lin_membros where user_id = auth.uid() $$;

alter table public.lin_clientes    enable row level security;
alter table public.lin_vendas      enable row level security;
alter table public.lin_venda_itens enable row level security;
create policy lin_clientes_ler on public.lin_clientes for select using (public.lin_vende());
create policy lin_vendas_ler on public.lin_vendas for select
  using (public.lin_eh_dono() or (public.lin_papel() = 'vendedora' and vendedora_id = auth.uid()));
create policy lin_venda_itens_ler on public.lin_venda_itens for select
  using (exists (select 1 from public.lin_vendas v where v.id = venda_id));   -- a policy de lin_vendas já filtra

-- ---------------------------------------------------------------- clientes
create or replace function public.lin_cliente_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_nome text := public._lin_txt(p, 'nome');
        v_tel text := regexp_replace(coalesce(p ->> 'telefone', ''), '\D', '', 'g');
        v_cpf text := nullif(regexp_replace(coalesce(p ->> 'cpf', ''), '\D', '', 'g'), '');
        v_dia int := nullif(p ->> 'aniversario_dia', '')::int; v_mes int := nullif(p ->> 'aniversario_mes', '')::int;
        v_antes jsonb; v_outro text;
begin
  if not public.lin_vende() then raise exception 'Somente o Dono ou a Vendedora cadastra clientes'; end if;
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

-- quem pode aparecer como vendedora numa venda (para o Dono lançar boleta de outra pessoa)
create or replace function public.lin_vendedoras() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.lin_vende() then raise exception 'Sem acesso às vendas'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nome', coalesce(nullif(trim(p.nome), ''), p.email),
                     'papel', m.papel, 'loja_id', m.loja_id) order by coalesce(nullif(trim(p.nome), ''), p.email))
                   from public.lin_membros m join public.perfis p on p.user_id = m.user_id
                   where m.papel in ('dono', 'vendedora')
                     and exists (select 1 from public.app_acessos a where a.user_id = m.user_id and a.app_id = 'linum')), '[]');
end $$;

-- ---------------------------------------------------------------- registrar venda
-- p: {loja_id, vendedora_id?, cliente_id?, data?, desconto?, observacao?, itens:[{variante_id, quantidade, valor_unitario, desconto_pct?}],
--     pagamentos:[{forma: dinheiro|pix|debito|credito|cheque|outro, valor, parcelas?}]}
create or replace function public.lin_venda_registrar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_dono boolean := public.lin_eh_dono(); v_loja uuid := nullif(p ->> 'loja_id', '')::uuid;
        v_vend uuid := coalesce(nullif(p ->> 'vendedora_id', '')::uuid, auth.uid()); v_vend_nome text;
        v_cli uuid := nullif(p ->> 'cliente_id', '')::uuid; v_data date := coalesce(nullif(p ->> 'data', '')::date, current_date);
        v_desc numeric := coalesce(nullif(p ->> 'desconto', '')::numeric, 0); v_venda bigint; v_it jsonb; v_pg jsonb;
        v_var record; v_q int; v_vu numeric; v_pct numeric; v_disp int; v_bruto numeric := 0; v_itens numeric := 0; v_total numeric;
        v_pagos numeric := 0; v_pags jsonb := '[]'; v_parc int; v_resumo jsonb := '[]';
begin
  if not public.lin_vende() then raise exception 'Somente o Dono ou a Vendedora registra vendas'; end if;
  if not exists (select 1 from public.lin_lojas where id = v_loja) then raise exception 'Escolha a loja'; end if;
  if not v_dono then
    if v_loja is distinct from public.lin_minha_loja() then raise exception 'Você só registra vendas da sua loja'; end if;
    if v_vend <> auth.uid() then raise exception 'A vendedora só registra as próprias vendas'; end if;
    if v_data < current_date - 7 then raise exception 'Venda com mais de 7 dias: peça ao Dono para lançar'; end if;
  end if;
  if v_data > current_date then raise exception 'A data da venda não pode ser futura'; end if;
  select coalesce(nullif(trim(pe.nome), ''), pe.email) into v_vend_nome from public.lin_membros m join public.perfis pe on pe.user_id = m.user_id
   where m.user_id = v_vend and m.papel in ('dono', 'vendedora');
  if v_vend_nome is null and not (v_dono and v_vend = auth.uid()) then raise exception 'Vendedora não encontrada na equipe da Linum'; end if;
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

  update public.lin_vendas set valor_bruto = v_bruto, valor_itens = v_itens, desconto = v_desc, valor_total = v_total, pagamentos = v_pags
   where id = v_venda;
  perform public._lin_auditar('linum_venda_registrada', null, jsonb_build_object('venda', v_venda, 'loja', public._lin_loja(v_loja),
    'vendedora', v_vend_nome, 'data', v_data, 'cliente', (select nome from public.lin_clientes where id = v_cli), 'itens', v_resumo,
    'valor_bruto', v_bruto, 'desconto', v_desc, 'valor_total', v_total, 'pagamentos', v_pags));
  return v_venda;
end $$;

-- ---------------------------------------------------------------- cancelar (só Dono, com motivo; devolve as peças)
create or replace function public.lin_venda_cancelar(p_venda bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.lin_vendas; i record;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono cancela vendas'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo do cancelamento'; end if;
  select * into v from public.lin_vendas where id = p_venda for update;
  if v.id is null then raise exception 'Venda não encontrada'; end if;
  if v.cancelada_em is not null then raise exception 'Esta venda já foi cancelada'; end if;
  for i in select variante_id, sum(quantidade)::int q from public.lin_venda_itens where venda_id = p_venda and variante_id is not null group by variante_id loop
    insert into public.lin_estoque (variante_id, loja_id, quantidade) values (i.variante_id, v.loja_id, i.q)
    on conflict (variante_id, loja_id) do update set quantidade = lin_estoque.quantidade + excluded.quantidade, atualizado_em = now();
    insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, observacao, criado_por, criado_nome)
    values (i.variante_id, v.loja_id, 'devolucao', i.q, 'Cancelamento da venda nº ' || p_venda || ': ' || trim(p_motivo), auth.uid(), public._lin_nome());
  end loop;
  update public.lin_vendas set cancelada_em = now(), cancelada_por = auth.uid(), cancelada_nome = public._lin_nome(), motivo_cancelamento = trim(p_motivo)
   where id = p_venda;
  perform public._lin_auditar('linum_venda_cancelada', null, jsonb_build_object('venda', p_venda, 'loja', public._lin_loja(v.loja_id),
    'vendedora', v.vendedora_nome, 'valor_total', v.valor_total, 'motivo', trim(p_motivo)));
end $$;

do $$ declare f text; begin
  foreach f in array array['lin_cliente_salvar(jsonb)', 'lin_vendedoras()', 'lin_venda_registrar(jsonb)', 'lin_venda_cancelar(bigint, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- a leitura do estoque passa a trazer o código de barras (para achar a peça pela etiqueta na venda)
create or replace function public.lin_estoque_ler() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_papel text := public.lin_papel();
begin
  if v_papel is null then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  return jsonb_build_object(
    'papel', v_papel,
    'minha_loja', public.lin_minha_loja(),
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

update public.apps set descricao = 'Produtos, estoque, vendas e clientes das lojas Gávea e Ipanema.' where id = 'linum';
