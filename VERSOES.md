# Versões dos apps — registro interno (NÃO publicado)

Uso interno da Nervia: data de cada versão. Fica fora de `site/`, então não vai para o ar. O que o cliente vê (número da versão e novidades, sem data) está em `site/versoes.js`.
Ao publicar mudança num app: linha nova no topo do app aqui (com a data) e em `site/versoes.js` (sem a data), com o mesmo número e texto.


## Buscador de NF (`notas`)

| Versão | Data | O que mudou |
|---|---|---|
| 1.7 | 14/10/2026 | Recuperar NF-e anteriores: traz as NF-e dos últimos 90 dias que outro sistema da empresa já tinha baixado. |
| 1.6 | 14/10/2026 | Registro de auditoria das ações sensíveis (ciência, confirmação, certificado, termo, acessos), com comprovante para imprimir. |
| 1.5 | 14/10/2026 | O próprio cliente pode dar ciência (NF-e de até 10 dias) e confirmar a operação (até 90 dias). |
| 1.4 | 14/10/2026 | Botão para ligar e desligar a busca de NF-e por empresa, com parada automática quando outro sistema já consulta o mesmo CNPJ. |
| 1.3 | 14/10/2026 | Termo de autorização e custódia do certificado A1: gerar, registrar e exigir antes do envio do certificado. |
| 1.2 | 14/10/2026 | Espelho para impressão (DANFE e DANFSe) e caixa de seleção em todas as linhas. |
| 1.1 | 14/10/2026 | Cartão de referência e manual de utilização. |
| 1.0 | 13/10/2026 | Lançamento: busca de hora em hora das NF-e (SEFAZ) e NFS-e (padrão nacional) recebidas pelos CNPJs da empresa. |

## Painel de Notas (`painel-nf`)

| Versão | Data | O que mudou |
|---|---|---|
| 1.1 | 14/10/2026 | O painel passa a mostrar só as compras (notas recebidas). |
| 1.0 | 14/10/2026 | Lançamento: compras por fornecedor, mês e período, com comparação ao mês e ao ano anterior, gráficos e CSV. |

## Auditoria de Telefonia Móvel (`telefonia`)

| Versão | Data | O que mudou |
|---|---|---|
| 1.0 | 15/10/2026 | Lançamento: relatório das linhas móveis a partir das exportações do portal da operadora. |

## Orçamentos de Compras (`compras`)

| Versão | Data | O que mudou |
|---|---|---|
| 1.7 | 22/10/2026 | A aprovação automática nunca passa do limite do Gerente do setor: acima dele, a compra vai ao Gerente do setor (e ao Diretor, se passar do limite). |
| 1.6 | 22/10/2026 | Aprovação por setor: cada compra diz de qual setor é (Financeiro, Marketing, Operações, Comercial…) e é aprovada pelo Gerente daquele setor; acima do limite dele, segue para o Diretor. O setor pode ter limite próprio. |
| 1.5 | 22/10/2026 | Oportunidades: abra a requisição para os fornecedores cadastrados na Plataforma Nervia, que veem só a cidade e o estado (nunca o nome da empresa) e mandam a proposta pelo mesmo link de cotação. |
| 1.4 | 20/10/2026 | Avaliação do fornecedor com os critérios escritos por extenso e legenda das notas. |
| 1.3 | 20/10/2026 | Dispensa de certidões pelo Gerente (por compra), base de fornecedores única com avaliações anônimas e compra pela internet (site e link, sempre com aval do Gerente). |
| 1.2 | 17/10/2026 | Novos grupos de compra, cada um com a descrição do que entra nele. |
| 1.1 | 17/10/2026 | O fornecedor envia a proposta sozinho, sem login, pelo link do convite (WhatsApp ou e-mail), com PDF opcional. |
| 1.0 | 16/10/2026 | Lançamento: requisição, propostas, mapa comparativo, aprovação por alçada (Gerente e Diretor), pedido e avaliação do fornecedor. |

## Monitor de Links (`monitor`)

| Versão | Data | O que mudou |
|---|---|---|
| 1.1 | 20/10/2026 | Link com "Monitorar: Não" sai do painel, das quedas e do relatório; painel com cartões agrupados por cliente, local ou sem grupos. |
| 1.0 | 17/10/2026 | Lançamento: status dos links e roteadores, histórico de quedas e relatório mensal de disponibilidade. |

## Contas e Licenças Microsoft 365 (`licencas`)

| Versão | Data | O que mudou |
|---|---|---|
| 1.4 | 21/10/2026 | A unidade de cada conta é identificada só pelo domínio do e-mail (a parte depois do @). |
| 1.3 | 21/10/2026 | Cada carga vale só para as unidades do arquivo: exportações de empresas (tenants) diferentes convivem, até na mesma data. |
| 1.2 | 21/10/2026 | Ao aprovar a fatura enviada pelo formulário, só as unidades do link são trocadas. |
| 1.1 | 21/10/2026 | Formulário da fatura pelo link: o cliente informa as licenças pagas do mês, sem login, e a Nervia confere e aprova. |
| 1.0 | 21/10/2026 | Lançamento: contas e licenças de cada unidade, mudanças entre exportações e licenças pagas sem uso. |

## Sistema Linum (`linum`)

| Versão | Data | O que mudou |
|---|---|---|
| 1.3 | 22/10/2026 | Vendas e Clientes: a boleta de venda no sistema, com cliente, peças pelo código de barras, desconto por peça ou geral, parcelas e mais de uma forma de pagamento; a venda dá baixa no estoque, e só o Dono cancela (as peças voltam). Cadastro de clientes com telefone, aniversário e histórico de compras. |
| 1.2 | 22/10/2026 | Novo papel Estoque: cadastra peças, altera o preço de venda e movimenta o estoque sem ver o preço de custo. Toda movimentação e alteração de cadastro fica no registro de auditoria. |
| 1.1 | 22/10/2026 | Mapa mental do sistema: do acesso ao cadastro, ao estoque e à consulta, numa página para imprimir. |
| 1.0 | 22/10/2026 | Lançamento: cadastro de produtos (cores, tamanhos, peças especiais e código de barras) e estoque das lojas por produto, cor e tamanho; o Dono registra entrada, saída, transferência e ajuste, com histórico. |
