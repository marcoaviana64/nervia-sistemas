// Versão e novidades de cada app, como o CLIENTE vê (pedido do Marco em 21/10/2026). A Área do Cliente (grade e barra
// do app aberto), o topo de cada app (quando aberto fora da Área do Cliente) e a página /ajuda/novidades.html leem daqui.
// SEM DATAS (decisão do Marco em 22/10/2026: data à vista dá impressão de app desatualizado). As datas ficam só no
// registro interno VERSOES.md, na raiz do repositório (fora de site/, não é publicado).
// Ao publicar uma mudança num app: linha NO TOPO da lista dele, com a versão seguinte (1.4 → 1.5; mudança grande → 2.0)
// e o que mudou em linguagem do cliente; a mesma linha, com a data, no VERSOES.md. A chave é o id do app (tabela apps).
window.NERVIA_VERSOES = {
  "notas": [
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
  "linum": [
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
