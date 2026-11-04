// Confere um vídeo MP4 sem baixar o arquivo inteiro: lê só os cabeçalhos das caixas (boxes) até achar o índice
// "moov" (que pode estar no começo ou no fim do arquivo) e, dentro dele, a faixa de vídeo: codec e resolução.
// Usado pela sincronização do Mídia Indoor (lê do Google Drive em pedaços, com o cabeçalho Range).
//
// Regra do app (fase 1): MP4 com vídeo H.264 (avc1/avc3) até 1080p (1920×1080, ou 1080×1920 em pé).
// H.265/HEVC, VP9, AV1 e 4K são recusados porque muitos TV box não decodificam ou travam.

/** Lê os bytes [inicio, fim] (fim incluído) do arquivo. */
export type Leitor = (inicio: number, fim: number) => Promise<Uint8Array>;

export interface ResultadoMp4 {
  ok: boolean;
  motivo: string;        // vazio quando ok
  codec: string;         // "H.264", "H.265 (HEVC)", ...
  largura: number | null;
  altura: number | null;
  duracao_s: number | null;
}

const CODECS: Record<string, string> = {
  avc1: "H.264", avc3: "H.264", hvc1: "H.265 (HEVC)", hev1: "H.265 (HEVC)", dvh1: "Dolby Vision (HEVC)", dvhe: "Dolby Vision (HEVC)",
  av01: "AV1", vp09: "VP9", vp08: "VP8", mp4v: "MPEG-4 Parte 2", "s263": "H.263", mjpa: "Motion JPEG", jpeg: "Motion JPEG", apcn: "ProRes", apch: "ProRes",
};
const LIMITE_MOOV = 32 * 1024 * 1024;   // índice maior que isso não é de um vídeo de propaganda

const tipo = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u16 = (b: Uint8Array, o: number) => (b[o] << 8) + b[o + 1];
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 4294967296 + u32(b, o + 4);

/** Caixas filhas de b[ini, fim): [{tipo, ini do conteúdo, fim}]. */
function caixas(b: Uint8Array, ini: number, fim: number): { t: string; c: number; f: number }[] {
  const r: { t: string; c: number; f: number }[] = [];
  let p = ini;
  while (p + 8 <= fim) {
    let tam = u32(b, p), cab = 8;
    if (tam === 1) { if (p + 16 > fim) break; tam = u64(b, p + 8); cab = 16; } else if (tam === 0) tam = fim - p;
    if (tam < cab || p + tam > fim) break;
    r.push({ t: tipo(b, p + 4), c: p + cab, f: p + tam });
    p += tam;
  }
  return r;
}
const filho = (b: Uint8Array, ini: number, fim: number, t: string) => caixas(b, ini, fim).find((x) => x.t === t);

/** Analisa o conteúdo da caixa moov (sem o cabeçalho dela). */
export function analisarMoov(b: Uint8Array): ResultadoMp4 {
  const res: ResultadoMp4 = { ok: false, motivo: "", codec: "", largura: null, altura: null, duracao_s: null };
  const lista = caixas(b, 0, b.length);
  const mvhd = lista.find((x) => x.t === "mvhd");
  if (mvhd) {
    const v = b[mvhd.c];
    const escala = v === 1 ? u32(b, mvhd.c + 20) : u32(b, mvhd.c + 12);
    const dur = v === 1 ? u64(b, mvhd.c + 24) : u32(b, mvhd.c + 16);
    if (escala > 0) res.duracao_s = Math.round(dur / escala * 100) / 100;
  }
  for (const trak of lista.filter((x) => x.t === "trak")) {
    const mdia = filho(b, trak.c, trak.f, "mdia");
    if (!mdia) continue;
    const hdlr = filho(b, mdia.c, mdia.f, "hdlr");
    if (!hdlr || tipo(b, hdlr.c + 8) !== "vide") continue;
    const stsd = (() => {
      const minf = filho(b, mdia.c, mdia.f, "minf"); if (!minf) return null;
      const stbl = filho(b, minf.c, minf.f, "stbl"); if (!stbl) return null;
      return filho(b, stbl.c, stbl.f, "stsd") ?? null;
    })();
    if (!stsd || stsd.f - stsd.c < 8 + 36) continue;
    const ent = stsd.c + 8;                       // versão/flags (4) + quantidade (4)
    const fmt = tipo(b, ent + 4);
    res.codec = CODECS[fmt] ?? fmt.trim();
    res.largura = u16(b, ent + 32);               // VisualSampleEntry: 8 do cabeçalho + 24 → largura, altura
    res.altura = u16(b, ent + 34);
    break;
  }
  if (!res.codec) { res.motivo = "o arquivo não tem faixa de vídeo"; return res; }
  if (res.codec !== "H.264") {
    res.motivo = `vídeo em ${res.codec}: exporte em MP4 com H.264 (no HandBrake: predefinição "Fast 1080p30")`;
    return res;
  }
  const maior = Math.max(res.largura ?? 0, res.altura ?? 0), menor = Math.min(res.largura ?? 0, res.altura ?? 0);
  if (maior > 1920 || menor > 1080) {
    res.motivo = `resolução ${res.largura}×${res.altura}: exporte em 1080p (1920×1080) ou menos`;
    return res;
  }
  res.ok = true;
  return res;
}

/** Procura o moov caixa a caixa (poucos pedidos pequenos) e analisa. `tamanho` = tamanho do arquivo em bytes. */
export async function analisarMp4(ler: Leitor, tamanho: number): Promise<ResultadoMp4> {
  const falha = (motivo: string): ResultadoMp4 => ({ ok: false, motivo, codec: "", largura: null, altura: null, duracao_s: null });
  if (tamanho < 16) return falha("arquivo vazio ou incompleto");
  const BLOCO = 65536;
  const inicio = await ler(0, Math.min(BLOCO, tamanho) - 1);
  if (tipo(inicio, 4) !== "ftyp") return falha("não é um arquivo MP4 (talvez só a extensão foi trocada): exporte em MP4");
  let pos = 0;
  for (let passo = 0; passo < 40 && pos + 8 <= tamanho; passo++) {
    const cab = pos + 16 <= inicio.length ? inicio.subarray(pos, pos + 16) : await ler(pos, Math.min(pos + 15, tamanho - 1));
    let tam = u32(cab, 0), h = 8;
    if (tam === 1) { tam = u64(cab, 8); h = 16; } else if (tam === 0) tam = tamanho - pos;
    if (tam < h || pos + tam > tamanho) return falha("arquivo MP4 corrompido ou incompleto (envie de novo ao Drive)");
    if (tipo(cab, 4) === "moov") {
      if (tam > LIMITE_MOOV) return falha("índice do vídeo grande demais");
      const moov = pos + tam <= inicio.length ? inicio.subarray(pos + h, pos + tam) : (await ler(pos, pos + tam - 1)).subarray(h);
      return analisarMoov(moov);
    }
    pos += tam;
  }
  return falha("arquivo MP4 sem índice (moov): exporte o vídeo de novo");
}
