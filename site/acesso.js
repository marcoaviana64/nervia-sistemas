// Contagem de acessos do site público da Nervia (e da demonstração). Avisa o worker que a página abriu;
// IP, estado e cidade quem acrescenta é a Cloudflare, no worker. Sem cookies. Ver /privacidade.html.
// Não conta: páginas dentro de iframe, navegador automatizado, robôs, a equipe Nervia (marcada ao entrar
// como admin na Área do Cliente) e endereços que não sejam o domínio da Nervia (testes locais).
(function () {
  try {
    if (window.self !== window.top || (navigator.webdriver && !window.NERVIA_ACESSO_TESTE)) return;
    if (!window.NERVIA_ACESSO_TESTE && /bot|crawl|spider|slurp|headless|lighthouse|preview/i.test(navigator.userAgent)) return;
    try { if (localStorage.getItem("nervia-nao-contar") === "1") return; } catch (e) { /* sem armazenamento: conta */ }
    var hosts = window.NERVIA_ACESSO_TESTE ? /.*/ : /(^|\.)nervia\.com\.br$|^nervia-site\.[a-z0-9-]+\.workers\.dev$/;
    if (!hosts.test(location.hostname)) return;
    var p = new URLSearchParams(location.search), origem = p.get("utm_source") || "";
    if (!origem && document.referrer) {
      try { var r = new URL(document.referrer); if (r.hostname !== location.hostname) origem = r.hostname; } catch (e) {}
    }
    fetch("/registrar-acesso", { method: "POST", keepalive: true, headers: { "content-type": "text/plain" },
      body: JSON.stringify({ pagina: location.pathname, origem: origem }) }).catch(function () {});
  } catch (e) { /* a contagem nunca atrapalha a página */ }
})();
