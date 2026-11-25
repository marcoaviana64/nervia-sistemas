-- NVAura 1.0 (pedido do Marco em 24/11/2026): cartão pessoal com foto, nome, estrelas e QR code. Encontrou alguém,
-- conversou, pede para avaliar: a pessoa lê o QR (sem conta), vê o cartão e dá 1 a 5 estrelas para a interação.
-- Depois ganha um "obrigado" e o convite para criar o próprio cartão. Separado do NVSintonia (decisão do Marco), com o
-- mesmo jeito de entrar (chave, sem e-mail: função sintonia-conta com app "aura") e o mesmo cuidado com o anonimato:
--   * a nota NÃO guarda quem deu nem a hora (só o dia);
--   * as notas entram em LOTES de 5 (decisão do Marco): o cartão só muda quando juntam 5 novas, então quem acabou de
--     avaliar não fica exposto;
--   * cada aparelho avalia o mesmo cartão no máximo 1 vez por dia (decisão do Marco: "posso ter várias interações");
--     o "já avaliou hoje" é um sha256(marca do aparelho : cartão : dia), sem ligação com a nota;
--   * no mapa cada pessoa é só um código do dia (AU-XXXX) com a nota: nunca nome nem foto.
-- Todas as tabelas sem acesso pela tela (RLS sem policy + revoke); tudo pelas funções aur_*.

create or replace function public._aur_hoje() returns date
language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

create or replace function public._aur_ip() returns text
language sql stable as $$
  select coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', nullif(trim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''), '')
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb as h) x
$$;

-- ---------------------------------------------------------------- tabelas
create table public.aur_cartoes (
  user_id      uuid primary key references auth.users on delete cascade,
  nome         text not null check (length(nome) between 1 and 40),
  foto         text check (foto is null or (foto ~ '^data:image/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$' and length(foto) <= 80000)),
  codigo       text not null unique,          -- o que vai no QR (fixo: serve para o cartão impresso)
  mapa_visivel boolean not null default false,
  criado_em    timestamptz not null default now()
);

create table public.aur_notas (
  id       bigint generated always as identity primary key,
  alvo     uuid not null references public.aur_cartoes on delete cascade,
  nota     smallint not null check (nota between 1 and 5),
  liberada boolean not null default false,
  dia      date not null default public._aur_hoje()
);
create index on public.aur_notas (alvo, liberada);

create table public.aur_avaliados (
  chave text primary key,                       -- sha256(marca do aparelho : cartão : dia)
  dia   date not null default public._aur_hoje()
);

create table public.aur_limites (
  tipo text not null,
  ip   text not null,
  em   timestamptz not null default now()
);
create index on public.aur_limites (tipo, ip, em);

create table public.aur_posicoes (
  user_id uuid primary key references public.aur_cartoes on delete cascade,
  lat     numeric(8, 3) not null,
  lon     numeric(8, 3) not null,
  em      timestamptz not null default now()
);

create table public.aur_ids_dia (
  user_id uuid not null references public.aur_cartoes on delete cascade,
  dia     date not null,
  id_dia  text not null,
  primary key (user_id, dia),
  unique (dia, id_dia)
);

do $$ declare t text; begin
  foreach t in array array['aur_cartoes','aur_notas','aur_avaliados','aur_limites','aur_posicoes','aur_ids_dia'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- apoio
create or replace function public._aur_eu() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'Entre no NVAura para continuar.'; end if;
  if not exists (select 1 from aur_cartoes where user_id = v) then raise exception 'Crie o seu cartão do NVAura primeiro.'; end if;
  return v;
end $$;

create or replace function public._aur_limite(p_tipo text, p_max int) returns void
language plpgsql security definer set search_path = public as $$
declare v_ip text := public._aur_ip();
begin
  delete from aur_limites where em < now() - interval '1 day';
  if (select count(*) from aur_limites where tipo = p_tipo and ip = v_ip and em > now() - interval '1 hour') >= p_max then
    raise exception 'Muitas tentativas seguidas. Espere um pouco e tente de novo.';
  end if;
  insert into aur_limites (tipo, ip) values (p_tipo, v_ip);
end $$;

-- código do QR: 10 caracteres sem 0/O/1/I (32^10 ≈ 10^15), sorteados pelos bytes do gen_random_uuid
create or replace function public._aur_codigo_novo() returns text
language plpgsql security definer set search_path = public as $$
declare alfa constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; pos constant int[] := array[0,1,2,3,4,5,9,10,11,12];
  b bytea; c text; i int;
begin
  loop
    b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex'); c := '';
    foreach i in array pos loop c := c || substr(alfa, 1 + get_byte(b, i) % 32, 1); end loop;
    if not exists (select 1 from aur_cartoes where codigo = c) then return c; end if;
  end loop;
end $$;

create or replace function public._aur_id_dia(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v text; d date := public._aur_hoje();
begin
  select id_dia into v from aur_ids_dia where user_id = p_user and dia = d;
  if v is not null then return v; end if;
  delete from aur_ids_dia where dia < d - 1;
  loop
    v := 'AU-' || (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 4));
    begin
      insert into aur_ids_dia (user_id, dia, id_dia) values (p_user, d, v);
      return v;
    exception when unique_violation then null;
    end;
  end loop;
end $$;

-- nota do cartão: média simples das notas liberadas (lotes de 5), com uma casa
create or replace function public._aur_nota(p_alvo uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('n', count(*), 'media', case when count(*) > 0 then round(avg(nota)::numeric, 1) end)
  from aur_notas where alvo = p_alvo and liberada
$$;

-- ---------------------------------------------------------------- meu cartão
create or replace function public.aur_meu_cartao() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := auth.uid(); c aur_cartoes;
begin
  if v is null then return null; end if;
  select * into c from aur_cartoes where user_id = v;
  if c.user_id is null then return jsonb_build_object('existe', false, 'nome', (select nome from perfis where user_id = v)); end if;
  return jsonb_build_object('existe', true, 'nome', c.nome, 'foto', c.foto, 'codigo', c.codigo, 'mapa_visivel', c.mapa_visivel,
    'id_dia', public._aur_id_dia(v), 'nota', public._aur_nota(v));
end $$;

-- cria ou altera (nome e foto); foto vazia = mantém a atual, foto '-' = tira
create or replace function public.aur_cartao_salvar(p_nome text, p_foto text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := auth.uid(); n text := trim(coalesce(p_nome, ''));
begin
  if v is null then raise exception 'Entre no NVAura para continuar.'; end if;
  if length(n) < 1 or length(n) > 40 then raise exception 'Informe o nome do cartão (até 40 letras).'; end if;
  if p_foto is not null and p_foto not in ('', '-') and (p_foto !~ '^data:image/(webp|jpeg|png);base64,' or length(p_foto) > 80000) then
    raise exception 'Foto inválida ou grande demais. Escolha outra.';
  end if;
  if exists (select 1 from aur_cartoes where user_id = v) then
    update aur_cartoes set nome = n,
      foto = case when p_foto is null or p_foto = '' then foto when p_foto = '-' then null else p_foto end
    where user_id = v;
  else
    insert into aur_cartoes (user_id, nome, foto, codigo)
    values (v, n, case when p_foto in ('', '-') then null else p_foto end, public._aur_codigo_novo());
    perform public.auditar('aura_cartao_criado', null, '{}'::jsonb);
  end if;
  return public.aur_meu_cartao();
end $$;

-- QR novo: o antigo (inclusive o impresso) deixa de valer
create or replace function public.aur_trocar_codigo() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := public._aur_eu();
begin
  update aur_cartoes set codigo = public._aur_codigo_novo() where user_id = v;
  perform public.auditar('aura_codigo_trocado', null, '{}'::jsonb);
  return public.aur_meu_cartao();
end $$;

-- ---------------------------------------------------------------- avaliar (sem login)
-- o cartão de quem tem o código: nome, foto e nota (o código é o que está no QR)
create or replace function public.aur_cartao_ler(p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c aur_cartoes;
begin
  perform public._aur_limite('ler', 120);
  select * into c from aur_cartoes where codigo = upper(trim(coalesce(p_codigo, '')));
  if c.user_id is null then return null; end if;
  return jsonb_build_object('nome', c.nome, 'foto', c.foto, 'nota', public._aur_nota(c.user_id),
    'meu', c.user_id = auth.uid());
end $$;

create or replace function public.aur_avaliar(p_codigo text, p_marca text, p_nota int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c aur_cartoes; k text; d date := public._aur_hoje(); pend int;
begin
  perform public._aur_limite('avaliar', 30);
  select * into c from aur_cartoes where codigo = upper(trim(coalesce(p_codigo, '')));
  if c.user_id is null then raise exception 'Cartão não encontrado. Peça para a pessoa mostrar o QR de novo.'; end if;
  if c.user_id = auth.uid() then raise exception 'Este é o seu cartão: você não pode se avaliar.'; end if;
  if p_nota is null or p_nota < 1 or p_nota > 5 then raise exception 'Escolha de 1 a 5 estrelas.'; end if;
  if coalesce(length(p_marca), 0) < 16 or length(p_marca) > 100 then raise exception 'Aparelho não identificado. Recarregue a página.'; end if;
  k := encode(sha256(convert_to(p_marca || ':' || c.user_id || ':' || d, 'UTF8')), 'hex');
  delete from aur_avaliados where dia < d - 1;
  begin
    insert into aur_avaliados (chave, dia) values (k, d);
  exception when unique_violation then
    raise exception 'Você já avaliou este cartão hoje. Amanhã pode avaliar de novo.';
  end;
  insert into aur_notas (alvo, nota) values (c.user_id, p_nota);
  -- lote: só libera quando juntam 5 novas
  select count(*) into pend from aur_notas where alvo = c.user_id and not liberada;
  if pend >= 5 then update aur_notas set liberada = true where alvo = c.user_id and not liberada; end if;
  return jsonb_build_object('ok', true, 'nome', c.nome);
end $$;

-- ---------------------------------------------------------------- mapa (quem vê, aparece)
create or replace function public.aur_mapa_visivel(p_visivel boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := public._aur_eu();
begin
  update aur_cartoes set mapa_visivel = coalesce(p_visivel, false) where user_id = v;
  if not coalesce(p_visivel, false) then delete from aur_posicoes where user_id = v; end if;
  perform public.auditar(case when p_visivel then 'aura_mapa_ligado' else 'aura_mapa_desligado' end, null, '{}'::jsonb);
  return public.aur_meu_cartao();
end $$;

-- grava só a quadra (~100 m) e devolve quem está no raio (até 5 km), visível há menos de 30 min: código do dia e nota
create or replace function public.aur_mapa(p_lat numeric, p_lon numeric, p_raio int default 500) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := public._aur_eu(); la numeric := round(p_lat, 3); lo numeric := round(p_lon, 3);
  r int := least(greatest(coalesce(p_raio, 500), 100), 5000); kx numeric; ky numeric := 110540;
begin
  if not (select mapa_visivel from aur_cartoes where user_id = v) then raise exception 'Ligue "Aparecer no mapa" para ver quem está por perto: quem vê também aparece.'; end if;
  if p_lat is null or p_lon is null or abs(p_lat) > 90 or abs(p_lon) > 180 then raise exception 'Localização inválida.'; end if;
  kx := 111320 * cos(radians(la));
  delete from aur_posicoes where em < now() - interval '30 minutes';
  insert into aur_posicoes (user_id, lat, lon) values (v, la, lo)
  on conflict (user_id) do update set lat = excluded.lat, lon = excluded.lon, em = now();
  return jsonb_build_object('eu', public._aur_id_dia(v), 'raio', r, 'pessoas', coalesce((
    select jsonb_agg(jsonb_build_object('id', public._aur_id_dia(x.user_id), 'dx', x.dx, 'dy', x.dy,
             'dist', greatest(100, round(sqrt(x.dx ^ 2 + x.dy ^ 2) / 100) * 100), 'nota', public._aur_nota(x.user_id))
           order by x.dx ^ 2 + x.dy ^ 2)
    from (select ps.user_id, round((ps.lon - lo) * kx) as dx, round((ps.lat - la) * ky) as dy
          from aur_posicoes ps join aur_cartoes ca on ca.user_id = ps.user_id
          where ps.user_id <> v and ca.mapa_visivel and ps.em > now() - interval '30 minutes') x
    where sqrt(x.dx ^ 2 + x.dy ^ 2) <= r), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- apagar
create or replace function public.aur_excluir_tudo() returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'Entre no NVAura para continuar.'; end if;
  delete from aur_cartoes where user_id = v;   -- notas, posição e códigos do dia vão junto (cascade)
  perform public.auditar('aura_dados_excluidos', null, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------- conta nova pela função sintonia-conta (app "aura")
create or replace function public.sin_conta_auditar(p_user uuid, p_acao text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_acao not in ('sintonia_conta_criada', 'sintonia_email_trocado_por_chave', 'aura_conta_criada') then raise exception 'Ação inválida.'; end if;
  insert into auditoria (user_id, email, nome, papel, acao, detalhes)
  select p_user, null, p.nome, 'cliente', p_acao, '{}'::jsonb from (select coalesce((select nome from perfis where user_id = p_user), '') as nome) p;
end $$;
revoke execute on function public.sin_conta_auditar(uuid, text) from public, anon, authenticated;
grant execute on function public.sin_conta_auditar(uuid, text) to service_role;

-- ---------------------------------------------------------------- permissões
do $$ declare f text; begin
  foreach f in array array['_aur_eu()', '_aur_limite(text,int)', '_aur_codigo_novo()', '_aur_id_dia(uuid)', '_aur_nota(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['aur_meu_cartao()', 'aur_cartao_salvar(text,text)', 'aur_trocar_codigo()', 'aur_mapa_visivel(boolean)',
      'aur_mapa(numeric,numeric,int)', 'aur_excluir_tudo()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['aur_cartao_ler(text)', 'aur_avaliar(text,text,int)'] loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
