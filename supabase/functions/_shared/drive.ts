// Leitura de pastas PÚBLICAS do Google Drive ("qualquer pessoa com o link") pela API oficial (Drive API v3),
// só com chave de API (segredo GOOGLE_DRIVE_CHAVE; sem login do cliente). Documentação conferida em 04/11/2026:
//   - chave de API = acesso anônimo a arquivos compartilhados com "qualquer pessoa com o link" (Create access credentials);
//   - files.list com q="'<pasta>' in parents and trashed = false" (Search for files);
//   - files.get com alt=media baixa o conteúdo e aceita o cabeçalho Range (Download and export files);
//   - pastas compartilhadas antes de 2021 podem exigir a resource key no cabeçalho X-Goog-Drive-Resource-Keys;
//   - cota (desde 01/05/2026): list = 100 unidades, download = 200; 1.000.000/min por projeto; cobrança só acima de
//     400 milhões de unidades ou 1 TB de download por dia (Usage limits).

export interface ArquivoDrive {
  id: string; name: string; mimeType: string; md5Checksum?: string; size?: string; modifiedTime?: string; resourceKey?: string;
  videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
  imageMediaMetadata?: { width?: number; height?: number };
}

const API = "https://www.googleapis.com/drive/v3/files";
export const PASTA = "application/vnd.google-apps.folder";
const CAMPOS = "nextPageToken,files(id,name,mimeType,md5Checksum,size,modifiedTime,resourceKey,videoMediaMetadata,imageMediaMetadata(width,height))";

type Buscar = typeof fetch;

function cabecalhos(id: string, chave: string, extra: Record<string, string> = {}): Record<string, string> {
  return chave ? { ...extra, "X-Goog-Drive-Resource-Keys": `${id}/${chave}` } : extra;
}

async function erroDrive(r: Response, oQue: string): Promise<Error> {
  let msg = "";
  try { msg = (await r.json())?.error?.message ?? ""; } catch { /* corpo não é JSON */ }
  if (r.status === 404) {
    return new Error(`${oQue} não encontrada no Google Drive. Confira o link e se a pasta está compartilhada com "qualquer pessoa com o link".`);
  }
  if (r.status === 403 || r.status === 401) {
    return new Error(`O Google Drive recusou o acesso (${r.status}${msg ? ": " + msg : ""}). Confira se a pasta está compartilhada com "qualquer pessoa com o link".`);
  }
  if (r.status === 429) return new Error("O Google Drive pediu para esperar (limite de pedidos). Tente de novo em alguns minutos.");
  return new Error(`Google Drive respondeu ${r.status}${msg ? ": " + msg : ""}`);
}

/** Lista os itens (não apagados) de uma pasta. */
export async function listarPasta(pasta: string, chavePasta: string, chaveApi: string, buscar: Buscar = fetch): Promise<ArquivoDrive[]> {
  const itens: ArquivoDrive[] = [];
  let pagina = "";
  for (let i = 0; i < 20; i++) {
    const u = new URL(API);
    u.searchParams.set("q", `'${pasta.replace(/[^A-Za-z0-9_-]/g, "")}' in parents and trashed = false`);
    u.searchParams.set("fields", CAMPOS);
    u.searchParams.set("pageSize", "1000");
    u.searchParams.set("supportsAllDrives", "true");
    u.searchParams.set("includeItemsFromAllDrives", "true");
    u.searchParams.set("key", chaveApi);
    if (pagina) u.searchParams.set("pageToken", pagina);
    const r = await buscar(u, { headers: cabecalhos(pasta, chavePasta) });
    if (!r.ok) throw await erroDrive(r, "Pasta");
    const j = await r.json();
    itens.push(...(j.files ?? []));
    if (!j.nextPageToken) break;
    pagina = j.nextPageToken;
  }
  return itens;
}

/** Leitor de trechos de um arquivo (para conferir o MP4 sem baixar inteiro). */
export function leitorDrive(id: string, chave: string, chaveApi: string, buscar: Buscar = fetch) {
  return async (inicio: number, fim: number): Promise<Uint8Array> => {
    const u = new URL(`${API}/${encodeURIComponent(id)}`);
    u.searchParams.set("alt", "media");
    u.searchParams.set("supportsAllDrives", "true");
    u.searchParams.set("key", chaveApi);
    const r = await buscar(u, { headers: cabecalhos(id, chave, { Range: `bytes=${inicio}-${fim}` }) });
    if (!r.ok) throw await erroDrive(r, "Arquivo");
    const b = new Uint8Array(await r.arrayBuffer());
    // se o servidor ignorar o Range (200 com o arquivo inteiro), recorta
    return r.status === 200 && b.length > fim - inicio + 1 ? b.subarray(inicio, fim + 1) : b;
  };
}

/** Endereço de download que a TV usa (a chave vai junto; ela só lê arquivos públicos). */
export function urlDownload(id: string): string {
  return `${API}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;
}
