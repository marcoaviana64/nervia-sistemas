-- Painel de Notas: só compras (a SEFAZ não entrega ao emitente as próprias NF-e; decisão do Marco, 2026-10-14).
update public.apps set descricao = 'Compras por fornecedor, mês e período, a partir das notas baixadas.'
where id = 'painel-nf' and descricao like 'Compras e vendas%';
