-- Orçamentos de Compras — fase 2: o fornecedor manda a própria proposta por um link, sem login.
-- Decisões do Marco em 17/10/2026:
--   * o comprador gera o convite e o envia por WhatsApp ou e-mail já escritos (sem envio automático: não há SMTP);
--   * o convite pode ser para um fornecedor da base OU para um contato ainda sem cadastro: o próprio fornecedor informa
--     o CNPJ/CPF pelo link (validado; se já existe na base, liga ao cadastro existente sem mostrar os dados dele; se não
--     existe, cria o cadastro com quem convidou como responsável pela homologação);
--   * proposta enviada pelo fornecedor só é alterada por ele (reenvio pelo mesmo link, até o prazo); o comprador não
--     altera, só exclui com motivo;
--   * PDF da proposta opcional (bucket privado cmp-propostas, só PDF, até 10 MB);
--   * o fornecedor não vê as outras propostas nem o valor estimado (cotação fechada; leilão é a fase 3).
-- O código do link (64 hex, ~244 bits aleatórios) vai depois do "#" no endereço: não chega ao servidor do site nem ao Referer.
-- Tudo o que o fornecedor faz vai para cmp_historico e para auditoria (com IP e navegador da requisição).

-- ---------------------------------------------------------------- convites
create table if not exists public.cmp_convites (
  id                bigint generated always as identity primary key,
  requisicao_id     bigint not null references public.cmp_requisicoes on delete cascade,
  fornecedor_id     uuid references public.cmp_fornecedores,
  codigo            text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  contato_nome      text not null default '',
  telefone          text not null default '',
  email             text not null default '',
  prazo             date not null,                       -- recebe propostas até o fim deste dia (horário de Brasília)
  criado_por        uuid references auth.users on delete set null,
  criado_nome       text not null default '',
  criado_em         timestamptz not null default now(),
  aberto_em         timestamptz,                         -- primeira vez que o link foi aberto
  respondido_em     timestamptz,                         -- último envio de proposta
  revogado_em       timestamptz,
  revogado_nome     text
);
create index if not exists cmp_convites_req on public.cmp_convites (requisicao_id);
-- um convite ativo por fornecedor em cada requisição
create unique index if not exists cmp_convites_forn on public.cmp_convites (requisicao_id, fornecedor_id)
  where fornecedor_id is not null and revogado_em is null;

-- de onde veio a proposta
alter table public.cmp_propostas add column if not exists origem text not null default 'comprador';
alter table public.cmp_propostas drop constraint if exists cmp_propostas_origem;
alter table public.cmp_propostas add constraint cmp_propostas_origem check (origem in ('comprador', 'fornecedor'));
alter table public.cmp_propostas add column if not exists convite_id bigint references public.cmp_convites on delete set null;
alter table public.cmp_propostas add column if not exists anexo text;            -- caminho do PDF em cmp-propostas
alter table public.cmp_propostas add column if not exists declarante text;       -- quem enviou pelo fornecedor (nome digitado)
alter table public.cmp_propostas add column if not exists enviada_ip text;

alter table public.cmp_convites enable row level security;
revoke all on public.cmp_convites from anon;
revoke insert, update, delete on public.cmp_convites from authenticated;
drop policy if exists cmp_convites_ler on public.cmp_convites;
create policy cmp_convites_ler on public.cmp_convites for select
  using (exists (select 1 from public.cmp_requisicoes r where r.id = requisicao_id and public.cmp_membro(r.unidade_id)));

-- dia de hoje em Brasília (o prazo é uma data)
create or replace function public.cmp_hoje() returns date
language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- IP e navegador de quem chamou (cabeçalhos repassados pela API do Supabase; vazio fora dela)
create or replace function public.cmp_origem_requisicao() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'ip', coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', nullif(trim(split_part(h ->> 'x-forwarded-for', ',', 1)), '')),
    'navegador', left(h ->> 'user-agent', 300))
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb as h) x
$$;

-- histórico + auditoria de ação feita pelo fornecedor (sem login): quem = nome informado, com IP e navegador
create or replace function public.cmp_registrar_fornecedor(p_req bigint, p_forn uuid, p_unidade uuid, p_acao text, p_texto text,
  p_quem text, p_det jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare v_orig jsonb := public.cmp_origem_requisicao();
begin
  insert into public.cmp_historico (requisicao_id, fornecedor_id, unidade_id, quem, quem_nome, acao, texto, detalhes)
  values (p_req, p_forn, p_unidade, null, p_quem, p_acao, p_texto, coalesce(p_det, '{}') || v_orig);
  insert into public.auditoria (user_id, email, nome, papel, acao, cnpj, detalhes, ip, navegador)
  values (null, null, p_quem, 'sistema', 'compras_' || p_acao, (select cnpj from public.cmp_unidades where id = p_unidade),
    coalesce(p_det, '{}') || jsonb_build_object('texto', p_texto, 'requisicao', p_req, 'fornecedor_id', p_forn, 'origem', 'link do fornecedor',
      'unidade', (select nome from public.cmp_unidades where id = p_unidade)),
    v_orig ->> 'ip', v_orig ->> 'navegador');
end $$;
revoke execute on function public.cmp_registrar_fornecedor(bigint, uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- comprador: convidar, prorrogar, cancelar
create or replace function public.cmp_convidar(p_req bigint, p_fornecedor uuid, p_contato_nome text, p_telefone text, p_email text, p_prazo date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; f public.cmp_fornecedores; v_id bigint; v_codigo text; v_ex record;
begin
  r := public.cmp_req_para(p_req, array['comprador'], array['nova', 'cotacao']);
  if p_prazo is null or p_prazo < public.cmp_hoje() then raise exception 'O prazo para o fornecedor responder precisa ser hoje ou depois.'; end if;
  if p_fornecedor is not null then
    select * into f from public.cmp_fornecedores where id = p_fornecedor;
    if not found or not f.ativo then raise exception 'Fornecedor não encontrado ou inativo.'; end if;
    select c.id, c.criado_nome into v_ex from public.cmp_convites c
     where c.requisicao_id = p_req and c.fornecedor_id = p_fornecedor and c.revogado_em is null;
    if found then raise exception '% já tem convite nesta requisição (criado por %). Use o mesmo link ou cancele o anterior.', f.nome, v_ex.criado_nome; end if;
    if exists (select 1 from public.cmp_propostas where requisicao_id = p_req and fornecedor_id = p_fornecedor and origem = 'fornecedor') then
      raise exception '% já enviou proposta nesta requisição.', f.nome;
    end if;
  elsif length(trim(coalesce(p_contato_nome, ''))) < 2 then
    raise exception 'Para fornecedor ainda sem cadastro, informe o nome da empresa ou do contato.';
  end if;
  insert into public.cmp_convites (requisicao_id, fornecedor_id, contato_nome, telefone, email, prazo, criado_por, criado_nome)
  values (p_req, p_fornecedor, trim(coalesce(nullif(trim(p_contato_nome), ''), f.contato, '')),
    trim(coalesce(nullif(trim(p_telefone), ''), f.telefone, '')), trim(coalesce(nullif(trim(p_email), ''), f.email, '')),
    p_prazo, auth.uid(), coalesce(public.cmp_nome_atual(), ''))
  returning id, codigo into v_id, v_codigo;
  if r.status = 'nova' then update public.cmp_requisicoes set status = 'cotacao' where id = p_req; end if;
  perform public.cmp_registrar(p_req, p_fornecedor, r.unidade_id, 'convite_criado',
    format('Convite para cotar enviado a %s, prazo até %s', coalesce(f.nome, trim(p_contato_nome) || ' (sem cadastro)'), to_char(p_prazo, 'DD/MM/YYYY')),
    jsonb_build_object('convite', v_id, 'prazo', p_prazo));
  return jsonb_build_object('id', v_id, 'codigo', v_codigo);
end $$;

create or replace function public.cmp_convite_prazo(p_convite bigint, p_prazo date)
returns void language plpgsql security definer set search_path = public as $$
declare c public.cmp_convites; r public.cmp_requisicoes;
begin
  select * into c from public.cmp_convites where id = p_convite;
  if not found then raise exception 'Convite não encontrado.'; end if;
  r := public.cmp_req_para(c.requisicao_id, array['comprador'], array['nova', 'cotacao']);
  if c.revogado_em is not null then raise exception 'Convite cancelado: crie outro.'; end if;
  if p_prazo is null or p_prazo < public.cmp_hoje() then raise exception 'O prazo para o fornecedor responder precisa ser hoje ou depois.'; end if;
  update public.cmp_convites set prazo = p_prazo where id = p_convite;
  perform public.cmp_registrar(c.requisicao_id, c.fornecedor_id, r.unidade_id, 'convite_prazo',
    format('Prazo do convite de %s mudou de %s para %s', coalesce((select nome from public.cmp_fornecedores where id = c.fornecedor_id), c.contato_nome),
      to_char(c.prazo, 'DD/MM/YYYY'), to_char(p_prazo, 'DD/MM/YYYY')),
    jsonb_build_object('convite', p_convite, 'prazo', p_prazo, 'prazo_anterior', c.prazo));
end $$;

create or replace function public.cmp_convite_cancelar(p_convite bigint)
returns void language plpgsql security definer set search_path = public as $$
declare c public.cmp_convites; r public.cmp_requisicoes;
begin
  select * into c from public.cmp_convites where id = p_convite;
  if not found then raise exception 'Convite não encontrado.'; end if;
  select * into r from public.cmp_requisicoes where id = c.requisicao_id;
  if not public.cmp_tem_papel(r.unidade_id, array['comprador']) then raise exception 'Só o comprador cancela o convite.'; end if;
  if c.revogado_em is not null then return; end if;
  update public.cmp_convites set revogado_em = now(), revogado_nome = coalesce(public.cmp_nome_atual(), '') where id = p_convite;
  perform public.cmp_registrar(c.requisicao_id, c.fornecedor_id, r.unidade_id, 'convite_cancelado',
    format('Convite de %s cancelado: o link deixa de funcionar', coalesce((select nome from public.cmp_fornecedores where id = c.fornecedor_id), c.contato_nome)),
    jsonb_build_object('convite', p_convite));
end $$;

-- ---------------------------------------------------------------- comprador não altera proposta enviada pelo fornecedor
create or replace function public.cmp_salvar_proposta(p_req bigint, p_fornecedor uuid, p_preco numeric, p_frete numeric, p_extras numeric,
  p_prazo int, p_pagamento text, p_pagamento_dias int, p_validade date, p_obs text)
returns bigint language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; f record; v_ant record; v_id bigint; v_total numeric;
begin
  r := public.cmp_req_para(p_req, array['comprador'], array['nova', 'cotacao']);
  select * into f from public.cmp_fornecedores where id = p_fornecedor;
  if not found or not f.ativo then raise exception 'Fornecedor não encontrado ou inativo.'; end if;
  if f.certidoes_validade is not null and f.certidoes_validade < current_date then
    raise exception 'As certidões de % venceram em %. Atualize o cadastro antes de registrar a proposta.', f.nome, to_char(f.certidoes_validade, 'DD/MM/YYYY');
  end if;
  if p_preco is null or p_preco < 0 or p_prazo is null or p_prazo < 0 then raise exception 'Preço e prazo são obrigatórios.'; end if;
  v_total := round(p_preco * r.quantidade + coalesce(p_frete, 0), 2);
  select * into v_ant from public.cmp_propostas where requisicao_id = p_req and fornecedor_id = p_fornecedor;
  if found and v_ant.origem = 'fornecedor' then
    raise exception 'A proposta de % foi enviada pelo próprio fornecedor e só ele altera (pelo link do convite). Você pode excluí-la com motivo.', f.nome;
  end if;
  if found then
    update public.cmp_propostas set preco_unitario = p_preco, frete = coalesce(p_frete, 0), custos_extras = coalesce(p_extras, 0),
      prazo_dias = p_prazo, pagamento = coalesce(p_pagamento, 'À vista'), pagamento_dias = coalesce(p_pagamento_dias, 0),
      validade = p_validade, obs = coalesce(p_obs, ''), atualizada_em = now(),
      rodada = case when p_preco <> v_ant.preco_unitario then v_ant.rodada + 1 else v_ant.rodada end,
      preco_anterior = case when p_preco <> v_ant.preco_unitario then v_ant.preco_unitario else v_ant.preco_anterior end
     where id = v_ant.id returning id into v_id;
    perform public.cmp_registrar(p_req, p_fornecedor, r.unidade_id, 'proposta_alterada',
      format('Proposta de %s alterada: %s → %s', f.nome,
        public.cmp_brl(round(v_ant.preco_unitario * r.quantidade + v_ant.frete, 2)), public.cmp_brl(v_total)),
      jsonb_build_object('preco_unitario', p_preco, 'preco_anterior', v_ant.preco_unitario, 'prazo_dias', p_prazo));
  else
    insert into public.cmp_propostas (requisicao_id, fornecedor_id, preco_unitario, frete, custos_extras, prazo_dias, pagamento,
      pagamento_dias, validade, obs, registrada_por)
    values (p_req, p_fornecedor, p_preco, coalesce(p_frete, 0), coalesce(p_extras, 0), p_prazo, coalesce(p_pagamento, 'À vista'),
      coalesce(p_pagamento_dias, 0), p_validade, coalesce(p_obs, ''), auth.uid())
    returning id into v_id;
    perform public.cmp_registrar(p_req, p_fornecedor, r.unidade_id, 'proposta_registrada',
      format('Proposta de %s registrada: total %s, prazo %s dias, %s', f.nome, public.cmp_brl(v_total), p_prazo, coalesce(p_pagamento, 'À vista')),
      jsonb_build_object('preco_unitario', p_preco, 'frete', p_frete, 'custos_extras', p_extras, 'prazo_dias', p_prazo));
  end if;
  -- qualquer mudança nas propostas desfaz a escolha (o mapa mudou)
  update public.cmp_requisicoes set status = 'cotacao',
    proposta_escolhida = null, justificativa = case when proposta_escolhida is null then justificativa else '' end
   where id = p_req;
  if r.proposta_escolhida is not null then
    perform public.cmp_registrar(p_req, null, r.unidade_id, 'escolha_desfeita', 'Escolha desfeita porque as propostas mudaram.');
  end if;
  return v_id;
end $$;

-- excluir: proposta do fornecedor exige motivo (a assinatura ganha p_motivo)
drop function if exists public.cmp_excluir_proposta(bigint);
create or replace function public.cmp_excluir_proposta(p_proposta bigint, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare p record; r public.cmp_requisicoes;
begin
  select pr.*, f.nome as fnome into p from public.cmp_propostas pr join public.cmp_fornecedores f on f.id = pr.fornecedor_id where pr.id = p_proposta;
  if not found then raise exception 'Proposta não encontrada.'; end if;
  r := public.cmp_req_para(p.requisicao_id, array['comprador'], array['nova', 'cotacao']);
  if p.origem = 'fornecedor' and length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'A proposta foi enviada pelo próprio fornecedor: escreva o motivo da exclusão.';
  end if;
  update public.cmp_requisicoes set proposta_escolhida = null, justificativa = '' where id = r.id and proposta_escolhida = p_proposta;
  delete from public.cmp_propostas where id = p_proposta;
  perform public.cmp_registrar(r.id, p.fornecedor_id, r.unidade_id, 'proposta_excluida',
    'Proposta de ' || p.fnome || ' excluída' || case when coalesce(trim(p_motivo), '') <> '' then ': ' || trim(p_motivo) else '.' end,
    jsonb_build_object('origem', p.origem, 'preco_unitario', p.preco_unitario, 'anexo', p.anexo));
end $$;

revoke execute on function public.cmp_convidar(bigint, uuid, text, text, text, date), public.cmp_convite_prazo(bigint, date),
  public.cmp_convite_cancelar(bigint), public.cmp_excluir_proposta(bigint, text) from public, anon;
grant execute on function public.cmp_convidar(bigint, uuid, text, text, text, date), public.cmp_convite_prazo(bigint, date),
  public.cmp_convite_cancelar(bigint), public.cmp_excluir_proposta(bigint, text) to authenticated;

-- ---------------------------------------------------------------- fornecedor (sem login, só com o código do link)
-- convite pelo código, travado; diz se está aberto
create or replace function public.cmp_convite_do_codigo(p_codigo text, p_travar boolean default false)
returns public.cmp_convites language plpgsql security definer set search_path = public as $$
declare c public.cmp_convites;
begin
  if coalesce(p_codigo, '') !~ '^[0-9a-f]{64}$' then raise exception 'Link de cotação inválido. Confira se copiou o endereço inteiro.'; end if;
  if p_travar then select * into c from public.cmp_convites where codigo = p_codigo for update;
  else select * into c from public.cmp_convites where codigo = p_codigo; end if;
  if not found then raise exception 'Link de cotação inválido. Confira se copiou o endereço inteiro.'; end if;
  return c;
end $$;
revoke execute on function public.cmp_convite_do_codigo(text, boolean) from public, anon, authenticated;

create or replace function public.cmp_convite_situacao(c public.cmp_convites, r public.cmp_requisicoes) returns text
language sql stable as $$
  select case when c.revogado_em is not null then 'cancelado'
              when r.status not in ('nova', 'cotacao') then 'fechado'
              when public.cmp_hoje() > c.prazo then 'encerrado'
              else 'aberto' end
$$;

-- usado pela política do Storage: o PDF só entra na pasta de um convite aberto
create or replace function public.cmp_codigo_aberto(p_codigo text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_codigo, '') ~ '^[0-9a-f]{64}$' and exists (
    select 1 from public.cmp_convites c join public.cmp_requisicoes r on r.id = c.requisicao_id
     where c.codigo = p_codigo and public.cmp_convite_situacao(c, r) = 'aberto')
$$;

-- o que o fornecedor vê: a requisição (sem valor estimado nem quem pediu), o prazo e a própria proposta
create or replace function public.cmp_cotacao_ler(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cmp_convites; r public.cmp_requisicoes; f public.cmp_fornecedores; p public.cmp_propostas; v_quem text;
begin
  c := public.cmp_convite_do_codigo(p_codigo, true);
  select * into r from public.cmp_requisicoes where id = c.requisicao_id;
  if c.fornecedor_id is not null then
    select * into f from public.cmp_fornecedores where id = c.fornecedor_id;
    select * into p from public.cmp_propostas where requisicao_id = r.id and fornecedor_id = c.fornecedor_id;
  end if;
  if c.aberto_em is null then
    update public.cmp_convites set aberto_em = now() where id = c.id;
    v_quem := coalesce(f.nome, nullif(c.contato_nome, ''), 'Fornecedor') || ' (pelo link)';
    perform public.cmp_registrar_fornecedor(r.id, c.fornecedor_id, r.unidade_id, 'convite_aberto', 'Fornecedor abriu o link do convite', v_quem,
      jsonb_build_object('convite', c.id));
  end if;
  return jsonb_build_object(
    'situacao', public.cmp_convite_situacao(c, r),
    'prazo', c.prazo,
    'unidade', (select nome from public.cmp_unidades where id = r.unidade_id),
    'requisicao', jsonb_build_object('numero', r.id, 'titulo', r.titulo, 'descricao', r.descricao, 'grupo', r.grupo,
      'quantidade', r.quantidade, 'unidade_medida', r.unidade_medida, 'precisa_ate', r.precisa_ate),
    'contato_nome', c.contato_nome,
    'fornecedor', case when f.id is null then null else jsonb_build_object('nome', f.nome, 'tipo', f.tipo,
      'documento', case when f.tipo = 'PJ' then f.documento else '***' || substr(f.documento, 4, 6) || '**' end) end,
    'proposta', case when p.id is null or p.origem <> 'fornecedor' then null else jsonb_build_object(
      'protocolo', 'P-' || p.id, 'preco_unitario', p.preco_unitario, 'frete', p.frete, 'custos_extras', p.custos_extras,
      'prazo_dias', p.prazo_dias, 'pagamento', p.pagamento, 'pagamento_dias', p.pagamento_dias, 'validade', p.validade,
      'obs', p.obs, 'declarante', p.declarante, 'tem_anexo', p.anexo is not null, 'rodada', p.rodada, 'em', p.atualizada_em) end);
end $$;

-- o fornecedor envia (ou reenvia) a proposta; se o convite é para contato sem cadastro, informa CNPJ/CPF aqui
create or replace function public.cmp_cotacao_enviar(p_codigo text, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cmp_convites; r public.cmp_requisicoes; f public.cmp_fornecedores; v_ant public.cmp_propostas;
  v_tipo text; v_doc text; v_nome text; v_quem text; v_id bigint; v_total numeric; v_anexo text;
  v_preco numeric; v_frete numeric; v_extras numeric; v_prazo int; v_pag text; v_pagdias int; v_validade date; v_obs text; v_decl text;
begin
  c := public.cmp_convite_do_codigo(p_codigo, true);
  select * into r from public.cmp_requisicoes where id = c.requisicao_id for update;
  case public.cmp_convite_situacao(c, r)
    when 'cancelado' then raise exception 'Este convite foi cancelado pelo comprador.';
    when 'fechado' then raise exception 'A cotação já foi encerrada pelo comprador: não recebe mais propostas.';
    when 'encerrado' then raise exception 'O prazo para enviar a proposta terminou em %.', to_char(c.prazo, 'DD/MM/YYYY');
    else null;
  end case;

  -- campos da proposta
  begin
    v_preco := round((p_dados ->> 'preco_unitario')::numeric, 2);
    v_frete := round(coalesce(nullif(p_dados ->> 'frete', '')::numeric, 0), 2);
    v_extras := round(coalesce(nullif(p_dados ->> 'custos_extras', '')::numeric, 0), 2);
    v_prazo := (p_dados ->> 'prazo_dias')::int;
    v_pagdias := coalesce(nullif(p_dados ->> 'pagamento_dias', '')::int, 0);
    v_validade := nullif(p_dados ->> 'validade', '')::date;
  exception when others then raise exception 'Confira os números: preço, frete e prazo só com algarismos.';
  end;
  v_pag := left(trim(coalesce(nullif(p_dados ->> 'pagamento', ''), 'À vista')), 60);
  v_obs := left(trim(coalesce(p_dados ->> 'obs', '')), 1000);
  v_decl := left(trim(coalesce(p_dados ->> 'declarante', '')), 120);
  if v_preco is null or v_preco < 0 or v_prazo is null or v_prazo < 0 then raise exception 'Preço unitário e prazo de entrega são obrigatórios.'; end if;
  if v_preco >= 1e11 or v_frete < 0 or v_frete >= 1e11 or v_extras < 0 or v_extras >= 1e11 or v_prazo > 3650 or v_pagdias < 0 or v_pagdias > 3650 then
    raise exception 'Confira os valores digitados: algum está fora do esperado.';
  end if;
  if v_validade is not null and v_validade < public.cmp_hoje() then raise exception 'A validade da proposta já passou.'; end if;
  if length(v_decl) < 3 then raise exception 'Informe o seu nome (quem está enviando a proposta).'; end if;
  if coalesce((p_dados ->> 'aceite')::boolean, false) is not true then raise exception 'Marque a declaração de que a proposta é válida para enviar.'; end if;

  -- PDF: só da pasta deste convite e já gravado no Storage
  v_anexo := nullif(p_dados ->> 'anexo', '');
  if v_anexo is not null and (v_anexo !~ ('^' || c.codigo || '/[0-9A-Za-z_.-]+\.pdf$')
     or not exists (select 1 from storage.objects where bucket_id = 'cmp-propostas' and name = v_anexo)) then
    raise exception 'O PDF não foi recebido. Anexe de novo.';
  end if;

  -- quem é o fornecedor
  if c.fornecedor_id is null then
    v_tipo := upper(coalesce(p_dados ->> 'tipo', ''));
    v_doc := upper(regexp_replace(coalesce(p_dados ->> 'documento', ''), '[^0-9A-Za-z]', '', 'g'));
    v_nome := left(trim(coalesce(p_dados ->> 'nome', '')), 160);
    if v_tipo not in ('PJ', 'PF') then raise exception 'Escolha se é empresa (CNPJ) ou pessoa física (CPF).'; end if;
    if not public.cmp_doc_valido(v_tipo, v_doc) then
      raise exception '% inválido (dígito verificador não confere). Confira o número.', case when v_tipo = 'PF' then 'CPF' else 'CNPJ' end;
    end if;
    select * into f from public.cmp_fornecedores where documento = v_doc;
    if found then
      if not f.ativo then raise exception 'Este cadastro está inativo para cotações. Fale com o comprador.'; end if;
      if exists (select 1 from public.cmp_convites x where x.requisicao_id = r.id and x.fornecedor_id = f.id and x.revogado_em is null and x.id <> c.id) then
        raise exception 'Este % já recebeu outro convite para esta cotação. Use o link desse outro convite.', case when v_tipo = 'PF' then 'CPF' else 'CNPJ' end;
      end if;
      update public.cmp_convites set fornecedor_id = f.id where id = c.id;
      perform public.cmp_registrar_fornecedor(r.id, f.id, r.unidade_id, 'convite_identificado',
        format('Fornecedor se identificou pelo link: %s (cadastro já existente na base)', f.nome), f.nome || ' (pelo link)', jsonb_build_object('convite', c.id));
    else
      if length(v_nome) < 2 then raise exception 'Informe a razão social ou o nome.'; end if;
      insert into public.cmp_fornecedores (tipo, documento, nome, grupos, contato, email, telefone, obs, cadastrado_por, cadastrado_nome, cadastrado_unidade)
      values (v_tipo, v_doc, v_nome, array[r.grupo], left(trim(coalesce(p_dados ->> 'contato', '')), 120), left(trim(coalesce(p_dados ->> 'email', '')), 160),
        left(trim(coalesce(p_dados ->> 'telefone', '')), 40), format('Cadastro feito pelo próprio fornecedor no link do convite da requisição #%s.', r.id),
        c.criado_por, c.criado_nome, r.unidade_id)
      returning * into f;
      update public.cmp_convites set fornecedor_id = f.id where id = c.id;
      perform public.cmp_registrar_fornecedor(r.id, f.id, r.unidade_id, 'fornecedor_cadastrado_link',
        format('Fornecedor cadastrado pelo próprio fornecedor no link: %s (%s). Responsável pela homologação: %s (quem convidou)', f.nome, v_tipo, c.criado_nome),
        f.nome || ' (pelo link)', jsonb_build_object('convite', c.id, 'tipo', v_tipo));
    end if;
  else
    select * into f from public.cmp_fornecedores where id = c.fornecedor_id;
    if not f.ativo then raise exception 'Este cadastro está inativo para cotações. Fale com o comprador.'; end if;
  end if;
  v_quem := v_decl || ' — ' || f.nome || ' (pelo link)';

  -- grava a proposta (a do fornecedor substitui uma lançada antes pelo comprador para o mesmo fornecedor)
  v_total := round(v_preco * r.quantidade + v_frete, 2);
  select * into v_ant from public.cmp_propostas where requisicao_id = r.id and fornecedor_id = f.id;
  if found then
    update public.cmp_propostas set preco_unitario = v_preco, frete = v_frete, custos_extras = v_extras, prazo_dias = v_prazo,
      pagamento = v_pag, pagamento_dias = v_pagdias, validade = v_validade, obs = v_obs, atualizada_em = now(),
      rodada = case when v_preco <> v_ant.preco_unitario then v_ant.rodada + 1 else v_ant.rodada end,
      preco_anterior = case when v_preco <> v_ant.preco_unitario then v_ant.preco_unitario else v_ant.preco_anterior end,
      origem = 'fornecedor', convite_id = c.id, declarante = v_decl, anexo = coalesce(v_anexo, v_ant.anexo),
      enviada_ip = public.cmp_origem_requisicao() ->> 'ip'
     where id = v_ant.id returning id into v_id;
  else
    insert into public.cmp_propostas (requisicao_id, fornecedor_id, preco_unitario, frete, custos_extras, prazo_dias, pagamento,
      pagamento_dias, validade, obs, origem, convite_id, declarante, anexo, enviada_ip)
    values (r.id, f.id, v_preco, v_frete, v_extras, v_prazo, v_pag, v_pagdias, v_validade, v_obs, 'fornecedor', c.id, v_decl, v_anexo,
      public.cmp_origem_requisicao() ->> 'ip')
    returning id into v_id;
  end if;
  update public.cmp_convites set respondido_em = now(), aberto_em = coalesce(aberto_em, now()) where id = c.id;
  perform public.cmp_registrar_fornecedor(r.id, f.id, r.unidade_id,
    case when v_ant.id is null then 'proposta_enviada_fornecedor' else 'proposta_reenviada_fornecedor' end,
    format('Proposta %s pelo fornecedor %s: total %s, prazo %s dias, %s%s%s', case when v_ant.id is null then 'enviada' else 'reenviada' end,
      f.nome, public.cmp_brl(v_total), v_prazo, v_pag,
      case when v_ant.id is not null and v_ant.preco_unitario <> v_preco then format(' (antes %s)', public.cmp_brl(round(v_ant.preco_unitario * r.quantidade + v_ant.frete, 2))) else '' end,
      case when v_anexo is not null then ', com PDF' else '' end),
    v_quem, jsonb_build_object('convite', c.id, 'proposta', v_id, 'preco_unitario', v_preco, 'frete', v_frete, 'custos_extras', v_extras,
      'prazo_dias', v_prazo, 'declarante', v_decl, 'anexo', v_anexo, 'origem_anterior', v_ant.origem));
  -- o mapa mudou: volta para cotação e desfaz a escolha
  update public.cmp_requisicoes set status = 'cotacao', proposta_escolhida = null,
    justificativa = case when proposta_escolhida is null then justificativa else '' end
   where id = r.id;
  if r.proposta_escolhida is not null then
    perform public.cmp_registrar_fornecedor(r.id, null, r.unidade_id, 'escolha_desfeita', 'Escolha desfeita porque as propostas mudaram.', v_quem);
  end if;
  return jsonb_build_object('protocolo', 'P-' || v_id, 'em', now());
end $$;

revoke execute on function public.cmp_cotacao_ler(text), public.cmp_cotacao_enviar(text, jsonb), public.cmp_codigo_aberto(text) from public;
grant execute on function public.cmp_cotacao_ler(text), public.cmp_cotacao_enviar(text, jsonb), public.cmp_codigo_aberto(text) to anon, authenticated;
revoke execute on function public.cmp_convite_situacao(public.cmp_convites, public.cmp_requisicoes) from public, anon, authenticated;

-- ---------------------------------------------------------------- PDF da proposta (Storage)
-- pasta = código do convite; o fornecedor (anon) só grava em convite aberto; quem lê é membro da unidade
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cmp-propostas', 'cmp-propostas', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists cmp_propostas_pdf_enviar on storage.objects;
create policy cmp_propostas_pdf_enviar on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'cmp-propostas' and lower(name) like '%.pdf' and public.cmp_codigo_aberto((storage.foldername(name))[1]));
drop policy if exists cmp_propostas_pdf_ler on storage.objects;
create policy cmp_propostas_pdf_ler on storage.objects for select to authenticated
  using (bucket_id = 'cmp-propostas' and exists (
    select 1 from public.cmp_convites c join public.cmp_requisicoes r on r.id = c.requisicao_id
     where c.codigo = (storage.foldername(name))[1] and public.cmp_membro(r.unidade_id)));
