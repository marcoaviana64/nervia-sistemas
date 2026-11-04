-- Tabela de preços dos apps da Plataforma Nervia (pedido do Marco em 04/11/2026).
-- Régua INTERNA: cada item tem um percentual do salário mínimo; o preço cobrado é sempre um valor em reais
-- aprovado pela Nervia. Quando o salário mínimo muda, a tela mostra o preço sugerido e o Marco aprova (ou não);
-- nada muda sozinho. Contrato e cliente veem só o valor em reais (a vinculação ao salário mínimo é vedada pela
-- Constituição, art. 7º, IV; reajuste de contrato, Lei 10.192/2001: anual) — revisar a cláusula com o advogado.
-- Por enquanto só a equipe Nervia lê (decisão do Marco: sem preço público e sem cobrança até ele liberar).
-- Prefixo: preco_ / salario_minimo (comuns a todos os apps, como perfis e apps).

-- ------------------------------------------------------------------ salário mínimo (histórico)
create table if not exists public.salario_minimo (
  vigencia   date primary key,                      -- vale a partir deste dia
  valor      numeric(10,2) not null check (valor > 0),
  fonte      text not null default '',              -- decreto / lei
  criado_em  timestamptz not null default now()
);
alter table public.salario_minimo enable row level security;
drop policy if exists salario_minimo_ler on public.salario_minimo;
create policy salario_minimo_ler on public.salario_minimo for select using (public.eh_admin());
revoke insert, update, delete on public.salario_minimo from anon, authenticated;   -- só pela rpc

insert into public.salario_minimo (vigencia, valor, fonte)
values ('2025-01-01', 1518.00, 'Decreto 12.342/2024'),
       ('2026-01-01', 1621.00, 'Decreto 12.797/2025 (DOU 24/12/2025)')
on conflict (vigencia) do nothing;

-- salário mínimo em vigor numa data (padrão: hoje em Brasília)
create or replace function public.salario_minimo_em(p_data date default null)
returns numeric language sql stable security definer set search_path = public as $$
  select valor from public.salario_minimo
   where vigencia <= coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date)
   order by vigencia desc limit 1
$$;
revoke execute on function public.salario_minimo_em(date) from public, anon;
grant execute on function public.salario_minimo_em(date) to authenticated;

-- arredondamento comercial: múltiplo de R$ 5 mais próximo, menos R$ 0,10 (40,53 → 39,90; 97,26 → 94,90); mínimo 4,90
create or replace function public.preco_arredondar(p numeric)
returns numeric language sql immutable as $$
  select greatest(round(p / 5) * 5, 5) - 0.10
$$;

-- ------------------------------------------------------------------ itens de preço
-- Um app pode ter mais de um item (ex.: Buscador sozinho e o pacote Buscador + Painel; Compras e Oportunidades).
create table if not exists public.preco_itens (
  id             text primary key check (id ~ '^[a-z0-9-]+$'),
  app_id         text references public.apps on delete set null on update cascade,
  nome           text not null,
  unidade        text not null default '',          -- "CNPJ / mês", "TV / mês", "por relatório"
  cobranca       text not null default 'mensal' check (cobranca in ('mensal', 'avulso', 'incluido', 'negociar')),
  modo           text not null default 'percentual' check (modo in ('percentual', 'fixo')),
  percentual     numeric(6,3) check (percentual is null or (percentual > 0 and percentual <= 100)),
  valor          numeric(10,2) check (valor is null or valor >= 0),   -- preço APROVADO em reais (o que se cobra)
  valor_desde    date,
  sm_referencia  numeric(10,2),                     -- salário mínimo usado quando o valor foi aprovado
  obs            text not null default '',
  ordem          int not null default 0,
  ativo          boolean not null default true,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text,
  check (cobranca in ('incluido', 'negociar') or valor is not null),
  check (modo = 'fixo' or cobranca in ('incluido', 'negociar') or percentual is not null)
);
alter table public.preco_itens enable row level security;
drop policy if exists preco_itens_ler on public.preco_itens;
create policy preco_itens_ler on public.preco_itens for select using (public.eh_admin());
revoke insert, update, delete on public.preco_itens from anon, authenticated;      -- só pelas rpcs

-- histórico: SOMENTE INCLUSÃO, gravado por gatilho em qualquer mudança de preço
create table if not exists public.preco_historico (
  id          bigint generated always as identity primary key,
  item_id     text not null,
  em          timestamptz not null default now(),
  quem        text,
  motivo      text not null default '',
  antes       jsonb,
  depois      jsonb
);
create index if not exists preco_historico_item on public.preco_historico (item_id, em desc);
alter table public.preco_historico enable row level security;
drop policy if exists preco_historico_ler on public.preco_historico;
create policy preco_historico_ler on public.preco_historico for select using (public.eh_admin());
revoke insert, update, delete on public.preco_historico from anon, authenticated;

create or replace function public.preco_historico_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'O histórico de preços é somente inclusão: não pode ser alterado nem apagado.';
end $$;
drop trigger if exists preco_historico_sem_alteracao on public.preco_historico;
create trigger preco_historico_sem_alteracao before update or delete on public.preco_historico
  for each row execute function public.preco_historico_imutavel();

create or replace function public.preco_itens_registrar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_campos text[] := array['nome','unidade','cobranca','modo','percentual','valor','valor_desde','sm_referencia','obs','ativo','app_id'];
  v_antes jsonb; v_depois jsonb; v_a jsonb := '{}'; v_d jsonb := '{}'; c text;
  v_motivo text := coalesce(nullif(current_setting('preco.motivo', true), ''), 'alterado');
begin
  v_depois := to_jsonb(new);
  if tg_op = 'UPDATE' then
    v_antes := to_jsonb(old);
    foreach c in array v_campos loop
      if v_antes->c is distinct from v_depois->c then
        v_a := v_a || jsonb_build_object(c, v_antes->c); v_d := v_d || jsonb_build_object(c, v_depois->c);
      end if;
    end loop;
    if v_d = '{}'::jsonb then return new; end if;
  else
    v_a := null;
    select jsonb_object_agg(k, v_depois->k) into v_d from unnest(v_campos) k;
  end if;
  insert into public.preco_historico (item_id, quem, motivo, antes, depois)
  values (new.id, coalesce(new.atualizado_por, 'sistema'), v_motivo, v_a, v_d);
  perform public.auditar(case when tg_op = 'INSERT' then 'preco_criado' else 'preco_alterado' end, null,
    jsonb_build_object('item', new.id, 'nome', new.nome, 'motivo', v_motivo, 'antes', v_a, 'depois', v_d));
  return new;
end $$;
drop trigger if exists preco_itens_hist on public.preco_itens;
create trigger preco_itens_hist after insert or update on public.preco_itens
  for each row execute function public.preco_itens_registrar();

-- ------------------------------------------------------------------ leitura para a tela (admin)
-- Cada item com o salário mínimo de hoje, o valor que o percentual dá hoje (sugerido) e se há reajuste a aprovar.
create or replace function public.precos_lista()
returns table (id text, app_id text, nome text, unidade text, cobranca text, modo text, percentual numeric,
               valor numeric, valor_desde date, sm_referencia numeric, obs text, ordem int, ativo boolean,
               atualizado_em timestamptz, atualizado_por text, sm_atual numeric, sugerido numeric,
               percentual_efetivo numeric, reajuste boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_sm numeric := public.salario_minimo_em(null);
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia vê os preços.'; end if;
  return query
  select i.id, i.app_id, i.nome, i.unidade, i.cobranca, i.modo, i.percentual, i.valor, i.valor_desde, i.sm_referencia,
         i.obs, i.ordem, i.ativo, i.atualizado_em, i.atualizado_por, v_sm,
         case when i.modo = 'percentual' and i.percentual is not null then public.preco_arredondar(v_sm * i.percentual / 100) end,
         case when i.valor is not null and v_sm > 0 then round(i.valor / v_sm * 100, 3) end,
         (i.ativo and i.modo = 'percentual' and i.percentual is not null and i.cobranca in ('mensal', 'avulso')
          and i.valor is distinct from public.preco_arredondar(v_sm * i.percentual / 100))
    from public.preco_itens i
   order by i.ordem, i.nome;
end $$;
revoke execute on function public.precos_lista() from public, anon;
grant execute on function public.precos_lista() to authenticated;

-- ------------------------------------------------------------------ escrita (admin)
-- Salvar um item: p = {id, nome?, app_id?, unidade?, cobranca?, modo?, percentual?, valor?, obs?, ordem?, ativo?, vale_desde?}
-- chave ausente = mantém. Modo percentual: quando o percentual (ou a régua) muda, o valor vem do percentual × salário
-- mínimo de hoje (arredondado); mudar só nome/obs mantém o valor aprovado (reajuste só pela aprovação). "valor"
-- preenchido = ajuste à mão, fica como aprovado. Modo fixo: valor digitado.
create or replace function public.preco_salvar(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_id text := lower(trim(coalesce(p->>'id', '')));
  v_old public.preco_itens; v_new public.preco_itens;
  v_sm numeric := public.salario_minimo_em(null);
  v_quem text; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia altera os preços.'; end if;
  if v_id !~ '^[a-z0-9-]+$' then raise exception 'Código do item inválido (use letras minúsculas, números e hífen).'; end if;
  select coalesce(nullif(nome, ''), email) into v_quem from public.perfis where user_id = auth.uid();
  select * into v_old from public.preco_itens where id = v_id;
  if found then v_new := v_old;
  else v_new := row(v_id, null, '', '', 'mensal', 'percentual', null, null, null, null, '', 0, true, now(), null)::public.preco_itens;
  end if;
  if p ? 'nome'      then v_new.nome := trim(p->>'nome'); end if;
  if p ? 'app_id'    then v_new.app_id := nullif(trim(p->>'app_id'), ''); end if;
  if p ? 'unidade'   then v_new.unidade := trim(coalesce(p->>'unidade', '')); end if;
  if p ? 'cobranca'  then v_new.cobranca := p->>'cobranca'; end if;
  if p ? 'modo'      then v_new.modo := p->>'modo'; end if;
  if p ? 'percentual' then v_new.percentual := nullif(p->>'percentual', '')::numeric; end if;
  if p ? 'obs'       then v_new.obs := trim(coalesce(p->>'obs', '')); end if;
  if p ? 'ordem'     then v_new.ordem := coalesce(nullif(p->>'ordem', '')::int, 0); end if;
  if p ? 'ativo'     then v_new.ativo := coalesce((p->>'ativo')::boolean, true); end if;
  if coalesce(v_new.nome, '') = '' then raise exception 'Informe o nome do item.'; end if;
  if v_new.cobranca not in ('mensal', 'avulso', 'incluido', 'negociar') then raise exception 'Cobrança inválida.'; end if;
  if v_new.modo not in ('percentual', 'fixo') then raise exception 'Modo inválido.'; end if;

  if v_new.cobranca in ('incluido', 'negociar') then
    if p ? 'valor' then v_new.valor := nullif(p->>'valor', '')::numeric; end if;
  elsif p ? 'valor' and nullif(p->>'valor', '') is not null then
    v_new.valor := (p->>'valor')::numeric;
    if v_new.valor <= 0 then raise exception 'O valor precisa ser maior que zero.'; end if;
  elsif v_new.modo = 'percentual' and (v_old.id is null or v_new.percentual is distinct from v_old.percentual
                                        or v_old.modo is distinct from 'percentual' or v_old.valor is null) then
    if v_new.percentual is null then raise exception 'Informe o percentual do salário mínimo.'; end if;
    if v_sm is null then raise exception 'Cadastre o salário mínimo antes.'; end if;
    v_new.valor := public.preco_arredondar(v_sm * v_new.percentual / 100);
  elsif v_new.valor is null then
    raise exception 'Informe o valor em reais.';
  end if;
  if v_new.modo = 'percentual' and v_new.cobranca in ('mensal', 'avulso') and v_new.percentual is null then
    raise exception 'Informe o percentual do salário mínimo.';
  end if;

  if v_new.valor is distinct from v_old.valor or v_old.id is null then
    v_new.valor_desde := coalesce(nullif(p->>'vale_desde', '')::date, v_hoje);
    v_new.sm_referencia := v_sm;
  end if;
  v_new.atualizado_em := now(); v_new.atualizado_por := v_quem;

  if v_old.id is null then
    perform set_config('preco.motivo', 'item criado', true);
    insert into public.preco_itens select v_new.*;
  else
    perform set_config('preco.motivo', coalesce(nullif(trim(p->>'motivo'), ''), 'alterado pela Nervia'), true);
    update public.preco_itens set app_id = v_new.app_id, nome = v_new.nome, unidade = v_new.unidade,
      cobranca = v_new.cobranca, modo = v_new.modo, percentual = v_new.percentual, valor = v_new.valor,
      valor_desde = v_new.valor_desde, sm_referencia = v_new.sm_referencia, obs = v_new.obs, ordem = v_new.ordem,
      ativo = v_new.ativo, atualizado_em = v_new.atualizado_em, atualizado_por = v_new.atualizado_por
     where id = v_id;
  end if;
  perform set_config('preco.motivo', '', true);
end $$;
revoke execute on function public.preco_salvar(jsonb) from public, anon;
grant execute on function public.preco_salvar(jsonb) to authenticated;

-- Aprovar o reajuste pelo salário mínimo de hoje: valor = sugerido nos itens escolhidos (modo percentual).
create or replace function public.precos_aprovar_reajuste(p_ids text[], p_vale_desde date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_sm numeric := public.salario_minimo_em(null); v_quem text; n int;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia aprova reajustes.'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Marque ao menos um item.'; end if;
  select coalesce(nullif(nome, ''), email) into v_quem from public.perfis where user_id = auth.uid();
  perform set_config('preco.motivo', 'reajuste pelo salário mínimo de R$ ' || to_char(v_sm, 'FM999G990D00'), true);
  update public.preco_itens i
     set valor = public.preco_arredondar(v_sm * i.percentual / 100),
         valor_desde = coalesce(p_vale_desde, (now() at time zone 'America/Sao_Paulo')::date),
         sm_referencia = v_sm, atualizado_em = now(), atualizado_por = v_quem
   where i.id = any(p_ids) and i.modo = 'percentual' and i.percentual is not null
     and i.cobranca in ('mensal', 'avulso')
     and i.valor is distinct from public.preco_arredondar(v_sm * i.percentual / 100);
  get diagnostics n = row_count;
  perform set_config('preco.motivo', '', true);
  return n;
end $$;
revoke execute on function public.precos_aprovar_reajuste(text[], date) from public, anon;
grant execute on function public.precos_aprovar_reajuste(text[], date) to authenticated;

-- Cadastrar o salário mínimo novo (não muda preço nenhum: só passa a sugerir o reajuste).
create or replace function public.salario_minimo_salvar(p_vigencia date, p_valor numeric, p_fonte text)
returns void language plpgsql security definer set search_path = public as $$
declare v_antes numeric;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia cadastra o salário mínimo.'; end if;
  if p_vigencia is null or p_valor is null or p_valor <= 0 then raise exception 'Informe a data de início e o valor.'; end if;
  if coalesce(trim(p_fonte), '') = '' then raise exception 'Informe a fonte (decreto ou lei).'; end if;
  select valor into v_antes from public.salario_minimo where vigencia = p_vigencia;
  insert into public.salario_minimo (vigencia, valor, fonte) values (p_vigencia, p_valor, trim(p_fonte))
  on conflict (vigencia) do update set valor = excluded.valor, fonte = excluded.fonte;
  perform public.auditar('salario_minimo_cadastrado', null,
    jsonb_build_object('vigencia', p_vigencia, 'valor', p_valor, 'antes', v_antes, 'fonte', trim(p_fonte)));
end $$;
revoke execute on function public.salario_minimo_salvar(date, numeric, text) from public, anon;
grant execute on function public.salario_minimo_salvar(date, numeric, text) to authenticated;

-- ------------------------------------------------------------------ valores iniciais (aprovados pelo Marco em 04/11/2026)
-- Salário mínimo de 2026 = R$ 1.621. Valores = percentual × 1.621, arredondados.
do $$
declare r record;
begin
  perform set_config('preco.motivo', 'valores iniciais aprovados pelo Marco (04/11/2026)', true);
  for r in select * from (values
    ('notas',          'notas',        'Buscador de NF',                     'CNPJ / mês',                    'mensal',   2.5,  10, ''),
    ('painel-nf',      'painel-nf',    'Painel de Notas (com o Buscador)',   'CNPJ / mês',                    'mensal',   1.5,  20, 'Só junto com o Buscador de NF.'),
    ('pacote-notas',   'notas',        'Pacote Buscador + Painel',           'CNPJ / mês',                    'mensal',   3.5,  30, ''),
    ('compras',        'compras',      'Orçamentos de Compras',              'unidade / mês',                 'mensal',   6,    40, ''),
    ('compras-oportunidades', 'compras', 'Oportunidades (fornecedor)',       'fornecedor / mês',              'mensal',   2,    50, 'Pago pelo fornecedor; não dá vantagem na escolha.'),
    ('monitor',        'monitor',      'Monitor de Links',                   'local / mês',                   'mensal',   3,    60, ''),
    ('licencas',       'licencas',     'Contas e Licenças Microsoft 365',    'unidade / mês',                 'mensal',   2,    70, ''),
    ('midia',          'midia',        'Mídia Indoor',                       'TV / mês',                      'mensal',   3,    80, ''),
    ('telefonia',      'telefonia',    'Auditoria de Telefonia Móvel',       'por relatório',                 'avulso',   8,    90, 'Sem mensalidade: cobra cada relatório gerado ou atualizado.'),
    ('atendimentos',   'atendimentos', 'Atendimentos de TI',                 'incluído no contrato de suporte', 'incluido', null, 100, ''),
    ('linum',          'linum',        'Sistema Linum',                      'contrato próprio',              'negociar', null, 110, 'App exclusivo da Linum.')
  ) as t(id, app_id, nome, unidade, cobranca, pct, ordem, obs)
  loop
    if not exists (select 1 from public.preco_itens where id = r.id) then
      insert into public.preco_itens (id, app_id, nome, unidade, cobranca, modo, percentual, valor, valor_desde, sm_referencia, obs, ordem, atualizado_por)
      values (r.id, (select a.id from public.apps a where a.id = r.app_id), r.nome, r.unidade, r.cobranca, 'percentual', r.pct,
              case when r.pct is not null then public.preco_arredondar(1621 * r.pct / 100) end,
              case when r.pct is not null then date '2026-11-04' end,
              case when r.pct is not null then 1621 end, r.obs, r.ordem, 'Marco (valores iniciais)');
    end if;
  end loop;
  perform set_config('preco.motivo', '', true);
end $$;
