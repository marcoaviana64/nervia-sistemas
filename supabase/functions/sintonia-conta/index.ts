// NVSintonia: conta por CHAVE, sem e-mail (1.1, pedido do Marco em 24/11/2026). O cadastro aberto do Supabase Auth
// continua desligado: só esta função cria logins do Sintonia, com o Auth admin.
//   {acao:"criar", nome, app?} (sem login; app "aura" = conta do NVAura, mesma chave e mesmo jeito) → chave nova (sin_chave_nova) + usuário já confirmado com o e-mail derivado
//                                           (s-…@sintonia.nervia.com.br, nunca recebe e-mail) e a senha derivada da chave.
//                                           Devolve {chave, email}: a página mostra a chave UMA vez e entra com senha.
//   {acao:"entrar", chave}    (sem login) → {email} derivado (não diz se a conta existe); a página entra com a senha.
//   {acao:"nova_chave", app?} (com login) → chave nova para a mesma conta (perdeu ou não anotou); a antiga deixa de valer.
//   {acao:"converter"}        (com login) → quem entrou pelo e-mail (1.0) troca o e-mail por uma chave: mesmo usuário,
//                                           mesmos dados; o e-mail real some do Auth e do perfil.
// A chave nunca é guardada nem registrada. Limites: criar/converter 5 por hora por IP e 100 por dia; entrar 20 por hora por IP.
import { admin } from "../_shared/banco.ts";
import { origemPermitida, VERSAO } from "../_shared/http.ts";

/** Senha do Auth derivada da chave (a página faz a mesma conta). Tem maiúscula, minúscula, número e símbolo. */
export function senhaDaChave(chave: string): string {
  const c = chave.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return "Sn!" + c + c.toLowerCase();
}

export interface Contas {
  limite(ip: string): Promise<boolean>;          // criar / converter
  limiteEntrar(ip: string): Promise<boolean>;
  chaveNova(): Promise<{ chave: string; email: string }>;
  emailDaChave(chave: string): Promise<string | null>;
  criarUsuario(email: string, senha: string, nome: string, origem: string): Promise<string>;
  usuarioDoToken(token: string): Promise<{ id: string; email: string; origem: string } | null>;
  trocarLogin(id: string, email: string, senha: string): Promise<void>;
  auditar(id: string, acao: string): Promise<void>;
}

// Só contas criadas pelo NVSintonia/NVAura (user_metadata.origem) podem ter o login trocado aqui. Logins do ecossistema
// (Área do Cliente, equipe Nervia, clientes) NUNCA: em 23–24/11/2026 a página usou a sessão da Nervia do Marco e trocou o
// e-mail e a senha dele.
const CONTAS_DOS_APPS = ["sintonia", "aura"];
const CONTA_PROTEGIDA = "Esta conta é um login da Nervia: a chave não pode ser trocada por aqui. Saia e crie uma conta do NVAura (ou NVSintonia) só com o nome.";

type Resposta = { status: number; corpo: Record<string, unknown> };
const falha = (status: number, mensagem: string): Resposta => ({ status, corpo: { ok: false, mensagem } });

/** Regra da função (exportada para os testes). */
export async function atender(corpo: unknown, ip: string, token: string, c: Contas): Promise<Resposta> {
  const p = (corpo ?? {}) as { acao?: unknown; nome?: unknown; chave?: unknown; app?: unknown };
  const aura = p.app === "aura";
  if (p.acao === "criar") {
    const nome = typeof p.nome === "string" ? p.nome.trim() : "";
    if (nome.length < 1 || nome.length > 40) return falha(400, "Informe como quer ser chamado (até 40 letras).");
    if (!(await c.limite(ip))) return falha(429, "Muitas contas criadas daqui agora. Tente de novo mais tarde.");
    const k = await c.chaveNova();
    const id = await c.criarUsuario(k.email, senhaDaChave(k.chave), nome, aura ? "aura" : "sintonia");
    await c.auditar(id, aura ? "aura_conta_criada" : "sintonia_conta_criada");
    return { status: 200, corpo: { ok: true, chave: k.chave, email: k.email } };
  }
  if (p.acao === "entrar") {
    if (!(await c.limiteEntrar(ip))) return falha(429, "Muitas tentativas seguidas. Espere uma hora e tente de novo.");
    const email = typeof p.chave === "string" ? await c.emailDaChave(p.chave) : null;
    if (!email) return falha(400, "Chave inválida: são 12 letras e números, como K7QM-4XPA-9TRD.");
    return { status: 200, corpo: { ok: true, email } };
  }
  if (p.acao === "converter") {
    const u = token ? await c.usuarioDoToken(token) : null;
    if (!u) return falha(401, "Entre no NVSintonia para trocar o e-mail pela chave.");
    if (!CONTAS_DOS_APPS.includes(u.origem)) return falha(403, CONTA_PROTEGIDA);
    if (u.email.endsWith("@sintonia.nervia.com.br")) return falha(400, "Esta conta já entra por chave.");
    if (!(await c.limite(ip))) return falha(429, "Muitos pedidos seguidos. Tente de novo mais tarde.");
    const k = await c.chaveNova();
    await c.trocarLogin(u.id, k.email, senhaDaChave(k.chave));
    await c.auditar(u.id, "sintonia_email_trocado_por_chave");
    return { status: 200, corpo: { ok: true, chave: k.chave, email: k.email } };
  }
  if (p.acao === "nova_chave") {
    // quem está dentro da conta troca a chave (perdeu ou não anotou): mesmo usuário e dados; a chave antiga deixa de valer
    const u = token ? await c.usuarioDoToken(token) : null;
    if (!u) return falha(401, "Entre na sua conta para gerar uma chave nova.");
    if (!CONTAS_DOS_APPS.includes(u.origem)) return falha(403, CONTA_PROTEGIDA);
    if (!u.email.endsWith("@sintonia.nervia.com.br")) return falha(400, "Esta conta entra pelo e-mail: use Trocar o e-mail por uma chave.");
    if (!(await c.limite(ip))) return falha(429, "Muitos pedidos seguidos. Tente de novo mais tarde.");
    const k = await c.chaveNova();
    await c.trocarLogin(u.id, k.email, senhaDaChave(k.chave));
    await c.auditar(u.id, aura ? "aura_chave_trocada" : "sintonia_chave_trocada");
    return { status: 200, corpo: { ok: true, chave: k.chave, email: k.email } };
  }
  return falha(400, "Ação desconhecida.");
}

if (import.meta.main) {
  const sb = admin();
  const rpc = async <T>(nome: string, args: Record<string, unknown> = {}): Promise<T> => {
    const { data, error } = await sb.rpc(nome, args);
    if (error) throw new Error(error.message);
    return data as T;
  };
  const contas: Contas = {
    limite: (ip) => rpc<boolean>("sin_conta_limite", { p_ip: ip }),
    limiteEntrar: (ip) => rpc<boolean>("sin_entrar_limite", { p_ip: ip }),
    chaveNova: () => rpc<{ chave: string; email: string }>("sin_chave_nova"),
    emailDaChave: (chave) => rpc<string | null>("sin_chave_email", { p_chave: chave }),
    async criarUsuario(email, senha, nome, origem) {
      const { data, error } = await sb.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome, origem } });
      if (error || !data.user) throw new Error(error?.message ?? "usuário não criado");
      return data.user.id;
    },
    async usuarioDoToken(token) {
      const { data } = await sb.auth.getUser(token);
      return data?.user ? { id: data.user.id, email: data.user.email ?? "", origem: String(data.user.user_metadata?.origem ?? "") } : null;
    },
    async trocarLogin(id, email, senha) {
      const { error } = await sb.auth.admin.updateUserById(id, { email, password: senha, email_confirm: true });
      if (error) throw new Error(error.message);
      await rpc("sin_perfil_email", { p_user: id, p_email: email });
    },
    auditar: (id, acao) => rpc("sin_conta_auditar", { p_user: id, p_acao: acao }),
  };
  Deno.serve(async (req) => {
    const cab = {
      // nvaura.com.br = domínio próprio do NVAura (só esta função; o resto do ecossistema segue o SITE_ORIGEM)
      "Access-Control-Allow-Origin": req.headers.get("Origin") === "https://nvaura.com.br" ? "https://nvaura.com.br" : origemPermitida(req.headers.get("Origin")), "Vary": "Origin",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json",
    };
    if (req.method === "OPTIONS") return new Response("ok", { headers: cab });
    if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, mensagem: "Use POST" }), { status: 405, headers: cab });
    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    // com a chave publicável no Authorization (sem login) o getUser só devolve vazio
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    try {
      const r = await atender(await req.json().catch(() => ({})), ip, token, contas);
      return new Response(JSON.stringify(r.corpo), { status: r.status, headers: cab });
    } catch (e) {
      console.error(VERSAO, e);
      return new Response(JSON.stringify({ ok: false, mensagem: `Não foi possível concluir agora. [${VERSAO}]` }), { status: 502, headers: cab });
    }
  });
}
