// Conferência da assinatura dos ganchos do Supabase Auth (padrão Standard Webhooks):
// cabeçalhos webhook-id, webhook-timestamp e webhook-signature ("v1,<base64> v1,<base64>..."),
// HMAC-SHA256 de "<id>.<timestamp>.<corpo>" com o segredo (base64, depois de "v1,whsec_").

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const paraB64 = (a: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(a)));

export async function assinar(segredo: string, id: string, ts: string, corpo: string): Promise<string> {
  const chave = await crypto.subtle.importKey("raw", b64(segredo.replace(/^v1,/, "").replace(/^whsec_/, "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "v1," + paraB64(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(`${id}.${ts}.${corpo}`)));
}

/** Lança erro se a assinatura não confere ou se o pedido tem mais de 5 minutos (de diferença para mais ou para menos). */
export async function conferirAssinatura(segredo: string, h: Headers, corpo: string, agora = Date.now()): Promise<void> {
  const id = h.get("webhook-id"), ts = h.get("webhook-timestamp"), sig = h.get("webhook-signature");
  if (!segredo) throw new Error("SEND_EMAIL_HOOK_SECRET não configurado.");
  if (!id || !ts || !sig) throw new Error("Pedido sem assinatura.");
  if (!/^\d+$/.test(ts) || Math.abs(agora / 1000 - Number(ts)) > 300) throw new Error("Assinatura fora do prazo.");
  const esperada = await assinar(segredo, id, ts, corpo);
  const ok = sig.split(" ").some((s) => s.length === esperada.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ esperada.charCodeAt(i)), 0) === 0);
  if (!ok) throw new Error("Assinatura inválida.");
}
