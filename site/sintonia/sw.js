// NVSintonia: permite instalar na tela inicial e abrir a última versão salva quando estiver sem internet.
// Sempre tenta a rede primeiro (a versão nova entra na hora); só páginas e arquivos do próprio site (nada do banco).
const CACHE = "sintonia-v2";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin) return;
  // sem usar a cópia do navegador: confere sempre com o site, para a versão nova entrar na hora
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((r) => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
