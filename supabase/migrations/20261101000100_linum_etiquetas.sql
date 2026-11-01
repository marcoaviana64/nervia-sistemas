-- Sistema Linum 2.27 — Etiquetas (pedido do Marco em 31/10/2026): a aba Etiquetas gera o PDF da "Etiqueta Tripla" com os dados
-- do cadastro. A tela já recebe referência, descrição, preço e código de barras pela lin_estoque_ler (que toda a equipe lê,
-- vendedoras inclusive); falta só o tecido do produto. Só acrescenta a chave 'tecido' na resposta: nenhum dado muda.
create or replace function public.lin_estoque_ler() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_papel text := public.lin_papel();
begin
  if v_papel is null then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  return jsonb_build_object(
    'papel', v_papel,
    'minha_loja', public.lin_minha_loja(),
    'comissao_pct', (select comissao_pct from public.lin_membros where user_id = auth.uid()),
    'lojas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome) order by ordem, nome) from public.lin_lojas), '[]'),
    'produtos', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'referencia', p.referencia, 'descricao', p.descricao,
               'categoria', p.categoria, 'preco_venda', p.preco_venda, 'codigo_barras', p.codigo_barras, 'tecido', p.tecido,
               'variantes', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'cor', v.cor, 'tamanho', v.tamanho,
                                        'edicao', v.edicao, 'preco_venda', v.preco_venda, 'codigo_barras', v.codigo_barras))
                                      from public.lin_variantes v where v.produto_id = p.id and v.ativo), '[]'))
             order by p.descricao, p.referencia)
      from public.lin_produtos p where p.ativo), '[]'),
    'estoque', coalesce((select jsonb_agg(jsonb_build_array(e.variante_id, e.loja_id, e.quantidade))
                         from public.lin_estoque e join public.lin_variantes v on v.id = e.variante_id
                         where e.quantidade <> 0 and v.ativo), '[]'));
end $$;
revoke execute on function public.lin_estoque_ler() from public, anon;
grant execute on function public.lin_estoque_ler() to authenticated;
