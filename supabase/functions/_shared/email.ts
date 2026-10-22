// Envio de e-mail pelo Microsoft 365 da Nervia (Microsoft Graph, permissão Mail.Send de APLICATIVO).
// A permissão fica restrita, no Exchange Online (RBAC for Applications), à caixa compartilhada do remetente.
// Segredos: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET e EMAIL_REMETENTE (ex.: nao-responda@nervia.com.br).
// Sem eles, emailConfigurado() = false e nada é enviado.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";

export interface ConfigEmail { tenant: string; cliente: string; segredo: string; remetente: string; }
export interface Mensagem { para: string; assunto: string; html: string; responderPara?: string; }
type Busca = typeof fetch;

export function configEmail(env = (k: string) => Deno.env.get(k)): ConfigEmail | null {
  const c = { tenant: env("MS_TENANT_ID") ?? "", cliente: env("MS_CLIENT_ID") ?? "", segredo: env("MS_CLIENT_SECRET") ?? "", remetente: env("EMAIL_REMETENTE") ?? "" };
  return c.tenant && c.cliente && c.segredo && c.remetente ? c : null;
}
export const emailConfigurado = () => configEmail() !== null;

// URLs (trocadas só nos testes)
export const URLS = { login: "https://login.microsoftonline.com", graph: "https://graph.microsoft.com/v1.0" };

// token de aplicativo (client credentials), guardado até 1 min antes de vencer
let guardado: { chave: string; token: string; vence: number } | null = null;
export function esquecerToken() { guardado = null; }

async function tokenGraph(c: ConfigEmail, busca: Busca): Promise<string> {
  const chave = `${c.tenant}|${c.cliente}`;
  if (guardado && guardado.chave === chave && Date.now() < guardado.vence) return guardado.token;
  const r = await busca(`${URLS.login}/${encodeURIComponent(c.tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.cliente, client_secret: c.segredo, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const d = String(j.error_description ?? j.error ?? r.status).split("\r\n")[0];
    if (/AADSTS7000222|expired/i.test(d)) throw new Error(`A chave secreta do app no Entra venceu: gere outra e atualize MS_CLIENT_SECRET. (${d})`);
    if (/AADSTS7000215|invalid_client/i.test(d)) throw new Error(`Chave secreta do app inválida: confira MS_CLIENT_SECRET (o VALOR da chave, não o ID). (${d})`);
    throw new Error(`Microsoft não autorizou o app: ${d}`);
  }
  guardado = { chave, token: j.access_token, vence: Date.now() + (Number(j.expires_in ?? 3600) - 60) * 1000 };
  return j.access_token;
}

/** Envia pela caixa EMAIL_REMETENTE. O Graph responde 202 (aceito) sem corpo. */
export async function enviarEmail(m: Mensagem, busca: Busca = fetch, c: ConfigEmail | null = configEmail()): Promise<void> {
  if (!c) throw new Error("E-mail não configurado: faltam os segredos MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET ou EMAIL_REMETENTE.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.para)) throw new Error(`Endereço inválido: ${m.para}`);
  const corpo = {
    message: {
      subject: m.assunto,
      body: { contentType: "HTML", content: m.html },
      toRecipients: [{ emailAddress: { address: m.para } }],
      ...(m.responderPara ? { replyTo: [{ emailAddress: { address: m.responderPara } }] } : {}),
    },
    saveToSentItems: true,
  };
  const enviar = async () => busca(`${URLS.graph}/users/${encodeURIComponent(c.remetente)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await tokenGraph(c, busca)}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  let r = await enviar();
  if (r.status === 401) { esquecerToken(); r = await enviar(); }   // token recusado: pede outro uma vez
  if (r.status === 202) return;
  const j = await r.json().catch(() => ({}));
  const det = j?.error?.message ?? `HTTP ${r.status}`;
  if (r.status === 403) throw new Error(`O app não tem permissão de enviar pela caixa ${c.remetente} (confira a permissão Mail.Send e a restrição do Exchange). ${det}`);
  if (r.status === 404) throw new Error(`Caixa ${c.remetente} não encontrada no Microsoft 365. ${det}`);
  if (r.status === 429) throw new Error(`Microsoft pediu para esperar (muitos envios). Tente de novo em alguns minutos. ${det}`);
  throw new Error(`Microsoft recusou o envio: ${det}`);
}

/** Registra o envio (ou a falha). O corpo não é guardado. Falha ao registrar não derruba o envio. */
export async function registrarEnvio(sb: SupabaseClient, e: { tipo: string; para: string; assunto: string; ok: boolean; erro?: string | null; user_id?: string | null; detalhes?: Record<string, unknown> }) {
  const { error } = await sb.from("email_envios").insert({ ...e, erro: e.erro ?? null, user_id: e.user_id ?? null, detalhes: e.detalhes ?? {} });
  if (error) console.error("email_envios:", error.message);
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
export { escHtml };

/** Modelo com a marca da Nervia. `corpo` já em HTML; `botao` opcional (texto + link). */
export function modelo(titulo: string, corpo: string, botao?: { texto: string; link: string }, rodape?: string): string {
  const b = botao ? `<p style="margin:26px 0"><a href="${escHtml(botao.link)}" style="background:#107D9A;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">${escHtml(botao.texto)}</a></p>
    <p style="font-size:12px;color:#667">Se o botão não abrir, copie este endereço no navegador:<br><span style="word-break:break-all">${escHtml(botao.link)}</span></p>` : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#F3F6F8;font-family:Segoe UI,Arial,sans-serif;color:#1B2A36">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#fff;border-radius:12px;padding:28px 26px;border:1px solid #E1E8EC">
    <img src="https://nervia.com.br/img/nervia-logo.png" alt="Nervia Tecnologia" width="150" style="display:block;margin-bottom:18px">
    <h1 style="font-size:20px;margin:0 0 14px">${escHtml(titulo)}</h1>
    <div style="font-size:15px;line-height:1.55">${corpo}</div>${b}
  </div>
  <p style="font-size:12px;color:#667;text-align:center;margin-top:14px">${rodape ?? "Mensagem automática da Plataforma Nervia. Não responda: para falar com a Nervia, escreva para atendimento@nervia.com.br ou pelo WhatsApp (21) 96686-9374."}</p>
</div></body></html>`;
}
