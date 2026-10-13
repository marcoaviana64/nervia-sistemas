// Gestão de logins dos sistemas Nervia (só admin): criar, trocar senha, excluir.
// Um login vale para todos os apps; quais apps cada um vê fica em "app_acessos" e, no Buscador,
// quais CNPJs fica em "nf_acessos" (as duas tabelas a tela grava direto — RLS permite só ao admin).
import { admin } from "../_shared/banco.ts";
import { erro, json, servir } from "../_shared/http.ts";

const sb = admin();

servir(async (req, quem) => {
  const c = await req.json();
  if (quem.tipo !== "admin") return erro("Acesso negado", 401);

  if (c.acao === "criar") {
    const email = String(c.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return erro("E-mail inválido.");
    if (String(c.senha ?? "").length < 8) return erro("A senha precisa ter pelo menos 8 caracteres.");
    const { data, error } = await sb.auth.admin.createUser({
      email, password: c.senha, email_confirm: true, user_metadata: { nome: c.nome ?? "" },
    });
    if (error) return erro(error.message);
    const uid = data.user.id;
    const apps: string[] = Array.isArray(c.apps) ? c.apps : [];
    const cnpjs: string[] = Array.isArray(c.cnpjs) ? c.cnpjs : [];
    if (c.admin === true) {
      const { error: e1 } = await sb.from("perfis").update({ admin: true }).eq("user_id", uid);
      if (e1) return erro(e1.message);
    }
    if (apps.length) {
      const { error: e2 } = await sb.from("app_acessos").insert(apps.map((app_id) => ({ user_id: uid, app_id })));
      if (e2) return erro(e2.message);
    }
    if (cnpjs.length) {
      const { error: e3 } = await sb.from("nf_acessos").insert(cnpjs.map((cnpj) => ({ user_id: uid, cnpj })));
      if (e3) return erro(e3.message);
    }
    return json({ ok: true, user_id: uid, mensagem: `Login criado para ${email}.` });
  }

  if (c.acao === "senha") {
    if (String(c.senha ?? "").length < 8) return erro("A senha precisa ter pelo menos 8 caracteres.");
    const { error } = await sb.auth.admin.updateUserById(c.user_id, { password: c.senha });
    return error ? erro(error.message) : json({ ok: true, mensagem: "Senha alterada." });
  }

  if (c.acao === "excluir") {
    if (c.user_id === quem.userId) return erro("Você não pode excluir o seu próprio login.");
    const { error } = await sb.auth.admin.deleteUser(c.user_id);
    return error ? erro(error.message) : json({ ok: true, mensagem: "Login excluído." });
  }

  return erro("Ação inválida.");
});
