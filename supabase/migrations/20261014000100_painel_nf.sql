-- App "Painel de Notas": dashboard de compras/vendas a partir das notas do Buscador.
-- Não cria tabelas: lê nf_notas e nf_empresas com as mesmas regras de acesso (RLS por CNPJ).
-- A Nervia libera o app para cada login em Área do Cliente → Administração → Logins.
insert into public.apps (id, nome, descricao, url, icone, ordem, cartao_url, manual_url)
values ('painel-nf', 'Painel de Notas',
        'Compras e vendas por fornecedor, mês e período, a partir das notas baixadas.',
        '/apps/painel-nf/', 'PN', 20,
        '/apps/painel-nf/ajuda/cartao.html', '/apps/painel-nf/ajuda/manual.html')
on conflict (id) do nothing;
