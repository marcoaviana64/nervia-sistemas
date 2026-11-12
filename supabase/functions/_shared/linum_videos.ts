// Sistema Linum 2.49 — vídeos do produto: o que a função linum-videos devolve da pasta do Google Drive.

const ordem = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/** Só vídeos e fotos, em ordem de nome (01, 02… comparados como números). */
export function arquivosParaMostrar(itens: { id: string; name: string; mimeType: string; resourceKey?: string }[]) {
  return itens
    .filter((a) => a.mimeType.startsWith("video/") || a.mimeType.startsWith("image/"))
    .sort((a, b) => ordem.compare(a.name, b.name))
    .map((a) => ({ id: a.id, nome: a.name.replace(/\.[^.]+$/, ""), tipo: a.mimeType.startsWith("video/") ? "video" : "foto", chave: a.resourceKey ?? "" }));
}
