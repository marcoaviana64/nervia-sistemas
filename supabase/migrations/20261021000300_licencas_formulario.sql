-- Contas e Licenças Microsoft 365 — formulário da fatura pelo link (pedido do Marco em 21/10/2026).
-- A Nervia gera um link por mês da fatura (lic_pedidos) e manda por WhatsApp/e-mail a quem cuida da fatura no cliente.
-- A pessoa abre /licencas/fatura/#<código> sem login, informa as licenças pagas (unidade, licença, quantidade, valor
-- unitário), o próprio nome e envia. A resposta (lic_respostas) fica PENDENTE: só vira fatura do mês (lic_faturas) quando
-- a Nervia confere e aprova. Pode reenviar até o prazo (a anterior pendente fica "substituída").
-- O código (64 hex) vai depois do "#": não chega ao servidor do site nem ao Referer. O link mostra só os nomes das
-- unidades do pedido e a fatura anterior delas (para conferir), nada das contas.

create table if not exists public.lic_pedidos (
  id            bigint generated always as identity primary key,
  mes           date not null check (extract(day from mes) = 1),
  codigo        text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  prazo         date not null,                     -- recebe respostas até o fim deste dia (Brasília)
  unidades      uuid[] not null,                   -- unidades que o formulário cobre
  contato_nome  text not null default '',
  telefone      text not null default '',
  email         text not null default '',
  criado_por    uuid references auth.users on delete set null,
  criado_nome   text not null default '',
  criado_em     timestamptz not null default now(),
  aberto_em     timestamptz,
  respondido_em timestamptz,
  revogado_em   timestamptz,
  check (cardinality(unidades) >= 1)
);

create table if not exists public.lic_respostas (
  id           bigint generated always as identity primary key,
  pedido_id    bigint not null references public.lic_pedidos on delete cascade,
  itens        jsonb not null,                     -- [{unidade_id, produto, quantidade, valor_unitario}]
  declarante   text not null,
  obs          text not null default '',
  enviada_em   timestamptz not null default now(),
  ip           text,
  navegador    text,
  status       text not null default 'pendente' check (status in ('pendente', 'aprovada', 'descartada', 'substituida')),
  decidido_por uuid references auth.users on delete set null,
  decidido_nome text,
  decidido_em  timestamptz,
  motivo       text
);
create index if not exists lic_respostas_pedido on public.lic_respostas (pedido_id, enviada_em desc);

alter table public.lic_pedidos enable row level security;
alter table public.lic_respostas enable row level security;
revoke all on public.lic_pedidos, public.lic_respostas from anon;
revoke insert, update, delete on public.lic_pedidos, public.lic_respostas from authenticated;
drop policy if exists lic_pedidos_ler on public.lic_pedidos;
create policy lic_pedidos_ler on public.lic_pedidos for select using (public.eh_admin());
drop policy if exists lic_respostas_ler on public.lic_respostas;
create policy lic_respostas_ler on public.lic_respostas for select using (public.eh_admin());

-- licenças oferecidas na lista do formulário (mesmos nomes da exportação do Microsoft 365)
create or replace function public.lic_produtos() returns text[]
language sql immutable as $$
  select array['Microsoft 365 Business Basic', 'Microsoft 365 Business Basic (no Teams)', 'Microsoft 365 Business Standard',
    'Microsoft 365 Business Premium', 'Microsoft 365 Apps for business', 'Exchange Online (Plan 1)', 'Exchange Online (Plan 2)', 'Power BI Pro']
$$;

create or replace function public.lic_pedido_situacao(p public.lic_pedidos) returns text
language sql stable as $$
  select case when p.revogado_em is not null then 'cancelado'
              when (now() at time zone 'America/Sao_Paulo')::date > p.prazo then 'encerrado'
              else 'aberto' end
$$;
revoke execute on function public.lic_pedido_situacao(public.lic_pedidos) from public, anon, authenticated;

-- registro de ação feita pelo link (sem login): quem = nome informado, com IP e navegador
create or replace function public.lic_registrar_link(p_acao text, p_quem text, p_det jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_orig jsonb := public.cmp_origem_requisicao();
begin
  insert into public.auditoria (user_id, email, nome, papel, acao, cnpj, detalhes, ip, navegador)
  values (null, null, p_quem, 'sistema', p_acao, null, coalesce(p_det, '{}') || jsonb_build_object('origem', 'link da fatura de licenças'),
    v_orig ->> 'ip', v_orig ->> 'navegador');
end $$;
revoke execute on function public.lic_registrar_link(text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- equipe Nervia: gerar, prorrogar, cancelar
create or replace function public.lic_pedido_criar(p_mes date, p_prazo date, p_unidades uuid[], p_contato text, p_telefone text, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_cod text; v_mes date := date_trunc('month', p_mes)::date;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia gera o link da fatura.'; end if;
  if p_mes is null then raise exception 'Informe o mês da fatura.'; end if;
  if p_prazo is null or p_prazo < (now() at time zone 'America/Sao_Paulo')::date then raise exception 'O prazo precisa ser hoje ou depois.'; end if;
  if coalesce(cardinality(p_unidades), 0) = 0 then raise exception 'Escolha pelo menos uma unidade.'; end if;
  if exists (select 1 from unnest(p_unidades) u where not exists (select 1 from public.lic_unidades x where x.id = u)) then raise exception 'Unidade desconhecida.'; end if;
  insert into public.lic_pedidos (mes, prazo, unidades, contato_nome, telefone, email, criado_por, criado_nome)
  values (v_mes, p_prazo, p_unidades, left(trim(coalesce(p_contato, '')), 120), left(trim(coalesce(p_telefone, '')), 40), left(trim(coalesce(p_email, '')), 160),
    auth.uid(), coalesce((select coalesce(nullif(nome, ''), email) from public.perfis where user_id = auth.uid()), ''))
  returning id, codigo into v_id, v_cod;
  perform public.auditar('licencas_link_criado', null, jsonb_build_object('pedido', v_id, 'mes', v_mes, 'prazo', p_prazo, 'contato', p_contato,
    'unidades', (select jsonb_agg(nome) from public.lic_unidades where id = any (p_unidades))));
  return jsonb_build_object('id', v_id, 'codigo', v_cod);
end $$;

create or replace function public.lic_pedido_prazo(p_id bigint, p_prazo date)
returns void language plpgsql security definer set search_path = public as $$
declare p public.lic_pedidos;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia muda o prazo.'; end if;
  select * into p from public.lic_pedidos where id = p_id;
  if not found then raise exception 'Link não encontrado.'; end if;
  if p.revogado_em is not null then raise exception 'Link cancelado: gere outro.'; end if;
  if p_prazo is null or p_prazo < (now() at time zone 'America/Sao_Paulo')::date then raise exception 'O prazo precisa ser hoje ou depois.'; end if;
  update public.lic_pedidos set prazo = p_prazo where id = p_id;
  perform public.auditar('licencas_link_prazo', null, jsonb_build_object('pedido', p_id, 'prazo', p_prazo, 'prazo_anterior', p.prazo));
end $$;

create or replace function public.lic_pedido_cancelar(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia cancela o link.'; end if;
  update public.lic_pedidos set revogado_em = now() where id = p_id and revogado_em is null;
  if found then perform public.auditar('licencas_link_cancelado', null, jsonb_build_object('pedido', p_id)); end if;
end $$;

-- aprovar: a resposta vira a fatura do mês (substitui a fatura do mês, se marcado); descartar: com motivo
create or replace function public.lic_resposta_aprovar(p_id bigint, p_substituir boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare r public.lic_respostas; p public.lic_pedidos; v_n int;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia aprova.'; end if;
  select * into r from public.lic_respostas where id = p_id for update;
  if not found then raise exception 'Resposta não encontrada.'; end if;
  if r.status <> 'pendente' then raise exception 'Esta resposta já foi %.', r.status; end if;
  select * into p from public.lic_pedidos where id = r.pedido_id;
  v_n := public.lic_salvar_fatura(p.mes, r.itens, p_substituir);
  update public.lic_respostas set status = 'aprovada', decidido_por = auth.uid(), decidido_em = now(),
    decidido_nome = coalesce((select coalesce(nullif(nome, ''), email) from public.perfis where user_id = auth.uid()), '') where id = p_id;
  perform public.auditar('licencas_resposta_aprovada', null, jsonb_build_object('pedido', p.id, 'resposta', p_id, 'mes', p.mes, 'itens', v_n, 'declarante', r.declarante));
  return v_n;
end $$;

create or replace function public.lic_resposta_descartar(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.lic_respostas;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia descarta.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escreva o motivo.'; end if;
  update public.lic_respostas set status = 'descartada', motivo = trim(p_motivo), decidido_por = auth.uid(), decidido_em = now(),
    decidido_nome = coalesce((select coalesce(nullif(nome, ''), email) from public.perfis where user_id = auth.uid()), '')
   where id = p_id and status = 'pendente' returning * into r;
  if not found then raise exception 'Resposta não encontrada ou já decidida.'; end if;
  perform public.auditar('licencas_resposta_descartada', null, jsonb_build_object('pedido', r.pedido_id, 'resposta', p_id, 'motivo', trim(p_motivo)));
end $$;

-- ---------------------------------------------------------------- quem preenche (sem login, só com o código do link)
create or replace function public.lic_pedido_do_codigo(p_codigo text) returns public.lic_pedidos
language plpgsql security definer set search_path = public as $$
declare p public.lic_pedidos;
begin
  if coalesce(p_codigo, '') !~ '^[0-9a-f]{64}$' then raise exception 'Link incompleto. Abra de novo pelo link que a Nervia enviou (copie o endereço inteiro).'; end if;
  select * into p from public.lic_pedidos where codigo = p_codigo for update;
  if not found then raise exception 'Link inválido. Confira se copiou o endereço inteiro.'; end if;
  return p;
end $$;
revoke execute on function public.lic_pedido_do_codigo(text) from public, anon, authenticated;

-- o que o link mostra: mês, prazo, unidades do pedido, lista de licenças, fatura anterior dessas unidades e a última resposta
create or replace function public.lic_formulario_ler(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.lic_pedidos; v_ult public.lic_respostas;
begin
  p := public.lic_pedido_do_codigo(p_codigo);
  if p.aberto_em is null then
    update public.lic_pedidos set aberto_em = now() where id = p.id;
    perform public.lic_registrar_link('licencas_link_aberto', coalesce(nullif(p.contato_nome, ''), 'Cliente') || ' (pelo link)', jsonb_build_object('pedido', p.id, 'mes', p.mes));
  end if;
  select * into v_ult from public.lic_respostas where pedido_id = p.id and status in ('pendente', 'aprovada') order by enviada_em desc limit 1;
  return jsonb_build_object(
    'situacao', public.lic_pedido_situacao(p), 'mes', p.mes, 'prazo', p.prazo, 'contato_nome', p.contato_nome,
    'unidades', (select jsonb_agg(jsonb_build_object('id', u.id, 'nome', u.nome) order by u.ordem, u.nome) from public.lic_unidades u where u.id = any (p.unidades)),
    'produtos', to_jsonb(public.lic_produtos()),
    -- fatura anterior (mês mais recente antes deste, por unidade), para a pessoa só conferir e ajustar
    'anterior', (select coalesce(jsonb_agg(jsonb_build_object('unidade_id', f.unidade_id, 'produto', f.produto, 'quantidade', f.quantidade,
        'valor_unitario', f.valor_unitario, 'mes', f.mes) order by f.unidade_id, f.produto), '[]')
        from public.lic_faturas f where f.unidade_id = any (p.unidades)
         and f.mes = (select max(x.mes) from public.lic_faturas x where x.unidade_id = f.unidade_id and x.mes < p.mes)),
    'resposta', case when v_ult.id is null then null else jsonb_build_object('protocolo', 'F-' || v_ult.id, 'itens', v_ult.itens,
        'declarante', v_ult.declarante, 'obs', v_ult.obs, 'em', v_ult.enviada_em, 'status', v_ult.status) end);
end $$;

create or replace function public.lic_formulario_enviar(p_codigo text, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.lic_pedidos; v_itens jsonb := '[]'; it jsonb; v_q int; v_v numeric; v_prod text; v_decl text; v_id bigint; v_orig jsonb;
begin
  p := public.lic_pedido_do_codigo(p_codigo);
  case public.lic_pedido_situacao(p)
    when 'cancelado' then raise exception 'Este link foi cancelado pela Nervia.';
    when 'encerrado' then raise exception 'O prazo para enviar terminou em %.', to_char(p.prazo, 'DD/MM/YYYY');
    else null;
  end case;
  v_decl := left(trim(coalesce(p_dados ->> 'declarante', '')), 120);
  if length(v_decl) < 3 then raise exception 'Informe o seu nome (quem está enviando).'; end if;
  if coalesce((p_dados ->> 'aceite')::boolean, false) is not true then raise exception 'Marque a declaração para enviar.'; end if;
  if jsonb_typeof(p_dados -> 'itens') <> 'array' or jsonb_array_length(p_dados -> 'itens') = 0 then raise exception 'Informe pelo menos uma licença.'; end if;
  if jsonb_array_length(p_dados -> 'itens') > 200 then raise exception 'Itens demais (máximo 200).'; end if;
  for it in select * from jsonb_array_elements(p_dados -> 'itens') loop
    if not ((it ->> 'unidade_id') ~ '^[0-9a-f-]{36}$' and (it ->> 'unidade_id')::uuid = any (p.unidades)) then raise exception 'Unidade fora deste formulário.'; end if;
    v_prod := left(trim(coalesce(it ->> 'produto', '')), 120);
    if length(v_prod) < 3 then raise exception 'Escolha a licença em todas as linhas.'; end if;
    begin
      v_q := (it ->> 'quantidade')::int; v_v := round((it ->> 'valor_unitario')::numeric, 2);
    exception when others then raise exception 'Confira os números: quantidade inteira e valor com até 2 casas.';
    end;
    if v_q is null or v_q < 0 or v_q > 100000 or v_v is null or v_v < 0 or v_v > 1000000 then raise exception 'Confira a quantidade e o valor de "%".', v_prod; end if;
    v_itens := v_itens || jsonb_build_object('unidade_id', it ->> 'unidade_id', 'produto', v_prod, 'quantidade', v_q, 'valor_unitario', v_v,
      'fora_da_lista', not (v_prod = any (public.lic_produtos())));
  end loop;
  v_orig := public.cmp_origem_requisicao();
  update public.lic_respostas set status = 'substituida' where pedido_id = p.id and status = 'pendente';
  insert into public.lic_respostas (pedido_id, itens, declarante, obs, ip, navegador)
  values (p.id, v_itens, v_decl, left(trim(coalesce(p_dados ->> 'obs', '')), 1000), v_orig ->> 'ip', v_orig ->> 'navegador')
  returning id into v_id;
  update public.lic_pedidos set respondido_em = now(), aberto_em = coalesce(aberto_em, now()) where id = p.id;
  perform public.lic_registrar_link('licencas_link_respondido', v_decl || ' (pelo link)', jsonb_build_object('pedido', p.id, 'mes', p.mes, 'resposta', v_id,
    'itens', jsonb_array_length(v_itens), 'valor_total', (select sum((x ->> 'quantidade')::int * (x ->> 'valor_unitario')::numeric) from jsonb_array_elements(v_itens) x)));
  return jsonb_build_object('protocolo', 'F-' || v_id, 'em', now());
end $$;

revoke execute on function public.lic_pedido_criar(date, date, uuid[], text, text, text), public.lic_pedido_prazo(bigint, date),
  public.lic_pedido_cancelar(bigint), public.lic_resposta_aprovar(bigint, boolean), public.lic_resposta_descartar(bigint, text) from public, anon;
grant execute on function public.lic_pedido_criar(date, date, uuid[], text, text, text), public.lic_pedido_prazo(bigint, date),
  public.lic_pedido_cancelar(bigint), public.lic_resposta_aprovar(bigint, boolean), public.lic_resposta_descartar(bigint, text) to authenticated;
revoke execute on function public.lic_formulario_ler(text), public.lic_formulario_enviar(text, jsonb) from public;
grant execute on function public.lic_formulario_ler(text), public.lic_formulario_enviar(text, jsonb) to anon, authenticated;
