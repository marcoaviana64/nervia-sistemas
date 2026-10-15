// Testes das Edge Functions sem Supabase e sem internet.
// Rodar (na pasta do projeto):  deno test -A testes/funcoes_test.ts
// Antes, gere os certificados de teste:  python3 testes/gerar_fixtures.py   (e: pip install pyopenssl)
import nodeAssert from "node:assert/strict";
const assert = (c: unknown, m?: string) => nodeAssert.ok(c, m);
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
const assertRejects = (f: () => Promise<unknown>, _t?: unknown, msg?: string) =>
  nodeAssert.rejects(f, (e: Error) => !msg || e.message.includes(msg));
import { lerPfx, clienteHttp, CertGuardado } from "../supabase/functions/_shared/certificado.ts";
import * as sefaz from "../supabase/functions/_shared/sefaz.ts";
import * as adn from "../supabase/functions/_shared/adn.ts";
import { httpViaPonte, nfeHabilitada } from "../supabase/functions/_shared/ponte.ts";
import type { Banco, Empresa } from "../supabase/functions/_shared/banco.ts";
import type { DadosNota } from "../supabase/functions/_shared/xml.ts";

const DIR = new URL("./fixtures/", import.meta.url);
const CNPJ = "12345678000199";
const pfx = (n: string) => btoa(String.fromCharCode(...Deno.readFileSync(new URL(n, DIR))));

// ------------------------------------------------------------------ banco em memória (mesma regra do gravar_nota SQL)
type Nota = DadosNota & { tipo: string; nsu: number; manifestada: boolean; xml_path: string | null; papel: string };
function bancoFalso(emp: Partial<Empresa> = {}) {
  const e: Empresa = {
    cnpj: CNPJ, nome: "Teste", uf: "RJ", ativo: true, busca_automatica: true, cert_secret_id: "x",
    cert_validade: null, ult_nsu_nfe: 0, max_nsu_nfe: 0, bloqueio_nfe: null, ult_nsu_nfse: 0, ...emp,
  };
  const notas = new Map<string, Nota>();
  const arquivos = new Map<string, string>();
  const log: string[] = [];
  const b: Banco = {
    empresa: async () => ({ ...e }),
    atualizarEmpresa: async (_c, campos) => { Object.assign(e, campos); },
    gravarNota: async (_c, tipo, d, nsu, p) => {
      const k = tipo + d.chave, atual = notas.get(k);
      const papel = d.emit_cnpj === CNPJ ? "emitida" : "recebida";
      if (!atual) { notas.set(k, { ...d, tipo, nsu, manifestada: false, xml_path: p, papel }); return "nova"; }
      if (atual.completo && !d.completo) return "ignorada";
      notas.set(k, { ...atual, ...d, numero: d.numero || atual.numero, nsu, xml_path: p ?? atual.xml_path, papel,
        situacao: atual.situacao === "Cancelada" ? "Cancelada" : d.situacao, completo: atual.completo || d.completo });
      return "atualizada";
    },
    marcarCancelada: async (_c, tipo, ch) => { const n = notas.get(tipo + ch); if (n) n.situacao = "Cancelada"; },
    marcarManifestada: async (_c, ch) => { const n = notas.get("NFE" + ch); if (n) n.manifestada = true; },
    salvarXml: async (p, x) => { arquivos.set(p, x); return p; },
    registrar: async (_c, o, m) => { log.push(`${o}: ${m}`); },
    lerCertificado: async () => null,
  };
  return { b, e, notas, arquivos, log };
}

// fila de respostas HTTP simuladas
function httpFalso(respostas: (() => Response)[]) {
  const enviados: { url: string; body: string }[] = [];
  const http: sefaz.Http = async (url, init) => {
    enviados.push({ url, body: String(init.body ?? "") });
    const r = respostas.shift();
    if (!r) throw new Error("requisição inesperada: " + url);
    return r();
  };
  return { http, enviados, restantes: () => respostas.length };
}

async function gzB64(s: string) {
  const buf = await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
const NS = "http://www.portalfiscal.inf.br/nfe";
async function retDist(cStat: string, ult: number, max: number, docs: [number, string, string][]) {
  const dz = (await Promise.all(docs.map(async ([n, s, x]) =>
    `<docZip NSU="${String(n).padStart(15, "0")}" schema="${s}">${await gzB64(x)}</docZip>`))).join("");
  const xml = `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDistDFeInteresseResult><retDistDFeInt xmlns="${NS}" versao="1.01"><tpAmb>1</tpAmb><cStat>${cStat}</cStat><xMotivo>m${cStat}</xMotivo><ultNSU>${String(ult).padStart(15, "0")}</ultNSU><maxNSU>${String(max).padStart(15, "0")}</maxNSU>${docs.length ? `<loteDistDFeInt>${dz}</loteDistDFeInt>` : ""}</retDistDFeInt></nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>`;
  return () => new Response(xml, { status: 200 });
}

const CH1 = "33261011111111000111550010000012341000012345";
const CH2 = "33261022222222000122550010000005671000056789";
const res1 = `<resNFe xmlns="${NS}" versao="1.01"><chNFe>${CH1}</chNFe><CNPJ>11111111000111</CNPJ><xNome>FORNECEDOR A LTDA</xNome><dhEmi>2026-10-01T10:00:00-03:00</dhEmi><vNF>1500.50</vNF><cSitNFe>1</cSitNFe></resNFe>`;
const proc = (ch: string, emit: string, nome: string, n: string, v: string, dt: string) =>
  `<nfeProc xmlns="${NS}" versao="4.00"><NFe><infNFe Id="NFe${ch}" versao="4.00"><ide><nNF>${n}</nNF><dhEmi>${dt}</dhEmi></ide><emit><CNPJ>${emit}</CNPJ><xNome>${nome}</xNome></emit><dest><CNPJ>${CNPJ}</CNPJ><xNome>EMPRESA TESTE</xNome></dest><total><ICMSTot><vNF>${v}</vNF></ICMSTot></total></infNFe></NFe><protNFe versao="4.00"><infProt><chNFe>${ch}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
const proc2 = proc(CH2, "22222222000122", "FORNECEDOR B SA", "567", "320.00", "2026-09-20T09:00:00-03:00");
const canc2 = `<resEvento xmlns="${NS}" versao="1.01"><chNFe>${CH2}</chNFe><tpEvento>110111</tpEvento><xEvento>Cancelamento</xEvento></resEvento>`;

// ------------------------------------------------------------------ testes
Deno.test("certificado: .pfx moderno (AES) e legado (3DES) — CNPJ, titular, cadeia", () => {
  for (const arq of ["a1_moderno.pfx", "a1_legado.pfx"]) {
    const t0 = performance.now();
    const info = lerPfx(pfx(arq), "1234");
    const ms = performance.now() - t0;
    assertEquals(info.cnpj, CNPJ);
    assertEquals(info.titular, `EMPRESA TESTE LTDA:${CNPJ}`);
    assertEquals(info.guardado.cert_pem.match(/BEGIN CERTIFICATE/g)!.length, 2); // titular + AC
    assert(info.guardado.key_pem.includes("BEGIN PRIVATE KEY"));
    console.log(`   ${arq}: lido em ${ms.toFixed(0)} ms`);
  }
});

Deno.test("certificado: senha errada", () => {
  let msg = "";
  try { lerPfx(pfx("a1_moderno.pfx"), "errada"); } catch (e) { msg = (e as Error).message; }
  assertEquals(msg, "Senha incorreta ou arquivo .pfx inválido");
});

Deno.test("mTLS real: servidor que exige certificado aceita o A1 e recusa sem ele", async () => {
  const porta = 18443;
  const proc = new Deno.Command("python3", { args: [new URL("./servidor_mtls.py", import.meta.url).pathname, String(porta)], stdout: "piped", stderr: "null" }).spawn();
  const leitor = proc.stdout.getReader();
  await leitor.read(); // "pronto"
  try {
    const g = lerPfx(pfx("a1_moderno.pfx"), "1234").guardado;
    const ac = Deno.readTextFileSync(new URL("ac.pem", DIR));
    Deno.env.set("CADEIA_EXTRA_PEM", ac); // o servidor de teste é assinado pela AC de teste
    const client = clienteHttp(g);
    const r = await fetch(`https://localhost:${porta}/`, { method: "POST", body: sefaz.envelopeDist(CNPJ, 33, 0), client } as RequestInit);
    const ret = await sefaz.interpretarRetornoDist(await r.text());
    client.close();
    assertEquals(ret.cStat, "137");
    assert(ret.xMotivo.includes(`cliente: EMPRESA TESTE LTDA:${CNPJ}`), ret.xMotivo);
    assert(ret.xMotivo.includes("recebeu CNPJ True"));
    console.log("   servidor viu o certificado:", ret.xMotivo);
    // sem certificado de cliente → handshake recusado
    const semCert = Deno.createHttpClient({ caCerts: [ac] });
    await assertRejects(() => fetch(`https://localhost:${porta}/`, { method: "POST", body: "x", client: semCert } as RequestInit));
    semCert.close();
  } finally {
    Deno.env.delete("CADEIA_EXTRA_PEM");
    proc.kill();
    await leitor.cancel();
    await proc.status;
  }
});

Deno.test("NF-e: lotes, cancelamento, bloqueio de 1h e 656", async () => {
  const { b, e, notas, log } = bancoFalso();
  const { http, enviados, restantes } = httpFalso([
    await retDist("138", 2, 3, [[1, "resNFe_v1.01.xsd", res1], [2, "procNFe_v4.00.xsd", proc2]]),
    await retDist("138", 3, 3, [[3, "resEvento_1.01.xsd", canc2]]),
  ]);
  const r = await sefaz.sincronizar(b, http, CNPJ, { pausaMs: 0 });
  assertEquals(r.resumo, { nova: 2, atualizada: 0, evento: 1, ignorada: 0, outro: 0 });
  assertEquals(restantes(), 0);
  assert(enviados[1].body.includes("<ultNSU>000000000000002</ultNSU>"), "2º lote deve continuar do ultNSU");
  assertEquals(e.ult_nsu_nfe, 3);
  assert(e.bloqueio_nfe && new Date(e.bloqueio_nfe).getTime() > Date.now() + 59 * 60_000);
  assertEquals(notas.get("NFE" + CH2)!.situacao, "Cancelada");
  assertEquals(notas.get("NFE" + CH1)!.numero, "1234"); // número tirado da chave do resumo
  // logo em seguida: bloqueado, nem chama a SEFAZ
  const r2 = await sefaz.sincronizar(b, httpFalso([]).http, CNPJ);
  assert(!r2.ok && r2.mensagem.includes("min"));
  // 656
  e.bloqueio_nfe = null;
  const r3 = await sefaz.sincronizar(b, httpFalso([await retDist("656", 3, 0, [])]).http, CNPJ, { pausaMs: 0 });
  assert(r3.mensagem.includes("1h") && r3.mensagem.includes("outro sistema") && /\d\d:\d\d/.test(r3.mensagem) && e.bloqueio_nfe);
  assert(log.length >= 2);
});

Deno.test("NF-e: trava automática após 2 rejeições 656 seguidas e liga/desliga", async () => {
  const { b, e, log } = bancoFalso();
  // 1ª 656: só bloqueia 1h e conta
  const r1 = await sefaz.sincronizar(b, httpFalso([await retDist("656", 500, 600, [])]).http, CNPJ, { pausaMs: 0 });
  assert(!r1.ok || r1.mensagem.includes("1h"));
  assert(e.nfe_656_seguidas === 1 && e.nfe_ativa !== false);
  assert(e.ult_nsu_nfe === 0, "656 não pode avançar o NSU (perderia notas)");
  assert(log.some((l) => l.includes("SEFAZ informou ultNSU")));
  // sucesso zera a contagem
  e.bloqueio_nfe = null;
  await sefaz.sincronizar(b, httpFalso([await retDist("137", 0, 0, [])]).http, CNPJ, { pausaMs: 0 });
  assert(e.nfe_656_seguidas === 0);
  // duas 656 seguidas: desliga a NF-e da empresa e grava o motivo
  e.bloqueio_nfe = null;
  await sefaz.sincronizar(b, httpFalso([await retDist("656", 0, 0, [])]).http, CNPJ, { pausaMs: 0 });
  e.bloqueio_nfe = null;
  const r3 = await sefaz.sincronizar(b, httpFalso([await retDist("656", 0, 0, [])]).http, CNPJ, { pausaMs: 0 });
  assert(!r3.ok && e.nfe_ativa === false && e.nfe_656_seguidas === 2, JSON.stringify(e));
  assert(String(e.nfe_pausa_motivo).includes("outro sistema") && r3.mensagem.includes("Ligar NF-e"));
  assert(log.some((l) => l.includes("pausada automaticamente")));
  // desligada: não consulta a SEFAZ
  e.bloqueio_nfe = null;
  const { http, enviados } = httpFalso([await retDist("137", 0, 0, [])]);
  const r4 = await sefaz.sincronizar(b, http, CNPJ, { pausaMs: 0 });
  assert(!r4.ok && enviados.length === 0);
});

Deno.test("NF-e: recuperação por NSU (consNSU) de trás para frente, com limite por rodada", async () => {
  const { b, e, notas, log } = bancoFalso({ ult_nsu_nfe: 3, nfe_recuperar_nsu: 3 } as Partial<Empresa>);
  const h1 = httpFalso([await retDist("138", 3, 3, [[3, "resNFe_v1.01.xsd", res1]]), await retDist("137", 3, 3, [])]);
  const r1 = await sefaz.recuperarAnteriores(b, h1.http, CNPJ, { max: 2 });
  assert(r1!.ok && e.nfe_recuperar_nsu === 1 && e.nfe_recuperar_total === 1, JSON.stringify(e));
  assert(h1.enviados[0].body.includes("<consNSU><NSU>000000000000003</NSU></consNSU>") && h1.enviados[1].body.includes("<NSU>000000000000002</NSU>"));
  assert(notas.size === 1 && e.ult_nsu_nfe === 3, "não mexe na sequência normal");
  // segunda rodada na mesma hora: não consulta (limite de 20/hora da SEFAZ)
  const h1b = httpFalso([]);
  const r1b = await sefaz.recuperarAnteriores(b, h1b.http, CNPJ, { max: 2 });
  assert(r1b!.ok && h1b.enviados.length === 0 && r1b!.mensagem.includes("próxima rodada"), r1b!.mensagem);
  e.nfe_recuperar_em = null;
  // 656 pausa sem perder o ponto
  const r2 = await sefaz.recuperarAnteriores(b, httpFalso([await retDist("656", 3, 3, [])]).http, CNPJ, { max: 2 });
  assert(!r2!.ok && e.nfe_recuperar_nsu === 1 && e.bloqueio_nfe, JSON.stringify(e));
  // bloqueado por 656: nem consulta
  const h3 = httpFalso([]);
  const r3 = await sefaz.recuperarAnteriores(b, h3.http, CNPJ, { max: 2 });
  assert(!r3!.ok && h3.enviados.length === 0);
  // passou a hora: termina no NSU 1
  e.bloqueio_nfe = null; e.nfe_656_seguidas = 0; e.nfe_recuperar_em = null;
  const r4 = await sefaz.recuperarAnteriores(b, httpFalso([await retDist("138", 3, 3, [[1, "procNFe_v4.00.xsd", proc2]])]).http, CNPJ, { max: 2 });
  assert(r4!.ok && e.nfe_recuperar_nsu === null && r4!.mensagem.includes("concluída: 2"), r4!.mensagem);
  assert(log.some((l) => l.includes("NFE-RECUPERAR") || l.includes("Recuperação")));
  assert(await sefaz.recuperarAnteriores(b, httpFalso([]).http, CNPJ) === null, "sem recuperação pendente");
});

Deno.test("NF-e: para no prazo sem bloquear e continua depois", async () => {
  const { b, e } = bancoFalso();
  let t = 0;
  const { http } = httpFalso([await retDist("138", 1, 5, [[1, "resNFe_v1.01.xsd", res1]])]);
  const r = await sefaz.sincronizar(b, http, CNPJ, { pausaMs: 0, prazoMs: 10, agora: () => (t += 20) });
  assert(r.parcial && !e.bloqueio_nfe && e.ult_nsu_nfe === 1);
});

Deno.test("NF-e: o XML completo substitui o resumo; resumo não sobrescreve completo", async () => {
  const { b, notas } = bancoFalso();
  const proc1 = proc(CH1, "11111111000111", "FORNECEDOR A LTDA", "1234", "1500.50", "2026-10-01T10:00:00-03:00");
  await sefaz.sincronizar(b, httpFalso([await retDist("138", 1, 1, [[1, "resNFe_v1.01.xsd", res1]])]).http, CNPJ, { pausaMs: 0 });
  assertEquals(notas.get("NFE" + CH1)!.completo, false);
  const { b: b2 } = { b };
  // simula liberação e nova busca com o procNFe + um resumo atrasado
  (await b2.atualizarEmpresa(CNPJ, { bloqueio_nfe: null }));
  const r = await sefaz.sincronizar(b2, httpFalso([await retDist("138", 3, 3, [[2, "procNFe_v4.00.xsd", proc1], [3, "resNFe_v1.01.xsd", res1]])]).http, CNPJ, { pausaMs: 0 });
  assertEquals(r.resumo!.atualizada, 1);
  assertEquals(r.resumo!.ignorada, 1);
  assertEquals(notas.get("NFE" + CH1)!.completo, true);
});

Deno.test("Ciência: envia evento 210210 e marca as notas", async () => {
  const { b, notas } = bancoFalso();
  await sefaz.sincronizar(b, httpFalso([await retDist("138", 1, 1, [[1, "resNFe_v1.01.xsd", res1]])]).http, CNPJ, { pausaMs: 0 });
  const g = lerPfx(pfx("a1_moderno.pfx"), "1234").guardado;
  const resp = `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg><retEnvEvento xmlns="${NS}" versao="1.00"><cStat>128</cStat><xMotivo>Lote processado</xMotivo><retEvento versao="1.00"><infEvento><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${CH1}</chNFe></infEvento></retEvento></retEnvEvento></nfeResultMsg></soap:Body></soap:Envelope>`;
  const { http, enviados } = httpFalso([() => new Response(resp)]);
  const res = await sefaz.manifestarCiencia(b, http, g, CNPJ, [CH1]);
  assertEquals(res[0][1], "135");
  assert(notas.get("NFE" + CH1)!.manifestada);
  assert(enviados[0].url === sefaz.URL_EVENTO && enviados[0].body.includes("<descEvento>Ciencia da Operacao</descEvento>"));
});

Deno.test("Confirmação da Operação: evento 210200 e prazos", async () => {
  const { b, notas } = bancoFalso();
  await sefaz.sincronizar(b, httpFalso([await retDist("138", 1, 1, [[1, "resNFe_v1.01.xsd", res1]])]).http, CNPJ, { pausaMs: 0 });
  const g = lerPfx(pfx("a1_moderno.pfx"), "1234").guardado;
  const resp = `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg><retEnvEvento xmlns="${NS}" versao="1.00"><cStat>128</cStat><xMotivo>Lote processado</xMotivo><retEvento versao="1.00"><infEvento><cStat>135</cStat><xMotivo>Evento registrado</xMotivo><chNFe>${CH1}</chNFe></infEvento></retEvento></retEnvEvento></nfeResultMsg></soap:Body></soap:Envelope>`;
  const { http, enviados } = httpFalso([() => new Response(resp)]);
  const arquivos: string[] = [];
  const res = await sefaz.manifestarCiencia(b, http, g, CNPJ, [CH1], "confirmacao", arquivos);
  assert(arquivos.length === 2 && arquivos[0].includes("/eventos-enviados/") && arquivos[0].endsWith("-210200-lote1-enviado.xml"), arquivos.join());
  assertEquals(res[0][1], "135");
  assert(notas.get("NFE" + CH1)!.manifestada);
  const corpo = enviados[0].body;
  assert(corpo.includes("<tpEvento>210200</tpEvento>") && corpo.includes("<descEvento>Confirmacao da Operacao</descEvento>") && corpo.includes(`Id="ID210200${CH1}01"`));
  assertEquals(sefaz.EVENTOS.ciencia.prazoDias, 10);
  assertEquals(sefaz.EVENTOS.confirmacao.prazoDias, 90);
});

Deno.test("Ciência: gera envEvento para conferência independente da assinatura", async () => {
  const g = lerPfx(pfx("a1_moderno.pfx"), "1234").guardado;
  const xml = await sefaz.montarEnvEvento(g, CNPJ, ["3".repeat(44), "4".repeat(44)]);
  Deno.writeTextFileSync(new URL("./saida_envEvento.xml", import.meta.url), xml);
});

Deno.test("NFS-e (ADN): baixa, lê valores, trata 404 e erro", async () => {
  const { b, e, notas } = bancoFalso();
  const CHS = "3304557" + "1".repeat(43);
  const nfse = `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00"><infNFSe Id="NFS${CHS}"><nNFSe>88</nNFSe><dhProc>2026-10-05T11:00:00-03:00</dhProc><emit><CNPJ>33333333000133</CNPJ><xNome>PRESTADOR C ME</xNome></emit><valores><vLiq>950.00</vLiq></valores><DPS><infDPS Id="DPS1"><dhEmi>2026-10-05T10:00:00-03:00</dhEmi><prest><CNPJ>33333333000133</CNPJ></prest><toma><CNPJ>${CNPJ}</CNPJ><xNome>EMPRESA TESTE</xNome></toma><valores><vServPrest><vServ>1000.00</vServ></vServPrest></valores></infDPS></DPS></infNFSe></NFSe>`;
  const ok = JSON.stringify({ StatusProcessamento: "DOCUMENTOS_LOCALIZADOS", LoteDFe: [{ NSU: 7, ChaveAcesso: CHS, TipoDocumento: "NFSE", ArquivoXml: await gzB64(nfse) }] });
  const vazio = JSON.stringify({ StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO", LoteDFe: [] });
  const { http, enviados } = httpFalso([() => new Response(ok), () => new Response(vazio, { status: 404 })]);
  const r = await adn.sincronizar(b, http, CNPJ, { pausaMs: 0 });
  assertEquals(r.resumo!.nova, 1);
  assert(enviados[0].url.includes("/contribuintes/DFe/0?cnpjConsulta=12345678000199&lote=true"));
  assert(enviados[1].url.includes("/DFe/7?"));
  const n = notas.get("NFSE" + CHS)!;
  assertEquals([n.numero, n.emit_nome, n.valor, n.papel, n.data_emissao], ["88", "PRESTADOR C ME", 1000, "recebida", "2026-10-05T10:00:00-03:00"]);
  assertEquals(e.ult_nsu_nfse, 7);
  const erro = JSON.stringify({ Erros: [{ Codigo: "E1", Descricao: "Certificado sem permissão" }] });
  await assertRejects(() => adn.sincronizar(b, httpFalso([() => new Response(erro, { status: 403 })]).http, CNPJ), Error, "Certificado sem permissão");
});

Deno.test("Ponte SEFAZ (OpenSSL): funções → ponte → servidor que exige certificado", async () => {
  const PS = 18444, PP = 18445, PR = 18446;
  const ac = Deno.readTextFileSync(new URL("ac.pem", DIR));
  const srv = new Deno.Command("python3", { args: [new URL("./servidor_mtls.py", import.meta.url).pathname, String(PS)], stdout: "piped", stderr: "null" }).spawn();
  const ponte = new Deno.Command("python3", {
    args: [new URL("../ponte-sefaz/main.py", import.meta.url).pathname], stdout: "piped", stderr: "null",
    env: { PORT: String(PP), PONTE_SEGREDO: "segredo-de-teste", CADEIA_EXTRA_PEM: ac, PONTE_HOSTS_EXTRA: "localhost" },
  }).spawn();
  // imita a SEFAZ de NF-e: pede o certificado só depois, por renegociação TLS (precisa de: pip install pyopenssl)
  const reneg = new Deno.Command("python3", { args: [new URL("./servidor_renegociacao.py", import.meta.url).pathname, String(PR)], stdout: "piped", stderr: "null" }).spawn();
  const l1 = srv.stdout.getReader(), l2 = ponte.stdout.getReader(), l3 = reneg.stdout.getReader();
  await l1.read(); await l2.read(); await l3.read();
  const g = lerPfx(pfx("a1_moderno.pfx"), "1234").guardado;
  try {
    assertEquals(nfeHabilitada(), false); // sem PONTE_URL a NF-e fica desligada
    Deno.env.set("PONTE_URL", `http://127.0.0.1:${PP}/`);
    Deno.env.set("PONTE_SEGREDO", "segredo-de-teste");
    assertEquals(nfeHabilitada(), true);

    // 1) chamada completa: a ponte apresenta o A1 e devolve a resposta do servidor
    const http = httpViaPonte(g);
    const r = await http(`https://localhost:${PS}/`, {
      method: "POST", body: sefaz.envelopeDist(CNPJ, 33, 0), headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
    });
    const ret = await sefaz.interpretarRetornoDist(await r.text());
    assertEquals(ret.cStat, "137");
    assert(ret.xMotivo.includes(`cliente: EMPRESA TESTE LTDA:${CNPJ}`), ret.xMotivo);
    assert(ret.xMotivo.includes("recebeu CNPJ True"));
    console.log("   via ponte, servidor viu:", ret.xMotivo);

    // 2) o problema real: servidor que renegocia. Direto do Deno (rustls) falha; pela ponte (OpenSSL) funciona.
    Deno.env.set("CADEIA_EXTRA_PEM", ac);
    const client = clienteHttp(g);
    await assertRejects(() => fetch(`https://localhost:${PR}/`, { method: "POST", body: "x", client } as RequestInit).then((r) => r.text()));
    client.close();
    Deno.env.delete("CADEIA_EXTRA_PEM");
    const r2 = await http(`https://localhost:${PR}/`, { method: "POST", body: sefaz.envelopeDist(CNPJ, 33, 0), headers: { "Content-Type": "application/soap+xml" } });
    const ret2 = await sefaz.interpretarRetornoDist(await r2.text());
    assertEquals(ret2.cStat, "137");
    assert(ret2.xMotivo.includes(`renegociou; cliente: EMPRESA TESTE LTDA:${CNPJ}`), ret2.xMotivo);
    console.log("   renegociação: direto falha, via ponte:", ret2.xMotivo);

    // 3) segredo errado → recusado
    Deno.env.set("PONTE_SEGREDO", "errado");
    await assertRejects(() => httpViaPonte(g)(`https://localhost:${PS}/`, { method: "POST", body: "x" }), Error, "PONTE_SEGREDO");
    Deno.env.set("PONTE_SEGREDO", "segredo-de-teste");

    // 4) servidor fora da lista (a ponte só fala com a SEFAZ) → recusado
    await assertRejects(() => httpViaPonte(g)("https://exemplo.com/", { method: "POST", body: "x" }), Error, "não permitido");

    // 5) ponte fora do ar → mensagem clara
    Deno.env.set("PONTE_URL", "http://127.0.0.1:1/");
    await assertRejects(() => httpViaPonte(g)(`https://localhost:${PS}/`, { method: "POST", body: "x" }), Error, "Ponte SEFAZ fora do ar");
  } finally {
    Deno.env.delete("PONTE_URL"); Deno.env.delete("PONTE_SEGREDO");
    Deno.env.delete("CADEIA_EXTRA_PEM");
    srv.kill(); ponte.kill(); reneg.kill();
    await l1.cancel(); await l2.cancel(); await l3.cancel();
    await srv.status; await ponte.status; await reneg.status;
  }
});

Deno.test("CORS: SITE_ORIGEM com vários endereços", async () => {
  const { origemPermitida } = await import("../supabase/functions/_shared/http.ts");
  const ok = ["https://nervia.com.br", "https://www.nervia.com.br"];
  assertEquals(origemPermitida("https://www.nervia.com.br", ok), "https://www.nervia.com.br");
  assertEquals(origemPermitida("https://nervia.com.br", ok), "https://nervia.com.br");
  assertEquals(origemPermitida("https://outro-site.com", ok), "https://nervia.com.br");
  assertEquals(origemPermitida("https://qualquer.com", []), "*");
});
