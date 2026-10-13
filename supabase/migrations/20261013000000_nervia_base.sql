-- Base comum dos sistemas Nervia (projeto nervia-sistemas)
-- Um login por pessoa, valendo para todos os sistemas. perfis.admin = equipe Nervia.
-- Cada sistema tem as próprias tabelas com prefixo (nf_ = Buscador de NF) e a própria tabela de acessos.

create table public.perfis (
  user_id   uuid primary key references auth.users on delete cascade,
  email     text,
  nome      text not null default '',
  admin     boolean not null default false,
  criado_em timestamptz not null default now()
);

create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select admin from perfis where user_id = auth.uid()), false)
$$;

-- perfil criado automaticamente para todo usuário novo
create or replace function public.novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfis (user_id, email, nome)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'nome', ''))
  on conflict do nothing;
  return new;
end $$;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.novo_usuario();

alter table public.perfis enable row level security;
create policy perfis_ler on public.perfis for select using (user_id = auth.uid() or public.eh_admin());
create policy perfis_admin on public.perfis for update using (public.eh_admin()) with check (public.eh_admin());

-- pela tela, o admin só altera nome e admin; o restante é do Supabase Auth
revoke update on public.perfis from authenticated;
grant update (nome, admin) on public.perfis to authenticated;

-- ------------------------------------------------------------------ aplicativos da Área do Cliente
-- Cada app que a Nervia oferece. url relativa (/apps/notas/) = mesmo site; absoluta = app externo.
create table public.apps (
  id         text primary key check (id ~ '^[a-z0-9-]+$'),
  nome       text not null,
  descricao  text not null default '',
  url        text not null,
  icone      text not null default '',      -- 1 a 2 letras ou emoji para o cartão
  ordem      int  not null default 0,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- quais apps cada login vê na Área do Cliente (admins veem todos)
create table public.app_acessos (
  user_id uuid references auth.users on delete cascade,
  app_id  text references public.apps on delete cascade on update cascade,
  primary key (user_id, app_id)
);

alter table public.apps enable row level security;
alter table public.app_acessos enable row level security;

create policy apps_ler on public.apps for select using (
  public.eh_admin()
  or (ativo and exists (select 1 from public.app_acessos a where a.app_id = apps.id and a.user_id = auth.uid())));
create policy apps_incluir on public.apps for insert with check (public.eh_admin());
create policy apps_alterar on public.apps for update using (public.eh_admin()) with check (public.eh_admin());
create policy apps_excluir on public.apps for delete using (public.eh_admin());

create policy app_acessos_ler on public.app_acessos for select using (user_id = auth.uid() or public.eh_admin());
create policy app_acessos_incluir on public.app_acessos for insert with check (public.eh_admin());
create policy app_acessos_excluir on public.app_acessos for delete using (public.eh_admin());
