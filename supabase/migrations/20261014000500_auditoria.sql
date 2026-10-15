-- Registro de auditoria das ações sensíveis da Plataforma Nervia (pedido do Marco, 2026-10-14).
-- Serve de documento comprobatório: quem fez, quando (relógio do servidor), de onde e o quê.
-- SOMENTE INCLUSÃO: nenhuma alteração ou exclusão é aceita, nem pelo admin, nem pelas funções.
--
-- Quem grava:
--   - as Edge Functions (service_role), com IP e navegador: manifestação (ciência/confirmação, com o
--     protocolo da SEFAZ e os XMLs enviados/recebidos), certificado, logins e senhas;
--   - gatilhos nas tabelas que a tela altera direto: acessos a empresas e apps, termo, NF-e ligada/
--     desligada, busca automática, empresa ativa, perfil admin. O autor vem de auth.uid() (o login que
--     fez a mudança); mudanças feitas pelas funções aparecem como "sistema".

create table if not exists public.auditoria (
  id          bigint generated always as identity primary key,
  quando      timestamptz not null default now(),
  user_id     uuid,
  email       text,
  nome        text,
  papel       text not null check (papel in ('admin', 'cliente', 'sistema')),
  acao        text not null,
  cnpj        text,
  detalhes    jsonb not null default '{}'::jsonb,
  ip          text,
  navegador   text
);
create index if not exists auditoria_cnpj_quando on public.auditoria (cnpj, quando desc);
create index if not exists auditoria_quando on public.auditoria (quando desc);

alter table public.auditoria enable row level security;
-- Leitura: equipe Nervia vê tudo; cliente vê os registros das empresas que pode ver.
create policy auditoria_ler on public.auditoria for select
  using (public.eh_admin() or (cnpj is not null and public.nf_pode_ver(cnpj)));
-- Nenhuma permissão de escrita para usuários da tela: só as funções e os gatilhos (security definer).
revoke insert, update, delete on public.auditoria from anon, authenticated;

-- Imutável: bloqueia UPDATE/DELETE/TRUNCATE para todos (inclusive service_role).
create or replace function public.auditoria_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'O registro de auditoria é somente inclusão: não pode ser alterado nem apagado.';
end $$;
drop trigger if exists auditoria_sem_alteracao on public.auditoria;
create trigger auditoria_sem_alteracao before update or delete on public.auditoria
  for each row execute function public.auditoria_imutavel();
drop trigger if exists auditoria_sem_truncate on public.auditoria;
create trigger auditoria_sem_truncate before truncate on public.auditoria
  for each statement execute function public.auditoria_imutavel();

-- Grava um registro com o autor da requisição atual (auth.uid()); sem usuário = "sistema".
create or replace function public.auditar(p_acao text, p_cnpj text, p_detalhes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text; v_nome text; v_admin boolean;
begin
  if v_uid is not null then
    select email, nome, admin into v_email, v_nome, v_admin from public.perfis where user_id = v_uid;
  end if;
  insert into public.auditoria (user_id, email, nome, papel, acao, cnpj, detalhes)
  values (v_uid, v_email, v_nome,
          case when v_uid is null then 'sistema' when coalesce(v_admin, false) then 'admin' else 'cliente' end,
          p_acao, p_cnpj, coalesce(p_detalhes, '{}'::jsonb));
end $$;
revoke execute on function public.auditar(text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- gatilhos
create or replace function public.auditar_nf_acessos() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  perform public.auditar(case when tg_op = 'INSERT' then 'acesso_empresa_liberado' else 'acesso_empresa_retirado' end,
    r.cnpj, jsonb_build_object('login', (select email from public.perfis where user_id = r.user_id), 'login_id', r.user_id));
  return r;
end $$;
drop trigger if exists auditoria_nf_acessos on public.nf_acessos;
create trigger auditoria_nf_acessos after insert or delete on public.nf_acessos
  for each row execute function public.auditar_nf_acessos();

create or replace function public.auditar_app_acessos() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  perform public.auditar(case when tg_op = 'INSERT' then 'acesso_app_liberado' else 'acesso_app_retirado' end,
    null, jsonb_build_object('login', (select email from public.perfis where user_id = r.user_id), 'login_id', r.user_id, 'app', r.app_id));
  return r;
end $$;
drop trigger if exists auditoria_app_acessos on public.app_acessos;
create trigger auditoria_app_acessos after insert or delete on public.app_acessos
  for each row execute function public.auditar_app_acessos();

create or replace function public.auditar_nf_empresas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.auditar('empresa_cadastrada', new.cnpj, jsonb_build_object('nome', new.nome, 'uf', new.uf));
    return new;
  end if;
  if new.termo_status is distinct from old.termo_status or new.termo_assinado_em is distinct from old.termo_assinado_em
     or new.termo_signatario is distinct from old.termo_signatario then
    perform public.auditar('termo_registrado', new.cnpj, jsonb_build_object(
      'situacao', new.termo_status, 'situacao_anterior', old.termo_status,
      'assinado_em', new.termo_assinado_em, 'signatario', new.termo_signatario, 'obs', new.termo_obs));
  end if;
  if new.nfe_ativa is distinct from old.nfe_ativa then
    perform public.auditar(case when new.nfe_ativa then 'nfe_ligada' else 'nfe_desligada' end, new.cnpj,
      jsonb_build_object('motivo', new.nfe_pausa_motivo));
  end if;
  if new.busca_automatica is distinct from old.busca_automatica then
    perform public.auditar(case when new.busca_automatica then 'busca_automatica_ligada' else 'busca_automatica_desligada' end, new.cnpj, '{}');
  end if;
  if new.ativo is distinct from old.ativo then
    perform public.auditar(case when new.ativo then 'empresa_reativada' else 'empresa_desativada' end, new.cnpj, '{}');
  end if;
  if new.nome is distinct from old.nome or new.uf is distinct from old.uf then
    perform public.auditar('empresa_alterada', new.cnpj, jsonb_build_object('nome', new.nome, 'nome_anterior', old.nome, 'uf', new.uf, 'uf_anterior', old.uf));
  end if;
  return new;
end $$;
drop trigger if exists auditoria_nf_empresas on public.nf_empresas;
create trigger auditoria_nf_empresas after insert or update on public.nf_empresas
  for each row execute function public.auditar_nf_empresas();

create or replace function public.auditar_perfis() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.admin is distinct from old.admin then
    perform public.auditar(case when new.admin then 'admin_concedido' else 'admin_retirado' end, null,
      jsonb_build_object('login', new.email, 'login_id', new.user_id));
  end if;
  return new;
end $$;
drop trigger if exists auditoria_perfis on public.perfis;
create trigger auditoria_perfis after update on public.perfis
  for each row execute function public.auditar_perfis();
