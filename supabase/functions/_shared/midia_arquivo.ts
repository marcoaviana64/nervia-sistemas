// Mídia Indoor — download PELA NERVIA (caminho alternativo, desde 18/11/2026).
// A TV baixa direto do Google Drive; quando a rede do local recusa o Google (na Linum Gávea, internet Nio: 403 em todos
// os downloads, e no 4G do celular funcionou), a TV pede o arquivo à função midia-tv, que busca no Drive com a chave
// (que fica só no servidor) e repassa os bytes sem guardar nada. O cabeçalho Range passa adiante, então o download
// interrompido continua de onde parou (Edge Function: até 400 s por pedido no plano pago, doc "Edge Functions limits").
// Custo: tráfego de saída das funções conta na cota do plano (Pro: 250 GB/mês incluídos; acima, US$ 0,09/GB, doc
// "Manage Egress usage", conferida em 18/11/2026). Por isso é só o caminho alternativo: o direto continua sendo o padrão.
// Só repassa arquivo aprovado (situacao ok) de uma playlist da conta da TV, com a conta ativa.

export interface MidiaDaTv { drive_id: string; chave: string; tamanho: number; mime: string }

/** Confere o pedido e devolve o arquivo (ou null = não é desta TV). */
export type AcharMidia = (telaId: string, driveId: string) => Promise<MidiaDaTv | null>;

const API = "https://www.googleapis.com/drive/v3/files";
const PASSAR = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

export async function repassarArquivo(
  telaId: string, driveId: string, range: string | null, chaveApi: string, achar: AcharMidia, buscar: typeof fetch = fetch,
): Promise<Response> {
  const json = (corpo: unknown, status: number) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(driveId)) return json({ ok: false, mensagem: "Arquivo inválido." }, 400);
  const m = await achar(telaId, driveId);
  if (!m) return json({ ok: false, mensagem: "Este arquivo não está na playlist desta TV." }, 404);
  const u = new URL(`${API}/${encodeURIComponent(m.drive_id)}`);
  u.searchParams.set("alt", "media");
  u.searchParams.set("supportsAllDrives", "true");
  u.searchParams.set("key", chaveApi);
  const h: Record<string, string> = {};
  if (m.chave) h["X-Goog-Drive-Resource-Keys"] = `${m.drive_id}/${m.chave}`;
  if (range && /^bytes=\d+-\d*$/.test(range)) h["Range"] = range;
  const r = await buscar(u, { headers: h });
  if (r.status !== 200 && r.status !== 206) {
    let msg = "";
    try { msg = (await r.json())?.error?.message ?? ""; } catch { /* não é JSON */ }
    return json({ ok: false, mensagem: `Google Drive respondeu ${r.status} ao servidor da Nervia${msg ? ": " + msg : ""}` }, r.status === 416 ? 416 : 502);
  }
  const out = new Headers();
  for (const k of PASSAR) { const v = r.headers.get(k); if (v) out.set(k, v); }
  if (!out.get("content-type")) out.set("content-type", m.mime || "application/octet-stream");
  out.set("cache-control", "no-store");
  return new Response(r.body, { status: r.status, headers: out });
}
