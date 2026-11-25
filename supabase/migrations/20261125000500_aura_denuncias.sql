-- NVAura 1.8 — denúncia de foto ou nome impróprio (o Marco se preocupou com fotos impróprias, 25/11/2026; decisão dele:
-- a foto continua aparecendo na hora, sem aprovação antes, e quem vê o cartão pode denunciar).
-- * Quem lê o QR (sem conta) denuncia: foto, nome ou outro, com texto opcional. Sem autor: só um hash por aparelho, cartão
--   e dia, para valer 1 denúncia por celular por cartão por dia. Limite de 10 denúncias por hora por IP.
-- * Proteção automática: 3 denúncias de FOTO ainda abertas, de celulares diferentes = a foto some do cartão (foto_oculta)
--   até a equipe Nervia revisar. O dono vê o aviso.
-- * A equipe Nervia resolve na gestão (aba Alertas): manter (devolve a foto), tirar a foto ou bloquear o cartão;
--   tudo com auditoria.

alter table public.aur_cartoes add column foto_oculta boolean not null default false;

create table public.aur_denuncias (
  id           bigint generated always as identity primary key,
  alvo         uuid not null references public.aur_cartoes on delete cascade,
  motivo       text not null check (motivo in ('foto', 'nome', 'outro')),
  texto        text check (length(texto) <= 300),
  dia          date not null default public._aur_hoje(),
  resolvida_em timestamptz,
  resolucao    text
);
create index on public.aur_denuncias (alvo) where resolvida_em is null;
create table public.aur_denunciados (
  chave text primary key,                       -- sha256(marca do aparelho : cartão : dia)
  dia   date not null default public._aur_hoje()
);
alter table public.aur_denuncias enable row level security;
alter table public.aur_denunciados enable row level security;
revoke all on public.aur_denuncias from anon, authenticated;
revoke all on public.aur_denunciados from anon, authenticated;

-- ---------------------------------------------------------------- foto escondida não sai para ninguém (só a gestão vê)
create or replace function public.aur_meu_cartao() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := auth.uid(); c aur_cartoes;
begin
  if v is null then return null; end if;
  select * into c from aur_cartoes where user_id = v;
  if c.user_id is null then return jsonb_build_object('existe', false, 'nome', (select nome from perfis where user_id = v)); end if;
  return jsonb_build_object('existe', true, 'nome', c.nome, 'foto', case when c.foto_oculta then null else c.foto end,
    'foto_oculta', c.foto_oculta, 'codigo', c.codigo, 'mapa_visivel', c.mapa_visivel,
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
  return jsonb_build_object('nome', c.nome, 'foto', case when c.foto_oculta then null else c.foto end,
    'nota', public._aur_nota(c.user_id), 'meu', c.user_id = auth.uid());
end $$;
revoke execute on function public.aur_cartao_ler(text, text) from public;
grant execute on function public.aur_cartao_ler(text, text) to anon, authenticated;

-- trocar a foto (pelo dono) tira o "escondida" e encerra as denúncias de foto abertas: a foto denunciada saiu
create or replace function public._aur_foto_trocada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.foto is distinct from old.foto then
    new.foto_oculta := false;
    update aur_denuncias set resolvida_em = now(), resolucao = 'foto trocada'
    where alvo = new.user_id and motivo = 'foto' and resolvida_em is null;
  end if;
  return new;
end $$;
create trigger aur_cartoes_foto_trocada before update of foto on public.aur_cartoes
  for each row execute function public._aur_foto_trocada();

-- ---------------------------------------------------------------- denunciar (sem login)
create or replace function public.aur_denunciar(p_codigo text, p_marca text, p_motivo text, p_texto text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c aur_cartoes; d date := public._aur_hoje(); k text; t text := nullif(trim(coalesce(p_texto, '')), '');
begin
  perform public._aur_limite('denunciar', 10);
  select * into c from aur_cartoes where codigo = upper(trim(coalesce(p_codigo, '')));
  if c.user_id is null or c.bloqueado then raise exception 'Cartão não encontrado.'; end if;
  if c.user_id = auth.uid() then raise exception 'Este é o seu cartão.'; end if;
  if p_motivo not in ('foto', 'nome', 'outro') then raise exception 'Escolha o motivo da denúncia.'; end if;
  if p_motivo = 'outro' and t is null then raise exception 'Conte o que aconteceu.'; end if;
  if coalesce(length(p_marca), 0) < 16 or length(p_marca) > 100 then raise exception 'Aparelho não identificado. Recarregue a página.'; end if;
  k := encode(sha256(convert_to('denuncia:' || p_marca || ':' || c.user_id || ':' || d, 'UTF8')), 'hex');
  delete from aur_denunciados where dia < d - 1;
  begin
    insert into aur_denunciados (chave, dia) values (k, d);
  exception when unique_violation then
    raise exception 'Você já denunciou este cartão hoje. A equipe Nervia vai olhar.';
  end;
  insert into aur_denuncias (alvo, motivo, texto) values (c.user_id, p_motivo, left(t, 300));
  -- 3 denúncias de foto abertas = a foto some até a revisão
  if p_motivo = 'foto' and c.foto is not null
     and (select count(*) from aur_denuncias where alvo = c.user_id and motivo = 'foto' and resolvida_em is null) >= 3 then
    update aur_cartoes set foto_oculta = true where user_id = c.user_id and not foto_oculta;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.aur_denunciar(text, text, text, text) from public;
grant execute on function public.aur_denunciar(text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------- gestão: denúncias abertas e recentes
create or replace function public.aur_admin_denuncias() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia.'; end if;
  return jsonb_build_object(
    'abertas', (select coalesce(jsonb_agg(x order by x ->> 'ultima' desc), '[]'::jsonb) from (
      select jsonb_build_object('user_id', c.user_id, 'id', public._aur_id_gestao(c.user_id), 'nome', c.nome, 'foto', c.foto,
        'foto_oculta', c.foto_oculta, 'bloqueado', c.bloqueado,
        'foto_n', count(*) filter (where d.motivo = 'foto'), 'nome_n', count(*) filter (where d.motivo = 'nome'),
        'outro_n', count(*) filter (where d.motivo = 'outro'),
        'textos', coalesce(jsonb_agg(jsonb_build_object('motivo', d.motivo, 'texto', d.texto, 'dia', d.dia)) filter (where d.texto is not null), '[]'::jsonb),
        'primeira', min(d.dia), 'ultima', max(d.dia)) as x
      from aur_denuncias d join aur_cartoes c on c.user_id = d.alvo
      where d.resolvida_em is null group by c.user_id) t),
    'resolvidas', (select coalesce(jsonb_agg(jsonb_build_object('id', public._aur_id_gestao(d.alvo),
        'nome', (select nome from aur_cartoes where user_id = d.alvo), 'motivo', d.motivo, 'dia', d.dia,
        'resolvida_em', d.resolvida_em, 'resolucao', d.resolucao) order by d.resolvida_em desc), '[]'::jsonb)
      from (select * from aur_denuncias where resolvida_em is not null order by resolvida_em desc limit 50) d));
end $$;

-- resolver as denúncias abertas de um cartão: manter (devolve a foto), tirar_foto ou bloquear
create or replace function public.aur_admin_denuncia_resolver(p_user uuid, p_acao text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c aur_cartoes; m text := trim(coalesce(p_motivo, '')); n int;
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia.'; end if;
  select * into c from aur_cartoes where user_id = p_user;
  if c.user_id is null then raise exception 'Cartão não encontrado.'; end if;
  if p_acao not in ('manter', 'tirar_foto', 'bloquear') then raise exception 'Ação inválida.'; end if;
  if p_acao <> 'manter' and length(m) < 5 then raise exception 'Informe o motivo (5 letras ou mais).'; end if;
  if p_acao = 'tirar_foto' then
    update aur_cartoes set foto = null where user_id = p_user;      -- o gatilho tira o "escondida" e fecha as de foto
  elsif p_acao = 'bloquear' then
    update aur_cartoes set bloqueado = true, bloqueado_motivo = m, bloqueado_em = now() where user_id = p_user;
    delete from aur_posicoes where user_id = p_user;
  else
    update aur_cartoes set foto_oculta = false where user_id = p_user;
  end if;
  update aur_denuncias set resolvida_em = now(),
    resolucao = case p_acao when 'manter' then 'mantido' when 'tirar_foto' then 'foto retirada' else 'cartão bloqueado' end
  where alvo = p_user and resolvida_em is null;
  get diagnostics n = row_count;
  perform public.auditar('aura_denuncia_resolvida', null, jsonb_build_object('cartao', public._aur_id_gestao(p_user), 'nome', c.nome,
    'acao', p_acao, 'motivo', nullif(m, ''), 'denuncias', n));
  return jsonb_build_object('ok', true);
end $$;

do $$ declare f text; begin
  foreach f in array array['aur_admin_denuncias()', 'aur_admin_denuncia_resolver(uuid,text,text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
