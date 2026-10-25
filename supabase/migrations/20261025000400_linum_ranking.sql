-- Sistema Linum — ranking das vendedoras por mês e por ano (pedido do Marco em 25/10/2026; versão 1.11 do app).
-- "A melhor vendedora: a que mais vendeu, a que usou o aplicativo (vendas, CRM, informações do cliente), o atendimento
--  e uma nota da dona da empresa; a média de 1 a 5 classifica."
-- Quatro critérios, cada um de 1 a 5, com o mesmo peso; a nota final é a média dos que existem no período:
--   1. Vendas: valor pago das vendas não canceladas. Quem mais vendeu = 5; as outras na proporção (1 + 4 × valor ÷ maior).
--   2. Cliente na venda: % das vendas com a cliente identificada (1 + 4 × %). Mede o cadastro das clientes.
--   3. Acompanhamento (CRM): contatos registrados à mão + visitas sem contato + clientes cadastradas no período.
--      Quem mais registrou = 5; as outras na proporção.
--   4. Nota da Dona: de 1 a 5, uma por mês (atendimento e o que mais ela quiser avaliar); no ano, a média dos meses.
-- Participa quem tem papel no app e não é Dono. Quem não teve nada no período fica sem nota (não entra na classificação).
-- Visibilidade: todas veem posição, nota final e as notas de cada critério de todas (é um incentivo); valores em R$,
-- números e o comentário da Dona só para o Dono e, de cada vendedora, para ela mesma.

create table if not exists public.lin_notas_vendedora (
  id          bigint generated always as identity primary key,
  mes         date not null check (extract(day from mes) = 1),
  user_id     uuid not null references auth.users on delete cascade,
  nota        int not null check (nota between 1 and 5),
  comentario  text not null default '',
  por         uuid references auth.users on delete set null,
  por_nome    text not null default '',
  em          timestamptz not null default now(),
  unique (mes, user_id)
);
alter table public.lin_notas_vendedora enable row level security;
revoke all on public.lin_notas_vendedora from anon;
revoke insert, update, delete on public.lin_notas_vendedora from authenticated;
drop policy if exists lin_notas_vendedora_ler on public.lin_notas_vendedora;
create policy lin_notas_vendedora_ler on public.lin_notas_vendedora for select
  using (public.lin_eh_dono() or (public.lin_vende() and user_id = auth.uid()));

-- a Dona dá (ou troca) a nota do mês; tudo vai para a auditoria com o antes e o depois
create or replace function public.lin_nota_vendedora_salvar(p_user uuid, p_mes date, p_nota int, p_comentario text) returns void
language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', p_mes)::date; v_antes jsonb; v_nome text;
begin
  if not public.lin_eh_dono() then raise exception 'Só o Dono dá a nota das vendedoras'; end if;
  if p_nota is null or p_nota not between 1 and 5 then raise exception 'A nota vai de 1 a 5'; end if;
  if v_mes > date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date then raise exception 'Não dá para dar nota de um mês que ainda não começou'; end if;
  select coalesce(nullif(trim(pf.nome), ''), pf.email) into v_nome
    from public.lin_membros m join public.perfis pf on pf.user_id = m.user_id where m.user_id = p_user and m.papel <> 'dono';
  if v_nome is null then raise exception 'Escolha alguém da equipe (não o Dono)'; end if;
  select to_jsonb(n) - 'id' into v_antes from public.lin_notas_vendedora n where mes = v_mes and user_id = p_user;
  insert into public.lin_notas_vendedora (mes, user_id, nota, comentario, por, por_nome)
  values (v_mes, p_user, p_nota, coalesce(trim(p_comentario), ''), auth.uid(), public._lin_nome())
  on conflict (mes, user_id) do update set nota = excluded.nota, comentario = excluded.comentario, por = excluded.por, por_nome = excluded.por_nome, em = now();
  perform public._lin_auditar(case when v_antes is null then 'linum_nota_vendedora_dada' else 'linum_nota_vendedora_alterada' end, null,
    jsonb_build_object('vendedora', v_nome, 'vendedora_id', p_user, 'mes', to_char(v_mes, 'MM/YYYY'), 'nota', p_nota,
                       'antes', case when v_antes is null then null else v_antes -> 'nota' end));
end $$;

-- ranking de um período (mês: de = dia 1, até = último dia; ano: 01/01 a 31/12)
create or replace function public.lin_ranking(p_de date, p_ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_dono boolean := public.lin_eh_dono(); v_eu uuid := auth.uid(); v jsonb;
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 370 then raise exception 'Período inválido'; end if;
  with gente as (
    select m.user_id, coalesce(nullif(trim(pf.nome), ''), pf.email) as nome
      from public.lin_membros m join public.perfis pf on pf.user_id = m.user_id
     where m.papel <> 'dono' and exists (select 1 from public.app_acessos a where a.user_id = m.user_id and a.app_id = 'linum')
  ), vendas as (
    select vendedora_id as user_id, sum(valor_total) as valor, count(*) as n, count(cliente_id) as com_cliente
      from public.lin_vendas where cancelada_em is null and data between p_de and p_ate group by vendedora_id
  ), registros as (
    select user_id, count(*) as n from (
      select por as user_id from public.lin_contatos where venda_id is null and (em at time zone 'America/Sao_Paulo')::date between p_de and p_ate
      union all select por from public.lin_visitas where data between p_de and p_ate
      union all select criado_por from public.lin_clientes where (criado_em at time zone 'America/Sao_Paulo')::date between p_de and p_ate
    ) x group by user_id
  ), notas as (
    select user_id, avg(nota)::numeric as nota, count(*) as meses,
           (array_agg(comentario order by mes desc) filter (where comentario <> ''))[1] as comentario
      from public.lin_notas_vendedora where mes between date_trunc('month', p_de)::date and p_ate group by user_id
  ), base as (
    select g.user_id, g.nome, coalesce(v.valor, 0) as valor, coalesce(v.n, 0) as n_vendas, coalesce(v.com_cliente, 0) as com_cliente,
           coalesce(r.n, 0) as registros, n.nota as nota_dona, n.meses as meses_nota, n.comentario
      from gente g left join vendas v using (user_id) left join registros r using (user_id) left join notas n using (user_id)
  ), crit as (
    select b.*,
      case when b.n_vendas > 0 and max(b.valor) over () > 0 then 1 + 4 * b.valor / max(b.valor) over () end as c_vendas,
      case when b.n_vendas > 0 then 1 + 4 * b.com_cliente::numeric / b.n_vendas end as c_clientes,
      case when max(b.registros) over () > 0 and (b.registros > 0 or b.n_vendas > 0) then 1 + 4 * b.registros::numeric / max(b.registros) over () end as c_crm,
      b.nota_dona as c_dona
    from base b
  ), fim as (
    select c.*, (select avg(x) from unnest(array[c.c_vendas, c.c_clientes, c.c_crm, c.c_dona]) x) as final,
           (select count(x) from unnest(array[c.c_vendas, c.c_clientes, c.c_crm, c.c_dona]) x) as criterios
      from crit c
  ), pos as (
    select f.*, case when f.final is not null then rank() over (order by round(f.final, 1) desc nulls last) end as posicao from fim f
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', f.user_id, 'nome', f.nome, 'eu', f.user_id = v_eu,
      'posicao', f.posicao,
      'final', round(f.final, 1), 'criterios', f.criterios,
      'vendas', round(f.c_vendas, 1), 'clientes', round(f.c_clientes, 1), 'crm', round(f.c_crm, 1), 'dona', round(f.c_dona, 1),
      -- números e comentário: só o Dono e a própria pessoa
      'valor', case when v_dono or f.user_id = v_eu then f.valor end,
      'n_vendas', case when v_dono or f.user_id = v_eu then f.n_vendas end,
      'com_cliente', case when v_dono or f.user_id = v_eu then f.com_cliente end,
      'registros', case when v_dono or f.user_id = v_eu then f.registros end,
      'meses_nota', case when v_dono or f.user_id = v_eu then f.meses_nota end,
      'comentario', case when v_dono or f.user_id = v_eu then f.comentario end
    ) order by f.posicao nulls last, f.nome), '[]') into v
  from pos f;
  return jsonb_build_object('dono', v_dono, 'participantes', v);
end $$;

do $$ declare f text; begin
  foreach f in array array['lin_nota_vendedora_salvar(uuid, date, int, text)', 'lin_ranking(date, date)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
