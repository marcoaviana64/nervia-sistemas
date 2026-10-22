-- App "Sistema Linum" (app linum, prefixo lin_), pedido do Marco em 22/10/2026: levar para a Plataforma o sistema da
-- LINUM Roupas de Linho feito no Lovable (repositório linum-produtos, banco Supabase próprio "linum-produtos").
-- Decisões do Marco (22/10/2026): app SÓ da Linum (não é o "Controle de Produtos" genérico), começando SÓ pelo Estoque,
-- sem trazer os dados agora (a carga dos 233 produtos / 1.037 variações vem depois, mantendo os mesmos ids).
--
-- Mesmas regras do sistema atual (funções move_stock, transfer_stock e set_stock do banco linum-produtos):
--   * cada variação (cor + tamanho + edição) de um produto tem quantidade própria por loja (Gávea, Ipanema);
--   * Dono: consulta e registra Entrada, Saída, Transferência entre lojas e Ajuste (nova quantidade), com data e
--     observação; tudo vira movimentação (histórico); estoque nunca fica negativo;
--   * Vendedora: só consulta, sem preço de custo (no sistema antigo a tabela products, com o custo, era legível por
--     qualquer login pela API; aqui a vendedora só lê pela lin_estoque_ler, que não devolve custo);
--   * quem é Dono/Vendedora: lin_membros (login × papel × loja), definido pela equipe Nervia; o login é criado na
--     Área do Cliente e precisa ter o app "linum" liberado. Equipe Nervia (admin) = Dono.

create table if not exists public.lin_lojas (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null unique check (length(trim(nome)) > 0),
  ordem     int not null default 0,
  criado_em timestamptz not null default now()
);
insert into public.lin_lojas (nome, ordem) values ('Gávea', 10), ('Ipanema', 20) on conflict (nome) do nothing;

create table if not exists public.lin_membros (
  user_id       uuid primary key references auth.users on delete cascade,
  papel         text not null check (papel in ('dono', 'vendedora')),
  loja_id       uuid references public.lin_lojas on delete set null,   -- loja da vendedora (vendas, mais adiante)
  atualizado_em timestamptz not null default now()
);

-- catálogo: mesmas colunas do products / product_variants do sistema atual (para a carga manter tudo)
create table if not exists public.lin_produtos (
  id             uuid primary key default gen_random_uuid(),
  referencia     text not null unique,
  descricao      text not null,
  categoria      text,
  colecao        text,
  fornecedor     text,
  tecido         text,
  preco_custo    numeric check (preco_custo is null or preco_custo >= 0),
  preco_venda    numeric not null default 0,
  consumo_metros numeric check (consumo_metros is null or consumo_metros >= 0),
  codigo_barras  text,
  foto_path      text,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create table if not exists public.lin_variantes (
  id             uuid primary key default gen_random_uuid(),
  produto_id     uuid not null references public.lin_produtos on delete cascade,
  cor            text not null,
  tamanho        text not null,
  edicao         text not null default '',
  codigo_barras  text,
  preco_venda    numeric check (preco_venda is null or preco_venda >= 0),   -- vazio = preço do produto
  preco_custo    numeric check (preco_custo is null or preco_custo >= 0),
  consumo_metros numeric check (consumo_metros is null or consumo_metros >= 0),
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  unique (produto_id, cor, tamanho, edicao)
);

create table if not exists public.lin_estoque (
  variante_id   uuid not null references public.lin_variantes on delete cascade,
  loja_id       uuid not null references public.lin_lojas on delete cascade,
  quantidade    int not null default 0 check (quantidade >= 0),
  atualizado_em timestamptz not null default now(),
  primary key (variante_id, loja_id)
);

-- histórico (SOMENTE INCLUSÃO): toda mudança de quantidade passa por aqui
create table if not exists public.lin_movimentos (
  id              bigint generated always as identity primary key,
  variante_id     uuid not null references public.lin_variantes on delete cascade,
  loja_id         uuid not null references public.lin_lojas,
  loja_destino_id uuid references public.lin_lojas,
  tipo            text not null check (tipo in ('entrada', 'saida', 'transferencia', 'ajuste', 'venda')),
  quantidade      int not null check (quantidade > 0),
  antes           int,             -- ajuste: quantidade antes e depois
  depois          int,
  data            date not null default current_date,
  observacao      text not null default '',
  criado_por      uuid references auth.users on delete set null,
  criado_nome     text not null default '',
  criado_em       timestamptz not null default now()
);
create index if not exists lin_movimentos_variante on public.lin_movimentos (variante_id, criado_em desc);

create or replace function public.lin_movimentos_imutavel() returns trigger
language plpgsql as $$
begin
  -- a exclusão em cascata (produto/variante apagados) continua possível; editar não
  if tg_op = 'UPDATE' then raise exception 'O histórico de movimentações não pode ser alterado'; end if;
  return old;
end $$;
drop trigger if exists lin_movimentos_imutavel on public.lin_movimentos;
create trigger lin_movimentos_imutavel before update on public.lin_movimentos
  for each row execute function public.lin_movimentos_imutavel();

-- ---------------------------------------------------------------- permissões
-- papel do login: admin Nervia = dono; senão o de lin_membros, desde que o app esteja liberado na Área do Cliente
create or replace function public.lin_papel() returns text
language sql stable security definer set search_path = public as $$
  select case when public.eh_admin() then 'dono'
    else (select m.papel from public.lin_membros m
          where m.user_id = auth.uid()
            and exists (select 1 from public.app_acessos a where a.user_id = m.user_id and a.app_id = 'linum')) end
$$;
create or replace function public.lin_eh_dono() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.lin_papel() = 'dono', false) $$;

alter table public.lin_lojas      enable row level security;
alter table public.lin_membros    enable row level security;
alter table public.lin_produtos   enable row level security;
alter table public.lin_variantes  enable row level security;
alter table public.lin_estoque    enable row level security;
alter table public.lin_movimentos enable row level security;

-- leitura direta só do Dono (o catálogo tem preço de custo); a vendedora lê pela lin_estoque_ler.
-- escrita: só pelas funções abaixo (sem policy de insert/update/delete para a tela)
create policy lin_lojas_ler      on public.lin_lojas      for select using (public.lin_papel() is not null);
create policy lin_membros_ler    on public.lin_membros    for select using (user_id = auth.uid() or public.eh_admin());
create policy lin_produtos_ler   on public.lin_produtos   for select using (public.lin_eh_dono());
create policy lin_variantes_ler  on public.lin_variantes  for select using (public.lin_eh_dono());
create policy lin_estoque_ler    on public.lin_estoque    for select using (public.lin_eh_dono());
create policy lin_movimentos_ler on public.lin_movimentos for select using (public.lin_eh_dono());

-- ---------------------------------------------------------------- leitura do estoque (Dono e Vendedora)
-- tudo de uma vez: lojas, produtos ativos com as variações ativas (sem custo) e as quantidades
create or replace function public.lin_estoque_ler() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_papel text := public.lin_papel();
begin
  if v_papel is null then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  return jsonb_build_object(
    'papel', v_papel,
    'lojas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome) order by ordem, nome) from public.lin_lojas), '[]'),
    'produtos', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'referencia', p.referencia, 'descricao', p.descricao,
               'categoria', p.categoria, 'preco_venda', p.preco_venda,
               'variantes', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'cor', v.cor, 'tamanho', v.tamanho,
                                        'edicao', v.edicao, 'preco_venda', v.preco_venda))
                                      from public.lin_variantes v where v.produto_id = p.id and v.ativo), '[]'))
             order by p.descricao, p.referencia)
      from public.lin_produtos p where p.ativo), '[]'),
    'estoque', coalesce((select jsonb_agg(jsonb_build_array(e.variante_id, e.loja_id, e.quantidade))
                         from public.lin_estoque e join public.lin_variantes v on v.id = e.variante_id
                         where e.quantidade <> 0 and v.ativo), '[]'));
end $$;
revoke execute on function public.lin_estoque_ler() from public, anon;
grant execute on function public.lin_estoque_ler() to authenticated;

-- ---------------------------------------------------------------- movimentações (só Dono)
create or replace function public._lin_nome() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(nome), ''), email, '') from public.perfis where user_id = auth.uid()
$$;

create or replace function public.lin_movimentar(p_variante uuid, p_loja uuid, p_tipo text, p_quantidade int,
                                                  p_data date default null, p_observacao text default '')
returns int language plpgsql security definer set search_path = public as $$
declare v_disp int; v_nova int;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono pode movimentar o estoque'; end if;
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
  return v_nova;
end $$;

create or replace function public.lin_transferir(p_variante uuid, p_origem uuid, p_destino uuid, p_quantidade int,
                                                  p_data date default null, p_observacao text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_disp int;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono pode transferir'; end if;
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
end $$;

create or replace function public.lin_ajustar(p_variante uuid, p_loja uuid, p_quantidade int,
                                               p_data date default null, p_observacao text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_atual int;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono pode ajustar o estoque'; end if;
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
end $$;

revoke execute on function public.lin_movimentar(uuid, uuid, text, int, date, text) from public, anon;
revoke execute on function public.lin_transferir(uuid, uuid, uuid, int, date, text) from public, anon;
revoke execute on function public.lin_ajustar(uuid, uuid, int, date, text) from public, anon;
grant execute on function public.lin_movimentar(uuid, uuid, text, int, date, text) to authenticated;
grant execute on function public.lin_transferir(uuid, uuid, uuid, int, date, text) to authenticated;
grant execute on function public.lin_ajustar(uuid, uuid, int, date, text) to authenticated;

-- ---------------------------------------------------------------- equipe (só a Nervia define o papel)
-- logins com o app liberado e o papel de cada um
create or replace function public.lin_equipe() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia define a equipe da Linum'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'email', p.email, 'nome', p.nome,
             'papel', m.papel, 'loja_id', m.loja_id) order by coalesce(nullif(p.nome, ''), p.email))
    from public.perfis p join public.app_acessos a on a.user_id = p.user_id and a.app_id = 'linum'
    left join public.lin_membros m on m.user_id = p.user_id), '[]');
end $$;

create or replace function public.lin_membro_salvar(p_user uuid, p_papel text, p_loja uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia define a equipe da Linum'; end if;
  if p_papel is null or p_papel = '' then
    delete from public.lin_membros where user_id = p_user;
    return;
  end if;
  if p_papel not in ('dono', 'vendedora') then raise exception 'Papel inválido'; end if;
  if not exists (select 1 from public.app_acessos where user_id = p_user and app_id = 'linum') then
    raise exception 'Libere o app Sistema Linum para este login na Área do Cliente (Administração → Logins) antes';
  end if;
  if p_papel = 'vendedora' and p_loja is null then raise exception 'Escolha a loja da vendedora'; end if;
  insert into public.lin_membros (user_id, papel, loja_id) values (p_user, p_papel, p_loja)
  on conflict (user_id) do update set papel = excluded.papel, loja_id = excluded.loja_id, atualizado_em = now();
end $$;
revoke execute on function public.lin_equipe() from public, anon;
revoke execute on function public.lin_membro_salvar(uuid, text, uuid) from public, anon;
grant execute on function public.lin_equipe() to authenticated;
grant execute on function public.lin_membro_salvar(uuid, text, uuid) to authenticated;

-- auditoria: quem recebe/perde papel na Linum
create or replace function public.lin_membros_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  perform public.auditar(case when tg_op = 'DELETE' then 'linum_papel_retirado' else 'linum_papel_definido' end, null,
    jsonb_build_object('login', (select email from public.perfis where user_id = r.user_id), 'login_id', r.user_id,
      'papel', case when tg_op = 'DELETE' then null else new.papel end,
      'papel_antes', case when tg_op = 'INSERT' then null else old.papel end,
      'loja', (select nome from public.lin_lojas where id = case when tg_op = 'DELETE' then null else new.loja_id end)));
  return r;
end $$;
drop trigger if exists lin_membros_auditoria on public.lin_membros;
create trigger lin_membros_auditoria after insert or update or delete on public.lin_membros
  for each row execute function public.lin_membros_auditoria();

-- ---------------------------------------------------------------- cadastro do app (fica fora da vitrine: só da Linum)
insert into public.apps (id, nome, descricao, url, icone, ordem, cartao_url, manual_url, situacao)
values ('linum', 'Sistema Linum', 'Estoque das lojas Gávea e Ipanema por produto, cor e tamanho.',
        '/apps/linum/', 'LI', 80, '/apps/linum/ajuda/cartao.html', '/apps/linum/ajuda/manual.html', 'oculto')
on conflict (id) do nothing;
