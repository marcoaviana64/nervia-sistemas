// Leitura dos XMLs fiscais (resNFe, procNFe, eventos, NFS-e), ignorando namespaces.
import { DOMParser } from "npm:@xmldom/xmldom@0.8.10";

// deno-lint-ignore no-explicit-any
export type El = any;

export function parseXml(texto: string): El {
  const doc = new DOMParser({ errorHandler: { warning: () => {}, error: () => {}, fatalError: (e: unknown) => { throw new Error(`XML inválido: ${e}`); } } })
    .parseFromString(texto, "text/xml");
  if (!doc?.documentElement) throw new Error("XML inválido");
  return doc.documentElement;
}

/** Todos os elementos descendentes com esse nome local. */
export function todos(raiz: El, nome: string): El[] {
  const lista = raiz.getElementsByTagNameNS("*", nome);
  const out: El[] = [];
  for (let i = 0; i < lista.length; i++) out.push(lista[i]);
  if (raiz.localName === nome) out.unshift(raiz);
  return out;
}

/** 'emit/CNPJ' = elemento CNPJ cujo pai é emit (em qualquer profundidade). */
function casa(el: El, partes: string[]): boolean {
  let atual = el;
  for (let i = partes.length - 2; i >= 0; i--) {
    atual = atual.parentNode;
    if (!atual || atual.localName !== partes[i]) return false;
  }
  return true;
}

export function txt(raiz: El, ...caminhos: string[]): string {
  for (const c of caminhos) {
    const partes = c.split("/");
    for (const el of todos(raiz, partes[partes.length - 1])) {
      if (casa(el, partes)) {
        const v = (el.textContent ?? "").trim();
        if (v) return v;
      }
    }
  }
  return "";
}

export function num(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export interface DadosNota {
  chave: string; numero: string; emit_cnpj: string; emit_nome: string;
  dest_cnpj: string; dest_nome: string; data_emissao: string; valor: number | null;
  situacao: string; completo: boolean;
}

const SIT_NFE: Record<string, string> = { "1": "Autorizada", "2": "Denegada", "3": "Cancelada" };

/** A chave de 44 posições traz o nº da nota nas posições 26-34. */
export function numeroDaChave(chave: string): string {
  const p = chave.slice(25, 34);
  return chave.length === 44 && /^\d{9}$/.test(p) ? String(parseInt(p, 10)) : "";
}

export function lerResNFe(r: El): DadosNota {
  const chave = txt(r, "chNFe");
  return {
    chave, numero: numeroDaChave(chave), emit_cnpj: txt(r, "CNPJ", "CPF"), emit_nome: txt(r, "xNome"),
    dest_cnpj: "", dest_nome: "", data_emissao: txt(r, "dhEmi"), valor: num(txt(r, "vNF")),
    situacao: SIT_NFE[txt(r, "cSitNFe")] ?? "Autorizada", completo: false,
  };
}

export function lerProcNFe(r: El): DadosNota {
  let chave = txt(r, "protNFe/infProt/chNFe");
  if (!chave) {
    const inf = todos(r, "infNFe")[0];
    chave = (inf?.getAttribute("Id") ?? "").slice(3);
  }
  return {
    chave, numero: txt(r, "ide/nNF"), emit_cnpj: txt(r, "emit/CNPJ", "emit/CPF"), emit_nome: txt(r, "emit/xNome"),
    dest_cnpj: txt(r, "dest/CNPJ", "dest/CPF"), dest_nome: txt(r, "dest/xNome"),
    data_emissao: txt(r, "ide/dhEmi", "ide/dEmi"), valor: num(txt(r, "ICMSTot/vNF")),
    situacao: "Autorizada", completo: true,
  };
}

export function lerEventoNFe(r: El) {
  return { chave: txt(r, "chNFe"), tpEvento: txt(r, "tpEvento"), descricao: txt(r, "xEvento", "descEvento") };
}

export function lerNFSe(r: El): DadosNota {
  const inf = todos(r, "infNFSe")[0];
  return {
    chave: (inf?.getAttribute("Id") ?? "").replace(/^NFS/, ""),
    numero: txt(r, "infNFSe/nNFSe", "nNFSe"),
    emit_cnpj: txt(r, "infNFSe/emit/CNPJ", "infNFSe/emit/CPF", "prest/CNPJ"),
    emit_nome: txt(r, "infNFSe/emit/xNome", "prest/xNome"),
    dest_cnpj: txt(r, "toma/CNPJ", "toma/CPF"), dest_nome: txt(r, "toma/xNome"),
    data_emissao: txt(r, "infDPS/dhEmi", "dhProc"),
    valor: num(txt(r, "vServPrest/vServ", "valores/vLiq")),
    situacao: "Autorizada", completo: true,
  };
}

/** Evento de cancelamento (e101101) ou cancelamento por substituição (e105102). */
export function nfseCancelada(r: El): boolean {
  return todos(r, "e101101").length > 0 || todos(r, "e105102").length > 0;
}
