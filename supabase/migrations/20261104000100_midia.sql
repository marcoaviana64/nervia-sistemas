-- App "Mídia Indoor" (prefixo mi_), fase 1. Pedido do Marco em 04/11/2026.
--
-- Como funciona (decisão do Marco em 04/11/2026: as mídias ficam no Google Drive do cliente, sem upload):
--   * cada cliente (mi_contas) tem UMA pasta do Google Drive compartilhada com "qualquer pessoa com o link";
--   * cada SUBPASTA é uma playlist (os arquivos soltos na pasta principal formam a playlist "Pasta principal");
--   * a ordem de exibição é a do nome do arquivo (01_..., 02_...); imagens ficam o tempo padrão da conta
--     ou o tempo próprio definido no painel (mi_midias.tempo_s);
--   * a Edge Function "midia" lê a pasta pela API oficial do Drive (chave de API da Nervia, só arquivos públicos),
--     confere cada vídeo (MP4, H.264, até 1080p, até 300 MB) e grava aqui pela mi_sinc_gravar;
--   * a TV (app Android) fala só com a Edge Function "midia-tv": pede o código de 6 caracteres, recebe o token
--     depois do vínculo, pede a playlist (lista + impressão digital md5 de cada arquivo) e manda o sinal de vida.
--     A TV baixa os arquivos direto do Drive e toca do armazenamento local.
--
-- Quem vê: a equipe Nervia (admin) tudo; o cliente só as contas liberadas para o login dele (mi_acessos).
-- Toda escrita é pelas funções abaixo (com auditoria); a tela só lê. O token da TV fica só em hash (sha256).

create table if not exists public.mi_contas (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null check (length(trim(nome)) > 0),
  pasta_url       text not null default '',
  pasta_id        text not null default '' check (pasta_id ~ '^[A-Za-z0-9_-]*$'),
  pasta_chave     text not null default '',            -- resourcekey das pastas compartilhadas antes de 2021
  tempo_imagem_s  int  not null default 10 check (tempo_imagem_s between 3 and 300),
  limite_mb       int  not null default 5000 check (limite_mb between 100 and 100000),  -- soma das mídias que a TV guarda
  ativo           boolean not null default true,
  sinc_iniciado_em timestamptz,
  sincronizado_em timestamptz,
  sinc_erro       text not null default '',
  criado_em       timestamptz not null default now()
);

create table if not exists public.mi_acessos (
  user_id  uuid references auth.users on delete cascade,
  conta_id uuid references public.mi_contas on delete cascade,
  primary key (user_id, conta_id)
);

-- uma linha por subpasta (playlist)
create table if not exists public.mi_playlists (
  id        uuid primary key default gen_random_uuid(),
  conta_id  uuid not null references public.mi_contas on delete cascade,
  drive_id  text not null,
  chave     text not null default '',
  nome      text not null,
  raiz      boolean not null default false,               -- arquivos soltos na pasta principal
  unique (conta_id, drive_id)
);

-- uma linha por arquivo de cada playlist, na ordem de exibição
create table if not exists public.mi_midias (
  id          uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.mi_playlists on delete cascade,
  drive_id    text not null,
  chave       text not null default '',
  nome        text not null,
  mime        text not null default '',
  md5         text not null default '',
  tamanho     bigint not null default 0,
  modificado  timestamptz,
  posicao     int not null default 0,
  tipo        text not null default 'outro' check (tipo in ('video', 'imagem', 'outro')),
  situacao    text not null default 'ok' check (situacao in ('ok', 'recusado')),
  motivo      text not null default '',
  largura     int,
  altura      int,
  duracao_s   numeric(10,2),
  codec       text not null default '',
  tempo_s     int check (tempo_s between 3 and 300),       -- tempo próprio da imagem (vazio = padrão da conta)
  unique (playlist_id, drive_id)
);
create index if not exists mi_midias_playlist on public.mi_midias (playlist_id, posicao);

create table if not exists public.mi_telas (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references public.mi_contas on delete cascade,
  nome          text not null check (length(trim(nome)) > 0),
  playlist_id   uuid references public.mi_playlists on delete set null,
  aparelho      text not null default '',                 -- identificador gerado pelo app na 1ª abertura
  token_hash    text unique,
  vinculada_em  timestamptz not null default now(),
  ultimo_sinal  timestamptz,
  versao_app    text not null default '',
  modelo        text not null default '',
  android       text not null default '',
  tocando       text not null default '',
  conteudo      text not null default '',                 -- versão do conteúdo que a TV já tem
  espaco_livre_mb int,
  baixando      int not null default 0,                   -- arquivos ainda faltando baixar
  erros         jsonb not null default '[]'::jsonb        -- [{nome, erro}] (ex.: vídeo que o aparelho não toca)
);

-- códigos de 6 caracteres mostrados na TV (válidos por 10 min)
create table if not exists public.mi_codigos_vinculo (
  codigo     text primary key check (codigo ~ '^[A-Z0-9]{6}$'),
  aparelho   text not null,
  ip         text not null default '',
  criado_em  timestamptz not null default now(),
  expira_em  timestamptz not null default now() + interval '10 minutes',
  tela_id    uuid references public.mi_telas on delete cascade,
  entregue   boolean not null default false               -- token já entregue à TV
);
create index if not exists mi_codigos_aparelho on public.mi_codigos_vinculo (aparelho, criado_em desc);

-- ---------------------------------------------------------------- acesso
create or replace function public.mi_pode_ver(p_conta uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or exists (select 1 from public.mi_acessos where conta_id = p_conta and user_id = auth.uid())
$$;

alter table public.mi_contas enable row level security;
alter table public.mi_acessos enable row level security;
alter table public.mi_playlists enable row level security;
alter table public.mi_midias enable row level security;
alter table public.mi_telas enable row level security;
alter table public.mi_codigos_vinculo enable row level security;

revoke all on public.mi_contas, public.mi_acessos, public.mi_playlists, public.mi_midias, public.mi_telas,
  public.mi_codigos_vinculo from anon;
revoke all on public.mi_codigos_vinculo from authenticated;   -- só as funções (service role) leem os códigos
revoke insert, update, delete on public.mi_playlists, public.mi_midias, public.mi_telas from authenticated;
-- a tela lê a TV sem o hash do token
revoke select on public.mi_telas from authenticated;
grant select (id, conta_id, nome, playlist_id, aparelho, vinculada_em, ultimo_sinal, versao_app, modelo, android, tocando,
  conteudo, espaco_livre_mb, baixando, erros) on public.mi_telas to authenticated;
-- conta: a equipe Nervia cadastra; nome, pasta e tempo mudam pela mi_conta_salvar
revoke insert, update, delete on public.mi_contas from authenticated;
grant insert (id, nome, limite_mb, ativo) on public.mi_contas to authenticated;
grant update (nome, limite_mb, ativo) on public.mi_contas to authenticated;
grant delete on public.mi_contas to authenticated;

drop policy if exists mi_contas_ler on public.mi_contas;
create policy mi_contas_ler on public.mi_contas for select using (public.mi_pode_ver(id));
drop policy if exists mi_contas_admin on public.mi_contas;
create policy mi_contas_admin on public.mi_contas for all using (public.eh_admin()) with check (public.eh_admin());
drop policy if exists mi_acessos_ler on public.mi_acessos;
create policy mi_acessos_ler on public.mi_acessos for select using (user_id = auth.uid() or public.eh_admin());
drop policy if exists mi_acessos_admin on public.mi_acessos;
create policy mi_acessos_admin on public.mi_acessos for all using (public.eh_admin()) with check (public.eh_admin());
drop policy if exists mi_playlists_ler on public.mi_playlists;
create policy mi_playlists_ler on public.mi_playlists for select using (public.mi_pode_ver(conta_id));
drop policy if exists mi_midias_ler on public.mi_midias;
create policy mi_midias_ler on public.mi_midias for select
  using (exists (select 1 from public.mi_playlists p where p.id = playlist_id and public.mi_pode_ver(p.conta_id)));
drop policy if exists mi_telas_ler on public.mi_telas;
create policy mi_telas_ler on public.mi_telas for select using (public.mi_pode_ver(conta_id));

-- ---------------------------------------------------------------- pasta do Drive
-- aceita o link da pasta como o Drive mostra em "Copiar link":
--   https://drive.google.com/drive/folders/<id>?usp=sharing   (com ou sem /u/0/, com ou sem resourcekey=)
--   https://drive.google.com/open?id=<id>                      (links antigos)
create or replace function public.mi_pasta_do_link(p_url text, out pasta_id text, out chave text)
language plpgsql immutable as $$
declare u text := trim(coalesce(p_url, ''));
begin
  pasta_id := coalesce(substring(u from '/folders/([A-Za-z0-9_-]{10,})'), substring(u from '[?&]id=([A-Za-z0-9_-]{10,})'), '');
  chave := coalesce(substring(u from '[?&]resourcekey=([A-Za-z0-9_-]+)'), '');
end $$;

create or replace function public.mi_conta_salvar(p_conta uuid, p_pasta_url text, p_tempo int) returns void
language plpgsql security definer set search_path = public as $$
declare v record; p record; u text := trim(coalesce(p_pasta_url, ''));
begin
  if not public.mi_pode_ver(p_conta) then raise exception 'Sem acesso a esta conta.'; end if;
  select * into v from public.mi_contas where id = p_conta;
  if not found then raise exception 'Conta não encontrada.'; end if;
  if p_tempo is null or p_tempo not between 3 and 300 then raise exception 'O tempo das imagens vai de 3 a 300 segundos.'; end if;
  select * into p from public.mi_pasta_do_link(u);
  if u <> '' and p.pasta_id = '' then
    raise exception 'Link de pasta do Google Drive não reconhecido. No Drive, clique com o botão direito na pasta → Compartilhar → Copiar link.';
  end if;
  update public.mi_contas set pasta_url = u, pasta_id = p.pasta_id, pasta_chave = p.chave, tempo_imagem_s = p_tempo,
    sincronizado_em = case when p.pasta_id is distinct from v.pasta_id then null else sincronizado_em end,
    sinc_iniciado_em = case when p.pasta_id is distinct from v.pasta_id then null else sinc_iniciado_em end
   where id = p_conta;
  if p.pasta_id is distinct from v.pasta_id then
    delete from public.mi_playlists where conta_id = p_conta;      -- as TVs ficam sem playlist até escolher outra
    perform public.auditar('midia_pasta_alterada', null, jsonb_build_object('conta', v.nome, 'conta_id', p_conta,
      'antes', v.pasta_url, 'depois', u));
  end if;
  if p_tempo <> v.tempo_imagem_s then
    perform public.auditar('midia_tempo_alterado', null, jsonb_build_object('conta', v.nome, 'conta_id', p_conta,
      'antes', v.tempo_imagem_s, 'depois', p_tempo));
  end if;
end $$;
revoke execute on function public.mi_conta_salvar(uuid, text, int) from public, anon;

create or replace function public.mi_midia_tempo(p_midia uuid, p_tempo int) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select m.nome, m.tipo, m.tempo_s, p.conta_id, p.nome as playlist into v
    from public.mi_midias m join public.mi_playlists p on p.id = m.playlist_id where m.id = p_midia;
  if not found or not public.mi_pode_ver(v.conta_id) then raise exception 'Mídia não encontrada.'; end if;
  if v.tipo <> 'imagem' then raise exception 'Só imagens têm tempo na tela; o vídeo usa a própria duração.'; end if;
  if p_tempo is not null and p_tempo not between 3 and 300 then raise exception 'O tempo vai de 3 a 300 segundos.'; end if;
  update public.mi_midias set tempo_s = p_tempo where id = p_midia;
end $$;
revoke execute on function public.mi_midia_tempo(uuid, int) from public, anon;

-- ---------------------------------------------------------------- TVs (painel)
create or replace function public.mi_vincular(p_codigo text, p_conta uuid, p_nome text, p_playlist uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c record; v_id uuid; v_conta text; cod text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not public.mi_pode_ver(p_conta) then raise exception 'Sem acesso a esta conta.'; end if;
  if length(trim(coalesce(p_nome, ''))) = 0 then raise exception 'Dê um nome para encontrar a TV depois.'; end if;
  if cod !~ '^[A-Z0-9]{6}$' then raise exception 'O código tem 6 letras ou números. Confira o que aparece na TV.'; end if;
  if p_playlist is not null and not exists (select 1 from public.mi_playlists where id = p_playlist and conta_id = p_conta) then
    raise exception 'Playlist não encontrada nesta conta.';
  end if;
  select * into c from public.mi_codigos_vinculo where codigo = cod for update;
  if not found then raise exception 'Código não encontrado. Confira o que aparece na TV.'; end if;
  if c.tela_id is not null then raise exception 'Este código já foi usado. Aguarde a TV mostrar um código novo.'; end if;
  if c.expira_em < now() then raise exception 'Este código venceu (vale 10 minutos). A TV já mostra um código novo: digite o novo.'; end if;
  insert into public.mi_telas (conta_id, nome, playlist_id, aparelho) values (p_conta, trim(p_nome), p_playlist, c.aparelho)
    returning id into v_id;
  update public.mi_codigos_vinculo set tela_id = v_id where codigo = cod;
  select nome into v_conta from public.mi_contas where id = p_conta;
  perform public.auditar('midia_tv_vinculada', null, jsonb_build_object('conta', v_conta, 'conta_id', p_conta, 'tela', trim(p_nome),
    'tela_id', v_id, 'playlist', (select nome from public.mi_playlists where id = p_playlist)));
  return v_id;
end $$;
revoke execute on function public.mi_vincular(text, uuid, text, uuid) from public, anon;

create or replace function public.mi_tela_salvar(p_tela uuid, p_nome text, p_playlist uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select * into t from public.mi_telas where id = p_tela;
  if not found or not public.mi_pode_ver(t.conta_id) then raise exception 'TV não encontrada.'; end if;
  if length(trim(coalesce(p_nome, ''))) = 0 then raise exception 'Dê um nome para a TV.'; end if;
  if p_playlist is not null and not exists (select 1 from public.mi_playlists where id = p_playlist and conta_id = t.conta_id) then
    raise exception 'Playlist não encontrada nesta conta.';
  end if;
  update public.mi_telas set nome = trim(p_nome), playlist_id = p_playlist where id = p_tela;
  if p_playlist is distinct from t.playlist_id then
    perform public.auditar('midia_playlist_trocada', null, jsonb_build_object('conta', (select nome from public.mi_contas where id = t.conta_id),
      'conta_id', t.conta_id, 'tela', trim(p_nome), 'tela_id', p_tela,
      'antes', (select nome from public.mi_playlists where id = t.playlist_id), 'depois', (select nome from public.mi_playlists where id = p_playlist)));
  end if;
end $$;
revoke execute on function public.mi_tela_salvar(uuid, text, uuid) from public, anon;

create or replace function public.mi_desvincular(p_tela uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select * into t from public.mi_telas where id = p_tela;
  if not found or not public.mi_pode_ver(t.conta_id) then raise exception 'TV não encontrada.'; end if;
  delete from public.mi_telas where id = p_tela;   -- o token deixa de valer: a TV volta para a tela do código
  perform public.auditar('midia_tv_desvinculada', null, jsonb_build_object('conta', (select nome from public.mi_contas where id = t.conta_id),
    'conta_id', t.conta_id, 'tela', t.nome, 'tela_id', p_tela, 'aparelho', t.modelo));
end $$;
revoke execute on function public.mi_desvincular(uuid) from public, anon;

-- ---------------------------------------------------------------- TV (só pela Edge Function midia-tv, com service role)
-- código novo para o aparelho (reaproveita o que ainda vale; no máximo 12 códigos por hora por aparelho e 60 por IP)
create or replace function public.mi_tv_codigo(p_aparelho text, p_ip text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; v_cod text; i int := 0;
  alfabeto text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- sem 0/O e 1/I, que se confundem na TV
begin
  if coalesce(p_aparelho, '') !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'Aparelho inválido.'; end if;
  delete from public.mi_codigos_vinculo where expira_em < now() - interval '1 day';
  select * into c from public.mi_codigos_vinculo where aparelho = p_aparelho and tela_id is null and expira_em > now() + interval '1 minute'
    order by criado_em desc limit 1;
  if found then return jsonb_build_object('codigo', c.codigo, 'expira_em', c.expira_em); end if;
  if (select count(*) from public.mi_codigos_vinculo where aparelho = p_aparelho and criado_em > now() - interval '1 hour') >= 12
     or (select count(*) from public.mi_codigos_vinculo where ip = coalesce(p_ip, '') and coalesce(p_ip, '') <> '' and criado_em > now() - interval '1 hour') >= 60 then
    raise exception 'Muitos códigos pedidos. Aguarde alguns minutos.';
  end if;
  loop
    v_cod := '';
    for k in 1..6 loop v_cod := v_cod || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1); end loop;
    exit when not exists (select 1 from public.mi_codigos_vinculo where codigo = v_cod);
    i := i + 1; if i > 20 then raise exception 'Não foi possível gerar o código.'; end if;
  end loop;
  insert into public.mi_codigos_vinculo (codigo, aparelho, ip) values (v_cod, p_aparelho, coalesce(p_ip, ''))
    returning * into c;
  return jsonb_build_object('codigo', c.codigo, 'expira_em', c.expira_em);
end $$;

-- a TV pergunta se o código já foi vinculado; na 1ª resposta positiva recebe o token (uma vez só)
create or replace function public.mi_tv_aguardar(p_aparelho text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; v_tok text;
begin
  select * into c from public.mi_codigos_vinculo where codigo = upper(coalesce(p_codigo, '')) and aparelho = coalesce(p_aparelho, '') for update;
  if not found then return jsonb_build_object('situacao', 'desconhecido'); end if;
  if c.tela_id is null then
    return jsonb_build_object('situacao', case when c.expira_em < now() then 'expirado' else 'aguardando' end);
  end if;
  if c.entregue then return jsonb_build_object('situacao', 'usado'); end if;
  v_tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update public.mi_telas set token_hash = encode(sha256(convert_to(v_tok, 'UTF8')), 'hex') where id = c.tela_id;
  update public.mi_codigos_vinculo set entregue = true where codigo = c.codigo;
  return jsonb_build_object('situacao', 'vinculado', 'token', v_tok,
    'tela', (select nome from public.mi_telas where id = c.tela_id));
end $$;

-- identifica a TV pelo token (null = token inválido ou TV desvinculada)
create or replace function public.mi_tv_tela(p_token text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.mi_telas where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

-- sinal de vida: no máximo 1 a cada 20 s por TV (os outros são ignorados)
create or replace function public.mi_tv_sinal(p_token text, p_dados jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_id uuid := public.mi_tv_tela(p_token); d jsonb := coalesce(p_dados, '{}'::jsonb);
begin
  if v_id is null then return false; end if;
  update public.mi_telas set ultimo_sinal = now(),
      versao_app = left(coalesce(d->>'versao_app', versao_app), 30),
      modelo = left(coalesce(d->>'modelo', modelo), 80),
      android = left(coalesce(d->>'android', android), 30),
      tocando = left(coalesce(d->>'tocando', ''), 200),
      conteudo = left(coalesce(d->>'conteudo', conteudo), 64),
      espaco_livre_mb = case when (d->>'espaco_livre_mb') ~ '^\d{1,9}$' then (d->>'espaco_livre_mb')::int else espaco_livre_mb end,
      baixando = case when (d->>'baixando') ~ '^\d{1,6}$' then (d->>'baixando')::int else 0 end,
      erros = case when jsonb_typeof(d->'erros') = 'array' then
                (select coalesce(jsonb_agg(jsonb_build_object('nome', left(e->>'nome', 200), 'erro', left(e->>'erro', 300))), '[]'::jsonb)
                   from (select e from jsonb_array_elements(d->'erros') e limit 20) x)
              else '[]'::jsonb end
   where id = v_id and (ultimo_sinal is null or ultimo_sinal < now() - interval '20 seconds');
  return true;
end $$;

-- a sincronização da pasta roda no máximo uma por vez por conta e, sem "forçar", no máximo a cada p_seg segundos
create or replace function public.mi_sinc_reservar(p_conta uuid, p_seg int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.mi_contas set sinc_iniciado_em = now()
   where id = p_conta and ativo and pasta_id <> ''
     and (sinc_iniciado_em is null or sinc_iniciado_em < now() - make_interval(secs => greatest(p_seg, 15)));
  return found;
end $$;

-- grava o resultado da leitura da pasta numa transação só: playlists (subpastas) e arquivos, na ordem recebida
-- p_pastas = [{drive_id, chave, nome, raiz, arquivos:[{drive_id, chave, nome, mime, md5, tamanho, modificado, tipo,
--              situacao, motivo, largura, altura, duracao_s, codec}]}]
create or replace function public.mi_sinc_gravar(p_conta uuid, p_pastas jsonb, p_erro text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pa jsonb; ar jsonb; v_pl uuid; n_pl int := 0; n_ar int := 0; pos int; ids_pl uuid[] := '{}';
begin
  if p_erro is not null and p_erro <> '' then
    update public.mi_contas set sinc_erro = left(p_erro, 500), sincronizado_em = now() where id = p_conta;
    return jsonb_build_object('erro', p_erro);
  end if;
  for pa in select * from jsonb_array_elements(coalesce(p_pastas, '[]'::jsonb)) loop
    insert into public.mi_playlists (conta_id, drive_id, chave, nome, raiz)
    values (p_conta, pa->>'drive_id', coalesce(pa->>'chave', ''), pa->>'nome', coalesce((pa->>'raiz')::boolean, false))
    on conflict (conta_id, drive_id) do update set nome = excluded.nome, chave = excluded.chave, raiz = excluded.raiz
    returning id into v_pl;
    ids_pl := ids_pl || v_pl; n_pl := n_pl + 1; pos := 0;
    delete from public.mi_midias where playlist_id = v_pl
      and drive_id not in (select a->>'drive_id' from jsonb_array_elements(coalesce(pa->'arquivos', '[]'::jsonb)) a);
    for ar in select * from jsonb_array_elements(coalesce(pa->'arquivos', '[]'::jsonb)) loop
      pos := pos + 1; n_ar := n_ar + 1;
      insert into public.mi_midias (playlist_id, drive_id, chave, nome, mime, md5, tamanho, modificado, posicao, tipo, situacao, motivo,
                                    largura, altura, duracao_s, codec)
      values (v_pl, ar->>'drive_id', coalesce(ar->>'chave', ''), ar->>'nome', coalesce(ar->>'mime', ''), coalesce(ar->>'md5', ''),
              coalesce((ar->>'tamanho')::bigint, 0), (ar->>'modificado')::timestamptz, pos, coalesce(ar->>'tipo', 'outro'),
              coalesce(ar->>'situacao', 'recusado'), coalesce(ar->>'motivo', ''), (ar->>'largura')::int, (ar->>'altura')::int,
              (ar->>'duracao_s')::numeric, coalesce(ar->>'codec', ''))
      on conflict (playlist_id, drive_id) do update set chave = excluded.chave, nome = excluded.nome, mime = excluded.mime,
        md5 = excluded.md5, tamanho = excluded.tamanho, modificado = excluded.modificado, posicao = excluded.posicao, tipo = excluded.tipo,
        situacao = excluded.situacao, motivo = excluded.motivo, largura = excluded.largura, altura = excluded.altura,
        duracao_s = excluded.duracao_s, codec = excluded.codec;
    end loop;
  end loop;
  delete from public.mi_playlists where conta_id = p_conta and id <> all (ids_pl);
  update public.mi_contas set sincronizado_em = now(), sinc_erro = '' where id = p_conta;
  return jsonb_build_object('playlists', n_pl, 'arquivos', n_ar);
end $$;

revoke execute on function public.mi_tv_codigo(text, text), public.mi_tv_aguardar(text, text), public.mi_tv_tela(text),
  public.mi_tv_sinal(text, jsonb), public.mi_sinc_reservar(uuid, int), public.mi_sinc_gravar(uuid, jsonb, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------- auditoria (contas e acessos, pela tela da equipe Nervia)
create or replace function public.auditar_mi_acessos() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  perform public.auditar(case when tg_op = 'INSERT' then 'midia_acesso_liberado' else 'midia_acesso_retirado' end, null,
    jsonb_build_object('conta', (select nome from public.mi_contas where id = r.conta_id), 'conta_id', r.conta_id,
      'login', (select email from public.perfis where user_id = r.user_id), 'login_id', r.user_id));
  return r;
end $$;
drop trigger if exists auditoria_mi_acessos on public.mi_acessos;
create trigger auditoria_mi_acessos after insert or delete on public.mi_acessos
  for each row execute function public.auditar_mi_acessos();

create or replace function public.auditar_mi_contas() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  if tg_op = 'INSERT' then perform public.auditar('midia_conta_criada', null, jsonb_build_object('conta', r.nome, 'conta_id', r.id, 'limite_mb', r.limite_mb));
  elsif tg_op = 'DELETE' then perform public.auditar('midia_conta_excluida', null, jsonb_build_object('conta', r.nome, 'conta_id', r.id));
  elsif (new.nome, new.limite_mb, new.ativo) is distinct from (old.nome, old.limite_mb, old.ativo) then
    perform public.auditar('midia_conta_alterada', null, jsonb_build_object('conta', r.nome, 'conta_id', r.id,
      'antes', jsonb_build_object('nome', old.nome, 'limite_mb', old.limite_mb, 'ativo', old.ativo),
      'depois', jsonb_build_object('nome', new.nome, 'limite_mb', new.limite_mb, 'ativo', new.ativo)));
  end if;
  return r;
end $$;
drop trigger if exists auditoria_mi_contas on public.mi_contas;
create trigger auditoria_mi_contas after insert or update of nome, limite_mb, ativo or delete on public.mi_contas
  for each row execute function public.auditar_mi_contas();

-- ---------------------------------------------------------------- cadastro do app na Área do Cliente
insert into public.apps (id, nome, descricao, url, icone, ordem, ativo, cartao_url, manual_url)
values ('midia', 'Mídia Indoor', 'Vídeos e imagens nas TVs da empresa: playlists pela pasta do Google Drive, TVs online e offline.',
        '/apps/midia/', 'MI', 80, true, '/apps/midia/ajuda/cartao.html', '/apps/midia/ajuda/manual.html')
on conflict (id) do update set nome = excluded.nome, descricao = excluded.descricao, url = excluded.url,
  cartao_url = excluded.cartao_url, manual_url = excluded.manual_url;
update public.apps set situacao = 'oculto' where id = 'midia';
