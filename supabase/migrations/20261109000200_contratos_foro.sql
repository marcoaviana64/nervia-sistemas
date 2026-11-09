-- Contratos 1.1: foro e local da arbitragem por cliente (pedido do Marco em 09/11/2026: "o contrato não pode ter cidade e
-- estado fixo, pois tenho contrato fora do RJ; deve constar uma variável para cada cliente também do foro").
-- No modelo do Word, dois campos novos de mala direta:
--   FORO      = cláusula 10.6 ("as Partes neste ato elegem o «FORO» como competente…"), ex.: "Foro Central da Comarca do Rio de Janeiro";
--   FOROLOCAL = cláusula 10.1.6 ("O local (sede) da arbitragem será a «FOROLOCAL», devendo…"), ex.: "cidade do Rio de Janeiro, Estado do Rio de Janeiro".
-- Vazio no cliente = o padrão da Configuração, que começa com o texto que o modelo tinha fixo (nada muda para quem não preencher).
-- Só acrescenta colunas com padrão; não toca em dados de nenhum outro app.

alter table public.ctr_clientes add column if not exists foro text not null default '';
alter table public.ctr_clientes add column if not exists foro_local text not null default '';
alter table public.ctr_config add column if not exists foro_padrao text not null default 'Foro Central da Comarca do Rio de Janeiro';
alter table public.ctr_config add column if not exists foro_local_padrao text not null default 'cidade do Rio de Janeiro, Estado do Rio de Janeiro';

create or replace function public.ctr_config_salvar(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a public.ctr_config; d public.ctr_config;
begin
  perform public._ctr_admin();
  select * into a from public.ctr_config where id = 1;
  update public.ctr_config set
    contratada_nome = coalesce(public._ctr_t(p, 'contratada_nome'), contratada_nome),
    contratada_cnpj = coalesce(public._ctr_t(p, 'contratada_cnpj'), contratada_cnpj),
    contratada_endereco = coalesce(public._ctr_t(p, 'contratada_endereco'), contratada_endereco),
    contratada_junta = coalesce(public._ctr_t(p, 'contratada_junta'), contratada_junta),
    contratada_email = coalesce(public._ctr_t(p, 'contratada_email'), contratada_email),
    servicos_esp = coalesce(public._ctr_t(p, 'servicos_esp'), servicos_esp),
    dia_nf = coalesce(public._ctr_t(p, 'dia_nf')::int, dia_nf),
    tolerancia = coalesce(public._ctr_t(p, 'tolerancia')::numeric, tolerancia),
    foro_padrao = coalesce(nullif(public._ctr_t(p, 'foro_padrao'), ''), foro_padrao),
    foro_local_padrao = coalesce(nullif(public._ctr_t(p, 'foro_local_padrao'), ''), foro_local_padrao),
    atualizado_em = now()
  where id = 1 returning * into d;
  perform public._ctr_auditar('contratos_config_alterada', jsonb_build_object('antes', to_jsonb(a) - 'atualizado_em', 'depois', to_jsonb(d) - 'atualizado_em'));
end $$;

create or replace function public.ctr_cliente_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p ->> 'id', '')::bigint; a public.ctr_clientes; d public.ctr_clientes; v_doc text;
begin
  perform public._ctr_admin();
  v_doc := public._ctr_doc(p ->> 'cnpj');
  if p ? 'cnpj' and v_doc is not null and length(v_doc) not in (11, 14) then raise exception 'CNPJ (14 dígitos) ou CPF (11 dígitos) inválido.'; end if;
  if v_id is null then
    if coalesce(public._ctr_t(p, 'apelido'), '') = '' or coalesce(public._ctr_t(p, 'razao_social'), '') = '' then
      raise exception 'Informe o nome curto e a razão social do cliente.';
    end if;
    if exists (select 1 from public.ctr_clientes where lower(apelido) = lower(public._ctr_t(p, 'apelido'))) then raise exception 'Já existe um cliente com o nome %.', public._ctr_t(p, 'apelido'); end if;
    if v_doc is not null and exists (select 1 from public.ctr_clientes where cnpj = v_doc) then raise exception 'Já existe um cliente com este CNPJ.'; end if;
    insert into public.ctr_clientes (apelido, sigla, razao_social, cnpj, endereco, email_cobranca, resp_financeiro, extrato_textos, obs, foro, foro_local)
    values (public._ctr_t(p, 'apelido'), coalesce(public._ctr_t(p, 'sigla'), ''), public._ctr_t(p, 'razao_social'), v_doc,
            coalesce(public._ctr_t(p, 'endereco'), ''), coalesce(public._ctr_t(p, 'email_cobranca'), ''), coalesce(public._ctr_t(p, 'resp_financeiro'), ''),
            coalesce((select array_agg(trim(x)) from jsonb_array_elements_text(case when jsonb_typeof(p -> 'extrato_textos') = 'array' then p -> 'extrato_textos' else '[]' end) x where trim(x) <> ''), '{}'),
            coalesce(public._ctr_t(p, 'obs'), ''), coalesce(public._ctr_t(p, 'foro'), ''), coalesce(public._ctr_t(p, 'foro_local'), ''))
    returning * into d;
    perform public._ctr_auditar('contratos_cliente_criado', jsonb_build_object('cliente', d.apelido, 'razao_social', d.razao_social, 'cnpj', d.cnpj));
    return d.id;
  end if;
  select * into a from public.ctr_clientes where id = v_id;
  if not found then raise exception 'Cliente não encontrado.'; end if;
  if p ? 'apelido' and exists (select 1 from public.ctr_clientes where lower(apelido) = lower(public._ctr_t(p, 'apelido')) and id <> v_id) then
    raise exception 'Já existe um cliente com o nome %.', public._ctr_t(p, 'apelido');
  end if;
  if p ? 'cnpj' and v_doc is not null and exists (select 1 from public.ctr_clientes where cnpj = v_doc and id <> v_id) then raise exception 'Já existe um cliente com este CNPJ.'; end if;
  update public.ctr_clientes set
    apelido = coalesce(nullif(public._ctr_t(p, 'apelido'), ''), apelido),
    sigla = coalesce(public._ctr_t(p, 'sigla'), sigla),
    razao_social = coalesce(nullif(public._ctr_t(p, 'razao_social'), ''), razao_social),
    cnpj = case when p ? 'cnpj' then v_doc else cnpj end,
    endereco = coalesce(public._ctr_t(p, 'endereco'), endereco),
    email_cobranca = coalesce(public._ctr_t(p, 'email_cobranca'), email_cobranca),
    resp_financeiro = coalesce(public._ctr_t(p, 'resp_financeiro'), resp_financeiro),
    extrato_textos = case when jsonb_typeof(p -> 'extrato_textos') = 'array'
      then coalesce((select array_agg(trim(x)) from jsonb_array_elements_text(p -> 'extrato_textos') x where trim(x) <> ''), '{}') else extrato_textos end,
    ativo = coalesce((p ->> 'ativo')::boolean, ativo),
    obs = coalesce(public._ctr_t(p, 'obs'), obs),
    foro = coalesce(public._ctr_t(p, 'foro'), foro),
    foro_local = coalesce(public._ctr_t(p, 'foro_local'), foro_local)
  where id = v_id returning * into d;
  perform public._ctr_auditar('contratos_cliente_alterado', jsonb_build_object('cliente', d.apelido, 'antes', to_jsonb(a) - 'criado_em', 'depois', to_jsonb(d) - 'criado_em'));
  return v_id;
end $$;
