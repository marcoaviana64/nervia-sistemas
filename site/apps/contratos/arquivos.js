// Arquivos do app Contratos, tudo no navegador (nada vai para servidor de terceiros):
//   * zip: ler e gravar (o .docx e o .xlsx são zip); deflate pelo DecompressionStream/CompressionStream do navegador;
//   * docx: preencher os campos de mala direta (MERGEFIELD) do modelo do Word, tirando o vínculo com a planilha de
//     origem (mailMerge, recipientData) — o Word abre o arquivo gerado sem perguntar pela fonte de dados;
//   * xlsx: ler as abas (texto, número, data como número de série do Excel) para a carga da planilha antiga;
//   * extenso: valor em reais por extenso ("R$ 3.600,00 (três mil e seiscentos reais)") e data por extenso.
// Funciona no navegador (window.CTR_ARQ) e no Node 22 (module.exports), para os testes.
(function (raiz) {
  "use strict";
  const enc = new TextEncoder(), dec = new TextDecoder("utf-8");

  // ---------------------------------------------------------------- zip
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = ~0; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
  async function passar(b, stream) { return new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(stream)).arrayBuffer()); }

  // devolve Map(nome → Uint8Array) na ordem do arquivo
  async function lerZip(buf) {
    const u = new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    let fim = -1;
    for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; }
    if (fim < 0) throw new Error("O arquivo não é um .docx/.xlsx válido (zip sem diretório).");
    const n = dv.getUint16(fim + 10, true); let p = dv.getUint32(fim + 16, true);
    const out = new Map();
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Zip corrompido.");
      const met = dv.getUint16(p + 10, true), tam = dv.getUint32(p + 20, true);
      const ln = dv.getUint16(p + 28, true), lx = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true), loc = dv.getUint32(p + 42, true);
      const nome = dec.decode(u.subarray(p + 46, p + 46 + ln));
      const ini = loc + 30 + dv.getUint16(loc + 26, true) + dv.getUint16(loc + 28, true);
      const dados = u.subarray(ini, ini + tam);
      if (!nome.endsWith("/")) {
        if (met === 0) out.set(nome, dados.slice());
        else if (met === 8) out.set(nome, await passar(dados, new DecompressionStream("deflate-raw")));
        else throw new Error("Compressão não suportada no arquivo (" + met + ").");
      }
      p += 46 + ln + lx + lc;
    }
    return out;
  }

  // arquivos: Map ou lista [nome, Uint8Array|string]; devolve Uint8Array do zip
  async function gravarZip(arquivos) {
    const partes = [], central = []; let off = 0;
    for (const [nome, conteudo] of arquivos) {
      const dados = typeof conteudo === "string" ? enc.encode(conteudo) : conteudo;
      const nb = enc.encode(nome), crc = crc32(dados), z = await passar(dados, new CompressionStream("deflate-raw"));
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 8, true);
      h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, z.length, true);
      h.setUint32(22, dados.length, true); h.setUint16(26, nb.length, true); h.setUint16(28, 0, true);
      partes.push(new Uint8Array(h.buffer), nb, z);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 8, true);
      c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, z.length, true); c.setUint32(24, dados.length, true);
      c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), nb);
      off += 30 + nb.length + z.length;
    }
    const tamC = central.reduce((s, x) => s + x.length, 0), e = new DataView(new ArrayBuffer(22)), qtd = central.length / 2;
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, qtd, true); e.setUint16(10, qtd, true); e.setUint32(12, tamC, true); e.setUint32(16, off, true);
    const tudo = [...partes, ...central, new Uint8Array(e.buffer)], res = new Uint8Array(off + tamC + 22); let i = 0;
    for (const x of tudo) { res.set(x, i); i += x.length; }
    return res;
  }

  // ---------------------------------------------------------------- textos
  const xmlEsc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const xmlDes = s => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&");

  const UN = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze",
    "dezesseis", "dezessete", "dezoito", "dezenove"];
  const DZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  const CT = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
  function ate999(n) {
    if (n === 100) return "cem";
    const c = Math.floor(n / 100), r = n % 100, p = [];
    if (c) p.push(CT[c]);
    if (r) p.push(r < 20 ? UN[r] : DZ[Math.floor(r / 10)] + (r % 10 ? " e " + UN[r % 10] : ""));
    return p.join(" e ");
  }
  // inteiro por extenso (até 999 bilhões); "mil" sem "um" (mil e seiscentos)
  function inteiro(n) {
    if (n === 0) return "zero";
    const grupos = [[1e9, "bilhão", "bilhões"], [1e6, "milhão", "milhões"], [1e3, "mil", "mil"], [1, "", ""]];
    const partes = []; let resto = n;
    for (const [v, s, pl] of grupos) {
      const q = Math.floor(resto / v); resto %= v;
      if (!q) continue;
      if (v === 1) partes.push({ q, t: ate999(q) });
      else if (v === 1e3) partes.push({ q, t: q === 1 ? "mil" : ate999(q) + " mil" });
      else partes.push({ q, t: ate999(q) + " " + (q === 1 ? s : pl) });
    }
    // "e" antes do último grupo quando ele é menor que 100 ou centena redonda (dois mil e duzentos; mil e cinquenta)
    return partes.map((p, i) => i === 0 ? p.t : (i === partes.length - 1 && (p.q < 100 || p.q % 100 === 0) ? " e " : " ") + p.t).join("");
  }
  function reaisExtenso(valor) {
    const cent = Math.round(Number(valor) * 100);
    if (!isFinite(cent) || cent < 0) throw new Error("Valor inválido para o extenso: " + valor);
    const r = Math.floor(cent / 100), c = cent % 100, p = [];
    if (r) p.push(inteiro(r) + (r % 1e6 === 0 ? " de" : "") + (r === 1 ? " real" : " reais"));
    if (c) p.push(inteiro(c) + (c === 1 ? " centavo" : " centavos"));
    return p.length ? p.join(" e ") : "zero reais";
  }
  const brl = v => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const valorContrato = v => "R$ " + brl(v) + " (" + reaisExtenso(v) + ")";
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const dataBR = iso => iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "";
  const dataExtenso = iso => iso ? iso.slice(8, 10) + " de " + MESES[+iso.slice(5, 7) - 1] + " de " + iso.slice(0, 4) : "";

  // ---------------------------------------------------------------- docx
  // nome do campo: "CTT-NOME" e "CTTNOME" são o mesmo (o Word tira o hífen dos cabeçalhos da planilha)
  const normCampo = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const PARTES_DOCX = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
  const instrDe = x => [...x.matchAll(/<w:instrText(?:\s[^>]*)?>([^<]*)<\/w:instrText>/g)].map(m => xmlDes(m[1])).join("");
  const campoDe = instr => { const m = instr.match(/^\s*MERGEFIELD\s+"?([^\s"\\]+)/i); return m ? normCampo(m[1]) : null; };
  const runTexto = (rPr, valor) => {
    const linhas = String(valor ?? "").split(/\r?\n/);
    return "<w:r>" + rPr + linhas.map((l, i) => (i ? "<w:br/>" : "") + '<w:t xml:space="preserve">' + xmlEsc(l) + "</w:t>").join("") + "</w:r>";
  };

  // troca cada campo MERGEFIELD por um texto simples; devolve { xml, achados:Set, faltando:Set }
  function preencherXml(xml, valores) {
    const v = new Map(Object.entries(valores).map(([k, x]) => [normCampo(k), x]));
    const achados = new Set(), faltando = new Set();
    // campo simples <w:fldSimple w:instr=" MERGEFIELD X ">…</w:fldSimple>
    xml = xml.replace(/<w:fldSimple\s[^>]*w:instr="([^"]*)"[^>]*>([\s\S]*?)<\/w:fldSimple>/g, (todo, instr, dentro) => {
      const c = campoDe(xmlDes(instr)); if (!c) return todo;
      achados.add(c); if (!v.has(c)) faltando.add(c);
      const rPr = (dentro.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0];
      return runTexto(rPr, v.get(c));
    });
    // campo complexo: run com fldChar begin … instrText … separate … resultado … end (pode haver campos aninhados)
    const runs = [...xml.matchAll(/<w:r(?=[\s>/])(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:r>)/g)];
    const trocas = []; let pilha = [];
    for (const m of runs) {
      const r = m[0], ini = m.index, fim = m.index + r.length;
      const tipo = (r.match(/w:fldCharType="(begin|separate|end)"/) || [])[1];
      if (tipo === "begin") { pilha.push({ ini, instr: "", sep: false, rPr: null }); continue; }
      const f = pilha[pilha.length - 1];
      if (!f) continue;
      if (tipo === "separate") { f.sep = true; continue; }
      if (tipo === "end") {
        pilha.pop();
        const c = pilha.length === 0 ? campoDe(f.instr) : null;
        if (c && !xml.slice(f.ini, fim).includes("</w:p>")) {
          achados.add(c); if (!v.has(c)) faltando.add(c);
          trocas.push({ ini: f.ini, fim, txt: runTexto(f.rPr || "", v.get(c)) });
        }
        continue;
      }
      if (!f.sep) f.instr += instrDe(r);
      else if (f.rPr === null) f.rPr = (r.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0];
    }
    for (const t of trocas.reverse()) xml = xml.slice(0, t.ini) + t.txt + xml.slice(t.fim);
    return { xml, achados, faltando };
  }

  // campos de mala direta que o modelo usa (para conferir antes de gerar)
  async function camposDoModelo(buf) {
    const z = await lerZip(buf), s = new Set();
    for (const [n, d] of z) if (PARTES_DOCX.test(n)) {
      const x = dec.decode(d);
      for (const m of x.matchAll(/w:instr="([^"]*)"/g)) { const c = campoDe(xmlDes(m[1])); if (c) s.add(c); }
      for (const c of preencherXml(x, {}).achados) s.add(c);
    }
    if (!z.has("word/document.xml")) throw new Error("O arquivo não é um documento do Word (.docx).");
    return [...s];
  }

  // gera o .docx preenchido; sem o vínculo com a planilha (o Word não pergunta pela fonte de dados)
  async function preencherDocx(buf, valores) {
    const z = await lerZip(buf), out = [], achados = new Set(), faltando = new Set();
    if (!z.has("word/document.xml")) throw new Error("O modelo não é um documento do Word (.docx).");
    for (const [n, d] of z) {
      if (n === "word/recipientData.xml") continue;
      let x = null;
      if (PARTES_DOCX.test(n)) { const r = preencherXml(dec.decode(d), valores); x = r.xml; r.achados.forEach(c => achados.add(c)); r.faltando.forEach(c => faltando.add(c)); }
      else if (n === "word/settings.xml") x = dec.decode(d).replace(/<w:mailMerge>[\s\S]*?<\/w:mailMerge>/, "");
      else if (n === "word/_rels/settings.xml.rels") x = dec.decode(d).replace(/<Relationship\s[^>]*Type="[^"]*\/(mailMergeSource|mailMergeHeaderSource|recipientData)"[^>]*\/>/g, "");
      else if (n === "[Content_Types].xml") x = dec.decode(d).replace(/<Override\s[^>]*PartName="\/word\/recipientData\.xml"[^>]*\/>/, "");
      out.push([n, x === null ? d : x]);
    }
    if (faltando.size) throw new Error("O modelo tem campos que o app não conhece: " + [...faltando].join(", ") + ".");
    return { bytes: await gravarZip(out), campos: [...achados] };
  }

  // ---------------------------------------------------------------- xlsx
  const colNum = l => [...l].reduce((s, c) => s * 26 + c.charCodeAt(0) - 64, 0);
  // { nomeDaAba: [[linha 1…], …] } com índices de coluna a partir de 1 (linha[2] = coluna B)
  async function lerXlsx(buf) {
    const z = await lerZip(buf), txt = n => z.has(n) ? dec.decode(z.get(n)) : "";
    const wb = txt("xl/workbook.xml"); if (!wb) throw new Error("O arquivo não é uma planilha do Excel (.xlsx).");
    const ss = [...txt("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => [...m[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map(t => xmlDes(t[1])).join(""));
    const rels = new Map([...txt("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\s([^>]*)\/>/g)].map(m => {
      const a = k => (m[1].match(new RegExp(k + '="([^"]*)"')) || [])[1]; return [a("Id"), a("Target")]; }));
    const abas = {};
    for (const m of wb.matchAll(/<sheet\s([^>]*)\/>/g)) {
      const a = k => (m[1].match(new RegExp("\\b" + k + '="([^"]*)"')) || [])[1];
      let alvo = rels.get(a("r:id")) || ""; alvo = alvo.startsWith("/") ? alvo.slice(1) : "xl/" + alvo.replace(/^\.\//, "");
      const linhas = [];
      for (const c of txt(alvo).matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const at = k => (c[1].match(new RegExp("\\b" + k + '="([^"]*)"')) || [])[1];
        const ref = at("r") || "", t = at("t"), dentro = c[2] || "";
        const mv = dentro.match(/<v>([^<]*)<\/v>/), mi = dentro.match(/<is>([\s\S]*?)<\/is>/);
        let val = null;
        if (t === "s" && mv) val = ss[+mv[1]];
        else if (t === "inlineStr" && mi) val = [...mi[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map(x => xmlDes(x[1])).join("");
        else if (t === "str" && mv) val = xmlDes(mv[1]);
        else if (t === "b" && mv) val = mv[1] === "1";
        else if (t === "e") val = null;
        else if (mv) val = Number(mv[1]);
        if (val === null || val === "") continue;
        const rm = ref.match(/^([A-Z]+)(\d+)$/); if (!rm) continue;
        const li = +rm[2], co = colNum(rm[1]);
        (linhas[li] = linhas[li] || [])[co] = val;
      }
      abas[xmlDes(a("name") || "")] = linhas;
    }
    return abas;
  }
  // número de série do Excel (sistema 1900) → AAAA-MM-DD
  const dataExcel = n => typeof n === "number" ? new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5).toISOString().slice(0, 10) : "";

  const API = { lerZip, gravarZip, crc32, preencherDocx, preencherXml, camposDoModelo, lerXlsx, dataExcel,
    reaisExtenso, valorContrato, dataExtenso, dataBR, brl, normCampo };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else raiz.CTR_ARQ = API;
})(typeof window !== "undefined" ? window : globalThis);
