-- NVAura 1.7 — gestão pela equipe Nervia (pedido do Marco em 25/11/2026: "coloca este app no ecossistema Nervia, quero ter
-- uma tela de gerenciamento: quantidade de pessoas usando, quantidade de avaliações, ids mais avaliados e o que você achar
-- bom gerenciar; a parte de gerenciamento deve ter a segurança do ecossistema Nervia; o acesso à avaliação e o
-- autocadastramento não podem ter login e senha").
-- * App "aura" na Área do Cliente (oculto na vitrine): só a equipe Nervia (eh_admin), com o login do ecossistema.
-- * As tabelas aur_ continuam sem acesso pela tela; o painel lê só pela aur_admin_painel (security definer + eh_admin).
-- * Nem a equipe Nervia vê quem deu cada nota: a nota não guarda autor (regra da 1.0). O painel mostra totais, médias e o
--   nome que a própria pessoa pôs no cartão (público para quem lê o QR).
-- * Moderação: bloquear um cartão (nome/foto ofensivos, abuso) e tirar a foto, sempre com motivo e auditoria.

alter table public.aur_cartoes
  add column bloqueado boolean not null default false,
  add column bloqueado_motivo text,
  add column bloqueado_em timestamptz;

-- id curto e estável para a gestão (não é o código do QR nem o código do dia)
create or replace function public._aur_id_gestao(p_user uuid) returns text
language sql immutable as $$ select 'AU#' || upper(left(md5(p_user::text), 6)) $$;
revoke execute on function public._aur_id_gestao(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- regras do cartão bloqueado
create or replace function public.aur_meu_cartao() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := auth.uid(); c aur_cartoes;
begin
  if v is null then return null; end if;
  select * into c from aur_cartoes where user_id = v;
  if c.user_id is null then return jsonb_build_object('existe', false, 'nome', (select nome from perfis where user_id = v)); end if;
  return jsonb_build_object('existe', true, 'nome', c.nome, 'foto', c.foto, 'codigo', c.codigo, 'mapa_visivel', c.mapa_visivel,
    'id_dia', public._aur_id_dia(v), 'nota', public._aur_nota(v),
    'pedidos', (select count(*) from aur_leituras where alvo = v),
    'bloqueado', c.bloqueado, 'bloqueado_motivo', c.bloqueado_motivo);
end $$;

create or replace function public.aur_cartao_ler(p_codigo text, p_marca text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c aur_cartoes; d date := public._aur_hoje();
begin
  perform public._aur_limite('ler', 120);
  select * into c from aur_cartoes where codigo = upper(trim(coalesce(p_codigo, '')));
  if c.user_id is null then return null; end if;
  if c.bloqueado then return jsonb_build_object('bloqueado', true, 'meu', c.user_id = auth.uid()); end if;
  if c.user_id is distinct from auth.uid() and length(coalesce(p_marca, '')) between 16 and 100 then
    delete from aur_leituras where dia < d - 400;
    insert into aur_leituras (chave, alvo, dia)
    values (encode(sha256(convert_to(p_marca || ':' || c.user_id || ':' || d, 'UTF8')), 'hex'), c.user_id, d)
    on conflict (chave) do nothing;
  end if;
  return jsonb_build_object('nome', c.nome, 'foto', c.foto, 'nota', public._aur_nota(c.user_id), 'meu', c.user_id = auth.uid());
end $$;
revoke execute on function public.aur_cartao_ler(text, text) from public;
grant execute on function public.aur_cartao_ler(text, text) to anon, authenticated;

create or replace function public.aur_avaliar(p_codigo text, p_marca text, p_nota int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c aur_cartoes; k text; d date := public._aur_hoje(); pend int;
begin
  perform public._aur_limite('avaliar', 30);
  select * into c from aur_cartoes where codigo = upper(trim(coalesce(p_codigo, '')));
  if c.user_id is null then raise exception 'Cartão não encontrado. Peça para a pessoa mostrar o QR de novo.'; end if;
  if c.bloqueado then raise exception 'Este cartão está indisponível no momento.'; end if;
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
  select count(*) into pend from aur_notas where alvo = c.user_id and not liberada;
  if pend >= 5 then update aur_notas set liberada = true where alvo = c.user_id and not liberada; end if;
  return jsonb_build_object('ok', true, 'nome', c.nome);
end $$;
revoke execute on function public.aur_avaliar(text, text, int) from public;
grant execute on function public.aur_avaliar(text, text, int) to anon, authenticated;

-- radar: cartão bloqueado não aparece
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
          where ps.user_id <> v and ca.mapa_visivel and not ca.bloqueado and ps.em > now() - interval '30 minutes') x
    where sqrt(x.dx ^ 2 + x.dy ^ 2) <= r), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- painel da gestão (só equipe Nervia)
create or replace function public.aur_admin_painel(p_dias int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare dias int := least(greatest(coalesce(p_dias, 30), 1), 365); de date := public._aur_hoje() - (least(greatest(coalesce(p_dias, 30), 1), 365) - 1);
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia.'; end if;
  return jsonb_build_object(
    'dias', dias, 'de', de, 'hoje', public._aur_hoje(),
    'pessoas', jsonb_build_object(
      'cartoes', (select count(*) from aur_cartoes),
      'com_foto', (select count(*) from aur_cartoes where foto is not null),
      'novos', (select count(*) from aur_cartoes where (criado_em at time zone 'America/Sao_Paulo')::date >= de),
      'avaliados', (select count(distinct alvo) from aur_notas),
      'ativos', (select count(distinct alvo) from (select alvo from aur_notas where dia >= de union all select alvo from aur_leituras where dia >= de) x),
      'radar_ligado', (select count(*) from aur_cartoes where mapa_visivel),
      'radar_agora', (select count(*) from aur_posicoes where em > now() - interval '30 minutes'),
      'bloqueados', (select count(*) from aur_cartoes where bloqueado)),
    'avaliacoes', jsonb_build_object(
      'total', (select count(*) from aur_notas),
      'na_nota', (select count(*) from aur_notas where liberada),
      'esperando', (select count(*) from aur_notas where not liberada),
      'periodo', (select count(*) from aur_notas where dia >= de),
      'media', (select round(avg(nota)::numeric, 2) from aur_notas where liberada),
      'estrelas', (select jsonb_agg((select count(*) from aur_notas where nota = e) order by e) from generate_series(1, 5) e)),
    'pedidos', jsonb_build_object(
      'total', (select count(*) from aur_leituras),
      'periodo', (select count(*) from aur_leituras where dia >= de)),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', g::date,
        'avaliacoes', (select count(*) from aur_notas where dia = g::date),
        'pedidos', (select count(*) from aur_leituras where dia = g::date),
        'novos', (select count(*) from aur_cartoes where (criado_em at time zone 'America/Sao_Paulo')::date = g::date)) order by g), '[]'::jsonb)
      from generate_series(de, public._aur_hoje(), interval '1 day') g),
    -- picos: um cartão com 10 ou mais avaliações no mesmo dia (sinal de QR repassado ou combinado)
    'picos', (select coalesce(jsonb_agg(jsonb_build_object('id', public._aur_id_gestao(alvo), 'user_id', alvo,
        'nome', (select nome from aur_cartoes where user_id = alvo), 'dia', dia, 'avaliacoes', n) order by dia desc, n desc), '[]'::jsonb)
      from (select alvo, dia, count(*) as n from aur_notas where dia >= de group by alvo, dia having count(*) >= 10) p),
    'cartoes', (select coalesce(jsonb_agg(x order by (x ->> 'total')::int desc, x ->> 'criado_em' desc), '[]'::jsonb) from (
      select jsonb_build_object('id', public._aur_id_gestao(c.user_id), 'user_id', c.user_id, 'nome', c.nome, 'foto', c.foto,
        'criado_em', c.criado_em, 'radar', c.mapa_visivel, 'bloqueado', c.bloqueado, 'bloqueado_motivo', c.bloqueado_motivo,
        'total', (select count(*) from aur_notas where alvo = c.user_id),
        'na_nota', (select count(*) from aur_notas where alvo = c.user_id and liberada),
        'media', (select round(avg(nota)::numeric, 1) from aur_notas where alvo = c.user_id and liberada),
        'periodo', (select count(*) from aur_notas where alvo = c.user_id and dia >= de),
        'pedidos', (select count(*) from aur_leituras where alvo = c.user_id),
        'ultima', (select max(dia) from aur_notas where alvo = c.user_id)) as x
      from aur_cartoes c) t));
end $$;

-- bloquear / desbloquear um cartão (motivo obrigatório para bloquear)
create or replace function public.aur_admin_bloquear(p_user uuid, p_bloquear boolean, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c aur_cartoes; m text := trim(coalesce(p_motivo, ''));
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia.'; end if;
  select * into c from aur_cartoes where user_id = p_user;
  if c.user_id is null then raise exception 'Cartão não encontrado.'; end if;
  if p_bloquear and length(m) < 5 then raise exception 'Informe o motivo do bloqueio (5 letras ou mais).'; end if;
  update aur_cartoes set bloqueado = coalesce(p_bloquear, false),
    bloqueado_motivo = case when p_bloquear then m end, bloqueado_em = case when p_bloquear then now() end
  where user_id = p_user;
  if p_bloquear then delete from aur_posicoes where user_id = p_user; end if;
  perform public.auditar(case when p_bloquear then 'aura_cartao_bloqueado' else 'aura_cartao_desbloqueado' end, null,
    jsonb_build_object('cartao', public._aur_id_gestao(p_user), 'nome', c.nome, 'motivo', nullif(m, '')));
  return jsonb_build_object('ok', true);
end $$;

-- tirar a foto de um cartão (foto ofensiva ou que não é a pessoa)
create or replace function public.aur_admin_tirar_foto(p_user uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c aur_cartoes; m text := trim(coalesce(p_motivo, ''));
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia.'; end if;
  select * into c from aur_cartoes where user_id = p_user;
  if c.user_id is null then raise exception 'Cartão não encontrado.'; end if;
  if length(m) < 5 then raise exception 'Informe o motivo (5 letras ou mais).'; end if;
  update aur_cartoes set foto = null where user_id = p_user;
  perform public.auditar('aura_foto_retirada', null, jsonb_build_object('cartao', public._aur_id_gestao(p_user), 'nome', c.nome, 'motivo', m));
  return jsonb_build_object('ok', true);
end $$;

do $$ declare f text; begin
  foreach f in array array['aur_admin_painel(int)', 'aur_admin_bloquear(uuid,boolean,text)', 'aur_admin_tirar_foto(uuid,text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- o app de gestão na Área do Cliente (só a equipe Nervia o vê; fora da vitrine)
insert into public.apps (id, nome, descricao, url, icone, ordem, ativo, cartao_url, manual_url, situacao)
values ('aura', 'NVAura — gestão', 'Quantas pessoas usam o NVAura, avaliações, pedidos, cartões mais avaliados, alertas e moderação.',
        '/apps/aura/', 'AU', 99, true, '/apps/aura/ajuda/cartao.html', '/apps/aura/ajuda/manual.html', 'oculto')
on conflict (id) do nothing;
