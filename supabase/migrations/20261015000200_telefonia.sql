-- App "Auditoria de Telefonia Móvel" (prefixo tel_): relatório de consumo das linhas móveis de um cliente,
-- montado pela Nervia a partir das exportações do portal da operadora (Claro Empresas).
-- Cobrança por relatório gerado (sem mensalidade): o relatório é fixo e só muda quando a Nervia carrega
-- exportações novas enviadas pelo cliente.
--
-- Quem vê: a equipe Nervia (admin) vê e altera tudo; o cliente só LÊ os relatórios publicados que foram
-- liberados para o login dele (tel_acessos). Os dados ficam no banco, nunca em arquivo público do site.

create table if not exists public.tel_relatorios (
  id            uuid primary key default gen_random_uuid(),
  titulo        text not null check (length(trim(titulo)) > 0),   -- nome curto do cliente, ex.: "Power"
  empresa       text not null default '',                          -- razão social
  cnpj          text,                                              -- opcional (liga o registro de auditoria à empresa)
  cliente_num   text not null default '',                          -- nº do cliente na operadora
  conta         text not null default '',
  operadora     text not null default 'Claro Empresas',
  perfil        text not null default '',
  linhas        jsonb not null default '[]'::jsonb,                -- [{n, dono, sub, plano, fr, iccid, add[]}]
  dados         jsonb,                                             -- consumo já calculado (processar.js)
  fontes        text not null default '',
  notas         jsonb not null default '[]'::jsonb,
  publicado     boolean not null default false,                    -- só aparece para o cliente depois de publicado
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  dados_em      timestamptz                                        -- quando os dados foram carregados pela última vez
);

create table if not exists public.tel_acessos (
  user_id      uuid references auth.users on delete cascade,
  relatorio_id uuid references public.tel_relatorios on delete cascade,
  primary key (user_id, relatorio_id)
);

-- Exportações originais do portal da operadora, guardadas para recalcular o relatório quando chegam
-- arquivos novos (o cliente manda só o período novo; o histórico vem dos arquivos já guardados).
-- Só a equipe Nervia lê e grava.
create table if not exists public.tel_arquivos (
  id           bigint generated always as identity primary key,
  relatorio_id uuid not null references public.tel_relatorios on delete cascade,
  nome         text not null,
  tipo         text not null check (tipo in ('dados', 'chamadas', 'assinante')),
  conteudo     text not null,
  enviado_em   timestamptz not null default now(),
  unique (relatorio_id, nome)
);
alter table public.tel_arquivos enable row level security;
drop policy if exists tel_arquivos_admin on public.tel_arquivos;
create policy tel_arquivos_admin on public.tel_arquivos for all using (public.eh_admin()) with check (public.eh_admin());

alter table public.tel_relatorios enable row level security;
alter table public.tel_acessos enable row level security;

create or replace function public.tel_pode_ver(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or exists (
    select 1 from public.tel_relatorios r join public.tel_acessos a on a.relatorio_id = r.id
     where r.id = p_id and r.publicado and a.user_id = auth.uid())
$$;

drop policy if exists tel_relatorios_ler on public.tel_relatorios;
create policy tel_relatorios_ler on public.tel_relatorios for select using (public.tel_pode_ver(id));
drop policy if exists tel_relatorios_incluir on public.tel_relatorios;
create policy tel_relatorios_incluir on public.tel_relatorios for insert with check (public.eh_admin());
drop policy if exists tel_relatorios_alterar on public.tel_relatorios;
create policy tel_relatorios_alterar on public.tel_relatorios for update using (public.eh_admin()) with check (public.eh_admin());
drop policy if exists tel_relatorios_excluir on public.tel_relatorios;
create policy tel_relatorios_excluir on public.tel_relatorios for delete using (public.eh_admin());

drop policy if exists tel_acessos_ler on public.tel_acessos;
create policy tel_acessos_ler on public.tel_acessos for select using (user_id = auth.uid() or public.eh_admin());
drop policy if exists tel_acessos_incluir on public.tel_acessos;
create policy tel_acessos_incluir on public.tel_acessos for insert with check (public.eh_admin());
drop policy if exists tel_acessos_excluir on public.tel_acessos;
create policy tel_acessos_excluir on public.tel_acessos for delete using (public.eh_admin());

-- data de alteração sempre pelo relógio do servidor
create or replace function public.tel_carimbar() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := now();
  if tg_op = 'INSERT' or new.dados is distinct from old.dados then new.dados_em := case when new.dados is null then null else now() end; end if;
  return new;
end $$;
drop trigger if exists tel_relatorios_carimbo on public.tel_relatorios;
create trigger tel_relatorios_carimbo before insert or update on public.tel_relatorios
  for each row execute function public.tel_carimbar();

-- ---------------------------------------------------------------- auditoria (somente inclusão)
create or replace function public.auditar_tel_relatorios() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record := coalesce(new, old);
  v_det jsonb := jsonb_build_object('relatorio', r.titulo, 'relatorio_id', r.id);
begin
  if tg_op = 'INSERT' then
    perform public.auditar('telefonia_relatorio_criado', r.cnpj, v_det || jsonb_build_object('periodo', concat(r.dados ->> 'inicio', ' a ', r.dados ->> 'fim')));
  elsif tg_op = 'DELETE' then
    perform public.auditar('telefonia_relatorio_excluido', r.cnpj, v_det);
  else
    if new.dados is distinct from old.dados then
      perform public.auditar('telefonia_dados_atualizados', r.cnpj, v_det || jsonb_build_object(
        'periodo', concat(new.dados ->> 'inicio', ' a ', new.dados ->> 'fim'),
        'periodo_anterior', concat(old.dados ->> 'inicio', ' a ', old.dados ->> 'fim')));
    end if;
    if new.publicado is distinct from old.publicado then
      perform public.auditar(case when new.publicado then 'telefonia_relatorio_publicado' else 'telefonia_relatorio_retirado' end, r.cnpj, v_det);
    end if;
    if new.linhas is distinct from old.linhas or new.titulo is distinct from old.titulo or new.empresa is distinct from old.empresa then
      perform public.auditar('telefonia_cadastro_alterado', r.cnpj, v_det);
    end if;
  end if;
  return r;
end $$;
drop trigger if exists auditoria_tel_relatorios on public.tel_relatorios;
create trigger auditoria_tel_relatorios after insert or update or delete on public.tel_relatorios
  for each row execute function public.auditar_tel_relatorios();

create or replace function public.auditar_tel_acessos() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old); v_rel record;
begin
  select titulo, cnpj into v_rel from public.tel_relatorios where id = r.relatorio_id;
  perform public.auditar(case when tg_op = 'INSERT' then 'telefonia_acesso_liberado' else 'telefonia_acesso_retirado' end,
    v_rel.cnpj, jsonb_build_object('relatorio', v_rel.titulo, 'relatorio_id', r.relatorio_id,
      'login', (select email from public.perfis where user_id = r.user_id), 'login_id', r.user_id));
  return r;
end $$;
drop trigger if exists auditoria_tel_acessos on public.tel_acessos;
create trigger auditoria_tel_acessos after insert or delete on public.tel_acessos
  for each row execute function public.auditar_tel_acessos();

create or replace function public.auditar_tel_arquivos() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old); v_rel record;
begin
  select titulo, cnpj into v_rel from public.tel_relatorios where id = r.relatorio_id;
  perform public.auditar(case when tg_op = 'INSERT' then 'telefonia_arquivo_incluido' else 'telefonia_arquivo_excluido' end,
    v_rel.cnpj, jsonb_build_object('relatorio', v_rel.titulo, 'relatorio_id', r.relatorio_id, 'arquivo', r.nome, 'tipo', r.tipo,
      'tamanho', length(r.conteudo)));
  return r;
end $$;
drop trigger if exists auditoria_tel_arquivos on public.tel_arquivos;
create trigger auditoria_tel_arquivos after insert or delete on public.tel_arquivos
  for each row execute function public.auditar_tel_arquivos();

-- ---------------------------------------------------------------- cadastro do app na Área do Cliente
insert into public.apps (id, nome, descricao, url, icone, ordem, cartao_url, manual_url)
values ('telefonia', 'Auditoria de Telefonia Móvel',
        'Consumo, franquias e economia de cada linha móvel da empresa.',
        '/apps/telefonia/', 'TM', 30,
        '/apps/telefonia/ajuda/cartao.html', '/apps/telefonia/ajuda/manual.html')
on conflict (id) do nothing;
