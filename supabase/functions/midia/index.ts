// Mídia Indoor — painel: "Atualizar agora" lê a pasta do Google Drive da conta, confere os arquivos e grava as playlists.
// Quem chama: equipe Nervia ou cliente com a conta liberada (mi_acessos). As TVs não usam esta função (ver midia-tv).
import { admin } from "../_shared/banco.ts";
import { erro, json, servir } from "../_shared/http.ts";
import { sincronizarConta } from "../_shared/midia.ts";
import { bancoMidia } from "../_shared/midia_banco.ts";

const sb = admin();

servir(async (req, quem) => {
  const c = await req.json();
  if (quem.tipo === "cron") return erro("Acesso negado", 401);
  if (c.acao !== "sincronizar") return erro("Ação desconhecida.");
  const conta = String(c.conta ?? "");
  if (!/^[0-9a-f-]{36}$/.test(conta)) return erro("Conta inválida.");
  if (quem.tipo !== "admin") {
    const { data } = await sb.from("mi_acessos").select("conta_id").eq("conta_id", conta).eq("user_id", quem.userId).maybeSingle();
    if (!data) return erro("Sem acesso a esta conta.", 403);
  }
  const r = await sincronizarConta(bancoMidia(sb), conta, Deno.env.get("GOOGLE_DRIVE_CHAVE") ?? "", true);
  if (!r.feito) return json({ ok: true, mensagem: "A pasta acabou de ser lida (ou está sendo lida agora). Aguarde alguns segundos e atualize." });
  if (r.erro) return erro(r.erro);
  return json({ ok: true, ...r, mensagem: `Pasta lida: ${r.playlists} playlist(s), ${r.arquivos} arquivo(s)` + (r.recusados ? `, ${r.recusados} com problema.` : ".") });
}, { permiteCliente: true });
