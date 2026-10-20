-- Orçamentos de Compras — melhorias pedidas pelo Marco em 20/10/2026:
--   1. Dispensa de certidões: certidões vencidas continuam travando a proposta, mas o GERENTE da unidade pode dispensar
--      as certidões de um fornecedor NAQUELA compra (algumas compras não precisam), com motivo. Fica registrado
--      (cmp_dispensas, somente inclusão + histórico + auditoria) e aparece no mapa para quem aprova.
--   2. Base de fornecedores ÚNICA DO SISTEMA (todas as empresas que usam o app, não só as unidades de uma empresa).
--      Outra empresa usa o cadastro e vê a nota, mas NÃO vê quem cadastrou (nome, unidade, observações) nem os avais
--      dados por outra empresa. As avaliações aparecem ANÔNIMAS para todos (sem avaliador e sem unidade); a equipe
--      Nervia vê tudo. "Empresa" = cmp_unidades.empresa: unidades com o mesmo nome de empresa são da mesma empresa;
--      vazio = a unidade é uma empresa sozinha. A "primeira compra com o fornecedor" passa a contar por empresa.
--   3. Compra pela internet (Mercado Livre, Amazon etc.): proposta sem fornecedor da base (origem 'internet'), com o
--      site, o link do produto e, se quiser, o vendedor. Conta como proposta no mapa. Escolhida, NUNCA é aprovação
--      automática: vai sempre ao Gerente (o "aval" da compra pela internet), e acima da alçada do Gerente ao Diretor.

-- ---------------------------------------------------------------- empresa da unidade
alter table public.cmp_unidades add column if not exists empresa text not null default '';

-- o login é da mesma empresa da unidade? (equipe Nervia = sim)
create or replace function public.cmp_mesma_empresa(p_unidade uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or (p_unidade is not null and exists (
    select 1 from public.cmp_membros m join public.cmp_unidades u on u.id = m.unidade_id
     where m.user_id = auth.uid()
       and (u.id = p_unidade or (u.empresa <> '' and u.empresa = (select x.empresa from public.cmp_unidades x where x.id = p_unidade)))))
$$;
revoke execute on function public.cmp_mesma_empresa(uuid) from public, anon;

-- unidades da mesma empresa de uma unidade (inclui ela mesma)
create or replace function public.cmp_unidades_da_empresa(p_unidade uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select u.id from public.cmp_unidades u, public.cmp_unidades x
   where x.id = p_unidade and (u.id = x.id or (x.empresa <> '' and u.empresa = x.empresa))
$$;
revoke execute on function public.cmp_unidades_da_empresa(uuid) from public, anon, authenticated;

create or replace function public.cmp_auditar_unidades() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.minimo_propostas, new.alcada_automatica, new.alcada_gerente, new.pesos, new.ativo, new.nome, new.empresa)
     is not distinct from (old.minimo_propostas, old.alcada_automatica, old.alcada_gerente, old.pesos, old.ativo, old.nome, old.empresa) then
    return new;
  end if;
  perform public.cmp_registrar(null, null, new.id, case when tg_op = 'INSERT' then 'unidade_criada' else 'regras_alteradas' end,
    format('%s%s: mínimo %s propostas, automática até %s, Gerente até %s', new.nome, case when new.empresa <> '' then ' (empresa ' || new.empresa || ')' else '' end,
      new.minimo_propostas, public.cmp_brl(new.alcada_automatica), public.cmp_brl(new.alcada_gerente)),
    jsonb_build_object('pesos', new.pesos, 'ativo', new.ativo, 'empresa', new.empresa));
  return new;
end $$;

-- avais: cada empresa vê só os avais das próprias unidades
drop policy if exists cmp_avais_ler on public.cmp_avais;
create policy cmp_avais_ler on public.cmp_avais for select using (public.cmp_mesma_empresa(unidade_id));
-- avaliações (com avaliador e unidade): só a própria unidade lê a linha; os outros veem a nota e a lista anônima
drop policy if exists cmp_aval_ler on public.cmp_avaliacoes;
create policy cmp_aval_ler on public.cmp_avaliacoes for select using (public.cmp_membro(unidade_id));

-- ---------------------------------------------------------------- compra pela internet: colunas
alter table public.cmp_propostas alter column fornecedor_id drop not null;
alter table public.cmp_propostas add column if not exists site text;        -- Mercado Livre, Amazon...
alter table public.cmp_propostas add column if not exists link text;        -- endereço do produto
alter table public.cmp_propostas add column if not exists vendedor text;    -- loja/vendedor dentro do site (opcional)
alter table public.cmp_propostas drop constraint if exists cmp_propostas_origem;
alter table public.cmp_propostas add constraint cmp_propostas_origem check (origem in ('comprador', 'fornecedor', 'internet'));
alter table public.cmp_propostas drop constraint if exists cmp_propostas_internet;
alter table public.cmp_propostas add constraint cmp_propostas_internet check (
  case when origem = 'internet'
       then fornecedor_id is null and length(trim(coalesce(site, ''))) >= 2 and coalesce(link, '') ~ '^https?://[^[:space:]]+$' and length(link) <= 1000
       else fornecedor_id is not null end);
alter table public.cmp_requisicoes add column if not exists compra_internet boolean;
alter table public.cmp_avaliacoes alter column fornecedor_id drop not null;   -- compra pela internet também é avaliada (sem fornecedor)

-- nome de quem fez a proposta (fornecedor da base ou "Internet — site (vendedor)")
create or replace function public.cmp_nome_proposta(p public.cmp_propostas) returns text
language sql stable security definer set search_path = public as $$
  select case when p.fornecedor_id is not null then (select nome from public.cmp_fornecedores where id = p.fornecedor_id)
              else 'Internet — ' || p.site || coalesce(' (' || nullif(trim(p.vendedor), '') || ')', '') end
$$;
revoke execute on function public.cmp_nome_proposta(public.cmp_propostas) from public, anon, authenticated;

-- ---------------------------------------------------------------- dispensa de certidões (por compra)
create table if not exists public.cmp_dispensas (
  id                 bigint generated always as identity primary key,
  requisicao_id      bigint not null references public.cmp_requisicoes on delete cascade,
  fornecedor_id      uuid not null references public.cmp_fornecedores on delete cascade,
  motivo             text not null,
  certidoes_validade date,                 -- a validade (vencida) no momento da dispensa
  por                uuid references auth.users on delete set null,
  por_nome           text not null default '',
  em                 timestamptz not null default now(),
  unique (requisicao_id, fornecedor_id)
);
drop trigger if exists cmp_dispensas_imutavel on public.cmp_dispensas;
create trigger cmp_dispensas_imutavel before update or delete on public.cmp_dispensas for each row execute function public.auditoria_imutavel();
drop trigger if exists cmp_dispensas_sem_truncate on public.cmp_dispensas;
create trigger cmp_dispensas_sem_truncate before truncate on public.cmp_dispensas for each statement execute function public.auditoria_imutavel();
alter table public.cmp_dispensas enable row level security;
revoke all on public.cmp_dispensas from anon;
revoke insert, update, delete on public.cmp_dispensas from authenticated;
drop policy if exists cmp_dispensas_ler on public.cmp_dispensas;
create policy cmp_dispensas_ler on public.cmp_dispensas for select
  using (exists (select 1 from public.cmp_requisicoes r where r.id = requisicao_id and public.cmp_membro(r.unidade_id)));

-- certidões aceitas nesta compra? (em dia, sem data informada, ou dispensadas pelo Gerente nesta requisição)
create or replace function public.cmp_certidoes_ok(p_req bigint, p_forn uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select f.certidoes_validade is null or f.certidoes_validade >= current_date from public.cmp_fornecedores f where f.id = p_forn), true)
      or exists (select 1 from public.cmp_dispensas d where d.requisicao_id = p_req and d.fornecedor_id = p_forn)
$$;
revoke execute on function public.cmp_certidoes_ok(bigint, uuid) from public, anon, authenticated;

create or replace function public.cmp_dispensar_certidoes(p_req bigint, p_fornecedor uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; f public.cmp_fornecedores;
begin
  r := public.cmp_req_para(p_req, array['gerente'], array['nova', 'cotacao']);
  select * into f from public.cmp_fornecedores where id = p_fornecedor;
  if not found then raise exception 'Fornecedor não encontrado.'; end if;
  if f.certidoes_validade is null or f.certidoes_validade >= current_date then
    raise exception 'As certidões de % estão em dia: não precisa de dispensa.', f.nome;
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 10 then raise exception 'Escreva o motivo da dispensa (mínimo 10 caracteres).'; end if;
  insert into public.cmp_dispensas (requisicao_id, fornecedor_id, motivo, certidoes_validade, por, por_nome)
  values (p_req, f.id, trim(p_motivo), f.certidoes_validade, auth.uid(), coalesce(public.cmp_nome_atual(), ''))
  on conflict (requisicao_id, fornecedor_id) do nothing;
  if not found then raise exception 'As certidões de % já foram dispensadas nesta requisição.', f.nome; end if;
  perform public.cmp_registrar(p_req, f.id, r.unidade_id, 'certidoes_dispensadas',
    format('Gerente dispensou as certidões de %s nesta compra (vencidas em %s): %s', f.nome, to_char(f.certidoes_validade, 'DD/MM/YYYY'), trim(p_motivo)),
    jsonb_build_object('certidoes_validade', f.certidoes_validade, 'motivo', trim(p_motivo)));
end $$;

-- ---------------------------------------------------------------- fornecedores: base única do sistema
drop function if exists public.cmp_fornecedores_lista();
create or replace function public.cmp_fornecedores_lista()
returns table (id uuid, tipo text, documento text, nome text, grupos text[], contato text, email text, telefone text,
  certidoes_validade date, obs text, cadastrado_por uuid, cadastrado_nome text, cadastrado_unidade uuid, cadastrado_em timestamptz,
  ativo boolean, nota numeric, avaliacoes int, unidades_avaliacao text[], avais jsonb, compras int,
  mesma_empresa boolean, compras_empresa int)
language sql stable security definer set search_path = public as $$
  select f.id, f.tipo,
    case when f.tipo = 'PJ' or public.eh_admin() or f.cadastrado_por = auth.uid() then f.documento
         else '***' || substr(f.documento, 4, 6) || '**' end,
    f.nome, f.grupos, f.contato, f.email, f.telefone, f.certidoes_validade,
    case when me then f.obs else '' end,
    case when me then f.cadastrado_por end, case when me then f.cadastrado_nome else '' end,
    case when me then f.cadastrado_unidade end, f.cadastrado_em, f.ativo,
    (select round(avg((a.prazo + a.qualidade + a.conformidade + a.atendimento) / 4.0), 2) from public.cmp_avaliacoes a where a.fornecedor_id = f.id),
    (select count(*)::int from public.cmp_avaliacoes a where a.fornecedor_id = f.id),
    -- avaliações anônimas: quem e onde avaliou só para a equipe Nervia
    case when public.eh_admin() then (select coalesce(array_agg(distinct u.nome), '{}') from public.cmp_avaliacoes a join public.cmp_unidades u on u.id = a.unidade_id where a.fornecedor_id = f.id)
         else '{}'::text[] end,
    (select coalesce(jsonb_agg(jsonb_build_object('unidade_id', v.unidade_id, 'unidade', u.nome, 'por', v.dado_por_nome, 'em', v.dado_em)), '[]')
       from public.cmp_avais v join public.cmp_unidades u on u.id = v.unidade_id where v.fornecedor_id = f.id and public.cmp_mesma_empresa(v.unidade_id)),
    (select count(*)::int from public.cmp_requisicoes r join public.cmp_propostas p on p.id = r.proposta_escolhida
      where p.fornecedor_id = f.id and r.status in ('aprovada', 'pedido', 'entregue', 'concluida')),
    me,
    (select count(*)::int from public.cmp_requisicoes r join public.cmp_propostas p on p.id = r.proposta_escolhida
      where p.fornecedor_id = f.id and r.status in ('aprovada', 'pedido', 'entregue', 'concluida') and public.cmp_mesma_empresa(r.unidade_id))
  from public.cmp_fornecedores f, lateral (select public.cmp_mesma_empresa(f.cadastrado_unidade) as me) x
  where public.cmp_membro_algum()
  order by f.nome
$$;
revoke execute on function public.cmp_fornecedores_lista() from public, anon;
grant execute on function public.cmp_fornecedores_lista() to authenticated;

-- avaliações de um fornecedor, ANÔNIMAS (sem avaliador, sem unidade, só o mês)
create or replace function public.cmp_avaliacoes_fornecedor(p_fornecedor uuid)
returns table (mes text, prazo smallint, qualidade smallint, conformidade smallint, atendimento smallint, media numeric, comentario text)
language sql stable security definer set search_path = public as $$
  select to_char(a.em at time zone 'America/Sao_Paulo', 'YYYY-MM'), a.prazo, a.qualidade, a.conformidade, a.atendimento,
         round((a.prazo + a.qualidade + a.conformidade + a.atendimento) / 4.0, 2), a.comentario
    from public.cmp_avaliacoes a
   where a.fornecedor_id = p_fornecedor and public.cmp_membro_algum()
   order by a.em desc
$$;
revoke execute on function public.cmp_avaliacoes_fornecedor(uuid) from public, anon;
grant execute on function public.cmp_avaliacoes_fornecedor(uuid) to authenticated;

-- cadastro: CNPJ/CPF repetido não diz quem cadastrou se for de outra empresa
create or replace function public.cmp_salvar_fornecedor(p_id uuid, p_tipo text, p_documento text, p_nome text, p_grupos text[],
  p_contato text, p_email text, p_telefone text, p_certidoes date, p_obs text, p_unidade uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_doc text := upper(regexp_replace(coalesce(p_documento, ''), '[^0-9A-Za-z]', '', 'g')); v_ex record; v_id uuid; v_f record;
begin
  if p_id is null then
    if not public.cmp_tem_papel(p_unidade, array['comprador', 'gerente', 'diretor']) then
      raise exception 'Só comprador, gerente ou diretor da unidade cadastra fornecedor.';
    end if;
    if p_tipo not in ('PJ', 'PF') then raise exception 'Tipo inválido.'; end if;
    if not public.cmp_doc_valido(p_tipo, v_doc) then
      raise exception '% inválido (dígito verificador não confere). Confira o número.', case when p_tipo = 'PF' then 'CPF' else 'CNPJ' end;
    end if;
    select f.nome, f.cadastrado_nome, f.cadastrado_em, f.cadastrado_unidade into v_ex from public.cmp_fornecedores f where f.documento = v_doc;
    if found then
      if public.cmp_mesma_empresa(v_ex.cadastrado_unidade) then
        raise exception 'Este % já está cadastrado: % (por % em %). Use o cadastro existente.',
          case when p_tipo = 'PF' then 'CPF' else 'CNPJ' end, v_ex.nome, v_ex.cadastrado_nome, to_char(v_ex.cadastrado_em, 'DD/MM/YYYY');
      end if;
      raise exception 'Este % já está na base de fornecedores: %. Use o cadastro existente.', case when p_tipo = 'PF' then 'CPF' else 'CNPJ' end, v_ex.nome;
    end if;
    insert into public.cmp_fornecedores (tipo, documento, nome, grupos, contato, email, telefone, certidoes_validade, obs,
      cadastrado_por, cadastrado_nome, cadastrado_unidade)
    values (p_tipo, v_doc, trim(p_nome), coalesce(p_grupos, '{}'), coalesce(p_contato, ''), coalesce(p_email, ''), coalesce(p_telefone, ''),
      p_certidoes, coalesce(p_obs, ''), auth.uid(), coalesce(public.cmp_nome_atual(), ''), p_unidade)
    returning id into v_id;
    perform public.cmp_registrar(null, v_id, p_unidade, 'fornecedor_cadastrado',
      format('Fornecedor cadastrado: %s (%s). Responsável pela homologação: %s', trim(p_nome), p_tipo, public.cmp_nome_atual()),
      jsonb_build_object('tipo', p_tipo, 'grupos', p_grupos, 'certidoes_validade', p_certidoes));
    return v_id;
  end if;
  select * into v_f from public.cmp_fornecedores where id = p_id;
  if not found then raise exception 'Fornecedor não encontrado.'; end if;
  if not (public.eh_admin() or v_f.cadastrado_por = auth.uid()) then
    raise exception 'Só quem cadastrou o fornecedor (responsável pela homologação) ou a equipe Nervia altera o cadastro.';
  end if;
  update public.cmp_fornecedores set nome = trim(p_nome), grupos = coalesce(p_grupos, '{}'), contato = coalesce(p_contato, ''),
    email = coalesce(p_email, ''), telefone = coalesce(p_telefone, ''), certidoes_validade = p_certidoes, obs = coalesce(p_obs, '')
   where id = p_id;
  perform public.cmp_registrar(null, p_id, coalesce(p_unidade, v_f.cadastrado_unidade), 'fornecedor_alterado',
    format('Cadastro alterado: %s', trim(p_nome)),
    jsonb_build_object('certidoes_validade', p_certidoes, 'certidoes_anterior', v_f.certidoes_validade, 'grupos', p_grupos));
  return p_id;
end $$;

-- ---------------------------------------------------------------- propostas
-- proposta de fornecedor da base (comprador): certidões vencidas só com dispensa do Gerente nesta compra
create or replace function public.cmp_salvar_proposta(p_req bigint, p_fornecedor uuid, p_preco numeric, p_frete numeric, p_extras numeric,
  p_prazo int, p_pagamento text, p_pagamento_dias int, p_validade date, p_obs text)
returns bigint language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; f record; v_ant record; v_id bigint; v_total numeric;
begin
  r := public.cmp_req_para(p_req, array['comprador'], array['nova', 'cotacao']);
  select * into f from public.cmp_fornecedores where id = p_fornecedor;
  if not found or not f.ativo then raise exception 'Fornecedor não encontrado ou inativo.'; end if;
  if not public.cmp_certidoes_ok(p_req, f.id) then
    raise exception 'As certidões de % venceram em %. Atualize o cadastro ou peça ao Gerente a dispensa das certidões nesta compra.', f.nome, to_char(f.certidoes_validade, 'DD/MM/YYYY');
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
  update public.cmp_requisicoes set status = 'cotacao',
    proposta_escolhida = null, justificativa = case when proposta_escolhida is null then justificativa else '' end
   where id = p_req;
  if r.proposta_escolhida is not null then
    perform public.cmp_registrar(p_req, null, r.unidade_id, 'escolha_desfeita', 'Escolha desfeita porque as propostas mudaram.');
  end if;
  return v_id;
end $$;

-- proposta de compra pela internet (sem fornecedor da base): p_proposta nulo = nova; preenchido = editar / re-cotar
create or replace function public.cmp_salvar_proposta_internet(p_req bigint, p_proposta bigint, p_site text, p_link text, p_vendedor text,
  p_preco numeric, p_frete numeric, p_extras numeric, p_prazo int, p_pagamento text, p_pagamento_dias int, p_validade date, p_obs text)
returns bigint language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; v_ant public.cmp_propostas; v_id bigint; v_total numeric;
  v_site text := left(trim(coalesce(p_site, '')), 80); v_link text := trim(coalesce(p_link, '')); v_vend text := left(trim(coalesce(p_vendedor, '')), 120); v_nome text;
begin
  r := public.cmp_req_para(p_req, array['comprador'], array['nova', 'cotacao']);
  if length(v_site) < 2 then raise exception 'Informe o site da compra (ex.: Mercado Livre, Amazon).'; end if;
  if v_link !~ '^https?://[^[:space:]]+$' or length(v_link) > 1000 then
    raise exception 'Cole o link do produto (endereço completo, começando com https://).';
  end if;
  if p_preco is null or p_preco < 0 or p_prazo is null or p_prazo < 0 then raise exception 'Preço e prazo são obrigatórios.'; end if;
  v_total := round(p_preco * r.quantidade + coalesce(p_frete, 0), 2);
  v_nome := 'Internet — ' || v_site || coalesce(' (' || nullif(v_vend, '') || ')', '');
  if p_proposta is not null then
    select * into v_ant from public.cmp_propostas where id = p_proposta and requisicao_id = p_req and origem = 'internet';
    if not found then raise exception 'Proposta de internet não encontrada nesta requisição.'; end if;
    update public.cmp_propostas set site = v_site, link = v_link, vendedor = nullif(v_vend, ''), preco_unitario = p_preco, frete = coalesce(p_frete, 0),
      custos_extras = coalesce(p_extras, 0), prazo_dias = p_prazo, pagamento = coalesce(p_pagamento, 'À vista'), pagamento_dias = coalesce(p_pagamento_dias, 0),
      validade = p_validade, obs = coalesce(p_obs, ''), atualizada_em = now(),
      rodada = case when p_preco <> v_ant.preco_unitario then v_ant.rodada + 1 else v_ant.rodada end,
      preco_anterior = case when p_preco <> v_ant.preco_unitario then v_ant.preco_unitario else v_ant.preco_anterior end
     where id = p_proposta returning id into v_id;
    perform public.cmp_registrar(p_req, null, r.unidade_id, 'proposta_alterada',
      format('Proposta %s alterada: %s → %s', v_nome, public.cmp_brl(round(v_ant.preco_unitario * r.quantidade + v_ant.frete, 2)), public.cmp_brl(v_total)),
      jsonb_build_object('origem', 'internet', 'site', v_site, 'link', v_link, 'preco_unitario', p_preco, 'preco_anterior', v_ant.preco_unitario));
  else
    insert into public.cmp_propostas (requisicao_id, fornecedor_id, origem, site, link, vendedor, preco_unitario, frete, custos_extras, prazo_dias,
      pagamento, pagamento_dias, validade, obs, registrada_por)
    values (p_req, null, 'internet', v_site, v_link, nullif(v_vend, ''), p_preco, coalesce(p_frete, 0), coalesce(p_extras, 0), p_prazo,
      coalesce(p_pagamento, 'À vista'), coalesce(p_pagamento_dias, 0), p_validade, coalesce(p_obs, ''), auth.uid())
    returning id into v_id;
    perform public.cmp_registrar(p_req, null, r.unidade_id, 'proposta_registrada',
      format('Proposta %s registrada: total %s, prazo %s dias, %s. Link: %s', v_nome, public.cmp_brl(v_total), p_prazo, coalesce(p_pagamento, 'À vista'), v_link),
      jsonb_build_object('origem', 'internet', 'site', v_site, 'link', v_link, 'vendedor', v_vend, 'preco_unitario', p_preco, 'frete', p_frete, 'prazo_dias', p_prazo));
  end if;
  update public.cmp_requisicoes set status = 'cotacao',
    proposta_escolhida = null, justificativa = case when proposta_escolhida is null then justificativa else '' end
   where id = p_req;
  if r.proposta_escolhida is not null then
    perform public.cmp_registrar(p_req, null, r.unidade_id, 'escolha_desfeita', 'Escolha desfeita porque as propostas mudaram.');
  end if;
  return v_id;
end $$;

create or replace function public.cmp_excluir_proposta(p_proposta bigint, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare p public.cmp_propostas; r public.cmp_requisicoes; v_nome text;
begin
  select * into p from public.cmp_propostas where id = p_proposta;
  if not found then raise exception 'Proposta não encontrada.'; end if;
  r := public.cmp_req_para(p.requisicao_id, array['comprador'], array['nova', 'cotacao']);
  if p.origem = 'fornecedor' and length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'A proposta foi enviada pelo próprio fornecedor: escreva o motivo da exclusão.';
  end if;
  v_nome := public.cmp_nome_proposta(p);
  update public.cmp_requisicoes set proposta_escolhida = null, justificativa = '' where id = r.id and proposta_escolhida = p_proposta;
  delete from public.cmp_propostas where id = p_proposta;
  perform public.cmp_registrar(r.id, p.fornecedor_id, r.unidade_id, 'proposta_excluida',
    'Proposta de ' || v_nome || ' excluída' || case when coalesce(trim(p_motivo), '') <> '' then ': ' || trim(p_motivo) else '.' end,
    jsonb_build_object('origem', p.origem, 'preco_unitario', p.preco_unitario, 'anexo', p.anexo, 'link', p.link));
end $$;

create or replace function public.cmp_escolher(p_req bigint, p_proposta bigint, p_justificativa text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; p public.cmp_propostas; v_total numeric; v_min numeric; v_nome text;
begin
  r := public.cmp_req_para(p_req, array['comprador'], array['cotacao']);
  select * into p from public.cmp_propostas where id = p_proposta and requisicao_id = p_req;
  if not found then raise exception 'Proposta não pertence a esta requisição.'; end if;
  v_total := round(p.preco_unitario * r.quantidade + p.frete, 2); v_nome := public.cmp_nome_proposta(p);
  select min(round(preco_unitario * r.quantidade + frete, 2)) into v_min from public.cmp_propostas where requisicao_id = p_req;
  if v_total > v_min and length(trim(coalesce(p_justificativa, ''))) < 10 then
    raise exception 'Escolhido não é o menor preço: escreva a justificativa (mínimo 10 caracteres).';
  end if;
  update public.cmp_requisicoes set proposta_escolhida = p_proposta,
    justificativa = case when v_total > v_min then trim(p_justificativa) else '' end where id = p_req;
  perform public.cmp_registrar(p_req, null, r.unidade_id, 'fornecedor_escolhido',
    format('Escolheu %s (%s)%s', v_nome, case when v_total > v_min then 'não é o menor preço' else 'menor preço' end,
      case when v_total > v_min then ' — justificativa: ' || trim(p_justificativa) else '' end),
    jsonb_build_object('proposta', p_proposta, 'total', v_total, 'menor_total', v_min));
end $$;

-- ---------------------------------------------------------------- aprovação
create or replace function public.cmp_enviar_aprovacao(p_req bigint)
returns text language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; u public.cmp_unidades; p public.cmp_propostas; f public.cmp_fornecedores; v_qtd int; v_min numeric;
  v_total numeric; v_menor boolean; v_novo boolean := false; v_comp boolean := false; v_alcada text; v_inter boolean; v_disp boolean := false; v_nome text;
begin
  r := public.cmp_req_para(p_req, array['comprador'], array['cotacao']);
  select * into u from public.cmp_unidades where id = r.unidade_id;
  if r.proposta_escolhida is null then raise exception 'Escolha o fornecedor antes de enviar.'; end if;
  select count(*), min(round(preco_unitario * r.quantidade + frete, 2)) into v_qtd, v_min from public.cmp_propostas where requisicao_id = p_req;
  if v_qtd < u.minimo_propostas and r.excecao = '' then
    raise exception 'Só % proposta(s): o mínimo é %. Registre mais propostas ou a exceção de exclusividade.', v_qtd, u.minimo_propostas;
  end if;
  select * into p from public.cmp_propostas where id = r.proposta_escolhida;
  v_inter := p.fornecedor_id is null; v_nome := public.cmp_nome_proposta(p);
  v_total := round(p.preco_unitario * r.quantidade + p.frete, 2);
  v_menor := v_total <= v_min;
  if v_inter then
    -- compra pela internet: nunca automática; o Gerente dá o aval (e o Diretor, acima da alçada do Gerente)
    v_alcada := case when v_total <= u.alcada_gerente then 'gerente' else 'diretor' end;
  else
    select * into f from public.cmp_fornecedores where id = p.fornecedor_id;
    if not public.cmp_certidoes_ok(p_req, f.id) then
      raise exception 'As certidões de % estão vencidas. Atualize o cadastro ou peça ao Gerente a dispensa das certidões nesta compra.', f.nome;
    end if;
    v_disp := f.certidoes_validade is not null and f.certidoes_validade < current_date;
    -- primeira compra com o fornecedor NESTA EMPRESA (a base é de todas as empresas)
    v_novo := not exists (select 1 from public.cmp_requisicoes x join public.cmp_propostas y on y.id = x.proposta_escolhida
      where y.fornecedor_id = f.id and x.id <> p_req and x.status in ('aprovada', 'pedido', 'entregue', 'concluida')
        and x.unidade_id in (select public.cmp_unidades_da_empresa(r.unidade_id)));
    v_comp := f.cadastrado_por = auth.uid();
    v_alcada := case when v_total <= u.alcada_automatica and v_menor and not v_novo then 'automatica'
                     when v_total <= u.alcada_gerente then 'gerente' else 'diretor' end;
  end if;
  update public.cmp_requisicoes set alcada = v_alcada, valor_aprovacao = v_total, fornecedor_novo = v_novo, compra_internet = v_inter,
    cadastrado_pelo_comprador = v_comp, enviado_por = auth.uid(), enviado_em = now(),
    status = case when v_alcada = 'automatica' then 'aprovada' else 'aprovacao' end
   where id = p_req;
  perform public.cmp_registrar(p_req, p.fornecedor_id, r.unidade_id, 'enviada_aprovacao',
    format('Enviada para aprovação: %s, %s. Alçada: %s%s%s%s%s', v_nome, public.cmp_brl(v_total),
      case v_alcada when 'automatica' then 'automática' when 'gerente' then 'Gerente' else 'Gerente e Diretor' end,
      case when v_inter then '. Compra pela internet: precisa do aval do Gerente' else '' end,
      case when v_novo then '. Primeira compra com este fornecedor' else '' end,
      case when v_comp then '. Fornecedor cadastrado por quem está comprando' else '' end,
      case when v_disp then '. Certidões vencidas, dispensadas pelo Gerente nesta compra' else '' end),
    jsonb_build_object('total', v_total, 'menor', v_menor, 'fornecedor_novo', v_novo, 'cadastrado_pelo_comprador', v_comp, 'alcada', v_alcada,
      'propostas', v_qtd, 'excecao', r.excecao, 'compra_internet', v_inter, 'link', p.link, 'certidoes_dispensadas', v_disp));
  if v_alcada = 'automatica' then
    insert into public.cmp_aprovacoes (requisicao_id, etapa, decisao, comentario, por_nome)
    values (p_req, 'sistema', 'aprovado', format('Até %s, menor preço e fornecedor com compras anteriores.', public.cmp_brl(u.alcada_automatica)), 'Sistema');
    perform public.cmp_registrar(p_req, null, r.unidade_id, 'aprovacao_automatica', 'Aprovação automática (até a alçada, menor preço).');
  end if;
  return v_alcada;
end $$;

create or replace function public.cmp_decidir(p_req bigint, p_aprovar boolean, p_comentario text, p_dar_aval boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; v_ger boolean; v_etapa text; v_forn uuid; v_novo text;
begin
  select * into r from public.cmp_requisicoes where id = p_req for update;
  if not found or not public.cmp_membro(r.unidade_id) then raise exception 'Requisição não encontrada.'; end if;
  if r.status <> 'aprovacao' then raise exception 'A requisição #% não está aguardando aprovação.', p_req; end if;
  v_ger := exists (select 1 from public.cmp_aprovacoes where requisicao_id = p_req and etapa = 'gerente' and decisao = 'aprovado');
  v_etapa := case when not v_ger then 'gerente' else 'diretor' end;
  if not public.cmp_tem_papel(r.unidade_id, array[v_etapa]) then
    raise exception 'Esta etapa é do %.', case v_etapa when 'gerente' then 'Gerente' else 'Diretor' end;
  end if;
  if r.enviado_por = auth.uid() and not public.eh_admin() then
    raise exception 'Quem enviou a compra para aprovação não pode aprová-la.';
  end if;
  if not p_aprovar and length(trim(coalesce(p_comentario, ''))) < 5 then raise exception 'Para reprovar, escreva o motivo.'; end if;
  insert into public.cmp_aprovacoes (requisicao_id, etapa, decisao, comentario, por, por_nome)
  values (p_req, v_etapa, case when p_aprovar then 'aprovado' else 'reprovado' end, trim(coalesce(p_comentario, '')), auth.uid(), coalesce(public.cmp_nome_atual(), ''));
  select fornecedor_id into v_forn from public.cmp_propostas where id = r.proposta_escolhida;
  if not p_aprovar then
    update public.cmp_requisicoes set status = 'reprovada' where id = p_req;
    perform public.cmp_registrar(p_req, v_forn, r.unidade_id, 'reprovada', format('Reprovada pelo %s: %s', initcap(v_etapa), trim(p_comentario)));
    return 'reprovada';
  end if;
  if p_dar_aval and v_etapa = 'gerente' and v_forn is not null then perform public.cmp_aval(v_forn, r.unidade_id, true); end if;
  v_novo := case when v_etapa = 'gerente' and r.alcada = 'diretor' then 'aprovacao' else 'aprovada' end;
  update public.cmp_requisicoes set status = v_novo where id = p_req;
  perform public.cmp_registrar(p_req, v_forn, r.unidade_id, 'aprovada_' || v_etapa,
    format('Aprovada pelo %s%s%s%s', initcap(v_etapa),
      case when v_etapa = 'gerente' and coalesce(r.compra_internet, false) then ' (aval à compra pela internet)' else '' end,
      case when coalesce(trim(p_comentario), '') <> '' then ': ' || trim(p_comentario) else '' end,
      case when v_novo = 'aprovacao' then '. Segue para o Diretor.' else '' end));
  return v_novo;
end $$;

create or replace function public.cmp_avaliar(p_req bigint, p_prazo int, p_qualidade int, p_conformidade int, p_atendimento int, p_comentario text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; p public.cmp_propostas; v_nome text;
begin
  r := public.cmp_req_para(p_req, array['gerente'], array['entregue']);
  select * into p from public.cmp_propostas where id = r.proposta_escolhida;
  v_nome := public.cmp_nome_proposta(p);
  insert into public.cmp_avaliacoes (requisicao_id, fornecedor_id, unidade_id, prazo, qualidade, conformidade, atendimento, comentario, avaliador, avaliador_nome)
  values (p_req, p.fornecedor_id, r.unidade_id, p_prazo, p_qualidade, p_conformidade, p_atendimento, trim(coalesce(p_comentario, '')), auth.uid(), coalesce(public.cmp_nome_atual(), ''));
  update public.cmp_requisicoes set status = 'concluida' where id = p_req;
  perform public.cmp_registrar(p_req, p.fornecedor_id, r.unidade_id, 'fornecedor_avaliado',
    format('%s avaliado: prazo %s, qualidade %s, conforme a proposta %s, atendimento %s%s', v_nome, p_prazo, p_qualidade, p_conformidade, p_atendimento,
      case when coalesce(trim(p_comentario), '') <> '' then ' — ' || trim(p_comentario) else '' end));
end $$;

revoke execute on function public.cmp_dispensar_certidoes(bigint, uuid, text),
  public.cmp_salvar_proposta_internet(bigint, bigint, text, text, text, numeric, numeric, numeric, int, text, int, date, text) from public, anon;
grant execute on function public.cmp_dispensar_certidoes(bigint, uuid, text),
  public.cmp_salvar_proposta_internet(bigint, bigint, text, text, text, numeric, numeric, numeric, int, text, int, date, text) to authenticated;
