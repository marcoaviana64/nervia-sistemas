-- Sistema Linum — Produção 2.1 (pedido do Marco em 25/10/2026): "para atualizar as compras dos rolos de linho, ler o XML
-- da nota e importar os dados; e há tecidos que são por quilo".
--   * Rolo em metros OU em quilos (lin_rolos.unidade); a peça diz em que unidade gasta o tecido (lin_produtos.consumo_unidade,
--     vale para todos os tamanhos) e a ficha copia a unidade (lin_ordem_itens.unidade). No corte, cada unidade das peças
--     precisa de rolo da mesma unidade; o custo do tecido usa só rolos da unidade da peça. As colunas continuam
--     metros_iniciais / saldo / consumo_metros (agora "quantidade na unidade").
--   * Importar a NF-e de compra: o navegador lê o XML (layout 4.00 da NF-e: infNFe@Id = chave, ide/nNF, ide/dhEmi,
--     emit/xNome, det@nItem/prod: xProd, uCom, qCom, vProd, vDesc, vFrete, vSeg, vOutro; imposto/IPI/vIPI, ICMS vICMSST);
--     a Nervia/Linum confere a cor e quantos rolos veio cada item (a nota não diz) e grava pela lin_rolos_importar_nfe
--     (tudo ou nada). O mesmo item da mesma nota (chave + nº do item) não entra duas vezes.

alter table public.lin_rolos add column if not exists unidade text not null default 'm';
alter table public.lin_rolos drop constraint if exists lin_rolos_unidade;
alter table public.lin_rolos add constraint lin_rolos_unidade check (unidade in ('m', 'kg'));
alter table public.lin_rolos add column if not exists nfe_chave text check (nfe_chave is null or nfe_chave ~ '^[0-9]{44}$');
alter table public.lin_rolos add column if not exists nfe_item int;
create index if not exists lin_rolos_nfe on public.lin_rolos (nfe_chave, nfe_item) where nfe_chave is not null;
alter table public.lin_produtos add column if not exists consumo_unidade text not null default 'm';
alter table public.lin_produtos drop constraint if exists lin_produtos_consumo_unidade;
alter table public.lin_produtos add constraint lin_produtos_consumo_unidade check (consumo_unidade in ('m', 'kg'));
alter table public.lin_ordem_itens add column if not exists unidade text not null default 'm';
alter table public.lin_ordem_itens drop constraint if exists lin_ordem_itens_unidade;
alter table public.lin_ordem_itens add constraint lin_ordem_itens_unidade check (unidade in ('m', 'kg'));

create or replace function public.lin_rolo_comprar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_un text := coalesce(nullif(p ->> 'unidade', ''), 'm'); v_chave text := nullif(regexp_replace(coalesce(p ->> 'nfe_chave', ''), '\D', '', 'g'), '');
        v_item int := nullif(p ->> 'nfe_item', '')::int; v_qtd int := coalesce(nullif(p ->> 'quantidade', '')::int, 1); v_metros numeric := nullif(p ->> 'metros', '')::numeric;
        v_tecido text := public._lin_txt(p, 'tecido'); v_valor numeric := 0; v_ano int; v_n int; v_id uuid; v_ids jsonb := '[]'; v_cod text;
        v_data date := coalesce(nullif(p ->> 'data_compra', '')::date, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  if v_tecido is null then raise exception 'Informe o tecido (ex.: linho puro, linho misto)'; end if;
  if v_un not in ('m', 'kg') then raise exception 'Unidade do tecido: metros ou quilos'; end if;
  if v_metros is null or v_metros <= 0 or v_metros > 2000 then raise exception 'Informe quantos % tem cada rolo', case v_un when 'kg' then 'quilos' else 'metros' end; end if;
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
    insert into public.lin_rolos (codigo, fornecedor, tecido, cor, metros_iniciais, saldo, valor_pago, data_compra, nota, observacoes, criado_por, criado_nome, unidade, nfe_chave, nfe_item)
    values (v_cod, coalesce(public._lin_txt(p, 'fornecedor'), ''), v_tecido, coalesce(public._lin_txt(p, 'cor'), ''), v_metros, 0,
            round(v_valor / v_qtd, 2), v_data, coalesce(public._lin_txt(p, 'nota'), ''), coalesce(public._lin_txt(p, 'observacoes'), ''),
            auth.uid(), public._lin_nome(), v_un, v_chave, v_item)
    returning id into v_id;
    perform public._lin_rolo_mov(v_id, 'compra', v_metros, null, null, 'Compra');
    v_ids := v_ids || jsonb_build_object('id', v_id, 'codigo', v_cod);
  end loop;
  perform public._lin_auditar('linum_rolo_comprado', null, jsonb_build_object('rolos', v_ids, 'tecido', v_tecido, 'cor', p ->> 'cor',
    'unidade', v_un, 'quantidade_cada', v_metros, 'nfe_chave', v_chave, 'nfe_item', v_item, 'fornecedor', p ->> 'fornecedor', 'valor_pago', v_valor, 'nota', p ->> 'nota'));
  return v_ids;
end $$;

create or replace function public.lin_rolo_ajustar(p_rolo uuid, p_saldo numeric, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_antes numeric;
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  if p_saldo is null or p_saldo < 0 then raise exception 'Informe o saldo (zero ou mais)'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escreva o motivo do ajuste'; end if;
  select saldo into v_antes from public.lin_rolos where id = p_rolo for update;
  if v_antes is null then raise exception 'Rolo não encontrado'; end if;
  if v_antes = p_saldo then return; end if;
  perform public._lin_rolo_mov(p_rolo, 'ajuste', p_saldo - v_antes, null, null, trim(p_motivo));
  perform public._lin_auditar('linum_rolo_ajustado', null, jsonb_build_object('rolo', (select codigo from public.lin_rolos where id = p_rolo),
    'saldo_antes', v_antes, 'saldo', p_saldo, 'motivo', trim(p_motivo)));
end $$;

create or replace function public.lin_consumo_salvar(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_un text := coalesce(nullif(p ->> 'consumo_unidade', ''), 'm'); v_prod uuid := nullif(p ->> 'produto_id', '')::uuid; v_cons numeric := nullif(p ->> 'consumo_metros', '')::numeric;
        v_antes jsonb; k text; val text;
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  if not exists (select 1 from public.lin_produtos where id = v_prod) then raise exception 'Produto não encontrado'; end if;
  if v_un not in ('m', 'kg') then raise exception 'Unidade do tecido: metros ou quilos'; end if;
  if v_cons is not null and (v_cons <= 0 or v_cons > 50) then raise exception 'Tecido por peça: entre 0,01 e 50'; end if;
  select jsonb_build_object('produto', p0.consumo_metros, 'unidade', p0.consumo_unidade, 'variantes', coalesce((select jsonb_object_agg(v.id, v.consumo_metros) from public.lin_variantes v
           where v.produto_id = v_prod and v.consumo_metros is not null), '{}')) into v_antes from public.lin_produtos p0 where p0.id = v_prod;
  update public.lin_produtos set consumo_metros = v_cons, consumo_unidade = v_un, atualizado_em = now() where id = v_prod;
  for k, val in select * from jsonb_each_text(coalesce(p -> 'variantes', '{}')) loop
    if nullif(val, '')::numeric is not null and (val::numeric <= 0 or val::numeric > 50) then raise exception 'Tecido por peça: entre 0,01 e 50'; end if;
    update public.lin_variantes set consumo_metros = nullif(val, '')::numeric where id = k::uuid and produto_id = v_prod;
  end loop;
  perform public._lin_auditar('linum_consumo_alterado', null, jsonb_build_object('produto_id', v_prod,
    'produto', (select referencia || ' ' || descricao from public.lin_produtos where id = v_prod), 'antes', v_antes,
    'depois', jsonb_build_object('produto', v_cons, 'unidade', v_un, 'variantes', coalesce(p -> 'variantes', '{}'))));
end $$;

create or replace function public.lin_ordem_criar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; it jsonb; v_var uuid; v_qtd int; v_cons numeric; v_n int := 0; v_metros numeric := 0;
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  if jsonb_array_length(coalesce(p -> 'itens', '[]')) = 0 then raise exception 'Coloque pelo menos uma peça na ficha'; end if;
  if nullif(p ->> 'loja_destino_id', '') is not null and not exists (select 1 from public.lin_lojas where id = (p ->> 'loja_destino_id')::uuid) then
    raise exception 'Loja não encontrada';
  end if;
  insert into public.lin_ordens (criado_por, criado_nome, prazo, loja_destino_id, molde, observacao)
  values (auth.uid(), public._lin_nome(), nullif(p ->> 'prazo', '')::date, nullif(p ->> 'loja_destino_id', '')::uuid,
          coalesce(public._lin_txt(p, 'molde'), ''), coalesce(public._lin_txt(p, 'observacao'), ''))
  returning id into v_id;
  for it in select * from jsonb_array_elements(p -> 'itens') loop
    v_var := nullif(it ->> 'variante_id', '')::uuid; v_qtd := nullif(it ->> 'quantidade', '')::int;
    if v_qtd is null or v_qtd < 1 or v_qtd > 5000 then raise exception 'Quantidade de cada peça: de 1 a 5000'; end if;
    v_cons := coalesce(nullif(it ->> 'consumo', '')::numeric, public._lin_consumo(v_var));
    if v_cons is null then
      raise exception 'Falta o tecido por peça de % (informe na ficha ou em Produção → Tecido por peça)',
        (select pr.referencia || ' ' || v.cor || ' ' || v.tamanho from public.lin_variantes v join public.lin_produtos pr on pr.id = v.produto_id where v.id = v_var);
    end if;
    if v_cons <= 0 or v_cons > 50 then raise exception 'Tecido por peça: entre 0,01 e 50'; end if;
    insert into public.lin_ordem_itens (ordem_id, variante_id, referencia, descricao, cor, tamanho, edicao, quantidade, consumo, unidade)
    select v_id, v.id, pr.referencia, pr.descricao, v.cor, v.tamanho, v.edicao, v_qtd, v_cons, pr.consumo_unidade
      from public.lin_variantes v join public.lin_produtos pr on pr.id = v.produto_id where v.id = v_var;
    if not found then raise exception 'Peça não encontrada'; end if;
    v_n := v_n + v_qtd;
  end loop;
  perform public._lin_auditar('linum_producao_ficha_criada', null, jsonb_build_object('ficha', v_id, 'pecas', v_n, 'tecido', (select jsonb_object_agg(unidade, total) from (select unidade, sum(quantidade * consumo) total from public.lin_ordem_itens where ordem_id = v_id group by unidade) t),
    'itens', (select jsonb_agg(jsonb_build_object('peca', referencia || ' ' || cor || ' ' || tamanho, 'quantidade', quantidade)) from public.lin_ordem_itens where ordem_id = v_id)));
  return v_id;
end $$;

create or replace function public.lin_envio_criar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_ordem bigint := nullif(p ->> 'ordem_id', '')::bigint; v_etapa text := coalesce(p ->> 'etapa', ''); v_parc uuid := nullif(p ->> 'parceiro_id', '')::uuid;
        v_ptipo text; v_pnome text; v_preco numeric; v_id bigint; it jsonb; r jsonb; v_item bigint; v_qtd int; v_disp int; v_n int := 0; v_metros numeric := 0; v_status text;
        v_precisa numeric := 0;
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  select status into v_status from public.lin_ordens where id = v_ordem for update;
  if v_status is null then raise exception 'Ficha não encontrada'; end if;
  if v_status <> 'aberta' then raise exception 'Esta ficha está %', case v_status when 'concluida' then 'concluída' else 'cancelada' end; end if;
  if v_etapa not in ('corte', 'costura', 'lavagem', 'passadoria') then raise exception 'Etapa inválida'; end if;
  select tipo, nome, preco_peca into v_ptipo, v_pnome, v_preco from public.lin_parceiros where id = v_parc and ativo;
  if v_ptipo is null then raise exception 'Escolha o parceiro'; end if;
  if v_ptipo <> (case v_etapa when 'corte' then 'cortador' when 'costura' then 'costureira' when 'lavagem' then 'lavanderia' else 'passadoria' end) then
    raise exception 'Este parceiro não é de %', v_etapa;
  end if;
  -- o preço por peça vem do cadastro; quem tem a permissão de valores pode trocar só nesta remessa
  if public.lin_pode('producao_valores') and nullif(p ->> 'preco_peca', '') is not null then v_preco := (p ->> 'preco_peca')::numeric; end if;
  if v_preco < 0 then raise exception 'Preço por peça não pode ser negativo'; end if;
  insert into public.lin_envios (ordem_id, etapa, parceiro_id, parceiro_nome, preco_peca, prazo, enviado_por, enviado_nome, observacao)
  values (v_ordem, v_etapa, v_parc, v_pnome, v_preco, nullif(p ->> 'prazo', '')::date, auth.uid(), public._lin_nome(), coalesce(public._lin_txt(p, 'observacao'), ''))
  returning id into v_id;
  for it in select * from jsonb_array_elements(coalesce(p -> 'itens', '[]')) loop
    v_item := (it ->> 'ordem_item_id')::bigint; v_qtd := coalesce(nullif(it ->> 'quantidade', '')::int, 0);
    if v_qtd = 0 then continue; end if;
    if v_qtd < 0 then raise exception 'Quantidade inválida'; end if;
    if not exists (select 1 from public.lin_ordem_itens where id = v_item and ordem_id = v_ordem) then raise exception 'Peça não é desta ficha'; end if;
    v_disp := public._lin_disponivel(v_item, v_etapa);
    if v_qtd > v_disp then
      raise exception 'Só há % peça(s) de % disponíveis para %', v_disp,
        (select referencia || ' ' || cor || ' ' || tamanho from public.lin_ordem_itens where id = v_item), v_etapa;
    end if;
    insert into public.lin_envio_itens (envio_id, ordem_item_id, enviadas) values (v_id, v_item, v_qtd);
    v_n := v_n + v_qtd;
    v_precisa := v_precisa + v_qtd * (select consumo from public.lin_ordem_itens where id = v_item);
  end loop;
  if v_n = 0 then raise exception 'Informe quantas peças vão nesta remessa'; end if;
  -- corte: o linho sai dos rolos escolhidos
  if v_etapa = 'corte' then
    for r in select * from jsonb_array_elements(coalesce(p -> 'rolos', '[]')) loop
      if coalesce(nullif(r ->> 'metros', '')::numeric, 0) <= 0 then continue; end if;
      insert into public.lin_envio_rolos (envio_id, rolo_id, metros) values (v_id, (r ->> 'rolo_id')::uuid, (r ->> 'metros')::numeric);
      perform public._lin_rolo_mov((r ->> 'rolo_id')::uuid, 'corte', -(r ->> 'metros')::numeric, v_ordem, v_id, 'Ficha nº ' || v_ordem || ' para ' || v_pnome);
      v_metros := v_metros + (r ->> 'metros')::numeric;
    end loop;
    if v_metros = 0 then raise exception 'Escolha de que rolo sai o tecido'; end if;
    -- cada unidade (metros, quilos) das peças precisa de rolo da mesma unidade; rolo de outra unidade não serve
    if exists (select 1 from public.lin_envio_rolos er join public.lin_rolos r on r.id = er.rolo_id where er.envio_id = v_id
                and r.unidade not in (select i.unidade from public.lin_envio_itens ei join public.lin_ordem_itens i on i.id = ei.ordem_item_id where ei.envio_id = v_id)) then
      raise exception 'Rolo de outra unidade: estas peças não usam tecido por %', (select case r.unidade when 'kg' then 'quilo' else 'metro' end from public.lin_envio_rolos er join public.lin_rolos r on r.id = er.rolo_id
        where er.envio_id = v_id and r.unidade not in (select i.unidade from public.lin_envio_itens ei join public.lin_ordem_itens i on i.id = ei.ordem_item_id where ei.envio_id = v_id) limit 1);
    end if;
    if exists (select 1 from public.lin_envio_itens ei join public.lin_ordem_itens i on i.id = ei.ordem_item_id where ei.envio_id = v_id
                and not exists (select 1 from public.lin_envio_rolos er join public.lin_rolos r on r.id = er.rolo_id where er.envio_id = v_id and r.unidade = i.unidade)) then
      raise exception 'Faltou escolher rolo de tecido por % para as peças desta remessa', (select case i.unidade when 'kg' then 'quilo' else 'metro' end
        from public.lin_envio_itens ei join public.lin_ordem_itens i on i.id = ei.ordem_item_id where ei.envio_id = v_id
         and not exists (select 1 from public.lin_envio_rolos er join public.lin_rolos r on r.id = er.rolo_id where er.envio_id = v_id and r.unidade = i.unidade) limit 1);
    end if;
  end if;
  perform public._lin_auditar('linum_producao_enviada', null, jsonb_build_object('ficha', v_ordem, 'remessa', v_id, 'etapa', v_etapa,
    'parceiro', v_pnome, 'pecas', v_n, 'metros', nullif(v_metros, 0), 'preco_peca', v_preco));
  return v_id;
end $$;

create or replace function public._lin_custo_item(p_item bigint) returns numeric
language sql stable security definer set search_path = public as $$
  with i as (select * from public.lin_ordem_itens where id = p_item),
  linho as (
    select sum(er.metros * r.valor_pago / r.metros_iniciais) / nullif(sum(er.metros), 0) as por_metro
      from public.lin_envio_rolos er join public.lin_envios e on e.id = er.envio_id join public.lin_rolos r on r.id = er.rolo_id
     where e.ordem_id = (select ordem_id from i) and r.unidade = (select unidade from i)
  ),
  etapas as (
    select e.etapa, sum(ei.recebidas * e.preco_peca) / nullif(sum(ei.recebidas), 0) as preco
      from public.lin_envio_itens ei join public.lin_envios e on e.id = ei.envio_id
     where ei.ordem_item_id = p_item group by e.etapa
  )
  select round(coalesce((select por_metro from linho), 0) * (select consumo from i) + coalesce((select sum(preco) from etapas), 0), 2)
$$;

-- peças prontas (voltaram boas da passadoria) entram no estoque: p = {ordem_id, loja_id, itens:[{ordem_item_id, quantidade}]}
create or replace function public.lin_ordem_entrada(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_ordem bigint := nullif(p ->> 'ordem_id', '')::bigint; v_loja uuid := nullif(p ->> 'loja_id', '')::uuid; it jsonb; v_item bigint; v_qtd int;
        v_disp int; v_var uuid; v_n int := 0; v_custo numeric; v_status text;
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  select status into v_status from public.lin_ordens where id = v_ordem for update;
  if v_status is null then raise exception 'Ficha não encontrada'; end if;
  if v_status <> 'aberta' then raise exception 'Esta ficha não está aberta'; end if;
  if not exists (select 1 from public.lin_lojas where id = v_loja) then raise exception 'Escolha a loja que recebe as peças'; end if;
  for it in select * from jsonb_array_elements(coalesce(p -> 'itens', '[]')) loop
    v_item := (it ->> 'ordem_item_id')::bigint; v_qtd := coalesce(nullif(it ->> 'quantidade', '')::int, 0);
    if v_qtd = 0 then continue; end if;
    select variante_id into v_var from public.lin_ordem_itens where id = v_item and ordem_id = v_ordem;
    if not found then raise exception 'Peça não é desta ficha'; end if;
    if v_var is null then raise exception 'A variação desta peça foi excluída do cadastro'; end if;
    v_disp := public._lin_disponivel(v_item, 'estoque');
    if v_qtd < 0 or v_qtd > v_disp then raise exception 'Só há % peça(s) prontas para entrar no estoque', v_disp; end if;
    v_custo := public._lin_custo_item(v_item);
    insert into public.lin_ordem_entradas (ordem_item_id, loja_id, quantidade, custo_unitario, por, por_nome)
    values (v_item, v_loja, v_qtd, v_custo, auth.uid(), public._lin_nome());
    insert into public.lin_estoque (variante_id, loja_id, quantidade) values (v_var, v_loja, v_qtd)
    on conflict (variante_id, loja_id) do update set quantidade = lin_estoque.quantidade + excluded.quantidade, atualizado_em = now();
    insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, data, observacao, criado_por, criado_nome)
    values (v_var, v_loja, 'producao', v_qtd, (now() at time zone 'America/Sao_Paulo')::date, 'Ficha de produção nº ' || v_ordem, auth.uid(), public._lin_nome());
    perform public._lin_auditar('linum_producao_estoque', v_var, jsonb_build_object('ficha', v_ordem, 'loja', public._lin_loja(v_loja), 'quantidade', v_qtd,
      'custo_unitario', v_custo));
    v_n := v_n + v_qtd;
  end loop;
  if v_n = 0 then raise exception 'Informe quantas peças entram no estoque'; end if;
  -- ficha concluída quando todas as peças planejadas entraram no estoque ou se perderam em alguma etapa
  if not exists (select 1 from public.lin_ordem_itens i where i.ordem_id = v_ordem
                  and i.quantidade > coalesce((select sum(quantidade) from public.lin_ordem_entradas where ordem_item_id = i.id), 0)
                                   + coalesce((select sum(ei.perdas) from public.lin_envio_itens ei where ei.ordem_item_id = i.id), 0)) then
    update public.lin_ordens set status = 'concluida', encerrada_em = now(), encerrada_nome = public._lin_nome() where id = v_ordem;
  end if;
end $$;

create or replace function public.lin_producao_ler() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_val boolean := public.lin_pode('producao_valores');
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  return jsonb_build_object(
    'valores', v_val,
    'lojas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome) order by ordem, nome) from public.lin_lojas), '[]'),
    'parceiros', coalesce((select jsonb_agg(case when v_val then to_jsonb(x) else to_jsonb(x) - 'preco_peca' end order by x.tipo, x.nome) from public.lin_parceiros x), '[]'),
    'rolos', coalesce((select jsonb_agg(case when v_val then to_jsonb(r) - 'origem' - 'nfe_chave' else to_jsonb(r) - 'origem' - 'nfe_chave' - 'valor_pago' end order by r.saldo = 0, r.data_compra desc, r.codigo desc)
                       from public.lin_rolos r), '[]'),
    'produtos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'referencia', p.referencia, 'descricao', p.descricao, 'consumo', p.consumo_metros, 'unidade', p.consumo_unidade,
                   'variantes', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'cor', v.cor, 'tamanho', v.tamanho, 'edicao', v.edicao, 'consumo', v.consumo_metros)
                                          order by v.cor, v.tamanho) from public.lin_variantes v where v.produto_id = p.id and v.ativo), '[]'))
                 order by p.descricao, p.referencia) from public.lin_produtos p where p.ativo), '[]'),
    'ordens', coalesce((select jsonb_agg(to_jsonb(o) || jsonb_build_object(
        'itens', coalesce((select jsonb_agg(to_jsonb(i) || jsonb_build_object(
                    'custo', case when v_val then public._lin_custo_item(i.id) end,
                    'entraram', coalesce((select sum(quantidade) from public.lin_ordem_entradas where ordem_item_id = i.id), 0),
                    'disp', jsonb_build_object('corte', public._lin_disponivel(i.id, 'corte'), 'costura', public._lin_disponivel(i.id, 'costura'),
                              'lavagem', public._lin_disponivel(i.id, 'lavagem'), 'passadoria', public._lin_disponivel(i.id, 'passadoria'),
                              'estoque', public._lin_disponivel(i.id, 'estoque'))) order by i.id)
                  from public.lin_ordem_itens i where i.ordem_id = o.id), '[]'),
        'envios', coalesce((select jsonb_agg((case when v_val then to_jsonb(e) else to_jsonb(e) - 'preco_peca' end) || jsonb_build_object(
                    'itens', (select jsonb_agg(to_jsonb(ei) order by ei.id) from public.lin_envio_itens ei where ei.envio_id = e.id),
                    'rolos', (select jsonb_agg(jsonb_build_object('rolo_id', er.rolo_id, 'codigo', r.codigo, 'metros', er.metros)) from public.lin_envio_rolos er join public.lin_rolos r on r.id = er.rolo_id where er.envio_id = e.id),
                    'recebimentos', (select jsonb_agg(to_jsonb(rc) order by rc.em) from public.lin_recebimentos rc where rc.envio_id = e.id)) order by e.enviado_em)
                  from public.lin_envios e where e.ordem_id = o.id), '[]'),
        'entradas', coalesce((select jsonb_agg((case when v_val then to_jsonb(en) else to_jsonb(en) - 'custo_unitario' end) order by en.em)
                  from public.lin_ordem_entradas en join public.lin_ordem_itens i on i.id = en.ordem_item_id where i.ordem_id = o.id), '[]'))
      order by o.id desc) from public.lin_ordens o), '[]'));
end $$;

-- importa os itens de uma NF-e de compra: p = {chave, numero, fornecedor, data, itens:[{item, tecido, cor, unidade, rolos, total, valor}]}
-- cada item vira "rolos" rolos iguais, com total ÷ rolos em cada um e o valor do item dividido entre eles
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
    v_res := v_res || public.lin_rolo_comprar(jsonb_build_object('tecido', it ->> 'tecido', 'cor', it ->> 'cor', 'unidade', it ->> 'unidade',
      'quantidade', v_rolos, 'metros', round(v_total / v_rolos, 2), 'valor_pago', it ->> 'valor', 'data_compra', p ->> 'data',
      'fornecedor', p ->> 'fornecedor', 'nota', p ->> 'numero', 'nfe_chave', p ->> 'chave', 'nfe_item', it ->> 'item',
      'observacoes', 'Importado do XML da NF-e ' || coalesce(p ->> 'numero', '')));
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Marque pelo menos um item da nota'; end if;
  return v_res;
end $$;
revoke execute on function public.lin_rolos_importar_nfe(jsonb) from public, anon;
grant execute on function public.lin_rolos_importar_nfe(jsonb) to authenticated;
