// E-mail pela Plataforma (só admin): situação da configuração e envio de teste.
// Os avisos dos apps vão usar o mesmo _shared/email.ts.
import { admin } from "../_shared/banco.ts";
import { erro, json, servir } from "../_shared/http.ts";
import { auditar } from "../_shared/auditoria.ts";
import { configEmail, enviarEmail, escHtml, modelo, registrarEnvio } from "../_shared/email.ts";

const sb = admin();

servir(async (req, quem) => {
  const c = await req.json();
  if (quem.tipo !== "admin") return erro("Acesso negado", 401);
  const cfg = configEmail();

  if (c.acao === "situacao") {
    return json({ ok: true, configurado: !!cfg, remetente: cfg?.remetente ?? null, gancho: !!Deno.env.get("SEND_EMAIL_HOOK_SECRET") });
  }

  if (c.acao === "teste") {
    const para = String(c.para ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) return erro("E-mail inválido.");
    const assunto = "Teste de e-mail — Plataforma Nervia";
    const html = modelo("Teste de e-mail", `<p>Este é um e-mail de teste da Plataforma Nervia, enviado pela caixa <b>${escHtml(cfg?.remetente ?? "")}</b> pelo Microsoft 365.</p><p>Se chegou na caixa de entrada (e não no lixo eletrônico), está tudo certo.</p>`);
    try {
      await enviarEmail({ para, assunto, html }, fetch, cfg);
    } catch (e) {
      await registrarEnvio(sb, { tipo: "teste", para, assunto, ok: false, erro: (e as Error).message, user_id: quem.userId });
      return erro((e as Error).message);
    }
    await registrarEnvio(sb, { tipo: "teste", para, assunto, ok: true, user_id: quem.userId });
    await auditar(sb, req, quem, "email_teste", null, { para, remetente: cfg?.remetente });
    return json({ ok: true, mensagem: `E-mail de teste enviado para ${para} por ${cfg?.remetente}. Confira a caixa de entrada (e o lixo eletrônico).` });
  }

  return erro("Ação inválida.");
});
