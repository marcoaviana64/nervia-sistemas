-- App "Contas e Licenças Microsoft 365" (app licencas, prefixo lic_), pedido do Marco em 21/10/2026.
-- Leva para a Plataforma o painel "Contas e Licenças - Shoppings" (antes um script Python local):
--   * a Nervia carrega na tela o CSV de TODAS as contas do tenant (Microsoft 365 Admin Center > Usuários > Exportar);
--     o NAVEGADOR filtra as contas das unidades cadastradas (domínio no login ou nos endereços de proxy) e manda
--     só essas, com poucos campos: as contas de outras empresas do tenant, telefones e endereços não saem do computador;
--   * cada carga é uma "foto" datada (lic_cargas + lic_contas); as mudanças (conta nova, removida, bloqueada,
--     licença trocada) são a comparação de uma carga com a anterior;
--   * a fatura de cada mês (licenças compradas por unidade e valor) fica em lic_faturas e mostra licenças pagas
--     sem uso (ociosas) e as que faltam;
--   * quem vê: cada login liberado por unidade (lic_acessos), inclusive a parte de valores (decisão do Marco);
--   * escrita só pelas funções da equipe Nervia (lic_carregar, lic_salvar_fatura...), com auditoria.

create table if not exists public.lic_unidades (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null unique check (length(trim(nome)) > 0),
  dominio   text not null unique check (dominio ~ '^[a-z0-9.-]{3,}$'),   -- trecho que identifica a unidade no login ou no proxy
  apelidos  text[] not null default '{}',                                -- como a unidade aparece na coluna "local" da fatura
  ordem     int not null default 0,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists public.lic_acessos (
  user_id    uuid references auth.users on delete cascade,
  unidade_id uuid references public.lic_unidades on delete cascade,
  primary key (user_id, unidade_id)
);

create table if not exists public.lic_cargas (
  id             bigint generated always as identity primary key,
  exportado_em   date not null unique,                 -- dia da exportação no Admin Center
  arquivo        text not null default '',
  linhas_arquivo int not null default 0,               -- contas no arquivo inteiro (todas as empresas do tenant)
  contas         int not null default 0,               -- contas das unidades, gravadas
  carregado_por  uuid references auth.users on delete set null,
  carregado_nome text not null default '',
  carregado_em   timestamptz not null default now()
);

create table if not exists public.lic_contas (
  carga_id      bigint not null references public.lic_cargas on delete cascade,
  unidade_id    uuid not null references public.lic_unidades on delete cascade,
  login         text not null check (length(login) between 3 and 320),
  nome          text not null default '',
  cargo         text not null default '',
  departamento  text not null default '',
  bloqueada     boolean not null default false,
  compartilhada boolean not null default false,
  licencas      text[] not null default '{}',         -- pagas
  gratuitas     text[] not null default '{}',         -- Free / Trial (não entram na conta de licenças)
  criada_em     timestamptz,
  primary key (carga_id, login)
);
create index if not exists lic_contas_unidade on public.lic_contas (unidade_id, carga_id);

create table if not exists public.lic_faturas (
  id             bigint generated always as identity primary key,
  unidade_id     uuid not null references public.lic_unidades on delete cascade,
  mes            date not null check (extract(day from mes) = 1),
  produto        text not null check (length(trim(produto)) > 0),
  quantidade     int not null check (quantidade >= 0),
  valor_unitario numeric(12,2) not null default 0 check (valor_unitario >= 0),
  carregado_por  uuid references auth.users on delete set null,
  carregado_nome text not null default '',
  carregado_em   timestamptz not null default now(),
  unique (unidade_id, mes, produto)
);

-- unidades iniciais (domínios do painel antigo)
insert into public.lic_unidades (nome, dominio, apelidos, ordem) values
  ('Itaboraí Plaza', 'itaboraiplaza', '{itaborai,itaboraiplaza}', 10),
  ('Multicenter Itaipu', 'multicenteritaipu', '{multicenter,multicenteritaipu}', 20),
  ('Rio2 Pom', 'rio2pom', '{rio2,rio2pom}', 30),
  ('Shopping Park Lagos', 'parklagos', '{parklagos,lagos,shoppingparklagos}', 40),
  ('Shopping Park Sul', 'parksul', '{parksul,sul,shoppingparksul}', 50),
  ('Taquara Plaza', 'taquaraplaza', '{taquara,taquaraplaza}', 60),
  ('Vogue', 'vogue', '{vogue,voguesquare}', 70)
on conflict do nothing;

-- ---------------------------------------------------------------- permissões
create or replace function public.lic_pode_ver(p_unidade uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or exists (select 1 from public.lic_acessos where unidade_id = p_unidade and user_id = auth.uid())
$$;
create or replace function public.lic_algum() returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or exists (select 1 from public.lic_acessos where user_id = auth.uid())
$$;

alter table public.lic_unidades enable row level security;
alter table public.lic_acessos enable row level security;
alter table public.lic_cargas enable row level security;
alter table public.lic_contas enable row level security;
alter table public.lic_faturas enable row level security;
revoke all on public.lic_unidades, public.lic_acessos, public.lic_cargas, public.lic_contas, public.lic_faturas from anon;
revoke insert, update, delete on public.lic_cargas, public.lic_contas, public.lic_faturas from authenticated;

drop policy if exists lic_unidades_ler on public.lic_unidades;
create policy lic_unidades_ler on public.lic_unidades for select using (public.lic_pode_ver(id));
drop policy if exists lic_unidades_admin on public.lic_unidades;
create policy lic_unidades_admin on public.lic_unidades for all using (public.eh_admin()) with check (public.eh_admin());
drop policy if exists lic_acessos_ler on public.lic_acessos;
create policy lic_acessos_ler on public.lic_acessos for select using (user_id = auth.uid() or public.eh_admin());
drop policy if exists lic_acessos_admin on public.lic_acessos;
create policy lic_acessos_admin on public.lic_acessos for all using (public.eh_admin()) with check (public.eh_admin());
drop policy if exists lic_cargas_ler on public.lic_cargas;
create policy lic_cargas_ler on public.lic_cargas for select using (public.lic_algum());
drop policy if exists lic_contas_ler on public.lic_contas;
create policy lic_contas_ler on public.lic_contas for select using (public.lic_pode_ver(unidade_id));
drop policy if exists lic_faturas_ler on public.lic_faturas;
create policy lic_faturas_ler on public.lic_faturas for select using (public.lic_pode_ver(unidade_id));

-- ---------------------------------------------------------------- auditoria (acessos e cadastro das unidades)
create or replace function public.lic_auditar_acessos() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  perform public.auditar(case when tg_op = 'INSERT' then 'licencas_acesso_liberado' else 'licencas_acesso_retirado' end, null,
    jsonb_build_object('login', (select email from public.perfis where user_id = r.user_id), 'login_id', r.user_id,
      'unidade', (select nome from public.lic_unidades where id = r.unidade_id)));
  return r;
end $$;
drop trigger if exists lic_acessos_auditoria on public.lic_acessos;
create trigger lic_acessos_auditoria after insert or delete on public.lic_acessos
  for each row execute function public.lic_auditar_acessos();

create or replace function public.lic_auditar_unidades() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.auditar(case tg_op when 'INSERT' then 'licencas_unidade_criada' when 'DELETE' then 'licencas_unidade_excluida' else 'licencas_unidade_alterada' end, null,
    jsonb_build_object('unidade', coalesce(new.nome, old.nome), 'dominio', coalesce(new.dominio, old.dominio),
      'apelidos', coalesce(new.apelidos, old.apelidos), 'ativo', coalesce(new.ativo, old.ativo)));
  return coalesce(new, old);
end $$;
drop trigger if exists lic_unidades_auditoria on public.lic_unidades;
create trigger lic_unidades_auditoria after insert or update or delete on public.lic_unidades
  for each row execute function public.lic_auditar_unidades();

-- ---------------------------------------------------------------- cargas (exportação do Microsoft 365)
-- p_contas: [{unidade_id, login, nome, cargo, departamento, bloqueada, compartilhada, licencas[], gratuitas[], criada_em}]
create or replace function public.lic_carregar(p_exportado_em date, p_arquivo text, p_linhas int, p_contas jsonb, p_substituir boolean default false)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_ex public.lic_cargas; v_n int; v_por jsonb;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia carrega exportações.'; end if;
  if p_exportado_em is null or p_exportado_em > current_date + 1 then raise exception 'Informe a data da exportação (não pode ser futura).'; end if;
  if jsonb_typeof(p_contas) <> 'array' or jsonb_array_length(p_contas) = 0 then
    raise exception 'Nenhuma conta das unidades cadastradas neste arquivo. Confira se é a exportação de usuários do Microsoft 365.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_contas) c
              where not exists (select 1 from public.lic_unidades u where u.id = (c ->> 'unidade_id')::uuid)
                 or coalesce(c ->> 'login', '') = '' or (c ->> 'login') like '%#EXT#%') then
    raise exception 'Arquivo com conta inválida (unidade desconhecida, login vazio ou convidado).';
  end if;
  select * into v_ex from public.lic_cargas where exportado_em = p_exportado_em;
  if found then
    if not coalesce(p_substituir, false) then
      raise exception 'Já existe uma carga de % (carregada por % em %). Marque "substituir" para trocar.',
        to_char(p_exportado_em, 'DD/MM/YYYY'), v_ex.carregado_nome, to_char(v_ex.carregado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
    end if;
    delete from public.lic_cargas where id = v_ex.id;
  end if;
  insert into public.lic_cargas (exportado_em, arquivo, linhas_arquivo, contas, carregado_por, carregado_nome)
  values (p_exportado_em, left(coalesce(p_arquivo, ''), 200), coalesce(p_linhas, 0), jsonb_array_length(p_contas), auth.uid(),
    coalesce((select coalesce(nullif(nome, ''), email) from public.perfis where user_id = auth.uid()), ''))
  returning id into v_id;
  insert into public.lic_contas (carga_id, unidade_id, login, nome, cargo, departamento, bloqueada, compartilhada, licencas, gratuitas, criada_em)
  select distinct on (lower(c.login)) v_id, c.unidade_id, lower(c.login), left(coalesce(c.nome, ''), 200), left(coalesce(c.cargo, ''), 200),
         left(coalesce(c.departamento, ''), 200), coalesce(c.bloqueada, false), coalesce(c.compartilhada, false),
         coalesce(c.licencas, '{}'), coalesce(c.gratuitas, '{}'), c.criada_em
    from jsonb_to_recordset(p_contas) as c(unidade_id uuid, login text, nome text, cargo text, departamento text, bloqueada boolean,
         compartilhada boolean, licencas text[], gratuitas text[], criada_em timestamptz)
   order by lower(c.login);
  get diagnostics v_n = row_count;
  update public.lic_cargas set contas = v_n where id = v_id;
  select jsonb_object_agg(u.nome, x.n) into v_por
    from (select unidade_id, count(*) n from public.lic_contas where carga_id = v_id group by unidade_id) x join public.lic_unidades u on u.id = x.unidade_id;
  perform public.auditar('licencas_carga', null, jsonb_build_object('exportado_em', p_exportado_em, 'arquivo', p_arquivo,
    'linhas_arquivo', p_linhas, 'contas', v_n, 'por_unidade', v_por, 'substituiu', v_ex.id is not null));
  return v_id;
end $$;

create or replace function public.lic_excluir_carga(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v public.lic_cargas;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia exclui cargas.'; end if;
  delete from public.lic_cargas where id = p_id returning * into v;
  if not found then raise exception 'Carga não encontrada.'; end if;
  perform public.auditar('licencas_carga_excluida', null, jsonb_build_object('exportado_em', v.exportado_em, 'arquivo', v.arquivo, 'contas', v.contas));
end $$;

-- ---------------------------------------------------------------- fatura do mês (licenças compradas)
-- p_itens: [{unidade_id, produto, quantidade, valor_unitario}] — a fatura do mês inteiro (todas as unidades); substitui a anterior do mesmo mês
create or replace function public.lic_salvar_fatura(p_mes date, p_itens jsonb, p_substituir boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', p_mes)::date; v_n int; v_tinha int;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia carrega a fatura.'; end if;
  if p_mes is null then raise exception 'Informe o mês da fatura.'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Nenhum item reconhecido na fatura.'; end if;
  select count(*) into v_tinha from public.lic_faturas where mes = v_mes;
  if v_tinha > 0 and not coalesce(p_substituir, false) then
    raise exception 'Já existe fatura de % (% itens). Marque "substituir" para trocar.', to_char(v_mes, 'MM/YYYY'), v_tinha;
  end if;
  delete from public.lic_faturas where mes = v_mes;
  insert into public.lic_faturas (unidade_id, mes, produto, quantidade, valor_unitario, carregado_por, carregado_nome)
  select i.unidade_id, v_mes, trim(i.produto), sum(i.quantidade), max(coalesce(i.valor_unitario, 0)), auth.uid(),
         coalesce((select coalesce(nullif(nome, ''), email) from public.perfis where user_id = auth.uid()), '')
    from jsonb_to_recordset(p_itens) as i(unidade_id uuid, produto text, quantidade int, valor_unitario numeric)
   group by i.unidade_id, trim(i.produto);
  get diagnostics v_n = row_count;
  perform public.auditar('licencas_fatura', null, jsonb_build_object('mes', v_mes, 'itens', v_n, 'substituiu', v_tinha > 0,
    'valor_total', (select sum(quantidade * valor_unitario) from public.lic_faturas where mes = v_mes)));
  return v_n;
end $$;

create or replace function public.lic_excluir_fatura(p_mes date)
returns void language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia exclui faturas.'; end if;
  delete from public.lic_faturas where mes = date_trunc('month', p_mes)::date;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Fatura não encontrada.'; end if;
  perform public.auditar('licencas_fatura_excluida', null, jsonb_build_object('mes', date_trunc('month', p_mes)::date, 'itens', v_n));
end $$;

revoke execute on function public.lic_carregar(date, text, int, jsonb, boolean), public.lic_excluir_carga(bigint),
  public.lic_salvar_fatura(date, jsonb, boolean), public.lic_excluir_fatura(date) from public, anon;
grant execute on function public.lic_carregar(date, text, int, jsonb, boolean), public.lic_excluir_carga(bigint),
  public.lic_salvar_fatura(date, jsonb, boolean), public.lic_excluir_fatura(date) to authenticated;

-- ---------------------------------------------------------------- cadastro do app na Área do Cliente
insert into public.apps (id, nome, descricao, url, icone, ordem, cartao_url, manual_url)
values ('licencas', 'Contas e Licenças Microsoft 365', 'Contas, licenças em uso, mudanças e licenças pagas sem uso do Microsoft 365, por unidade.',
        '/apps/licencas/', 'CL', 70, '/apps/licencas/ajuda/cartao.html', '/apps/licencas/ajuda/manual.html')
on conflict (id) do nothing;
