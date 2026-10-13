// Chamadas à SEFAZ (NF-e) pela "ponte" com OpenSSL (pasta ponte-sefaz/, hospedada no Google Cloud Run).
// Motivo: o servidor de NF-e da SEFAZ (IIS) pede o certificado do cliente por renegociação TLS, que o
// runtime das Edge Functions (rustls) não suporta. A NFS-e (ADN) não precisa: continua direto.
import type { CertGuardado } from "./certificado.ts";
import type { Http } from "./sefaz.ts";

/** NF-e fica ligada quando a ponte está configurada (ou à força com NFE_HABILITADA=true). */
export function nfeHabilitada(): boolean {
  return !!Deno.env.get("PONTE_URL") || Deno.env.get("NFE_HABILITADA") === "true";
}

export function temPonte(): boolean {
  return !!Deno.env.get("PONTE_URL");
}

/** Mesmo formato do fetch: quem chama (sefaz.ts) não sabe se passou pela ponte. */
export function httpViaPonte(g: CertGuardado, f: typeof fetch = fetch): Http {
  const url = Deno.env.get("PONTE_URL");
  const segredo = Deno.env.get("PONTE_SEGREDO") ?? "";
  if (!url) throw new Error("PONTE_URL não configurada.");
  return async (destino, init) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    let r: Response;
    try {
      r = await f(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ponte-segredo": segredo },
        body: JSON.stringify({ url: destino, headers, body: String(init.body ?? ""), cert_pem: g.cert_pem, key_pem: g.key_pem }),
        signal: init.signal,
      });
    } catch (e) {
      throw new Error(`Ponte SEFAZ fora do ar: ${(e as Error).message}`);
    }
    const j = await r.json().catch(() => ({} as Record<string, unknown>));
    if (!r.ok) {
      const motivo = r.status === 401 ? "segredo da ponte não confere (PONTE_SEGREDO)" : String(j.erro ?? `HTTP ${r.status}`);
      throw new Error(`Ponte SEFAZ: ${motivo}`);
    }
    return new Response(String(j.body ?? ""), { status: Number(j.status) || 502 });
  };
}
