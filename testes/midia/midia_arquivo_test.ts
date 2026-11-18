// Download pela Nervia (caminho alternativo do app da TV): só arquivo da TV, Range repassado, erro do Drive claro.
// Rodar: deno test -A testes/midia/midia_arquivo_test.ts
import nodeAssert from "node:assert/strict";
import { repassarArquivo, type MidiaDaTv } from "../../supabase/functions/_shared/midia_arquivo.ts";

const eq = (a: unknown, b: unknown, m?: string) => nodeAssert.deepStrictEqual(a, b, m);
const ARQ = "1pOwWoYm2lOioxZWLxDiLsPMFBCSR7rmA";
const conteudo = new TextEncoder().encode("0123456789ABCDEFGHIJ");
const achar = (m: MidiaDaTv | null) => (_t: string, id: string) => Promise.resolve(id === ARQ ? m : null);
const MIDIA: MidiaDaTv = { drive_id: ARQ, chave: "", tamanho: 20, mime: "video/mp4" };

function drive(pedidos: { url: string; headers: Record<string, string> }[], status = 0) {
  return ((u: URL | string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    pedidos.push({ url: String(u), headers });
    if (status) return Promise.resolve(new Response(JSON.stringify({ error: { message: "The download quota for this file has been exceeded." } }), { status }));
    const m = /^bytes=(\d+)-(\d*)$/.exec(headers["Range"] ?? "");
    if (!m) return Promise.resolve(new Response(conteudo, { status: 200, headers: { "content-type": "video/mp4", "content-length": "20" } }));
    const ini = Number(m[1]), fim = m[2] ? Number(m[2]) : 19;
    return Promise.resolve(new Response(conteudo.slice(ini, fim + 1), { status: 206,
      headers: { "content-type": "video/mp4", "content-length": String(fim - ini + 1), "content-range": `bytes ${ini}-${fim}/20` } }));
  }) as typeof fetch;
}

Deno.test("arquivo da TV: repassa inteiro, com a chave só no servidor", async () => {
  const p: { url: string; headers: Record<string, string> }[] = [];
  const r = await repassarArquivo("t1", ARQ, null, "CHAVE", achar(MIDIA), drive(p));
  eq(r.status, 200);
  eq(new TextDecoder().decode(await r.arrayBuffer()), "0123456789ABCDEFGHIJ");
  eq(new URL(p[0].url).searchParams.get("key"), "CHAVE");
  eq(new URL(p[0].url).searchParams.get("alt"), "media");
  eq(r.headers.get("content-type"), "video/mp4");
});

Deno.test("Range: continua de onde parou (206 com content-range)", async () => {
  const p: { url: string; headers: Record<string, string> }[] = [];
  const r = await repassarArquivo("t1", ARQ, "bytes=15-", "CHAVE", achar(MIDIA), drive(p));
  eq(r.status, 206);
  eq(r.headers.get("content-range"), "bytes 15-19/20");
  eq(new TextDecoder().decode(await r.arrayBuffer()), "FGHIJ");
  eq(p[0].headers["Range"], "bytes=15-");
});

Deno.test("Range estranho não passa adiante", async () => {
  const p: { url: string; headers: Record<string, string> }[] = [];
  await (await repassarArquivo("t1", ARQ, "bytes=0-1,5-6", "CHAVE", achar(MIDIA), drive(p))).arrayBuffer();
  eq(p[0].headers["Range"], undefined);
});

Deno.test("resource key vai no cabeçalho do Drive", async () => {
  const p: { url: string; headers: Record<string, string> }[] = [];
  await (await repassarArquivo("t1", ARQ, null, "CHAVE", achar({ ...MIDIA, chave: "0-abc" }), drive(p))).arrayBuffer();
  eq(p[0].headers["X-Goog-Drive-Resource-Keys"], `${ARQ}/0-abc`);
});

Deno.test("arquivo que não é da TV: 404 sem chamar o Drive", async () => {
  const p: { url: string; headers: Record<string, string> }[] = [];
  const r = await repassarArquivo("t1", "1OutroArquivoQualquer99", null, "CHAVE", achar(MIDIA), drive(p));
  eq(r.status, 404);
  eq(p.length, 0);
  eq((await r.json()).mensagem, "Este arquivo não está na playlist desta TV.");
});

Deno.test("id inválido: 400 sem consultar o banco", async () => {
  let consultou = false;
  const r = await repassarArquivo("t1", "../../x", null, "CHAVE", () => { consultou = true; return Promise.resolve(MIDIA); }, drive([]));
  eq(r.status, 400);
  eq(consultou, false);
});

Deno.test("Drive recusa: 502 com a mensagem do Google", async () => {
  const r = await repassarArquivo("t1", ARQ, null, "CHAVE", achar(MIDIA), drive([], 403));
  eq(r.status, 502);
  eq((await r.json()).mensagem, "Google Drive respondeu 403 ao servidor da Nervia: The download quota for this file has been exceeded.");
});
