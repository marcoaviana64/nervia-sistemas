-- Buscador de NF (prefixo nf_) — projeto nervia-sistemas
-- Admin (equipe Nervia, perfis.admin) gerencia empresas e certificados; clientes só leem as notas dos CNPJs liberados.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ------------------------------------------------------------------ tabelas

create table public.nf_empresas (
  cnpj              text primary key check (cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  nome              text not null,
  uf                char(2) not null default 'RJ',
  ativo             boolean not null default true,
  busca_automatica  boolean not null default true,
  cert_secret_id    uuid,
  cert_titular      text,
  cert_cnpj         text,
  cert_validade     timestamptz,
  ult_nsu_nfe       bigint not null default 0,
  max_nsu_nfe       bigint not null default 0,
  bloqueio_nfe      timestamptz,
  ultima_sinc_nfe   timestamptz,
  ult_nsu_nfse      bigint not null default 0,
  ultima_sinc_nfse  timestamptz,
  trava_ate         timestamptz,          -- evita duas buscas simultâneas do mesmo CNPJ
  criado_em         timestamptz not null default now()
);

create table public.nf_acessos (
  user_id uuid references auth.users on delete cascade,
  cnpj    text references public.nf_empresas on delete cascade,
  primary key (user_id, cnpj)
);

create table public.nf_notas (
  id             bigint generated always as identity primary key,
  cnpj_consulta  text not null references public.nf_empresas,
  tipo           text not null check (tipo in ('NFE', 'NFSE')),
  chave          text not null,
  nsu            bigint,
  numero         text,
  emit_cnpj      text,
  emit_nome      text,
  dest_cnpj      text,
  dest_nome      text,
  data_emissao   timestamptz,
  valor          numeric(15, 2),
  situacao       text not null default 'Autorizada',
  papel          text not null default 'recebida',
  completo       boolean not null default false,
  manifestada    boolean not null default false,
  xml_path       text,
  atualizado     timestamptz not null default now(),
  unique (cnpj_consulta, tipo, chave)
);
create index nf_notas_busca on public.nf_notas (cnpj_consulta, tipo, data_emissao desc);

create table public.nf_log (
  id       bigint generated always as identity primary key,
  cnpj     text,
  quando   timestamptz not null default now(),
  origem   text,
  mensagem text
);
create index nf_log_cnpj on public.nf_log (cnpj, id desc);

-- ------------------------------------------------------------------ helpers de permissão

create or replace function public.nf_pode_ver(p_cnpj text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin()
      or exists (select 1 from nf_acessos where user_id = auth.uid() and cnpj = p_cnpj)
$$;

-- ------------------------------------------------------------------ RLS
alter table public.nf_empresas enable row level security;
alter table public.nf_acessos  enable row level security;
alter table public.nf_notas    enable row level security;
alter table public.nf_log      enable row level security;

create policy nf_empresas_ler on public.nf_empresas for select using (public.nf_pode_ver(cnpj));
create policy nf_empresas_incluir on public.nf_empresas for insert with check (public.eh_admin());
create policy nf_empresas_alterar on public.nf_empresas for update using (public.eh_admin()) with check (public.eh_admin());

create policy nf_acessos_ler on public.nf_acessos for select using (user_id = auth.uid() or public.eh_admin());
create policy nf_acessos_incluir on public.nf_acessos for insert with check (public.eh_admin());
create policy nf_acessos_excluir on public.nf_acessos for delete using (public.eh_admin());

create policy nf_notas_ler on public.nf_notas for select using (public.nf_pode_ver(cnpj_consulta));
create policy nf_log_ler on public.nf_log for select using (public.nf_pode_ver(cnpj));

-- O admin pela tela só mexe nos campos de cadastro; NSU, bloqueios e certificado são das funções.
revoke insert, update on public.nf_empresas from anon, authenticated;
grant insert (cnpj, nome, uf, ativo, busca_automatica) on public.nf_empresas to authenticated;
grant update (nome, uf, ativo, busca_automatica) on public.nf_empresas to authenticated;

-- ------------------------------------------------------------------ gravação de notas (só service_role)
-- Um resumo nunca sobrescreve um XML completo; uma nota cancelada continua cancelada.
create or replace function public.nf_gravar_nota(
  p_cnpj text, p_tipo text, p_dados jsonb, p_nsu bigint, p_xml_path text
) returns text language plpgsql security definer set search_path = public as $$
declare
  atual nf_notas%rowtype;
  v_completo boolean := coalesce((p_dados ->> 'completo')::boolean, false);
  v_papel text := case when p_dados ->> 'emit_cnpj' = p_cnpj then 'emitida' else 'recebida' end;
  v_data timestamptz := nullif(p_dados ->> 'data_emissao', '')::timestamptz;
  v_valor numeric := nullif(p_dados ->> 'valor', '')::numeric;
begin
  select * into atual from nf_notas
   where cnpj_consulta = p_cnpj and tipo = p_tipo and chave = p_dados ->> 'chave' for update;
  if not found then
    insert into nf_notas (cnpj_consulta, tipo, chave, nsu, numero, emit_cnpj, emit_nome, dest_cnpj, dest_nome,
                       data_emissao, valor, situacao, papel, completo, xml_path)
    values (p_cnpj, p_tipo, p_dados ->> 'chave', p_nsu, nullif(p_dados ->> 'numero', ''), p_dados ->> 'emit_cnpj',
            p_dados ->> 'emit_nome', nullif(p_dados ->> 'dest_cnpj', ''), nullif(p_dados ->> 'dest_nome', ''),
            v_data, v_valor, coalesce(p_dados ->> 'situacao', 'Autorizada'), v_papel, v_completo, p_xml_path);
    return 'nova';
  end if;
  if atual.completo and not v_completo then
    return 'ignorada';
  end if;
  update nf_notas set
    nsu = p_nsu,
    numero = coalesce(nullif(p_dados ->> 'numero', ''), numero),
    emit_cnpj = p_dados ->> 'emit_cnpj',
    emit_nome = p_dados ->> 'emit_nome',
    dest_cnpj = coalesce(nullif(p_dados ->> 'dest_cnpj', ''), dest_cnpj),
    dest_nome = coalesce(nullif(p_dados ->> 'dest_nome', ''), dest_nome),
    data_emissao = coalesce(v_data, data_emissao),
    valor = coalesce(v_valor, valor),
    situacao = case when atual.situacao = 'Cancelada' then 'Cancelada'
                    else coalesce(p_dados ->> 'situacao', 'Autorizada') end,
    papel = v_papel,
    completo = atual.completo or v_completo,
    xml_path = coalesce(p_xml_path, xml_path),
    atualizado = now()
  where id = atual.id;
  return 'atualizada';
end $$;

-- trava por CNPJ (cron e botão "Buscar" não rodam juntos)
create or replace function public.nf_travar_empresa(p_cnpj text, p_minutos int default 5) returns boolean
language sql security definer set search_path = public as $$
  with t as (
    update nf_empresas set trava_ate = now() + make_interval(mins => p_minutos)
     where cnpj = p_cnpj and (trava_ate is null or trava_ate < now())
    returning 1)
  select exists (select 1 from t)
$$;
create or replace function public.nf_liberar_empresa(p_cnpj text) returns void
language sql security definer set search_path = public as $$
  update nf_empresas set trava_ate = null where cnpj = p_cnpj
$$;

-- ------------------------------------------------------------------ certificados no Vault (só service_role)
-- Guarda {cert_pem, key_pem} criptografado; a senha do .pfx não é guardada.
create or replace function public.nf_salvar_certificado(
  p_cnpj text, p_conteudo text, p_titular text, p_cert_cnpj text, p_validade timestamptz
) returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  select cert_secret_id into v_id from nf_empresas where cnpj = p_cnpj;
  if v_id is null then
    v_id := vault.create_secret(p_conteudo, 'buscador_cert_' || p_cnpj, 'Certificado A1 do CNPJ ' || p_cnpj);
  else
    perform vault.update_secret(v_id, p_conteudo);
  end if;
  update nf_empresas set cert_secret_id = v_id, cert_titular = p_titular, cert_cnpj = p_cert_cnpj,
                      cert_validade = p_validade
   where cnpj = p_cnpj;
end $$;

create or replace function public.nf_ler_certificado(p_cnpj text) returns text
language sql stable security definer set search_path = public, vault as $$
  select s.decrypted_secret from vault.decrypted_secrets s
    join nf_empresas e on e.cert_secret_id = s.id
   where e.cnpj = p_cnpj
$$;

revoke all on function public.nf_gravar_nota(text, text, jsonb, bigint, text) from public, anon, authenticated;
revoke all on function public.nf_salvar_certificado(text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.nf_ler_certificado(text) from public, anon, authenticated;
revoke all on function public.nf_travar_empresa(text, int) from public, anon, authenticated;
revoke all on function public.nf_liberar_empresa(text) from public, anon, authenticated;
grant execute on function public.nf_travar_empresa(text, int) to service_role;
grant execute on function public.nf_liberar_empresa(text) to service_role;
grant execute on function public.nf_gravar_nota(text, text, jsonb, bigint, text) to service_role;
grant execute on function public.nf_salvar_certificado(text, text, text, text, timestamptz) to service_role;
grant execute on function public.nf_ler_certificado(text) to service_role;

-- ------------------------------------------------------------------ XMLs no Storage (bucket privado)
insert into storage.buckets (id, name, public) values ('nf-xml', 'nf-xml', false) on conflict (id) do nothing;

create policy nf_xml_ler on storage.objects for select to authenticated
  using (bucket_id = 'nf-xml' and public.nf_pode_ver(split_part(name, '/', 1)));

-- registra o app na Área do Cliente
insert into public.apps (id, nome, descricao, url, icone, ordem)
values ('notas', 'Notas Fiscais', 'NF-e e NFS-e emitidas contra os seus CNPJs, com XML e exportação para Excel.', '/apps/notas/', 'NF', 10)
on conflict (id) do nothing;
