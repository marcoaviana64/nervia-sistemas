# Apresentação comercial dos aplicativos

PDF para possíveis clientes: `Nervia - Aplicativos de notas fiscais.pdf` (fica no OneDrive, em Projects\Nervia).

- `apresentacao.html`: o conteúdo (8 páginas A4 deitado). Preços na página "Planos".
- `capturar.py`: tira as telas dos apps com dados fictícios (`demo.js`: "Comercial Exemplo Ltda" e fornecedores inventados). Nunca usar dados de clientes reais.
- `pdf.py`: gera o PDF a partir do HTML.

Refazer: `python3 capturar.py` (precisa do Chart.js em /tmp/claude-0/cjs, como nos testes) e depois `python3 pdf.py`.
Ao mudar um app de forma visível, refazer as telas.
