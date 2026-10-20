-- Vitrine da Área do Cliente (pedido do Marco, 17/10/2026).
-- Quem entra vê, abaixo dos seus apps, os apps da Nervia que ainda não tem, em três seções:
--   disponivel          "Conheça outros apps da Nervia"  (Ver demonstração + Quero conhecer pelo WhatsApp)
--   em_breve            "Em breve"                        (Ver demonstração)
--   em_desenvolvimento  "Em desenvolvimento"              (só nome e descrição)
--   oculto              não aparece na vitrine (padrão)
-- Em cada cartão, uma reação por pessoa por app (Curti, Não curti com "O que faltou?" opcional, Tenho interesse),
-- que pode ser trocada ou retirada. Os números e os comentários só a equipe Nervia vê.
-- Só sai da tabela apps o que é público: nome, descrição, ícone, situação e o link da demonstração.

alter table public.apps
  add column if not exists situacao text not null default 'oculto'
    check (situacao in ('disponivel', 'em_breve', 'em_desenvolvimento', 'oculto')),
  add column if not exists demo_url text not null default '';

-- empresa de cada login, para a Nervia saber quem se interessou (preenchida em Administração → Logins)
alter table public.perfis add column if not exists empresa text not null default '';
grant update (empresa) on public.perfis to authenticated;   -- a policy perfis_admin já limita ao admin

-- situação inicial: os apps com demonstração pública ficam na vitrine; o Monitor fica oculto (demo ainda não pública)
update public.apps set situacao = 'disponivel', demo_url = '/demo/'          where id in ('notas', 'painel-nf');
update public.apps set situacao = 'disponivel', demo_url = '/demo/telefonia/' where id = 'telefonia';
update public.apps set situacao = 'disponivel', demo_url = '/demo/compras/'   where id = 'compras';

-- Controle de Produtos: só protótipo (demo pública), ainda sem app real → "Em breve", inativo
insert into public.apps (id, nome, descricao, url, icone, ordem, ativo, situacao, demo_url)
values ('produtos', 'Controle de Produtos', 'Vendas, estoque, entregas, contas a receber e caixa de uma revenda ou loja.', '', 'CP', 60, false, 'em_breve', '/demo/produtos/')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- reações
create table if not exists public.app_reacoes (
  user_id       uuid not null references auth.users on delete cascade,
  app_id        text not null references public.apps on delete cascade on update cascade,
  reacao        text not null check (reacao in ('curti', 'nao_curti', 'interesse')),
  comentario    text not null default '' check (length(comentario) <= 500),   -- "O que faltou?" (só em nao_curti)
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (user_id, app_id)
);
alter table public.app_reacoes enable row level security;
-- cada um lê só a própria reação; a equipe Nervia lê todas. Gravação só pela função app_reagir.
create policy app_reacoes_ler on public.app_reacoes for select using (user_id = auth.uid() or public.eh_admin());
revoke insert, update, delete on public.app_reacoes from anon, authenticated;

-- cliques em "Ver demonstração" e "Quero conhecer"
create table if not exists public.app_cliques (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  app_id  text not null references public.apps on delete cascade on update cascade,
  acao    text not null check (acao in ('demo', 'quero_conhecer')),
  em      timestamptz not null default now()
);
create index if not exists app_cliques_app on public.app_cliques (app_id, em);
alter table public.app_cliques enable row level security;
create policy app_cliques_ler on public.app_cliques for select using (public.eh_admin());
revoke insert, update, delete on public.app_cliques from anon, authenticated;

-- ---------------------------------------------------------------- o que o login vê na vitrine
-- Todo app fora de "oculto" que NÃO está na grade do login (grade = ativo e liberado; admin = todos os ativos).
-- O link da demonstração só vai para disponível e em breve.
create or replace function public.apps_vitrine()
returns table (id text, nome text, descricao text, icone text, situacao text, demo_url text, ordem int, reacao text, comentario text)
language sql stable security definer set search_path = public as $$
  select a.id, a.nome, a.descricao, a.icone, a.situacao,
         case when a.situacao in ('disponivel', 'em_breve') then a.demo_url else '' end,
         a.ordem, r.reacao, coalesce(r.comentario, '')
  from public.apps a
  left join public.app_reacoes r on r.app_id = a.id and r.user_id = auth.uid()
  where auth.uid() is not null
    and a.situacao <> 'oculto'
    and not (a.ativo and (public.eh_admin()
             or exists (select 1 from public.app_acessos x where x.app_id = a.id and x.user_id = auth.uid())))
  order by case a.situacao when 'disponivel' then 1 when 'em_breve' then 2 else 3 end, a.ordem, a.nome
$$;
revoke execute on function public.apps_vitrine() from public, anon;
grant execute on function public.apps_vitrine() to authenticated;

-- Reagir: p_reacao = 'curti' | 'nao_curti' | 'interesse'; vazio/nulo retira a reação.
create or replace function public.app_reagir(p_app text, p_reacao text, p_comentario text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_com text := left(btrim(coalesce(p_comentario, '')), 500);
begin
  if v_uid is null then raise exception 'Entre na Área do Cliente para reagir.'; end if;
  if not exists (select 1 from public.apps_vitrine() v where v.id = p_app) then
    raise exception 'Aplicativo não está na vitrine.';
  end if;
  if coalesce(p_reacao, '') = '' then
    delete from public.app_reacoes where user_id = v_uid and app_id = p_app;
    return;
  end if;
  if p_reacao not in ('curti', 'nao_curti', 'interesse') then raise exception 'Reação inválida.'; end if;
  if p_reacao <> 'nao_curti' then v_com := ''; end if;
  insert into public.app_reacoes (user_id, app_id, reacao, comentario)
  values (v_uid, p_app, p_reacao, v_com)
  on conflict (user_id, app_id) do update
    set reacao = excluded.reacao, comentario = excluded.comentario, atualizado_em = now();
end $$;
revoke execute on function public.app_reagir(text, text, text) from public, anon;
grant execute on function public.app_reagir(text, text, text) to authenticated;

-- Registrar clique (o mesmo clique repetido em menos de 1 minuto conta uma vez)
create or replace function public.app_registrar_clique(p_app text, p_acao text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if p_acao not in ('demo', 'quero_conhecer') then raise exception 'Ação inválida.'; end if;
  if not exists (select 1 from public.apps_vitrine() v where v.id = p_app) then
    raise exception 'Aplicativo não está na vitrine.';
  end if;
  if exists (select 1 from public.app_cliques where user_id = v_uid and app_id = p_app and acao = p_acao and em > now() - interval '1 minute') then
    return;
  end if;
  insert into public.app_cliques (user_id, app_id, acao) values (v_uid, p_app, p_acao);
end $$;
revoke execute on function public.app_registrar_clique(text, text) from public, anon;
grant execute on function public.app_registrar_clique(text, text) to authenticated;

-- ---------------------------------------------------------------- tela "Interesse nos apps" (só equipe Nervia)
-- Uma linha por login × app com reação ou clique. Empresa = perfis.empresa; se vazia, as empresas
-- que o login vê no Buscador (nf_acessos) ou as unidades do Orçamentos de Compras (cmp_membros).
create or replace function public.apps_interesse()
returns table (app_id text, user_id uuid, nome text, email text, empresa text, reacao text, comentario text,
               reagiu_em timestamptz, cliques_demo int, cliques_conhecer int, ultimo_clique timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia vê o interesse nos apps.'; end if;
  return query
  with pares as (
    select r.user_id, r.app_id from public.app_reacoes r
    union
    select c.user_id, c.app_id from public.app_cliques c
  )
  select p.app_id, p.user_id, coalesce(pf.nome, ''), coalesce(pf.email, ''),
         coalesce(nullif(pf.empresa, ''),
                  (select string_agg(distinct e.nome, ', ') from public.nf_acessos x join public.nf_empresas e on e.cnpj = x.cnpj where x.user_id = p.user_id),
                  (select string_agg(distinct u.nome, ', ') from public.cmp_membros m join public.cmp_unidades u on u.id = m.unidade_id where m.user_id = p.user_id),
                  ''),
         r.reacao, coalesce(r.comentario, ''), r.atualizado_em,
         (select count(*)::int from public.app_cliques c where c.user_id = p.user_id and c.app_id = p.app_id and c.acao = 'demo'),
         (select count(*)::int from public.app_cliques c where c.user_id = p.user_id and c.app_id = p.app_id and c.acao = 'quero_conhecer'),
         (select max(c.em) from public.app_cliques c where c.user_id = p.user_id and c.app_id = p.app_id)
  from pares p
  left join public.perfis pf on pf.user_id = p.user_id
  left join public.app_reacoes r on r.user_id = p.user_id and r.app_id = p.app_id
  order by greatest(r.atualizado_em, (select max(c.em) from public.app_cliques c where c.user_id = p.user_id and c.app_id = p.app_id)) desc nulls last;
end $$;
revoke execute on function public.apps_interesse() from public, anon;
grant execute on function public.apps_interesse() to authenticated;
