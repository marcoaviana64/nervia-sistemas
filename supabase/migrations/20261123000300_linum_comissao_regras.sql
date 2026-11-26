-- Sistema Linum 2.61 — REGRAS DE COMISSÃO por loja e período (pedido do Marco em 23/11/2026: "a vendedora pode ganhar
-- comissão de venda em uma loja, mais de uma loja ou nenhuma comissão; em todas as opções posso ter períodos válidos ou
-- início sem fim; hoje só temos a opção de colocar ou não o valor da comissão").
-- Decisões do Marco (23/11/2026):
--   * regra com início no passado RECALCULA a comissão das vendas não canceladas do período (com auditoria);
--   * começar SEM regra: ninguém tem comissão até a Dona cadastrar (as vendas já feitas ficam como estão);
--   * quem cadastra: a Dona e a equipe Nervia (lin_eh_dono); cada pessoa vê só as próprias regras.
-- Regra = pessoa × % × lojas (uma ou mais) × início × fim (vazio = sem fim). Sem regra na loja e na data = sem comissão.
-- Duas regras da mesma pessoa não podem valer na mesma loja no mesmo dia.
-- A lin_venda_registrar NÃO foi reescrita: um `do` troca só a leitura do % (lin_membros.comissao_pct → regra da loja e
-- da data da venda). A coluna lin_membros.comissao_pct fica guardada, sem uso.

create table if not exists public.lin_comissoes (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id),
  pct           numeric(5,2) not null check (pct > 0 and pct <= 100),
  lojas         uuid[] not null check (cardinality(lojas) >= 1),
  inicio        date not null,
  fim           date check (fim is null or fim >= inicio),
  observacao    text check (observacao is null or length(observacao) <= 300),
  criado_em     timestamptz not null default now(),
  criado_por    uuid,
  criado_nome   text,
  alterado_em   timestamptz,
  alterado_nome text,
  excluida_em   timestamptz,
  excluida_nome text,
  motivo_exclusao text
);
create index if not exists lin_comissoes_user on public.lin_comissoes (user_id);

alter table public.lin_comissoes enable row level security;
drop policy if exists lin_comissoes_ler on public.lin_comissoes;
create policy lin_comissoes_ler on public.lin_comissoes for select
  using ((select public.lin_eh_dono()) or user_id = (select auth.uid()));
revoke all on public.lin_comissoes from anon, authenticated;
grant select on public.lin_comissoes to authenticated;

-- % da pessoa na loja e na data (0 = sem comissão)
create or replace function public._lin_comissao_pct(p_user uuid, p_loja uuid, p_data date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select c.pct from public.lin_comissoes c
                    where c.user_id = p_user and c.excluida_em is null and p_loja = any (c.lojas)
                      and p_data >= c.inicio and (c.fim is null or p_data <= c.fim)
                    order by c.id desc limit 1), 0)
$$;
revoke execute on function public._lin_comissao_pct(uuid, uuid, date) from public, anon, authenticated;

-- 1) lin_venda_registrar: o % vem da regra da loja e da data da venda
do $$
declare d text := pg_get_functiondef('public.lin_venda_registrar(jsonb)'::regprocedure);
        velho text := 'm.comissao_pct into v_vend_nome, v_com';
        novo  text := 'public._lin_comissao_pct(m.user_id, v_loja, v_data) into v_vend_nome, v_com';
begin
  if (length(d) - length(replace(d, velho, ''))) / length(velho) <> 1 then
    raise exception 'lin_venda_registrar não tem exatamente uma leitura do %% de comissão: migração interrompida';
  end if;
  execute replace(d, velho, novo);
end $$;

-- 2) imutabilidade da venda: libera SÓ comissao_pct/comissao_valor, e só pelo recálculo das regras
create or replace function public.lin_vendas_imutavel() returns trigger
language plpgsql as $$
declare v_livres text[] := array['cancelada_em', 'cancelada_por', 'cancelada_nome', 'motivo_cancelamento', 'valor_nf'];
begin
  if tg_op = 'DELETE' then raise exception 'Venda ou troca não se apaga: cancele com motivo'; end if;
  if tg_table_name in ('lin_venda_itens', 'lin_troca_itens') then raise exception 'Os itens não podem ser alterados'; end if;
  if old.criado_em = now() then return new; end if;   -- a própria função de registro fecha os totais na mesma transação
  if tg_table_name = 'lin_vendas' and current_setting('lin.corrigir_data', true) = 'sim' then
    v_livres := v_livres || 'data'::text;                   -- só pela lin_venda_corrigir_data
  end if;
  if tg_table_name = 'lin_vendas' and current_setting('lin.corrigir_cliente', true) = 'sim' then
    v_livres := v_livres || 'cliente_id'::text;             -- só pela lin_venda_cliente
  end if;
  if tg_table_name = 'lin_vendas' and current_setting('lin.corrigir_cv', true) = 'sim'
     and public._lin_pag_sem_cv(to_jsonb(new) -> 'pagamentos') = public._lin_pag_sem_cv(to_jsonb(old) -> 'pagamentos') then
    v_livres := v_livres || 'pagamentos'::text;             -- só pela lin_venda_comprovante, e só o CV
  end if;
  if tg_table_name = 'lin_vendas' and current_setting('lin.corrigir_comissao', true) = 'sim' then
    v_livres := v_livres || array['comissao_pct', 'comissao_valor'];   -- só pelo recálculo das regras de comissão
  end if;
  if (to_jsonb(new) - v_livres) is distinct from (to_jsonb(old) - v_livres) then
    raise exception 'Não pode ser alterada: cancele com motivo e registre de novo';
  end if;
  return new;
end $$;

-- 3) recálculo das vendas não canceladas da pessoa nas lojas e datas indicadas; devolve [{venda, data, loja, antes, depois}]
create or replace function public._lin_comissao_recalcular(p_user uuid, p_lojas uuid[], p_de date, p_ate date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_pct numeric; v_val numeric; v_res jsonb := '[]';
begin
  perform set_config('lin.corrigir_comissao', 'sim', true);
  for r in select v.id, v.data, v.loja_id, v.valor_total, coalesce(v.credito_usado, 0) cred, v.comissao_pct, v.comissao_valor
             from public.lin_vendas v
            where v.vendedora_id = p_user and v.cancelada_em is null and v.loja_id = any (p_lojas)
              and v.data >= p_de and (p_ate is null or v.data <= p_ate)
            order by v.id for update loop
    v_pct := public._lin_comissao_pct(p_user, r.loja_id, r.data);
    v_val := round((r.valor_total - r.cred) * v_pct / 100, 2);
    if v_pct is distinct from coalesce(r.comissao_pct, 0) or v_val is distinct from coalesce(r.comissao_valor, 0) then
      update public.lin_vendas set comissao_pct = v_pct, comissao_valor = v_val where id = r.id;
      v_res := v_res || jsonb_build_object('venda', r.id, 'data', r.data, 'loja', (select nome from public.lin_lojas where id = r.loja_id),
        'antes', jsonb_build_object('pct', coalesce(r.comissao_pct, 0), 'valor', coalesce(r.comissao_valor, 0)),
        'depois', jsonb_build_object('pct', v_pct, 'valor', v_val));
    end if;
  end loop;
  perform set_config('lin.corrigir_comissao', '', true);
  return v_res;
end $$;
revoke execute on function public._lin_comissao_recalcular(uuid, uuid[], date, date) from public, anon, authenticated;

-- 4) leitura para a tela: regras (Dona = todas; os outros = as próprias) + pessoas da equipe (só para a Dona)
create or replace function public.lin_comissoes_ler() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_dono boolean := public.lin_eh_dono();
begin
  if public.lin_papel() is null then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  return jsonb_build_object(
    'regras', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('nome', coalesce(nullif(trim(p.nome), ''), p.email)) order by coalesce(nullif(trim(p.nome), ''), p.email), c.inicio, c.id)
                          from public.lin_comissoes c join public.perfis p on p.user_id = c.user_id
                         where c.excluida_em is null and (v_dono or c.user_id = auth.uid())), '[]'),
    'pessoas', case when v_dono then coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nome', coalesce(nullif(trim(p.nome), ''), p.email), 'papel', m.papel)
                          order by coalesce(nullif(trim(p.nome), ''), p.email))
                          from public.lin_membros m join public.perfis p on p.user_id = m.user_id
                         where exists (select 1 from public.app_acessos a where a.user_id = m.user_id and a.app_id = 'linum')), '[]') else '[]' end);
end $$;

-- 5) criar ou editar uma regra (Dona/equipe Nervia). p: {id?, user_id, pct, lojas:[uuid], inicio, fim?, observacao?}
create or replace function public.lin_comissao_salvar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p ->> 'id', '')::bigint; v_old public.lin_comissoes; v_user uuid; v_pct numeric; v_lojas uuid[];
        v_ini date; v_fim date; v_obs text; v_nome text; v_quem text; v_conf record; v_rec jsonb; v_de date; v_ate date; v_todas uuid[];
begin
  if not public.lin_eh_dono() then raise exception 'Só a Dona (ou a equipe Nervia) cadastra regras de comissão'; end if;
  v_quem := coalesce((select coalesce(nullif(trim(nome), ''), email) from public.perfis where user_id = auth.uid()), 'Equipe Nervia');
  if v_id is not null then
    select * into v_old from public.lin_comissoes where id = v_id and excluida_em is null for update;
    if not found then raise exception 'Regra não encontrada'; end if;
  end if;
  v_user := coalesce(nullif(p ->> 'user_id', '')::uuid, v_old.user_id);
  if v_user is null or not exists (select 1 from public.lin_membros where user_id = v_user) then raise exception 'Escolha a pessoa da equipe'; end if;
  if v_old.id is not null and v_user <> v_old.user_id then raise exception 'A pessoa da regra não muda: exclua e crie outra'; end if;
  v_pct := round(nullif(p ->> 'pct', '')::numeric, 2);
  if v_pct is null or v_pct <= 0 or v_pct > 100 then raise exception 'Informe a comissão em %% (maior que zero e até 100). Sem comissão = sem regra'; end if;
  select array_agg(distinct x::uuid) into v_lojas from jsonb_array_elements_text(coalesce(p -> 'lojas', '[]')) x;
  if v_lojas is null then raise exception 'Marque pelo menos uma loja'; end if;
  if exists (select 1 from unnest(v_lojas) l where not exists (select 1 from public.lin_lojas where id = l)) then raise exception 'Loja não encontrada'; end if;
  v_ini := nullif(p ->> 'inicio', '')::date; v_fim := nullif(p ->> 'fim', '')::date;
  if v_ini is null then raise exception 'Informe o início'; end if;
  if v_fim is not null and v_fim < v_ini then raise exception 'O fim não pode ser antes do início'; end if;
  v_obs := nullif(trim(coalesce(p ->> 'observacao', '')), '');
  select c.*, (select string_agg(l.nome, ', ' order by l.nome) from public.lin_lojas l where l.id = any (c.lojas) and l.id = any (v_lojas)) lj
    into v_conf from public.lin_comissoes c
   where c.user_id = v_user and c.excluida_em is null and c.id is distinct from v_id and c.lojas && v_lojas
     and c.inicio <= coalesce(v_fim, 'infinity'::date) and v_ini <= coalesce(c.fim, 'infinity'::date) limit 1;
  if found then
    raise exception 'Já existe regra para esta pessoa em % de % %: ajuste o período ou as lojas', v_conf.lj, to_char(v_conf.inicio, 'DD/MM/YYYY'),
      case when v_conf.fim is null then 'sem fim' else 'a ' || to_char(v_conf.fim, 'DD/MM/YYYY') end;
  end if;
  select coalesce(nullif(trim(nome), ''), email) into v_nome from public.perfis where user_id = v_user;
  if v_old.id is null then
    insert into public.lin_comissoes (user_id, pct, lojas, inicio, fim, observacao, criado_por, criado_nome)
    values (v_user, v_pct, v_lojas, v_ini, v_fim, v_obs, auth.uid(), v_quem) returning id into v_id;
    v_de := v_ini; v_ate := v_fim; v_todas := v_lojas;
  else
    update public.lin_comissoes set pct = v_pct, lojas = v_lojas, inicio = v_ini, fim = v_fim, observacao = v_obs,
           alterado_em = now(), alterado_nome = v_quem where id = v_id;
    v_de := least(v_ini, v_old.inicio);
    v_ate := case when v_fim is null or v_old.fim is null then null else greatest(v_fim, v_old.fim) end;
    v_todas := array(select distinct unnest(v_lojas || v_old.lojas));
  end if;
  v_rec := public._lin_comissao_recalcular(v_user, v_todas, v_de, v_ate);
  perform public._lin_auditar(case when v_old.id is null then 'linum_comissao_regra_criada' else 'linum_comissao_regra_alterada' end, null,
    jsonb_build_object('regra', v_id, 'pessoa', v_nome,
      'antes', case when v_old.id is null then null else jsonb_build_object('pct', v_old.pct, 'lojas', (select jsonb_agg(nome order by nome) from public.lin_lojas where id = any (v_old.lojas)), 'inicio', v_old.inicio, 'fim', v_old.fim, 'observacao', v_old.observacao) end,
      'depois', jsonb_build_object('pct', v_pct, 'lojas', (select jsonb_agg(nome order by nome) from public.lin_lojas where id = any (v_lojas)), 'inicio', v_ini, 'fim', v_fim, 'observacao', v_obs),
      'vendas_recalculadas', v_rec));
  return jsonb_build_object('id', v_id, 'recalculadas', jsonb_array_length(v_rec));
end $$;

-- 6) excluir uma regra (as vendas do período voltam a ser calculadas sem ela)
create or replace function public.lin_comissao_excluir(p_id bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_old public.lin_comissoes; v_quem text; v_rec jsonb;
begin
  if not public.lin_eh_dono() then raise exception 'Só a Dona (ou a equipe Nervia) exclui regras de comissão'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo (pelo menos 5 letras)'; end if;
  select * into v_old from public.lin_comissoes where id = p_id and excluida_em is null for update;
  if not found then raise exception 'Regra não encontrada'; end if;
  v_quem := coalesce((select coalesce(nullif(trim(nome), ''), email) from public.perfis where user_id = auth.uid()), 'Equipe Nervia');
  update public.lin_comissoes set excluida_em = now(), excluida_nome = v_quem, motivo_exclusao = trim(p_motivo) where id = p_id;
  v_rec := public._lin_comissao_recalcular(v_old.user_id, v_old.lojas, v_old.inicio, v_old.fim);
  perform public._lin_auditar('linum_comissao_regra_excluida', null, jsonb_build_object('regra', p_id,
    'pessoa', (select coalesce(nullif(trim(nome), ''), email) from public.perfis where user_id = v_old.user_id),
    'pct', v_old.pct, 'lojas', (select jsonb_agg(nome order by nome) from public.lin_lojas where id = any (v_old.lojas)),
    'inicio', v_old.inicio, 'fim', v_old.fim, 'motivo', trim(p_motivo), 'vendas_recalculadas', v_rec));
  return jsonb_build_object('recalculadas', jsonb_array_length(v_rec));
end $$;

revoke execute on function public.lin_comissoes_ler() from public, anon;
revoke execute on function public.lin_comissao_salvar(jsonb) from public, anon;
revoke execute on function public.lin_comissao_excluir(bigint, text) from public, anon;
grant execute on function public.lin_comissoes_ler() to authenticated;
grant execute on function public.lin_comissao_salvar(jsonb) to authenticated;
grant execute on function public.lin_comissao_excluir(bigint, text) to authenticated;
