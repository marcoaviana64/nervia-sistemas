-- Sistema Linum 2.38 — BENEFICIAMENTO (pedido do Marco em 09/11/2026):
--   "temos a saída do produto para beneficiamento, podendo virar no retorno da peça um produto especial.
--    O produto é retirado da loja e enviado para beneficiamento."
-- Decisões do Marco (09/11/2026):
--   * Só o Dono e o Estoque enviam e registram o retorno (lin_controla_estoque()); toda a equipe vê o que está fora.
--   * O que a peça vira é decidido na VOLTA (no envio só se diz o serviço: bordado, tingimento, estampa…).
--   * Na volta, a peça pode virar uma peça especial que já existe ou uma nova (a tela cria pela lin_variante_salvar).
--   * O valor pago ao beneficiador é só registrado (por peça); NÃO mexe no custo nem no preço da peça — o preço/custo
--     da peça especial é acertado depois, no cadastro, como já é feito.
-- Regras:
--   * Envio: as peças SAEM da loja na hora (movimento benef_envio) e ficam "no beneficiamento".
--   * Retorno (pode ser em partes, peça por peça): "igual" = volta na mesma variação; "outra" = vira outra variação da
--     MESMA peça (peça especial, ou outra cor no tingimento); "perda" = não volta (motivo obrigatório; sem movimento,
--     a peça já tinha saído). Volta para qualquer loja (padrão = a de origem): movimento benef_retorno.
--     Quando todas as peças voltaram ou foram perdidas, o beneficiamento fica concluído.
--   * Valor por peça (lin_benef_valores): só quem tem "Valores da produção" (e o Dono) lê e grava; a vendedora e o
--     Estoque não veem. Pode ser informado no envio ou depois (lin_beneficiamento_valores, com antes/depois).
--   * Retornos SOMENTE INCLUSÃO; nada se apaga; concluído não muda.
--   * Auditoria: linum_beneficiamento_enviado / retorno / valor.
-- Só acrescenta tabelas, uma coluna com padrão nulo e tipos de movimento: nenhum dado existente muda.

create table if not exists public.lin_beneficiamentos (
  id            bigint generated always as identity primary key,
  loja_id       uuid not null references public.lin_lojas,          -- de onde as peças saíram
  beneficiador  text not null,
  servico       text not null,
  previsto      date,                                               -- volta prevista (opcional)
  observacao    text not null default '',
  situacao      text not null default 'no_beneficiamento' check (situacao in ('no_beneficiamento', 'concluido')),
  enviado_por   uuid references auth.users on delete set null,
  enviado_nome  text not null default '',
  enviado_em    timestamptz not null default now(),
  concluido_em  timestamptz
);
create index if not exists lin_beneficiamentos_situacao on public.lin_beneficiamentos (situacao, enviado_em desc);

create table if not exists public.lin_benef_itens (
  id                bigint generated always as identity primary key,
  beneficiamento_id bigint not null references public.lin_beneficiamentos on delete cascade,
  variante_id       uuid not null references public.lin_variantes,
  quantidade        int not null check (quantidade > 0),
  voltaram          int not null default 0 check (voltaram >= 0),
  perdidas          int not null default 0 check (perdidas >= 0),
  -- cópia da etiqueta no envio
  referencia        text not null default '',
  descricao         text not null default '',
  cor               text not null default '',
  tamanho           text not null default '',
  edicao            text not null default '',
  check (voltaram + perdidas <= quantidade),
  unique (beneficiamento_id, variante_id)
);
create index if not exists lin_benef_itens_b on public.lin_benef_itens (beneficiamento_id);

-- cada retorno (ou perda) registrado; SOMENTE INCLUSÃO
create table if not exists public.lin_benef_retornos (
  id                bigint generated always as identity primary key,
  beneficiamento_id bigint not null references public.lin_beneficiamentos,
  item_id           bigint not null references public.lin_benef_itens,
  resultado         text not null check (resultado in ('igual', 'outra', 'perda')),
  quantidade        int not null check (quantidade > 0),
  variante_id       uuid references public.lin_variantes,          -- em que a peça voltou (vazio na perda)
  loja_id           uuid references public.lin_lojas,              -- loja em que entrou (vazio na perda)
  cor               text not null default '',                      -- cópia da etiqueta de como voltou
  tamanho           text not null default '',
  edicao            text not null default '',
  motivo            text not null default '',
  criado_por        uuid references auth.users on delete set null,
  criado_nome       text not null default '',
  criado_em         timestamptz not null default now(),
  check ((resultado = 'perda') = (variante_id is null)),
  check ((resultado = 'perda') = (loja_id is null))
);
create index if not exists lin_benef_retornos_b on public.lin_benef_retornos (beneficiamento_id);

-- valor pago ao beneficiador por peça (só registro; não entra no custo da peça)
create table if not exists public.lin_benef_valores (
  item_id         bigint primary key references public.lin_benef_itens on delete cascade,
  valor_unitario  numeric(12,2) not null check (valor_unitario >= 0),
  atualizado_por  uuid references auth.users on delete set null,
  atualizado_nome text not null default '',
  atualizado_em   timestamptz not null default now()
);

-- nada se apaga; concluído não muda; retornos nunca mudam
create or replace function public.lin_benef_imutavel() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'lin_benef_retornos' then raise exception 'Retornos do beneficiamento não podem ser alterados nem apagados'; end if;
  if tg_op = 'DELETE' then raise exception 'Beneficiamentos não podem ser apagados'; end if;
  -- (ifs aninhados: o plpgsql resolve old.<campo> mesmo do lado do "and" que não seria avaliado)
  if tg_table_name = 'lin_beneficiamentos' then
    if old.situacao = 'concluido' then raise exception 'Este beneficiamento já foi concluído e não pode mudar'; end if;
  else
    if new.variante_id <> old.variante_id or new.quantidade <> old.quantidade or new.voltaram < old.voltaram or new.perdidas < old.perdidas then
      raise exception 'As peças enviadas ao beneficiamento não podem ser alteradas';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists lin_beneficiamentos_imutavel on public.lin_beneficiamentos;
create trigger lin_beneficiamentos_imutavel before update or delete on public.lin_beneficiamentos
  for each row execute function public.lin_benef_imutavel();
drop trigger if exists lin_benef_itens_imutavel on public.lin_benef_itens;
create trigger lin_benef_itens_imutavel before update or delete on public.lin_benef_itens
  for each row execute function public.lin_benef_imutavel();
drop trigger if exists lin_benef_retornos_imutavel on public.lin_benef_retornos;
create trigger lin_benef_retornos_imutavel before update or delete on public.lin_benef_retornos
  for each row execute function public.lin_benef_imutavel();

alter table public.lin_beneficiamentos enable row level security;
alter table public.lin_benef_itens     enable row level security;
alter table public.lin_benef_retornos  enable row level security;
alter table public.lin_benef_valores   enable row level security;
-- toda a equipe vê o que está no beneficiamento (sem valor); o valor só com "Valores da produção" (Dono incluído)
drop policy if exists lin_beneficiamentos_ler on public.lin_beneficiamentos;
create policy lin_beneficiamentos_ler on public.lin_beneficiamentos for select using (public.lin_papel() is not null);
drop policy if exists lin_benef_itens_ler on public.lin_benef_itens;
create policy lin_benef_itens_ler on public.lin_benef_itens for select using (public.lin_papel() is not null);
drop policy if exists lin_benef_retornos_ler on public.lin_benef_retornos;
create policy lin_benef_retornos_ler on public.lin_benef_retornos for select using (public.lin_papel() is not null);
drop policy if exists lin_benef_valores_ler on public.lin_benef_valores;
create policy lin_benef_valores_ler on public.lin_benef_valores for select using (public.lin_pode('producao_valores'));
revoke all on public.lin_beneficiamentos, public.lin_benef_itens, public.lin_benef_retornos, public.lin_benef_valores from anon, authenticated;
grant select on public.lin_beneficiamentos, public.lin_benef_itens, public.lin_benef_retornos, public.lin_benef_valores to authenticated;

-- movimentos ligados ao beneficiamento
alter table public.lin_movimentos add column if not exists beneficiamento_id bigint references public.lin_beneficiamentos;
alter table public.lin_movimentos drop constraint if exists lin_movimentos_tipo_check;
alter table public.lin_movimentos add constraint lin_movimentos_tipo_check
  check (tipo in ('entrada', 'saida', 'transferencia', 'ajuste', 'venda', 'devolucao', 'producao',
                  'transf_envio', 'transf_recebida', 'transf_retorno', 'benef_envio', 'benef_retorno'));

-- resumo das peças para a auditoria (com valor só para quem pode ver)
create or replace function public._lin_benef_resumo(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('referencia', i.referencia, 'peca', i.descricao, 'cor', i.cor, 'tamanho', i.tamanho,
           'edicao', i.edicao, 'quantidade', i.quantidade, 'voltaram', i.voltaram, 'perdidas', i.perdidas)
           || case when public.lin_pode('producao_valores') and v.item_id is not null then jsonb_build_object('valor_unitario', v.valor_unitario) else '{}'::jsonb end
           order by i.id), '[]')
    from public.lin_benef_itens i left join public.lin_benef_valores v on v.item_id = i.id where i.beneficiamento_id = p_id
$$;
revoke execute on function public._lin_benef_resumo(bigint) from public, anon, authenticated;

create or replace function public._lin_valor_txt(x jsonb) returns numeric
language plpgsql immutable as $$
declare t text;
begin
  if x is null or jsonb_typeof(x) = 'null' then return null; end if;
  t := trim(both '"' from x::text);
  if t = '' then return null; end if;
  if t !~ '^\d+(\.\d{1,2})?$' then raise exception 'Valor pago inválido: %', t; end if;
  return t::numeric;
end $$;
revoke execute on function public._lin_valor_txt(jsonb) from public, anon, authenticated;

-- envio: p = {loja, beneficiador, servico, previsto, observacao, itens: [{variante_id, quantidade, valor_unitario?}]}
create or replace function public.lin_beneficiamento_enviar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_loja uuid := nullif(p ->> 'loja', '')::uuid;
  v_benef text := left(coalesce(trim(p ->> 'beneficiador'), ''), 120);
  v_serv text := left(coalesce(trim(p ->> 'servico'), ''), 200);
  v_prev date := nullif(p ->> 'previsto', '')::date;
  v_obs text := left(coalesce(trim(p ->> 'observacao'), ''), 300);
  v_valores boolean := public.lin_pode('producao_valores');
  v_id bigint; v_item bigint; r record; v_disp int; v_total int := 0; v_val numeric; v_soma numeric := 0;
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque envia peças para o beneficiamento'; end if;
  if v_loja is null or not exists (select 1 from public.lin_lojas where id = v_loja) then raise exception 'Escolha a loja de onde as peças saem'; end if;
  if length(v_benef) < 2 then raise exception 'Informe quem vai fazer o beneficiamento'; end if;
  if length(v_serv) < 3 then raise exception 'Informe o serviço (ex.: bordado, tingimento, estampa)'; end if;
  if v_prev is not null and v_prev < public._lin_hoje() then raise exception 'A volta prevista não pode ser antes de hoje'; end if;
  if jsonb_typeof(p -> 'itens') <> 'array' or jsonb_array_length(p -> 'itens') = 0 then raise exception 'Escolha as peças do beneficiamento'; end if;
  if jsonb_array_length(p -> 'itens') > 300 then raise exception 'No máximo 300 variações por envio'; end if;

  insert into public.lin_beneficiamentos (loja_id, beneficiador, servico, previsto, observacao, enviado_por, enviado_nome)
  values (v_loja, v_benef, v_serv, v_prev, v_obs, auth.uid(), public._lin_nome()) returning id into v_id;

  -- a mesma variação repetida soma (o valor é o primeiro informado)
  for r in select (x ->> 'variante_id')::uuid as variante_id, sum((x ->> 'quantidade')::int) as q,
                  (array_agg(x -> 'valor_unitario') filter (where coalesce(x ->> 'valor_unitario', '') <> ''))[1] as valor
             from jsonb_array_elements(p -> 'itens') x group by 1 order by 1 loop
    if r.variante_id is null or coalesce(r.q, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero em cada peça'; end if;
    if not exists (select 1 from public.lin_variantes where id = r.variante_id) then raise exception 'Variação não encontrada'; end if;
    select quantidade into v_disp from public.lin_estoque where variante_id = r.variante_id and loja_id = v_loja for update;
    if coalesce(v_disp, 0) < r.q then
      raise exception 'Estoque insuficiente em %: % tem % peça(s) e o envio pede %', public._lin_loja(v_loja),
        (select p2.descricao || ' ' || concat_ws(' ', nullif(v.cor, ''), nullif(v.tamanho, ''), nullif(v.edicao, ''))
           from public.lin_variantes v join public.lin_produtos p2 on p2.id = v.produto_id where v.id = r.variante_id),
        coalesce(v_disp, 0), r.q;
    end if;
    update public.lin_estoque set quantidade = quantidade - r.q, atualizado_em = now()
      where variante_id = r.variante_id and loja_id = v_loja;
    insert into public.lin_benef_itens (beneficiamento_id, variante_id, quantidade, referencia, descricao, cor, tamanho, edicao)
    select v_id, v.id, r.q, coalesce(p2.referencia, ''), coalesce(p2.descricao, ''), coalesce(v.cor, ''), coalesce(v.tamanho, ''), coalesce(v.edicao, '')
      from public.lin_variantes v join public.lin_produtos p2 on p2.id = v.produto_id where v.id = r.variante_id
    returning id into v_item;
    v_val := public._lin_valor_txt(r.valor);
    if v_val is not null then
      if not v_valores then raise exception 'Seu login não registra valores do beneficiamento'; end if;
      insert into public.lin_benef_valores (item_id, valor_unitario, atualizado_por, atualizado_nome) values (v_item, v_val, auth.uid(), public._lin_nome());
      v_soma := v_soma + v_val * r.q;
    end if;
    insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, data, observacao, criado_por, criado_nome, beneficiamento_id)
    values (r.variante_id, v_loja, 'benef_envio', r.q, public._lin_hoje(),
            format('Beneficiamento nº %s (%s) com %s', v_id, v_serv, v_benef) || case when v_obs <> '' then ' · ' || v_obs else '' end,
            auth.uid(), public._lin_nome(), v_id);
    v_total := v_total + r.q;
  end loop;

  perform public._lin_auditar('linum_beneficiamento_enviado', null, jsonb_build_object('beneficiamento', v_id,
    'loja', public._lin_loja(v_loja), 'beneficiador', v_benef, 'servico', v_serv, 'previsto', v_prev, 'pecas', v_total,
    'observacao', v_obs, 'itens', public._lin_benef_resumo(v_id))
    || case when v_valores and v_soma > 0 then jsonb_build_object('valor_total', v_soma) else '{}'::jsonb end);
  return v_id;
end $$;

-- retorno: p = {loja, observacao, itens: [{item_id, resultado igual|outra|perda, quantidade, variante_id (outra), motivo (perda)}]}
-- devolve a situação ('no_beneficiamento' enquanto faltar peça; 'concluido')
create or replace function public.lin_beneficiamento_retorno(p_id bigint, p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  b public.lin_beneficiamentos; it public.lin_benef_itens; x jsonb; v_res text; v_q int; v_var uuid; v_mot text;
  v_loja uuid := nullif(p ->> 'loja', '')::uuid; v_obs text := left(coalesce(trim(p ->> 'observacao'), ''), 300);
  vv public.lin_variantes; v_prod uuid; v_volt int := 0; v_perd int := 0; v_sit text; v_pend int; v_desc text;
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque registra o retorno do beneficiamento'; end if;
  select * into b from public.lin_beneficiamentos where id = p_id for update;
  if not found then raise exception 'Beneficiamento não encontrado'; end if;
  if b.situacao <> 'no_beneficiamento' then raise exception 'Este beneficiamento já foi concluído'; end if;
  v_loja := coalesce(v_loja, b.loja_id);
  if not exists (select 1 from public.lin_lojas where id = v_loja) then raise exception 'Loja não encontrada'; end if;
  if jsonb_typeof(p -> 'itens') <> 'array' or jsonb_array_length(p -> 'itens') = 0 then raise exception 'Informe as peças que voltaram'; end if;

  for x in select * from jsonb_array_elements(p -> 'itens') loop
    v_res := coalesce(x ->> 'resultado', ''); v_q := nullif(x ->> 'quantidade', '')::int;
    v_mot := left(coalesce(trim(x ->> 'motivo'), ''), 300);
    select * into it from public.lin_benef_itens where id = nullif(x ->> 'item_id', '')::bigint and beneficiamento_id = p_id for update;
    if it.id is null then raise exception 'Peça não pertence a este beneficiamento'; end if;
    v_desc := it.descricao || ' ' || concat_ws(' ', nullif(it.cor, ''), nullif(it.tamanho, ''), nullif(it.edicao, ''));
    if v_res not in ('igual', 'outra', 'perda') then raise exception 'Diga como a peça voltou (igual, outra variação ou perdida)'; end if;
    if coalesce(v_q, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero (%)', v_desc; end if;
    v_pend := it.quantidade - it.voltaram - it.perdidas;
    if v_q > v_pend then raise exception '%: só % peça(s) ainda estão no beneficiamento', v_desc, v_pend; end if;

    if v_res = 'perda' then
      if length(v_mot) < 5 then raise exception 'Escreva o motivo da perda de % (pelo menos 5 letras)', v_desc; end if;
      update public.lin_benef_itens set perdidas = perdidas + v_q where id = it.id;
      insert into public.lin_benef_retornos (beneficiamento_id, item_id, resultado, quantidade, motivo, criado_por, criado_nome)
      values (p_id, it.id, 'perda', v_q, v_mot, auth.uid(), public._lin_nome());
      v_perd := v_perd + v_q;
      continue;
    end if;

    if v_res = 'igual' then v_var := it.variante_id;
    else
      v_var := nullif(x ->> 'variante_id', '')::uuid;
      select produto_id into v_prod from public.lin_variantes where id = it.variante_id;
      select * into vv from public.lin_variantes where id = v_var;
      if vv.id is null then raise exception 'Escolha em que peça % se transformou', v_desc; end if;
      if vv.produto_id <> v_prod then raise exception 'A peça que voltou tem de ser uma variação da mesma peça (%)', it.descricao; end if;
      if vv.id = it.variante_id then raise exception 'Para voltar na mesma variação, escolha "voltou igual" (%)', v_desc; end if;
    end if;
    select * into vv from public.lin_variantes where id = v_var;
    update public.lin_benef_itens set voltaram = voltaram + v_q where id = it.id;
    insert into public.lin_benef_retornos (beneficiamento_id, item_id, resultado, quantidade, variante_id, loja_id, cor, tamanho, edicao, motivo, criado_por, criado_nome)
    values (p_id, it.id, v_res, v_q, v_var, v_loja, coalesce(vv.cor, ''), coalesce(vv.tamanho, ''), coalesce(vv.edicao, ''), v_mot, auth.uid(), public._lin_nome());
    insert into public.lin_estoque (variante_id, loja_id, quantidade) values (v_var, v_loja, v_q)
    on conflict (variante_id, loja_id) do update set quantidade = lin_estoque.quantidade + excluded.quantidade, atualizado_em = now();
    insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, data, observacao, criado_por, criado_nome, beneficiamento_id)
    values (v_var, v_loja, 'benef_retorno', v_q, public._lin_hoje(),
            format('Beneficiamento nº %s (%s) voltou de %s', p_id, b.servico, b.beneficiador)
              || case when v_res = 'outra' then format(' · era %s', v_desc) else '' end
              || case when v_obs <> '' then ' · ' || v_obs else '' end,
            auth.uid(), public._lin_nome(), p_id);
    v_volt := v_volt + v_q;
  end loop;

  v_sit := case when exists (select 1 from public.lin_benef_itens where beneficiamento_id = p_id and voltaram + perdidas < quantidade)
                then 'no_beneficiamento' else 'concluido' end;
  if v_sit = 'concluido' then update public.lin_beneficiamentos set situacao = 'concluido', concluido_em = now() where id = p_id; end if;

  perform public._lin_auditar('linum_beneficiamento_retorno', null, jsonb_build_object('beneficiamento', p_id,
    'loja_origem', public._lin_loja(b.loja_id), 'loja_retorno', public._lin_loja(v_loja), 'beneficiador', b.beneficiador, 'servico', b.servico,
    'voltaram', v_volt, 'perdidas', v_perd, 'situacao', v_sit, 'observacao', v_obs,
    'retornos', (select jsonb_agg(jsonb_build_object('peca', i.descricao, 'enviada', concat_ws(' ', nullif(i.cor, ''), nullif(i.tamanho, ''), nullif(i.edicao, '')),
                   'resultado', r.resultado, 'quantidade', r.quantidade, 'voltou_como', concat_ws(' ', nullif(r.cor, ''), nullif(r.tamanho, ''), nullif(r.edicao, '')),
                   'motivo', nullif(r.motivo, '')) order by r.id)
                   from public.lin_benef_retornos r join public.lin_benef_itens i on i.id = r.item_id
                  where r.beneficiamento_id = p_id and r.criado_em = now())));
  return v_sit;
end $$;

-- valor pago por peça (informar ou corrigir depois): itens = [{item_id, valor_unitario (vazio = tira)}]
create or replace function public.lin_beneficiamento_valores(p_id bigint, p_itens jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare x jsonb; it public.lin_benef_itens; v_val numeric; v_antes jsonb; v_depois jsonb;
begin
  if not public.lin_pode('producao_valores') then raise exception 'Seu login não registra valores do beneficiamento'; end if;
  if not exists (select 1 from public.lin_beneficiamentos where id = p_id) then raise exception 'Beneficiamento não encontrado'; end if;
  if jsonb_typeof(p_itens) <> 'array' then raise exception 'Lista de valores inválida'; end if;
  select coalesce(jsonb_object_agg(i.id::text, v.valor_unitario), '{}') into v_antes
    from public.lin_benef_itens i join public.lin_benef_valores v on v.item_id = i.id where i.beneficiamento_id = p_id;
  for x in select * from jsonb_array_elements(p_itens) loop
    select * into it from public.lin_benef_itens where id = nullif(x ->> 'item_id', '')::bigint and beneficiamento_id = p_id;
    if it.id is null then raise exception 'Peça não pertence a este beneficiamento'; end if;
    v_val := public._lin_valor_txt(x -> 'valor_unitario');
    if v_val is null then delete from public.lin_benef_valores where item_id = it.id;
    else
      insert into public.lin_benef_valores (item_id, valor_unitario, atualizado_por, atualizado_nome) values (it.id, v_val, auth.uid(), public._lin_nome())
      on conflict (item_id) do update set valor_unitario = excluded.valor_unitario, atualizado_por = excluded.atualizado_por,
        atualizado_nome = excluded.atualizado_nome, atualizado_em = now()
      where lin_benef_valores.valor_unitario is distinct from excluded.valor_unitario;
    end if;
  end loop;
  select coalesce(jsonb_object_agg(i.id::text, v.valor_unitario), '{}') into v_depois
    from public.lin_benef_itens i join public.lin_benef_valores v on v.item_id = i.id where i.beneficiamento_id = p_id;
  perform public._lin_auditar('linum_beneficiamento_valor', null, jsonb_build_object('beneficiamento', p_id,
    'antes', v_antes, 'depois', v_depois, 'itens', public._lin_benef_resumo(p_id)));
end $$;

revoke execute on function public.lin_beneficiamento_enviar(jsonb) from public, anon;
revoke execute on function public.lin_beneficiamento_retorno(bigint, jsonb) from public, anon;
revoke execute on function public.lin_beneficiamento_valores(bigint, jsonb) from public, anon;
grant execute on function public.lin_beneficiamento_enviar(jsonb) to authenticated;
grant execute on function public.lin_beneficiamento_retorno(bigint, jsonb) to authenticated;
grant execute on function public.lin_beneficiamento_valores(bigint, jsonb) to authenticated;
