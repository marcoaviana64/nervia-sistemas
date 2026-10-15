-- Acessos do site público da Nervia (nervia.com.br e /demo/), pedido do Marco em 2026-10-14.
-- Quem grava: o worker da Cloudflare (`worker/index.js`), que recebe o aviso da página (`site/acesso.js`)
-- e acrescenta IP, país, estado e cidade (request.cf). Chama site_registrar_acesso() com o segredo
-- guardado em site_config (o mesmo valor fica no segredo ACESSOS_SEGREDO do worker).
-- Leitura: só a equipe Nervia (Área do Cliente → Administração → Acessos do site).
-- LGPD: IP e navegador ficam 90 dias; depois site_anonimizar_acessos() apaga os dois e mantém a contagem.

create table if not exists public.site_acessos (
  id            bigint generated always as identity primary key,
  quando        timestamptz not null default now(),
  ip            text,
  pais          text,
  estado        text,
  estado_sigla  text,
  cidade        text,
  pagina        text,
  origem        text,
  dispositivo   text,
  navegador     text
);
create index if not exists site_acessos_quando on public.site_acessos (quando desc);
create index if not exists site_acessos_ip_quando on public.site_acessos (ip, quando desc);

alter table public.site_acessos enable row level security;
drop policy if exists site_acessos_ler on public.site_acessos;
create policy site_acessos_ler on public.site_acessos for select using (public.eh_admin());
revoke insert, update, delete, truncate on public.site_acessos from anon, authenticated;

-- Segredo compartilhado com o worker. Sem política de leitura: só o dono do banco/service_role vê.
create table if not exists public.site_config (
  chave text primary key,
  valor text not null
);
alter table public.site_config enable row level security;
revoke all on public.site_config from anon, authenticated;
insert into public.site_config (chave, valor)
values ('acessos_segredo', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (chave) do nothing;

create or replace function public.site_registrar_acesso(
  p_segredo text, p_ip text, p_pais text, p_estado text, p_estado_sigla text, p_cidade text,
  p_pagina text, p_origem text, p_navegador text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ua text := left(coalesce(p_navegador, ''), 300);
begin
  if p_segredo is null or p_segredo is distinct from (select valor from public.site_config where chave = 'acessos_segredo') then
    raise exception 'Não autorizado.' using errcode = '42501';
  end if;
  -- robôs que se identificam
  if v_ua ~* '(bot|crawl|spider|slurp|headless|lighthouse|preview|python|curl|wget)' then return; end if;
  -- recarga da mesma página pelo mesmo IP em menos de 10 s conta uma vez
  if exists (select 1 from public.site_acessos where ip = p_ip and pagina = p_pagina and quando > now() - interval '10 seconds') then return; end if;
  -- proteção contra abuso: no máximo 300 registros por IP em 24 h
  if (select count(*) from public.site_acessos where ip = p_ip and quando > now() - interval '1 day') >= 300 then return; end if;
  insert into public.site_acessos (ip, pais, estado, estado_sigla, cidade, pagina, origem, dispositivo, navegador)
  values (left(p_ip, 64), left(p_pais, 8), left(p_estado, 80), left(p_estado_sigla, 8), left(p_cidade, 80),
          left(coalesce(p_pagina, '/'), 200), nullif(left(p_origem, 200), ''),
          case when v_ua ~* '(ipad|tablet)' then 'Tablet' when v_ua ~* '(mobi|android|iphone)' then 'Celular' else 'Computador' end,
          nullif(v_ua, ''));
end $$;
revoke execute on function public.site_registrar_acesso(text, text, text, text, text, text, text, text, text) from public, authenticated;
grant execute on function public.site_registrar_acesso(text, text, text, text, text, text, text, text, text) to anon;

-- Prazo de guarda: depois de 90 dias some o IP e o navegador; fica a contagem (dia, local, página).
create or replace function public.site_anonimizar_acessos() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.site_acessos set ip = null, navegador = null
   where quando < now() - interval '90 days' and (ip is not null or navegador is not null);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.site_anonimizar_acessos() from public, anon, authenticated;

-- Agenda diária (04:17 UTC) quando o pg_cron existe (no Supabase existe; no Postgres de teste, não).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('site-acessos-anonimizar', '17 4 * * *', 'select public.site_anonimizar_acessos()');
  end if;
end $$;
