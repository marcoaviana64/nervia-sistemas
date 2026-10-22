// Testes do envio de e-mail pelo Microsoft Graph (imitado) e do gancho "Send Email" do Supabase Auth.
// Rodar (na pasta do projeto):  deno test -A testes/email_test.ts
import nodeAssert from "node:assert/strict";
const assert = (c: unknown, m?: string) => nodeAssert.ok(c, m);
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
const assertRejects = (f: () => Promise<unknown>, msg: string) => nodeAssert.rejects(f, (e: Error) => e.message.includes(msg));
import { configEmail, enviarEmail, esquecerToken, modelo } from "../supabase/functions/_shared/email.ts";
import { assinar, conferirAssinatura } from "../supabase/functions/_shared/webhook.ts";
import { montar } from "../supabase/functions/email-auth/index.ts";

const CFG = { tenant: "t-1", cliente: "c-1", segredo: "s-1", remetente: "nao-responda@nervia.com.br" };

// Microsoft imitado: guarda os pedidos e responde conforme o roteiro
function microsoft(roteiro: { token?: () => Response; envio?: (n: number) => Response } = {}) {
  const pedidos: { url: string; init: RequestInit }[] = [];
  let envios = 0;
  const busca = (async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url); pedidos.push({ url: u, init });
    if (u.includes("/oauth2/v2.0/token")) return roteiro.token?.() ?? Response.json({ access_token: "TOKEN-" + pedidos.length, expires_in: 3600 });
    if (u.includes("/sendMail")) return roteiro.envio?.(++envios) ?? new Response(null, { status: 202 });
    return new Response("?", { status: 404 });
  }) as typeof fetch;
  return { busca, pedidos };
}

Deno.test("configuração: sem os 4 segredos não envia", async () => {
  assertEquals(configEmail(() => undefined), null);
  assertEquals(configEmail((k) => ({ MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s", EMAIL_REMETENTE: "r@x.com" } as Record<string, string>)[k])?.remetente, "r@x.com");
  await assertRejects(() => enviarEmail({ para: "a@b.com", assunto: "x", html: "x" }, fetch, null), "E-mail não configurado");
});

Deno.test("envio: token de aplicativo + sendMail na caixa compartilhada, com cópia em Itens enviados", async () => {
  esquecerToken();
  const ms = microsoft();
  await enviarEmail({ para: "cliente@empresa.com", assunto: "Assunto", html: "<p>oi</p>", responderPara: "atendimento@nervia.com.br" }, ms.busca, CFG);
  assertEquals(ms.pedidos.length, 2);
  const tok = new URLSearchParams(String(ms.pedidos[0].init.body));
  assert(ms.pedidos[0].url.endsWith("/t-1/oauth2/v2.0/token"));
  assertEquals([tok.get("grant_type"), tok.get("scope"), tok.get("client_id")], ["client_credentials", "https://graph.microsoft.com/.default", "c-1"]);
  assertEquals(ms.pedidos[1].url, "https://graph.microsoft.com/v1.0/users/nao-responda%40nervia.com.br/sendMail");
  assertEquals((ms.pedidos[1].init.headers as Record<string, string>).Authorization, "Bearer TOKEN-1");
  const corpo = JSON.parse(String(ms.pedidos[1].init.body));
  assertEquals(corpo.saveToSentItems, true);
  assertEquals(corpo.message.toRecipients, [{ emailAddress: { address: "cliente@empresa.com" } }]);
  assertEquals(corpo.message.replyTo, [{ emailAddress: { address: "atendimento@nervia.com.br" } }]);
  assertEquals(corpo.message.body.contentType, "HTML");
});

Deno.test("envio: token reaproveitado no segundo e-mail; 401 pede token novo uma vez", async () => {
  esquecerToken();
  const ms = microsoft({ envio: (n) => new Response(null, { status: n === 2 ? 401 : 202 }) });
  await enviarEmail({ para: "a@b.com", assunto: "1", html: "x" }, ms.busca, CFG);
  await enviarEmail({ para: "a@b.com", assunto: "2", html: "x" }, ms.busca, CFG);
  assertEquals(ms.pedidos.map((p) => p.url.includes("token") ? "T" : "E").join(""), "TEETE");
});

Deno.test("envio: mensagens claras para os erros da Microsoft", async () => {
  esquecerToken();
  await assertRejects(() => enviarEmail({ para: "a@b.com", assunto: "x", html: "x" },
    microsoft({ token: () => Response.json({ error: "invalid_client", error_description: "AADSTS7000222: The provided client secret keys are expired." }, { status: 401 }) }).busca, CFG), "chave secreta do app no Entra venceu");
  esquecerToken();
  await assertRejects(() => enviarEmail({ para: "a@b.com", assunto: "x", html: "x" },
    microsoft({ envio: () => Response.json({ error: { message: "Access is denied." } }, { status: 403 }) }).busca, CFG), "não tem permissão de enviar pela caixa nao-responda@nervia.com.br");
  await assertRejects(() => enviarEmail({ para: "a@b.com", assunto: "x", html: "x" },
    microsoft({ envio: () => Response.json({ error: { message: "x" } }, { status: 404 }) }).busca, CFG), "não encontrada");
  await assertRejects(() => enviarEmail({ para: "sem-arroba", assunto: "x", html: "x" }, microsoft().busca, CFG), "Endereço inválido");
});

Deno.test("modelo: marca da Nervia, botão com link e texto escapado", () => {
  const h = modelo("Título <x>", "<p>corpo</p>", { texto: "Abrir", link: "https://a.b/?x=1&y=2" });
  assert(h.includes("nervia-logo.png") && h.includes("Título &lt;x&gt;") && h.includes('href="https://a.b/?x=1&amp;y=2"') && h.includes("Não responda"));
});

Deno.test("gancho: assinatura Standard Webhooks confere; alterada, sem cabeçalho ou velha é recusada", async () => {
  const segredo = "v1,whsec_" + btoa("segredo-de-teste-123");
  const corpo = '{"a":1}', ts = String(Math.floor(Date.now() / 1000));
  const h = (sig: string, t = ts) => new Headers({ "webhook-id": "msg_1", "webhook-timestamp": t, "webhook-signature": sig });
  const sig = await assinar(segredo, "msg_1", ts, corpo);
  await conferirAssinatura(segredo, h(sig), corpo);
  await conferirAssinatura(segredo, h("v1,outra " + sig), corpo);                       // várias assinaturas: vale se uma confere
  await assertRejects(() => conferirAssinatura(segredo, h(sig), '{"a":2}'), "Assinatura inválida");
  await assertRejects(() => conferirAssinatura(segredo, new Headers(), corpo), "sem assinatura");
  const velho = String(Math.floor(Date.now() / 1000) - 600);
  await assertRejects(async () => conferirAssinatura(segredo, h(await assinar(segredo, "msg_1", velho, corpo), velho), corpo), "fora do prazo");
  await assertRejects(() => conferirAssinatura("", h(sig), corpo), "SEND_EMAIL_HOOK_SECRET");
});

const U = { id: "u1", email: "ana@empresa.com", user_metadata: { nome: "Ana Souza" } };
const D = { token: "123456", token_hash: "HASH", redirect_to: "https://nervia.com.br/cliente/", email_action_type: "recovery", site_url: "https://nervia.com.br" };

Deno.test("gancho: nova senha em português com o link de verificação do Supabase", () => {
  const [m] = montar(U, D, "https://ref.supabase.co");
  assertEquals(m.para, "ana@empresa.com");
  assert(m.assunto.includes("senha nova") && m.html.includes("Olá, Ana!"));
  assert(m.html.includes("https://ref.supabase.co/auth/v1/verify?token=HASH&amp;type=recovery&amp;redirect_to=https%3A%2F%2Fnervia.com.br%2Fcliente%2F"));
});

Deno.test("gancho: convite, código e troca de e-mail (nomes de hash trocados, como na doc)", () => {
  assert(montar(U, { ...D, email_action_type: "invite" }, "https://r")[0].html.includes("type=invite"));
  assert(montar(U, { ...D, email_action_type: "reauthentication" }, "https://r")[0].assunto.startsWith("123456"));
  const dois = montar({ ...U, new_email: "ana@nova.com" }, { ...D, email_action_type: "email_change", token_hash: "H_NOVO", token_hash_new: "H_ATUAL" }, "https://r");
  assertEquals(dois.map((m) => [m.para, m.html.includes("H_ATUAL") ? "atual" : "novo"]), [["ana@empresa.com", "atual"], ["ana@nova.com", "novo"]]);
  const um = montar({ ...U, new_email: "ana@nova.com" }, { ...D, email_action_type: "email_change", token_hash: "H_NOVO", token_hash_new: "" }, "https://r");
  assertEquals(um.map((m) => m.para), ["ana@nova.com"]);
  nodeAssert.throws(() => montar(U, { ...D, email_action_type: "outro" }, "https://r"), /não tratado/);
});
