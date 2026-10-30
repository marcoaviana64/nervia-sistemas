// Versão e novidades de cada app, como o CLIENTE vê (pedido do Marco em 21/10/2026). A Área do Cliente (grade e barra
// do app aberto), o topo de cada app (quando aberto fora da Área do Cliente) e a página /ajuda/novidades.html leem daqui.
// SEM DATAS (decisão do Marco em 22/10/2026: data à vista dá impressão de app desatualizado). As datas ficam só no
// registro interno VERSOES.md, na raiz do repositório (fora de site/, não é publicado).
// Ao publicar uma mudança num app: linha NO TOPO da lista dele, com a versão seguinte (1.4 → 1.5; mudança grande → 2.0)
// e o que mudou em linguagem do cliente; a mesma linha, com a data, no VERSOES.md. A chave é o id do app (tabela apps).
window.NERVIA_VERSOES = {
  "notas": [
    ["1.8", "Baixar XMLs (.zip): os XMLs das notas marcadas ou, sem marcação, de toda a lista filtrada (período, tipo, fornecedor), num arquivo só."],
    ["1.7", "Recuperar NF-e anteriores: traz as NF-e dos últimos 90 dias que outro sistema da empresa já tinha baixado."],
    ["1.6", "Registro de auditoria das ações sensíveis (ciência, confirmação, certificado, termo, acessos), com comprovante para imprimir."],
    ["1.5", "O próprio cliente pode dar ciência (NF-e de até 10 dias) e confirmar a operação (até 90 dias)."],
    ["1.4", "Botão para ligar e desligar a busca de NF-e por empresa, com parada automática quando outro sistema já consulta o mesmo CNPJ."],
    ["1.3", "Termo de autorização e custódia do certificado A1: gerar, registrar e exigir antes do envio do certificado."],
    ["1.2", "Espelho para impressão (DANFE e DANFSe) e caixa de seleção em todas as linhas."],
    ["1.1", "Cartão de referência e manual de utilização."],
    ["1.0", "Lançamento: busca de hora em hora das NF-e (SEFAZ) e NFS-e (padrão nacional) recebidas pelos CNPJs da empresa."],
  ],
  "painel-nf": [
    ["1.1", "O painel passa a mostrar só as compras (notas recebidas)."],
    ["1.0", "Lançamento: compras por fornecedor, mês e período, com comparação ao mês e ao ano anterior, gráficos e CSV."],
  ],
  "telefonia": [
    ["1.0", "Lançamento: relatório das linhas móveis a partir das exportações do portal da operadora."],
  ],
  "compras": [
    ["1.7", "A aprovação automática nunca passa do limite do Gerente do setor: acima dele, a compra vai ao Gerente do setor (e ao Diretor, se passar do limite)."],
    ["1.6", "Aprovação por setor: cada compra diz de qual setor é (Financeiro, Marketing, Operações, Comercial…) e é aprovada pelo Gerente daquele setor; acima do limite dele, segue para o Diretor. O setor pode ter limite próprio."],
    ["1.5", "Oportunidades: abra a requisição para os fornecedores cadastrados na Plataforma Nervia, que veem só a cidade e o estado (nunca o nome da empresa) e mandam a proposta pelo mesmo link de cotação."],
    ["1.4", "Avaliação do fornecedor com os critérios escritos por extenso e legenda das notas."],
    ["1.3", "Dispensa de certidões pelo Gerente (por compra), base de fornecedores única com avaliações anônimas e compra pela internet (site e link, sempre com aval do Gerente)."],
    ["1.2", "Novos grupos de compra, cada um com a descrição do que entra nele."],
    ["1.1", "O fornecedor envia a proposta sozinho, sem login, pelo link do convite (WhatsApp ou e-mail), com PDF opcional."],
    ["1.0", "Lançamento: requisição, propostas, mapa comparativo, aprovação por alçada (Gerente e Diretor), pedido e avaliação do fornecedor."],
  ],
  "monitor": [
    ["1.1", "Link com \"Monitorar: Não\" sai do painel, das quedas e do relatório; painel com cartões agrupados por cliente, local ou sem grupos."],
    ["1.0", "Lançamento: status dos links e roteadores, histórico de quedas e relatório mensal de disponibilidade."],
  ],
  "licencas": [
    ["1.4", "A unidade de cada conta é identificada só pelo domínio do e-mail (a parte depois do @)."],
    ["1.3", "Cada carga vale só para as unidades do arquivo: exportações de empresas (tenants) diferentes convivem, até na mesma data."],
    ["1.2", "Ao aprovar a fatura enviada pelo formulário, só as unidades do link são trocadas."],
    ["1.1", "Formulário da fatura pelo link: o cliente informa as licenças pagas do mês, sem login, e a Nervia confere e aprova."],
    ["1.0", "Lançamento: contas e licenças de cada unidade, mudanças entre exportações e licenças pagas sem uso."],
  ],
  "atendimentos": [
    ["1.1", "Um filtro só para o Painel e a lista de chamados (busca, empreendimento, situação, tipo, ano e mês), que já vem no ano em curso: o que você filtra numa tela vale na outra, e os números e gráficos do Painel seguem o filtro. Os chamados em aberto aparecem sempre, de qualquer data, para nada que falta fazer ficar escondido; só o filtro de empreendimento os separa."],
    ["1.0", "Lançamento na Plataforma: os chamados de suporte de TI da Nervia por empreendimento, com o histórico de andamentos, a ficha do atendimento em PDF e os equipamentos com código e histórico de usuários."],
  ],
  "linum": [
    ["2.26", "Ficha da venda para imprimir ou salvar em PDF (botão “Imprimir ficha” na venda), no jeito do espelho da nota: loja, data, vendedora, dados da cliente, peças com preço de tabela, desconto e valor, totais, crédito usado e valor da nota fiscal, formas de pagamento, observações e linhas para assinatura. Venda cancelada sai marcada CANCELADA. Não é documento fiscal."],
    ["2.25", "Novo relatório Lucro (só a Dona e os administradores): no período, por peça, venda, vendedora, loja ou mês, mostra quanto queria vender (preço de etiqueta), por quanto vendeu (com os descontos), o desconto, o custo das peças (o custo do cadastro valendo no dia da venda) e o lucro direto, com margem e markup. Avisa as peças vendidas sem custo cadastrado. Baixar CSV e imprimir."],
    ["2.24", "Corrigir a data da venda (Dona e administradores): na boleta da venda, botão “Corrigir data”, com o motivo. Só a data muda — peças, valores, comissão e o histórico da cliente ficam como estão — e a correção fica registrada. Serve para a venda lançada depois com a data errada (a vendedora só consegue lançar até 7 dias atrás) ou para acertar as vendas antigas lançadas antes de começar a usar o sistema."],
    ["2.23", "As peças especiais (artesanal, bordada, pintada…) aparecem todas juntas num bloco próprio, separado das cores e tamanhos comuns — na lista de Produtos, na ficha do produto e nos cartões do Estoque. As buscas por nome acham a peça mesmo sem digitar os acentos (ex.: “calca” acha “Calça”)."],
    ["2.22", "Histórico de preços na ficha do produto (aba Produtos): cada mudança do preço de venda e do custo — da peça e das peças especiais (artesanal, bordada…) — fica registrada com o valor antes e depois, a data e hora em que passou a valer, de onde veio (cadastro ou ficha de custo) e quem fez. Os preços que já estavam cadastrados entram como início do histórico. Na ficha de custo, os itens aparecem do maior para o menor percentual."],
    ["2.21", "Trava para não atualizar a peça errada: uma ficha de versão (artesanal, bordada, blend…) só atualiza o cadastro depois que a peça especial é escolhida na ficha; antes disso o sistema avisa e não grava, para o preço da versão não ir para a peça normal."],
    ["2.20", "Ficha de custo de uma versão da peça (artesanal, bordada, pintada…): escolha na ficha a peça especial do cadastro em “Peça especial no cadastro”. A comparação e o “Atualizar no cadastro / em Produtos” passam a usar o preço dessas peças especiais e mudam só elas; a peça normal fica com o preço dela. A lista avisa quando a ficha parece ser de uma versão e ainda não tem a peça especial escolhida. Na ficha, o valor de venda (e a venda calculada pelo markup alvo) aparece em destaque ao lado do custo, e o Imprimir sai em uma folha deitada, com cabeçalho."],
    ["2.19", "Na aba Custos, em Planilha × Sistema, dá para marcar uma ou mais peças já conferidas e clicar em “Atualizar no cadastro”: a peça passa a ter o preço de venda e o custo da ficha, sem precisar digitar na aba Produtos. A lista mostra também o custo cadastrado no sistema e avisa quando mais de uma ficha é da mesma peça. Na ficha, o botão “Atualizar em Produtos” faz o mesmo para aquela peça e, se ela ainda não existe, “Criar em Produtos” cadastra a peça com referência, descrição, tecido, metragem, preço de venda e custo."],
    ["2.18", "Nova aba Custos (só o Dono): a ficha de custo de cada peça, como na planilha de custos — matéria-prima, risco, modelagem, corte, lavanderia, costura, aviamentos, passadoria, logística, comissão e pagamento —, com o custo total, o markup e a margem calculados enquanto digita, simulação de markup alvo e desconto, duplicar para simular, a tabela de todas as peças (CSV e impressão), margens e custos por faixa de markup e por tecido, e a comparação do preço da ficha com o preço cadastrado no sistema."],
    ["2.17", "Ao cadastrar um produto sem referência, a referência provisória (NOVA-…) já aparece no campo depois de salvar; antes, salvar de novo (por exemplo, para acrescentar cores) dava a mensagem de referência faltando, embora o produto já estivesse gravado."],
    ["2.16", "Quem lê o QR code da LINUM (vitrine, sacola, cartão) pode deixar nome, WhatsApp e aniversário na página e já entra em Clientes como possível cliente, com a origem e o próximo contato para o dia seguinte; filtro “Vieram pelo QR code” e a etiqueta QR na lista."],
    ["2.15", "Referência provisória: cadastre o produto mesmo sem saber a referência (deixe o campo vazio e o sistema dá uma provisória, NOVA-…); o botão “Referência provisória” no Estoque e em Produtos mostra só essas peças, para trocar pela correta depois (o código de barras não muda)."],
    ["2.14", "Relatório de créditos das clientes (aba Créditos, só para a Dona): saldo em aberto de todas as clientes, quem tem crédito, e os lançamentos do período (devoluções, uso em vendas, ajustes) com filtros, CSV e impressão; clicar na cliente abre o extrato dela."],
    ["2.13", "Cadastro mais rápido: o campo Tamanhos já vem com a grade da Linum (PP, P, M, G, GG, G1, G2); é só apagar os que a peça não tem e digitar as cores. Vale também para a peça nova e as cores e tamanhos da ficha de produção. G1 e G2 aparecem depois do GG no estoque."],
    ["2.12", "No Estoque, cada peça aparece num cartão só, com as lojas separadas por uma linha tracejada discreta (antes era um cartão por loja)."],
    ["2.11", "Correção de cor e tamanho: em Produtos, o botão Editar de cada cor/tamanho deixa corrigir a cor e o tamanho digitados errado (além do preço e da edição), sem perder o histórico de estoque; tudo fica no registro de auditoria. Peças especiais marcadas com uma estrela dourada no Estoque e em Produtos (e no nome da peça que tem alguma especial)."],
    ["2.10", "Peça especial com várias cores e tamanhos de uma vez: separe por vírgula (ex.: PP, P, M, G, GG) e cada cor × tamanho vira uma peça especial com o mesmo preço e código de barras próprio; o preço de cada uma pode ser mudado depois."],
    ["2.9", "Horário de trabalho: cada pessoa da equipe só abre o sistema no horário dela (dias da semana, entrada e saída), de qualquer aparelho; abre 15 minutos antes e fecha 15 minutos depois. O Dono define na aba Horários e pode dar uma liberação extra (hora extra, inventário, evento). Fora do horário nada abre, e a tentativa fica registrada."],
    ["2.8", "Ajustes da peça vendida (bainha, apertar lateral ou cava…): na venda, \"Ajuste\" na peça escolhe a costureira, o que fazer, a data de volta (10 dias úteis depois da compra) e o valor. A aba Ajustes mostra o que está com a costureira, os atrasados e os prontos, com WhatsApp para a costureira e para avisar a cliente. Observações para a costureira e ficha de ajuste para imprimir ou salvar em PDF (uma peça ou todas as de uma costureira)."],
    ["2.7", "Produção mais simples: só corte e costura têm remessa e conferência; depois da costura as peças já entram no estoque. Lavagem e passadoria viram caixas de marcação na ficha (opcional)."],
    ["2.6", "Ranking das vendedoras sem a nota da Dona: a nota final passa a ser a média de três critérios (vendas, cliente na venda e acompanhamento)."],
    ["2.5", "Peça nova direto na ficha de produção: \"+ Peça nova\" cria a peça que ainda não está no cadastro (nome, referência ou automática, metros por peça, cores e tamanhos), com estoque zero até a produção entregar; preço e outros dados podem ficar para depois. E \"+ cores e tamanhos\" acrescenta cores ou tamanhos a uma peça já cadastrada."],
    ["2.4", "Troca e devolução com crédito na conta da cliente: a peça devolvida volta ao estoque e o valor vira crédito; na nova venda o sistema mostra o saldo e abate se a cliente quiser (compra maior, ela paga a diferença; menor, o saldo fica para depois). A boleta mostra o valor da nota fiscal sem o crédito. Na ficha da cliente, o crédito e o extrato; o Dono pode ajustar (ex.: vale-troca de papel). O estoque se atualiza sozinho ao voltar para a janela (e a cada 3 minutos), sem precisar recarregar a página."],
    ["2.3", "Rolos de tecido com a composição (100% Linho, 98,5% Algodão 1,5% Elastano…), sugerida pela descrição da nota na importação e no \"Preencher cor e composição\". Registro das alterações (auditoria): o comprovante mostra só o que mudou, campo por campo, com o antes e o depois; salvar uma peça sem mudar nada (por exemplo, ao acrescentar cores e tamanhos) não aparece mais como alteração."],
    ["2.2", "Rolos de tecido: agora dá para corrigir os dados de cada rolo (tecido, cor, fornecedor, nota, data, observações e, para quem vê valores, o valor pago) em \"Editar dados do rolo\". Como a nota fiscal não tem campo de cor, a importação do XML já sugere a cor pela descrição do item, e o botão \"Preencher cores\" completa de uma vez os rolos que ficaram sem cor."],
    ["2.1", "Compra de tecido pelo XML da nota fiscal: o sistema lê fornecedor, número, data e os itens (quantidade, unidade e valor), e você confere a cor e quantos rolos vieram; a mesma nota não entra duas vezes. Tecido comprado por quilo: o rolo fica em quilos e ganha o rendimento (quantos metros dá 1 kg), e a peça continua medida em metros. Na ficha, a metragem trocada pode ser gravada no cadastro com \"Atualizar na peça\". Mapa mental da produção, do rolo de tecido à peça na loja, com botão na aba Produção."],
    ["2.0", "Produção: rolos de linho (compra, saldo em metros e histórico), metragem por peça, fichas de produção com várias peças, e o caminho de cada peça — corte, costura, lavagem e passadoria — com quem está, prazo, conferência na volta (boas e perdidas, com motivo) e a sobra de linho voltando ao rolo. As peças prontas entram no estoque da loja. Parceiros com preço por peça, custo de cada peça e quanto pagar no mês. Novas permissões além do papel: Produção e Valores da produção (só quem tem a segunda vê valores)."],
    ["1.11", "Ranking das vendedoras, por mês e por ano: nota de 1 a 5 pela média de quatro critérios — vendas, cliente identificada na venda, acompanhamento no CRM (contatos, visitas e clientes cadastradas) e a nota da Dona. Destaque para a vendedora do mês e do ano. Todas veem a classificação; valores em reais só o Dono e cada uma os seus."],
    ["1.10", "A venda entra sozinha no acompanhamento da cliente: cada compra aparece no histórico de contatos (loja, número e peças; o valor, só o Dono vê) e marca o contato de pós-venda para 7 dias depois, para perguntar se ela gostou (se já houver contato marcado antes, ele fica). Venda cancelada também aparece no histórico e tira o pós-venda que tinha marcado."],
    ["1.9", "Visita sem contato: quando alguém entra, olha e sai sem comprar e sem deixar contato, a vendedora registra por que não levou (pode marcar mais de um motivo; em \"Outro\", escreve qual), o que faltou (tamanho, cor) e as peças que olhou, sem dados da pessoa. O período mostra a conversão, os motivos e as peças mais olhadas sem venda."],
    ["1.8", "CRM de clientes: cada cliente ou possível cliente (quem ainda não comprou) tem uma ficha com o histórico de contatos (WhatsApp, ligação, Instagram, na loja), o resultado de cada um e a data do próximo contato. A aba Clientes mostra quem está para contatar hoje ou atrasado, quem cada pessoa acompanha, como a cliente conheceu a Linum e os interesses dela. Quem compra vira cliente sozinho."],
    ["1.7", "Relatório de comissões por mês (só o Dono): quanto cada pessoa vendeu e recebe de comissão no mês, com as vendas de cada uma, filtro por loja, os últimos 12 meses lado a lado, CSV e impressão. As vendedoras ainda não veem este relatório."],
    ["1.6", "Cliente na venda: nome e telefone podem ser digitados juntos no mesmo campo (a busca e o cadastro novo separam sozinhos), e acento ou maiúscula não atrapalham a busca. Ao cadastrar cliente com o mesmo nome ou telefone de alguém já cadastrado, o sistema pergunta se é a mesma pessoa, para não duplicar."],
    ["1.5", "Troca: a cliente devolve uma peça (de uma venda do sistema ou de compra antiga) e leva outra; a peça devolvida volta ao estoque da loja da troca e a levada sai. A diferença é paga pela cliente ou devolvida pela loja (dinheiro, Pix, estorno ou vale-troca). A comissão da venda não muda, e só o Dono cancela uma troca."],
    ["1.4", "Todos da equipe vendem, em qualquer loja (a loja principal vem marcada), e cada um vê só as próprias vendas; o Dono vê as de todos. Comissão em % por pessoa (0 = sem comissão), guardada em cada venda e mostrada no período."],
    ["1.3", "Vendas e Clientes: a boleta de venda no sistema, com cliente, peças pelo código de barras, desconto por peça ou geral, parcelas e mais de uma forma de pagamento; a venda dá baixa no estoque, e só o Dono cancela (as peças voltam). Cadastro de clientes com telefone, aniversário e histórico de compras."],
    ["1.2", "Novo papel Estoque: cadastra peças, altera o preço de venda e movimenta o estoque sem ver o preço de custo. Toda movimentação e alteração de cadastro fica no registro de auditoria."],
    ["1.1", "Mapa mental do sistema: do acesso ao cadastro, ao estoque e à consulta, numa página para imprimir."],
    ["1.0", "Lançamento: cadastro de produtos (cores, tamanhos, peças especiais e código de barras) e estoque das lojas por produto, cor e tamanho; o Dono registra entrada, saída, transferência e ajuste, com histórico."],
  ],
};

// "versão 1.4" (vazio se o app não está na lista)
window.nerviaVersao = function (app) {
  const v = (window.NERVIA_VERSOES[app] || [])[0];
  return v ? `versão ${v[0]}` : "";
};

// preenche <span data-versao="id_do_app"> no topo dos apps, com link para as novidades
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-versao]").forEach(el => {
    const t = window.nerviaVersao(el.dataset.versao);
    if (!t) return;
    const a = document.createElement("a");
    a.href = "/ajuda/novidades.html?app=" + encodeURIComponent(el.dataset.versao); a.target = "_blank"; a.rel = "noopener";
    a.textContent = t; a.title = "Ver as novidades"; a.style.color = "inherit";
    el.replaceChildren(a);
  });
});
