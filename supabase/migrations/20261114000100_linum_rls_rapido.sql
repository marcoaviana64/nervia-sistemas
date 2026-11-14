-- Sistema Linum 2.51 — leitura mais rápida (pedido do Marco em 14/11/2026: "a aba Produtos está demorando muito para liberar a tela").
--
-- Causa: as regras de leitura (RLS) das tabelas lin_* chamavam a função de permissão (lin_eh_dono(), lin_papel(), lin_vende()…)
-- direto na condição. Como são funções SECURITY DEFINER, o Postgres não consegue "embutir" a chamada e roda a função
-- UMA VEZ POR LINHA (cada vez consultando perfis, lin_membros, app_acessos e o horário). Com 3.855 variações, a tela de
-- Produtos levava ~2,5 s por página de 1.000 linhas (4 páginas seguidas).
--
-- Correção recomendada pelo Supabase ("RLS performance": envolver a função num SELECT): com (select f()) o Postgres calcula
-- a permissão uma vez por consulta (initPlan). As funções não recebem nada da linha e são STABLE, então o resultado é o
-- mesmo: quem pode ler o quê NÃO muda. Medido no banco em 14/11/2026, como Dono: 1.000 variações 2.519 ms → 3 ms.
--
-- Só altera as regras (alter policy); nenhum dado é lido ou alterado. Tabelas cuja regra depende de outra tabela
-- (lin_venda_itens, lin_troca_itens: EXISTS na venda/troca) ficam como estão e ganham pela regra da tabela de cima.

alter policy lin_ajuste_eventos_ler      on public.lin_ajuste_eventos      using ((select public.lin_vende()));
alter policy lin_ajustes_ler             on public.lin_ajustes             using ((select public.lin_vende()));
alter policy lin_benef_itens_ler         on public.lin_benef_itens         using ((select public.lin_controla_estoque()));
alter policy lin_benef_retornos_ler      on public.lin_benef_retornos      using ((select public.lin_controla_estoque()));
alter policy lin_benef_valores_ler       on public.lin_benef_valores       using ((select public.lin_controla_estoque()) and (select public.lin_pode('producao_valores')));
alter policy lin_beneficiamentos_ler     on public.lin_beneficiamentos     using ((select public.lin_controla_estoque()));
alter policy lin_classificacoes_ler      on public.lin_classificacoes      using ((select public.lin_papel()) is not null);
alter policy lin_clientes_ler            on public.lin_clientes            using ((select public.lin_vende()));
alter policy lin_cond_baixas_ler         on public.lin_cond_baixas         using ((select public.lin_papel()) is not null);
alter policy lin_cond_itens_ler          on public.lin_cond_itens          using ((select public.lin_papel()) is not null);
alter policy lin_condicionais_ler        on public.lin_condicionais        using ((select public.lin_papel()) is not null);
alter policy lin_contatos_ler            on public.lin_contatos            using ((select public.lin_vende()));
alter policy lin_creditos_ler            on public.lin_creditos            using ((select public.lin_vende()));
alter policy lin_custos_ler              on public.lin_custos              using ((select public.lin_eh_dono()));
alter policy lin_estoque_ler             on public.lin_estoque             using ((select public.lin_eh_dono()));
alter policy lin_ger_consideracoes_ler   on public.lin_ger_consideracoes   using ((select public.lin_eh_dono()));
alter policy lin_ger_importacoes_ler     on public.lin_ger_importacoes     using ((select public.lin_eh_dono()));
alter policy lin_ger_lancamentos_ler     on public.lin_ger_lancamentos     using ((select public.lin_eh_dono()));
alter policy lin_ger_outras_ler          on public.lin_ger_outras_vendas   using ((select public.lin_eh_dono()));
alter policy lin_ger_rede_ler            on public.lin_ger_rede            using ((select public.lin_eh_dono()));
alter policy lin_ger_regras_ler          on public.lin_ger_regras          using ((select public.lin_eh_dono()));
alter policy lin_ger_terminais_ler       on public.lin_ger_terminais       using ((select public.lin_eh_dono()));
alter policy lin_lojas_ler               on public.lin_lojas               using ((select public.lin_papel()) is not null);
alter policy lin_membros_ler             on public.lin_membros             using (user_id = (select auth.uid()) or (select public.eh_admin()));
alter policy lin_movimentos_ler          on public.lin_movimentos          using ((select public.lin_controla_estoque()));
alter policy lin_notas_vendedora_ler     on public.lin_notas_vendedora     using ((select public.lin_eh_dono()) or ((select public.lin_vende()) and user_id = (select auth.uid())));
alter policy lin_precos_hist_ler         on public.lin_precos_hist         using ((select public.lin_eh_dono()));
alter policy lin_produtos_ler            on public.lin_produtos            using ((select public.lin_eh_dono()));
alter policy lin_qr_cadastros_ler        on public.lin_qr_cadastros        using ((select public.lin_eh_dono()));
alter policy lin_transferencia_itens_ler on public.lin_transferencia_itens using ((select public.lin_papel()) is not null);
alter policy lin_transferencias_ler      on public.lin_transferencias      using ((select public.lin_papel()) is not null);
alter policy lin_trocas_ler              on public.lin_trocas              using ((select public.lin_eh_dono()) or ((select public.lin_vende()) and atendente_id = (select auth.uid())));
alter policy lin_variantes_ler           on public.lin_variantes           using ((select public.lin_eh_dono()));
alter policy lin_vendas_ler              on public.lin_vendas              using ((select public.lin_eh_dono()) or ((select public.lin_vende()) and vendedora_id = (select auth.uid())));
alter policy lin_visitas_ler             on public.lin_visitas             using ((select public.lin_eh_dono()) or ((select public.lin_vende()) and por = (select auth.uid())));
