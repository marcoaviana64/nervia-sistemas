-- Sistema Linum 2.18: custo das peças (pedido do Marco em 29/10/2026). A dona da Linum planeja o custo de cada peça numa
-- planilha (CUSTO 2025: uma aba por peça). "Pode levar para o app Linum, só o admin e a dona podem ver; lá ela pode usar
-- como na planilha, fazer alterações etc., mas é uma forma mais fácil de ver."
--   * lin_custos = uma ficha de custo por aba da planilha (mesmos campos e mesmas contas):
--       matéria-prima por peça = preço do metro × gasto (metros por peça)
--       risco por peça        = custo do risco ÷ quantidade de peças do risco (ou o valor digitado, como em 9 abas da planilha)
--       modelagem por peça    = modelagem e pilotagem ÷ quantidade de peças do risco
--       custo total           = matéria-prima + risco + modelagem + corte + lavanderia + costura + aviamentos + passadoria
--                               + logística + comissão + pagamento/cartão/contador
--     markup = venda ÷ custo (conta da tela). "Markup alvo" e "desconto %" = simulação que algumas abas tinham.
--   * Pode ligar a ficha a uma peça do cadastro (produto_id) para comparar com o preço do sistema; não muda o cadastro.
--   * Só o Dono (inclui a equipe Nervia) lê e grava. Escrita só por lin_custo_salvar / lin_custo_excluir, auditoria
--     linum_custo_criado / _alterado / _excluido (só o que mudou). Os valores da planilha são carregados pelo SQL do
--     Supabase (dados reais não vão para o GitHub), auditoria linum_custos_carga.
--   * Entra na cópia noturna sozinha (lin_copia_fazer copia todas as tabelas public.lin_*).

create table if not exists public.lin_custos (
  id                 uuid primary key default gen_random_uuid(),
  ficha              text not null unique check (length(btrim(ficha)) > 0),   -- nome da ficha (o nome da aba na planilha)
  produto_id         uuid references public.lin_produtos on delete set null,
  referencia         text not null default '',
  descricao          text not null default '',
  versao             text not null default '',           -- ex.: "artesanal", "bordada", "infantil"
  materia            text not null default '',           -- matéria-prima (tecido)
  rascunho           boolean not null default false,     -- cópia / simulação (as abas "Cópia de …")
  qtd                numeric check (qtd >= 0),           -- quantidade de peças
  mp_metro           numeric check (mp_metro >= 0),      -- custo da matéria-prima: preço do metro
  gasto              numeric check (gasto >= 0),         -- metros por peça
  qtd_risco          numeric check (qtd_risco >= 0),     -- quantidade de peças do risco
  risco              numeric check (risco >= 0),         -- custo do risco
  risco_peca_manual  numeric check (risco_peca_manual >= 0),   -- risco por peça digitado (vazio = conta automática)
  modelagem          numeric check (modelagem >= 0),     -- modelagem e pilotagem
  corte              numeric check (corte >= 0),
  lavanderia         numeric check (lavanderia >= 0),    -- beneficiamento / lavanderia
  costura            numeric check (costura >= 0),       -- costura externa
  aviamentos         numeric check (aviamentos >= 0),
  passadoria         numeric check (passadoria >= 0),
  logistica          numeric check (logistica >= 0),
  comissao           numeric check (comissao >= 0),      -- comissão de venda (valor por peça)
  pagamento          numeric check (pagamento >= 0),     -- custo pagamento / cartão / contador
  venda              numeric check (venda >= 0),         -- valor de venda planejado
  markup_alvo        numeric check (markup_alvo >= 0),
  desconto_pct       numeric check (desconto_pct >= 0 and desconto_pct < 100),
  observacoes        text not null default '',
  origem             text not null default 'app',        -- 'app' ou 'planilha CUSTO 2025'
  -- contas (iguais às da planilha)
  mp_peca        numeric generated always as (coalesce(mp_metro, 0) * coalesce(gasto, 0)) stored,
  risco_peca     numeric generated always as (coalesce(risco_peca_manual,
                   case when coalesce(qtd_risco, 0) > 0 then coalesce(risco, 0) / qtd_risco else 0 end)) stored,
  modelagem_peca numeric generated always as (case when coalesce(qtd_risco, 0) > 0 then coalesce(modelagem, 0) / qtd_risco else 0 end) stored,
  custo          numeric generated always as (
                   coalesce(mp_metro, 0) * coalesce(gasto, 0)
                   + coalesce(risco_peca_manual, case when coalesce(qtd_risco, 0) > 0 then coalesce(risco, 0) / qtd_risco else 0 end)
                   + case when coalesce(qtd_risco, 0) > 0 then coalesce(modelagem, 0) / qtd_risco else 0 end
                   + coalesce(corte, 0) + coalesce(lavanderia, 0) + coalesce(costura, 0) + coalesce(aviamentos, 0)
                   + coalesce(passadoria, 0) + coalesce(logistica, 0) + coalesce(comissao, 0) + coalesce(pagamento, 0)) stored,
  criado_em      timestamptz not null default now(),
  criado_nome    text not null default '',
  atualizado_em  timestamptz not null default now(),
  atualizado_nome text not null default ''
);
create index if not exists lin_custos_produto on public.lin_custos (produto_id);

alter table public.lin_custos enable row level security;
revoke insert, update, delete on public.lin_custos from anon, authenticated;
revoke all on public.lin_custos from anon;
drop policy if exists lin_custos_ler on public.lin_custos;
create policy lin_custos_ler on public.lin_custos for select using (public.lin_eh_dono());

-- campos que a tela grava (o resto é conta ou controle)
create or replace function public._lin_custo_json(c public.lin_custos) returns jsonb
language sql immutable as $$
  select to_jsonb(c) - array['id', 'mp_peca', 'risco_peca', 'modelagem_peca', 'custo', 'criado_em', 'criado_nome', 'atualizado_em', 'atualizado_nome', 'origem']
$$;

-- nova (sem "id") ou edição; chave ausente na edição = mantém; devolve o id
create or replace function public.lin_custo_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; c public.lin_custos; v_antes jsonb; v_ficha text := public._lin_txt(p, 'ficha');
        v_prod uuid;
        nums text[] := array['qtd', 'mp_metro', 'gasto', 'qtd_risco', 'risco', 'risco_peca_manual', 'modelagem', 'corte', 'lavanderia',
                             'costura', 'aviamentos', 'passadoria', 'logistica', 'comissao', 'pagamento', 'venda', 'markup_alvo', 'desconto_pct'];
        rot jsonb := '{"qtd":"Quantidade de peças","mp_metro":"Preço do metro","gasto":"Gasto (metros por peça)","qtd_risco":"Peças do risco",
          "risco":"Custo do risco","risco_peca_manual":"Risco por peça","modelagem":"Modelagem e pilotagem","corte":"Corte",
          "lavanderia":"Lavanderia","costura":"Costura","aviamentos":"Aviamentos","passadoria":"Passadoria","logistica":"Logística",
          "comissao":"Comissão","pagamento":"Pagamento / cartão / contador","venda":"Valor de venda","markup_alvo":"Markup alvo","desconto_pct":"Desconto %"}';
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera os custos'; end if;
  if v_id is null then
    if v_ficha is null then raise exception 'Dê um nome à ficha (ex.: a referência da peça)'; end if;
    if exists (select 1 from public.lin_custos where lower(ficha) = lower(v_ficha)) then raise exception 'Já existe uma ficha com o nome %', v_ficha; end if;
    insert into public.lin_custos (ficha, criado_nome, atualizado_nome) values (v_ficha, public._lin_nome(), public._lin_nome())
    returning * into c;
    v_id := c.id;
  else
    select * into c from public.lin_custos where id = v_id for update;
    if not found then raise exception 'Ficha de custo não encontrada'; end if;
    v_antes := public._lin_custo_json(c);
    if p ? 'ficha' then
      if v_ficha is null then raise exception 'Dê um nome à ficha (ex.: a referência da peça)'; end if;
      c.ficha := v_ficha;
    end if;
  end if;
  if exists (select 1 from public.lin_custos where lower(ficha) = lower(c.ficha) and id <> v_id) then
    raise exception 'Já existe uma ficha com o nome %', c.ficha;
  end if;
  if p ? 'produto_id' then
    v_prod := nullif(p ->> 'produto_id', '')::uuid;
    if v_prod is not null and not exists (select 1 from public.lin_produtos where id = v_prod) then raise exception 'Peça não encontrada no cadastro'; end if;
    c.produto_id := v_prod;
  end if;
  if p ? 'referencia' then c.referencia := coalesce(public._lin_txt(p, 'referencia'), ''); end if;
  if p ? 'descricao' then c.descricao := coalesce(public._lin_txt(p, 'descricao'), ''); end if;
  if p ? 'versao' then c.versao := coalesce(public._lin_txt(p, 'versao'), ''); end if;
  if p ? 'materia' then c.materia := coalesce(public._lin_txt(p, 'materia'), ''); end if;
  if p ? 'observacoes' then c.observacoes := coalesce(public._lin_txt(p, 'observacoes'), ''); end if;
  if p ? 'rascunho' then c.rascunho := coalesce((p ->> 'rascunho')::boolean, false); end if;
  c := jsonb_populate_record(c, (select coalesce(jsonb_object_agg(k2, public._lin_num(p, k2, rot ->> k2)), '{}'::jsonb)
                                   from unnest(nums) k2 where p ? k2));
  if c.desconto_pct >= 100 then raise exception 'O desconto tem de ser menor que 100%%'; end if;
  update public.lin_custos set ficha = c.ficha, produto_id = c.produto_id, referencia = c.referencia, descricao = c.descricao,
         versao = c.versao, materia = c.materia, rascunho = c.rascunho, observacoes = c.observacoes,
         qtd = c.qtd, mp_metro = c.mp_metro, gasto = c.gasto, qtd_risco = c.qtd_risco, risco = c.risco, risco_peca_manual = c.risco_peca_manual,
         modelagem = c.modelagem, corte = c.corte, lavanderia = c.lavanderia, costura = c.costura, aviamentos = c.aviamentos,
         passadoria = c.passadoria, logistica = c.logistica, comissao = c.comissao, pagamento = c.pagamento, venda = c.venda,
         markup_alvo = c.markup_alvo, desconto_pct = c.desconto_pct,
         atualizado_em = now(), atualizado_nome = public._lin_nome()
   where id = v_id returning * into c;
  if v_antes is null then
    perform public._lin_auditar('linum_custo_criado', null, jsonb_build_object('custo_id', v_id, 'ficha', c.ficha, 'custo', round(c.custo, 2))
      || jsonb_build_object('depois', public._lin_custo_json(c)));
  else
    perform public._lin_auditar('linum_custo_alterado', null, jsonb_build_object('custo_id', v_id, 'ficha', c.ficha, 'custo', round(c.custo, 2),
      'antes', v_antes, 'depois', public._lin_custo_json(c)));
  end if;
  return v_id;
end $$;

create or replace function public.lin_custo_excluir(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.lin_custos;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera os custos'; end if;
  delete from public.lin_custos where id = p_id returning * into c;
  if not found then raise exception 'Ficha de custo não encontrada'; end if;
  perform public._lin_auditar('linum_custo_excluido', null, jsonb_build_object('custo_id', c.id, 'ficha', c.ficha,
    'referencia', c.referencia, 'descricao', c.descricao, 'custo', round(c.custo, 2), 'ficha_excluida', public._lin_custo_json(c)));
end $$;

revoke execute on function public._lin_custo_json(public.lin_custos) from public, anon, authenticated;
revoke execute on function public.lin_custo_salvar(jsonb) from public, anon;
revoke execute on function public.lin_custo_excluir(uuid) from public, anon;
grant execute on function public.lin_custo_salvar(jsonb) to authenticated;
grant execute on function public.lin_custo_excluir(uuid) to authenticated;
