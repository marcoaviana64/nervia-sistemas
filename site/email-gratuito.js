// E-mail de domínio gratuito (gmail, hotmail, outlook…) passa menos confiança num fornecedor (pedido do Marco em
// 04/11/2026). Usado pelo Orçamentos de Compras (−1 ponto na nota de qualidade da matriz e etiqueta no mapa),
// pela página da cotação (/cotacao/) e pela página de cadastro de fornecedores (/fornecedores/), que avisam o
// fornecedor na hora em que ele digita. A lista é dos provedores gratuitos mais usados no Brasil.
(function () {
  const DOMINIOS = new Set([
    "gmail.com", "googlemail.com", "hotmail.com", "hotmail.com.br", "outlook.com", "outlook.com.br", "live.com",
    "live.com.br", "msn.com", "yahoo.com", "yahoo.com.br", "ymail.com", "rocketmail.com", "bol.com.br", "uol.com.br",
    "terra.com.br", "ig.com.br", "globo.com", "globomail.com", "zipmail.com.br", "r7.com", "oi.com.br",
    "icloud.com", "me.com", "mac.com", "aol.com", "protonmail.com", "proton.me", "pm.me", "gmx.com", "gmx.net",
    "mail.com", "zoho.com", "zohomail.com", "yandex.com", "tutanota.com", "tuta.io",
  ]);
  const AVISO = "E-mail de domínio gratuito (como Gmail ou Hotmail) passa menos confiança às empresas compradoras e "
    + "reduz a sua pontuação na comparação das propostas. Se a sua empresa tiver e-mail com domínio próprio "
    + "(ex.: vendas@suaempresa.com.br), use esse.";
  function gratuito(email) {
    const m = /@([^@\s]+)$/.exec(String(email || "").trim().toLowerCase());
    return !!m && DOMINIOS.has(m[1].replace(/\.$/, ""));
  }
  // liga o aviso a um campo de e-mail: mostra o texto (padrão: o aviso ao fornecedor) logo abaixo enquanto o e-mail
  // for de domínio gratuito
  function avisar(input, texto) {
    if (!input) return;
    const div = document.createElement("div");
    div.className = "aviso-email";
    div.setAttribute("role", "status");
    div.style.cssText = "display:none;margin-top:6px;padding:8px 10px;border-radius:8px;background:#fff4d6;color:#7a4d00;font-size:.85rem;line-height:1.35";
    div.textContent = texto || AVISO;
    input.insertAdjacentElement("afterend", div);
    const ver = () => { div.style.display = gratuito(input.value) ? "block" : "none"; };
    input.addEventListener("input", ver); input.addEventListener("change", ver); ver();
  }
  window.NERVIA_EMAIL = { gratuito, avisar, AVISO, DOMINIOS };
})();
