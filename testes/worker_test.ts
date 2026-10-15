// Teste do worker do site (worker/index.js): páginas vão para os arquivos estáticos; /registrar-acesso
// grava no Supabase com IP e local da Cloudflare. Uso: deno test -A testes/worker_test.ts
import nodeAssert from "node:assert/strict";
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepEqual(a, b);
import worker from "../worker/index.js";

function ambiente(segredo = "S") {
  const enviados: { url: string; corpo: Record<string, unknown>; apikey: string | null }[] = [];
  const pendentes: Promise<unknown>[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    enviados.push({ url, corpo: JSON.parse(String(init.body)), apikey: new Headers(init.headers).get("apikey") });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const env = { ACESSOS_SEGREDO: segredo, SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "sb_publishable_x",
    ASSETS: { fetch: () => new Response("estatico") } };
  const ctx = { waitUntil: (p: Promise<unknown>) => pendentes.push(p) };
  return { env, ctx, enviados, pendentes };
}
function pedido(origem = "https://nervia.com.br", corpo = '{"pagina":"/demo/","origem":"whatsapp"}') {
  const r = new Request("https://nervia.com.br/registrar-acesso", { method: "POST", body: corpo,
    headers: { origin: origem, "cf-connecting-ip": "189.10.20.30", "user-agent": "Mozilla/5.0 (iPhone)" } });
  Object.defineProperty(r, "cf", { value: { country: "BR", region: "Rio de Janeiro", regionCode: "RJ", city: "Niterói" } });
  return r;
}

Deno.test("páginas seguem para os arquivos estáticos", async () => {
  const { env, ctx, enviados } = ambiente();
  const r = await worker.fetch(new Request("https://nervia.com.br/"), env, ctx);
  assertEquals(await r.text(), "estatico");
  assertEquals(enviados.length, 0);
});

Deno.test("registrar-acesso grava IP, local e página", async () => {
  const { env, ctx, enviados, pendentes } = ambiente();
  const r = await worker.fetch(pedido(), env, ctx);
  await Promise.all(pendentes);
  assertEquals(r.status, 204);
  assertEquals(enviados.length, 1);
  assertEquals(enviados[0].url, "https://x.supabase.co/rest/v1/rpc/site_registrar_acesso");
  assertEquals(enviados[0].apikey, "sb_publishable_x");
  const c = enviados[0].corpo;
  assertEquals([c.p_segredo, c.p_ip, c.p_estado_sigla, c.p_cidade, c.p_pagina, c.p_origem], ["S", "189.10.20.30", "RJ", "Niterói", "/demo/", "whatsapp"]);
});

Deno.test("outro site, GET ou sem segredo não grava", async () => {
  const a = ambiente();
  assertEquals((await worker.fetch(pedido("https://golpe.com"), a.env, a.ctx)).status, 403);
  assertEquals((await worker.fetch(new Request("https://nervia.com.br/registrar-acesso"), a.env, a.ctx)).status, 405);
  const b = ambiente("");
  assertEquals((await worker.fetch(pedido(), b.env, b.ctx)).status, 204);
  assertEquals(a.enviados.length + b.enviados.length, 0);
});

Deno.test("corpo inválido ainda conta a visita", async () => {
  const { env, ctx, enviados, pendentes } = ambiente();
  await worker.fetch(pedido("https://www.nervia.com.br", "xx"), env, ctx);
  await Promise.all(pendentes);
  assertEquals(enviados[0].corpo.p_pagina, "/");
});
