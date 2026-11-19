-- NVPlayer: painel de uso só da equipe Nervia (pedido do Marco em 19/11/2026: "quem está usando o app, o que está
-- assistindo, canais mais assistidos, onde está instalado, nome da lista, validade… cuidado para não sobrecarregar o
-- tráfego, o mais importante são os outros apps").
--
-- Tráfego mínimo: o app (iptv-tv/, Telemetria.kt) junta o que foi assistido no próprio aparelho e manda UM resumo
-- pequeno ao abrir, a cada 30 min enquanto está aberto e ao sair (POST na rpc nv_sinal com a chave publicável, como o
-- Monitor de Links; sem Edge Function). O banco guarda só o resumo por aparelho × dia × canal/filme/série.
-- Nunca recebe a senha da lista. Tabelas com prefixo nv_; leitura e alteração só da equipe Nervia (admin).
-- Não toca em nenhuma tabela de outro app.

create table public.nv_aparelhos (
  id               uuid primary key,                  -- gerado no app na 1ª vez (fica no aparelho)
  apelido          text not null default '' check (length(apelido) <= 60),
  modelo           text,                               -- fabricante + modelo do aparelho
  android          text,
  versao_app       text,
  versao_codigo    int,
  ip               text,
  pais             text,
  lista_tipo       text,                               -- xtream | m3u
  lista_servidor   text,                               -- só o endereço (sem senha)
  lista_usuario    text,
  lista_status     text,
  lista_validade   timestamptz,
  lista_telas      text,                               -- telas da assinatura
  lista_telas_uso  text,                               -- telas em uso (no último login)
  canais           int,
  filmes           int,
  series           int,
  assistindo       text,                               -- o que estava passando no último resumo (vazio = nada)
  assistindo_tipo  text,
  assistindo_grupo text,
  assistindo_desde timestamptz,
  problemas        jsonb not null default '[]'::jsonb, -- últimos problemas do vídeo (texto curto, como em Ajustes)
  primeiro_sinal   timestamptz not null default now(),
  ultimo_sinal     timestamptz not null default now(),
  sinais           int not null default 0
);

-- Resumo do que foi assistido: um registro por aparelho × dia (Brasília) × item. Não guarda cada troca de canal.
create table public.nv_assistido (
  aparelho_id uuid not null references public.nv_aparelhos on delete cascade,
  dia         date not null,
  tipo        text not null check (tipo in ('vivo', 'filme', 'serie')),
  nome        text not null,
  grupo       text not null default '',
  segundos    int not null default 0,
  vezes       int not null default 0,
  primary key (aparelho_id, dia, tipo, nome)
);
create index nv_assistido_dia on public.nv_assistido (dia);

alter table public.nv_aparelhos enable row level security;
alter table public.nv_assistido enable row level security;
create policy nv_aparelhos_ler on public.nv_aparelhos for select using ((select public.eh_admin()));
create policy nv_assistido_ler on public.nv_assistido for select using ((select public.eh_admin()));
revoke all on public.nv_aparelhos, public.nv_assistido from anon, authenticated;
grant select on public.nv_aparelhos, public.nv_assistido to authenticated;

-- ---------------------------------------------------------------- resumo vindo do app (anon)
-- p = {id, modelo, android, versao, codigo, lista:{tipo, servidor, usuario, status, validade(ms), telas, telas_uso,
--      canais, filmes, series}, assistindo:{nome, tipo, grupo, desde(ms)} | null, problemas:[texto],
--      sessoes:[{dia:'AAAA-MM-DD', tipo, nome, grupo, s, vezes}]}
create or replace function public.nv_sinal(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_ap public.nv_aparelhos;
  v_h jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  l jsonb := coalesce(p -> 'lista', '{}'::jsonb);
  a jsonb := p -> 'assistindo';
  s jsonb;
  v_s int; v_dia date; v_tipo text; v_nome text;
  n int := 0;
  f_txt text;
begin
  if p is null or jsonb_typeof(p) <> 'object' or length(p::text) > 60000 then return jsonb_build_object('ok', false); end if;
  begin v_id := (p ->> 'id')::uuid; exception when others then return jsonb_build_object('ok', false); end;
  if v_id is null then return jsonb_build_object('ok', false); end if;

  select * into v_ap from public.nv_aparelhos where id = v_id for update;
  if found then
    -- no máximo 1 resumo a cada 20 s por aparelho
    if v_ap.ultimo_sinal > now() - interval '20 seconds' then return jsonb_build_object('ok', false, 'cedo', true); end if;
  else
    -- trava contra lixo: no máximo 300 aparelhos
    if (select count(*) from public.nv_aparelhos) >= 300 then return jsonb_build_object('ok', false); end if;
    insert into public.nv_aparelhos (id) values (v_id);
  end if;

  update public.nv_aparelhos set
    modelo = left(p ->> 'modelo', 80),
    android = left(p ->> 'android', 20),
    versao_app = left(p ->> 'versao', 20),
    versao_codigo = case when (p ->> 'codigo') ~ '^\d{1,6}$' then (p ->> 'codigo')::int end,
    ip = left(coalesce(v_h ->> 'cf-connecting-ip', v_h ->> 'x-real-ip', nullif(trim(split_part(v_h ->> 'x-forwarded-for', ',', 1)), '')), 60),
    pais = left(v_h ->> 'cf-ipcountry', 4),
    lista_tipo = left(l ->> 'tipo', 10),
    lista_servidor = left(l ->> 'servidor', 120),
    lista_usuario = left(l ->> 'usuario', 60),
    lista_status = left(l ->> 'status', 30),
    lista_validade = case when (l ->> 'validade') ~ '^\d{10,14}$' then to_timestamp((l ->> 'validade')::bigint / 1000.0) end,
    lista_telas = left(l ->> 'telas', 10),
    lista_telas_uso = left(l ->> 'telas_uso', 10),
    canais = case when (l ->> 'canais') ~ '^\d{1,7}$' then (l ->> 'canais')::int end,
    filmes = case when (l ->> 'filmes') ~ '^\d{1,7}$' then (l ->> 'filmes')::int end,
    series = case when (l ->> 'series') ~ '^\d{1,7}$' then (l ->> 'series')::int end,
    assistindo = case when jsonb_typeof(a) = 'object' then left(a ->> 'nome', 120) end,
    assistindo_tipo = case when jsonb_typeof(a) = 'object' then left(a ->> 'tipo', 10) end,
    assistindo_grupo = case when jsonb_typeof(a) = 'object' then left(a ->> 'grupo', 80) end,
    assistindo_desde = case when jsonb_typeof(a) = 'object' and (a ->> 'desde') ~ '^\d{10,14}$'
                            then to_timestamp((a ->> 'desde')::bigint / 1000.0) end,
    problemas = coalesce((select jsonb_agg(left(x, 160)) from (
                   select jsonb_array_elements_text(p -> 'problemas') x limit 12) t
                 where jsonb_typeof(p -> 'problemas') = 'array'), problemas),
    ultimo_sinal = now(),
    sinais = sinais + 1
  where id = v_id;

  if jsonb_typeof(p -> 'sessoes') = 'array' then
    for s in select * from jsonb_array_elements(p -> 'sessoes') limit 300 loop
      begin
        v_dia := (s ->> 'dia')::date;
        v_s := (s ->> 's')::int;
      exception when others then continue;
      end;
      v_tipo := s ->> 'tipo';
      v_nome := left(trim(coalesce(s ->> 'nome', '')), 120);
      if v_tipo not in ('vivo', 'filme', 'serie') or v_nome = '' or v_s is null or v_s < 1 or v_s > 86400
         or v_dia is null or v_dia > v_hoje or v_dia < v_hoje - 7 then continue; end if;
      insert into public.nv_assistido as x (aparelho_id, dia, tipo, nome, grupo, segundos, vezes)
      values (v_id, v_dia, v_tipo, v_nome, left(coalesce(s ->> 'grupo', ''), 80), v_s,
              greatest(1, least(coalesce(case when (s ->> 'vezes') ~ '^\d{1,4}$' then (s ->> 'vezes')::int end, 1), 500)))
      on conflict (aparelho_id, dia, tipo, nome) do update
        set segundos = least(x.segundos + excluded.segundos, 86400), vezes = x.vezes + excluded.vezes, grupo = excluded.grupo;
      n := n + 1;
    end loop;
  end if;

  -- limpeza de vez em quando: histórico de mais de 1 ano
  if random() < 0.02 then delete from public.nv_assistido where dia < v_hoje - 366; end if;
  return jsonb_build_object('ok', true, 'gravados', n);
end $$;
revoke execute on function public.nv_sinal(jsonb) from public;
grant execute on function public.nv_sinal(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- equipe Nervia
create or replace function public.nv_aparelho_apelido(p_id uuid, p_apelido text)
returns void language plpgsql security definer set search_path = public as $$
declare v_antes text;
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia.'; end if;
  select apelido into v_antes from public.nv_aparelhos where id = p_id for update;
  if not found then raise exception 'Aparelho não encontrado.'; end if;
  update public.nv_aparelhos set apelido = left(trim(coalesce(p_apelido, '')), 60) where id = p_id;
  perform public.auditar('nvplayer_aparelho_renomeado', null,
    jsonb_build_object('aparelho', p_id, 'antes', v_antes, 'depois', left(trim(coalesce(p_apelido, '')), 60)));
end $$;

create or replace function public.nv_aparelho_excluir(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.nv_aparelhos;
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia.'; end if;
  select * into v from public.nv_aparelhos where id = p_id;
  if not found then raise exception 'Aparelho não encontrado.'; end if;
  delete from public.nv_aparelhos where id = p_id;   -- o histórico sai junto (cascade)
  perform public.auditar('nvplayer_aparelho_excluido', null,
    jsonb_build_object('aparelho', p_id, 'apelido', v.apelido, 'modelo', v.modelo, 'lista_usuario', v.lista_usuario));
end $$;
revoke execute on function public.nv_aparelho_apelido(uuid, text), public.nv_aparelho_excluir(uuid) from public, anon;
grant execute on function public.nv_aparelho_apelido(uuid, text), public.nv_aparelho_excluir(uuid) to authenticated;

-- ---------------------------------------------------------------- cadastro do app na Área do Cliente
-- Uso pessoal do Marco: fora da vitrine (oculto); só a equipe (admin) vê.
insert into public.apps (id, nome, descricao, url, icone, ordem, ativo, cartao_url, manual_url, situacao)
values ('nvplayer', 'NVPlayer — uso', 'Quem usa o NVPlayer, o que está assistindo, mais assistidos, aparelhos e validade das listas.',
        '/apps/nvplayer/', 'NV', 99, true, '/apps/nvplayer/ajuda/cartao.html', '/apps/nvplayer/ajuda/manual.html', 'oculto')
on conflict (id) do nothing;
