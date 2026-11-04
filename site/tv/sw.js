// Mídia Indoor — guarda a página do reprodutor web para ela abrir mesmo com o computador sem internet
// (ligou o computador e a internet ainda não voltou). Rede primeiro: com internet sempre pega a versão nova.
// As mídias ficam em outro cache (mi-midias-v1, cuidado pelo tv.js) e não passam por aqui.
const PAGINA = "mi-pagina-v1";
const ARQUIVOS = ["/tv/", "/tv/tv.js", "/tv/qr.png", "/config.js", "/img/nervia-logo-branco.png", "/img/nervia-logo.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(PAGINA).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith("mi-pagina-") && k !== PAGINA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // Google Drive e Supabase: direto, sem cache aqui
  const caminho = url.pathname === "/tv/index.html" ? "/tv/" : url.pathname;
  if (!ARQUIVOS.includes(caminho)) return;
  e.respondWith((async () => {
    try {
      const r = await fetch(req, { cache: "no-store" });
      if (r.ok) (await caches.open(PAGINA)).put(caminho, r.clone());
      return r;
    } catch {
      return (await caches.match(caminho)) || Response.error();
    }
  })());
});
