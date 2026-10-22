// "Send Email Hook" do Supabase Auth: com o gancho ligado (painel → Authentication → Hooks → Send Email, tipo HTTPS),
// TODOS os e-mails de login (nova senha, convite, link de acesso, troca de e-mail) saem por aqui, pelo Microsoft 365
// da Nervia, em português. Doc: supabase.com/docs/guides/auth/auth-hooks/send-email-hook (resposta 200 vazia = enviado).
// Segredo do gancho: SEND_EMAIL_HOOK_SECRET ("v1,whsec_..." gerado no painel). Sem login: quem chama é o Supabase Auth.
import { admin } from "../_shared/banco.ts";
import { conferirAssinatura } from "../_shared/webhook.ts";
import { enviarEmail, escHtml, modelo, registrarEnvio } from "../_shared/email.ts";

interface Dados {
  token: string; token_hash: string; redirect_to: string; email_action_type: string; site_url: string;
  token_new?: string; token_hash_new?: string;
}
interface Usuario { id: string; email: string; new_email?: string; user_metadata?: { nome?: string } }

/** Monta os e-mails de cada tipo de ação (exportado para os testes). */
export function montar(u: Usuario, d: Dados, supabaseUrl: string): { para: string; assunto: string; html: string }[] {
  const link = (hash: string, tipo = d.email_action_type) =>
    `${supabaseUrl}/auth/v1/verify?token=${encodeURIComponent(hash)}&type=${encodeURIComponent(tipo)}&redirect_to=${encodeURIComponent(d.redirect_to || d.site_url)}`;
  const nome = u.user_metadata?.nome ? `Olá, ${escHtml(u.user_metadata.nome.split(" ")[0])}!` : "Olá!";
  const naoFoiVoce = "<p style=\"color:#667;font-size:13px\">Se não foi você que pediu, ignore este e-mail: nada muda no seu acesso.</p>";
  const vale = "O link vale por pouco tempo e só pode ser usado uma vez.";
  switch (d.email_action_type) {
    case "recovery":
      return [{ para: u.email, assunto: "Criar uma senha nova — Área do Cliente Nervia", html: modelo("Criar uma senha nova",
        `<p>${nome}</p><p>Recebemos um pedido para criar uma senha nova para <b>${escHtml(u.email)}</b> na Área do Cliente da Nervia. Clique no botão e escolha a senha nova. ${vale}</p>${naoFoiVoce}`,
        { texto: "Criar senha nova", link: link(d.token_hash) }) }];
    case "invite":
      return [{ para: u.email, assunto: "Seu acesso à Plataforma Nervia", html: modelo("Seu acesso à Plataforma Nervia",
        `<p>${nome}</p><p>A Nervia criou o seu acesso à Área do Cliente com o e-mail <b>${escHtml(u.email)}</b>. Clique no botão para entrar e criar a sua senha. ${vale}</p>`,
        { texto: "Entrar e criar a senha", link: link(d.token_hash) }) }];
    case "magiclink":
      return [{ para: u.email, assunto: "Seu link de acesso — Área do Cliente Nervia", html: modelo("Seu link de acesso",
        `<p>${nome}</p><p>Clique no botão para entrar na Área do Cliente. ${vale}</p>${naoFoiVoce}`, { texto: "Entrar", link: link(d.token_hash) }) }];
    case "signup":
      return [{ para: u.email, assunto: "Confirme o seu e-mail — Plataforma Nervia", html: modelo("Confirme o seu e-mail",
        `<p>${nome}</p><p>Confirme que este é o seu e-mail para ativar o acesso. ${vale}</p>`, { texto: "Confirmar e-mail", link: link(d.token_hash) }) }];
    case "reauthentication":
      return [{ para: u.email, assunto: `${d.token} é o seu código de confirmação — Nervia`, html: modelo("Código de confirmação",
        `<p>${nome}</p><p>Use este código para confirmar a operação:</p><p style="font-size:26px;font-weight:700;letter-spacing:4px">${escHtml(d.token)}</p>${naoFoiVoce}`) }];
    case "email_change": {
      // nomes trocados por compatibilidade (doc do Supabase): token_hash_new = e-mail ATUAL; token_hash = e-mail NOVO
      const novo = u.new_email ?? "", out = [];
      const texto = (para: string) => `<p>${nome}</p><p>Recebemos um pedido para trocar o e-mail de login de <b>${escHtml(u.email)}</b> para <b>${escHtml(novo)}</b>. Confirme pelo botão (enviado para ${escHtml(para)}). ${vale}</p>${naoFoiVoce}`;
      if (d.token_hash_new) out.push({ para: u.email, assunto: "Confirme a troca do e-mail — Nervia", html: modelo("Confirme a troca do e-mail", texto(u.email), { texto: "Confirmar", link: link(d.token_hash_new) }) });
      if (novo && d.token_hash) out.push({ para: novo, assunto: "Confirme o seu novo e-mail — Nervia", html: modelo("Confirme o seu novo e-mail", texto(novo), { texto: "Confirmar", link: link(d.token_hash) }) });
      return out;
    }
    default:
      throw new Error(`Tipo de e-mail não tratado: ${d.email_action_type}`);
  }
}

if (import.meta.main) Deno.serve(async (req) => {
  const resp = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
  if (req.method !== "POST") return resp(405, { error: { http_code: 405, message: "Use POST" } });
  const corpo = await req.text();
  try {
    await conferirAssinatura(Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "", req.headers, corpo);
  } catch (e) {
    return resp(401, { error: { http_code: 401, message: (e as Error).message } });
  }
  const { user, email_data } = JSON.parse(corpo) as { user: Usuario; email_data: Dados };
  const sb = admin();
  const tipo = "auth_" + email_data.email_action_type;
  try {
    for (const m of montar(user, email_data, Deno.env.get("SUPABASE_URL")!)) {
      try {
        await enviarEmail(m);
        await registrarEnvio(sb, { tipo, para: m.para, assunto: m.assunto, ok: true, user_id: user.id });
      } catch (e) {
        await registrarEnvio(sb, { tipo, para: m.para, assunto: m.assunto, ok: false, erro: (e as Error).message, user_id: user.id });
        throw e;
      }
    }
    if (email_data.email_action_type === "recovery") {
      // ação sensível: pedido de senha nova (o link foi para o e-mail do próprio login)
      const { error } = await sb.from("auditoria").insert({ user_id: user.id, email: user.email, nome: user.user_metadata?.nome ?? null, papel: "sistema",
        acao: "senha_link_enviado", detalhes: { login: user.email, por: "Esqueci minha senha (e-mail automático)" } });
      if (error) console.error("auditoria:", error.message);
    }
    return resp(200, {});
  } catch (e) {
    console.error("email-auth:", e);
    return resp(500, { error: { http_code: 500, message: "Não foi possível enviar o e-mail agora. Tente de novo em alguns minutos ou fale com a Nervia." } });
  }
});
