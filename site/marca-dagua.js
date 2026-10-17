// Marca d'água da Nervia (pedido do Marco, 2026-10-17). Texto diagonal repetido, claro, que não atrapalha a leitura
// nem os cliques, para que prints, cópias e impressões mostrem que é um produto da Nervia. É um <svg> fixo
// (conteúdo, não fundo), então também sai na impressão, em todas as folhas, com o crédito na margem de baixo.
// Uso: <script src="/marca-dagua.js" data-tipo="demo"></script>  — páginas de /demo/ (dados fictícios)
//      <script src="/marca-dagua.js" data-tipo="doc"></script>   — cartões, manuais e mapas mentais dos apps
(function () {
  "use strict";
  var el = document.currentScript, tipo = (el && el.getAttribute("data-tipo")) || "demo";
  var MODELO = {
    demo: { texto: "DEMONSTRAÇÃO · NERVIA TECNOLOGIA · nervia.com.br", opacidade: 0.10,
      rodape: "Demonstração com dados fictícios · Aplicativo criado pela Nervia Tecnologia · nervia.com.br · Não é um sistema real; ao mostrar, cite a Nervia." },
    doc: { texto: "ECOSSISTEMA NERVIA APP · NERVIA TECNOLOGIA · nervia.com.br", opacidade: 0.07,
      rodape: "Documentação de um aplicativo do Ecossistema Nervia App · Nervia Tecnologia · nervia.com.br · Material da Nervia: ao reproduzir, cite a fonte." },
  }[tipo];
  if (!MODELO) return;
  // página aberta dentro de outra que já tem a marca (app no portal de demonstração, ajuda no painel lateral da demo):
  // a marca de fora cobre a tela, então não repete
  if (window.self !== window.top) {
    try { if (window.top.document.getElementById("nervia-marca")) return; } catch (e) { /* outro domínio: mostra */ }
  }

  function montar() {
    if (document.getElementById("nervia-marca")) return;
    var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("id", "nervia-marca");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var t = function (x, y) {
      return '<text x="' + x + '" y="' + y + '" font-family="Inter,system-ui,Segoe UI,Roboto,sans-serif" font-size="18" font-weight="700" letter-spacing="2">' + MODELO.texto + "</text>";
    };
    svg.innerHTML = '<defs><pattern id="nervia-marca-p" width="900" height="250" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)">'
      + '<g fill="#5f7286" fill-opacity="' + MODELO.opacidade + '">' + t(10, 60) + t(460, 185) + "</g></pattern></defs>"
      + '<rect width="100%" height="100%" fill="url(#nervia-marca-p)"/>';
    var css = document.createElement("style");
    css.id = "nervia-marca-css";
    // crédito na impressão: na margem de baixo de cada folha (caixa de margem do @page, Chrome/Edge), sem cobrir o conteúdo;
    // onde o navegador não tem esse recurso, a própria marca d'água já leva "Nervia Tecnologia · nervia.com.br"
    css.textContent = "#nervia-marca{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;user-select:none;z-index:2147483000}"
      + "@media print{#nervia-marca{-webkit-print-color-adjust:exact;print-color-adjust:exact}}"
      + "@page{margin-bottom:12mm;@bottom-center{content:" + JSON.stringify(MODELO.rodape) + ";font:600 7.5pt Inter,system-ui,sans-serif;color:#33475b;vertical-align:middle}}";
    document.head.appendChild(css);
    document.body.appendChild(svg);
  }
  if (document.body) montar(); else document.addEventListener("DOMContentLoaded", montar);
})();
