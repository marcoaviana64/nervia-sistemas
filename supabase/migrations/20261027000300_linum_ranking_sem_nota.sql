-- Sistema Linum 2.6: o ranking das vendedoras sai SEM a nota da Dona (decisão da Gorette, dona da Linum, contada pelo Marco
-- em 27/10/2026). Ficam 3 critérios de peso igual, cada um de 1 a 5: Vendas, Cliente na venda e Acompanhamento.
-- As notas já dadas continuam guardadas em lin_notas_vendedora (e na auditoria), mas não contam mais e não se dão
-- novas notas (lin_nota_vendedora_salvar sem permissão para a tela).
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
  ), base as (
    select g.user_id, g.nome, coalesce(v.valor, 0) as valor, coalesce(v.n, 0) as n_vendas, coalesce(v.com_cliente, 0) as com_cliente,
           coalesce(r.n, 0) as registros
      from gente g left join vendas v using (user_id) left join registros r using (user_id)
  ), crit as (
    select b.*,
      case when b.n_vendas > 0 and max(b.valor) over () > 0 then 1 + 4 * b.valor / max(b.valor) over () end as c_vendas,
      case when b.n_vendas > 0 then 1 + 4 * b.com_cliente::numeric / b.n_vendas end as c_clientes,
      case when max(b.registros) over () > 0 and (b.registros > 0 or b.n_vendas > 0) then 1 + 4 * b.registros::numeric / max(b.registros) over () end as c_crm
    from base b
  ), fim as (
    select c.*, (select avg(x) from unnest(array[c.c_vendas, c.c_clientes, c.c_crm]) x) as final,
           (select count(x) from unnest(array[c.c_vendas, c.c_clientes, c.c_crm]) x) as criterios
      from crit c
  ), pos as (
    select f.*, case when f.final is not null then rank() over (order by round(f.final, 1) desc nulls last) end as posicao from fim f
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', f.user_id, 'nome', f.nome, 'eu', f.user_id = v_eu,
      'posicao', f.posicao,
      'final', round(f.final, 1), 'criterios', f.criterios,
      'vendas', round(f.c_vendas, 1), 'clientes', round(f.c_clientes, 1), 'crm', round(f.c_crm, 1),
      -- números e comentário: só o Dono e a própria pessoa
      'valor', case when v_dono or f.user_id = v_eu then f.valor end,
      'n_vendas', case when v_dono or f.user_id = v_eu then f.n_vendas end,
      'com_cliente', case when v_dono or f.user_id = v_eu then f.com_cliente end,
      'registros', case when v_dono or f.user_id = v_eu then f.registros end
    ) order by f.posicao nulls last, f.nome), '[]') into v
  from pos f;
  return jsonb_build_object('dono', v_dono, 'participantes', v);
end $$;

revoke execute on function public.lin_nota_vendedora_salvar(uuid, date, int, text) from public, anon, authenticated;
