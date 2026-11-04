// Mídia Indoor — endpoints do app da TV (sem login; a TV se identifica pelo token recebido no vínculo).
//   {acao:"codigo",   aparelho}            → código de 6 caracteres para mostrar na tela (vale 10 min)
//   {acao:"aguardar", aparelho, codigo}    → "aguardando" | "expirado" | "vinculado" (+ token, entregue UMA vez)
//   {acao:"playlist", token}               → o que tocar: lista de arquivos do Drive com md5, tempo e a chave de download
//   {acao:"sinal",    token, ...}          → sinal de vida (o painel mostra online/offline, espaço livre, erros)
// Token inválido (TV desvinculada) → 401 {situacao:"desvinculada"}: o app apaga o token e volta à tela do código.
import { admin } from "../_shared/banco.ts";
import { origemPermitida, VERSAO } from "../_shared/http.ts";
import { urlDownload } from "../_shared/drive.ts";
import { sincronizarConta, versaoConteudo } from "../_shared/midia.ts";
import { bancoMidia } from "../_shared/midia_banco.ts";

const sb = admin();
const CHAVE = Deno.env.get("GOOGLE_DRIVE_CHAVE") ?? "";
export const INTERVALO_PLAYLIST_S = 300;   // a TV pergunta a playlist a cada 5 min
export const INTERVALO_SEM_CONTEUDO_S = 30; // sem nada para passar (recém-vinculada, sem playlist): a cada 30 s
export const INTERVALO_SINAL_S = 180;      // e manda o sinal de vida a cada 3 min

const resp = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
// CORS: o reprodutor web (site/tv/, computador com Chrome/Edge) chama esta função pelo navegador; o app Android não manda Origin.
const CORS_CABECALHOS = { "Access-Control-Allow-Headers": "apikey, content-type, x-client-info, authorization", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "3600" };
const falha = (mensagem: string, status = 400) => resp({ ok: false, mensagem }, status);
const ok = <T>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data; };

Deno.serve(async (req) => {
  const r = req.method === "OPTIONS" ? new Response(null, { status: 204, headers: CORS_CABECALHOS }) : await atender(req);
  r.headers.set("Access-Control-Allow-Origin", origemPermitida(req.headers.get("Origin")));
  r.headers.set("Vary", "Origin");
  for (const [k, v] of Object.entries(CORS_CABECALHOS)) r.headers.set(k, v);
  return r;
});

async function atender(req: Request): Promise<Response> {
  if (req.method !== "POST") return falha("Use POST", 405);
  let c: Record<string, unknown>;
  try { c = await req.json(); } catch { return falha("JSON inválido."); }
  try {
    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
    switch (c.acao) {
      case "codigo":
        return resp({ ok: true, ...ok(await sb.rpc("mi_tv_codigo", { p_aparelho: String(c.aparelho ?? ""), p_ip: ip })) });
      case "aguardar":
        return resp({ ok: true, ...ok(await sb.rpc("mi_tv_aguardar", { p_aparelho: String(c.aparelho ?? ""), p_codigo: String(c.codigo ?? "") })) });
      case "playlist": {
        const telaId = ok(await sb.rpc("mi_tv_tela", { p_token: String(c.token ?? "") })) as string | null;
        if (!telaId) return resp({ ok: false, situacao: "desvinculada" }, 401);
        const tela = ok(await sb.from("mi_telas").select("nome, conta_id, playlist_id, rotacao").eq("id", telaId).single()) as
          { nome: string; conta_id: string; playlist_id: string | null; rotacao: number };
        // lê a pasta do Drive se a última leitura tem mais de 5 min (uma leitura por conta, não por TV)
        await sincronizarConta(bancoMidia(sb), tela.conta_id, CHAVE, false).catch((e) => console.error(VERSAO, "sinc", e));
        const conta = ok(await sb.from("mi_contas").select("ativo, tempo_imagem_s").eq("id", tela.conta_id).single()) as { ativo: boolean; tempo_imagem_s: number };
        let playlist = "", itens: Record<string, unknown>[] = [];
        if (conta.ativo && tela.playlist_id) {
          playlist = (ok(await sb.from("mi_playlists").select("nome").eq("id", tela.playlist_id).maybeSingle()) as { nome: string } | null)?.nome ?? "";
          const ms = ok(await sb.from("mi_midias").select("drive_id, chave, nome, tipo, md5, tamanho, tempo_s, duracao_s")
            .eq("playlist_id", tela.playlist_id).eq("situacao", "ok").order("posicao")) as Record<string, unknown>[];
          itens = ms.map((m) => ({ id: m.drive_id, nome: m.nome, tipo: m.tipo, md5: m.md5, tamanho: Number(m.tamanho),
            tempo_s: m.tipo === "imagem" ? (m.tempo_s ?? conta.tempo_imagem_s) : null, duracao_s: m.duracao_s == null ? null : Number(m.duracao_s),
            url: urlDownload(String(m.drive_id)), chave_recurso: m.chave || null }));
        }
        return resp({
          ok: true, situacao: "ok", tela: tela.nome, playlist, conta_ativa: conta.ativo, itens,
          rotacao: tela.rotacao ?? 0,
          conteudo: await versaoConteudo(itens), chave_api: CHAVE,
          intervalo_playlist_s: itens.length ? INTERVALO_PLAYLIST_S : INTERVALO_SEM_CONTEUDO_S, intervalo_sinal_s: INTERVALO_SINAL_S,
        });
      }
      case "sinal": {
        const aceito = ok(await sb.rpc("mi_tv_sinal", { p_token: String(c.token ?? ""), p_dados: c })) as boolean;
        return aceito ? resp({ ok: true }) : resp({ ok: false, situacao: "desvinculada" }, 401);
      }
      default:
        return falha("Ação desconhecida.");
    }
  } catch (e) {
    console.error(VERSAO, e);
    return falha(`${e instanceof Error ? e.message : e} [${VERSAO}]`, /Aparelho inválido|Muitos códigos/.test(String(e)) ? 429 : 502);
  }
}
