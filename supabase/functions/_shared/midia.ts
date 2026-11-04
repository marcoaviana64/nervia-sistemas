// Mídia Indoor: lê a pasta do Google Drive de uma conta, confere cada arquivo e grava as playlists (mi_sinc_gravar).
// Cada SUBPASTA = uma playlist; arquivos soltos na pasta principal = playlist "Pasta principal".
// Ordem = nome do arquivo (01_..., 02_...), comparando números como números (2 antes de 10).
import { type ArquivoDrive, leitorDrive, listarPasta, PASTA } from "./drive.ts";
import { analisarMp4 } from "./mp4.ts";

export const MAX_VIDEO = 300 * 1024 * 1024;   // 300 MB por vídeo
export const MAX_IMAGEM = 30 * 1024 * 1024;   // 30 MB por imagem
export const INTERVALO_SINC_S = 300;          // sem "Atualizar agora", a pasta é lida no máximo a cada 5 min

export interface Arquivo {
  drive_id: string; chave: string; nome: string; mime: string; md5: string; tamanho: number; modificado: string | null;
  tipo: "video" | "imagem" | "outro"; situacao: "ok" | "recusado"; motivo: string;
  largura: number | null; altura: number | null; duracao_s: number | null; codec: string;
}
export interface Pasta { drive_id: string; chave: string; nome: string; raiz: boolean; arquivos: Arquivo[] }
export interface Conta { id: string; pasta_id: string; pasta_chave: string; limite_mb: number }
/** Resultado guardado da última conferência de cada arquivo (para não baixar de novo o que não mudou). */
export type Conferidos = Map<string, Pick<Arquivo, "md5" | "situacao" | "motivo" | "largura" | "altura" | "duracao_s" | "codec">>;

/** O que a sincronização precisa do banco (permite testar sem Supabase). */
export interface BancoMidia {
  reservar(conta: string, segundos: number): Promise<boolean>;
  conta(conta: string): Promise<Conta | null>;
  conferidos(conta: string): Promise<Conferidos>;
  gravar(conta: string, pastas: Pasta[] | null, erro: string | null): Promise<void>;
}

export const ordenar = <T extends { name: string }>(l: T[]) =>
  [...l].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true, sensitivity: "base" }));

const mb = (n: number) => (n / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + " MB";

/** Classifica um arquivo do Drive; vídeos novos ou alterados são conferidos lendo o cabeçalho do MP4. */
export async function conferir(f: ArquivoDrive, antes: Conferidos, ler: (f: ArquivoDrive) => (i: number, j: number) => Promise<Uint8Array>): Promise<Arquivo> {
  const tamanho = Number(f.size ?? 0);
  const base: Arquivo = {
    drive_id: f.id, chave: f.resourceKey ?? "", nome: f.name, mime: f.mimeType, md5: f.md5Checksum ?? "", tamanho,
    modificado: f.modifiedTime ?? null, tipo: "outro", situacao: "recusado", motivo: "", largura: null, altura: null, duracao_s: null, codec: "",
  };
  const ext = (f.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  const recusa = (motivo: string, tipo: Arquivo["tipo"] = base.tipo) => ({ ...base, tipo, motivo });

  if (f.mimeType === "application/vnd.google-apps.shortcut") return recusa("atalho do Drive: coloque o próprio arquivo na pasta");
  if (f.mimeType.startsWith("application/vnd.google-apps.")) {
    return recusa("arquivo do Google (Documentos, Apresentações…): baixe como JPG/PNG ou MP4 e coloque na pasta");
  }
  if (f.mimeType === "image/jpeg" || f.mimeType === "image/png" || (["jpg", "jpeg", "png"].includes(ext) && f.mimeType.startsWith("image/"))) {
    if (tamanho > MAX_IMAGEM) return recusa(`imagem de ${mb(tamanho)}: o limite é 30 MB (salve com menos qualidade ou em até 1920 px)`, "imagem");
    return { ...base, tipo: "imagem", situacao: "ok", largura: f.imageMediaMetadata?.width ?? null, altura: f.imageMediaMetadata?.height ?? null };
  }
  if (f.mimeType.startsWith("image/")) return recusa(`imagem ${ext.toUpperCase() || f.mimeType}: use JPG ou PNG`, "imagem");
  if (f.mimeType.startsWith("video/") || ["mp4", "m4v", "mov", "mkv", "avi", "wmv", "webm"].includes(ext)) {
    if (!(f.mimeType === "video/mp4" || ext === "mp4" || ext === "m4v")) {
      return recusa(`vídeo ${ext.toUpperCase() || f.mimeType}: converta para MP4 (H.264, 1080p)`, "video");
    }
    if (tamanho > MAX_VIDEO) return recusa(`vídeo de ${mb(tamanho)}: o limite é 300 MB por vídeo (exporte em 1080p)`, "video");
    const a = antes.get(f.id);
    if (a && a.md5 && a.md5 === base.md5) return { ...base, tipo: "video", ...a, md5: base.md5 };
    try {
      const r = await analisarMp4(ler(f), tamanho);
      return { ...base, tipo: "video", situacao: r.ok ? "ok" : "recusado", motivo: r.motivo, codec: r.codec, largura: r.largura, altura: r.altura,
        duracao_s: r.duracao_s ?? (f.videoMediaMetadata?.durationMillis ? Number(f.videoMediaMetadata.durationMillis) / 1000 : null) };
    } catch (e) {
      return recusa(`não foi possível conferir o vídeo: ${e instanceof Error ? e.message : e}`, "video");
    }
  }
  return recusa("formato não aceito: use vídeo MP4 (H.264) ou imagem JPG/PNG");
}

/** Monta as playlists da conta a partir da pasta do Drive (sem gravar). */
export async function lerPastaConta(conta: Conta, chaveApi: string, antes: Conferidos, buscar: typeof fetch = fetch): Promise<Pasta[]> {
  const ler = (f: ArquivoDrive) => leitorDrive(f.id, f.resourceKey ?? "", chaveApi, buscar);
  const raiz = ordenar(await listarPasta(conta.pasta_id, conta.pasta_chave, chaveApi, buscar));
  const subpastas = raiz.filter((f) => f.mimeType === PASTA);
  const soltos = raiz.filter((f) => f.mimeType !== PASTA);
  const pastas: Pasta[] = [];
  if (soltos.length || !subpastas.length) {
    pastas.push({ drive_id: conta.pasta_id, chave: conta.pasta_chave, nome: "Pasta principal", raiz: true,
      arquivos: await Promise.all(soltos.map((f) => conferir(f, antes, ler))) });
  }
  for (const s of subpastas) {
    const itens = ordenar(await listarPasta(s.id, s.resourceKey ?? "", chaveApi, buscar)).filter((f) => f.mimeType !== PASTA);
    pastas.push({ drive_id: s.id, chave: s.resourceKey ?? "", nome: s.name, raiz: false, arquivos: await Promise.all(itens.map((f) => conferir(f, antes, ler))) });
  }
  // limite de espaço da conta: soma dos arquivos aceitos (cada arquivo conta uma vez, mesmo em duas playlists)
  const limite = conta.limite_mb * 1048576, vistos = new Set<string>();
  let soma = 0;
  for (const p of pastas) {
    for (const a of p.arquivos) {
      if (a.situacao !== "ok" || vistos.has(a.drive_id)) continue;
      vistos.add(a.drive_id);
      if (soma + a.tamanho > limite) {
        a.situacao = "recusado";
        a.motivo = `passa do limite de espaço da conta (${(conta.limite_mb / 1000).toLocaleString("pt-BR")} GB): tire arquivos da pasta ou fale com a Nervia`;
      } else soma += a.tamanho;
    }
  }
  return pastas;
}

/** Sincroniza a conta (se não houver outra leitura em andamento e já passou o intervalo, ou se `forcar`). */
export async function sincronizarConta(banco: BancoMidia, contaId: string, chaveApi: string, forcar: boolean, buscar: typeof fetch = fetch):
  Promise<{ feito: boolean; erro?: string; playlists?: number; arquivos?: number; recusados?: number }> {
  if (!(await banco.reservar(contaId, forcar ? 20 : INTERVALO_SINC_S))) return { feito: false };
  const conta = await banco.conta(contaId);
  if (!conta || !conta.pasta_id) return { feito: false };
  try {
    if (!chaveApi) throw new Error("Chave da API do Google Drive não configurada (segredo GOOGLE_DRIVE_CHAVE; ver IMPLANTACAO.md §10).");
    const pastas = await lerPastaConta(conta, chaveApi, await banco.conferidos(contaId), buscar);
    await banco.gravar(contaId, pastas, null);
    const todos = pastas.flatMap((p) => p.arquivos);
    return { feito: true, playlists: pastas.length, arquivos: todos.length, recusados: todos.filter((a) => a.situacao !== "ok").length };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    await banco.gravar(contaId, null, erro);
    return { feito: true, erro };
  }
}

/** Versão do conteúdo (muda quando muda qualquer arquivo, a ordem ou um tempo): a TV compara com a que já tem. */
export async function versaoConteudo(itens: unknown[]): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(itens)));
  return Array.from(new Uint8Array(h).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}
