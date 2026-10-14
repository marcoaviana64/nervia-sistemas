// CORS, respostas JSON e verificação de quem está chamando.
import { admin } from "./banco.ts";

/** Muda a cada correção nas funções: aparece nas mensagens de erro para saber qual versão está no ar. */
export const VERSAO = "v7-trava656";

// SITE_ORIGEM: um ou mais endereços separados por vírgula (ex.: https://nervia.com.br,https://www.nervia.com.br).
// Sem ele, qualquer site pode chamar (o acesso continua exigindo login de admin ou o segredo do cron).
const ORIGENS = (Deno.env.get("SITE_ORIGEM") ?? "").split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);

/** Devolve a origem do pedido se ela for permitida; senão, a primeira permitida (o navegador bloqueia). */
export function origemPermitida(origem: string | null, permitidas = ORIGENS): string {
  if (!permitidas.length) return "*";
  return origem && permitidas.includes(origem) ? origem : permitidas[0];
}

export const CORS = {
  "Access-Control-Allow-Origin": origemPermitida(null),
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

export const erro = (mensagem: string, status = 400) => json({ ok: false, mensagem }, status);

export type Chamador = { tipo: "cron" } | { tipo: "admin"; userId: string } | null;

/** Cron (cabeçalho x-cron-secret) ou usuário logado com perfil admin. Clientes não chamam funções. */
export async function chamador(req: Request): Promise<Chamador> {
  const segredo = Deno.env.get("CRON_SECRET");
  const enviado = req.headers.get("x-cron-secret");
  if (segredo && enviado && enviado.length === segredo.length) {
    let dif = 0;
    for (let i = 0; i < segredo.length; i++) dif |= segredo.charCodeAt(i) ^ enviado.charCodeAt(i);
    if (dif === 0) return { tipo: "cron" };
  }
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const sb = admin();
  const { data } = await sb.auth.getUser(token);
  if (!data?.user) return null;
  const { data: perfil } = await sb.from("perfis").select("admin").eq("user_id", data.user.id).maybeSingle();
  return perfil?.admin ? { tipo: "admin", userId: data.user.id } : null;
}

/** Envolve o handler: CORS, só POST, exige admin (ou cron, se permitido) e converte exceções em JSON. */
export function servir(
  handler: (req: Request, quem: NonNullable<Chamador>) => Promise<Response>,
  opts: { permiteCron?: boolean } = {},
) {
  Deno.serve(async (req) => {
    const r = await atender(req);
    r.headers.set("Access-Control-Allow-Origin", origemPermitida(req.headers.get("Origin")));
    r.headers.set("Vary", "Origin");
    return r;
  });

  async function atender(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return erro("Use POST", 405);
    const quem = await chamador(req);
    if (!quem || (quem.tipo === "cron" && !opts.permiteCron)) return erro("Acesso negado", 401);
    try {
      return await handler(req, quem);
    } catch (e) {
      console.error(VERSAO, e);
      return erro(`${mensagemDeRede(e)} [${VERSAO}]`, 502);
    }
  }
}

export function mensagemDeRede(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/certificate|tls|handshake|UnknownIssuer/i.test(m)) {
    return `Falha de TLS com o servidor oficial (${m}). Confira se o certificado A1 está válido; ` +
      "se citar 'UnknownIssuer', configure o segredo CADEIA_EXTRA_PEM (ver IMPLANTACAO.md).";
  }
  if (/connection|dns|network|refused|reset/i.test(m)) return `Sem conexão com o servidor oficial: ${m}`;
  return m;
}
