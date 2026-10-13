// NFS-e Nacional: distribuição pelo ADN (Ambiente de Dados Nacional).
// GET https://adn.nfse.gov.br/contribuintes/DFe/{NSU}?cnpjConsulta=...&lote=true  (certificado de cliente)
// Traz NFS-e em que o CNPJ é prestador, tomador ou intermediário — só de municípios no padrão nacional.
import type { Banco } from "./banco.ts";
import type { Http, Resultado } from "./sefaz.ts";
import { gunzipB64 } from "./sefaz.ts";
import * as X from "./xml.ts";

export const URL_ADN = "https://adn.nfse.gov.br/contribuintes/DFe/";

export class ErroADN extends Error {}

// deno-lint-ignore no-explicit-any
function campo(d: any, nome: string): any {
  if (!d || typeof d !== "object") return undefined;
  const k = Object.keys(d).find((x) => x.toLowerCase() === nome.toLowerCase());
  return k ? d[k] : undefined;
}

export interface DocADN { nsu: number; chave: string; tipo: string; xml: string }

// deno-lint-ignore no-explicit-any
export async function interpretarRetorno(corpo: any, http = 200): Promise<DocADN[]> {
  const status = String(campo(corpo, "StatusProcessamento") ?? "");
  const erros = campo(corpo, "Erros") ?? [];
  if (erros.length && !status.toUpperCase().includes("NENHUM")) {
    // deno-lint-ignore no-explicit-any
    const msgs = erros.map((e: any) => (typeof e === "object" ? campo(e, "Descricao") ?? JSON.stringify(e) : String(e)));
    throw new ErroADN(`ADN (${http}): ${msgs.join("; ")}`);
  }
  const docs: DocADN[] = [];
  for (const item of campo(corpo, "LoteDFe") ?? []) {
    const bruto = campo(item, "ArquivoXml");
    if (!bruto) continue;
    docs.push({
      nsu: Number(campo(item, "NSU") ?? 0),
      chave: String(campo(item, "ChaveAcesso") ?? ""),
      tipo: String(campo(item, "TipoDocumento") ?? "").toUpperCase(),
      xml: await gunzipB64(bruto),
    });
  }
  return docs;
}

async function consultarLote(http: Http, cnpj: string, nsu: number): Promise<DocADN[]> {
  const r = await http(`${URL_ADN}${nsu}?cnpjConsulta=${cnpj}&lote=true`, {
    method: "GET", headers: { Accept: "application/json" },
  });
  const texto = await r.text();
  let corpo;
  try {
    corpo = JSON.parse(texto);
  } catch {
    if (r.status === 404) return [];
    throw new ErroADN(`ADN HTTP ${r.status}: ${texto.slice(0, 300)}`);
  }
  return await interpretarRetorno(corpo, r.status);
}

async function processar(b: Banco, cnpj: string, doc: DocADN): Promise<"nova" | "atualizada" | "ignorada" | "evento"> {
  const raiz = X.parseXml(doc.xml);
  if (doc.tipo.includes("EVENTO")) {
    await b.salvarXml(`${cnpj}/nfse/evento-${doc.chave}-${doc.nsu}.xml`, doc.xml);
    if (X.nfseCancelada(raiz)) await b.marcarCancelada(cnpj, "NFSE", doc.chave);
    return "evento";
  }
  const d = X.lerNFSe(raiz);
  d.chave ||= doc.chave;
  const p = await b.salvarXml(`${cnpj}/nfse/${d.chave}.xml`, doc.xml);
  return await b.gravarNota(cnpj, "NFSE", d, doc.nsu, p) as "nova" | "atualizada" | "ignorada";
}

export async function sincronizar(
  b: Banco, http: Http, cnpj: string,
  opts: { prazoMs?: number; pausaMs?: number; agora?: () => number } = {},
): Promise<Resultado> {
  const agora = opts.agora ?? Date.now;
  const inicio = agora();
  const emp = await b.empresa(cnpj);
  if (!emp) return { ok: false, mensagem: "Empresa não cadastrada." };
  let nsu = Number(emp.ult_nsu_nfse);
  const resumo = { nova: 0, atualizada: 0, evento: 0, ignorada: 0, outro: 0 };
  let mensagem = "Nenhum documento novo.";
  let parcial = false;
  while (true) {
    const docs = await consultarLote(http, cnpj, nsu);
    const novos = docs.filter((d) => d.nsu > nsu);
    if (!novos.length) break;
    for (const d of novos) resumo[await processar(b, cnpj, d)]++;
    nsu = Math.max(...novos.map((d) => d.nsu));
    await b.atualizarEmpresa(cnpj, { ult_nsu_nfse: nsu, ultima_sinc_nfse: new Date(agora()).toISOString() });
    mensagem = "Sincronização concluída.";
    if (agora() - inicio > (opts.prazoMs ?? 100_000)) {
      parcial = true;
      mensagem = `Baixado até o NSU ${nsu}; o restante continua na próxima busca.`;
      break;
    }
    await new Promise((r) => setTimeout(r, opts.pausaMs ?? 1000));
  }
  await b.atualizarEmpresa(cnpj, { ultima_sinc_nfse: new Date(agora()).toISOString() });
  await b.registrar(cnpj, "NFSE", `${mensagem} ${JSON.stringify(resumo)}`);
  return { ok: true, mensagem, resumo, ult_nsu: nsu, parcial };
}
