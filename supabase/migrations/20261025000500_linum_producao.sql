-- Sistema Linum — Produção (pedido do Marco em 25/10/2026; versão 2.0 do app).
-- "A empresa compra os rolos de linho (em metros), manda para o cortador com a ficha do que cortar; cada roupa tem uma
--  metragem e o linho sai do estoque. Depois de conferido, vai para as costureiras, volta, é conferido, vai para a lavagem,
--  passadoria e entra para a venda. Controle de quantos rolos tenho, quantas peças fiz e com quem está cada peça."
-- Decisões do Marco (25/10/2026): a ficha de corte pode ter mais de um produto; as peças de uma ficha podem ir para
-- mais de um parceiro; cortador, costureira, lavagem e passadoria são pagos por peça (custo da peça e quanto pagar);
-- os 2 rolos do sistema antigo vêm por carga. E PERMISSÕES ALÉM DO PAPEL: "Produção tem valores que nem todo
-- colaborador pode ter ciência" → lin_membros.permissoes: 'producao' (opera rolos, fichas e etapas) e
-- 'producao_valores' (vê valor pago no linho, preço por peça e custo). O Dono tem tudo.
--
-- Modelo:
--   lin_parceiros    cortador / costureira / lavanderia / passadoria (preço por peça = valor)
--   lin_rolos        cada rolo comprado: código R-AAAA-NNN, tecido, cor, metros, saldo, valor pago (valor)
--   lin_rolo_movs    histórico do saldo (compra, corte, sobra, ajuste) — SOMENTE INCLUSÃO
--   lin_ordens       a ficha de produção (nº = id), prazo, loja que recebe, molde/observações
--   lin_ordem_itens  peças da ficha (variação + quantidade + metragem por peça no momento)
--   lin_envios       cada remessa a um parceiro numa etapa (corte, costura, lavagem, passadoria), com o preço por peça
--   lin_envio_itens  quantas peças foram e, somando os recebimentos, quantas voltaram boas e quantas se perderam
--   lin_envio_rolos  de que rolos saiu o linho de uma remessa de corte
--   lin_recebimentos cada conferência na volta (pode ser parcial) — SOMENTE INCLUSÃO
--   lin_ordem_entradas peças prontas que entraram no estoque da loja (com o custo por peça)
-- Etapas em ordem: corte → costura → lavagem → passadoria → estoque. Disponível para a etapa seguinte = recebidas boas na
-- anterior − já enviadas. Tudo pelas funções (security definer); as tabelas não são lidas pela tela: a leitura é pela
-- lin_producao_ler(), que tira os valores de quem não tem 'producao_valores'. Auditoria em tudo (linum_producao_*).

-- ---------------------------------------------------------------- permissões além do papel
alter table public.lin_membros add column if not exists permissoes text[] not null default '{}';
alter table public.lin_membros drop constraint if exists lin_membros_permissoes;
alter table public.lin_membros add constraint lin_membros_permissoes check (permissoes <@ array['producao', 'producao_valores']);

create or replace function public.lin_pode(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.lin_papel() = 'dono'
    or (public.lin_papel() is not null and p = any(coalesce((select permissoes from public.lin_membros where user_id = auth.uid()), '{}'::text[]))), false)
$$;

create or replace function public.lin_minhas_permissoes() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('producao', public.lin_pode('producao'), 'producao_valores', public.lin_pode('producao_valores'))
$$;

-- a equipe Nervia define (como o papel); valores da produção sempre vêm com a produção
create or replace function public.lin_membro_permissoes(p_user uuid, p_permissoes text[]) returns void
language plpgsql security definer set search_path = public as $$
declare v text[] := coalesce(p_permissoes, '{}'); v_papel text;
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia define a equipe da Linum'; end if;
  if not v <@ array['producao', 'producao_valores'] then raise exception 'Permissão inválida'; end if;
  select papel into v_papel from public.lin_membros where user_id = p_user;
  if v_papel is null then raise exception 'Dê um papel a este login antes das permissões'; end if;
  if v_papel = 'dono' then raise exception 'O Dono já tem todas as permissões'; end if;
  if 'producao_valores' = any(v) and not 'producao' = any(v) then v := array_append(v, 'producao'); end if;
  v := (select coalesce(array_agg(distinct x order by x), '{}') from unnest(v) x);
  update public.lin_membros set permissoes = v, atualizado_em = now() where user_id = p_user and permissoes is distinct from v;
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
      'comissao_pct_antes', case when tg_op = 'INSERT' then null else old.comissao_pct end,
      'permissoes', case when tg_op = 'DELETE' then null else to_jsonb(new.permissoes) end,
      'permissoes_antes', case when tg_op = 'INSERT' then null else to_jsonb(old.permissoes) end));
  return r;
end $$;

create or replace function public.lin_equipe() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia define a equipe da Linum'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'email', p.email, 'nome', p.nome,
             'papel', m.papel, 'loja_id', m.loja_id, 'comissao_pct', m.comissao_pct, 'permissoes', coalesce(to_jsonb(m.permissoes), '[]'))
           order by coalesce(nullif(p.nome, ''), p.email))
    from public.perfis p join public.app_acessos a on a.user_id = p.user_id and a.app_id = 'linum'
    left join public.lin_membros m on m.user_id = p.user_id), '[]');
end $$;

-- ---------------------------------------------------------------- metragem por peça
-- (as colunas já existem desde a linum_estoque, copiadas do sistema antigo; o add fica só por segurança)
alter table public.lin_produtos  add column if not exists consumo_metros numeric(8,3) check (consumo_metros is null or consumo_metros > 0);
alter table public.lin_variantes add column if not exists consumo_metros numeric(8,3) check (consumo_metros is null or consumo_metros > 0);

create or replace function public._lin_consumo(p_variante uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(v.consumo_metros, p.consumo_metros) from public.lin_variantes v join public.lin_produtos p on p.id = v.produto_id where v.id = p_variante
$$;

-- p = {produto_id, consumo_metros, variantes: {variante_id: metros | null}} (variante vazia = usa a do produto)
create or replace function public.lin_consumo_salvar(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_prod uuid := nullif(p ->> 'produto_id', '')::uuid; v_cons numeric := nullif(p ->> 'consumo_metros', '')::numeric;
        v_antes jsonb; k text; val text;
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  if not exists (select 1 from public.lin_produtos where id = v_prod) then raise exception 'Produto não encontrado'; end if;
  if v_cons is not null and (v_cons <= 0 or v_cons > 50) then raise exception 'Metragem por peça: entre 0,01 e 50 metros'; end if;
  select jsonb_build_object('produto', p0.consumo_metros, 'variantes', coalesce((select jsonb_object_agg(v.id, v.consumo_metros) from public.lin_variantes v
           where v.produto_id = v_prod and v.consumo_metros is not null), '{}')) into v_antes from public.lin_produtos p0 where p0.id = v_prod;
  update public.lin_produtos set consumo_metros = v_cons, atualizado_em = now() where id = v_prod;
  for k, val in select * from jsonb_each_text(coalesce(p -> 'variantes', '{}')) loop
    if nullif(val, '')::numeric is not null and (val::numeric <= 0 or val::numeric > 50) then raise exception 'Metragem por peça: entre 0,01 e 50 metros'; end if;
    update public.lin_variantes set consumo_metros = nullif(val, '')::numeric where id = k::uuid and produto_id = v_prod;
  end loop;
  perform public._lin_auditar('linum_consumo_alterado', null, jsonb_build_object('produto_id', v_prod,
    'produto', (select referencia || ' ' || descricao from public.lin_produtos where id = v_prod), 'antes', v_antes,
    'depois', jsonb_build_object('produto', v_cons, 'variantes', coalesce(p -> 'variantes', '{}'))));
end $$;

-- ---------------------------------------------------------------- parceiros
create table if not exists public.lin_parceiros (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(trim(nome)) > 1),
  tipo        text not null check (tipo in ('cortador', 'costureira', 'lavanderia', 'passadoria')),
  telefone    text not null default '' check (telefone ~ '^[0-9]*$'),
  contato     text not null default '',
  preco_peca  numeric(10,2) not null default 0 check (preco_peca >= 0),
  ativo       boolean not null default true,
  observacoes text not null default '',
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create or replace function public.lin_parceiro_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_nome text := public._lin_txt(p, 'nome'); v_tipo text := coalesce(p ->> 'tipo', '');
        v_tel text := regexp_replace(coalesce(p ->> 'telefone', ''), '\D', '', 'g'); v_preco numeric; v_antes jsonb;
        v_val boolean := public.lin_pode('producao_valores');
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  if v_nome is null or length(v_nome) < 2 then raise exception 'Informe o nome do parceiro'; end if;
  if v_tipo not in ('cortador', 'costureira', 'lavanderia', 'passadoria') then raise exception 'Escolha o tipo: cortador, costureira, lavanderia ou passadoria'; end if;
  if v_tel <> '' and length(v_tel) not between 10 and 13 then raise exception 'Telefone com DDD: 10 ou 11 dígitos'; end if;
  -- preço por peça só é gravado por quem tem a permissão de valores (os outros nem o veem)
  v_preco := case when v_val then coalesce(nullif(p ->> 'preco_peca', '')::numeric, 0) end;
  if v_preco is not null and v_preco < 0 then raise exception 'Preço por peça não pode ser negativo'; end if;
  if v_id is null then
    insert into public.lin_parceiros (nome, tipo, telefone, contato, preco_peca, observacoes, ativo)
    values (v_nome, v_tipo, v_tel, coalesce(public._lin_txt(p, 'contato'), ''), coalesce(v_preco, 0), coalesce(public._lin_txt(p, 'observacoes'), ''),
            coalesce((p ->> 'ativo')::boolean, true))
    returning id into v_id;
  else
    select to_jsonb(x) into v_antes from public.lin_parceiros x where id = v_id for update;
    if v_antes is null then raise exception 'Parceiro não encontrado'; end if;
    update public.lin_parceiros set nome = v_nome, tipo = v_tipo, telefone = v_tel, contato = coalesce(public._lin_txt(p, 'contato'), ''),
      preco_peca = coalesce(v_preco, preco_peca), observacoes = coalesce(public._lin_txt(p, 'observacoes'), ''),
      ativo = coalesce((p ->> 'ativo')::boolean, ativo), atualizado_em = now() where id = v_id;
  end if;
  perform public._lin_auditar(case when v_antes is null then 'linum_parceiro_criado' else 'linum_parceiro_alterado' end, null,
    jsonb_build_object('parceiro_id', v_id, 'antes', v_antes, 'depois', (select to_jsonb(x) from public.lin_parceiros x where id = v_id)));
  return v_id;
end $$;

-- ---------------------------------------------------------------- rolos de linho
create table if not exists public.lin_rolo_codigos (ano int primary key, ultimo int not null default 0);
create table if not exists public.lin_rolos (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique,
  fornecedor      text not null default '',
  tecido          text not null check (length(trim(tecido)) > 0),
  cor             text not null default '',
  metros_iniciais numeric(10,2) not null check (metros_iniciais > 0),
  saldo           numeric(10,2) not null check (saldo >= 0),
  valor_pago      numeric(12,2) not null default 0 check (valor_pago >= 0),
  data_compra     date not null default (now() at time zone 'America/Sao_Paulo')::date,
  nota            text not null default '',
  observacoes     text not null default '',
  origem          text not null default '',          -- 'linum-produtos:<id>' na carga do sistema antigo
  criado_por      uuid references auth.users on delete set null,
  criado_nome     text not null default '',
  criado_em       timestamptz not null default now()
);
create table if not exists public.lin_rolo_movs (
  id           bigint generated always as identity primary key,
  rolo_id      uuid not null references public.lin_rolos on delete cascade,
  em           timestamptz not null default now(),
  por          uuid references auth.users on delete set null,
  por_nome     text not null default '',
  tipo         text not null check (tipo in ('compra', 'corte', 'sobra', 'ajuste')),
  metros       numeric(10,2) not null,             -- + entra no rolo, − sai
  saldo_depois numeric(10,2) not null,
  ordem_id     bigint,
  envio_id     bigint,
  motivo       text not null default ''
);
create index if not exists lin_rolo_movs_rolo on public.lin_rolo_movs (rolo_id, em desc);

create or replace function public._lin_rolo_mov(p_rolo uuid, p_tipo text, p_metros numeric, p_ordem bigint, p_envio bigint, p_motivo text) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_saldo numeric;
begin
  select saldo + p_metros into v_saldo from public.lin_rolos where id = p_rolo for update;
  if v_saldo is null then raise exception 'Rolo não encontrado'; end if;
  if v_saldo < 0 then raise exception 'O rolo % não tem metragem suficiente (faltam % m)', (select codigo from public.lin_rolos where id = p_rolo), round(-v_saldo, 2); end if;
  update public.lin_rolos set saldo = v_saldo where id = p_rolo;
  insert into public.lin_rolo_movs (rolo_id, por, por_nome, tipo, metros, saldo_depois, ordem_id, envio_id, motivo)
  values (p_rolo, auth.uid(), public._lin_nome(), p_tipo, p_metros, v_saldo, p_ordem, p_envio, coalesce(p_motivo, ''));
  return v_saldo;
end $$;

-- compra: um ou vários rolos iguais (p.quantidade), cada um com p.metros; valor_pago = total da compra, dividido igual
create or replace function public.lin_rolo_comprar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_qtd int := coalesce(nullif(p ->> 'quantidade', '')::int, 1); v_metros numeric := nullif(p ->> 'metros', '')::numeric;
        v_tecido text := public._lin_txt(p, 'tecido'); v_valor numeric := 0; v_ano int; v_n int; v_id uuid; v_ids jsonb := '[]'; v_cod text;
        v_data date := coalesce(nullif(p ->> 'data_compra', '')::date, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  if v_tecido is null then raise exception 'Informe o tecido (ex.: linho puro, linho misto)'; end if;
  if v_metros is null or v_metros <= 0 or v_metros > 1000 then raise exception 'Informe os metros de cada rolo'; end if;
  if v_qtd < 1 or v_qtd > 50 then raise exception 'Quantidade de rolos: de 1 a 50'; end if;
  if v_data > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'A data da compra não pode ser no futuro'; end if;
  if public.lin_pode('producao_valores') then v_valor := coalesce(nullif(p ->> 'valor_pago', '')::numeric, 0); end if;
  if v_valor < 0 then raise exception 'Valor pago não pode ser negativo'; end if;
  v_ano := extract(year from v_data);
  for i in 1..v_qtd loop
    insert into public.lin_rolo_codigos (ano, ultimo) values (v_ano, 1)
    on conflict (ano) do update set ultimo = lin_rolo_codigos.ultimo + 1 returning ultimo into v_n;
    v_cod := 'R-' || v_ano || '-' || lpad(v_n::text, 3, '0');
    insert into public.lin_rolos (codigo, fornecedor, tecido, cor, metros_iniciais, saldo, valor_pago, data_compra, nota, observacoes, criado_por, criado_nome)
    values (v_cod, coalesce(public._lin_txt(p, 'fornecedor'), ''), v_tecido, coalesce(public._lin_txt(p, 'cor'), ''), v_metros, 0,
            round(v_valor / v_qtd, 2), v_data, coalesce(public._lin_txt(p, 'nota'), ''), coalesce(public._lin_txt(p, 'observacoes'), ''),
            auth.uid(), public._lin_nome())
    returning id into v_id;
    perform public._lin_rolo_mov(v_id, 'compra', v_metros, null, null, 'Compra');
    v_ids := v_ids || jsonb_build_object('id', v_id, 'codigo', v_cod);
  end loop;
  perform public._lin_auditar('linum_rolo_comprado', null, jsonb_build_object('rolos', v_ids, 'tecido', v_tecido, 'cor', p ->> 'cor',
    'metros_cada', v_metros, 'fornecedor', p ->> 'fornecedor', 'valor_pago', v_valor, 'nota', p ->> 'nota'));
  return v_ids;
end $$;

-- ajuste com motivo (medição real, retalho perdido, rolo esgotado…): novo saldo informado
create or replace function public.lin_rolo_ajustar(p_rolo uuid, p_saldo numeric, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_antes numeric;
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  if p_saldo is null or p_saldo < 0 then raise exception 'Informe o saldo em metros (zero ou mais)'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escreva o motivo do ajuste'; end if;
  select saldo into v_antes from public.lin_rolos where id = p_rolo for update;
  if v_antes is null then raise exception 'Rolo não encontrado'; end if;
  if v_antes = p_saldo then return; end if;
  perform public._lin_rolo_mov(p_rolo, 'ajuste', p_saldo - v_antes, null, null, trim(p_motivo));
  perform public._lin_auditar('linum_rolo_ajustado', null, jsonb_build_object('rolo', (select codigo from public.lin_rolos where id = p_rolo),
    'saldo_antes', v_antes, 'saldo', p_saldo, 'motivo', trim(p_motivo)));
end $$;

-- ---------------------------------------------------------------- fichas de produção
create table if not exists public.lin_ordens (
  id              bigint generated always as identity primary key,       -- nº da ficha
  criada_em       timestamptz not null default now(),
  criado_por      uuid references auth.users on delete set null,
  criado_nome     text not null default '',
  prazo           date,
  loja_destino_id uuid references public.lin_lojas,
  molde           text not null default '',        -- molde e instruções para o cortador
  observacao      text not null default '',
  status          text not null default 'aberta' check (status in ('aberta', 'concluida', 'cancelada')),
  encerrada_em    timestamptz,
  encerrada_nome  text,
  motivo_encerramento text
);
create table if not exists public.lin_ordem_itens (
  id          bigint generated always as identity primary key,
  ordem_id    bigint not null references public.lin_ordens on delete cascade,
  variante_id uuid references public.lin_variantes on delete set null,
  referencia  text not null default '', descricao text not null default '', cor text not null default '',
  tamanho     text not null default '', edicao text not null default '',
  quantidade  int not null check (quantidade > 0),
  consumo     numeric(8,3) not null check (consumo > 0)          -- metros por peça no momento da ficha
);
create index if not exists lin_ordem_itens_ordem on public.lin_ordem_itens (ordem_id);

create table if not exists public.lin_envios (
  id            bigint generated always as identity primary key,
  ordem_id      bigint not null references public.lin_ordens on delete cascade,
  etapa         text not null check (etapa in ('corte', 'costura', 'lavagem', 'passadoria')),
  parceiro_id   uuid not null references public.lin_parceiros,
  parceiro_nome text not null default '',
  preco_peca    numeric(10,2) not null default 0,
  prazo         date,
  enviado_em    timestamptz not null default now(),
  enviado_por   uuid references auth.users on delete set null,
  enviado_nome  text not null default '',
  observacao    text not null default '',
  status        text not null default 'aberto' check (status in ('aberto', 'recebido'))
);
create index if not exists lin_envios_ordem on public.lin_envios (ordem_id);
create table if not exists public.lin_envio_itens (
  id            bigint generated always as identity primary key,
  envio_id      bigint not null references public.lin_envios on delete cascade,
  ordem_item_id bigint not null references public.lin_ordem_itens on delete cascade,
  enviadas      int not null check (enviadas > 0),
  recebidas     int not null default 0 check (recebidas >= 0),
  perdas        int not null default 0 check (perdas >= 0),
  check (recebidas + perdas <= enviadas)
);
create table if not exists public.lin_envio_rolos (
  id       bigint generated always as identity primary key,
  envio_id bigint not null references public.lin_envios on delete cascade,
  rolo_id  uuid not null references public.lin_rolos,
  metros   numeric(10,2) not null check (metros > 0)
);
create table if not exists public.lin_recebimentos (
  id         bigint generated always as identity primary key,
  envio_id   bigint not null references public.lin_envios on delete cascade,
  em         timestamptz not null default now(),
  por        uuid references auth.users on delete set null,
  por_nome   text not null default '',
  itens      jsonb not null,                       -- [{ordem_item_id, recebidas, perdas, motivo}]
  sobra_metros numeric(10,2) not null default 0,   -- corte: linho que voltou ao rolo
  observacao text not null default ''
);
create table if not exists public.lin_ordem_entradas (
  id            bigint generated always as identity primary key,
  ordem_item_id bigint not null references public.lin_ordem_itens on delete cascade,
  loja_id       uuid not null references public.lin_lojas,
  quantidade    int not null check (quantidade > 0),
  custo_unitario numeric(12,2),
  em            timestamptz not null default now(),
  por           uuid references auth.users on delete set null,
  por_nome      text not null default ''
);

-- nada disso é lido direto pela tela (valores escondidos): leitura só pela lin_producao_ler()
do $$ declare t text; begin
  foreach t in array array['lin_parceiros', 'lin_rolo_codigos', 'lin_rolos', 'lin_rolo_movs', 'lin_ordens', 'lin_ordem_itens', 'lin_envios',
                           'lin_envio_itens', 'lin_envio_rolos', 'lin_recebimentos', 'lin_ordem_entradas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- históricos que não se alteram nem se apagam (só a função, por dentro, atualiza os contadores)
create or replace function public.lin_producao_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'Registro da produção não pode ser alterado nem apagado: registre um ajuste.';
end $$;
drop trigger if exists lin_rolo_movs_imutavel on public.lin_rolo_movs;
create trigger lin_rolo_movs_imutavel before update or delete on public.lin_rolo_movs
  for each row when (pg_trigger_depth() = 0) execute function public.lin_producao_imutavel();
drop trigger if exists lin_recebimentos_imutavel on public.lin_recebimentos;
create trigger lin_recebimentos_imutavel before update or delete on public.lin_recebimentos
  for each row when (pg_trigger_depth() = 0) execute function public.lin_producao_imutavel();
drop trigger if exists lin_ordem_entradas_imutavel on public.lin_ordem_entradas;
create trigger lin_ordem_entradas_imutavel before update or delete on public.lin_ordem_entradas
  for each row when (pg_trigger_depth() = 0) execute function public.lin_producao_imutavel();

-- quantas peças de um item estão disponíveis para a etapa (o que voltou bom da anterior menos o que já foi enviado)
create or replace function public._lin_disponivel(p_item bigint, p_etapa text) returns int
language sql stable security definer set search_path = public as $$
  with ant as (select case p_etapa when 'costura' then 'corte' when 'lavagem' then 'costura' when 'passadoria' then 'lavagem' when 'estoque' then 'passadoria' end as e)
  select (case when p_etapa = 'corte' then (select quantidade from public.lin_ordem_itens where id = p_item)
               else coalesce((select sum(ei.recebidas) from public.lin_envio_itens ei join public.lin_envios e on e.id = ei.envio_id
                               where ei.ordem_item_id = p_item and e.etapa = (select e from ant)), 0) end
        - case when p_etapa = 'estoque' then coalesce((select sum(quantidade) from public.lin_ordem_entradas where ordem_item_id = p_item), 0)
               else coalesce((select sum(ei.enviadas) from public.lin_envio_itens ei join public.lin_envios e on e.id = ei.envio_id
                               where ei.ordem_item_id = p_item and e.etapa = p_etapa), 0) end)::int
$$;

-- p = {prazo, loja_destino_id, molde, observacao, itens:[{variante_id, quantidade, consumo?}]}
create or replace function public.lin_ordem_criar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; it jsonb; v_var uuid; v_qtd int; v_cons numeric; v_n int := 0; v_metros numeric := 0;
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  if jsonb_array_length(coalesce(p -> 'itens', '[]')) = 0 then raise exception 'Coloque pelo menos uma peça na ficha'; end if;
  if nullif(p ->> 'loja_destino_id', '') is not null and not exists (select 1 from public.lin_lojas where id = (p ->> 'loja_destino_id')::uuid) then
    raise exception 'Loja não encontrada';
  end if;
  insert into public.lin_ordens (criado_por, criado_nome, prazo, loja_destino_id, molde, observacao)
  values (auth.uid(), public._lin_nome(), nullif(p ->> 'prazo', '')::date, nullif(p ->> 'loja_destino_id', '')::uuid,
          coalesce(public._lin_txt(p, 'molde'), ''), coalesce(public._lin_txt(p, 'observacao'), ''))
  returning id into v_id;
  for it in select * from jsonb_array_elements(p -> 'itens') loop
    v_var := nullif(it ->> 'variante_id', '')::uuid; v_qtd := nullif(it ->> 'quantidade', '')::int;
    if v_qtd is null or v_qtd < 1 or v_qtd > 5000 then raise exception 'Quantidade de cada peça: de 1 a 5000'; end if;
    v_cons := coalesce(nullif(it ->> 'consumo', '')::numeric, public._lin_consumo(v_var));
    if v_cons is null then
      raise exception 'Falta a metragem por peça de % (informe na ficha ou em Produção → Metragem por peça)',
        (select pr.referencia || ' ' || v.cor || ' ' || v.tamanho from public.lin_variantes v join public.lin_produtos pr on pr.id = v.produto_id where v.id = v_var);
    end if;
    if v_cons <= 0 or v_cons > 50 then raise exception 'Metragem por peça: entre 0,01 e 50 metros'; end if;
    insert into public.lin_ordem_itens (ordem_id, variante_id, referencia, descricao, cor, tamanho, edicao, quantidade, consumo)
    select v_id, v.id, pr.referencia, pr.descricao, v.cor, v.tamanho, v.edicao, v_qtd, v_cons
      from public.lin_variantes v join public.lin_produtos pr on pr.id = v.produto_id where v.id = v_var;
    if not found then raise exception 'Peça não encontrada'; end if;
    v_n := v_n + v_qtd; v_metros := v_metros + v_qtd * v_cons;
  end loop;
  perform public._lin_auditar('linum_producao_ficha_criada', null, jsonb_build_object('ficha', v_id, 'pecas', v_n, 'metros', v_metros,
    'itens', (select jsonb_agg(jsonb_build_object('peca', referencia || ' ' || cor || ' ' || tamanho, 'quantidade', quantidade)) from public.lin_ordem_itens where ordem_id = v_id)));
  return v_id;
end $$;

-- p = {ordem_id, etapa, parceiro_id, prazo, observacao, preco_peca?, itens:[{ordem_item_id, quantidade}], rolos:[{rolo_id, metros}] (corte)}
create or replace function public.lin_envio_criar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_ordem bigint := nullif(p ->> 'ordem_id', '')::bigint; v_etapa text := coalesce(p ->> 'etapa', ''); v_parc uuid := nullif(p ->> 'parceiro_id', '')::uuid;
        v_ptipo text; v_pnome text; v_preco numeric; v_id bigint; it jsonb; r jsonb; v_item bigint; v_qtd int; v_disp int; v_n int := 0; v_metros numeric := 0; v_status text;
        v_precisa numeric := 0;
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  select status into v_status from public.lin_ordens where id = v_ordem for update;
  if v_status is null then raise exception 'Ficha não encontrada'; end if;
  if v_status <> 'aberta' then raise exception 'Esta ficha está %', case v_status when 'concluida' then 'concluída' else 'cancelada' end; end if;
  if v_etapa not in ('corte', 'costura', 'lavagem', 'passadoria') then raise exception 'Etapa inválida'; end if;
  select tipo, nome, preco_peca into v_ptipo, v_pnome, v_preco from public.lin_parceiros where id = v_parc and ativo;
  if v_ptipo is null then raise exception 'Escolha o parceiro'; end if;
  if v_ptipo <> (case v_etapa when 'corte' then 'cortador' when 'costura' then 'costureira' when 'lavagem' then 'lavanderia' else 'passadoria' end) then
    raise exception 'Este parceiro não é de %', v_etapa;
  end if;
  -- o preço por peça vem do cadastro; quem tem a permissão de valores pode trocar só nesta remessa
  if public.lin_pode('producao_valores') and nullif(p ->> 'preco_peca', '') is not null then v_preco := (p ->> 'preco_peca')::numeric; end if;
  if v_preco < 0 then raise exception 'Preço por peça não pode ser negativo'; end if;
  insert into public.lin_envios (ordem_id, etapa, parceiro_id, parceiro_nome, preco_peca, prazo, enviado_por, enviado_nome, observacao)
  values (v_ordem, v_etapa, v_parc, v_pnome, v_preco, nullif(p ->> 'prazo', '')::date, auth.uid(), public._lin_nome(), coalesce(public._lin_txt(p, 'observacao'), ''))
  returning id into v_id;
  for it in select * from jsonb_array_elements(coalesce(p -> 'itens', '[]')) loop
    v_item := (it ->> 'ordem_item_id')::bigint; v_qtd := coalesce(nullif(it ->> 'quantidade', '')::int, 0);
    if v_qtd = 0 then continue; end if;
    if v_qtd < 0 then raise exception 'Quantidade inválida'; end if;
    if not exists (select 1 from public.lin_ordem_itens where id = v_item and ordem_id = v_ordem) then raise exception 'Peça não é desta ficha'; end if;
    v_disp := public._lin_disponivel(v_item, v_etapa);
    if v_qtd > v_disp then
      raise exception 'Só há % peça(s) de % disponíveis para %', v_disp,
        (select referencia || ' ' || cor || ' ' || tamanho from public.lin_ordem_itens where id = v_item), v_etapa;
    end if;
    insert into public.lin_envio_itens (envio_id, ordem_item_id, enviadas) values (v_id, v_item, v_qtd);
    v_n := v_n + v_qtd;
    v_precisa := v_precisa + v_qtd * (select consumo from public.lin_ordem_itens where id = v_item);
  end loop;
  if v_n = 0 then raise exception 'Informe quantas peças vão nesta remessa'; end if;
  -- corte: o linho sai dos rolos escolhidos
  if v_etapa = 'corte' then
    for r in select * from jsonb_array_elements(coalesce(p -> 'rolos', '[]')) loop
      if coalesce(nullif(r ->> 'metros', '')::numeric, 0) <= 0 then continue; end if;
      insert into public.lin_envio_rolos (envio_id, rolo_id, metros) values (v_id, (r ->> 'rolo_id')::uuid, (r ->> 'metros')::numeric);
      perform public._lin_rolo_mov((r ->> 'rolo_id')::uuid, 'corte', -(r ->> 'metros')::numeric, v_ordem, v_id, 'Ficha nº ' || v_ordem || ' para ' || v_pnome);
      v_metros := v_metros + (r ->> 'metros')::numeric;
    end loop;
    if v_metros = 0 then raise exception 'Escolha de que rolo sai o linho (precisa de % m)', round(v_precisa, 2); end if;
  end if;
  perform public._lin_auditar('linum_producao_enviada', null, jsonb_build_object('ficha', v_ordem, 'remessa', v_id, 'etapa', v_etapa,
    'parceiro', v_pnome, 'pecas', v_n, 'metros', nullif(v_metros, 0), 'preco_peca', v_preco));
  return v_id;
end $$;

-- conferência na volta (pode ser parcial): p = {envio_id, itens:[{ordem_item_id, recebidas, perdas, motivo}], sobra:[{rolo_id, metros}], observacao}
create or replace function public.lin_envio_receber(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_envio bigint := nullif(p ->> 'envio_id', '')::bigint; e record; it jsonb; v_rec int; v_per int; v_ok int := 0; v_perdas int := 0;
        v_sobra numeric := 0; r jsonb; ei record;
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  select * into e from public.lin_envios where id = v_envio for update;
  if e.id is null then raise exception 'Remessa não encontrada'; end if;
  if e.status <> 'aberto' then raise exception 'Esta remessa já foi toda recebida'; end if;
  for it in select * from jsonb_array_elements(coalesce(p -> 'itens', '[]')) loop
    v_rec := coalesce(nullif(it ->> 'recebidas', '')::int, 0); v_per := coalesce(nullif(it ->> 'perdas', '')::int, 0);
    if v_rec < 0 or v_per < 0 then raise exception 'Quantidade inválida'; end if;
    if v_rec + v_per = 0 then continue; end if;
    select * into ei from public.lin_envio_itens where envio_id = v_envio and ordem_item_id = (it ->> 'ordem_item_id')::bigint for update;
    if ei.id is null then raise exception 'Peça não é desta remessa'; end if;
    if ei.recebidas + ei.perdas + v_rec + v_per > ei.enviadas then
      raise exception 'Foram % peça(s) e já voltaram %: não dá para receber mais % de %', ei.enviadas, ei.recebidas + ei.perdas, v_rec + v_per,
        (select referencia || ' ' || cor || ' ' || tamanho from public.lin_ordem_itens where id = ei.ordem_item_id);
    end if;
    if v_per > 0 and length(trim(coalesce(it ->> 'motivo', ''))) < 3 then raise exception 'Escreva o motivo das peças perdidas ou com defeito'; end if;
    update public.lin_envio_itens set recebidas = recebidas + v_rec, perdas = perdas + v_per where id = ei.id;
    v_ok := v_ok + v_rec; v_perdas := v_perdas + v_per;
  end loop;
  -- corte: sobra de linho volta ao rolo
  if e.etapa = 'corte' then
    for r in select * from jsonb_array_elements(coalesce(p -> 'sobra', '[]')) loop
      if coalesce(nullif(r ->> 'metros', '')::numeric, 0) <= 0 then continue; end if;
      if not exists (select 1 from public.lin_envio_rolos where envio_id = v_envio and rolo_id = (r ->> 'rolo_id')::uuid) then raise exception 'A sobra volta para um rolo usado neste corte'; end if;
      perform public._lin_rolo_mov((r ->> 'rolo_id')::uuid, 'sobra', (r ->> 'metros')::numeric, e.ordem_id, v_envio, 'Sobra do corte da ficha nº ' || e.ordem_id);
      v_sobra := v_sobra + (r ->> 'metros')::numeric;
    end loop;
  end if;
  if v_ok + v_perdas = 0 and v_sobra = 0 then raise exception 'Informe quantas peças voltaram'; end if;
  insert into public.lin_recebimentos (envio_id, por, por_nome, itens, sobra_metros, observacao)
  values (v_envio, auth.uid(), public._lin_nome(), coalesce(p -> 'itens', '[]'), v_sobra, coalesce(public._lin_txt(p, 'observacao'), ''));
  if not exists (select 1 from public.lin_envio_itens where envio_id = v_envio and recebidas + perdas < enviadas) then
    update public.lin_envios set status = 'recebido' where id = v_envio;
  end if;
  perform public._lin_auditar('linum_producao_recebida', null, jsonb_build_object('ficha', e.ordem_id, 'remessa', v_envio, 'etapa', e.etapa,
    'parceiro', e.parceiro_nome, 'boas', v_ok, 'perdas', v_perdas, 'sobra_metros', nullif(v_sobra, 0),
    'motivos', (select jsonb_agg(it2 ->> 'motivo') from jsonb_array_elements(coalesce(p -> 'itens', '[]')) it2 where coalesce(it2 ->> 'motivo', '') <> '')));
end $$;

-- custo por peça de um item: linho (preço médio por metro dos rolos do corte × metragem) + preço por peça de cada etapa
create or replace function public._lin_custo_item(p_item bigint) returns numeric
language sql stable security definer set search_path = public as $$
  with i as (select * from public.lin_ordem_itens where id = p_item),
  linho as (
    select sum(er.metros * r.valor_pago / r.metros_iniciais) / nullif(sum(er.metros), 0) as por_metro
      from public.lin_envio_rolos er join public.lin_envios e on e.id = er.envio_id join public.lin_rolos r on r.id = er.rolo_id
     where e.ordem_id = (select ordem_id from i)
  ),
  etapas as (
    select e.etapa, sum(ei.recebidas * e.preco_peca) / nullif(sum(ei.recebidas), 0) as preco
      from public.lin_envio_itens ei join public.lin_envios e on e.id = ei.envio_id
     where ei.ordem_item_id = p_item group by e.etapa
  )
  select round(coalesce((select por_metro from linho), 0) * (select consumo from i) + coalesce((select sum(preco) from etapas), 0), 2)
$$;

-- peças prontas (voltaram boas da passadoria) entram no estoque: p = {ordem_id, loja_id, itens:[{ordem_item_id, quantidade}]}
create or replace function public.lin_ordem_entrada(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_ordem bigint := nullif(p ->> 'ordem_id', '')::bigint; v_loja uuid := nullif(p ->> 'loja_id', '')::uuid; it jsonb; v_item bigint; v_qtd int;
        v_disp int; v_var uuid; v_n int := 0; v_custo numeric; v_status text;
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  select status into v_status from public.lin_ordens where id = v_ordem for update;
  if v_status is null then raise exception 'Ficha não encontrada'; end if;
  if v_status <> 'aberta' then raise exception 'Esta ficha não está aberta'; end if;
  if not exists (select 1 from public.lin_lojas where id = v_loja) then raise exception 'Escolha a loja que recebe as peças'; end if;
  for it in select * from jsonb_array_elements(coalesce(p -> 'itens', '[]')) loop
    v_item := (it ->> 'ordem_item_id')::bigint; v_qtd := coalesce(nullif(it ->> 'quantidade', '')::int, 0);
    if v_qtd = 0 then continue; end if;
    select variante_id into v_var from public.lin_ordem_itens where id = v_item and ordem_id = v_ordem;
    if not found then raise exception 'Peça não é desta ficha'; end if;
    if v_var is null then raise exception 'A variação desta peça foi excluída do cadastro'; end if;
    v_disp := public._lin_disponivel(v_item, 'estoque');
    if v_qtd < 0 or v_qtd > v_disp then raise exception 'Só há % peça(s) prontas para entrar no estoque', v_disp; end if;
    v_custo := public._lin_custo_item(v_item);
    insert into public.lin_ordem_entradas (ordem_item_id, loja_id, quantidade, custo_unitario, por, por_nome)
    values (v_item, v_loja, v_qtd, v_custo, auth.uid(), public._lin_nome());
    insert into public.lin_estoque (variante_id, loja_id, quantidade) values (v_var, v_loja, v_qtd)
    on conflict (variante_id, loja_id) do update set quantidade = lin_estoque.quantidade + excluded.quantidade, atualizado_em = now();
    insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, data, observacao, criado_por, criado_nome)
    values (v_var, v_loja, 'producao', v_qtd, (now() at time zone 'America/Sao_Paulo')::date, 'Ficha de produção nº ' || v_ordem, auth.uid(), public._lin_nome());
    perform public._lin_auditar('linum_producao_estoque', v_var, jsonb_build_object('ficha', v_ordem, 'loja', public._lin_loja(v_loja), 'quantidade', v_qtd,
      'custo_unitario', v_custo));
    v_n := v_n + v_qtd;
  end loop;
  if v_n = 0 then raise exception 'Informe quantas peças entram no estoque'; end if;
  -- ficha concluída quando todas as peças planejadas entraram no estoque ou se perderam em alguma etapa
  if not exists (select 1 from public.lin_ordem_itens i where i.ordem_id = v_ordem
                  and i.quantidade > coalesce((select sum(quantidade) from public.lin_ordem_entradas where ordem_item_id = i.id), 0)
                                   + coalesce((select sum(ei.perdas) from public.lin_envio_itens ei where ei.ordem_item_id = i.id), 0)) then
    update public.lin_ordens set status = 'concluida', encerrada_em = now(), encerrada_nome = public._lin_nome() where id = v_ordem;
  end if;
end $$;

alter table public.lin_movimentos drop constraint if exists lin_movimentos_tipo_check;
alter table public.lin_movimentos add constraint lin_movimentos_tipo_check
  check (tipo in ('entrada', 'saida', 'transferencia', 'ajuste', 'venda', 'devolucao', 'producao'));

-- cancelar (nada enviado ainda) ou encerrar (o que faltou não vai mais ser feito), com motivo
create or replace function public.lin_ordem_encerrar(p_ordem bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_status text; v_enviou boolean;
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escreva o motivo'; end if;
  select status into v_status from public.lin_ordens where id = p_ordem for update;
  if v_status is null then raise exception 'Ficha não encontrada'; end if;
  if v_status <> 'aberta' then raise exception 'Esta ficha não está aberta'; end if;
  if exists (select 1 from public.lin_envios where ordem_id = p_ordem and status = 'aberto') then
    raise exception 'Ainda há peças com parceiro: receba as remessas abertas antes de encerrar';
  end if;
  v_enviou := exists (select 1 from public.lin_envios where ordem_id = p_ordem);
  update public.lin_ordens set status = case when v_enviou then 'concluida' else 'cancelada' end, encerrada_em = now(),
    encerrada_nome = public._lin_nome(), motivo_encerramento = trim(p_motivo) where id = p_ordem;
  perform public._lin_auditar(case when v_enviou then 'linum_producao_ficha_encerrada' else 'linum_producao_ficha_cancelada' end, null,
    jsonb_build_object('ficha', p_ordem, 'motivo', trim(p_motivo)));
end $$;

-- ---------------------------------------------------------------- leitura (valores só para quem pode)
create or replace function public.lin_producao_ler() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_val boolean := public.lin_pode('producao_valores');
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  return jsonb_build_object(
    'valores', v_val,
    'lojas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome) order by ordem, nome) from public.lin_lojas), '[]'),
    'parceiros', coalesce((select jsonb_agg(case when v_val then to_jsonb(x) else to_jsonb(x) - 'preco_peca' end order by x.tipo, x.nome) from public.lin_parceiros x), '[]'),
    'rolos', coalesce((select jsonb_agg(case when v_val then to_jsonb(r) - 'origem' else to_jsonb(r) - 'origem' - 'valor_pago' end order by r.saldo = 0, r.data_compra desc, r.codigo desc)
                       from public.lin_rolos r), '[]'),
    'produtos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'referencia', p.referencia, 'descricao', p.descricao, 'consumo', p.consumo_metros,
                   'variantes', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'cor', v.cor, 'tamanho', v.tamanho, 'edicao', v.edicao, 'consumo', v.consumo_metros)
                                          order by v.cor, v.tamanho) from public.lin_variantes v where v.produto_id = p.id and v.ativo), '[]'))
                 order by p.descricao, p.referencia) from public.lin_produtos p where p.ativo), '[]'),
    'ordens', coalesce((select jsonb_agg(to_jsonb(o) || jsonb_build_object(
        'itens', coalesce((select jsonb_agg(to_jsonb(i) || jsonb_build_object(
                    'custo', case when v_val then public._lin_custo_item(i.id) end,
                    'entraram', coalesce((select sum(quantidade) from public.lin_ordem_entradas where ordem_item_id = i.id), 0),
                    'disp', jsonb_build_object('corte', public._lin_disponivel(i.id, 'corte'), 'costura', public._lin_disponivel(i.id, 'costura'),
                              'lavagem', public._lin_disponivel(i.id, 'lavagem'), 'passadoria', public._lin_disponivel(i.id, 'passadoria'),
                              'estoque', public._lin_disponivel(i.id, 'estoque'))) order by i.id)
                  from public.lin_ordem_itens i where i.ordem_id = o.id), '[]'),
        'envios', coalesce((select jsonb_agg((case when v_val then to_jsonb(e) else to_jsonb(e) - 'preco_peca' end) || jsonb_build_object(
                    'itens', (select jsonb_agg(to_jsonb(ei) order by ei.id) from public.lin_envio_itens ei where ei.envio_id = e.id),
                    'rolos', (select jsonb_agg(jsonb_build_object('rolo_id', er.rolo_id, 'codigo', r.codigo, 'metros', er.metros)) from public.lin_envio_rolos er join public.lin_rolos r on r.id = er.rolo_id where er.envio_id = e.id),
                    'recebimentos', (select jsonb_agg(to_jsonb(rc) order by rc.em) from public.lin_recebimentos rc where rc.envio_id = e.id)) order by e.enviado_em)
                  from public.lin_envios e where e.ordem_id = o.id), '[]'),
        'entradas', coalesce((select jsonb_agg((case when v_val then to_jsonb(en) else to_jsonb(en) - 'custo_unitario' end) order by en.em)
                  from public.lin_ordem_entradas en join public.lin_ordem_itens i on i.id = en.ordem_item_id where i.ordem_id = o.id), '[]'))
      order by o.id desc) from public.lin_ordens o), '[]'));
end $$;

create or replace function public.lin_rolo_historico(p_rolo uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  return coalesce((select jsonb_agg(to_jsonb(m) order by m.em desc, m.id desc) from public.lin_rolo_movs m where m.rolo_id = p_rolo), '[]');
end $$;

do $$ declare f text; begin
  foreach f in array array['lin_pode(text)', 'lin_minhas_permissoes()', 'lin_membro_permissoes(uuid, text[])', 'lin_consumo_salvar(jsonb)',
      'lin_parceiro_salvar(jsonb)', 'lin_rolo_comprar(jsonb)', 'lin_rolo_ajustar(uuid, numeric, text)', 'lin_ordem_criar(jsonb)',
      'lin_envio_criar(jsonb)', 'lin_envio_receber(jsonb)', 'lin_ordem_entrada(jsonb)', 'lin_ordem_encerrar(bigint, text)',
      'lin_producao_ler()', 'lin_rolo_historico(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['_lin_consumo(uuid)', '_lin_rolo_mov(uuid, text, numeric, bigint, bigint, text)', '_lin_disponivel(bigint, text)', '_lin_custo_item(bigint)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
