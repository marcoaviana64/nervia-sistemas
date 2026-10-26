-- Sistema Linum: composição do tecido no rolo (pedido do Marco em 26/10/2026: "faltou o tipo de tecido, 100% linho,
-- elastano, % algodão % linho"). Texto livre (ex.: "100% Linho", "98,5% Algodão 1,5% Elastano"); a tela sugere pela
-- descrição do item da nota ("PURO LINHO" = 100% Linho; percentuais escritos na descrição). Entra na compra, na
-- importação do XML e na edição do rolo; lin_producao_ler já devolve a coluna (to_jsonb da linha).
alter table public.lin_rolos add column if not exists composicao text not null default '';

create or replace function public.lin_rolo_comprar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_un text := coalesce(nullif(p ->> 'unidade', ''), 'm'); v_chave text := nullif(regexp_replace(coalesce(p ->> 'nfe_chave', ''), '\D', '', 'g'), '');
        v_item int := nullif(p ->> 'nfe_item', '')::int; v_rend numeric := nullif(p ->> 'rendimento', '')::numeric; v_qtd int := coalesce(nullif(p ->> 'quantidade', '')::int, 1); v_metros numeric := nullif(p ->> 'metros', '')::numeric;
        v_tecido text := public._lin_txt(p, 'tecido'); v_valor numeric := 0; v_ano int; v_n int; v_id uuid; v_ids jsonb := '[]'; v_cod text;
        v_data date := coalesce(nullif(p ->> 'data_compra', '')::date, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  if v_tecido is null then raise exception 'Informe o tecido (ex.: linho puro, linho misto)'; end if;
  if v_un not in ('m', 'kg') then raise exception 'Unidade da compra: metros ou quilos'; end if;
  if v_metros is null or v_metros <= 0 or v_metros > 2000 then raise exception 'Informe quantos % tem cada rolo', case v_un when 'kg' then 'quilos' else 'metros' end; end if;
  if v_un = 'm' then v_rend := null; end if;
  if v_rend is not null and (v_rend <= 0 or v_rend > 100) then raise exception 'Rendimento: quantos metros dá 1 kg (entre 0,01 e 100)'; end if;
  if v_chave is not null and length(v_chave) <> 44 then raise exception 'Chave da nota inválida (44 dígitos)'; end if;
  -- o mesmo item da mesma nota não entra duas vezes
  if v_chave is not null and exists (select 1 from public.lin_rolos where nfe_chave = v_chave and nfe_item is not distinct from v_item) then
    raise exception 'O item % da nota % já foi registrado (rolo %)', coalesce(v_item::text, ''), coalesce(p ->> 'nota', ''),
      (select string_agg(codigo, ', ' order by codigo) from public.lin_rolos where nfe_chave = v_chave and nfe_item is not distinct from v_item);
  end if;
  if v_qtd < 1 or v_qtd > 50 then raise exception 'Quantidade de rolos: de 1 a 50'; end if;
  if v_data > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'A data da compra não pode ser no futuro'; end if;
  if public.lin_pode('producao_valores') then v_valor := coalesce(nullif(p ->> 'valor_pago', '')::numeric, 0); end if;
  if v_valor < 0 then raise exception 'Valor pago não pode ser negativo'; end if;
  v_ano := extract(year from v_data);
  for i in 1..v_qtd loop
    insert into public.lin_rolo_codigos (ano, ultimo) values (v_ano, 1)
    on conflict (ano) do update set ultimo = lin_rolo_codigos.ultimo + 1 returning ultimo into v_n;
    v_cod := 'R-' || v_ano || '-' || lpad(v_n::text, 3, '0');
    insert into public.lin_rolos (codigo, fornecedor, tecido, cor, composicao, metros_iniciais, saldo, valor_pago, data_compra, nota, observacoes, criado_por, criado_nome, unidade, rendimento, nfe_chave, nfe_item)
    values (v_cod, coalesce(public._lin_txt(p, 'fornecedor'), ''), v_tecido, coalesce(public._lin_txt(p, 'cor'), ''), coalesce(public._lin_txt(p, 'composicao'), ''), v_metros, 0,
            round(v_valor / v_qtd, 2), v_data, coalesce(public._lin_txt(p, 'nota'), ''), coalesce(public._lin_txt(p, 'observacoes'), ''),
            auth.uid(), public._lin_nome(), v_un, v_rend, v_chave, v_item)
    returning id into v_id;
    perform public._lin_rolo_mov(v_id, 'compra', v_metros, null, null, 'Compra');
    v_ids := v_ids || jsonb_build_object('id', v_id, 'codigo', v_cod);
  end loop;
  perform public._lin_auditar('linum_rolo_comprado', null, jsonb_build_object('rolos', v_ids, 'tecido', v_tecido, 'cor', p ->> 'cor', 'composicao', p ->> 'composicao',
    'unidade', v_un, 'quantidade_cada', v_metros, 'rendimento', v_rend, 'nfe_chave', v_chave, 'nfe_item', v_item, 'fornecedor', p ->> 'fornecedor', 'valor_pago', v_valor, 'nota', p ->> 'nota'));
  return v_ids;
end $$;

create or replace function public.lin_rolos_importar_nfe(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it jsonb; v_rolos int; v_total numeric; v_res jsonb := '[]'; v_n int := 0;
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  if length(regexp_replace(coalesce(p ->> 'chave', ''), '\D', '', 'g')) <> 44 then raise exception 'Chave da nota inválida (44 dígitos)'; end if;
  for it in select * from jsonb_array_elements(coalesce(p -> 'itens', '[]')) loop
    v_rolos := coalesce(nullif(it ->> 'rolos', '')::int, 1); v_total := nullif(it ->> 'total', '')::numeric;
    if v_rolos < 1 or v_rolos > 50 then raise exception 'Quantidade de rolos do item %: de 1 a 50', it ->> 'item'; end if;
    if v_total is null or v_total <= 0 then raise exception 'Quantidade do item % inválida', it ->> 'item'; end if;
    v_res := v_res || public.lin_rolo_comprar(jsonb_build_object('tecido', it ->> 'tecido', 'cor', it ->> 'cor', 'composicao', it ->> 'composicao', 'unidade', it ->> 'unidade',
      'quantidade', v_rolos, 'metros', round(v_total / v_rolos, 2), 'valor_pago', it ->> 'valor', 'data_compra', p ->> 'data',
      'fornecedor', p ->> 'fornecedor', 'nota', p ->> 'numero', 'nfe_chave', p ->> 'chave', 'nfe_item', it ->> 'item',
      'observacoes', 'Importado do XML da NF-e ' || coalesce(p ->> 'numero', '')));
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Marque pelo menos um item da nota'; end if;
  return v_res;
end $$;

create or replace function public.lin_rolos_editar(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare it jsonb; v record; n record; v_val boolean := public.lin_pode('producao_valores'); v_mud jsonb; v_antes jsonb; k text; v_qtd int := 0;
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  if jsonb_typeof(p -> 'rolos') is distinct from 'array' or jsonb_array_length(p -> 'rolos') = 0 then raise exception 'Nenhum rolo para alterar'; end if;
  if jsonb_array_length(p -> 'rolos') > 200 then raise exception 'No máximo 200 rolos de uma vez'; end if;
  for it in select * from jsonb_array_elements(p -> 'rolos') loop
    select * into v from public.lin_rolos where id = nullif(it ->> 'id', '')::uuid for update;
    if v.id is null then raise exception 'Rolo não encontrado'; end if;
    if it ? 'valor_pago' and not v_val then raise exception 'Só quem tem a permissão Valores da produção altera o valor pago'; end if;
    select coalesce(case when it ? 'tecido' then trim(it ->> 'tecido') end, v.tecido) as tecido,
           coalesce(case when it ? 'cor' then trim(it ->> 'cor') end, v.cor) as cor,
           coalesce(case when it ? 'composicao' then trim(it ->> 'composicao') end, v.composicao) as composicao,
           coalesce(case when it ? 'fornecedor' then trim(it ->> 'fornecedor') end, v.fornecedor) as fornecedor,
           coalesce(case when it ? 'nota' then trim(it ->> 'nota') end, v.nota) as nota,
           coalesce(case when it ? 'observacoes' then trim(it ->> 'observacoes') end, v.observacoes) as observacoes,
           coalesce(case when it ? 'data_compra' then nullif(it ->> 'data_compra', '')::date end, v.data_compra) as data_compra,
           coalesce(case when it ? 'valor_pago' then round(nullif(replace(it ->> 'valor_pago', ',', '.'), '')::numeric, 2) end, v.valor_pago) as valor_pago
      into n;
    if n.tecido = '' then raise exception 'Rolo %: informe o tecido', v.codigo; end if;
    if length(n.tecido) > 200 or length(n.cor) > 100 or length(n.composicao) > 200 or length(n.fornecedor) > 200 or length(n.nota) > 60 or length(n.observacoes) > 1000 then
      raise exception 'Rolo %: texto longo demais', v.codigo; end if;
    if n.data_compra > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'Rolo %: a data da compra não pode ser no futuro', v.codigo; end if;
    if n.valor_pago < 0 then raise exception 'Rolo %: valor pago inválido', v.codigo; end if;
    -- só o que mudou vai para a auditoria (antes e depois)
    v_mud := '{}'; v_antes := '{}';
    foreach k in array array['tecido', 'cor', 'composicao', 'fornecedor', 'nota', 'observacoes', 'data_compra', 'valor_pago'] loop
      if (to_jsonb(n) -> k) is distinct from (to_jsonb(v) -> k) then
        v_mud := v_mud || jsonb_build_object(k, to_jsonb(n) -> k); v_antes := v_antes || jsonb_build_object(k, to_jsonb(v) -> k);
      end if;
    end loop;
    if v_mud = '{}' then continue; end if;
    update public.lin_rolos set tecido = n.tecido, cor = n.cor, composicao = n.composicao, fornecedor = n.fornecedor, nota = n.nota, observacoes = n.observacoes,
           data_compra = n.data_compra, valor_pago = n.valor_pago where id = v.id;
    perform public._lin_auditar('linum_rolo_alterado', null, jsonb_build_object('rolo', v.codigo, 'antes', v_antes, 'depois', v_mud));
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end $$;
