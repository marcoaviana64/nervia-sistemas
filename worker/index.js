// Worker do site da Nervia (nervia-site). As páginas continuam servidas direto como arquivos estáticos
// (site/); o worker só roda para /registrar-acesso (run_worker_first em wrangler.jsonc).
//
// /registrar-acesso: a página (site/acesso.js) avisa que foi aberta; aqui se acrescentam IP, país,
// estado e cidade que a Cloudflare entrega (CF-Connecting-IP, request.cf) e grava no Supabase
// (rpc site_registrar_acesso, com o segredo ACESSOS_SEGREDO). Responde 204 na hora; a gravação segue
// em segundo plano. Qualquer falha só perde a contagem: o site não é afetado.

const ORIGENS = /^https:\/\/(www\.)?nervia\.com\.br$|^https:\/\/nervia-site\.[a-z0-9-]+\.workers\.dev$/;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname !== "/registrar-acesso") return env.ASSETS.fetch(req);
    const vazio = (status) => new Response(null, { status, headers: { "cache-control": "no-store" } });
    if (req.method !== "POST") return vazio(405);
    const origem = req.headers.get("origin");
    if (origem && !ORIGENS.test(origem)) return vazio(403);
    let d = {};
    try { d = JSON.parse((await req.text()).slice(0, 2000)) || {}; } catch { /* corpo inválido: conta só a visita */ }
    if (!env.ACESSOS_SEGREDO || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return vazio(204);
    const cf = req.cf || {};
    const corpo = {
      p_segredo: env.ACESSOS_SEGREDO,
      p_ip: req.headers.get("cf-connecting-ip") || "",
      p_pais: cf.country || null,
      p_estado: cf.region || null,
      p_estado_sigla: cf.regionCode || null,
      p_cidade: cf.city || null,
      p_pagina: String(d.pagina || "/").slice(0, 200),
      p_origem: String(d.origem || "").slice(0, 200),
      p_navegador: (req.headers.get("user-agent") || "").slice(0, 300),
    };
    ctx.waitUntil(
      fetch(`${env.SUPABASE_URL}/rest/v1/rpc/site_registrar_acesso`, {
        method: "POST",
        headers: { apikey: env.SUPABASE_ANON_KEY, "content-type": "application/json" },
        body: JSON.stringify(corpo),
      }).then(async (r) => { if (!r.ok) console.log("site_registrar_acesso", r.status, (await r.text()).slice(0, 300)); })
        .catch((e) => console.log("site_registrar_acesso falhou", String(e))),
    );
    return vazio(204);
  },
};
