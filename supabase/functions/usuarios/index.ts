// Gestão de logins dos sistemas Nervia (só admin): criar, editar nome/e-mail, trocar senha, excluir.
// Um login vale para todos os apps; quais apps cada um vê fica em "app_acessos" e, no Buscador,
// quais CNPJs fica em "nf_acessos" (as duas tabelas a tela grava direto — RLS permite só ao admin).
import { admin } from "../_shared/banco.ts";
import { erro, json, servir } from "../_shared/http.ts";
import { auditar } from "../_shared/auditoria.ts";

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
    await auditar(sb, req, quem, "login_criado", null, { login: email, login_id: uid, nome: c.nome ?? "", admin: c.admin === true, apps, cnpjs });
    return json({ ok: true, user_id: uid, mensagem: `Login criado para ${email}.` });
  }

  if (c.acao === "senha") {
    if (String(c.senha ?? "").length < 8) return erro("A senha precisa ter pelo menos 8 caracteres.");
    const { error } = await sb.auth.admin.updateUserById(c.user_id, { password: c.senha });
    if (error) return erro(error.message);
    const { data: alvo } = await sb.from("perfis").select("email").eq("user_id", c.user_id).maybeSingle();
    await auditar(sb, req, quem, "senha_redefinida", null, { login: alvo?.email ?? null, login_id: c.user_id });
    return json({ ok: true, mensagem: "Senha alterada." });
  }

  if (c.acao === "editar") {
    // nome e e-mail do login (o e-mail é o usuário de entrada: muda no Auth e no perfil)
    const { data: antes } = await sb.from("perfis").select("email, nome").eq("user_id", c.user_id).maybeSingle();
    if (!antes) return erro("Login não encontrado.");
    const email = String(c.email ?? "").trim().toLowerCase();
    const nome = String(c.nome ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return erro("E-mail inválido.");
    const mudouEmail = email !== String(antes.email ?? "").toLowerCase(), mudouNome = nome !== (antes.nome ?? "");
    if (!mudouEmail && !mudouNome) return json({ ok: true, mensagem: "Nada mudou." });
    if (mudouEmail) {
      const { data: outro } = await sb.from("perfis").select("user_id").eq("email", email).neq("user_id", c.user_id).maybeSingle();
      if (outro) return erro(`Já existe outro login com o e-mail ${email}.`);
    }
    // e-mail confirmado pela Nervia: troca direto, sem e-mail de confirmação para a pessoa
    const { error } = await sb.auth.admin.updateUserById(c.user_id, {
      ...(mudouEmail ? { email, email_confirm: true } : {}), user_metadata: { nome },
    });
    if (error) return erro(error.message);
    const { error: e2 } = await sb.from("perfis").update({ email, nome }).eq("user_id", c.user_id);
    if (e2) return erro(e2.message);
    await auditar(sb, req, quem, "login_alterado", null, {
      login_id: c.user_id, login: email,
      ...(mudouEmail ? { email_antes: antes.email, email_depois: email } : {}),
      ...(mudouNome ? { nome_antes: antes.nome ?? "", nome_depois: nome } : {}),
    });
    return json({ ok: true, mensagem: mudouEmail ? `Login alterado. A pessoa passa a entrar com ${email} (a senha continua a mesma).` : "Nome alterado." });
  }

  if (c.acao === "excluir") {
    if (c.user_id === quem.userId) return erro("Você não pode excluir o seu próprio login.");
    const { data: alvo } = await sb.from("perfis").select("email, nome").eq("user_id", c.user_id).maybeSingle();
    const { error } = await sb.auth.admin.deleteUser(c.user_id);
    if (error) return erro(error.message);
    await auditar(sb, req, quem, "login_excluido", null, { login: alvo?.email ?? null, nome: alvo?.nome ?? null, login_id: c.user_id });
    return json({ ok: true, mensagem: "Login excluído." });
  }

  return erro("Ação inválida.");
});
