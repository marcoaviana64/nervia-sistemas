-- Contratos 2.1 (pedido do Marco em 18/11/2026): quem assina o contrato, pelo NOME.
-- A frase final do modelo ("assinam digitalmente via DocuSign … e-mail …") prendia o contrato à assinatura eletrônica;
-- agora o modelo diz quem assina por cada parte (campos CTTASSINANTE e CTRAASSINANTE) e aceita assinatura à mão ou eletrônica.
--   ctr_contratos.assinante_cliente   = representante do cliente que assina (nome e CPF) -> CTTASSINANTE
--   ctr_empresas.contratada_assinante = representante da contratada que assina (nome e CPF) -> CTRAASSINANTE
-- Colunas novas vazias (nada muda nos contratos existentes). As três funções abaixo são as da 2.0
-- (20261110000100_contratos_empresas.sql) com SÓ a coluna nova acrescentada.

alter table public.ctr_contratos add column if not exists assinante_cliente text not null default '';
alter table public.ctr_empresas add column if not exists contratada_assinante text not null default '';
comment on column public.ctr_contratos.assinante_cliente is 'Representante do cliente que assina (nome e CPF); campo CTTASSINANTE do modelo.';
comment on column public.ctr_empresas.contratada_assinante is 'Representante da contratada que assina (nome e CPF); campo CTRAASSINANTE do modelo.';

create or replace function public.ctr_empresa_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p ->> 'id', '')::bigint; a public.ctr_empresas; d public.ctr_empresas;
begin
  if v_id is null then
    perform public._ctr_admin();
    if coalesce(public._ctr_t(p, 'nome'), '') = '' then raise exception 'Informe o nome curto da empresa.'; end if;
    if exists (select 1 from public.ctr_empresas where lower(nome) = lower(public._ctr_t(p, 'nome'))) then raise exception 'Já existe uma empresa com o nome %.', public._ctr_t(p, 'nome'); end if;
    insert into public.ctr_empresas (nome, contratada_nome, contratada_cnpj, contratada_endereco, contratada_junta, contratada_email, contratada_assinante, servicos_esp,
      dia_nf, tolerancia, foro_padrao, foro_local_padrao)
    values (public._ctr_t(p, 'nome'), coalesce(public._ctr_t(p, 'contratada_nome'), ''), coalesce(public._ctr_t(p, 'contratada_cnpj'), ''),
      coalesce(public._ctr_t(p, 'contratada_endereco'), ''), coalesce(public._ctr_t(p, 'contratada_junta'), ''), coalesce(public._ctr_t(p, 'contratada_email'), ''), coalesce(public._ctr_t(p, 'contratada_assinante'), ''),
      coalesce(public._ctr_t(p, 'servicos_esp'), ''), coalesce(nullif(public._ctr_t(p, 'dia_nf'), '')::int, 5), coalesce(nullif(public._ctr_t(p, 'tolerancia'), '')::numeric, 0.05),
      coalesce(public._ctr_t(p, 'foro_padrao'), ''), coalesce(public._ctr_t(p, 'foro_local_padrao'), ''))
    returning * into d;
    perform public._ctr_auditar('contratos_empresa_criada', jsonb_build_object('razao_social', d.contratada_nome, 'cnpj', d.contratada_cnpj), d.id);
    return d.id;
  end if;
  perform public._ctr_gestor(v_id);
  if p ? 'ativo' and not public.eh_admin() then raise exception 'Somente a equipe Nervia ativa ou desativa uma empresa.'; end if;
  if p ? 'nome' and exists (select 1 from public.ctr_empresas where lower(nome) = lower(public._ctr_t(p, 'nome')) and id <> v_id) then
    raise exception 'Já existe uma empresa com o nome %.', public._ctr_t(p, 'nome');
  end if;
  select * into a from public.ctr_empresas where id = v_id for update;
  update public.ctr_empresas set
    nome = coalesce(nullif(public._ctr_t(p, 'nome'), ''), nome),
    contratada_nome = coalesce(public._ctr_t(p, 'contratada_nome'), contratada_nome),
    contratada_cnpj = coalesce(public._ctr_t(p, 'contratada_cnpj'), contratada_cnpj),
    contratada_endereco = coalesce(public._ctr_t(p, 'contratada_endereco'), contratada_endereco),
    contratada_junta = coalesce(public._ctr_t(p, 'contratada_junta'), contratada_junta),
    contratada_email = coalesce(public._ctr_t(p, 'contratada_email'), contratada_email),
    contratada_assinante = coalesce(public._ctr_t(p, 'contratada_assinante'), contratada_assinante),
    servicos_esp = coalesce(public._ctr_t(p, 'servicos_esp'), servicos_esp),
    dia_nf = coalesce(nullif(public._ctr_t(p, 'dia_nf'), '')::int, dia_nf),
    tolerancia = coalesce(nullif(public._ctr_t(p, 'tolerancia'), '')::numeric, tolerancia),
    foro_padrao = coalesce(public._ctr_t(p, 'foro_padrao'), foro_padrao),
    foro_local_padrao = coalesce(public._ctr_t(p, 'foro_local_padrao'), foro_local_padrao),
    ativo = coalesce((p ->> 'ativo')::boolean, ativo),
    atualizado_em = now()
  where id = v_id returning * into d;
  perform public._ctr_auditar('contratos_empresa_alterada', jsonb_build_object('antes', to_jsonb(a) - 'atualizado_em' - 'criado_em', 'depois', to_jsonb(d) - 'atualizado_em' - 'criado_em'), v_id);
  return v_id;
end $$;

create or replace function public.ctr_contrato_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p ->> 'id', '')::bigint; a public.ctr_contratos; d public.ctr_contratos; v_mot text := coalesce(public._ctr_t(p, 'motivo'), ''); v_emp bigint;
begin
  if v_id is null then
    select empresa_id into v_emp from public.ctr_clientes where id = nullif(p ->> 'cliente_id', '')::bigint;
    if not found then raise exception 'Escolha o cliente.'; end if;
    perform public._ctr_gestor(v_emp);
    if nullif(p ->> 'modelo_id', '') is not null and not exists (select 1 from public.ctr_modelos where id = (p ->> 'modelo_id')::bigint and empresa_id = v_emp) then
      raise exception 'O modelo não é desta empresa.';
    end if;
    if public._ctr_t(p, 'inicio') is null then raise exception 'Informe o início do contrato.'; end if;
    if coalesce(public._ctr_t(p, 'valor_mensal')::numeric, 0) <= 0 then raise exception 'Informe o valor mensal.'; end if;
    insert into public.ctr_contratos (empresa_id, cliente_id, modelo_id, objeto, servicos_esp, inicio, fim, valor_mensal, dia_vencimento, parcela_extra, assinantes, assinante_cliente,
      testemunha1, testemunha1_doc, testemunha2, testemunha2_doc, local_assinatura, data_assinatura, obs)
    values (v_emp, (p ->> 'cliente_id')::bigint, nullif(p ->> 'modelo_id', '')::bigint, coalesce(public._ctr_t(p, 'objeto'), ''), coalesce(public._ctr_t(p, 'servicos_esp'), ''),
      public._ctr_t(p, 'inicio')::date, nullif(public._ctr_t(p, 'fim'), '')::date, public._ctr_t(p, 'valor_mensal')::numeric,
      coalesce(nullif(public._ctr_t(p, 'dia_vencimento'), '')::int, 30), coalesce((p ->> 'parcela_extra')::boolean, true), coalesce(public._ctr_t(p, 'assinantes'), ''), coalesce(public._ctr_t(p, 'assinante_cliente'), ''),
      coalesce(public._ctr_t(p, 'testemunha1'), ''), coalesce(public._ctr_t(p, 'testemunha1_doc'), ''),
      coalesce(public._ctr_t(p, 'testemunha2'), ''), coalesce(public._ctr_t(p, 'testemunha2_doc'), ''),
      coalesce(nullif(public._ctr_t(p, 'local_assinatura'), ''), 'Rio de Janeiro'), nullif(public._ctr_t(p, 'data_assinatura'), '')::date, coalesce(public._ctr_t(p, 'obs'), ''))
    returning * into d;
    perform public._ctr_evento(d.id, 'Contrato criado (rascunho)', format('Valor mensal R$ %s', to_char(d.valor_mensal, 'FM999G999G990D00')));
    perform public._ctr_auditar('contratos_contrato_criado', jsonb_build_object('contrato', public._ctr_contrato_nome(d.id), 'contrato_id', d.id, 'valor_mensal', d.valor_mensal), v_emp);
    return d.id;
  end if;
  select * into a from public.ctr_contratos where id = v_id for update;
  if not found then raise exception 'Contrato não encontrado.'; end if;
  v_emp := a.empresa_id;
  perform public._ctr_gestor(v_emp);
  if p ? 'cliente_id' and (p ->> 'cliente_id')::bigint <> a.cliente_id then
    if not exists (select 1 from public.ctr_clientes where id = (p ->> 'cliente_id')::bigint and empresa_id = v_emp) then raise exception 'O cliente não é desta empresa.'; end if;
    if exists (select 1 from public.ctr_cobrancas where contrato_id = v_id) then raise exception 'O contrato já tem cobranças: o cliente não pode mudar.'; end if;
  end if;
  if nullif(p ->> 'modelo_id', '') is not null and not exists (select 1 from public.ctr_modelos where id = (p ->> 'modelo_id')::bigint and empresa_id = v_emp) then
    raise exception 'O modelo não é desta empresa.';
  end if;
  update public.ctr_contratos set
    cliente_id = coalesce((p ->> 'cliente_id')::bigint, cliente_id),
    modelo_id = case when p ? 'modelo_id' then nullif(p ->> 'modelo_id', '')::bigint else modelo_id end,
    objeto = coalesce(public._ctr_t(p, 'objeto'), objeto), servicos_esp = coalesce(public._ctr_t(p, 'servicos_esp'), servicos_esp),
    inicio = coalesce(nullif(public._ctr_t(p, 'inicio'), '')::date, inicio),
    fim = case when p ? 'fim' then nullif(public._ctr_t(p, 'fim'), '')::date else fim end,
    valor_mensal = coalesce(nullif(public._ctr_t(p, 'valor_mensal'), '')::numeric, valor_mensal),
    dia_vencimento = coalesce(nullif(public._ctr_t(p, 'dia_vencimento'), '')::int, dia_vencimento),
    parcela_extra = coalesce((p ->> 'parcela_extra')::boolean, parcela_extra),
    assinantes = coalesce(public._ctr_t(p, 'assinantes'), assinantes),
    assinante_cliente = coalesce(public._ctr_t(p, 'assinante_cliente'), assinante_cliente),
    testemunha1 = coalesce(public._ctr_t(p, 'testemunha1'), testemunha1), testemunha1_doc = coalesce(public._ctr_t(p, 'testemunha1_doc'), testemunha1_doc),
    testemunha2 = coalesce(public._ctr_t(p, 'testemunha2'), testemunha2), testemunha2_doc = coalesce(public._ctr_t(p, 'testemunha2_doc'), testemunha2_doc),
    local_assinatura = coalesce(nullif(public._ctr_t(p, 'local_assinatura'), ''), local_assinatura),
    data_assinatura = case when p ? 'data_assinatura' then nullif(public._ctr_t(p, 'data_assinatura'), '')::date else data_assinatura end,
    obs = coalesce(public._ctr_t(p, 'obs'), obs), atualizado_em = now()
  where id = v_id returning * into d;
  if d.valor_mensal <= 0 then raise exception 'Informe o valor mensal.'; end if;
  if a.situacao in ('assinado', 'encerrado', 'rescindido')
     and (a.valor_mensal, a.inicio, a.fim, a.dia_vencimento, a.parcela_extra) is distinct from (d.valor_mensal, d.inicio, d.fim, d.dia_vencimento, d.parcela_extra) then
    if length(v_mot) < 5 then raise exception 'O contrato já foi assinado: para mudar valor, prazo ou vencimento, informe o motivo (ex.: aditivo assinado em …).'; end if;
    perform public._ctr_evento(v_id, 'Alterado depois da assinatura', v_mot);
  end if;
  perform public._ctr_auditar('contratos_contrato_alterado', jsonb_build_object('contrato', public._ctr_contrato_nome(v_id), 'contrato_id', v_id,
    'motivo', nullif(v_mot, ''), 'antes', to_jsonb(a) - 'atualizado_em', 'depois', to_jsonb(d) - 'atualizado_em'), v_emp);
  return v_id;
end $$;

create or replace function public.ctr_contrato_renovar(p_id bigint, p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare k public.ctr_contratos; v_novo bigint;
begin
  select * into k from public.ctr_contratos where id = p_id;
  if not found then raise exception 'Contrato não encontrado.'; end if;
  perform public._ctr_gestor(k.empresa_id);
  if public._ctr_t(p, 'inicio') is null then raise exception 'Informe o início do novo contrato.'; end if;
  if k.fim is not null and public._ctr_t(p, 'inicio')::date <= k.fim and coalesce((p ->> 'sobrepor')::boolean, false) is false then
    raise exception 'O novo contrato começa antes do fim do atual (%).', to_char(k.fim, 'DD/MM/YYYY');
  end if;
  insert into public.ctr_contratos (empresa_id, cliente_id, modelo_id, objeto, servicos_esp, inicio, fim, valor_mensal, dia_vencimento, parcela_extra, assinantes, assinante_cliente,
    testemunha1, testemunha1_doc, testemunha2, testemunha2_doc, local_assinatura, anterior_id)
  values (k.empresa_id, k.cliente_id, k.modelo_id, k.objeto, k.servicos_esp, public._ctr_t(p, 'inicio')::date, nullif(public._ctr_t(p, 'fim'), '')::date,
    coalesce(nullif(public._ctr_t(p, 'valor_mensal'), '')::numeric, k.valor_mensal), k.dia_vencimento, k.parcela_extra, k.assinantes, k.assinante_cliente,
    k.testemunha1, k.testemunha1_doc, k.testemunha2, k.testemunha2_doc, k.local_assinatura, k.id)
  returning id into v_novo;
  perform public._ctr_evento(v_novo, 'Renovação do contrato anterior (rascunho)', public._ctr_contrato_nome(k.id));
  perform public._ctr_evento(k.id, 'Renovado', public._ctr_contrato_nome(v_novo));
  perform public._ctr_auditar('contratos_renovado', jsonb_build_object('contrato', public._ctr_contrato_nome(v_novo), 'contrato_id', v_novo, 'anterior_id', k.id,
    'antes', jsonb_build_object('valor_mensal', k.valor_mensal), 'depois', jsonb_build_object('valor_mensal', (select valor_mensal from public.ctr_contratos where id = v_novo))), k.empresa_id);
  return v_novo;
end $$;
