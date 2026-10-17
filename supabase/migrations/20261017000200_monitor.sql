-- App "Monitor de Links" (prefixo mon_): status dos links de internet e dos MikroTiks de cada cliente,
-- histórico de quedas e relatório de disponibilidade (base para cobrar SLA da operadora).
--
-- Como os dados chegam: o Supabase NÃO alcança os roteadores (estão atrás de NAT na rede do cliente).
-- Por isso cada MikroTik roda um script agendado (a cada 1 min) que mede cada link (flood-ping num host
-- de teste com rota fixa pelo link) e faz um POST HTTPS para a rpc mon_registrar(token, dados), com a
-- chave publishable no cabeçalho apikey. O token é próprio de cada equipamento; o banco guarda só o hash
-- (sha256). Equipamento que para de mandar vira "sem contato" (pg_cron, a cada 2 min).
--
-- Quem vê: equipe Nervia (admin) vê e altera tudo; o cliente só LÊ os locais liberados para o login dele
-- (mon_acessos).

create table if not exists public.mon_locais (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null check (length(trim(nome)) > 0),
  cliente   text not null default '',
  obs       text not null default '',
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists public.mon_acessos (
  user_id  uuid references auth.users on delete cascade,
  local_id uuid references public.mon_locais on delete cascade,
  primary key (user_id, local_id)
);

create table if not exists public.mon_equipamentos (
  id                uuid primary key default gen_random_uuid(),
  local_id          uuid not null references public.mon_locais on delete cascade,
  nome              text not null check (length(trim(nome)) > 0),
  modelo            text not null default '',
  intervalo_seg     int  not null default 60 check (intervalo_seg between 30 and 900),
  ativo             boolean not null default true,
  token_hash        text unique,                 -- sha256 do token; o token em si nunca fica guardado
  token_fim         text not null default '',    -- 4 últimos caracteres, só para reconhecer
  token_em          timestamptz,
  ros_versao        text not null default '',
  uptime            text not null default '',
  cpu               int,
  ultimo_contato    timestamptz,
  sem_contato_desde timestamptz,
  criado_em         timestamptz not null default now()
);

create table if not exists public.mon_links (
  id             uuid primary key default gen_random_uuid(),
  equipamento_id uuid not null references public.mon_equipamentos on delete cascade,
  chave          text not null check (chave ~ '^[a-z0-9_-]{1,30}$'),   -- nome do link no script do roteador
  nome           text not null default '',
  operadora      text not null default '',
  contratado     text not null default '',
  alvo           text not null default '8.8.8.8',                    -- host de teste (com rota fixa por este link)
  sla_pct        numeric(6,3) not null default 99.5 check (sla_pct between 0 and 100),
  rtt_alerta_ms  int not null default 150,
  ordem          int not null default 0,
  ativo          boolean not null default true,
  status         text not null default 'sem_dados' check (status in ('ok', 'instavel', 'caido', 'sem_dados')),
  status_desde   timestamptz,
  ultimo_rtt     numeric(10,2),
  ultima_perda   numeric(5,2),
  ultima_amostra timestamptz,
  unique (equipamento_id, chave)
);

-- amostras cruas (1 por minuto por link), guardadas por 15 dias
create table if not exists public.mon_amostras (
  id       bigint generated always as identity primary key,
  link_id  uuid not null references public.mon_links on delete cascade,
  em       timestamptz not null default now(),
  no_ar    boolean not null,
  rtt_ms   numeric(10,2),
  perda    numeric(5,2) not null
);
create index if not exists mon_amostras_link_em on public.mon_amostras (link_id, em);

-- resumo por hora (fica para sempre: gráficos e relatórios longos)
create table if not exists public.mon_horas (
  link_id   uuid references public.mon_links on delete cascade,
  hora      timestamptz,
  amostras  int not null default 0,
  no_ar     int not null default 0,
  rtt_soma  numeric not null default 0,
  rtt_n     int not null default 0,
  rtt_max   numeric,
  perda_soma numeric not null default 0,
  primary key (link_id, hora)
);

create table if not exists public.mon_quedas (
  id             bigint generated always as identity primary key,
  equipamento_id uuid not null references public.mon_equipamentos on delete cascade,
  link_id        uuid references public.mon_links on delete cascade,
  tipo           text not null check (tipo in ('link', 'sem_contato')),
  inicio         timestamptz not null,
  fim            timestamptz,
  obs            text not null default ''
);
create index if not exists mon_quedas_equip on public.mon_quedas (equipamento_id, inicio desc);

-- ---------------------------------------------------------------- acesso
create or replace function public.mon_pode_ver(p_local uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or exists (select 1 from public.mon_acessos where local_id = p_local and user_id = auth.uid())
$$;
create or replace function public.mon_pode_ver_equip(p_equip uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or exists (select 1 from public.mon_equipamentos e join public.mon_acessos a on a.local_id = e.local_id
    where e.id = p_equip and a.user_id = auth.uid())
$$;

alter table public.mon_locais enable row level security;
alter table public.mon_acessos enable row level security;
alter table public.mon_equipamentos enable row level security;
alter table public.mon_links enable row level security;
alter table public.mon_amostras enable row level security;
alter table public.mon_horas enable row level security;
alter table public.mon_quedas enable row level security;

revoke all on public.mon_locais, public.mon_acessos, public.mon_equipamentos, public.mon_links, public.mon_amostras,
  public.mon_horas, public.mon_quedas from anon;
-- as medições só entram pela mon_registrar (o roteador) e pela mon_verificar (cron)
revoke insert, update, delete on public.mon_amostras, public.mon_horas, public.mon_quedas from authenticated;
-- o hash do token não é lido pela tela
revoke select, insert, update on public.mon_equipamentos from authenticated;
grant select (id, local_id, nome, modelo, intervalo_seg, ativo, token_fim, token_em, ros_versao, uptime, cpu, ultimo_contato,
  sem_contato_desde, criado_em) on public.mon_equipamentos to authenticated;
grant insert (id, local_id, nome, modelo, intervalo_seg, ativo) on public.mon_equipamentos to authenticated;
grant update (local_id, nome, modelo, intervalo_seg, ativo) on public.mon_equipamentos to authenticated;
-- status do link é do servidor; a tela (admin) só mexe no cadastro
revoke update on public.mon_links from authenticated;
grant update (nome, operadora, contratado, alvo, sla_pct, rtt_alerta_ms, ordem, ativo) on public.mon_links to authenticated;
-- a obs da queda (ex.: "protocolo 123 na operadora") a equipe Nervia pode anotar
grant update (obs) on public.mon_quedas to authenticated;

drop policy if exists mon_locais_ler on public.mon_locais;
create policy mon_locais_ler on public.mon_locais for select using (public.mon_pode_ver(id));
drop policy if exists mon_locais_admin on public.mon_locais;
create policy mon_locais_admin on public.mon_locais for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists mon_acessos_ler on public.mon_acessos;
create policy mon_acessos_ler on public.mon_acessos for select using (user_id = auth.uid() or public.eh_admin());
drop policy if exists mon_acessos_admin on public.mon_acessos;
create policy mon_acessos_admin on public.mon_acessos for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists mon_equip_ler on public.mon_equipamentos;
create policy mon_equip_ler on public.mon_equipamentos for select using (public.mon_pode_ver(local_id));
drop policy if exists mon_equip_admin on public.mon_equipamentos;
create policy mon_equip_admin on public.mon_equipamentos for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists mon_links_ler on public.mon_links;
create policy mon_links_ler on public.mon_links for select using (public.mon_pode_ver_equip(equipamento_id));
drop policy if exists mon_links_admin on public.mon_links;
create policy mon_links_admin on public.mon_links for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists mon_amostras_ler on public.mon_amostras;
create policy mon_amostras_ler on public.mon_amostras for select
  using (exists (select 1 from public.mon_links l where l.id = link_id and public.mon_pode_ver_equip(l.equipamento_id)));
drop policy if exists mon_horas_ler on public.mon_horas;
create policy mon_horas_ler on public.mon_horas for select
  using (exists (select 1 from public.mon_links l where l.id = link_id and public.mon_pode_ver_equip(l.equipamento_id)));
drop policy if exists mon_quedas_ler on public.mon_quedas;
create policy mon_quedas_ler on public.mon_quedas for select using (public.mon_pode_ver_equip(equipamento_id));
drop policy if exists mon_quedas_obs on public.mon_quedas;
create policy mon_quedas_obs on public.mon_quedas for update using (public.eh_admin()) with check (public.eh_admin());

-- ---------------------------------------------------------------- token do equipamento (só admin)
create or replace function public.mon_gerar_token(p_equip uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); v_e record;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia gera o token do equipamento.'; end if;
  select e.nome, l.nome as local into v_e from public.mon_equipamentos e join public.mon_locais l on l.id = e.local_id where e.id = p_equip;
  if not found then raise exception 'Equipamento não encontrado.'; end if;
  update public.mon_equipamentos set token_hash = encode(sha256(convert_to(v_tok, 'UTF8')), 'hex'), token_fim = right(v_tok, 4), token_em = now()
   where id = p_equip;
  perform public.auditar('monitor_token_gerado', null, jsonb_build_object('equipamento', v_e.nome, 'local', v_e.local, 'equipamento_id', p_equip, 'final', right(v_tok, 4)));
  return v_tok;   -- mostrado uma única vez na tela, dentro do script
end $$;
revoke execute on function public.mon_gerar_token(uuid) from public, anon;

-- ---------------------------------------------------------------- recebimento (chamado pelo roteador)
-- converte o rtt que o RouterOS manda ("12", "12ms", "1.5ms", "00:00:00.012") em milissegundos
create or replace function public.mon_rtt_ms(p text) returns numeric
language plpgsql immutable as $$
declare s text := lower(trim(coalesce(p, ''))); n numeric;
begin
  if s = '' then return null; end if;
  if s ~ '^\d+:\d+:\d+(\.\d+)?$' then
    return round((split_part(s, ':', 1)::numeric * 3600 + split_part(s, ':', 2)::numeric * 60 + split_part(s, ':', 3)::numeric) * 1000, 2);
  end if;
  if s ~ '^\d+(\.\d+)?us$' then return round(substring(s from '^[\d.]+')::numeric / 1000, 2); end if;
  if s ~ '^\d+(\.\d+)?(ms)?$' then return round(substring(s from '^[\d.]+')::numeric, 2); end if;
  -- "1ms500us" (v7)
  if s ~ '^\d+ms\d+us$' then return round(substring(s from '^(\d+)ms')::numeric + substring(s from 'ms(\d+)us')::numeric / 1000, 2); end if;
  return null;
exception when others then return null;
end $$;

create or replace function public.mon_registrar(p_token text, p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.mon_equipamentos; l public.mon_links; it jsonb; v_env int; v_ok int; v_rtt numeric; v_perda numeric; v_no_ar boolean;
  v_status text; v_hora timestamptz := date_trunc('hour', now()); n int := 0;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'token inválido'; end if;
  select * into e from public.mon_equipamentos where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and ativo for update;
  if not found then raise exception 'token inválido ou equipamento inativo'; end if;
  -- limite: no máximo 1 envio a cada 20 s por equipamento
  if e.ultimo_contato is not null and e.ultimo_contato > now() - interval '20 seconds' then
    return jsonb_build_object('ok', false, 'motivo', 'cedo');
  end if;
  if jsonb_typeof(p_dados -> 'links') is distinct from 'array' or jsonb_array_length(p_dados -> 'links') > 8 then
    raise exception 'dados inválidos';
  end if;

  -- voltou depois de um período sem contato: fecha a queda "sem contato"
  if e.sem_contato_desde is not null then
    update public.mon_quedas set fim = now() where equipamento_id = e.id and tipo = 'sem_contato' and fim is null;
  end if;
  update public.mon_equipamentos set ultimo_contato = now(), sem_contato_desde = null,
    ros_versao = left(coalesce(p_dados ->> 'ros', ros_versao), 60), uptime = left(coalesce(p_dados ->> 'uptime', ''), 40),
    cpu = case when (p_dados ->> 'cpu') ~ '^\d{1,3}$' then (p_dados ->> 'cpu')::int end
   where id = e.id;

  for it in select * from jsonb_array_elements(p_dados -> 'links') loop
    continue when coalesce(it ->> 'k', '') !~ '^[a-z0-9_-]{1,30}$';
    v_env := case when (it ->> 'env') ~ '^\d{1,3}$' then (it ->> 'env')::int else 0 end;
    v_ok  := case when (it ->> 'ok')  ~ '^\d{1,3}$' then least((it ->> 'ok')::int, v_env) else 0 end;
    continue when v_env = 0;
    v_rtt := case when v_ok > 0 then public.mon_rtt_ms(it ->> 'rtt') end;
    v_perda := round(100.0 * (v_env - v_ok) / v_env, 2);
    v_no_ar := v_ok > 0;

    select * into l from public.mon_links where equipamento_id = e.id and chave = it ->> 'k' for update;
    if not found then  -- link novo no script: cadastra sozinho (a Nervia depois dá nome e operadora)
      insert into public.mon_links (equipamento_id, chave, nome, alvo, ordem) values (e.id, it ->> 'k', it ->> 'k', left(coalesce(it ->> 'alvo', ''), 60), 99)
      returning * into l;
    end if;
    continue when not l.ativo;

    insert into public.mon_amostras (link_id, no_ar, rtt_ms, perda) values (l.id, v_no_ar, v_rtt, v_perda);
    insert into public.mon_horas as h (link_id, hora, amostras, no_ar, rtt_soma, rtt_n, rtt_max, perda_soma)
    values (l.id, v_hora, 1, v_no_ar::int, coalesce(v_rtt, 0), (v_rtt is not null)::int, v_rtt, v_perda)
    on conflict (link_id, hora) do update set amostras = h.amostras + 1, no_ar = h.no_ar + excluded.no_ar,
      rtt_soma = h.rtt_soma + excluded.rtt_soma, rtt_n = h.rtt_n + excluded.rtt_n,
      rtt_max = greatest(h.rtt_max, excluded.rtt_max), perda_soma = h.perda_soma + excluded.perda_soma;

    v_status := case when not v_no_ar then 'caido' when v_perda >= 20 or v_rtt > l.rtt_alerta_ms then 'instavel' else 'ok' end;
    if v_status = 'caido' and l.status <> 'caido' then
      insert into public.mon_quedas (equipamento_id, link_id, tipo, inicio) values (e.id, l.id, 'link', now());
    elsif v_status <> 'caido' and l.status = 'caido' then
      update public.mon_quedas set fim = now() where link_id = l.id and tipo = 'link' and fim is null;
    end if;
    update public.mon_links set status = v_status, status_desde = case when status = v_status then status_desde else now() end,
      ultimo_rtt = v_rtt, ultima_perda = v_perda, ultima_amostra = now()
     where id = l.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'links', n, 'intervalo', e.intervalo_seg);
end $$;
revoke execute on function public.mon_registrar(text, jsonb) from public;
grant execute on function public.mon_registrar(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- vigia (pg_cron a cada 2 min)
create or replace function public.mon_verificar() returns int
language plpgsql security definer set search_path = public as $$
declare e record; n int := 0;
begin
  for e in select * from public.mon_equipamentos
            where ativo and token_hash is not null and ultimo_contato is not null and sem_contato_desde is null
              and ultimo_contato < now() - make_interval(secs => intervalo_seg * 3 + 60) for update loop
    update public.mon_equipamentos set sem_contato_desde = e.ultimo_contato where id = e.id;
    insert into public.mon_quedas (equipamento_id, tipo, inicio) values (e.id, 'sem_contato', e.ultimo_contato);
    -- links ficam "sem dados" (não se sabe se caíram); queda de link aberta continua aberta
    update public.mon_links set status = 'sem_dados', status_desde = e.ultimo_contato where equipamento_id = e.id and status <> 'caido';
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.mon_verificar() from public, anon, authenticated;

create or replace function public.mon_limpar() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.mon_amostras where em < now() - interval '15 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.mon_limpar() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('monitor-verificar', '*/2 * * * *', 'select public.mon_verificar()');
    perform cron.schedule('monitor-limpar', '23 5 * * *', 'select public.mon_limpar()');
  end if;
end $$;

-- ---------------------------------------------------------------- relatório de disponibilidade
-- Por link: tempo caído (quedas de link dentro do período), disponibilidade, nº de quedas, maior queda,
-- latência média; e o tempo em que o equipamento ficou sem contato (sem dados, não conta como caído).
create or replace function public.mon_relatorio(p_local uuid, p_de timestamptz, p_ate timestamptz)
returns table (equipamento_id uuid, equipamento text, link_id uuid, link text, operadora text, contratado text, sla_pct numeric,
  quedas int, min_caido numeric, maior_min numeric, disponibilidade numeric, rtt_medio numeric, min_sem_contato numeric, minutos_periodo numeric)
language sql stable security definer set search_path = public as $$
  with per as (select greatest(p_de, (select min(criado_em) from public.mon_equipamentos where local_id = p_local)) as de,
                      least(p_ate, now()) as ate),
  q as (
    select q.link_id, q.equipamento_id, q.tipo,
      extract(epoch from (least(coalesce(q.fim, now()), per.ate) - greatest(q.inicio, per.de))) / 60 as minutos
    from public.mon_quedas q, per
    where q.inicio < per.ate and coalesce(q.fim, now()) > per.de)
  select e.id, e.nome, l.id, coalesce(nullif(l.nome, ''), l.chave), l.operadora, l.contratado, l.sla_pct,
    (select count(*)::int from q where q.link_id = l.id and q.tipo = 'link'),
    round(coalesce((select sum(minutos) from q where q.link_id = l.id and q.tipo = 'link'), 0), 1),
    round(coalesce((select max(minutos) from q where q.link_id = l.id and q.tipo = 'link'), 0), 1),
    round(100 - 100 * coalesce((select sum(minutos) from q where q.link_id = l.id and q.tipo = 'link'), 0)
      / greatest(extract(epoch from (per.ate - per.de)) / 60, 1), 3),
    (select round(sum(h.rtt_soma) / nullif(sum(h.rtt_n), 0), 1) from public.mon_horas h where h.link_id = l.id and h.hora >= date_trunc('hour', per.de) and h.hora < per.ate),
    round(coalesce((select sum(minutos) from q where q.equipamento_id = e.id and q.tipo = 'sem_contato'), 0), 1),
    round(extract(epoch from (per.ate - per.de)) / 60, 1)
  from public.mon_equipamentos e join public.mon_links l on l.equipamento_id = e.id, per
  where e.local_id = p_local and l.ativo and public.mon_pode_ver(p_local)
  order by e.nome, l.ordem, l.chave
$$;
revoke execute on function public.mon_relatorio(uuid, timestamptz, timestamptz) from public, anon;

-- ---------------------------------------------------------------- auditoria
create or replace function public.auditar_mon_acessos() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  perform public.auditar(case when tg_op = 'INSERT' then 'monitor_acesso_liberado' else 'monitor_acesso_retirado' end, null,
    jsonb_build_object('local', (select nome from public.mon_locais where id = r.local_id), 'local_id', r.local_id,
      'login', (select email from public.perfis where user_id = r.user_id), 'login_id', r.user_id));
  return r;
end $$;
drop trigger if exists auditoria_mon_acessos on public.mon_acessos;
create trigger auditoria_mon_acessos after insert or delete on public.mon_acessos
  for each row execute function public.auditar_mon_acessos();

create or replace function public.auditar_mon_equipamentos() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  if tg_op = 'INSERT' then perform public.auditar('monitor_equipamento_criado', null, jsonb_build_object('equipamento', r.nome, 'equipamento_id', r.id));
  elsif tg_op = 'DELETE' then perform public.auditar('monitor_equipamento_excluido', null, jsonb_build_object('equipamento', r.nome, 'equipamento_id', r.id));
  elsif new.ativo is distinct from old.ativo then
    perform public.auditar(case when new.ativo then 'monitor_equipamento_ativado' else 'monitor_equipamento_desativado' end, null,
      jsonb_build_object('equipamento', r.nome, 'equipamento_id', r.id));
  end if;
  return r;
end $$;
drop trigger if exists auditoria_mon_equipamentos on public.mon_equipamentos;
create trigger auditoria_mon_equipamentos after insert or update or delete on public.mon_equipamentos
  for each row execute function public.auditar_mon_equipamentos();

-- ---------------------------------------------------------------- cadastro do app na Área do Cliente
insert into public.apps (id, nome, descricao, url, icone, ordem, ativo, cartao_url, manual_url)
values ('monitor', 'Monitor de Links', 'Status dos links de internet e roteadores, histórico de quedas e disponibilidade do mês.',
        '/apps/monitor/', 'ML', 50, true, '/apps/monitor/ajuda/cartao.html', '/apps/monitor/ajuda/manual.html')
on conflict (id) do update set nome = excluded.nome, descricao = excluded.descricao, url = excluded.url,
  cartao_url = excluded.cartao_url, manual_url = excluded.manual_url;
