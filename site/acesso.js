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
    // ?o= = de onde veio a leitura de um QR code (ex.: /linum/?o=ipanema); utm_source continua valendo
    var p = new URLSearchParams(location.search), origem = p.get("utm_source") || p.get("o") || "";
    if (!origem && document.referrer) {
      try { var r = new URL(document.referrer); if (r.hostname !== location.hostname) origem = r.hostname; } catch (e) {}
    }
    var registrar = function (pagina) {
      fetch("/registrar-acesso", { method: "POST", keepalive: true, headers: { "content-type": "text/plain" },
        body: JSON.stringify({ pagina: pagina, origem: origem }) }).catch(function () {});
    };
    registrar(location.pathname);
    // a página pode contar também os cliques (ex.: botão do WhatsApp), com a mesma origem
    window.NERVIA_REGISTRAR = function (pagina) { try { registrar(String(pagina).slice(0, 200)); } catch (e) {} };
  } catch (e) { /* a contagem nunca atrapalha a página */ }
})();
