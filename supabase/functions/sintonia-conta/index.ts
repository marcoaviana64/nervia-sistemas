// NVSintonia (laboratório): cria a conta de quem quer o próprio espelho, sem abrir o cadastro do Supabase Auth para
// todos os sistemas (a Área do Cliente continua com logins criados só pela Nervia).
//   POST {email, nome} (sem login) → se o e-mail ainda não existe, cria o usuário já confirmado, com {nome, origem:"sintonia"};
//   a página chama em seguida signInWithOtp(shouldCreateUser:false) e o link de entrada vai pelo gancho email-auth.
// Resposta igual exista ou não o e-mail (não revela quem tem conta). Limite: 5 por hora por IP e 100 por dia (sin_conta_limite).
import { admin } from "../_shared/banco.ts";
import { origemPermitida, VERSAO } from "../_shared/http.ts";

export const EMAIL_OK = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

export interface Contas {
  limite(ip: string): Promise<boolean>;
  existe(email: string): Promise<boolean>;
  criar(email: string, nome: string): Promise<void>;
}

/** Regra da função (exportada para os testes). */
export async function pedirConta(corpo: unknown, ip: string, c: Contas): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const { email, nome } = (corpo ?? {}) as { email?: unknown; nome?: unknown };
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  const n = typeof nome === "string" ? nome.trim() : "";
  if (!EMAIL_OK.test(e) || e.length > 254) return { status: 400, corpo: { ok: false, mensagem: "Informe um e-mail válido." } };
  if (n.length < 1 || n.length > 40) return { status: 400, corpo: { ok: false, mensagem: "Informe o seu nome (até 40 letras)." } };
  if (!(await c.limite(ip))) return { status: 429, corpo: { ok: false, mensagem: "Muitos pedidos seguidos. Tente de novo mais tarde." } };
  if (!(await c.existe(e))) await c.criar(e, n);
  return { status: 200, corpo: { ok: true } };
}

if (import.meta.main) {
  const sb = admin();
  const contas: Contas = {
    async limite(ip) {
      const { data, error } = await sb.rpc("sin_conta_limite", { p_ip: ip });
      if (error) throw new Error(error.message);
      return data === true;
    },
    async existe(email) {
      const { data, error } = await sb.rpc("sin_usuario_existe", { p_email: email });
      if (error) throw new Error(error.message);
      return data === true;
    },
    async criar(email, nome) {
      const { error } = await sb.auth.admin.createUser({ email, email_confirm: true, user_metadata: { nome, origem: "sintonia" } });
      if (error && !/already|registered|exists/i.test(error.message)) throw new Error(error.message);
    },
  };
  Deno.serve(async (req) => {
    const cab = {
      "Access-Control-Allow-Origin": origemPermitida(req.headers.get("Origin")), "Vary": "Origin",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json",
    };
    if (req.method === "OPTIONS") return new Response("ok", { headers: cab });
    if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, mensagem: "Use POST" }), { status: 405, headers: cab });
    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    try {
      const r = await pedirConta(await req.json().catch(() => ({})), ip, contas);
      return new Response(JSON.stringify(r.corpo), { status: r.status, headers: cab });
    } catch (e) {
      console.error(VERSAO, e);
      return new Response(JSON.stringify({ ok: false, mensagem: `Não foi possível criar a conta agora. [${VERSAO}]` }), { status: 502, headers: cab });
    }
  });
}
