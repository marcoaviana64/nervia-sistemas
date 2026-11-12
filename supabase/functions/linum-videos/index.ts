// Sistema Linum 2.49 — vídeos do produto para mostrar à cliente (pedido do Marco em 12/11/2026).
// Quem chama: login com papel no Linum (horário incluído; conferido no banco pela _lin_video_pasta).
// Lê a pasta do Google Drive do produto (compartilhada com "qualquer pessoa com o link") com a chave da API (segredo
// GOOGLE_DRIVE_CHAVE, a mesma do Mídia Indoor; não vai para o navegador) e devolve só vídeos e fotos, em ordem de nome.
// O navegador toca o vídeo no player do próprio Google Drive (drive.google.com/file/d/<id>/preview).
import { admin } from "../_shared/banco.ts";
import { erro, json, servir } from "../_shared/http.ts";
import { listarPasta } from "../_shared/drive.ts";
import { arquivosParaMostrar } from "../_shared/linum_videos.ts";

const sb = admin();
servir(async (req, quem) => {
  if (quem.tipo === "cron") return erro("Acesso negado", 401);
  const c = await req.json();
  const produto = String(c.produto ?? "");
  if (!/^[0-9a-f-]{36}$/.test(produto)) return erro("Produto inválido.");
  const { data, error } = await sb.rpc("_lin_video_pasta", { p_user: quem.userId, p_produto: produto });
  if (error) return erro(error.message, 403);
  const p = Array.isArray(data) ? data[0] : data;
  if (!p?.pasta_id) return erro("Este produto ainda não tem pasta de vídeos.");
  const chaveApi = Deno.env.get("GOOGLE_DRIVE_CHAVE") ?? "";
  if (!chaveApi) return erro("Falta a chave do Google Drive (segredo GOOGLE_DRIVE_CHAVE) nas funções.", 500);
  const itens = await listarPasta(p.pasta_id, p.chave ?? "", chaveApi);
  return json({ ok: true, produto: p.descricao, arquivos: arquivosParaMostrar(itens) });
}, { permiteCliente: true });
