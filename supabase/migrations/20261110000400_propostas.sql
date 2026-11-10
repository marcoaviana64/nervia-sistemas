-- Propostas para prospects + vitrine pública de produtos (pedido do Marco em 10/11/2026).
--
-- A equipe Nervia monta a proposta em Administração → Propostas: para quem, o que está incluído, o que pode
-- entrar depois, etapas, o que precisa receber do cliente, investimento, validade e (opcional) o endereço de um
-- MODELO já pronto (ex.: o site de prova do cliente, em site/modelos/<pasta>/). O sistema gera um link
-- (nervia.com.br/proposta/#<link>) e um CÓDIGO de 6 dígitos; a Nervia manda os dois pelo WhatsApp.
-- Decisão do Marco (10/11/2026): acesso por link + código, SEM login (não há envio de e-mail nem senha para o prospect).
--
-- O prospect (anon) só fala com o banco por prop_ler / prop_responder:
--   - o link vai depois do "#": não chega ao servidor nem ao Referer; o código é conferido aqui;
--   - código errado NÃO é exceção (a tentativa precisa ficar gravada para o limite): 5 erros no mesmo link em 15 min
--     ou 30 erros do mesmo IP em 1 hora = bloqueio temporário;
--   - rascunho e cancelada não abrem; vencida abre só para leitura (sem os botões de resposta);
--   - responde Aprovar ou Pedir ajuste (com o que mudar), com o nome de quem responde; vai para o histórico
--     (prop_eventos, SOMENTE INCLUSÃO) e para a auditoria com IP e navegador.
-- Nada é cobrado nem liberado sozinho: "aprovada" só avisa a Nervia, que combina os próximos passos e,
-- quando for o caso, cria o login do cliente (Administração → Logins) e marca a proposta como "cliente".
--
-- Vitrine pública (site/produtos/): apps_vitrine_publica() mostra a anônimos o que já é público na vitrine da
-- Área do Cliente (apps fora de "oculto": nome, descrição, ícone, situação, demonstração). Sem preço (decisão do Marco).

-- ---------------------------------------------------------------- tabelas
create table if not exists public.prop_propostas (
  id              bigint generated always as identity primary key,
  numero          text not null unique,                       -- AAAA-NNN, gerado no gatilho
  link            text not null unique check (link ~ '^[a-f0-9]{12}$'),
  codigo          text not null check (codigo ~ '^[0-9]{6}$'),
  prospect        text not null check (length(trim(prospect)) between 2 and 160),
  contato         text not null default '' check (length(contato) <= 160),
  whatsapp        text not null default '' check (length(whatsapp) <= 40),
  email           text not null default '' check (length(email) <= 160),
  titulo          text not null check (length(trim(titulo)) between 2 and 200),
  resumo          text not null default '' check (length(resumo) <= 2000),
  modelo_url      text not null default '' check (modelo_url = '' or modelo_url ~ '^(/[A-Za-z0-9/_.#-]*|https://[^\s"<>]+)$'),
  conteudo        jsonb not null default '{}'::jsonb,         -- incluido, depois, etapas, precisamos, investimento, condicoes
  valida_ate      date not null,
  versao          int not null default 1,
  situacao        text not null default 'rascunho'
                    check (situacao in ('rascunho', 'enviada', 'ajuste', 'aprovada', 'cancelada', 'cliente')),
  enviada_em      timestamptz,
  visualizacoes   int not null default 0,
  primeira_visita timestamptz,
  ultima_visita   timestamptz,
  respondida_em   timestamptz,
  resposta_nome   text not null default '',
  resposta_texto  text not null default '',
  cancelada_motivo text not null default '',
  obs             text not null default '' check (length(obs) <= 2000),   -- anotação interna (o prospect não vê)
  criado_por      uuid default auth.uid(),
  criado_em       timestamptz not null default now(),
  alterado_em     timestamptz not null default now()
);

create table if not exists public.prop_eventos (
  id          bigint generated always as identity primary key,
  proposta_id bigint not null references public.prop_propostas on delete restrict,
  quando      timestamptz not null default now(),
  tipo        text not null,                 -- criada, alterada, enviada, visualizada, ajuste, aprovada, novo_codigo, cancelada, reaberta, cliente
  texto       text not null default '',
  quem        uuid,
  quem_nome   text not null default '',
  ip          text,
  navegador   text
);
create index if not exists prop_eventos_proposta on public.prop_eventos (proposta_id, quando desc);

-- tentativas de abrir/responder (limite contra quem tenta adivinhar o código)
create table if not exists public.prop_tentativas (
  id     bigint generated always as identity primary key,
  link   text not null,
  ip     text,
  ok     boolean not null,
  quando timestamptz not null default now()
);
create index if not exists prop_tentativas_link on public.prop_tentativas (link, quando desc);
create index if not exists prop_tentativas_ip on public.prop_tentativas (ip, quando desc);

alter table public.prop_propostas enable row level security;
alter table public.prop_eventos enable row level security;
alter table public.prop_tentativas enable row level security;
-- leitura só da equipe Nervia; escrita só pelas funções abaixo
create policy prop_propostas_ler on public.prop_propostas for select using (public.eh_admin());
create policy prop_eventos_ler on public.prop_eventos for select using (public.eh_admin());
revoke insert, update, delete on public.prop_propostas, public.prop_eventos, public.prop_tentativas from anon, authenticated;
revoke select on public.prop_tentativas from anon, authenticated;
revoke select on public.prop_propostas, public.prop_eventos from anon;

-- histórico somente inclusão
create or replace function public.prop_eventos_imutavel() returns trigger language plpgsql as $$
begin raise exception 'O histórico da proposta é somente inclusão: não pode ser alterado nem apagado.'; end $$;
drop trigger if exists prop_eventos_sem_alteracao on public.prop_eventos;
create trigger prop_eventos_sem_alteracao before update or delete on public.prop_eventos
  for each row execute function public.prop_eventos_imutavel();

-- proposta não se apaga (fica o histórico); cancela-se
create or replace function public.prop_propostas_sem_exclusao() returns trigger language plpgsql as $$
begin raise exception 'Proposta não se apaga: use Cancelar (fica no histórico).'; end $$;
drop trigger if exists prop_propostas_sem_exclusao on public.prop_propostas;
create trigger prop_propostas_sem_exclusao before delete on public.prop_propostas
  for each row execute function public.prop_propostas_sem_exclusao();

-- ---------------------------------------------------------------- auxiliares
create or replace function public.prop_hoje() returns date
language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

create or replace function public.prop_novo_codigo() returns text
language sql volatile as $$
  select lpad(((('x' || substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 8))::bit(32)::bigint) % 1000000)::text, 6, '0')
$$;

create or replace function public.prop_novo_link() returns text
language sql volatile as $$ select substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 12) $$;

-- IP e navegador (cabeçalhos repassados pela API; vazio fora dela)
create or replace function public.prop_origem() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'ip', coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', nullif(trim(split_part(h ->> 'x-forwarded-for', ',', 1)), '')),
    'navegador', left(h ->> 'user-agent', 300))
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb as h) x
$$;

-- histórico + auditoria. Sem login (prospect) = papel "sistema" com o nome informado, IP e navegador.
create or replace function public._prop_registrar(p_id bigint, p_tipo text, p_texto text, p_quem_nome text default null,
  p_det jsonb default '{}', p_auditar boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_orig jsonb := public.prop_origem(); v_uid uuid := auth.uid(); v_nome text; v_email text; p record;
begin
  select numero, prospect, titulo into p from public.prop_propostas where id = p_id;
  if v_uid is not null then select nome, email into v_nome, v_email from public.perfis where user_id = v_uid; end if;
  insert into public.prop_eventos (proposta_id, tipo, texto, quem, quem_nome, ip, navegador)
  values (p_id, p_tipo, coalesce(p_texto, ''), v_uid, coalesce(p_quem_nome, v_nome, ''),
          v_orig ->> 'ip', v_orig ->> 'navegador');
  if p_auditar then
    if v_uid is null then
      insert into public.auditoria (user_id, email, nome, papel, acao, cnpj, detalhes, ip, navegador)
      values (null, null, coalesce(p_quem_nome, '') || ' (pelo link da proposta)', 'sistema', 'proposta_' || p_tipo, null,
        coalesce(p_det, '{}') || jsonb_build_object('proposta', p.numero, 'prospect', p.prospect, 'titulo', p.titulo, 'texto', p_texto),
        v_orig ->> 'ip', v_orig ->> 'navegador');
    else
      perform public.auditar('proposta_' || p_tipo, null,
        coalesce(p_det, '{}') || jsonb_build_object('proposta', p.numero, 'prospect', p.prospect, 'titulo', p.titulo, 'texto', p_texto,
          'ip', v_orig ->> 'ip'));
    end if;
  end if;
end $$;
revoke execute on function public._prop_registrar(bigint, text, text, text, jsonb, boolean) from public, anon, authenticated;

-- lista de textos (incluído, depois, etapas, precisamos): array de {t, d} ou de strings, limpa e limitada
create or replace function public._prop_lista(p jsonb, p_com_descricao boolean) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(x order by n), '[]'::jsonb) from (
    select n, case when p_com_descricao
                then jsonb_build_object('t', left(trim(coalesce(e ->> 't', e #>> '{}')), 200), 'd', left(trim(coalesce(e ->> 'd', '')), 600))
                else to_jsonb(left(trim(coalesce(e ->> 't', e #>> '{}')), 300)) end as x
    from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality as a(e, n)
    where n <= 40 and trim(coalesce(e ->> 't', e #>> '{}', '')) <> ''
  ) y
$$;

-- ---------------------------------------------------------------- equipe Nervia
-- p: {id?, prospect, contato, whatsapp, email, titulo, resumo, modelo_url, valida_ate, obs,
--     conteudo: {incluido:[{t,d}], depois:[{t,d}], etapas:[{t,d}], precisamos:[texto], investimento:[{t,d,v}], condicoes}}
-- Chave ausente = mantém (na edição). Editar proposta já enviada (ou com ajuste pedido) = nova versão, volta a "enviada".
create or replace function public.prop_salvar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.prop_propostas; v_id bigint := nullif(p ->> 'id', '')::bigint; v_cont jsonb; v_c jsonb;
  v_val date; v_num text; v_ano int := extract(year from public.prop_hoje());
  v_inv jsonb;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia monta propostas.'; end if;
  if v_id is not null then
    select * into r from public.prop_propostas where id = v_id for update;
    if not found then raise exception 'Proposta não encontrada.'; end if;
    if r.situacao in ('aprovada', 'cliente', 'cancelada') then
      raise exception 'Proposta %: não dá para alterar depois de %.', r.numero,
        case r.situacao when 'aprovada' then 'aprovada (faça uma proposta nova)' when 'cliente' then 'virar cliente' else 'cancelada (reabra antes)' end;
    end if;
  end if;

  v_c := coalesce(p -> 'conteudo', case when v_id is null then '{}'::jsonb else r.conteudo end);
  select coalesce(jsonb_agg(jsonb_build_object('t', left(trim(coalesce(e ->> 't', '')), 200), 'd', left(trim(coalesce(e ->> 'd', '')), 300),
           'v', left(trim(coalesce(e ->> 'v', '')), 60)) order by n), '[]'::jsonb)
    into v_inv
    from jsonb_array_elements(case when jsonb_typeof(v_c -> 'investimento') = 'array' then v_c -> 'investimento' else '[]'::jsonb end)
         with ordinality a(e, n)
   where n <= 20 and trim(coalesce(e ->> 't', '')) <> '';
  v_cont := jsonb_build_object(
    'incluido', public._prop_lista(v_c -> 'incluido', true),
    'depois', public._prop_lista(v_c -> 'depois', true),
    'etapas', public._prop_lista(v_c -> 'etapas', true),
    'precisamos', public._prop_lista(v_c -> 'precisamos', false),
    'investimento', v_inv,
    'condicoes', left(trim(coalesce(v_c ->> 'condicoes', '')), 2000));

  if p ? 'valida_ate' or v_id is null then
    begin v_val := nullif(p ->> 'valida_ate', '')::date; exception when others then raise exception 'Validade inválida.'; end;
    if v_val is null then raise exception 'Informe até quando a proposta vale.'; end if;
    if v_val < public.prop_hoje() then raise exception 'A validade precisa ser hoje ou depois.'; end if;
  else v_val := r.valida_ate; end if;

  if v_id is null then
    perform pg_advisory_xact_lock(hashtext('prop_numero'));
    select v_ano || '-' || lpad((coalesce(max(split_part(numero, '-', 2)::int), 0) + 1)::text, 3, '0') into v_num
      from public.prop_propostas where numero like v_ano || '-%';
    insert into public.prop_propostas (numero, link, codigo, prospect, contato, whatsapp, email, titulo, resumo, modelo_url, conteudo, valida_ate, obs)
    values (v_num, public.prop_novo_link(), public.prop_novo_codigo(), trim(coalesce(p ->> 'prospect', '')),
      trim(coalesce(p ->> 'contato', '')), trim(coalesce(p ->> 'whatsapp', '')), lower(trim(coalesce(p ->> 'email', ''))),
      trim(coalesce(p ->> 'titulo', '')), trim(coalesce(p ->> 'resumo', '')), trim(coalesce(p ->> 'modelo_url', '')), v_cont, v_val,
      trim(coalesce(p ->> 'obs', '')))
    returning * into r;
    perform public._prop_registrar(r.id, 'criada', 'Proposta criada (rascunho).');
  else
    update public.prop_propostas set
      prospect   = case when p ? 'prospect' then trim(p ->> 'prospect') else prospect end,
      contato    = case when p ? 'contato' then trim(p ->> 'contato') else contato end,
      whatsapp   = case when p ? 'whatsapp' then trim(p ->> 'whatsapp') else whatsapp end,
      email      = case when p ? 'email' then lower(trim(p ->> 'email')) else email end,
      titulo     = case when p ? 'titulo' then trim(p ->> 'titulo') else titulo end,
      resumo     = case when p ? 'resumo' then trim(p ->> 'resumo') else resumo end,
      modelo_url = case when p ? 'modelo_url' then trim(p ->> 'modelo_url') else modelo_url end,
      obs        = case when p ? 'obs' then trim(p ->> 'obs') else obs end,
      conteudo   = v_cont,
      valida_ate = v_val,
      versao     = case when situacao in ('enviada', 'ajuste') then versao + 1 else versao end,
      situacao   = case when situacao = 'ajuste' then 'enviada' else situacao end,
      alterado_em = now()
    where id = v_id returning * into r;
    perform public._prop_registrar(r.id, 'alterada',
      case when r.versao > 1 and r.situacao = 'enviada' then 'Nova versão (' || r.versao || ') no mesmo link.' else 'Proposta alterada.' end);
  end if;
  return jsonb_build_object('id', r.id, 'numero', r.numero, 'link', r.link, 'codigo', r.codigo, 'situacao', r.situacao, 'versao', r.versao);
end $$;

-- ações: enviada (marca que foi mandada), novo_codigo, cancelar (motivo), reabrir (cancelada volta a rascunho), cliente
create or replace function public.prop_acao(p_id bigint, p_acao text, p_motivo text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.prop_propostas; v_motivo text := trim(coalesce(p_motivo, ''));
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia.'; end if;
  select * into r from public.prop_propostas where id = p_id for update;
  if not found then raise exception 'Proposta não encontrada.'; end if;
  if p_acao = 'enviada' then
    if r.situacao not in ('rascunho', 'enviada') then raise exception 'Proposta % está "%": não dá para marcar como enviada.', r.numero, r.situacao; end if;
    update public.prop_propostas set situacao = 'enviada', enviada_em = coalesce(enviada_em, now()), alterado_em = now() where id = p_id;
    perform public._prop_registrar(p_id, 'enviada', case when r.situacao = 'enviada' then 'Reenviada ao prospect.' else 'Enviada ao prospect.' end);
  elsif p_acao = 'novo_codigo' then
    if r.situacao in ('cancelada', 'cliente') then raise exception 'Proposta % está "%".', r.numero, r.situacao; end if;
    update public.prop_propostas set codigo = public.prop_novo_codigo(), alterado_em = now() where id = p_id;
    perform public._prop_registrar(p_id, 'novo_codigo', 'Código de acesso trocado (o anterior deixa de valer).');
  elsif p_acao = 'cancelar' then
    if r.situacao in ('cancelada', 'cliente') then raise exception 'Proposta % já está "%".', r.numero, r.situacao; end if;
    if length(v_motivo) < 5 then raise exception 'Informe o motivo do cancelamento (pelo menos 5 letras).'; end if;
    update public.prop_propostas set situacao = 'cancelada', cancelada_motivo = v_motivo, alterado_em = now() where id = p_id;
    perform public._prop_registrar(p_id, 'cancelada', v_motivo);
  elsif p_acao = 'reabrir' then
    if r.situacao <> 'cancelada' then raise exception 'Só proposta cancelada pode ser reaberta.'; end if;
    update public.prop_propostas set situacao = 'rascunho', cancelada_motivo = '', alterado_em = now() where id = p_id;
    perform public._prop_registrar(p_id, 'reaberta', coalesce(nullif(v_motivo, ''), 'Reaberta como rascunho.'));
  elsif p_acao = 'cliente' then
    if r.situacao <> 'aprovada' then raise exception 'Só proposta aprovada vira cliente.'; end if;
    update public.prop_propostas set situacao = 'cliente', alterado_em = now() where id = p_id;
    perform public._prop_registrar(p_id, 'cliente', coalesce(nullif(v_motivo, ''), 'Prospect virou cliente.'));
  else
    raise exception 'Ação desconhecida: %', p_acao;
  end if;
  select * into r from public.prop_propostas where id = p_id;
  return jsonb_build_object('id', r.id, 'numero', r.numero, 'link', r.link, 'codigo', r.codigo, 'situacao', r.situacao);
end $$;

-- ---------------------------------------------------------------- prospect (sem login)
-- confere link + código e o limite de tentativas. Devolve a proposta ou null + mensagem em v_erro.
create or replace function public._prop_conferir(p_link text, p_codigo text, out r public.prop_propostas, out erro text)
language plpgsql security definer set search_path = public as $$
declare v_link text := lower(trim(coalesce(p_link, ''))); v_cod text := regexp_replace(coalesce(p_codigo, ''), '\D', '', 'g');
  v_ip text := public.prop_origem() ->> 'ip';
begin
  if v_link !~ '^[a-f0-9]{12}$' then erro := 'Link inválido. Confira o endereço que você recebeu.'; return; end if;
  if (select count(*) from public.prop_tentativas where link = v_link and not ok and quando > now() - interval '15 minutes') >= 5
     or (v_ip is not null and (select count(*) from public.prop_tentativas where ip = v_ip and not ok and quando > now() - interval '1 hour') >= 30) then
    erro := 'Muitas tentativas com código errado. Aguarde 15 minutos ou fale com a Nervia pelo WhatsApp.'; return;
  end if;
  select * into r from public.prop_propostas where link = v_link;
  if not found or r.codigo <> v_cod then
    insert into public.prop_tentativas (link, ip, ok) values (v_link, v_ip, false);
    r := null;
    erro := case when length(v_cod) <> 6 then 'Digite o código de 6 números que veio junto com o link.'
                 else 'Código incorreto. Confira a mensagem que você recebeu.' end;
    return;
  end if;
  insert into public.prop_tentativas (link, ip, ok) values (v_link, v_ip, true);
  if r.situacao in ('rascunho', 'cancelada') then
    r := null; erro := 'Esta proposta não está disponível. Fale com a Nervia pelo WhatsApp.'; return;
  end if;
end $$;
revoke execute on function public._prop_conferir(text, text) from public, anon, authenticated;

create or replace function public._prop_publica(r public.prop_propostas) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'numero', r.numero, 'prospect', r.prospect, 'contato', r.contato, 'titulo', r.titulo, 'resumo', r.resumo,
    'modelo_url', r.modelo_url, 'conteudo', r.conteudo, 'valida_ate', r.valida_ate, 'versao', r.versao,
    'situacao', case when r.situacao = 'cliente' then 'aprovada' else r.situacao end,
    'vencida', r.valida_ate < public.prop_hoje() and r.situacao in ('enviada', 'ajuste'),
    'respondida_em', r.respondida_em, 'resposta_nome', r.resposta_nome,
    'resposta_texto', case when r.situacao = 'ajuste' then r.resposta_texto else '' end)
$$;
revoke execute on function public._prop_publica(public.prop_propostas) from public, anon, authenticated;

-- devolve {ok, proposta} ou {ok:false, erro}; nunca exceção por código errado (a tentativa tem de ficar gravada)
create or replace function public.prop_ler(p_link text, p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from public._prop_conferir(p_link, p_codigo);
  if c.erro is not null then return jsonb_build_object('ok', false, 'erro', c.erro); end if;
  -- visita conta uma vez a cada 30 min por proposta; a 1ª visita vai para a auditoria
  if (c.r).ultima_visita is null or (c.r).ultima_visita < now() - interval '30 minutes' then
    update public.prop_propostas set visualizacoes = visualizacoes + 1, ultima_visita = now(),
      primeira_visita = coalesce(primeira_visita, now()) where id = (c.r).id;
    perform public._prop_registrar((c.r).id, 'visualizada', 'Proposta aberta pelo link (versão ' || (c.r).versao || ').', null, '{}',
      (c.r).primeira_visita is null);
  else
    update public.prop_propostas set ultima_visita = now() where id = (c.r).id;
  end if;
  return jsonb_build_object('ok', true, 'proposta', public._prop_publica(c.r));
end $$;

-- p_acao: aprovar | ajuste. Nome de quem responde obrigatório; ajuste exige o que mudar.
create or replace function public.prop_responder(p_link text, p_codigo text, p_acao text, p_nome text, p_texto text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; v_nome text := left(trim(coalesce(p_nome, '')), 120); v_txt text := left(trim(coalesce(p_texto, '')), 2000);
  v_sit text;
begin
  select * into c from public._prop_conferir(p_link, p_codigo);
  if c.erro is not null then return jsonb_build_object('ok', false, 'erro', c.erro); end if;
  if (c.r).situacao not in ('enviada', 'ajuste') then
    return jsonb_build_object('ok', false, 'erro', 'Esta proposta já foi respondida. Para mudar algo, fale com a Nervia pelo WhatsApp.');
  end if;
  if (c.r).valida_ate < public.prop_hoje() then
    return jsonb_build_object('ok', false, 'erro', 'Esta proposta venceu em ' || to_char((c.r).valida_ate, 'DD/MM/YYYY') || '. Fale com a Nervia para renovar.');
  end if;
  if length(v_nome) < 2 then return jsonb_build_object('ok', false, 'erro', 'Informe o seu nome.'); end if;
  if p_acao = 'aprovar' then v_sit := 'aprovada';
  elsif p_acao = 'ajuste' then
    if length(v_txt) < 5 then return jsonb_build_object('ok', false, 'erro', 'Escreva o que você gostaria de mudar.'); end if;
    v_sit := 'ajuste';
  else return jsonb_build_object('ok', false, 'erro', 'Resposta desconhecida.'); end if;
  update public.prop_propostas set situacao = v_sit, respondida_em = now(), resposta_nome = v_nome, resposta_texto = v_txt,
    alterado_em = now() where id = (c.r).id;
  perform public._prop_registrar((c.r).id, case when v_sit = 'aprovada' then 'aprovada' else 'ajuste' end,
    case when v_sit = 'aprovada' then 'Aprovada por ' || v_nome || coalesce(nullif(' — ' || v_txt, ' — '), '')
         else 'Ajuste pedido por ' || v_nome || ': ' || v_txt end,
    v_nome, jsonb_build_object('versao', (c.r).versao));
  return jsonb_build_object('ok', true, 'situacao', v_sit);
end $$;

revoke execute on function public.prop_salvar(jsonb), public.prop_acao(bigint, text, text) from public, anon;
grant execute on function public.prop_salvar(jsonb), public.prop_acao(bigint, text, text) to authenticated;
revoke execute on function public.prop_ler(text, text), public.prop_responder(text, text, text, text, text) from public;
grant execute on function public.prop_ler(text, text), public.prop_responder(text, text, text, text, text) to anon, authenticated;
revoke execute on function public.prop_hoje(), public.prop_novo_codigo(), public.prop_novo_link(), public.prop_origem(),
  public._prop_lista(jsonb, boolean) from public, anon, authenticated;

-- limpeza: tentativas com mais de 30 dias (só servem para o limite)
create or replace function public.prop_limpar_tentativas() returns void
language sql security definer set search_path = public as $$
  delete from public.prop_tentativas where quando < now() - interval '30 days'
$$;
revoke execute on function public.prop_limpar_tentativas() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('propostas-limpar-tentativas', '17 6 * * *', 'select public.prop_limpar_tentativas()');
  end if;
end $$;

-- ---------------------------------------------------------------- vitrine pública
-- O que já é público na vitrine da Área do Cliente, agora também para quem não tem login (site/produtos/).
create or replace function public.apps_vitrine_publica()
returns table (id text, nome text, descricao text, icone text, situacao text, demo_url text, ordem int)
language sql stable security definer set search_path = public as $$
  select a.id, a.nome, a.descricao, a.icone, a.situacao,
         case when a.situacao in ('disponivel', 'em_breve') then a.demo_url else '' end, a.ordem
    from public.apps a
   where a.situacao in ('disponivel', 'em_breve', 'em_desenvolvimento')
   order by case a.situacao when 'disponivel' then 1 when 'em_breve' then 2 else 3 end, a.ordem, a.nome
$$;
revoke execute on function public.apps_vitrine_publica() from public;
grant execute on function public.apps_vitrine_publica() to anon, authenticated;

-- produtos só de vitrine (sem app na Área do Cliente: sem endereço e desativados)
insert into public.apps (id, nome, descricao, url, icone, ordem, ativo, situacao, demo_url)
values
  ('site-negocios', 'Site para negócios', 'Site profissional pronto para celular, com agendamento online, WhatsApp e preparado para o Google.', '', 'SN', 70, false, 'disponivel', ''),
  ('studio', 'Nervia Studio', 'Agenda, alunos e pacientes, mensalidades e edição do próprio site para studios, clínicas e consultórios.', '', 'NS', 75, false, 'em_desenvolvimento', '')
on conflict (id) do nothing;
