-- App "Orçamentos de Compras" (prefixo cmp_) — fase 1: uso interno das administrações (o fornecedor
-- ainda não acessa; o comprador registra as propostas). Decisões do Marco em 16/10/2026:
--   * base ÚNICA de fornecedores para todos os shoppings (mesma administradora); requisições, propostas,
--     aprovações e alçadas são de cada shopping (cmp_unidades);
--   * fornecedor identificado por CNPJ (aceita o CNPJ alfanumérico da Receita, IN RFB 2.229/2024) ou CPF
--     (prestador pessoa física); documento é a chave única, sem duplicidade;
--   * qualquer comprador cadastra; quem cadastrou é o responsável pela homologação e fica registrado;
--   * o Gerente dá o "aval" ao fornecedor POR SHOPPING; sem aval não bloqueia nada, só gera aviso;
--   * mínimo de 3 propostas (exceção: fornecedor exclusivo, com justificativa);
--   * escolher quem não é o menor preço exige justificativa;
--   * alçadas: até R$ 5.000 com o menor preço = automática; até R$ 50.000 = Gerente; acima = Gerente e Diretor;
--     a PRIMEIRA compra com um fornecedor sempre vai ao Gerente;
--   * após a entrega o Gerente avalia o fornecedor (1 a 5 em 4 critérios); a nota é a média, comum a todos.
-- Toda mudança de estado passa por funções (rpc) que conferem papel e regra no servidor; a tela não grava
-- direto nas tabelas (exceto criar requisição e a configuração feita pela equipe Nervia).
-- Histórico (cmp_historico), aprovações e avaliações são SOMENTE INCLUSÃO; tudo vai também para `auditoria`.

-- ---------------------------------------------------------------- unidades (shoppings) e papéis
create table if not exists public.cmp_unidades (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null unique check (length(trim(nome)) > 0),
  cnpj              text,
  minimo_propostas  int  not null default 3 check (minimo_propostas between 1 and 10),
  alcada_automatica numeric(14,2) not null default 5000 check (alcada_automatica >= 0),
  alcada_gerente    numeric(14,2) not null default 50000 check (alcada_gerente >= 0),
  pesos             jsonb not null default '{"preco":40,"prazo":30,"pagamento":20,"qualidade":10}'::jsonb,
  ativo             boolean not null default true,
  criado_em         timestamptz not null default now(),
  check ((pesos->>'preco')::int + (pesos->>'prazo')::int + (pesos->>'pagamento')::int + (pesos->>'qualidade')::int = 100),
  check (alcada_gerente >= alcada_automatica)
);

create table if not exists public.cmp_membros (
  user_id    uuid references auth.users on delete cascade,
  unidade_id uuid references public.cmp_unidades on delete cascade,
  papel      text not null check (papel in ('solicitante', 'comprador', 'gerente', 'diretor')),
  primary key (user_id, unidade_id, papel)
);

create table if not exists public.cmp_grupos (
  nome  text primary key check (length(trim(nome)) > 0),
  ordem int not null default 0
);
insert into public.cmp_grupos (nome, ordem) values
  ('Tecnologia', 10), ('Refrigeração', 20), ('Automação', 30), ('Energia', 40), ('Jardinagem', 50),
  ('Mão de obra', 60), ('Limpeza', 70), ('Segurança', 80), ('Obras civis', 90), ('Outros', 100)
on conflict do nothing;

insert into public.cmp_unidades (nome) values ('Multicenter Itaipu') on conflict do nothing;

-- tem algum destes papéis na unidade? (equipe Nervia = todos)
create or replace function public.cmp_tem_papel(p_unidade uuid, p_papeis text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or exists (select 1 from public.cmp_membros
    where user_id = auth.uid() and unidade_id = p_unidade and papel = any (p_papeis))
$$;
create or replace function public.cmp_membro(p_unidade uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or exists (select 1 from public.cmp_membros where user_id = auth.uid() and unidade_id = p_unidade)
$$;
create or replace function public.cmp_membro_algum() returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or exists (select 1 from public.cmp_membros where user_id = auth.uid())
$$;
create or replace function public.cmp_nome_atual() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(nome, ''), email, 'sistema') from public.perfis where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------- validação de CPF / CNPJ
-- CNPJ: 12 posições alfanuméricas + 2 dígitos verificadores numéricos. Cada caractere vale (código ASCII - 48)
-- (0-9 = 0-9, A = 17 ... Z = 42), pesos 2 a 9 da direita para a esquerda, módulo 11 (IN RFB 2.229/2024).
-- Para CNPJ só numérico o resultado é o mesmo do cálculo tradicional.
create or replace function public.cmp_doc_valido(p_tipo text, p_doc text) returns boolean
language plpgsql immutable as $$
declare s text := upper(coalesce(p_doc, '')); t int; r int; w int; i int; d1 int; d2 int;
begin
  if p_tipo = 'PF' then
    if s !~ '^[0-9]{11}$' or s ~ '^(.)\1{10}$' then return false; end if;
    t := 0; for i in 1..9 loop t := t + substr(s, i, 1)::int * (11 - i); end loop;
    d1 := (t * 10) % 11; if d1 = 10 then d1 := 0; end if;
    t := 0; for i in 1..10 loop t := t + substr(s, i, 1)::int * (12 - i); end loop;
    d2 := (t * 10) % 11; if d2 = 10 then d2 := 0; end if;
    return d1 = substr(s, 10, 1)::int and d2 = substr(s, 11, 1)::int;
  elsif p_tipo = 'PJ' then
    if s !~ '^[0-9A-Z]{12}[0-9]{2}$' or s ~ '^(.)\1{13}$' then return false; end if;
    t := 0; w := 5; for i in 1..12 loop t := t + (ascii(substr(s, i, 1)) - 48) * w; w := case when w = 2 then 9 else w - 1 end; end loop;
    r := t % 11; d1 := case when r < 2 then 0 else 11 - r end;
    t := 0; w := 6; for i in 1..13 loop t := t + (ascii(substr(s, i, 1)) - 48) * w; w := case when w = 2 then 9 else w - 1 end; end loop;
    r := t % 11; d2 := case when r < 2 then 0 else 11 - r end;
    return d1 = substr(s, 13, 1)::int and d2 = substr(s, 14, 1)::int;
  end if;
  return false;
end $$;

-- ---------------------------------------------------------------- fornecedores (base única)
create table if not exists public.cmp_fornecedores (
  id                 uuid primary key default gen_random_uuid(),
  tipo               text not null check (tipo in ('PJ', 'PF')),
  documento          text not null unique,
  nome               text not null check (length(trim(nome)) > 0),
  grupos             text[] not null default '{}',
  contato            text not null default '',
  email              text not null default '',
  telefone           text not null default '',
  certidoes_validade date,
  obs                text not null default '',
  cadastrado_por     uuid references auth.users on delete set null,
  cadastrado_nome    text not null default '',
  cadastrado_unidade uuid references public.cmp_unidades on delete set null,
  cadastrado_em      timestamptz not null default now(),
  ativo              boolean not null default true,
  check (public.cmp_doc_valido(tipo, documento))
);

-- aval do Gerente, por shopping (não bloqueia: só tira o aviso)
create table if not exists public.cmp_avais (
  fornecedor_id uuid references public.cmp_fornecedores on delete cascade,
  unidade_id    uuid references public.cmp_unidades on delete cascade,
  dado_por      uuid references auth.users on delete set null,
  dado_por_nome text not null default '',
  dado_em       timestamptz not null default now(),
  primary key (fornecedor_id, unidade_id)
);

-- ---------------------------------------------------------------- requisições, propostas, aprovações
create table if not exists public.cmp_requisicoes (
  id                 bigint generated always as identity (start with 1001) primary key,
  unidade_id         uuid not null references public.cmp_unidades,
  centro_custo       text not null default '',
  grupo              text not null references public.cmp_grupos (nome) on update cascade,
  titulo             text not null check (length(trim(titulo)) > 0),
  descricao          text not null default '',
  quantidade         numeric(14,3) not null default 1 check (quantidade > 0),
  unidade_medida     text not null default 'un',
  precisa_ate        date,
  valor_estimado     numeric(14,2) check (valor_estimado >= 0),
  solicitante        uuid references auth.users on delete set null,
  solicitante_nome   text not null default '',
  status             text not null default 'nova'
                     check (status in ('nova', 'cotacao', 'aprovacao', 'aprovada', 'reprovada', 'pedido', 'entregue', 'concluida', 'cancelada')),
  proposta_escolhida bigint,
  justificativa      text not null default '',
  excecao            text not null default '',
  alcada             text check (alcada in ('automatica', 'gerente', 'diretor')),
  valor_aprovacao    numeric(14,2),
  fornecedor_novo    boolean,
  cadastrado_pelo_comprador boolean,
  enviado_por        uuid references auth.users on delete set null,
  enviado_em         timestamptz,
  pedido_em          timestamptz,
  entregue_em        timestamptz,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
create index if not exists cmp_requisicoes_unidade on public.cmp_requisicoes (unidade_id, criado_em desc);

create table if not exists public.cmp_propostas (
  id              bigint generated always as identity primary key,
  requisicao_id   bigint not null references public.cmp_requisicoes on delete cascade,
  fornecedor_id   uuid not null references public.cmp_fornecedores,
  preco_unitario  numeric(14,2) not null check (preco_unitario >= 0),
  frete           numeric(14,2) not null default 0 check (frete >= 0),
  custos_extras   numeric(14,2) not null default 0 check (custos_extras >= 0),   -- manutenção/insumos 12 meses (TCO)
  prazo_dias      int not null check (prazo_dias >= 0),
  pagamento       text not null default 'À vista',
  pagamento_dias  int not null default 0 check (pagamento_dias >= 0),
  validade        date,
  obs             text not null default '',
  rodada          int not null default 1,
  preco_anterior  numeric(14,2),
  registrada_por  uuid references auth.users on delete set null,
  registrada_em   timestamptz not null default now(),
  atualizada_em   timestamptz not null default now(),
  unique (requisicao_id, fornecedor_id)
);
alter table public.cmp_requisicoes drop constraint if exists cmp_req_escolhida_fk;
alter table public.cmp_requisicoes add constraint cmp_req_escolhida_fk
  foreign key (proposta_escolhida) references public.cmp_propostas on delete set null;

create table if not exists public.cmp_aprovacoes (
  id            bigint generated always as identity primary key,
  requisicao_id bigint not null references public.cmp_requisicoes on delete cascade,
  etapa         text not null check (etapa in ('sistema', 'gerente', 'diretor')),
  decisao       text not null check (decisao in ('aprovado', 'reprovado')),
  comentario    text not null default '',
  por           uuid references auth.users on delete set null,
  por_nome      text not null default '',
  em            timestamptz not null default now()
);

create table if not exists public.cmp_avaliacoes (
  id            bigint generated always as identity primary key,
  requisicao_id bigint not null unique references public.cmp_requisicoes on delete cascade,
  fornecedor_id uuid not null references public.cmp_fornecedores on delete cascade,
  unidade_id    uuid not null references public.cmp_unidades,
  prazo         smallint not null check (prazo between 1 and 5),
  qualidade     smallint not null check (qualidade between 1 and 5),
  conformidade  smallint not null check (conformidade between 1 and 5),
  atendimento   smallint not null check (atendimento between 1 and 5),
  comentario    text not null default '',
  avaliador     uuid references auth.users on delete set null,
  avaliador_nome text not null default '',
  em            timestamptz not null default now()
);

-- histórico legível do app (somente inclusão); o mesmo vai para public.auditoria
create table if not exists public.cmp_historico (
  id            bigint generated always as identity primary key,
  requisicao_id bigint references public.cmp_requisicoes on delete set null,
  fornecedor_id uuid references public.cmp_fornecedores on delete set null,
  unidade_id    uuid references public.cmp_unidades on delete set null,
  quem          uuid,
  quem_nome     text not null default '',
  acao          text not null,
  texto         text not null,
  detalhes      jsonb not null default '{}'::jsonb,
  em            timestamptz not null default now()
);
create index if not exists cmp_historico_req on public.cmp_historico (requisicao_id, em);

do $$ declare t text; begin
  foreach t in array array['cmp_historico', 'cmp_aprovacoes', 'cmp_avaliacoes'] loop
    execute format('drop trigger if exists %1$s_imutavel on public.%1$s', t);
    execute format('create trigger %1$s_imutavel before update or delete on public.%1$s for each row execute function public.auditoria_imutavel()', t);
    execute format('drop trigger if exists %1$s_sem_truncate on public.%1$s', t);
    execute format('create trigger %1$s_sem_truncate before truncate on public.%1$s for each statement execute function public.auditoria_imutavel()', t);
  end loop;
end $$;

create or replace function public.cmp_brl(v numeric) returns text
language sql immutable as $$
  select 'R$ ' || translate(to_char(coalesce(v, 0), 'FM999,999,999,990.00'), ',.', '.,')
$$;

-- registra no histórico do app e na auditoria da plataforma
create or replace function public.cmp_registrar(p_req bigint, p_forn uuid, p_unidade uuid, p_acao text, p_texto text, p_det jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare v_cnpj text;
begin
  insert into public.cmp_historico (requisicao_id, fornecedor_id, unidade_id, quem, quem_nome, acao, texto, detalhes)
  values (p_req, p_forn, p_unidade, auth.uid(), coalesce(public.cmp_nome_atual(), 'sistema'), p_acao, p_texto, coalesce(p_det, '{}'));
  select cnpj into v_cnpj from public.cmp_unidades where id = p_unidade;
  perform public.auditar('compras_' || p_acao, v_cnpj,
    coalesce(p_det, '{}') || jsonb_build_object('texto', p_texto, 'requisicao', p_req, 'fornecedor_id', p_forn,
      'unidade', (select nome from public.cmp_unidades where id = p_unidade)));
end $$;
revoke execute on function public.cmp_registrar(bigint, uuid, uuid, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- permissões (RLS)
alter table public.cmp_unidades enable row level security;
alter table public.cmp_membros enable row level security;
alter table public.cmp_grupos enable row level security;
alter table public.cmp_fornecedores enable row level security;
alter table public.cmp_avais enable row level security;
alter table public.cmp_requisicoes enable row level security;
alter table public.cmp_propostas enable row level security;
alter table public.cmp_aprovacoes enable row level security;
alter table public.cmp_avaliacoes enable row level security;
alter table public.cmp_historico enable row level security;

-- nada de escrita direta pela tela, exceto: criar requisição (colunas do pedido) e configuração (equipe Nervia)
revoke all on public.cmp_unidades, public.cmp_membros, public.cmp_grupos, public.cmp_fornecedores, public.cmp_avais,
  public.cmp_requisicoes, public.cmp_propostas, public.cmp_aprovacoes, public.cmp_avaliacoes, public.cmp_historico from anon;
revoke insert, update, delete on public.cmp_fornecedores, public.cmp_avais, public.cmp_requisicoes, public.cmp_propostas,
  public.cmp_aprovacoes, public.cmp_avaliacoes, public.cmp_historico from authenticated;
-- a base de fornecedores (com CPF) só é lida pela função cmp_fornecedores_lista(), que mascara o CPF
revoke select on public.cmp_fornecedores from authenticated;
grant insert (unidade_id, centro_custo, grupo, titulo, descricao, quantidade, unidade_medida, precisa_ate, valor_estimado)
  on public.cmp_requisicoes to authenticated;

drop policy if exists cmp_unidades_ler on public.cmp_unidades;
create policy cmp_unidades_ler on public.cmp_unidades for select using (public.cmp_membro(id));
drop policy if exists cmp_unidades_admin on public.cmp_unidades;
create policy cmp_unidades_admin on public.cmp_unidades for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists cmp_membros_ler on public.cmp_membros;
create policy cmp_membros_ler on public.cmp_membros for select using (user_id = auth.uid() or public.eh_admin());
drop policy if exists cmp_membros_admin on public.cmp_membros;
create policy cmp_membros_admin on public.cmp_membros for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists cmp_grupos_ler on public.cmp_grupos;
create policy cmp_grupos_ler on public.cmp_grupos for select using (public.cmp_membro_algum());
drop policy if exists cmp_grupos_admin on public.cmp_grupos;
create policy cmp_grupos_admin on public.cmp_grupos for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists cmp_avais_ler on public.cmp_avais;
create policy cmp_avais_ler on public.cmp_avais for select using (public.cmp_membro_algum());

drop policy if exists cmp_req_ler on public.cmp_requisicoes;
create policy cmp_req_ler on public.cmp_requisicoes for select using (public.cmp_membro(unidade_id));
drop policy if exists cmp_req_incluir on public.cmp_requisicoes;
create policy cmp_req_incluir on public.cmp_requisicoes for insert with check (public.cmp_membro(unidade_id));

drop policy if exists cmp_prop_ler on public.cmp_propostas;
create policy cmp_prop_ler on public.cmp_propostas for select
  using (exists (select 1 from public.cmp_requisicoes r where r.id = requisicao_id and public.cmp_membro(r.unidade_id)));
drop policy if exists cmp_aprov_ler on public.cmp_aprovacoes;
create policy cmp_aprov_ler on public.cmp_aprovacoes for select
  using (exists (select 1 from public.cmp_requisicoes r where r.id = requisicao_id and public.cmp_membro(r.unidade_id)));
drop policy if exists cmp_aval_ler on public.cmp_avaliacoes;
create policy cmp_aval_ler on public.cmp_avaliacoes for select using (public.cmp_membro_algum());
drop policy if exists cmp_hist_ler on public.cmp_historico;
create policy cmp_hist_ler on public.cmp_historico for select
  using (public.eh_admin() or (unidade_id is not null and public.cmp_membro(unidade_id)));

-- ---------------------------------------------------------------- gatilhos
-- requisição nova: autor, nome e situação vêm do servidor (a tela não escolhe status nem aprovação)
create or replace function public.cmp_req_nova() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.cmp_unidades where id = new.unidade_id and ativo) then
    raise exception 'Unidade inativa ou inexistente.';
  end if;
  new.solicitante := auth.uid();
  new.solicitante_nome := coalesce(public.cmp_nome_atual(), '');
  new.status := 'nova'; new.proposta_escolhida := null; new.justificativa := ''; new.excecao := '';
  new.alcada := null; new.valor_aprovacao := null; new.enviado_por := null; new.enviado_em := null;
  new.criado_em := now(); new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists cmp_requisicoes_nova on public.cmp_requisicoes;
create trigger cmp_requisicoes_nova before insert on public.cmp_requisicoes
  for each row execute function public.cmp_req_nova();

create or replace function public.cmp_req_criada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.cmp_registrar(new.id, null, new.unidade_id, 'requisicao_criada', 'Requisição criada: ' || new.titulo,
    jsonb_build_object('grupo', new.grupo, 'quantidade', new.quantidade, 'valor_estimado', new.valor_estimado));
  return new;
end $$;
drop trigger if exists cmp_requisicoes_criada on public.cmp_requisicoes;
create trigger cmp_requisicoes_criada after insert on public.cmp_requisicoes
  for each row execute function public.cmp_req_criada();

create or replace function public.cmp_carimbar() returns trigger
language plpgsql as $$ begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists cmp_requisicoes_carimbo on public.cmp_requisicoes;
create trigger cmp_requisicoes_carimbo before update on public.cmp_requisicoes
  for each row execute function public.cmp_carimbar();

-- membros (papéis) e configuração da unidade: auditados
create or replace function public.cmp_auditar_membros() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  perform public.cmp_registrar(null, null, r.unidade_id,
    case when tg_op = 'INSERT' then 'papel_concedido' else 'papel_retirado' end,
    format('Papel %s %s para %s', r.papel, case when tg_op = 'INSERT' then 'concedido' else 'retirado' end,
      (select email from public.perfis where user_id = r.user_id)),
    jsonb_build_object('login_id', r.user_id, 'papel', r.papel));
  return r;
end $$;
drop trigger if exists cmp_membros_auditoria on public.cmp_membros;
create trigger cmp_membros_auditoria after insert or delete on public.cmp_membros
  for each row execute function public.cmp_auditar_membros();

create or replace function public.cmp_auditar_unidades() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.minimo_propostas, new.alcada_automatica, new.alcada_gerente, new.pesos, new.ativo, new.nome)
     is not distinct from (old.minimo_propostas, old.alcada_automatica, old.alcada_gerente, old.pesos, old.ativo, old.nome) then
    return new;
  end if;
  perform public.cmp_registrar(null, null, new.id, case when tg_op = 'INSERT' then 'unidade_criada' else 'regras_alteradas' end,
    format('%s: mínimo %s propostas, automática até %s, Gerente até %s', new.nome, new.minimo_propostas, public.cmp_brl(new.alcada_automatica), public.cmp_brl(new.alcada_gerente)),
    jsonb_build_object('pesos', new.pesos, 'ativo', new.ativo));
  return new;
end $$;
drop trigger if exists cmp_unidades_auditoria on public.cmp_unidades;
create trigger cmp_unidades_auditoria after insert or update on public.cmp_unidades
  for each row execute function public.cmp_auditar_unidades();

-- ---------------------------------------------------------------- funções de leitura
-- fornecedores com nota, avais e CPF mascarado (completo só para quem cadastrou e a equipe Nervia)
create or replace function public.cmp_fornecedores_lista()
returns table (id uuid, tipo text, documento text, nome text, grupos text[], contato text, email text, telefone text,
  certidoes_validade date, obs text, cadastrado_por uuid, cadastrado_nome text, cadastrado_unidade uuid, cadastrado_em timestamptz,
  ativo boolean, nota numeric, avaliacoes int, unidades_avaliacao text[], avais jsonb, compras int)
language sql stable security definer set search_path = public as $$
  select f.id, f.tipo,
    case when f.tipo = 'PJ' or public.eh_admin() or f.cadastrado_por = auth.uid() then f.documento
         else '***' || substr(f.documento, 4, 6) || '**' end,
    f.nome, f.grupos, f.contato, f.email, f.telefone, f.certidoes_validade, f.obs, f.cadastrado_por, f.cadastrado_nome,
    f.cadastrado_unidade, f.cadastrado_em, f.ativo,
    (select round(avg((a.prazo + a.qualidade + a.conformidade + a.atendimento) / 4.0), 2) from public.cmp_avaliacoes a where a.fornecedor_id = f.id),
    (select count(*)::int from public.cmp_avaliacoes a where a.fornecedor_id = f.id),
    (select coalesce(array_agg(distinct u.nome), '{}') from public.cmp_avaliacoes a join public.cmp_unidades u on u.id = a.unidade_id where a.fornecedor_id = f.id),
    (select coalesce(jsonb_agg(jsonb_build_object('unidade_id', v.unidade_id, 'unidade', u.nome, 'por', v.dado_por_nome, 'em', v.dado_em)), '[]')
       from public.cmp_avais v join public.cmp_unidades u on u.id = v.unidade_id where v.fornecedor_id = f.id),
    (select count(*)::int from public.cmp_requisicoes r join public.cmp_propostas p on p.id = r.proposta_escolhida
      where p.fornecedor_id = f.id and r.status in ('aprovada', 'pedido', 'entregue', 'concluida'))
  from public.cmp_fornecedores f
  where public.cmp_membro_algum()
  order by f.nome
$$;

-- ---------------------------------------------------------------- funções de ação (rpc)
create or replace function public.cmp_salvar_fornecedor(p_id uuid, p_tipo text, p_documento text, p_nome text, p_grupos text[],
  p_contato text, p_email text, p_telefone text, p_certidoes date, p_obs text, p_unidade uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_doc text := upper(regexp_replace(coalesce(p_documento, ''), '[^0-9A-Za-z]', '', 'g')); v_ex record; v_id uuid; v_f record;
begin
  if p_id is null then
    if not public.cmp_tem_papel(p_unidade, array['comprador', 'gerente', 'diretor']) then
      raise exception 'Só comprador, gerente ou diretor da unidade cadastra fornecedor.';
    end if;
    if p_tipo not in ('PJ', 'PF') then raise exception 'Tipo inválido.'; end if;
    if not public.cmp_doc_valido(p_tipo, v_doc) then
      raise exception '% inválido (dígito verificador não confere). Confira o número.', case when p_tipo = 'PF' then 'CPF' else 'CNPJ' end;
    end if;
    select f.nome, f.cadastrado_nome, f.cadastrado_em into v_ex from public.cmp_fornecedores f where f.documento = v_doc;
    if found then
      raise exception 'Este % já está cadastrado: % (por % em %). Use o cadastro existente.',
        case when p_tipo = 'PF' then 'CPF' else 'CNPJ' end, v_ex.nome, v_ex.cadastrado_nome, to_char(v_ex.cadastrado_em, 'DD/MM/YYYY');
    end if;
    insert into public.cmp_fornecedores (tipo, documento, nome, grupos, contato, email, telefone, certidoes_validade, obs,
      cadastrado_por, cadastrado_nome, cadastrado_unidade)
    values (p_tipo, v_doc, trim(p_nome), coalesce(p_grupos, '{}'), coalesce(p_contato, ''), coalesce(p_email, ''), coalesce(p_telefone, ''),
      p_certidoes, coalesce(p_obs, ''), auth.uid(), coalesce(public.cmp_nome_atual(), ''), p_unidade)
    returning id into v_id;
    perform public.cmp_registrar(null, v_id, p_unidade, 'fornecedor_cadastrado',
      format('Fornecedor cadastrado: %s (%s). Responsável pela homologação: %s', trim(p_nome), p_tipo, public.cmp_nome_atual()),
      jsonb_build_object('tipo', p_tipo, 'grupos', p_grupos, 'certidoes_validade', p_certidoes));
    return v_id;
  end if;
  select * into v_f from public.cmp_fornecedores where id = p_id;
  if not found then raise exception 'Fornecedor não encontrado.'; end if;
  if not (public.eh_admin() or v_f.cadastrado_por = auth.uid()) then
    raise exception 'Só quem cadastrou o fornecedor (responsável pela homologação) ou a equipe Nervia altera o cadastro.';
  end if;
  update public.cmp_fornecedores set nome = trim(p_nome), grupos = coalesce(p_grupos, '{}'), contato = coalesce(p_contato, ''),
    email = coalesce(p_email, ''), telefone = coalesce(p_telefone, ''), certidoes_validade = p_certidoes, obs = coalesce(p_obs, '')
   where id = p_id;
  perform public.cmp_registrar(null, p_id, coalesce(p_unidade, v_f.cadastrado_unidade), 'fornecedor_alterado',
    format('Cadastro alterado: %s', trim(p_nome)),
    jsonb_build_object('certidoes_validade', p_certidoes, 'certidoes_anterior', v_f.certidoes_validade, 'grupos', p_grupos));
  return p_id;
end $$;

create or replace function public.cmp_aval(p_fornecedor uuid, p_unidade uuid, p_dar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_nome text := (select nome from public.cmp_fornecedores where id = p_fornecedor);
begin
  if v_nome is null then raise exception 'Fornecedor não encontrado.'; end if;
  if not public.cmp_tem_papel(p_unidade, array['gerente']) then raise exception 'Só o Gerente da unidade dá ou retira o aval.'; end if;
  if p_dar then
    insert into public.cmp_avais (fornecedor_id, unidade_id, dado_por, dado_por_nome)
    values (p_fornecedor, p_unidade, auth.uid(), coalesce(public.cmp_nome_atual(), '')) on conflict do nothing;
    if found then perform public.cmp_registrar(null, p_fornecedor, p_unidade, 'aval_dado', 'Aval do Gerente dado a ' || v_nome); end if;
  else
    delete from public.cmp_avais where fornecedor_id = p_fornecedor and unidade_id = p_unidade;
    if found then perform public.cmp_registrar(null, p_fornecedor, p_unidade, 'aval_retirado', 'Aval do Gerente retirado de ' || v_nome); end if;
  end if;
end $$;

-- carrega a requisição travada e confere o papel
create or replace function public.cmp_req_para(p_req bigint, p_papeis text[], p_status text[])
returns public.cmp_requisicoes language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes;
begin
  select * into r from public.cmp_requisicoes where id = p_req for update;
  if not found or not public.cmp_membro(r.unidade_id) then raise exception 'Requisição não encontrada.'; end if;
  if not public.cmp_tem_papel(r.unidade_id, p_papeis) then
    raise exception 'Seu papel nesta unidade não permite esta ação (precisa ser: %).', array_to_string(p_papeis, ' ou ');
  end if;
  if not (r.status = any (p_status)) then raise exception 'A requisição #% está "%" e não permite esta ação agora.', r.id, r.status; end if;
  return r;
end $$;
revoke execute on function public.cmp_req_para(bigint, text[], text[]) from public, anon, authenticated;

create or replace function public.cmp_salvar_proposta(p_req bigint, p_fornecedor uuid, p_preco numeric, p_frete numeric, p_extras numeric,
  p_prazo int, p_pagamento text, p_pagamento_dias int, p_validade date, p_obs text)
returns bigint language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; f record; v_ant record; v_id bigint; v_total numeric;
begin
  r := public.cmp_req_para(p_req, array['comprador'], array['nova', 'cotacao']);
  select * into f from public.cmp_fornecedores where id = p_fornecedor;
  if not found or not f.ativo then raise exception 'Fornecedor não encontrado ou inativo.'; end if;
  if f.certidoes_validade is not null and f.certidoes_validade < current_date then
    raise exception 'As certidões de % venceram em %. Atualize o cadastro antes de registrar a proposta.', f.nome, to_char(f.certidoes_validade, 'DD/MM/YYYY');
  end if;
  if p_preco is null or p_preco < 0 or p_prazo is null or p_prazo < 0 then raise exception 'Preço e prazo são obrigatórios.'; end if;
  v_total := round(p_preco * r.quantidade + coalesce(p_frete, 0), 2);
  select * into v_ant from public.cmp_propostas where requisicao_id = p_req and fornecedor_id = p_fornecedor;
  if found then
    update public.cmp_propostas set preco_unitario = p_preco, frete = coalesce(p_frete, 0), custos_extras = coalesce(p_extras, 0),
      prazo_dias = p_prazo, pagamento = coalesce(p_pagamento, 'À vista'), pagamento_dias = coalesce(p_pagamento_dias, 0),
      validade = p_validade, obs = coalesce(p_obs, ''), atualizada_em = now(),
      rodada = case when p_preco <> v_ant.preco_unitario then v_ant.rodada + 1 else v_ant.rodada end,
      preco_anterior = case when p_preco <> v_ant.preco_unitario then v_ant.preco_unitario else v_ant.preco_anterior end
     where id = v_ant.id returning id into v_id;
    perform public.cmp_registrar(p_req, p_fornecedor, r.unidade_id, 'proposta_alterada',
      format('Proposta de %s alterada: %s → %s', f.nome,
        public.cmp_brl(round(v_ant.preco_unitario * r.quantidade + v_ant.frete, 2)), public.cmp_brl(v_total)),
      jsonb_build_object('preco_unitario', p_preco, 'preco_anterior', v_ant.preco_unitario, 'prazo_dias', p_prazo));
  else
    insert into public.cmp_propostas (requisicao_id, fornecedor_id, preco_unitario, frete, custos_extras, prazo_dias, pagamento,
      pagamento_dias, validade, obs, registrada_por)
    values (p_req, p_fornecedor, p_preco, coalesce(p_frete, 0), coalesce(p_extras, 0), p_prazo, coalesce(p_pagamento, 'À vista'),
      coalesce(p_pagamento_dias, 0), p_validade, coalesce(p_obs, ''), auth.uid())
    returning id into v_id;
    perform public.cmp_registrar(p_req, p_fornecedor, r.unidade_id, 'proposta_registrada',
      format('Proposta de %s registrada: total %s, prazo %s dias, %s', f.nome, public.cmp_brl(v_total), p_prazo, coalesce(p_pagamento, 'À vista')),
      jsonb_build_object('preco_unitario', p_preco, 'frete', p_frete, 'custos_extras', p_extras, 'prazo_dias', p_prazo));
  end if;
  -- qualquer mudança nas propostas desfaz a escolha (o mapa mudou)
  update public.cmp_requisicoes set status = 'cotacao',
    proposta_escolhida = null, justificativa = case when proposta_escolhida is null then justificativa else '' end
   where id = p_req;
  if r.proposta_escolhida is not null then
    perform public.cmp_registrar(p_req, null, r.unidade_id, 'escolha_desfeita', 'Escolha desfeita porque as propostas mudaram.');
  end if;
  return v_id;
end $$;

create or replace function public.cmp_excluir_proposta(p_proposta bigint)
returns void language plpgsql security definer set search_path = public as $$
declare p record; r public.cmp_requisicoes;
begin
  select pr.*, f.nome as fnome into p from public.cmp_propostas pr join public.cmp_fornecedores f on f.id = pr.fornecedor_id where pr.id = p_proposta;
  if not found then raise exception 'Proposta não encontrada.'; end if;
  r := public.cmp_req_para(p.requisicao_id, array['comprador'], array['nova', 'cotacao']);
  update public.cmp_requisicoes set proposta_escolhida = null, justificativa = '' where id = r.id and proposta_escolhida = p_proposta;
  delete from public.cmp_propostas where id = p_proposta;
  perform public.cmp_registrar(r.id, p.fornecedor_id, r.unidade_id, 'proposta_excluida', 'Proposta de ' || p.fnome || ' excluída.');
end $$;

create or replace function public.cmp_escolher(p_req bigint, p_proposta bigint, p_justificativa text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; v_total numeric; v_min numeric; v_nome text;
begin
  r := public.cmp_req_para(p_req, array['comprador'], array['cotacao']);
  select round(p.preco_unitario * r.quantidade + p.frete, 2), f.nome into v_total, v_nome
    from public.cmp_propostas p join public.cmp_fornecedores f on f.id = p.fornecedor_id where p.id = p_proposta and p.requisicao_id = p_req;
  if v_total is null then raise exception 'Proposta não pertence a esta requisição.'; end if;
  select min(round(preco_unitario * r.quantidade + frete, 2)) into v_min from public.cmp_propostas where requisicao_id = p_req;
  if v_total > v_min and length(trim(coalesce(p_justificativa, ''))) < 10 then
    raise exception 'Escolhido não é o menor preço: escreva a justificativa (mínimo 10 caracteres).';
  end if;
  update public.cmp_requisicoes set proposta_escolhida = p_proposta,
    justificativa = case when v_total > v_min then trim(p_justificativa) else '' end where id = p_req;
  perform public.cmp_registrar(p_req, null, r.unidade_id, 'fornecedor_escolhido',
    format('Escolheu %s (%s)%s', v_nome, case when v_total > v_min then 'não é o menor preço' else 'menor preço' end,
      case when v_total > v_min then ' — justificativa: ' || trim(p_justificativa) else '' end),
    jsonb_build_object('proposta', p_proposta, 'total', v_total, 'menor_total', v_min));
end $$;

create or replace function public.cmp_excecao(p_req bigint, p_texto text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes;
begin
  r := public.cmp_req_para(p_req, array['comprador'], array['nova', 'cotacao']);
  if length(trim(coalesce(p_texto, ''))) < 15 then raise exception 'Explique a exclusividade (mínimo 15 caracteres).'; end if;
  update public.cmp_requisicoes set excecao = trim(p_texto) where id = p_req;
  perform public.cmp_registrar(p_req, null, r.unidade_id, 'excecao_registrada', 'Exceção de exclusividade: ' || trim(p_texto));
end $$;

create or replace function public.cmp_enviar_aprovacao(p_req bigint)
returns text language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; u public.cmp_unidades; p record; f public.cmp_fornecedores; v_qtd int; v_min numeric;
  v_total numeric; v_menor boolean; v_novo boolean; v_comp boolean; v_alcada text;
begin
  r := public.cmp_req_para(p_req, array['comprador'], array['cotacao']);
  select * into u from public.cmp_unidades where id = r.unidade_id;
  if r.proposta_escolhida is null then raise exception 'Escolha o fornecedor antes de enviar.'; end if;
  select count(*), min(round(preco_unitario * r.quantidade + frete, 2)) into v_qtd, v_min from public.cmp_propostas where requisicao_id = p_req;
  if v_qtd < u.minimo_propostas and r.excecao = '' then
    raise exception 'Só % proposta(s): o mínimo é %. Registre mais propostas ou a exceção de exclusividade.', v_qtd, u.minimo_propostas;
  end if;
  select * into p from public.cmp_propostas where id = r.proposta_escolhida;
  select * into f from public.cmp_fornecedores where id = p.fornecedor_id;
  if f.certidoes_validade is not null and f.certidoes_validade < current_date then
    raise exception 'As certidões de % estão vencidas. Atualize o cadastro antes de enviar.', f.nome;
  end if;
  v_total := round(p.preco_unitario * r.quantidade + p.frete, 2);
  v_menor := v_total <= v_min;
  v_novo := not exists (select 1 from public.cmp_requisicoes x join public.cmp_propostas y on y.id = x.proposta_escolhida
    where y.fornecedor_id = f.id and x.id <> p_req and x.status in ('aprovada', 'pedido', 'entregue', 'concluida'));
  v_comp := f.cadastrado_por = auth.uid();
  v_alcada := case when v_total <= u.alcada_automatica and v_menor and not v_novo then 'automatica'
                   when v_total <= u.alcada_gerente then 'gerente' else 'diretor' end;
  update public.cmp_requisicoes set alcada = v_alcada, valor_aprovacao = v_total, fornecedor_novo = v_novo,
    cadastrado_pelo_comprador = v_comp, enviado_por = auth.uid(), enviado_em = now(),
    status = case when v_alcada = 'automatica' then 'aprovada' else 'aprovacao' end
   where id = p_req;
  perform public.cmp_registrar(p_req, f.id, r.unidade_id, 'enviada_aprovacao',
    format('Enviada para aprovação: %s, %s. Alçada: %s%s%s', f.nome, public.cmp_brl(v_total),
      case v_alcada when 'automatica' then 'automática' when 'gerente' then 'Gerente' else 'Gerente e Diretor' end,
      case when v_novo then '. Primeira compra com este fornecedor' else '' end,
      case when v_comp then '. Fornecedor cadastrado por quem está comprando' else '' end),
    jsonb_build_object('total', v_total, 'menor', v_menor, 'fornecedor_novo', v_novo, 'cadastrado_pelo_comprador', v_comp, 'alcada', v_alcada,
      'propostas', v_qtd, 'excecao', r.excecao));
  if v_alcada = 'automatica' then
    insert into public.cmp_aprovacoes (requisicao_id, etapa, decisao, comentario, por_nome)
    values (p_req, 'sistema', 'aprovado', format('Até %s, menor preço e fornecedor com compras anteriores.', public.cmp_brl(u.alcada_automatica)), 'Sistema');
    perform public.cmp_registrar(p_req, null, r.unidade_id, 'aprovacao_automatica', 'Aprovação automática (até a alçada, menor preço).');
  end if;
  return v_alcada;
end $$;

create or replace function public.cmp_decidir(p_req bigint, p_aprovar boolean, p_comentario text, p_dar_aval boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; v_ger boolean; v_etapa text; v_forn uuid; v_novo text;
begin
  select * into r from public.cmp_requisicoes where id = p_req for update;
  if not found or not public.cmp_membro(r.unidade_id) then raise exception 'Requisição não encontrada.'; end if;
  if r.status <> 'aprovacao' then raise exception 'A requisição #% não está aguardando aprovação.', p_req; end if;
  v_ger := exists (select 1 from public.cmp_aprovacoes where requisicao_id = p_req and etapa = 'gerente' and decisao = 'aprovado');
  v_etapa := case when not v_ger then 'gerente' else 'diretor' end;
  if not public.cmp_tem_papel(r.unidade_id, array[v_etapa]) then
    raise exception 'Esta etapa é do %.', case v_etapa when 'gerente' then 'Gerente' else 'Diretor' end;
  end if;
  if r.enviado_por = auth.uid() and not public.eh_admin() then
    raise exception 'Quem enviou a compra para aprovação não pode aprová-la.';
  end if;
  if not p_aprovar and length(trim(coalesce(p_comentario, ''))) < 5 then raise exception 'Para reprovar, escreva o motivo.'; end if;
  insert into public.cmp_aprovacoes (requisicao_id, etapa, decisao, comentario, por, por_nome)
  values (p_req, v_etapa, case when p_aprovar then 'aprovado' else 'reprovado' end, trim(coalesce(p_comentario, '')), auth.uid(), coalesce(public.cmp_nome_atual(), ''));
  select fornecedor_id into v_forn from public.cmp_propostas where id = r.proposta_escolhida;
  if not p_aprovar then
    update public.cmp_requisicoes set status = 'reprovada' where id = p_req;
    perform public.cmp_registrar(p_req, v_forn, r.unidade_id, 'reprovada', format('Reprovada pelo %s: %s', initcap(v_etapa), trim(p_comentario)));
    return 'reprovada';
  end if;
  if p_dar_aval and v_etapa = 'gerente' then perform public.cmp_aval(v_forn, r.unidade_id, true); end if;
  v_novo := case when v_etapa = 'gerente' and r.alcada = 'diretor' then 'aprovacao' else 'aprovada' end;
  update public.cmp_requisicoes set status = v_novo where id = p_req;
  perform public.cmp_registrar(p_req, v_forn, r.unidade_id, 'aprovada_' || v_etapa,
    format('Aprovada pelo %s%s%s', initcap(v_etapa), case when coalesce(trim(p_comentario), '') <> '' then ': ' || trim(p_comentario) else '' end,
      case when v_novo = 'aprovacao' then '. Segue para o Diretor.' else '' end));
  return v_novo;
end $$;

create or replace function public.cmp_emitir_pedido(p_req bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes;
begin
  r := public.cmp_req_para(p_req, array['comprador'], array['aprovada']);
  update public.cmp_requisicoes set status = 'pedido', pedido_em = now() where id = p_req;
  perform public.cmp_registrar(p_req, (select fornecedor_id from public.cmp_propostas where id = r.proposta_escolhida), r.unidade_id,
    'pedido_emitido', format('Pedido de compra PC-%s emitido.', p_req));
end $$;

create or replace function public.cmp_marcar_entregue(p_req bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes;
begin
  r := public.cmp_req_para(p_req, array['comprador', 'solicitante'], array['pedido']);
  update public.cmp_requisicoes set status = 'entregue', entregue_em = now() where id = p_req;
  perform public.cmp_registrar(p_req, (select fornecedor_id from public.cmp_propostas where id = r.proposta_escolhida), r.unidade_id,
    'entregue', 'Pedido entregue. Avaliação do fornecedor pendente para o Gerente.');
end $$;

create or replace function public.cmp_avaliar(p_req bigint, p_prazo int, p_qualidade int, p_conformidade int, p_atendimento int, p_comentario text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; v_forn uuid; v_nome text;
begin
  r := public.cmp_req_para(p_req, array['gerente'], array['entregue']);
  select p.fornecedor_id, f.nome into v_forn, v_nome from public.cmp_propostas p join public.cmp_fornecedores f on f.id = p.fornecedor_id
   where p.id = r.proposta_escolhida;
  insert into public.cmp_avaliacoes (requisicao_id, fornecedor_id, unidade_id, prazo, qualidade, conformidade, atendimento, comentario, avaliador, avaliador_nome)
  values (p_req, v_forn, r.unidade_id, p_prazo, p_qualidade, p_conformidade, p_atendimento, trim(coalesce(p_comentario, '')), auth.uid(), coalesce(public.cmp_nome_atual(), ''));
  update public.cmp_requisicoes set status = 'concluida' where id = p_req;
  perform public.cmp_registrar(p_req, v_forn, r.unidade_id, 'fornecedor_avaliado',
    format('%s avaliado: prazo %s, qualidade %s, conforme a proposta %s, atendimento %s%s', v_nome, p_prazo, p_qualidade, p_conformidade, p_atendimento,
      case when coalesce(trim(p_comentario), '') <> '' then ' — ' || trim(p_comentario) else '' end));
end $$;

create or replace function public.cmp_cancelar(p_req bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes;
begin
  select * into r from public.cmp_requisicoes where id = p_req for update;
  if not found or not public.cmp_membro(r.unidade_id) then raise exception 'Requisição não encontrada.'; end if;
  if r.status not in ('nova', 'cotacao', 'reprovada') then raise exception 'Só dá para cancelar antes da aprovação (ou depois de reprovada).'; end if;
  if not (r.solicitante = auth.uid() or public.cmp_tem_papel(r.unidade_id, array['comprador', 'gerente', 'diretor'])) then
    raise exception 'Só quem pediu, o comprador ou o gerente cancela.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escreva o motivo do cancelamento.'; end if;
  update public.cmp_requisicoes set status = 'cancelada' where id = p_req;
  perform public.cmp_registrar(p_req, null, r.unidade_id, 'cancelada', 'Cancelada: ' || trim(p_motivo));
end $$;

-- volta uma reprovada para cotação (o comprador ajusta e reenvia)
create or replace function public.cmp_reabrir(p_req bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes;
begin
  r := public.cmp_req_para(p_req, array['comprador'], array['reprovada']);
  update public.cmp_requisicoes set status = 'cotacao', alcada = null, valor_aprovacao = null, enviado_por = null, enviado_em = null where id = p_req;
  perform public.cmp_registrar(p_req, null, r.unidade_id, 'reaberta', 'Reaberta para nova cotação após reprovação.');
end $$;

revoke execute on function public.cmp_salvar_fornecedor(uuid, text, text, text, text[], text, text, text, date, text, uuid),
  public.cmp_aval(uuid, uuid, boolean), public.cmp_salvar_proposta(bigint, uuid, numeric, numeric, numeric, int, text, int, date, text),
  public.cmp_excluir_proposta(bigint), public.cmp_escolher(bigint, bigint, text), public.cmp_excecao(bigint, text),
  public.cmp_enviar_aprovacao(bigint), public.cmp_decidir(bigint, boolean, text, boolean), public.cmp_emitir_pedido(bigint),
  public.cmp_marcar_entregue(bigint), public.cmp_avaliar(bigint, int, int, int, int, text), public.cmp_cancelar(bigint, text),
  public.cmp_reabrir(bigint), public.cmp_fornecedores_lista() from public, anon;

-- ---------------------------------------------------------------- cadastro do app na Área do Cliente
insert into public.apps (id, nome, descricao, url, icone, ordem, cartao_url, manual_url)
values ('compras', 'Orçamentos de Compras',
        'Requisições, 3 orçamentos, mapa comparativo, alçadas de aprovação e avaliação de fornecedores.',
        '/apps/compras/', 'OC', 40, '/apps/compras/ajuda/cartao.html', '/apps/compras/ajuda/manual.html')
on conflict (id) do update set nome = excluded.nome, descricao = excluded.descricao, url = excluded.url,
  cartao_url = excluded.cartao_url, manual_url = excluded.manual_url;
