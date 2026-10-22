-- Orçamentos de Compras — Oportunidades para fornecedores (pedido do Marco em 22/10/2026).
-- Decisões do Marco:
--   * a Nervia vende ao FORNECEDOR o acesso às oportunidades: ele se cadastra numa página pública, escolhe os grupos que
--     atende e os estados onde entrega e, com o acesso liberado (pago à Nervia, cobrança manual), vê as requisições que as
--     empresas compradoras abriram e manda proposta sem esperar convite;
--   * NÃO é só quem paga que entra na base: a empresa compradora continua cadastrando e convidando quem quiser, de graça;
--   * pagar não dá vantagem na escolha: a proposta entra no mesmo mapa comparativo, com as mesmas regras (certidões, aval,
--     alçadas, avaliação);
--   * o fornecedor nunca vê o nome da empresa compradora: só cidade/UF, grupo, título, especificação, quantidade e prazos;
--   * nos textos para o fornecedor: "empresas compradoras" (nunca "shoppings").
-- Sem custo novo: sem login para o fornecedor (o link da área de Oportunidades tem um código de 64 hex, como o convite) e
-- sem envio automático de e-mail/WhatsApp (a Nervia manda o link pelo próprio WhatsApp/e-mail).
-- Ao participar de uma oportunidade, o fornecedor ganha um convite (origem 'portal') e usa a mesma página de cotação da
-- fase 2 (/cotacao/#código): proposta, PDF, reenvio até o prazo, histórico e auditoria iguais.

-- ---------------------------------------------------------------- estados (UF)
create or replace function public.cmp_ufs() returns text[]
language sql immutable as $$
  select array['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']
$$;

-- onde fica a unidade (o fornecedor vê só cidade/UF)
alter table public.cmp_unidades add column if not exists cidade text not null default '';
alter table public.cmp_unidades add column if not exists uf text not null default '';
alter table public.cmp_unidades drop constraint if exists cmp_unidades_uf;
alter table public.cmp_unidades add constraint cmp_unidades_uf check (uf = '' or uf = any (public.cmp_ufs()));

-- estados onde o fornecedor entrega (vazio = todo o Brasil)
alter table public.cmp_fornecedores add column if not exists regioes text[] not null default '{}';
alter table public.cmp_fornecedores drop constraint if exists cmp_fornecedores_regioes;
alter table public.cmp_fornecedores add constraint cmp_fornecedores_regioes check (regioes <@ public.cmp_ufs());

-- requisição aberta para os fornecedores com acesso
alter table public.cmp_requisicoes add column if not exists aberta_fornecedores boolean not null default false;
alter table public.cmp_requisicoes add column if not exists aberta_ate date;
alter table public.cmp_requisicoes add column if not exists aberta_nome text not null default '';
alter table public.cmp_requisicoes add column if not exists aberta_em timestamptz;

-- convite criado pelo próprio fornecedor na área de Oportunidades
alter table public.cmp_convites add column if not exists origem text not null default 'comprador';
alter table public.cmp_convites drop constraint if exists cmp_convites_origem;
alter table public.cmp_convites add constraint cmp_convites_origem check (origem in ('comprador', 'portal'));

-- ---------------------------------------------------------------- pedidos de cadastro (página pública)
create table if not exists public.cmp_solicitacoes (
  id             bigint generated always as identity primary key,
  tipo           text not null check (tipo in ('PJ', 'PF')),
  documento      text not null,
  nome           text not null,
  contato        text not null default '',
  email          text not null default '',
  telefone       text not null default '',
  grupos         text[] not null default '{}',
  regioes        text[] not null default '{}',
  mensagem       text not null default '',
  ip             text,
  navegador      text,
  criado_em      timestamptz not null default now(),
  status         text not null default 'pendente' check (status in ('pendente', 'aprovada', 'recusada')),
  fornecedor_id  uuid references public.cmp_fornecedores on delete set null,
  decidido_por   uuid references auth.users on delete set null,
  decidido_nome  text,
  decidido_em    timestamptz,
  motivo         text
);
create index if not exists cmp_solicitacoes_doc on public.cmp_solicitacoes (documento);

-- acesso pago às oportunidades (um ativo por fornecedor; renovar = mudar a validade)
create table if not exists public.cmp_assinaturas (
  id             bigint generated always as identity primary key,
  fornecedor_id  uuid not null references public.cmp_fornecedores on delete cascade,
  codigo         text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  valido_ate     date not null,
  valor          numeric(12,2) check (valor >= 0),        -- quanto o fornecedor pagou (registro interno)
  obs            text not null default '',
  criado_por     uuid references auth.users on delete set null,
  criado_nome    text not null default '',
  criado_em      timestamptz not null default now(),
  renovado_em    timestamptz,
  aberto_em      timestamptz,                               -- último acesso à área de Oportunidades
  revogado_em    timestamptz,
  revogado_nome  text,
  revogado_motivo text
);
create unique index if not exists cmp_assinaturas_ativa on public.cmp_assinaturas (fornecedor_id) where revogado_em is null;

alter table public.cmp_solicitacoes enable row level security;
alter table public.cmp_assinaturas enable row level security;
revoke all on public.cmp_solicitacoes, public.cmp_assinaturas from anon, authenticated;
grant select on public.cmp_solicitacoes, public.cmp_assinaturas to authenticated;
drop policy if exists cmp_solicitacoes_ler on public.cmp_solicitacoes;
create policy cmp_solicitacoes_ler on public.cmp_solicitacoes for select using (public.eh_admin());
drop policy if exists cmp_assinaturas_ler on public.cmp_assinaturas;
create policy cmp_assinaturas_ler on public.cmp_assinaturas for select using (public.eh_admin());

-- auditoria de ação feita sem login (página pública / área de Oportunidades)
create or replace function public.cmp_auditar_anonimo(p_acao text, p_quem text, p_det jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_orig jsonb := public.cmp_origem_requisicao();
begin
  insert into public.auditoria (user_id, email, nome, papel, acao, cnpj, detalhes, ip, navegador)
  values (null, null, p_quem, 'sistema', 'compras_' || p_acao, null, coalesce(p_det, '{}'), v_orig ->> 'ip', v_orig ->> 'navegador');
end $$;
revoke execute on function public.cmp_auditar_anonimo(text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- página pública: o que mostrar e o pedido de cadastro
-- grupos (com descrição), quantas empresas compradoras usam o app (só a partir de 3, para não identificar) e os estados
create or replace function public.cmp_vitrine_fornecedores()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'grupos', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'descricao', descricao) order by ordem, nome), '[]') from public.cmp_grupos),
    'empresas', (select case when n >= 3 then n end from (select count(distinct coalesce(nullif(empresa, ''), id::text)) n from public.cmp_unidades where ativo) x),
    'ufs', (select coalesce(jsonb_agg(distinct uf), '[]') from public.cmp_unidades where ativo and uf <> ''),
    'lista_ufs', to_jsonb(public.cmp_ufs()))
$$;

create or replace function public.cmp_solicitar_cadastro(p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tipo text; v_doc text; v_nome text; v_email text; v_tel text; v_grupos text[]; v_regioes text[]; v_id bigint;
  v_orig jsonb := public.cmp_origem_requisicao(); v_ant record; f public.cmp_fornecedores;
begin
  v_tipo := upper(coalesce(p_dados ->> 'tipo', ''));
  v_doc := upper(regexp_replace(coalesce(p_dados ->> 'documento', ''), '[^0-9A-Za-z]', '', 'g'));
  v_nome := left(trim(coalesce(p_dados ->> 'nome', '')), 160);
  v_email := lower(left(trim(coalesce(p_dados ->> 'email', '')), 160));
  v_tel := left(trim(coalesce(p_dados ->> 'telefone', '')), 40);
  if v_tipo not in ('PJ', 'PF') then raise exception 'Escolha se é empresa (CNPJ) ou pessoa física (CPF).'; end if;
  if not public.cmp_doc_valido(v_tipo, v_doc) then
    raise exception '% inválido (dígito verificador não confere). Confira o número.', case when v_tipo = 'PF' then 'CPF' else 'CNPJ' end;
  end if;
  if length(v_nome) < 2 then raise exception 'Informe a razão social ou o nome.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Informe um e-mail válido.'; end if;
  if length(regexp_replace(v_tel, '\D', '', 'g')) < 10 then raise exception 'Informe o WhatsApp ou telefone com DDD.'; end if;
  begin
    select coalesce(array_agg(distinct g), '{}') into v_grupos from jsonb_array_elements_text(coalesce(p_dados -> 'grupos', '[]')) g;
    select coalesce(array_agg(distinct upper(x)), '{}') into v_regioes from jsonb_array_elements_text(coalesce(p_dados -> 'regioes', '[]')) x;
  exception when others then raise exception 'Escolha os grupos e os estados na lista.';
  end;
  if cardinality(v_grupos) = 0 then raise exception 'Escolha pelo menos um grupo de produtos ou serviços que você fornece.'; end if;
  if exists (select 1 from unnest(v_grupos) g where not exists (select 1 from public.cmp_grupos where nome = g)) then
    raise exception 'Grupo desconhecido. Recarregue a página e escolha na lista.';
  end if;
  if not (v_regioes <@ public.cmp_ufs()) then raise exception 'Estado desconhecido. Escolha na lista.'; end if;
  if coalesce((p_dados ->> 'aceite')::boolean, false) is not true then raise exception 'Marque que leu e aceita as condições para enviar.'; end if;
  -- limite contra robô: 5 pedidos por hora por endereço IP
  if (v_orig ->> 'ip') is not null and (select count(*) from public.cmp_solicitacoes
       where ip = v_orig ->> 'ip' and criado_em > now() - interval '1 hour') >= 5 then
    raise exception 'Muitos pedidos deste endereço. Tente de novo mais tarde ou fale com a Nervia pelo WhatsApp.';
  end if;
  select * into v_ant from public.cmp_solicitacoes where documento = v_doc and status = 'pendente' order by id desc limit 1;
  if found then
    raise exception 'Já recebemos um pedido deste % em % (protocolo S-%). A Nervia vai entrar em contato.',
      case when v_tipo = 'PF' then 'CPF' else 'CNPJ' end, to_char(v_ant.criado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), v_ant.id;
  end if;
  select * into f from public.cmp_fornecedores where documento = v_doc;
  if found and exists (select 1 from public.cmp_assinaturas where fornecedor_id = f.id and revogado_em is null and valido_ate >= public.cmp_hoje()) then
    raise exception 'Este % já tem acesso às oportunidades. Use o link que recebeu da Nervia (se perdeu, fale com a Nervia).',
      case when v_tipo = 'PF' then 'CPF' else 'CNPJ' end;
  end if;
  insert into public.cmp_solicitacoes (tipo, documento, nome, contato, email, telefone, grupos, regioes, mensagem, ip, navegador)
  values (v_tipo, v_doc, v_nome, left(trim(coalesce(p_dados ->> 'contato', '')), 120), v_email, v_tel, v_grupos, v_regioes,
    left(trim(coalesce(p_dados ->> 'mensagem', '')), 1000), v_orig ->> 'ip', v_orig ->> 'navegador')
  returning id into v_id;
  perform public.cmp_auditar_anonimo('cadastro_solicitado', v_nome || ' (página de fornecedores)',
    jsonb_build_object('protocolo', 'S-' || v_id, 'tipo', v_tipo, 'grupos', v_grupos, 'regioes', v_regioes));
  return jsonb_build_object('protocolo', 'S-' || v_id);
end $$;

revoke execute on function public.cmp_vitrine_fornecedores(), public.cmp_solicitar_cadastro(jsonb) from public;
grant execute on function public.cmp_vitrine_fornecedores(), public.cmp_solicitar_cadastro(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- equipe Nervia: pedidos e acessos
create or replace function public.cmp_assinatura_situacao(a public.cmp_assinaturas) returns text
language sql stable as $$
  select case when a.revogado_em is not null then 'cancelado' when a.valido_ate < public.cmp_hoje() then 'vencido' else 'ativo' end
$$;
revoke execute on function public.cmp_assinatura_situacao(public.cmp_assinaturas) from public, anon, authenticated;

create or replace function public.cmp_oportunidades_admin()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia.'; end if;
  return jsonb_build_object(
    'solicitacoes', (select coalesce(jsonb_agg(to_jsonb(s) - 'navegador' order by s.id desc), '[]')
                       from (select * from public.cmp_solicitacoes order by id desc limit 200) s),
    'acessos', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'fornecedor_id', f.id, 'nome', f.nome, 'tipo', f.tipo, 'documento', f.documento, 'grupos', f.grupos, 'regioes', f.regioes,
        'contato', f.contato, 'email', f.email, 'telefone', f.telefone, 'ativo_base', f.ativo, 'codigo', a.codigo, 'valido_ate', a.valido_ate,
        'valor', a.valor, 'obs', a.obs, 'criado_nome', a.criado_nome, 'criado_em', a.criado_em, 'renovado_em', a.renovado_em,
        'aberto_em', a.aberto_em, 'revogado_em', a.revogado_em, 'revogado_motivo', a.revogado_motivo,
        'situacao', public.cmp_assinatura_situacao(a),
        'participacoes', (select count(*) from public.cmp_convites c where c.fornecedor_id = f.id and c.origem = 'portal'),
        'propostas', (select count(*) from public.cmp_convites c where c.fornecedor_id = f.id and c.origem = 'portal' and c.respondido_em is not null))
        order by a.revogado_em is not null, a.valido_ate desc), '[]')
       from public.cmp_assinaturas a join public.cmp_fornecedores f on f.id = a.fornecedor_id));
end $$;

-- libera (ou renova) o acesso: a partir de um pedido da página pública OU de um fornecedor que já está na base
create or replace function public.cmp_acesso_liberar(p_solicitacao bigint, p_fornecedor uuid, p_valido_ate date, p_grupos text[],
  p_regioes text[], p_valor numeric, p_obs text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.cmp_solicitacoes; f public.cmp_fornecedores; a public.cmp_assinaturas; v_quem text := coalesce(public.cmp_nome_atual(), '');
  v_grupos text[] := coalesce(p_grupos, '{}'); v_regioes text[] := coalesce(p_regioes, '{}'); v_novo boolean := false;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia libera o acesso às oportunidades.'; end if;
  if p_valido_ate is null or p_valido_ate < public.cmp_hoje() then raise exception 'A validade do acesso precisa ser hoje ou depois.'; end if;
  if p_valor is not null and p_valor < 0 then raise exception 'Valor inválido.'; end if;
  if exists (select 1 from unnest(v_grupos) g where not exists (select 1 from public.cmp_grupos where nome = g)) then raise exception 'Grupo desconhecido.'; end if;
  if not (v_regioes <@ public.cmp_ufs()) then raise exception 'Estado desconhecido.'; end if;
  v_regioes := array(select distinct x from unnest(v_regioes) x order by 1);
  if p_solicitacao is not null then
    select * into s from public.cmp_solicitacoes where id = p_solicitacao for update;
    if not found then raise exception 'Pedido de cadastro não encontrado.'; end if;
    if s.status <> 'pendente' then raise exception 'Este pedido já foi %.', s.status; end if;
    if cardinality(v_grupos) = 0 then v_grupos := s.grupos; end if;
    if p_regioes is null then v_regioes := array(select distinct x from unnest(s.regioes) x order by 1); end if;
    select * into f from public.cmp_fornecedores where documento = s.documento for update;
    if not found then
      insert into public.cmp_fornecedores (tipo, documento, nome, grupos, regioes, contato, email, telefone, obs, cadastrado_por, cadastrado_nome)
      values (s.tipo, s.documento, s.nome, v_grupos, v_regioes, s.contato, s.email, s.telefone,
        format('Cadastro pela página de fornecedores (pedido S-%s), com acesso às Oportunidades. Homologação: equipe Nervia.', s.id), auth.uid(), v_quem)
      returning * into f;
      v_novo := true;
    end if;
    update public.cmp_solicitacoes set status = 'aprovada', fornecedor_id = f.id, decidido_por = auth.uid(), decidido_nome = v_quem, decidido_em = now()
     where id = s.id;
  else
    select * into f from public.cmp_fornecedores where id = p_fornecedor for update;
    if not found then raise exception 'Fornecedor não encontrado.'; end if;
  end if;
  if not f.ativo then raise exception '% está inativo na base: reative o cadastro antes de liberar o acesso.', f.nome; end if;
  -- grupos: soma aos que já tinha (a base é de todos); estados: os informados agora
  if not v_novo then
    update public.cmp_fornecedores set grupos = array(select distinct x from unnest(grupos || v_grupos) x order by 1), regioes = v_regioes
     where id = f.id returning * into f;
  end if;
  if cardinality(f.grupos) = 0 then raise exception 'Escolha pelo menos um grupo para o fornecedor ver as oportunidades.'; end if;
  select * into a from public.cmp_assinaturas where fornecedor_id = f.id and revogado_em is null for update;
  if found then
    update public.cmp_assinaturas set valido_ate = p_valido_ate, valor = coalesce(p_valor, valor),
      obs = coalesce(nullif(trim(p_obs), ''), obs), renovado_em = now() where id = a.id returning * into a;
    perform public.auditar('compras_acesso_renovado', null, jsonb_build_object('fornecedor', f.nome, 'fornecedor_id', f.id, 'acesso', a.id,
      'valido_ate', p_valido_ate, 'valor', p_valor, 'grupos', f.grupos, 'regioes', f.regioes));
  else
    insert into public.cmp_assinaturas (fornecedor_id, valido_ate, valor, obs, criado_por, criado_nome)
    values (f.id, p_valido_ate, p_valor, coalesce(trim(p_obs), ''), auth.uid(), v_quem) returning * into a;
    perform public.auditar('compras_acesso_liberado', null, jsonb_build_object('fornecedor', f.nome, 'fornecedor_id', f.id, 'acesso', a.id,
      'valido_ate', p_valido_ate, 'valor', p_valor, 'grupos', f.grupos, 'regioes', f.regioes, 'pedido', p_solicitacao, 'cadastro_novo', v_novo));
  end if;
  return jsonb_build_object('id', a.id, 'codigo', a.codigo, 'fornecedor_id', f.id);
end $$;

create or replace function public.cmp_solicitacao_recusar(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare s public.cmp_solicitacoes;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escreva o motivo (pelo menos 5 letras).'; end if;
  select * into s from public.cmp_solicitacoes where id = p_id for update;
  if not found then raise exception 'Pedido de cadastro não encontrado.'; end if;
  if s.status <> 'pendente' then raise exception 'Este pedido já foi %.', s.status; end if;
  update public.cmp_solicitacoes set status = 'recusada', motivo = trim(p_motivo), decidido_por = auth.uid(),
    decidido_nome = coalesce(public.cmp_nome_atual(), ''), decidido_em = now() where id = p_id;
  perform public.auditar('compras_cadastro_recusado', null, jsonb_build_object('pedido', 'S-' || p_id, 'nome', s.nome, 'motivo', trim(p_motivo)));
end $$;

create or replace function public.cmp_acesso_revogar(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.cmp_assinaturas;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escreva o motivo (pelo menos 5 letras).'; end if;
  select * into a from public.cmp_assinaturas where id = p_id for update;
  if not found then raise exception 'Acesso não encontrado.'; end if;
  if a.revogado_em is not null then raise exception 'Este acesso já foi cancelado.'; end if;
  update public.cmp_assinaturas set revogado_em = now(), revogado_nome = coalesce(public.cmp_nome_atual(), ''), revogado_motivo = trim(p_motivo) where id = p_id;
  perform public.auditar('compras_acesso_cancelado', null, jsonb_build_object('acesso', p_id, 'fornecedor_id', a.fornecedor_id,
    'fornecedor', (select nome from public.cmp_fornecedores where id = a.fornecedor_id), 'motivo', trim(p_motivo)));
end $$;

revoke execute on function public.cmp_oportunidades_admin(), public.cmp_acesso_liberar(bigint, uuid, date, text[], text[], numeric, text),
  public.cmp_solicitacao_recusar(bigint, text), public.cmp_acesso_revogar(bigint, text) from public, anon;
grant execute on function public.cmp_oportunidades_admin(), public.cmp_acesso_liberar(bigint, uuid, date, text[], text[], numeric, text),
  public.cmp_solicitacao_recusar(bigint, text), public.cmp_acesso_revogar(bigint, text) to authenticated;

-- ---------------------------------------------------------------- comprador/gerente: abrir e fechar a requisição
create or replace function public.cmp_abrir_oportunidade(p_req bigint, p_ate date)
returns void language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; u public.cmp_unidades;
begin
  r := public.cmp_req_para(p_req, array['comprador', 'gerente'], array['nova', 'cotacao']);
  select * into u from public.cmp_unidades where id = r.unidade_id;
  if u.uf = '' then raise exception 'Antes, a Nervia precisa cadastrar a cidade e o estado de % (o fornecedor vê só a cidade e o estado, nunca o nome da empresa).', u.nome; end if;
  if p_ate is null or p_ate < public.cmp_hoje() then raise exception 'O prazo para receber propostas precisa ser hoje ou depois.'; end if;
  if p_ate > public.cmp_hoje() + 60 then raise exception 'O prazo pode ser de no máximo 60 dias.'; end if;
  update public.cmp_requisicoes set aberta_fornecedores = true, aberta_ate = p_ate, aberta_nome = coalesce(public.cmp_nome_atual(), ''),
    aberta_em = now(), status = case when status = 'nova' then 'cotacao' else status end where id = p_req;
  -- quem já entrou pelas Oportunidades acompanha o novo prazo
  update public.cmp_convites set prazo = p_ate where requisicao_id = p_req and origem = 'portal' and revogado_em is null;
  perform public.cmp_registrar(p_req, null, r.unidade_id, case when r.aberta_fornecedores then 'oportunidade_prazo' else 'oportunidade_aberta' end,
    case when r.aberta_fornecedores then format('Prazo das Oportunidades mudou de %s para %s', to_char(r.aberta_ate, 'DD/MM/YYYY'), to_char(p_ate, 'DD/MM/YYYY'))
         else format('Aberta para os fornecedores cadastrados nas Oportunidades (grupo %s, %s/%s), propostas até %s', r.grupo, u.cidade, u.uf, to_char(p_ate, 'DD/MM/YYYY')) end,
    jsonb_build_object('ate', p_ate));
end $$;

create or replace function public.cmp_fechar_oportunidade(p_req bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes;
begin
  r := public.cmp_req_para(p_req, array['comprador', 'gerente'], array['nova', 'cotacao', 'aprovacao', 'aprovada', 'reprovada']);
  if not r.aberta_fornecedores then return; end if;
  update public.cmp_requisicoes set aberta_fornecedores = false where id = p_req;
  perform public.cmp_registrar(p_req, null, r.unidade_id, 'oportunidade_fechada',
    'Fechada para novos fornecedores das Oportunidades (quem já entrou continua até o prazo do convite)');
end $$;

revoke execute on function public.cmp_abrir_oportunidade(bigint, date), public.cmp_fechar_oportunidade(bigint) from public, anon;
grant execute on function public.cmp_abrir_oportunidade(bigint, date), public.cmp_fechar_oportunidade(bigint) to authenticated;

-- ---------------------------------------------------------------- área de Oportunidades (fornecedor, sem login, pelo código)
create or replace function public.cmp_acesso_do_codigo(p_codigo text)
returns public.cmp_assinaturas language plpgsql security definer set search_path = public as $$
declare a public.cmp_assinaturas;
begin
  if coalesce(p_codigo, '') !~ '^[0-9a-f]{64}$' then raise exception 'Link de acesso inválido. Confira se copiou o endereço inteiro.'; end if;
  select * into a from public.cmp_assinaturas where codigo = p_codigo;
  if not found then raise exception 'Link de acesso inválido. Confira se copiou o endereço inteiro.'; end if;
  return a;
end $$;
revoke execute on function public.cmp_acesso_do_codigo(text) from public, anon, authenticated;

-- a requisição aparece para o fornecedor? (aberta, no prazo, no grupo dele e num estado que ele atende)
create or replace function public.cmp_oportunidade_para(r public.cmp_requisicoes, u public.cmp_unidades, f public.cmp_fornecedores) returns boolean
language sql stable as $$
  select r.aberta_fornecedores and r.status in ('nova', 'cotacao') and r.aberta_ate >= public.cmp_hoje() and u.ativo and u.uf <> ''
     and r.grupo = any (f.grupos) and (cardinality(f.regioes) = 0 or u.uf = any (f.regioes))
$$;
revoke execute on function public.cmp_oportunidade_para(public.cmp_requisicoes, public.cmp_unidades, public.cmp_fornecedores) from public, anon, authenticated;

create or replace function public.cmp_portal_ler(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.cmp_assinaturas; f public.cmp_fornecedores; v_sit text;
begin
  a := public.cmp_acesso_do_codigo(p_codigo);
  select * into f from public.cmp_fornecedores where id = a.fornecedor_id;
  v_sit := case when not f.ativo then 'inativo' else public.cmp_assinatura_situacao(a) end;
  update public.cmp_assinaturas set aberto_em = now() where id = a.id;
  return jsonb_build_object(
    'situacao', v_sit, 'valido_ate', a.valido_ate,
    'fornecedor', jsonb_build_object('nome', f.nome, 'tipo', f.tipo, 'grupos', f.grupos, 'regioes', f.regioes,
      'documento', case when f.tipo = 'PJ' then f.documento else '***' || substr(f.documento, 4, 6) || '**' end),
    'oportunidades', case when v_sit <> 'ativo' then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object(
        'numero', r.id, 'titulo', r.titulo, 'descricao', r.descricao, 'grupo', r.grupo, 'quantidade', r.quantidade,
        'unidade_medida', r.unidade_medida, 'precisa_ate', r.precisa_ate, 'ate', r.aberta_ate, 'cidade', u.cidade, 'uf', u.uf,
        'aberta_em', r.aberta_em,
        'convite', (select case when c.revogado_em is not null then 'encerrado' when c.respondido_em is not null then 'respondido' else 'aberto' end
                      from public.cmp_convites c where c.requisicao_id = r.id and c.fornecedor_id = f.id order by c.revogado_em is null desc, c.id desc limit 1))
        order by r.aberta_ate, r.id), '[]')
       from public.cmp_requisicoes r join public.cmp_unidades u on u.id = r.unidade_id
      where public.cmp_oportunidade_para(r, u, f)) end);
end $$;

-- o fornecedor entra numa oportunidade: ganha um convite (ou recebe o que já tinha) e vai para a página de cotação
create or replace function public.cmp_portal_participar(p_codigo text, p_req bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.cmp_assinaturas; f public.cmp_fornecedores; r public.cmp_requisicoes; u public.cmp_unidades; c public.cmp_convites; v_id bigint; v_cod text;
begin
  a := public.cmp_acesso_do_codigo(p_codigo);
  select * into f from public.cmp_fornecedores where id = a.fornecedor_id;
  if not f.ativo then raise exception 'Seu cadastro está inativo. Fale com a Nervia.'; end if;
  case public.cmp_assinatura_situacao(a)
    when 'cancelado' then raise exception 'Este acesso foi cancelado. Fale com a Nervia.';
    when 'vencido' then raise exception 'Seu acesso às oportunidades venceu em %. Fale com a Nervia para renovar.', to_char(a.valido_ate, 'DD/MM/YYYY');
    else null;
  end case;
  select * into r from public.cmp_requisicoes where id = p_req for update;
  if not found then raise exception 'Oportunidade não encontrada.'; end if;
  select * into u from public.cmp_unidades where id = r.unidade_id;
  -- convite já existente (do comprador ou de uma participação anterior)
  select * into c from public.cmp_convites where requisicao_id = r.id and fornecedor_id = f.id order by revogado_em is null desc, id desc limit 1;
  if found and c.revogado_em is null then return jsonb_build_object('codigo', c.codigo, 'novo', false); end if;
  if found then raise exception 'O comprador encerrou a sua participação nesta cotação.'; end if;
  if not public.cmp_oportunidade_para(r, u, f) then raise exception 'Esta oportunidade não está mais aberta.'; end if;
  insert into public.cmp_convites (requisicao_id, fornecedor_id, contato_nome, telefone, email, prazo, criado_por, criado_nome, origem, aberto_em)
  values (r.id, f.id, f.contato, f.telefone, f.email, r.aberta_ate, null, 'Oportunidades (o fornecedor entrou sozinho)', 'portal', null)
  returning id, codigo into v_id, v_cod;
  perform public.cmp_registrar_fornecedor(r.id, f.id, r.unidade_id, 'oportunidade_participacao',
    format('%s entrou pela área de Oportunidades (fornecedor com acesso; prazo até %s)', f.nome, to_char(r.aberta_ate, 'DD/MM/YYYY')),
    f.nome || ' (Oportunidades)', jsonb_build_object('convite', v_id, 'acesso', a.id));
  return jsonb_build_object('codigo', v_cod, 'novo', true);
end $$;

revoke execute on function public.cmp_portal_ler(text), public.cmp_portal_participar(text, bigint) from public;
grant execute on function public.cmp_portal_ler(text), public.cmp_portal_participar(text, bigint) to anon, authenticated;

-- ---------------------------------------------------------------- página de cotação: quem veio pelas Oportunidades não vê o nome da empresa
create or replace function public.cmp_cotacao_ler(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cmp_convites; r public.cmp_requisicoes; f public.cmp_fornecedores; p public.cmp_propostas; u public.cmp_unidades; v_quem text;
begin
  c := public.cmp_convite_do_codigo(p_codigo, true);
  select * into r from public.cmp_requisicoes where id = c.requisicao_id;
  select * into u from public.cmp_unidades where id = r.unidade_id;
  if c.fornecedor_id is not null then
    select * into f from public.cmp_fornecedores where id = c.fornecedor_id;
    select * into p from public.cmp_propostas where requisicao_id = r.id and fornecedor_id = c.fornecedor_id;
  end if;
  if c.aberto_em is null then
    update public.cmp_convites set aberto_em = now() where id = c.id;
    v_quem := coalesce(f.nome, nullif(c.contato_nome, ''), 'Fornecedor') || case when c.origem = 'portal' then ' (Oportunidades)' else ' (pelo link)' end;
    perform public.cmp_registrar_fornecedor(r.id, c.fornecedor_id, r.unidade_id, 'convite_aberto', 'Fornecedor abriu o link do convite', v_quem,
      jsonb_build_object('convite', c.id));
  end if;
  return jsonb_build_object(
    'situacao', public.cmp_convite_situacao(c, r),
    'prazo', c.prazo,
    'unidade', case when c.origem = 'portal' then 'Empresa compradora em ' || coalesce(nullif(u.cidade, '') || '/', '') || u.uf else u.nome end,
    'origem', c.origem,
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
revoke execute on function public.cmp_cotacao_ler(text) from public;
grant execute on function public.cmp_cotacao_ler(text) to anon, authenticated;
