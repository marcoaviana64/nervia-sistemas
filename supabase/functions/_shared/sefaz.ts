// NF-e: Distribuição DF-e (Ambiente Nacional) e evento de Ciência da Operação.
//
// Regras (NT 2014.002):
// - continuar sempre do ultNSU devolvido;
// - sem documentos novos (cStat 137, ou ultNSU == maxNSU): esperar 1 hora;
// - rejeição 656 (consumo indevido): esperar 1 hora;
// - só ficam disponíveis os documentos dos últimos ~90 dias.
import type { Banco } from "./banco.ts";
import { CertGuardado, certificadoDerB64, chaveDeAssinatura } from "./certificado.ts";
import * as X from "./xml.ts";

export const URL_DIST = "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
export const URL_EVENTO = "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx";
const NS = "http://www.portalfiscal.inf.br/nfe";
const DS = "http://www.w3.org/2000/09/xmldsig#";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const SOAP = "http://www.w3.org/2003/05/soap-envelope";

export const UF_CODIGO: Record<string, number> = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25,
  PE: 26, AL: 27, SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50,
  MT: 51, GO: 52, DF: 53,
};
const ESPERA_MS = 61 * 60 * 1000;
/** Rejeições 656 seguidas que desligam a NF-e da empresa (outro sistema consulta o mesmo CNPJ). */
export const MAX_656_SEGUIDAS = 2;

export type Http = (url: string, init: RequestInit) => Promise<Response>;
export interface Resumo { nova: number; atualizada: number; evento: number; ignorada: number; outro: number }
export interface Resultado { ok: boolean; mensagem: string; resumo?: Resumo; ult_nsu?: number; parcial?: boolean }

export class ErroSefaz extends Error {}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ------------------------------------------------------------------ utilidades
export async function gunzipB64(b64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(b64.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

// ------------------------------------------------------------------ distribuição
export function envelopeDist(cnpj: string, cuf: number, ultNsu: number): string {
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="${SOAP}"><soap12:Body>` +
    `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>` +
    `<distDFeInt xmlns="${NS}" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>${cuf}</cUFAutor>` +
    `<CNPJ>${cnpj}</CNPJ><distNSU><ultNSU>${String(ultNsu).padStart(15, "0")}</ultNSU></distNSU></distDFeInt>` +
    `</nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>`;
}

export function envelopeConsNSU(cnpj: string, cuf: number, nsu: number): string {
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="${SOAP}"><soap12:Body>` +
    `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>` +
    `<distDFeInt xmlns="${NS}" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>${cuf}</cUFAutor>` +
    `<CNPJ>${cnpj}</CNPJ><consNSU><NSU>${String(nsu).padStart(15, "0")}</NSU></consNSU></distDFeInt>` +
    `</nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>`;
}

export interface DocDist { nsu: number; schema: string; xml: string }
export interface RetDist { cStat: string; xMotivo: string; ultNSU: number; maxNSU: number; docs: DocDist[] }

export async function interpretarRetornoDist(texto: string): Promise<RetDist> {
  const raiz = X.parseXml(texto);
  const ret = X.todos(raiz, "retDistDFeInt")[0];
  if (!ret) throw new ErroSefaz("Resposta inesperada da SEFAZ: " + texto.slice(0, 300));
  const docs: DocDist[] = [];
  for (const dz of X.todos(ret, "docZip")) {
    docs.push({
      nsu: parseInt(dz.getAttribute("NSU"), 10),
      schema: dz.getAttribute("schema") ?? "",
      xml: await gunzipB64(dz.textContent ?? ""),
    });
  }
  return {
    cStat: X.txt(ret, "cStat"), xMotivo: X.txt(ret, "xMotivo"),
    ultNSU: parseInt(X.txt(ret, "ultNSU") || "0", 10), maxNSU: parseInt(X.txt(ret, "maxNSU") || "0", 10), docs,
  };
}

async function consultarLote(http: Http, cnpj: string, cuf: number, ult: number, porNsu = false): Promise<RetDist> {
  const r = await http(URL_DIST, {
    method: "POST",
    body: porNsu ? envelopeConsNSU(cnpj, cuf, ult) : envelopeDist(cnpj, cuf, ult),
    headers: {
      "Content-Type": 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse"',
    },
  });
  const texto = await r.text();
  if (r.status >= 500 && !texto.includes("retDistDFeInt")) {
    throw new ErroSefaz(`SEFAZ indisponível (HTTP ${r.status}). Tente mais tarde.`);
  }
  return await interpretarRetornoDist(texto);
}

export async function processarDocumento(b: Banco, cnpj: string, doc: DocDist): Promise<keyof Resumo> {
  const raiz = X.parseXml(doc.xml);
  const s = doc.schema;
  if (s.startsWith("resNFe")) {
    const d = X.lerResNFe(raiz);
    const p = await b.salvarXml(`${cnpj}/nfe/${d.chave}-resumo.xml`, doc.xml);
    return await b.gravarNota(cnpj, "NFE", d, doc.nsu, p) as keyof Resumo;
  }
  if (s.startsWith("procNFe")) {
    const d = X.lerProcNFe(raiz);
    const p = await b.salvarXml(`${cnpj}/nfe/${d.chave}.xml`, doc.xml);
    return await b.gravarNota(cnpj, "NFE", d, doc.nsu, p) as keyof Resumo;
  }
  if (s.startsWith("resEvento") || s.startsWith("procEventoNFe")) {
    const ev = X.lerEventoNFe(raiz);
    await b.salvarXml(`${cnpj}/eventos/${ev.chave}-${ev.tpEvento}-${doc.nsu}.xml`, doc.xml);
    if (ev.tpEvento === "110111") await b.marcarCancelada(cnpj, "NFE", ev.chave);
    if (["210210", "210200", "210220", "210240"].includes(ev.tpEvento)) await b.marcarManifestada(cnpj, ev.chave);
    return "evento";
  }
  await b.salvarXml(`${cnpj}/outros/${doc.nsu}.xml`, doc.xml);
  return "outro";
}

/**
 * Baixa lotes de 50 até acabar, ou até estourar o tempo (prazoMs) — nesse caso para
 * sem bloquear e a próxima execução continua do ultNSU salvo.
 */
export async function sincronizar(
  b: Banco, http: Http, cnpj: string,
  opts: { prazoMs?: number; pausaMs?: number; agora?: () => number } = {},
): Promise<Resultado> {
  const agora = opts.agora ?? Date.now;
  const inicio = agora();
  const prazo = opts.prazoMs ?? 100_000;
  const emp = await b.empresa(cnpj);
  if (!emp) return { ok: false, mensagem: "Empresa não cadastrada." };
  if (emp.bloqueio_nfe && new Date(emp.bloqueio_nfe).getTime() > agora()) {
    const min = Math.ceil((new Date(emp.bloqueio_nfe).getTime() - agora()) / 60000);
    return { ok: false, mensagem: `A SEFAZ só permite nova consulta em ${min} min (regra de 1h).` };
  }
  if (emp.nfe_ativa === false) {
    return { ok: false, mensagem: emp.nfe_pausa_motivo || "A busca de NF-e está desligada para esta empresa. Para religar, use o botão \"Ligar NF-e\"." };
  }
  const cuf = UF_CODIGO[emp.uf] ?? 33;
  let ult = Number(emp.ult_nsu_nfe);
  const resumo: Resumo = { nova: 0, atualizada: 0, evento: 0, ignorada: 0, outro: 0 };
  let mensagem = "";
  let parcial = false;
  for (let lote = 1; ; lote++) {
    const ret = await consultarLote(http, cnpj, cuf, ult);
    if (ret.cStat === "656") {
      // NÃO avançar o ultNSU numa 656: pular a sequência faria perder, em silêncio, as notas anteriores
      // (ex.: as que outro sistema do cliente já baixou). Só registra o que a SEFAZ informou, para diagnóstico.
      const nsuSefaz = ` [NSU nosso ${ult}; SEFAZ informou ultNSU ${ret.ultNSU}, maxNSU ${ret.maxNSU}]`;
      const seguidas = (emp.nfe_656_seguidas ?? 0) + 1;
      if (seguidas >= MAX_656_SEGUIDAS) {
        const quando = new Date(agora()).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        const motivo = `Busca de NF-e pausada automaticamente em ${quando}: a SEFAZ recusou ${seguidas} consultas seguidas (rejeição 656). ` +
          `Quase sempre é porque outro sistema (ERP, contabilidade ou portal de notas) baixa as NF-e deste CNPJ, e a SEFAZ só aceita um. ` +
          `Desligue o download automático no outro sistema, espere 1 hora e clique em "Ligar NF-e".`;
        await b.atualizarEmpresa(cnpj, {
          bloqueio_nfe: new Date(agora() + ESPERA_MS).toISOString(),
          nfe_656_seguidas: seguidas, nfe_ativa: false, nfe_pausa_motivo: motivo,
        });
        await b.registrar(cnpj, "NFE", motivo + nsuSefaz);
        return { ok: false, mensagem: motivo };
      }
      await b.atualizarEmpresa(cnpj, { bloqueio_nfe: new Date(agora() + ESPERA_MS).toISOString(), nfe_656_seguidas: seguidas });
      const hora = new Date(agora() + ESPERA_MS).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
      mensagem = `A SEFAZ pediu 1h de espera para este CNPJ (rejeição 656, consumo indevido). Normalmente é porque outro sistema da empresa ` +
        `(ERP, contabilidade ou portal de notas) consultou as NF-e há menos de 1 hora. Nada se perde: a busca tenta de novo sozinha a partir das ${hora}.`;
      await b.registrar(cnpj, "NFE", "Rejeição 656" + nsuSefaz);
      break;
    }
    if (ret.cStat !== "137" && ret.cStat !== "138") throw new ErroSefaz(`SEFAZ cStat ${ret.cStat}: ${ret.xMotivo}`);
    for (const doc of ret.docs) resumo[await processarDocumento(b, cnpj, doc)]++;
    ult = Math.max(ult, ret.ultNSU);
    await b.atualizarEmpresa(cnpj, {
      ult_nsu_nfe: ult, max_nsu_nfe: ret.maxNSU, ultima_sinc_nfe: new Date(agora()).toISOString(), nfe_656_seguidas: 0,
    });
    if (ret.cStat === "137" || ret.ultNSU >= ret.maxNSU) {
      await b.atualizarEmpresa(cnpj, { bloqueio_nfe: new Date(agora() + ESPERA_MS).toISOString() });
      mensagem = "Tudo baixado. A SEFAZ libera a próxima consulta em 1h.";
      break;
    }
    if (agora() - inicio > prazo) {
      parcial = true;
      mensagem = `Baixado até o NSU ${ult} de ${ret.maxNSU}; o restante continua na próxima busca.`;
      break;
    }
    await new Promise((r) => setTimeout(r, opts.pausaMs ?? 1500));
  }
  await b.registrar(cnpj, "NFE", `${mensagem} ${JSON.stringify(resumo)}`);
  return { ok: true, mensagem, resumo, ult_nsu: ult, parcial };
}

// ------------------------------------------------------------------ recuperação por NSU (consNSU)
/** Máximo de consultas por número por rodada (a SEFAZ aceita 20/hora; 656 bloqueia o CNPJ 1h). */
export const MAX_CONS_NSU_POR_RODADA = 15;
/** Respostas "nenhum documento" seguidas que encerram a recuperação (já passou dos 90 dias ou não há mais). */
export const FIM_RECUPERACAO_VAZIOS = 10;

/**
 * Busca, de trás para frente, os documentos de NSU já consumidos por outro sistema do cliente
 * (distNSU não volta atrás). Progresso em nf_empresas.nfe_recuperar_nsu. Retorna null se não há recuperação.
 */
export async function recuperarAnteriores(
  b: Banco, http: Http, cnpj: string, opts: { max?: number; agora?: () => number } = {},
): Promise<Resultado | null> {
  const agora = opts.agora ?? Date.now;
  const emp = await b.empresa(cnpj);
  if (!emp || !emp.nfe_recuperar_nsu || emp.nfe_ativa === false) return null;
  if ((emp.nfe_656_seguidas ?? 0) > 0 && emp.bloqueio_nfe && new Date(emp.bloqueio_nfe).getTime() > agora()) {
    return { ok: false, mensagem: "Recuperação aguardando: a SEFAZ bloqueou o CNPJ por 1h (rejeição 656)." };
  }
  // no máximo 1 rodada por hora: 15 consultas/rodada < 20/hora da SEFAZ (botão + cron não somam além disso)
  if (emp.nfe_recuperar_em && agora() - new Date(emp.nfe_recuperar_em).getTime() < ESPERA_MS) {
    const hora = new Date(new Date(emp.nfe_recuperar_em).getTime() + ESPERA_MS).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    return { ok: true, mensagem: `Recuperação em andamento (próximo NSU ${emp.nfe_recuperar_nsu}); a próxima rodada fica liberada às ${hora}.` };
  }
  await b.atualizarEmpresa(cnpj, { nfe_recuperar_em: new Date(agora()).toISOString() });
  const cuf = UF_CODIGO[emp.uf] ?? 33;
  let nsu = Number(emp.nfe_recuperar_nsu), vazios = emp.nfe_recuperar_vazios ?? 0, total = emp.nfe_recuperar_total ?? 0;
  const resumo: Resumo = { nova: 0, atualizada: 0, evento: 0, ignorada: 0, outro: 0 };
  const max = opts.max ?? MAX_CONS_NSU_POR_RODADA;
  let feitas = 0, mensagem = "";
  while (feitas < max && nsu > 0 && vazios < FIM_RECUPERACAO_VAZIOS) {
    const ret = await consultarLote(http, cnpj, cuf, nsu, true);
    feitas++;
    if (ret.cStat === "656") {
      await b.atualizarEmpresa(cnpj, { nfe_recuperar_nsu: nsu, nfe_recuperar_vazios: vazios, nfe_recuperar_total: total,
        bloqueio_nfe: new Date(agora() + ESPERA_MS).toISOString(), nfe_656_seguidas: (emp.nfe_656_seguidas ?? 0) + 1 });
      mensagem = `Recuperação pausada: a SEFAZ pediu 1h de espera (656) no NSU ${nsu}. Continua sozinha depois.`;
      await b.registrar(cnpj, "NFE-RECUPERAR", `${mensagem} ${JSON.stringify(resumo)}`);
      return { ok: false, mensagem, resumo };
    }
    if (ret.cStat === "138") {
      for (const doc of ret.docs) resumo[await processarDocumento(b, cnpj, doc)]++;
      total += ret.docs.length; vazios = 0;
    } else if (ret.cStat === "137" || ret.cStat === "589") {
      vazios++;
    } else {
      throw new ErroSefaz(`SEFAZ cStat ${ret.cStat} na consulta do NSU ${nsu}: ${ret.xMotivo}`);
    }
    nsu--;
    await b.atualizarEmpresa(cnpj, { nfe_recuperar_nsu: nsu, nfe_recuperar_vazios: vazios, nfe_recuperar_total: total });
  }
  if (nsu <= 0 || vazios >= FIM_RECUPERACAO_VAZIOS) {
    await b.atualizarEmpresa(cnpj, { nfe_recuperar_nsu: null, nfe_recuperar_vazios: 0 });
    mensagem = `Recuperação de NF-e anteriores concluída: ${total} documento(s) recuperado(s) no total.`;
  } else {
    mensagem = `Recuperação de NF-e anteriores: ${feitas} consulta(s) nesta rodada, próximo NSU ${nsu}. Continua na próxima hora.`;
  }
  await b.registrar(cnpj, "NFE-RECUPERAR", `${mensagem} ${JSON.stringify(resumo)}`);
  return { ok: true, mensagem, resumo };
}

// ------------------------------------------------------------------ manifestação do destinatário
/** Eventos que o Buscador registra, sempre por clique (admin ou cliente com acesso ao CNPJ), nunca automático.
 *  Prazos (NT 2020.001): ciência até 10 dias da autorização; confirmação até 90 dias (v1.60, desde 01/06/2026). */
export const EVENTOS = {
  ciencia: { tp: "210210", desc: "Ciencia da Operacao", nome: "Ciência da Operação", prazoDias: 10 },
  confirmacao: { tp: "210200", desc: "Confirmacao da Operacao", nome: "Confirmação da Operação", prazoDias: 90 },
} as const;
export type TipoEvento = keyof typeof EVENTOS;

/** infEvento já na forma canônica (C14N inclusiva, herdando o xmlns da NF-e). */
function infEventoCanonico(cnpj: string, chave: string, dhEvento: string, tipo: TipoEvento = "ciencia") {
  const ev = EVENTOS[tipo];
  const id = `ID${ev.tp}${chave}01`;
  const campos: [string, string][] = [
    ["cOrgao", "91"], ["tpAmb", "1"], ["CNPJ", cnpj], ["chNFe", chave], ["dhEvento", dhEvento],
    ["tpEvento", ev.tp], ["nSeqEvento", "1"], ["verEvento", "1.00"],
  ];
  const corpo = campos.map(([t, v]) => `<${t}>${esc(v)}</${t}>`).join("") +
    `<detEvento versao="1.00"><descEvento>${ev.desc}</descEvento></detEvento>`;
  return {
    id,
    canonico: `<infEvento xmlns="${NS}" Id="${id}">${corpo}</infEvento>`,
    noDocumento: `<infEvento Id="${id}">${corpo}</infEvento>`,
  };
}

function dhBrasilia(agora: number): string {
  const d = new Date(agora - 30_000 - 3 * 3600_000); // UTC-3, 30s de folga contra relógio adiantado
  return d.toISOString().slice(0, 19) + "-03:00";
}

export async function montarEnvEvento(g: CertGuardado, cnpj: string, chaves: string[], agora = Date.now(), tipo: TipoEvento = "ciencia"): Promise<string> {
  const chave = await chaveDeAssinatura(g);
  const certB64 = certificadoDerB64(g);
  const dh = dhBrasilia(agora);
  const eventos: string[] = [];
  for (const ch of chaves) {
    const inf = infEventoCanonico(cnpj, ch, dh, tipo);
    const digest = b64(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(inf.canonico)));
    const signedInfoInterno =
      `<CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>` +
      `<SignatureMethod Algorithm="${DS}rsa-sha1"></SignatureMethod>` +
      `<Reference URI="#${inf.id}"><Transforms>` +
      `<Transform Algorithm="${DS}enveloped-signature"></Transform>` +
      `<Transform Algorithm="${C14N}"></Transform></Transforms>` +
      `<DigestMethod Algorithm="${DS}sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference>`;
    const assinatura = b64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chave,
      new TextEncoder().encode(`<SignedInfo xmlns="${DS}">${signedInfoInterno}</SignedInfo>`)));
    eventos.push(
      `<evento versao="1.00">${inf.noDocumento}<Signature xmlns="${DS}"><SignedInfo>${signedInfoInterno}</SignedInfo>` +
        `<SignatureValue>${assinatura}</SignatureValue><KeyInfo><X509Data><X509Certificate>${certB64}` +
        `</X509Certificate></X509Data></KeyInfo></Signature></evento>`,
    );
  }
  const idLote = String(agora).slice(-15);
  return `<envEvento xmlns="${NS}" versao="1.00"><idLote>${idLote}</idLote>${eventos.join("")}</envEvento>`;
}

export const CSTAT_CIENCIA_OK = new Set(["135", "136", "573"]); // registrado / vinculado / já registrado

/** [chave, cStat, xMotivo, nProt, dhRegEvento] por nota. Guarda o XML enviado (assinado) e a resposta da SEFAZ
 *  em Storage ({cnpj}/eventos-enviados/...) — prova oficial; os caminhos vão para `arquivos`. */
export async function manifestarCiencia(
  b: Banco, http: Http, g: CertGuardado, cnpj: string, chaves: string[], tipo: TipoEvento = "ciencia",
  arquivos: string[] = [],
): Promise<[string, string, string, string, string][]> {
  const resultado: [string, string, string, string, string][] = [];
  const carimbo = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
  for (let i = 0; i < chaves.length; i += 20) {
    const grupo = chaves.slice(i, i + 20);
    const envEvento = await montarEnvEvento(g, cnpj, grupo, Date.now(), tipo);
    const corpo = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="${SOAP}"><soap12:Body>` +
      `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">` +
      `${envEvento}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
    const r = await http(URL_EVENTO, {
      method: "POST", body: corpo,
      headers: { "Content-Type": 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento"' },
    });
    const texto = await r.text();
    const base = `${cnpj}/eventos-enviados/${carimbo}-${EVENTOS[tipo].tp}-lote${i / 20 + 1}`;
    arquivos.push(await b.salvarXml(`${base}-enviado.xml`, envEvento), await b.salvarXml(`${base}-resposta-sefaz.xml`, texto));
    const raiz = X.parseXml(texto);
    const rets = X.todos(raiz, "retEvento").map((re) => X.todos(re, "infEvento")[0]).filter(Boolean);
    if (!rets.length) {
      const lote = X.todos(raiz, "retEnvEvento")[0];
      for (const c of grupo) resultado.push([c, lote ? X.txt(lote, "cStat") : "", lote ? X.txt(lote, "xMotivo") : `HTTP ${r.status}`, "", ""]);
      continue;
    }
    for (const inf of rets) {
      const ch = X.txt(inf, "chNFe"), cs = X.txt(inf, "cStat");
      resultado.push([ch, cs, X.txt(inf, "xMotivo"), X.txt(inf, "nProt"), X.txt(inf, "dhRegEvento")]);
      if (CSTAT_CIENCIA_OK.has(cs)) await b.marcarManifestada(cnpj, ch);
    }
  }
  await b.registrar(cnpj, tipo === "ciencia" ? "CIENCIA" : "CONFIRMACAO", `${EVENTOS[tipo].nome}, ${chaves.length} nota(s): ` + resultado.map(([c, s]) => `${c.slice(-6)}=${s}`).join(", "));
  return resultado;
}
