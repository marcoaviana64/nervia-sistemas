-- Sistema Linum 2.62 — aba INÍCIO (pedido do Marco em 23/11/2026: "uma aba logo no início com informações relevantes:
-- aniversários da semana, ajustes e malinhas vencendo, estoque até 5 unidades, cores e tamanhos que mais vendem… cada um
-- vê o que já pode ver"). Quase tudo a tela lê pelas regras que já existem (RLS); só o ranking das cores e tamanhos que
-- mais vendem precisa desta função, porque o Estoque não lê as vendas das outras pessoas.
-- Decisão do Marco (23/11/2026): o ranking é SÓ da Dona e do Estoque (lin_controla_estoque), só em peças (sem valores nem
-- quem vendeu), últimos 30 dias (com 90 dias e o ano na tela).

create or replace function public.lin_mais_vendidos(p_dias int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_de date := (now() at time zone 'America/Sao_Paulo')::date - greatest(1, least(coalesce(p_dias, 30), 366)) + 1;
begin
  if not public.lin_controla_estoque() then raise exception 'Só a Dona e o Estoque veem o que mais vende'; end if;
  return (with it as (
            select i.referencia, i.descricao, coalesce(nullif(trim(i.cor), ''), '—') cor, coalesce(nullif(trim(i.tamanho), ''), '—') tamanho, i.quantidade
              from public.lin_venda_itens i join public.lin_vendas v on v.id = i.venda_id
             where v.cancelada_em is null and v.data >= v_de)
          select jsonb_build_object('de', v_de, 'pecas', coalesce((select sum(quantidade) from it), 0),
            'cores', coalesce((select jsonb_agg(x order by x.pecas desc, x.cor) from (select cor, sum(quantidade) pecas from it group by cor) x), '[]'),
            'tamanhos', coalesce((select jsonb_agg(x order by x.pecas desc, x.tamanho) from (select tamanho, sum(quantidade) pecas from it group by tamanho) x), '[]'),
            'produtos', coalesce((select jsonb_agg(x order by x.pecas desc, x.descricao) from (select referencia, descricao, sum(quantidade) pecas from it group by referencia, descricao order by 3 desc limit 10) x), '[]')));
end $$;
revoke execute on function public.lin_mais_vendidos(int) from public, anon;
grant execute on function public.lin_mais_vendidos(int) to authenticated;
