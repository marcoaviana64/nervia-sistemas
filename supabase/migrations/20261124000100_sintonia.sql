-- NVSintonia (laboratório) — pedido do Marco em 24/11/2026: avaliação mútua anônima entre pessoas.
-- Três partes: Meu espelho (autoavaliação × como os círculos te veem; modelo pessoal e 360° profissional),
-- Encontros por QR code (cada um avalia o outro depois de se encontrarem) e Mapa do entorno (quem ligou "visível").
-- App em site/sintonia/ (página web que se instala no celular), FORA da Área do Cliente. Prefixo sin_.
--
-- SIGILO (o que este banco garante):
--   * nenhuma resposta/nota guarda quem avaliou, nem a hora (só o dia);
--   * "já respondeu" fica numa tabela separada, sem ligação com a resposta (marca do aparelho em sha256);
--   * a nota só entra no resultado em LOTE: quando juntam K notas novas (5 no pessoal e nos encontros, 3 no 360°;
--     o gestor do 360° é uma pessoa só e aparece identificado); quem é avaliado nunca vê nota individual,
--     nem quantas respostas estão esperando;
--   * todas as tabelas sem acesso direto pela tela (RLS sem policy + revoke): tudo pelas funções abaixo;
--   * no mapa só a quadra (~100 m), só a última posição (some em 30 min), ID novo a cada dia, e quem vê também aparece.
-- Limite conhecido (laboratório): quem administra o banco ainda poderia cruzar a hora da ficha usada no encontro com
-- o lote; a versão de produção usa ficha cega (Privacy Pass), como explicado na demonstração.

-- ---------------------------------------------------------------- itens dos modelos
-- 'p' = pessoal (5 itens, 0 a 5), 'r' = profissional 360° (10 itens, 1 a 5 ou nulo = "não observei")
create or replace function public._sin_notas_ok(p_modelo text, p_notas smallint[]) returns boolean
language sql immutable as $$
  select case p_modelo
    when 'p' then array_length(p_notas, 1) = 5 and not exists (select 1 from unnest(p_notas) n where n is null or n < 0 or n > 5)
    when 'r' then array_length(p_notas, 1) = 10 and not exists (select 1 from unnest(p_notas) n where n < 1 or n > 5)
                  and exists (select 1 from unnest(p_notas) n where n is not null)
    else false end
$$;

create or replace function public._sin_hoje() returns date
language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

create or replace function public._sin_ip() returns text
language sql stable as $$
  select coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', nullif(trim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''), '')
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb as h) x
$$;

-- ---------------------------------------------------------------- tabelas
create table public.sin_pessoas (
  user_id      uuid primary key references auth.users on delete cascade,
  nome         text not null check (length(trim(nome)) between 1 and 40),
  mapa_visivel boolean not null default false,
  criado_em    timestamptz not null default now()
);

create table public.sin_espelhos (
  id        bigint generated always as identity primary key,
  dono      uuid not null references public.sin_pessoas on delete cascade,
  modelo    text not null check (modelo in ('p', 'r')),
  rodada    int not null default 1,
  rodada_em timestamptz not null default now(),
  auto      smallint[],
  auto_em   timestamptz,
  criado_em timestamptz not null default now(),
  unique (dono, modelo)
);

create table public.sin_circulos (
  id         bigint generated always as identity primary key,
  espelho_id bigint not null references public.sin_espelhos on delete cascade,
  nome       text not null check (length(trim(nome)) between 1 and 30),
  gestor     boolean not null default false,
  codigo     text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  criado_em  timestamptz not null default now(),
  unique (espelho_id, nome)
);

-- resposta SEM autor e SEM hora; liberada = já entrou no resultado (lote fechado)
create table public.sin_respostas (
  id         bigint generated always as identity primary key,
  circulo_id bigint not null references public.sin_circulos on delete cascade,
  rodada     int not null,
  notas      smallint[] not null,
  liberada   boolean not null default false,
  dia        date not null default public._sin_hoje()
);
create index on public.sin_respostas (circulo_id, rodada);

-- quem já respondeu: só a marca do aparelho (sha256), sem ligação com a resposta
create table public.sin_respondidos (
  circulo_id bigint not null references public.sin_circulos on delete cascade,
  rodada     int not null,
  marca      text not null,
  primary key (circulo_id, rodada, marca)
);

-- limite de envios sem login por IP (apagado depois de 1 dia)
create table public.sin_limites (
  tipo text not null,
  ip   text not null,
  em   timestamptz not null default now()
);
create index on public.sin_limites (tipo, ip, em);

-- encontros: código do QR (10 min, uso único), fichas (direito de avaliar o outro, 48 h) e o par (1 por 30 dias)
create table public.sin_qr (
  codigo  text primary key,
  dono    uuid not null references public.sin_pessoas on delete cascade,
  expira  timestamptz not null default now() + interval '10 minutes'
);
create table public.sin_pares (
  par  text primary key,              -- sha256 dos dois ids em ordem
  dia  date not null
);
create table public.sin_fichas (
  id        bigint generated always as identity primary key,
  avaliador uuid not null references public.sin_pessoas on delete cascade,
  alvo      uuid not null references public.sin_pessoas on delete cascade,
  expira    timestamptz not null default now() + interval '48 hours'
);
create table public.sin_enc_notas (
  id       bigint generated always as identity primary key,
  alvo     uuid not null references public.sin_pessoas on delete cascade,
  notas    smallint[] not null check (public._sin_notas_ok('p', notas)),
  liberada boolean not null default false,
  dia      date not null default public._sin_hoje()
);
create index on public.sin_enc_notas (alvo);

-- mapa: só a quadra (~100 m), só a última posição; ID do dia
create table public.sin_posicoes (
  user_id uuid primary key references public.sin_pessoas on delete cascade,
  lat     numeric(8, 3) not null,
  lon     numeric(8, 3) not null,
  em      timestamptz not null default now()
);
create table public.sin_ids_dia (
  user_id uuid not null references public.sin_pessoas on delete cascade,
  dia     date not null,
  id_dia  text not null,
  primary key (user_id, dia),
  unique (dia, id_dia)
);

do $$ declare t text; begin
  foreach t in array array['sin_pessoas','sin_espelhos','sin_circulos','sin_respostas','sin_respondidos','sin_limites',
                           'sin_qr','sin_pares','sin_fichas','sin_enc_notas','sin_posicoes','sin_ids_dia'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- apoio
create or replace function public._sin_eu() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'Entre no NVSintonia para continuar.'; end if;
  if not exists (select 1 from sin_pessoas where user_id = v) then raise exception 'Crie o seu perfil do NVSintonia primeiro.'; end if;
  return v;
end $$;

create or replace function public._sin_limite(p_tipo text, p_max int) returns void
language plpgsql security definer set search_path = public as $$
declare v_ip text := public._sin_ip();
begin
  delete from sin_limites where em < now() - interval '1 day';
  if (select count(*) from sin_limites where tipo = p_tipo and ip = v_ip and em > now() - interval '1 hour') >= p_max then
    raise exception 'Muitas tentativas seguidas. Espere um pouco e tente de novo.';
  end if;
  insert into sin_limites (tipo, ip) values (p_tipo, v_ip);
end $$;

-- mínimo de respostas para um grupo aparecer
create or replace function public._sin_min(p_modelo text, p_gestor boolean) returns int
language sql immutable as $$ select case when p_gestor then 1 when p_modelo = 'r' then 3 else 5 end $$;

create or replace function public._sin_id_dia(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v text; d date := public._sin_hoje();
begin
  select id_dia into v from sin_ids_dia where user_id = p_user and dia = d;
  if v is not null then return v; end if;
  delete from sin_ids_dia where dia < d - 1;
  loop
    v := 'SN-' || (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 4));
    begin
      insert into sin_ids_dia (user_id, dia, id_dia) values (p_user, d, v);
      return v;
    exception when unique_violation then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------- perfil
create or replace function public.sin_perfil() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := auth.uid(); p sin_pessoas;
begin
  if v is null then return null; end if;
  select * into p from sin_pessoas where user_id = v;
  if p.user_id is null then return jsonb_build_object('existe', false, 'nome', (select nome from perfis where user_id = v)); end if;
  return jsonb_build_object('existe', true, 'nome', p.nome, 'mapa_visivel', p.mapa_visivel, 'id_dia', public._sin_id_dia(v),
    'fichas', (select count(*) from sin_fichas where avaliador = v and expira > now()));
end $$;

create or replace function public.sin_perfil_salvar(p_nome text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := auth.uid(); novo boolean;
begin
  if v is null then raise exception 'Entre no NVSintonia para continuar.'; end if;
  if length(trim(coalesce(p_nome, ''))) not between 1 and 40 then raise exception 'Informe um nome de até 40 letras.'; end if;
  novo := not exists (select 1 from sin_pessoas where user_id = v);
  insert into sin_pessoas (user_id, nome) values (v, trim(p_nome))
  on conflict (user_id) do update set nome = excluded.nome;
  if novo then perform public.auditar('sintonia_perfil_criado', null, '{}'::jsonb); end if;
  return public.sin_perfil();
end $$;

-- apaga TUDO do NVSintonia da pessoa (espelhos, respostas recebidas, notas de encontros, posição); o login continua
create or replace function public.sin_excluir_tudo() returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := public._sin_eu();
begin
  delete from sin_pessoas where user_id = v;
  perform public.auditar('sintonia_dados_excluidos', null, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------- espelho
create or replace function public._sin_espelho(p_modelo text) returns sin_espelhos
language plpgsql security definer set search_path = public as $$
declare v uuid := public._sin_eu(); e sin_espelhos;
begin
  if p_modelo not in ('p', 'r') then raise exception 'Modelo inválido.'; end if;
  select * into e from sin_espelhos where dono = v and modelo = p_modelo;
  if e.id is null then
    insert into sin_espelhos (dono, modelo) values (v, p_modelo) returning * into e;
    if p_modelo = 'r' then   -- grupos clássicos do 360°
      insert into sin_circulos (espelho_id, nome, gestor) values (e.id, 'Gestor', true), (e.id, 'Pares', false),
        (e.id, 'Liderados', false), (e.id, 'Clientes internos', false);
    end if;
  end if;
  return e;
end $$;

-- tudo o que o dono vê do próprio espelho: autoavaliação, círculos (com o link) e, só depois da autoavaliação,
-- as médias dos círculos que já têm o mínimo de respostas liberadas
create or replace function public.sin_espelho(p_modelo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e sin_espelhos := public._sin_espelho(p_modelo); v_n int := case p_modelo when 'p' then 5 else 10 end;
begin
  return jsonb_build_object(
    'modelo', e.modelo, 'rodada', e.rodada, 'rodada_em', e.rodada_em, 'auto', to_jsonb(e.auto), 'auto_em', e.auto_em,
    'nova_rodada_em', case when exists (select 1 from sin_respostas r join sin_circulos c on c.id = r.circulo_id where c.espelho_id = e.id and r.rodada = e.rodada)
                           then (e.rodada_em + interval '90 days')::date end,
    'circulos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'nome', c.nome, 'gestor', c.gestor, 'codigo', c.codigo, 'minimo', public._sin_min(e.modelo, c.gestor),
        'liberadas', lib.n,
        'medias', case when e.auto is null or lib.n < public._sin_min(e.modelo, c.gestor) then null else lib.medias end)
        order by c.gestor desc, c.id)
      from sin_circulos c
      cross join lateral (
        select count(*)::int as n,
          (select jsonb_agg((select round(avg(r2.notas[i])::numeric, 2) from sin_respostas r2
                             where r2.circulo_id = c.id and r2.rodada = e.rodada and r2.liberada) order by i)
           from generate_series(1, v_n) i) as medias
        from sin_respostas r where r.circulo_id = c.id and r.rodada = e.rodada and r.liberada) lib
      where c.espelho_id = e.id), '[]'::jsonb));
end $$;

create or replace function public.sin_auto_salvar(p_modelo text, p_notas smallint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e sin_espelhos := public._sin_espelho(p_modelo);
begin
  if not public._sin_notas_ok(p_modelo, p_notas) then raise exception 'Responda todos os itens.'; end if;
  if e.auto is not null then raise exception 'A autoavaliação desta rodada já foi feita. Para refazer, abra uma nova rodada.'; end if;
  update sin_espelhos set auto = p_notas, auto_em = now() where id = e.id;
  return public.sin_espelho(p_modelo);
end $$;

-- nova rodada: zera a autoavaliação e começa a contar respostas do zero. Uma a cada 90 dias (sem resposta na rodada,
-- pode na hora): assim ninguém descobre quem respondeu pedindo de novo e comparando.
create or replace function public.sin_nova_rodada(p_modelo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e sin_espelhos := public._sin_espelho(p_modelo);
begin
  if exists (select 1 from sin_respostas r join sin_circulos c on c.id = r.circulo_id where c.espelho_id = e.id and r.rodada = e.rodada)
     and e.rodada_em > now() - interval '90 days' then
    raise exception 'Uma nova rodada só pode ser aberta 90 dias depois da anterior (a partir de %).', to_char(e.rodada_em + interval '90 days', 'DD/MM/YYYY');
  end if;
  update sin_espelhos set rodada = rodada + 1, rodada_em = now(), auto = null, auto_em = null where id = e.id;
  return public.sin_espelho(p_modelo);
end $$;

create or replace function public.sin_circulo_criar(p_modelo text, p_nome text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e sin_espelhos := public._sin_espelho(p_modelo);
begin
  if length(trim(coalesce(p_nome, ''))) not between 1 and 30 then raise exception 'Dê um nome de até 30 letras ao círculo.'; end if;
  if (select count(*) from sin_circulos where espelho_id = e.id) >= 12 then raise exception 'Máximo de 12 círculos.'; end if;
  if exists (select 1 from sin_circulos where espelho_id = e.id and lower(nome) = lower(trim(p_nome))) then raise exception 'Já existe um círculo com esse nome.'; end if;
  insert into sin_circulos (espelho_id, nome) values (e.id, trim(p_nome));
  perform public.auditar('sintonia_circulo_criado', null, jsonb_build_object('modelo', p_modelo, 'circulo', trim(p_nome)));
  return public.sin_espelho(p_modelo);
end $$;

-- excluir círculo apaga as respostas dele; o link para de funcionar
create or replace function public.sin_circulo_excluir(p_circulo bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := public._sin_eu(); c record;
begin
  select ci.*, es.modelo into c from sin_circulos ci join sin_espelhos es on es.id = ci.espelho_id where ci.id = p_circulo and es.dono = v;
  if c.id is null then raise exception 'Círculo não encontrado.'; end if;
  delete from sin_circulos where id = p_circulo;
  perform public.auditar('sintonia_circulo_excluido', null, jsonb_build_object('modelo', c.modelo, 'circulo', c.nome));
  return public.sin_espelho(c.modelo);
end $$;

-- ---------------------------------------------------------------- convite (sem login)
create or replace function public.sin_convite_ler(p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select ci.nome as circulo, ci.gestor, es.modelo, es.rodada, p.nome as dono into c
  from sin_circulos ci join sin_espelhos es on es.id = ci.espelho_id join sin_pessoas p on p.user_id = es.dono
  where ci.codigo = p_codigo;
  if c.dono is null then raise exception 'Convite não encontrado: o link pode ter sido apagado.'; end if;
  return jsonb_build_object('dono', c.dono, 'circulo', c.circulo, 'gestor', c.gestor, 'modelo', c.modelo,
    'eu_mesmo', exists (select 1 from sin_circulos ci join sin_espelhos es on es.id = ci.espelho_id where ci.codigo = p_codigo and es.dono = auth.uid()));
end $$;

-- p_marca = sha256 (no aparelho) de um número aleatório guardado no aparelho + o código do convite
create or replace function public.sin_responder(p_codigo text, p_marca text, p_notas smallint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; v_marca text; v_min int; v_pend int;
begin
  perform public._sin_limite('responder', 30);
  select ci.id, ci.gestor, es.modelo, es.rodada, es.dono into c
  from sin_circulos ci join sin_espelhos es on es.id = ci.espelho_id where ci.codigo = p_codigo for update of ci;
  if c.id is null then raise exception 'Convite não encontrado: o link pode ter sido apagado.'; end if;
  if c.dono = auth.uid() then raise exception 'Este convite é seu: a sua opinião entra pela autoavaliação.'; end if;
  if coalesce(length(p_marca), 0) not between 16 and 128 then raise exception 'Aparelho não identificado. Recarregue a página.'; end if;
  if not public._sin_notas_ok(c.modelo, p_notas) then raise exception 'Responda todos os itens.'; end if;
  v_marca := encode(sha256(convert_to(p_marca, 'UTF8')), 'hex');
  begin
    insert into sin_respondidos (circulo_id, rodada, marca) values (c.id, c.rodada, v_marca);
  exception when unique_violation then
    raise exception 'Você já respondeu este convite nesta rodada.';
  end;
  insert into sin_respostas (circulo_id, rodada, notas) values (c.id, c.rodada, p_notas);
  -- lote: só libera quando juntam o mínimo de respostas novas
  v_min := public._sin_min(c.modelo, c.gestor);
  select count(*) into v_pend from sin_respostas where circulo_id = c.id and rodada = c.rodada and not liberada;
  if v_pend >= v_min then
    update sin_respostas set liberada = true where circulo_id = c.id and rodada = c.rodada and not liberada;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- encontros por QR
create or replace function public.sin_qr_gerar() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := public._sin_eu(); cod text;
begin
  delete from sin_qr where expira < now() or dono = v;
  cod := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into sin_qr (codigo, dono) values (cod, v);
  return jsonb_build_object('codigo', cod, 'expira', now() + interval '10 minutes');
end $$;

-- quem leu o QR do outro: registra o encontro e cria uma ficha para cada um avaliar o outro (48 h)
create or replace function public.sin_qr_usar(p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := public._sin_eu(); q sin_qr; v_par text; outro text;
begin
  perform public._sin_limite('qr', 20);
  select * into q from sin_qr where codigo = upper(trim(coalesce(p_codigo, ''))) for update;
  if q.codigo is null or q.expira < now() then raise exception 'Código inválido ou vencido. Peça para a pessoa mostrar o QR de novo.'; end if;
  if q.dono = v then raise exception 'Este é o seu próprio código.'; end if;
  delete from sin_qr where codigo = q.codigo;
  select nome into outro from sin_pessoas where user_id = q.dono;
  v_par := encode(sha256(convert_to(least(v::text, q.dono::text) || greatest(v::text, q.dono::text), 'UTF8')), 'hex');
  if exists (select 1 from sin_pares where par = v_par and dia > public._sin_hoje() - 30) then
    return jsonb_build_object('ok', false, 'mensagem', format('Você e %s já se avaliaram nos últimos 30 dias. Cada dupla avalia uma vez por mês.', outro));
  end if;
  insert into sin_pares (par, dia) values (v_par, public._sin_hoje()) on conflict (par) do update set dia = excluded.dia;
  insert into sin_fichas (avaliador, alvo) values (v, q.dono), (q.dono, v);
  return jsonb_build_object('ok', true, 'nome', outro);
end $$;

create or replace function public.sin_fichas() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := public._sin_eu();
begin
  delete from sin_fichas where expira < now();
  return coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'nome', p.nome, 'expira', f.expira) order by f.expira)
    from sin_fichas f join sin_pessoas p on p.user_id = f.alvo where f.avaliador = v), '[]'::jsonb);
end $$;

-- a nota vai para o alvo SEM autor; a ficha é apagada (não fica quem avaliou quem)
create or replace function public.sin_avaliar(p_ficha bigint, p_notas smallint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := public._sin_eu(); f sin_fichas; v_pend int;
begin
  select * into f from sin_fichas where id = p_ficha and avaliador = v and expira > now() for update;
  if f.id is null then raise exception 'Este encontro não está mais disponível para avaliar (o prazo é de 48 horas).'; end if;
  if not public._sin_notas_ok('p', p_notas) then raise exception 'Responda todos os itens.'; end if;
  delete from sin_fichas where id = f.id;
  insert into sin_enc_notas (alvo, notas) values (f.alvo, p_notas);
  select count(*) into v_pend from sin_enc_notas where alvo = f.alvo and not liberada;
  if v_pend >= 5 then update sin_enc_notas set liberada = true where alvo = f.alvo and not liberada; end if;
  return jsonb_build_object('ok', true);
end $$;

-- nota dos encontros: média com "peso da dúvida" (m = 10, partindo da média de todos em cada item)
create or replace function public._sin_nota(p_alvo uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare n int; itens jsonb; mu numeric;
begin
  select count(*) into n from sin_enc_notas where alvo = p_alvo and liberada;
  if n < 5 then return jsonb_build_object('n', n, 'itens', null, 'geral', null); end if;
  select jsonb_agg(round(((10 * g.mu + s.soma) / (10 + n))::numeric, 2) order by i) into itens
  from generate_series(1, 5) i
  cross join lateral (select coalesce(sum(notas[i]), 0) as soma from sin_enc_notas where alvo = p_alvo and liberada) s
  cross join lateral (select case when count(*) >= 20 then avg(notas[i]) else 3.5 end as mu from sin_enc_notas where liberada) g;
  return jsonb_build_object('n', n, 'itens', itens,
    'geral', (select round(avg(x::numeric), 2) from jsonb_array_elements_text(itens) x));
end $$;
revoke execute on function public._sin_nota(uuid) from public, anon, authenticated;

create or replace function public.sin_minha_nota() returns jsonb
language plpgsql security definer set search_path = public as $$
begin return public._sin_nota(public._sin_eu()); end $$;

-- ---------------------------------------------------------------- mapa
create or replace function public.sin_mapa_visivel(p_visivel boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := public._sin_eu();
begin
  update sin_pessoas set mapa_visivel = coalesce(p_visivel, false) where user_id = v;
  if not coalesce(p_visivel, false) then delete from sin_posicoes where user_id = v; end if;
  perform public.auditar(case when p_visivel then 'sintonia_mapa_ligado' else 'sintonia_mapa_desligado' end, null, '{}'::jsonb);
  return public.sin_perfil();
end $$;

-- grava só a quadra (~100 m) e devolve quem está no raio (até 1 km), visível há menos de 30 min
create or replace function public.sin_mapa(p_lat numeric, p_lon numeric, p_raio int default 300) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := public._sin_eu(); la numeric := round(p_lat, 3); lo numeric := round(p_lon, 3); r int := least(greatest(coalesce(p_raio, 300), 100), 1000);
  kx numeric; ky numeric := 110540;
begin
  if not (select mapa_visivel from sin_pessoas where user_id = v) then raise exception 'Ligue "Visível no mapa" para ver quem está por perto: quem vê também aparece.'; end if;
  if p_lat is null or p_lon is null or abs(p_lat) > 90 or abs(p_lon) > 180 then raise exception 'Localização inválida.'; end if;
  kx := 111320 * cos(radians(la));
  delete from sin_posicoes where em < now() - interval '30 minutes';
  insert into sin_posicoes (user_id, lat, lon) values (v, la, lo)
  on conflict (user_id) do update set lat = excluded.lat, lon = excluded.lon, em = now();
  return jsonb_build_object('eu', public._sin_id_dia(v), 'raio', r, 'pessoas', coalesce((
    select jsonb_agg(jsonb_build_object('id', public._sin_id_dia(x.user_id), 'dx', x.dx, 'dy', x.dy,
             'dist', greatest(100, round(sqrt(x.dx ^ 2 + x.dy ^ 2) / 100) * 100), 'nota', public._sin_nota(x.user_id))
           order by x.dx ^ 2 + x.dy ^ 2)
    from (select ps.user_id, round((ps.lon - lo) * kx) as dx, round((ps.lat - la) * ky) as dy
          from sin_posicoes ps join sin_pessoas pe on pe.user_id = ps.user_id
          where ps.user_id <> v and pe.mapa_visivel and ps.em > now() - interval '30 minutes') x
    where sqrt(x.dx ^ 2 + x.dy ^ 2) <= r), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- conta nova (Edge Function sintonia-conta, service role)
-- limite de contas novas: 5 por hora por IP e 100 por dia no total
create or replace function public.sin_conta_limite(p_ip text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from sin_limites where em < now() - interval '1 day';
  if (select count(*) from sin_limites where tipo = 'conta' and ip = coalesce(p_ip, '') and em > now() - interval '1 hour') >= 5
     or (select count(*) from sin_limites where tipo = 'conta' and em > now() - interval '1 day') >= 100 then
    return false;
  end if;
  insert into sin_limites (tipo, ip) values ('conta', coalesce(p_ip, ''));
  return true;
end $$;
create or replace function public.sin_usuario_existe(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from auth.users where lower(email) = lower(trim(p_email)))
$$;
revoke execute on function public.sin_conta_limite(text) from public, anon, authenticated;
revoke execute on function public.sin_usuario_existe(text) from public, anon, authenticated;
grant execute on function public.sin_conta_limite(text) to service_role;
grant execute on function public.sin_usuario_existe(text) to service_role;

-- ---------------------------------------------------------------- permissões
do $$ declare f text; begin
  foreach f in array array['_sin_eu()', '_sin_limite(text,int)', '_sin_id_dia(uuid)', '_sin_espelho(text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['sin_perfil()', 'sin_perfil_salvar(text)', 'sin_excluir_tudo()', 'sin_espelho(text)',
      'sin_auto_salvar(text,smallint[])', 'sin_nova_rodada(text)', 'sin_circulo_criar(text,text)', 'sin_circulo_excluir(bigint)',
      'sin_qr_gerar()', 'sin_qr_usar(text)', 'sin_fichas()', 'sin_avaliar(bigint,smallint[])', 'sin_minha_nota()',
      'sin_mapa_visivel(boolean)', 'sin_mapa(numeric,numeric,int)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['sin_convite_ler(text)', 'sin_responder(text,text,smallint[])'] loop
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
