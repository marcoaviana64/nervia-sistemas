// Versão e novidades de cada app (pedido do Marco em 21/10/2026). Fonte única: a Área do Cliente (barra do app aberto),
// o topo de cada app (quando aberto fora da Área do Cliente) e a página /ajuda/novidades.html leem daqui.
// Ao publicar uma mudança num app: acrescente a linha NO TOPO de "novidades" dele, com a versão seguinte
// (1.4 → 1.5; mudança grande → 2.0), a data e o que mudou em linguagem do cliente.
// A chave é o id do app (tabela apps).
window.NERVIA_VERSOES = {
  "notas": [
    ["1.7", "2026-10-14", "Recuperar NF-e anteriores: traz as NF-e dos últimos 90 dias que outro sistema da empresa já tinha baixado."],
    ["1.6", "2026-10-14", "Registro de auditoria das ações sensíveis (ciência, confirmação, certificado, termo, acessos), com comprovante para imprimir."],
    ["1.5", "2026-10-14", "O próprio cliente pode dar ciência (NF-e de até 10 dias) e confirmar a operação (até 90 dias)."],
    ["1.4", "2026-10-14", "Botão para ligar e desligar a busca de NF-e por empresa, com parada automática quando outro sistema já consulta o mesmo CNPJ."],
    ["1.3", "2026-10-14", "Termo de autorização e custódia do certificado A1: gerar, registrar e exigir antes do envio do certificado."],
    ["1.2", "2026-10-14", "Espelho para impressão (DANFE e DANFSe) e caixa de seleção em todas as linhas."],
    ["1.1", "2026-10-14", "Cartão de referência e manual de utilização."],
    ["1.0", "2026-10-13", "Lançamento: busca de hora em hora das NF-e (SEFAZ) e NFS-e (padrão nacional) recebidas pelos CNPJs da empresa."],
  ],
  "painel-nf": [
    ["1.1", "2026-10-14", "O painel passa a mostrar só as compras (notas recebidas)."],
    ["1.0", "2026-10-14", "Lançamento: compras por fornecedor, mês e período, com comparação ao mês e ao ano anterior, gráficos e CSV."],
  ],
  "telefonia": [
    ["1.0", "2026-10-15", "Lançamento: relatório das linhas móveis a partir das exportações do portal da operadora."],
  ],
  "compras": [
    ["1.4", "2026-10-20", "Avaliação do fornecedor com os critérios escritos por extenso e legenda das notas."],
    ["1.3", "2026-10-20", "Dispensa de certidões pelo Gerente (por compra), base de fornecedores única com avaliações anônimas e compra pela internet (site e link, sempre com aval do Gerente)."],
    ["1.2", "2026-10-17", "Novos grupos de compra, cada um com a descrição do que entra nele."],
    ["1.1", "2026-10-17", "O fornecedor envia a proposta sozinho, sem login, pelo link do convite (WhatsApp ou e-mail), com PDF opcional."],
    ["1.0", "2026-10-16", "Lançamento: requisição, propostas, mapa comparativo, aprovação por alçada (Gerente e Diretor), pedido e avaliação do fornecedor."],
  ],
  "monitor": [
    ["1.1", "2026-10-20", "Link com \"Monitorar: Não\" sai do painel, das quedas e do relatório; painel com cartões agrupados por cliente, local ou sem grupos."],
    ["1.0", "2026-10-17", "Lançamento: status dos links e roteadores, histórico de quedas e relatório mensal de disponibilidade."],
  ],
  "licencas": [
    ["1.4", "2026-10-21", "A unidade de cada conta é identificada só pelo domínio do e-mail (a parte depois do @)."],
    ["1.3", "2026-10-21", "Cada carga vale só para as unidades do arquivo: exportações de empresas (tenants) diferentes convivem, até na mesma data."],
    ["1.2", "2026-10-21", "Ao aprovar a fatura enviada pelo formulário, só as unidades do link são trocadas."],
    ["1.1", "2026-10-21", "Formulário da fatura pelo link: o cliente informa as licenças pagas do mês, sem login, e a Nervia confere e aprova."],
    ["1.0", "2026-10-21", "Lançamento: contas e licenças de cada unidade, mudanças entre exportações e licenças pagas sem uso."],
  ],
};

// "versão 1.4 · 21/10/2026" (vazio se o app não está na lista)
window.nerviaVersao = function (app) {
  const v = (window.NERVIA_VERSOES[app] || [])[0];
  return v ? `versão ${v[0]} · ${v[1].split("-").reverse().join("/")}` : "";
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
