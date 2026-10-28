-- Relatório diário do Linum (pedido do Marco em 27/10/2026): uma linha com um jsonb `r` com tudo o que o PDF precisa.
-- "dia" = hoje em Brasília (o relatório roda às 22h30, com as lojas fechadas; decisão do Marco em 27/10/2026). Comparação com o último registro de copias.lin_status.
-- Depois de gerar o PDF, gravar o status novo:  insert into copias.lin_status (dados) values ('<r->agora>');
with dia as (select (now() at time zone 'America/Sao_Paulo')::date as d),
agora as (
  select jsonb_build_object(
    'produtos', (select count(*) from lin_produtos),
    'produtos_com_variacao', (select count(*) from lin_produtos p where exists (select 1 from lin_variantes v where v.produto_id = p.id)),
    'produtos_com_estoque', (select count(distinct v.produto_id) from lin_estoque e join lin_variantes v on v.id = e.variante_id where e.quantidade > 0),
    'variacoes', (select count(*) from lin_variantes),
    'especiais', (select count(*) from lin_variantes where edicao <> ''),
    'refs_provisorias', (select count(*) from lin_produtos where referencia ~ '^NOVA-'),
    'pecas_por_loja', (select jsonb_object_agg(l.nome, coalesce(x.q, 0)) from lin_lojas l
                         left join (select loja_id, sum(quantidade) q from lin_estoque group by 1) x on x.loja_id = l.id),
    'pecas_total', (select coalesce(sum(quantidade), 0) from lin_estoque),
    'valor_venda', (select coalesce(sum(e.quantidade * coalesce(v.preco_venda, p.preco_venda)), 0)
                      from lin_estoque e join lin_variantes v on v.id = e.variante_id join lin_produtos p on p.id = v.produto_id)) as a),
aud as (
  select coalesce(nullif(a.nome, ''), (select nullif(p.nome, '') from perfis p where p.user_id = a.user_id), a.email, 'Correção no banco (Nervia)') quem, a.acao, a.detalhes, a.quando at time zone 'America/Sao_Paulo' q
    from auditoria a, dia
   where a.acao like 'linum\_%' and (a.quando at time zone 'America/Sao_Paulo')::date = dia.d
     and a.acao ~ '^linum_(produto|variante|variantes|peca_especial|estoque)'),
pessoas as (
  select coalesce(jsonb_agg(x order by x.pecas_entrada desc, x.quem), '[]') j from (
    select quem,
      to_char(min(q), 'HH24"h"MI') inicio, to_char(max(q), 'HH24"h"MI') fim,
      count(*) filter (where acao = 'linum_produto_criado') prod_criados,
      count(*) filter (where acao = 'linum_produto_alterado') prod_alterados,
      count(*) filter (where acao = 'linum_produto_excluido') prod_excluidos,
      coalesce(sum((detalhes ->> 'criadas')::int) filter (where acao = 'linum_variantes_criadas'), 0)
        + count(*) filter (where acao = 'linum_peca_especial_criada') variacoes_criadas,
      count(*) filter (where acao in ('linum_variante_alterada', 'linum_variante_excluida', 'linum_variante_desativada', 'linum_variante_reativada')) variacoes_mexidas,
      coalesce(sum((detalhes ->> 'quantidade')::numeric) filter (where acao = 'linum_estoque_entrada'), 0) pecas_entrada,
      coalesce((select jsonb_object_agg(l, s) from (select detalhes ->> 'loja' l, sum((detalhes ->> 'quantidade')::numeric) s from aud a2
                 where a2.quem = aud.quem and a2.acao = 'linum_estoque_entrada' group by 1) y), '{}') entrada_por_loja,
      coalesce(sum((detalhes ->> 'quantidade')::numeric) filter (where acao = 'linum_estoque_saida'), 0) pecas_saida,
      count(*) filter (where acao = 'linum_estoque_transferencia') transferencias,
      count(*) filter (where acao = 'linum_estoque_ajuste') ajustes
    from aud group by quem) x)
select jsonb_build_object(
  'dia', to_char((select d from dia), 'DD/MM/YYYY'),
  'dia_semana', (array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[extract(dow from (select d from dia))::int + 1],
  'gerado_em', to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
  'agora', (select a from agora),
  'anterior', (select dados from copias.lin_status order by em desc limit 1),
  'anterior_em', (select to_char(em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') from copias.lin_status order by em desc limit 1),
  'pessoas', (select j from pessoas),
  'excluidos', (select coalesce(jsonb_agg(distinct coalesce(detalhes ->> 'referencia', '?')), '[]') from aud where acao = 'linum_produto_excluido'),
  -- leituras dos QR codes da Linum (página /linum/ com ?o=<origem>; cliques = /linum/clique/<botão>)
  'qr', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
     select coalesce(origem, '(sem origem)') origem,
       count(*) filter (where pagina = '/linum/' and (quando at time zone 'America/Sao_Paulo')::date = (select d from dia)) hoje,
       count(distinct ip) filter (where pagina = '/linum/' and (quando at time zone 'America/Sao_Paulo')::date = (select d from dia)) pessoas_hoje,
       count(*) filter (where pagina like '/linum/clique/%' and (quando at time zone 'America/Sao_Paulo')::date = (select d from dia)) cliques_hoje,
       count(*) filter (where pagina = '/linum/') total
     from site_acessos where pagina = '/linum/' or pagina like '/linum/clique/%' group by 1) x),
  'qr_cadastros', (select coalesce(jsonb_object_agg(origem, n), '{}') from (
     select origem, count(*) n from lin_qr_cadastros, dia where (em at time zone 'America/Sao_Paulo')::date = dia.d group by 1) z),
  'qr_cliques', (select coalesce(jsonb_object_agg(b, n), '{}') from (
     select replace(pagina, '/linum/clique/', '') b, count(*) n from site_acessos, dia
      where pagina like '/linum/clique/%' and (quando at time zone 'America/Sao_Paulo')::date = dia.d group by 1) y),
  'provisorias', (select coalesce(jsonb_agg(referencia || ' ' || descricao order by referencia), '[]') from lin_produtos where referencia ~ '^NOVA-')
) r;
