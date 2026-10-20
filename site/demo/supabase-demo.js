// Demonstração da Plataforma Nervia: substitui o supabase-js por dados FICTÍCIOS em memória.
// Nada aqui acessa a rede, o Supabase real ou dados de clientes. Usado só pelas páginas de /demo/
// (geradas por divulgacao/demo/gerar.py a partir dos apps reais).
(function () {
  "use strict";
  // ---------------------------------------------------------------- sessão (qualquer e-mail/senha entra)
  const CHAVE = "nervia_demo_sair";
  const ler = () => { try { return sessionStorage.getItem(CHAVE) === "1"; } catch (e) { return false; } };
  const gravar = (v) => { try { v ? sessionStorage.setItem(CHAVE, "1") : sessionStorage.removeItem(CHAVE); } catch (e) {} };
  const eu = { id: "u-demo", email: "demo@exemplo.com.br" };
  const ouvintes = [];

  // ---------------------------------------------------------------- dados fictícios
  // Gerador pseudoaleatório fixo: a demonstração mostra sempre os mesmos números.
  let semente = 20261014;
  const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
  const MATRIZ = "12345678000190", FILIAL = "12345678000271";
  const NOME = { [MATRIZ]: "COMERCIAL EXEMPLO LTDA", [FILIAL]: "COMERCIAL EXEMPLO LTDA - FILIAL CENTRO" };
  const MES = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];

  // Fornecedores inventados. NF-e: produto, NCM, unidade, preço unitário. NFS-e: serviço (código nacional + descrição).
  const FORN = [
    { t: "NFE", cnpj: "21458963000112", nome: "DISTRIBUIDORA ALFA EMBALAGENS LTDA", base: 6200, dia: 4, prod: "CAIXA DE PAPELAO ONDULADO 40X30X20CM", ncm: "48191000", un: "PCT", pu: 86.5, filial: 0.4 },
    { t: "NFE", cnpj: "30987412000155", nome: "TEXTIL HORIZONTE LTDA", base: 9800, dia: 9, prod: "TECIDO 100% ALGODAO 1,60M - ROLO 50M", ncm: "52081100", un: "RL", pu: 1240, filial: 0 },
    { t: "NFE", cnpj: "45123698000140", nome: "PAPELARIA PONTO CERTO ME", base: 640, dia: 12, prod: "PAPEL A4 75G - RESMA 500 FOLHAS", ncm: "48025610", un: "CX", pu: 189.9, filial: 0.5 },
    { t: "NFE", cnpj: "58741236000199", nome: "BOM GRAO ALIMENTOS DISTRIBUIDORA LTDA", base: 430, dia: 20, prod: "CAFE TORRADO E MOIDO 500G", ncm: "09012100", un: "FD", pu: 215, filial: 0.6 },
    { t: "NFE", cnpj: "52369874000121", nome: "INFORMATICA SOLUCAO DIGITAL LTDA", base: 0, dia: 18, prod: "NOTEBOOK 15,6 POL I5 16GB SSD 512GB", ncm: "84713012", un: "UN", pu: 3725, filial: 0, meses: { 3: 2, 9: 1 } },
    { t: "NFSE", cnpj: "61478523000108", nome: "TRANSRAPIDO LOGISTICA LTDA", base: 2350, dia: 6, cod: "160201", trib: "Outros serviços de transporte de natureza municipal", desc: "FRETES E ENTREGAS URBANAS", varia: 0.25, filial: 0.5 },
    { t: "NFSE", cnpj: "73214569000133", nome: "ESCRITORIO CONTABIL MODELO SS", base: 1450, dia: 10, cod: "171901", trib: "Contabilidade, inclusive serviços técnicos e auxiliares", desc: "HONORARIOS CONTABEIS", filial: 0.5 },
    { t: "NFSE", cnpj: "84569321000177", nome: "FIBRA NET TELECOMUNICACOES LTDA", base: 389.9, dia: 15, cod: "010701", trib: "Suporte técnico em informática, inclusive acesso à internet", desc: "LINK DE INTERNET FIBRA 500 MEGA", filial: 1 },
    { t: "NFSE", cnpj: "95874123000166", nome: "MANUTENCAO PREDIAL ATIVA ME", base: 780, dia: 21, cod: "070501", trib: "Reparação, conservação e reforma de edifícios", desc: "MANUTENCAO PREVENTIVA PREDIAL", varia: 0.4, filial: 0.6 },
    { t: "NFSE", cnpj: "36985214000150", nome: "LIMPEZA TOTAL SERVICOS LTDA", base: 2100, dia: 25, cod: "071001", trib: "Limpeza, manutenção e conservação de imóveis", desc: "LIMPEZA E CONSERVACAO", filial: 0.5 },
  ];
  const MOSTRAR_VENDAS = false;
  const CLIENTES = [
    { cnpj: "11223344000155", nome: "LOJA CENTRO VAREJO LTDA", base: 14200, dia: 8 },
    { cnpj: "22334455000166", nome: "MERCADO BOA VISTA LTDA", base: 8600, dia: 16 },
    { cnpj: "33445566000177", nome: "BOUTIQUE ESTILO ME", base: 3900, dia: 25 },
    { cnpj: "44556677000188", nome: "ATELIE COSTURA FINA LTDA", base: 2700, dia: 27 },
  ];
  // Sazonalidade por mês do calendário (jan..dez): dezembro mais forte, janeiro mais fraco.
  const SAZ = [0.72, 0.84, 0.95, 0.92, 1.0, 0.93, 0.97, 1.08, 1.02, 1.06, 1.12, 1.3];

  const hoje = new Date();
  const iso = (a, m, d) => `${a}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}T10:${String(10 + Math.floor(rnd() * 40)).padStart(2, "0")}:00-03:00`;
  const r2 = (v) => Math.round(v * 100) / 100;
  const db = {
    perfis: [{ user_id: "u-demo", email: eu.email, nome: "Financeiro", admin: false }],
    apps: [
      { id: "notas", nome: "Notas Fiscais", descricao: "NF-e e NFS-e emitidas contra os seus CNPJs.", url: "/demo/apps/notas/", icone: "NF", ordem: 10, ativo: true,
        cartao_url: "/apps/notas/ajuda/cartao.html", manual_url: "/apps/notas/ajuda/manual.html" },
      { id: "painel-nf", nome: "Painel de Notas", descricao: "Compras por fornecedor, mês a mês.", url: "/demo/apps/painel-nf/", icone: "PN", ordem: 15, ativo: true,
        cartao_url: "/apps/painel-nf/ajuda/cartao.html", manual_url: "/apps/painel-nf/ajuda/manual.html" },
    ],
    app_acessos: [{ user_id: "u-demo", app_id: "notas" }, { user_id: "u-demo", app_id: "painel-nf" }],
    nf_acessos: [{ user_id: "u-demo", cnpj: MATRIZ }, { user_id: "u-demo", cnpj: FILIAL }],
    nf_empresas: [],
    nf_notas: [],
    nf_log: [],
  };
  const haMin = (m) => new Date(Date.now() - m * 6e4).toISOString();
  for (const [cnpj, nome] of [[MATRIZ, "Comercial Exemplo Ltda"], [FILIAL, "Comercial Exemplo Ltda - Filial Centro"]]) {
    db.nf_empresas.push({ cnpj, nome, uf: "RJ", ativo: true, busca_automatica: true, cert_secret_id: "demo",
      cert_titular: NOME[cnpj] + ":" + cnpj, cert_validade: new Date(Date.now() + 210 * 864e5).toISOString(), termo_status: "assinado",
      ultima_sinc_nfe: haMin(14), ultima_sinc_nfse: haMin(13), bloqueio_nfe: new Date(Date.now() + 46 * 6e4).toISOString() });
    let lid = db.nf_log.length;
    for (let h = 0; h < 6; h++) {
      db.nf_log.push({ id: ++lid, cnpj, quando: haMin(14 + h * 60), origem: "NFE", mensagem: h === 2 ? "Tudo baixado. {\"nova\":1}" : "Tudo baixado. {\"nova\":0}" });
      db.nf_log.push({ id: ++lid, cnpj, quando: haMin(13 + h * 60), origem: "NFSE", mensagem: h === 4 ? "Tudo baixado. {\"nova\":2}" : "Tudo baixado. {\"nova\":0}" });
    }
  }

  let id = 0, num = 1200;
  const chaveNFe = (cnpj, a, m, n) => {
    const base = "33" + String(a).slice(2) + String(m + 1).padStart(2, "0") + cnpj + "55" + "001" + String(n).padStart(9, "0") + "1" + String(10000000 + n * 7).slice(-8);
    let soma = 0, p = 2; for (let i = base.length - 1; i >= 0; i--) { soma += +base[i] * p; p = p === 9 ? 2 : p + 1; }
    const dv = 11 - (soma % 11); return base + (dv >= 10 ? 0 : dv);
  };
  const chaveNFSe = (cnpj, a, m, n) => ("3304557" + "2" + cnpj.padStart(14, "0") + "00" + String(n).padStart(13, "0") + String(a).slice(2) + String(m + 1).padStart(2, "0") + "0001").padEnd(50, "0").slice(0, 50);

  for (let k = 11; k >= 0; k--) {
    const dt = new Date(hoje.getFullYear(), hoje.getMonth() - k, 1);
    const a = dt.getFullYear(), m = dt.getMonth();
    const atual = k === 0;
    for (const empresa of [MATRIZ, FILIAL]) {
      const fator = empresa === MATRIZ ? 1 : null;
      for (const f of FORN) {
        const peso = fator || f.filial; if (!peso) continue;
        let qtd = 0, valor;
        if (f.meses) { const q = f.meses[11 - k]; if (!q || empresa !== MATRIZ) continue; qtd = q; valor = f.pu * q; }
        else if (f.t === "NFE") { qtd = Math.max(1, Math.round((f.base * peso * SAZ[m] * (0.88 + rnd() * 0.24)) / f.pu)); valor = qtd * f.pu; }
        else valor = f.base * peso * (f.varia ? (1 - f.varia / 2 + rnd() * f.varia) : 1);
        const dia = Math.min(f.dia + (empresa === FILIAL ? 1 : 0), 28);
        if (atual && dia > hoje.getDate()) continue;
        valor = r2(valor); num += 1 + Math.floor(rnd() * 9); id++;
        const n = { id, cnpj_consulta: empresa, tipo: f.t, numero: String(num), emit_cnpj: f.cnpj, emit_nome: f.nome,
          dest_cnpj: empresa, dest_nome: NOME[empresa], data_emissao: iso(a, m, dia), valor, situacao: "Autorizada", papel: "recebida",
          completo: true, manifestada: false, xml_path: `${empresa}/${f.t.toLowerCase()}/${id}.xml`, _f: f, _qtd: qtd };
        n.chave = f.t === "NFE" ? chaveNFe(f.cnpj, a, m, num) : chaveNFSe(f.cnpj, a, m, num);
        db.nf_notas.push(n);
      }
      // vendas: desligadas (a SEFAZ não entrega ao emitente as próprias NF-e; decisão do Marco, 2026-10-14)
      for (const c of MOSTRAR_VENDAS ? CLIENTES : []) {
        if (empresa === FILIAL && c.base > 9000) continue;
        const dia = c.dia; if (atual && dia > hoje.getDate()) continue;
        id++; const nn = 5000 + id;
        const valor = r2(c.base * (empresa === MATRIZ ? 1 : 0.6) * SAZ[m] * (0.9 + rnd() * 0.2));
        db.nf_notas.push({ id, cnpj_consulta: empresa, tipo: "NFE", numero: String(nn), emit_cnpj: empresa, emit_nome: NOME[empresa],
          dest_cnpj: c.cnpj, dest_nome: c.nome, data_emissao: iso(a, m, dia), valor, situacao: "Autorizada", papel: "emitida",
          completo: true, manifestada: false, xml_path: `${empresa}/nfe/${id}.xml`, chave: chaveNFe(empresa, a, m, nn),
          _f: { t: "NFE", prod: "CONFECCAO EM TECIDO DE ALGODAO - LINHA BASICA", ncm: "62052000", un: "UN", pu: 89.9 }, _qtd: Math.max(1, Math.round(valor / 89.9)) });
      }
    }
  }
  // Situações para mostrar na demonstração: uma cancelada, uma NF-e só com resumo e uma com ciência já registrada.
  const da = (nome, emp = MATRIZ) => db.nf_notas.filter((n) => n.emit_nome === nome && n.cnpj_consulta === emp).sort((x, y) => (x.data_emissao < y.data_emissao ? 1 : -1));
  const canc = da("DISTRIBUIDORA ALFA EMBALAGENS LTDA")[3]; if (canc) canc.situacao = "Cancelada";
  const res = da("TEXTIL HORIZONTE LTDA")[0]; if (res) { res.completo = false; }
  const cie = da("PAPELARIA PONTO CERTO ME")[0]; if (cie) { cie.completo = false; cie.manifestada = true; }

  // ---------------------------------------------------------------- consultas (subconjunto do supabase-js usado pelos apps)
  const pode = (cnpj) => db.nf_acessos.some((x) => x.cnpj === cnpj);
  const rls = { nf_notas: (r) => pode(r.cnpj_consulta), nf_empresas: (r) => pode(r.cnpj), nf_log: (r) => pode(r.cnpj),
    apps: (r) => r.ativo && db.app_acessos.some((x) => x.app_id === r.id) };
  const limpa = (r) => { const o = {}; for (const k in r) if (k[0] !== "_") o[k] = r[k]; return o; };
  function consulta(tabela) {
    const filtros = []; let ordem = [], faixa = null, op = "select", unico = false;
    const q = {
      select() { return q; }, limit() { return q; },
      order(c, o) { ordem.push([c, o?.ascending !== false]); return q; },
      eq(c, v) { filtros.push((r) => r[c] === v); return q; }, neq(c, v) { filtros.push((r) => r[c] !== v); return q; },
      gte(c, v) { filtros.push((r) => new Date(r[c]) >= new Date(v)); return q; }, lte(c, v) { filtros.push((r) => new Date(r[c]) <= new Date(v)); return q; },
      in(c, v) { filtros.push((r) => v.includes(r[c])); return q; },
      or(expr) { const termos = [...expr.matchAll(/(\w+)\.ilike\.\*([^*,]*)\*/g)];
        filtros.push((r) => termos.some(([, c, t]) => String(r[c] ?? "").toLowerCase().includes(t.toLowerCase()))); return q; },
      range(a, b) { faixa = [a, b]; return q; }, maybeSingle() { unico = true; return q; },
      insert() { op = "bloq"; return q; }, update() { op = "bloq"; return q; }, delete() { op = "bloq"; return q; },
      then(ok, falha) { return Promise.resolve(exec()).then(ok, falha); },
    };
    function exec() {
      if (op === "bloq") return { data: null, error: { message: "Na demonstração, os dados não podem ser alterados." } };
      let out = (db[tabela] || []).filter((r) => (rls[tabela] ?? (() => true))(r) && filtros.every((f) => f(r))).map(limpa);
      if (ordem.length) out.sort((a, b) => { for (const [c, asc] of ordem) { if (a[c] === b[c]) continue; return (a[c] > b[c] ? 1 : -1) * (asc ? 1 : -1); } return 0; });
      if (faixa) out = out.slice(faixa[0], faixa[1] + 1);
      return { data: unico ? out[0] ?? null : out, error: null };
    }
    return q;
  }

  // ---------------------------------------------------------------- XMLs fictícios no formato oficial
  const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const f2 = (v) => v.toFixed(2);
  const END = { [MATRIZ]: ["RUA DO COMERCIO", "250", "CENTRO", "20010020"], [FILIAL]: ["RUA DAS LARANJEIRAS", "480", "LARANJEIRAS", "22240003"] };
  const endDe = (cnpj) => END[cnpj] || ["RUA DAS FLORES", String(100 + (+cnpj.slice(0, 3) % 800)), "CENTRO", "20040000"];
  function xmlNFe(n) {
    const f = n._f, e = endDe(n.emit_cnpj), d = endDe(n.dest_cnpj), v = n.valor;
    const venc = new Date(new Date(n.data_emissao).getTime() + 30 * 864e5).toISOString().slice(0, 10);
    const qtd = n._qtd || 1, pu = v / qtd, icms = v * 0.18;
    return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${n.chave}" versao="4.00">
<ide><cUF>33</cUF><natOp>VENDA DE MERCADORIA</natOp><mod>55</mod><serie>1</serie><nNF>${n.numero}</nNF><dhEmi>${n.data_emissao}</dhEmi><dhSaiEnt>${n.data_emissao}</dhSaiEnt><tpNF>1</tpNF><tpAmb>1</tpAmb></ide>
<emit><CNPJ>${n.emit_cnpj}</CNPJ><xNome>${x(n.emit_nome)}</xNome><enderEmit><xLgr>${e[0]}</xLgr><nro>${e[1]}</nro><xBairro>${e[2]}</xBairro><cMun>3304557</cMun><xMun>RIO DE JANEIRO</xMun><UF>RJ</UF><CEP>${e[3]}</CEP><fone>2130000000</fone></enderEmit><IE>${n.emit_cnpj.slice(0, 8)}</IE><CRT>3</CRT></emit>
<dest><CNPJ>${n.dest_cnpj}</CNPJ><xNome>${x(n.dest_nome)}</xNome><enderDest><xLgr>${d[0]}</xLgr><nro>${d[1]}</nro><xBairro>${d[2]}</xBairro><xMun>RIO DE JANEIRO</xMun><UF>RJ</UF><CEP>${d[3]}</CEP></enderDest><IE>${n.dest_cnpj.slice(0, 8)}</IE></dest>
<det nItem="1"><prod><cProd>${f.ncm.slice(0, 4)}-01</cProd><xProd>${x(f.prod)}</xProd><NCM>${f.ncm}</NCM><CFOP>5102</CFOP><uCom>${f.un}</uCom><qCom>${qtd.toFixed(4)}</qCom><vUnCom>${pu.toFixed(4)}</vUnCom><vProd>${f2(v)}</vProd></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>${f2(v)}</vBC><pICMS>18.00</pICMS><vICMS>${f2(icms)}</vICMS></ICMS00></ICMS></imposto></det>
<total><ICMSTot><vBC>${f2(v)}</vBC><vICMS>${f2(icms)}</vICMS><vBCST>0.00</vBCST><vST>0.00</vST><vProd>${f2(v)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vOutro>0.00</vOutro><vNF>${f2(v)}</vNF></ICMSTot></total>
<transp><modFrete>0</modFrete><vol><qVol>${qtd}</qVol><esp>VOLUME</esp><pesoL>${(qtd * 2).toFixed(3)}</pesoL><pesoB>${(qtd * 2.2).toFixed(3)}</pesoB></vol></transp>
<cobr><dup><nDup>001</nDup><dVenc>${venc}</dVenc><vDup>${f2(v)}</vDup></dup></cobr>
<infAdic><infCpl>Pedido ${3000 + n.id}. NOTA FICTICIA - DEMONSTRACAO PLATAFORMA NERVIA.</infCpl></infAdic></infNFe></NFe>
<protNFe versao="4.00"><infProt><chNFe>${n.chave}</chNFe><dhRecbto>${n.data_emissao}</dhRecbto><nProt>3332600${String(n.id).padStart(8, "0")}</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
  }
  function xmlResumo(n) {
    return `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${n.chave}</chNFe><CNPJ>${n.emit_cnpj}</CNPJ><xNome>${x(n.emit_nome)}</xNome><dhEmi>${n.data_emissao}</dhEmi><vNF>${f2(n.valor)}</vNF><cSitNFe>1</cSitNFe></resNFe>`;
  }
  function xmlNFSe(n) {
    const f = n._f, e = endDe(n.emit_cnpj), d = endDe(n.dest_cnpj), v = n.valor, dt = new Date(n.data_emissao);
    const comp = `${MES[dt.getMonth()]}/${dt.getFullYear()}`;
    return `<?xml version="1.0" encoding="utf-8"?><NFSe versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${n.chave}"><xLocEmi>Rio de Janeiro</xLocEmi><xLocPrestacao>Rio de Janeiro</xLocPrestacao><nNFSe>${n.numero}</nNFSe><cLocIncid>3304557</cLocIncid><xLocIncid>Rio de Janeiro</xLocIncid><xTribNac>${x(f.trib)}</xTribNac><cStat>100</cStat><dhProc>${n.data_emissao}</dhProc><nDFSe>${17000000 + n.id}</nDFSe><emit><CNPJ>${n.emit_cnpj}</CNPJ><xNome>${x(n.emit_nome)}</xNome><enderNac><xLgr>${e[0]}</xLgr><nro>${e[1]}</nro><xBairro>${e[2]}</xBairro><cMun>3304557</cMun><UF>RJ</UF><CEP>${e[3]}</CEP></enderNac><fone>2130000000</fone><email>financeiro@exemplo.com.br</email></emit><valores><vBC>${f2(v)}</vBC><pAliqAplic>5.00</pAliqAplic><vISSQN>${f2(v * 0.05)}</vISSQN><vLiq>${f2(v)}</vLiq></valores><DPS versao="1.00"><infDPS Id="DPS${n.id}"><tpAmb>1</tpAmb><dhEmi>${n.data_emissao}</dhEmi><serie>00001</serie><nDPS>${n.numero}</nDPS><dCompet>${n.data_emissao.slice(0, 10)}</dCompet><cLocEmi>3304557</cLocEmi><prest><CNPJ>${n.emit_cnpj}</CNPJ><regTrib><opSimpNac>3</opSimpNac><regEspTrib>0</regEspTrib></regTrib></prest><toma><CNPJ>${n.dest_cnpj}</CNPJ><xNome>${x(n.dest_nome)}</xNome><end><endNac><cMun>3304557</cMun><CEP>${d[3]}</CEP></endNac><xLgr>${d[0]}</xLgr><nro>${d[1]}</nro><xBairro>${d[2]}</xBairro></end></toma><serv><locPrest><cLocPrestacao>3304557</cLocPrestacao></locPrest><cServ><cTribNac>${f.cod}</cTribNac><xDescServ>${x(f.desc)} - ${comp} - NOTA FICTICIA (DEMONSTRACAO)</xDescServ></cServ></serv><valores><vServPrest><vServ>${f2(v)}</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun><totTrib><vTotTrib><vTotTribFed>0.00</vTotTribFed><vTotTribEst>0.00</vTotTribEst><vTotTribMun>${f2(v * 0.05)}</vTotTribMun></vTotTrib></totTrib></trib></valores></infDPS></DPS></infNFSe></NFSe>`;
  }
  const xmlDe = (n) => (n.tipo === "NFE" ? (n.completo ? xmlNFe(n) : xmlResumo(n)) : xmlNFSe(n));
  const acharPorCaminho = (p) => db.nf_notas.find((n) => n.xml_path === p && pode(n.cnpj_consulta));

  // ---------------------------------------------------------------- cliente falso
  window.NERVIA_DEMO = true;
  // vitrine (apps que o login da demonstração não tem); a reação fica só nesta página
  const vitrine = [
    { id: "telefonia", nome: "Auditoria de Telefonia Móvel", descricao: "Consumo, franquias e economia de cada linha móvel da empresa.", icone: "TM", situacao: "disponivel", demo_url: "/demo/telefonia/", ordem: 30 },
    { id: "compras", nome: "Orçamentos de Compras", descricao: "Requisição, cotações, mapa comparativo, aprovação por alçada e avaliação do fornecedor.", icone: "OC", situacao: "disponivel", demo_url: "/demo/compras/", ordem: 40 },
    { id: "produtos", nome: "Controle de Produtos", descricao: "Vendas, estoque, entregas, contas a receber e caixa de uma revenda ou loja.", icone: "CP", situacao: "em_breve", demo_url: "/demo/produtos/", ordem: 60 },
  ].map((a) => ({ ...a, reacao: null, comentario: "" }));
  const rpc = async (nome, p = {}) => {
    if (nome === "apps_vitrine") return { data: vitrine.map((a) => ({ ...a })), error: null };
    const a = vitrine.find((x) => x.id === p.p_app);
    if (!a) return { data: null, error: { message: "Aplicativo não está na vitrine." } };
    if (nome === "app_reagir") { a.reacao = p.p_reacao || null; a.comentario = p.p_reacao === "nao_curti" ? p.p_comentario || "" : ""; return { data: null, error: null }; }
    if (nome === "app_registrar_clique") return { data: null, error: null };
    return { data: null, error: { message: "Na demonstração, esta função está desligada." } };
  };

  window.supabase = { createClient: () => ({
    from: consulta,
    rpc,
    auth: {
      getSession: async () => ({ data: { session: ler() ? null : { user: eu } } }),
      signInWithPassword: async () => { gravar(false); return { data: { user: eu }, error: null }; },
      signOut: async () => { gravar(true); ouvintes.forEach((f) => { try { f("SIGNED_OUT", null); } catch (e) {} }); return { error: null }; },
      updateUser: async () => ({ data: { user: eu }, error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
      onAuthStateChange: (f) => { ouvintes.push(f); return { data: { subscription: { unsubscribe() {} } } }; },
    },
    functions: { invoke: async () => ({ data: null, error: { message: "Na demonstração, as buscas na SEFAZ e no Ambiente Nacional estão desligadas: as notas já estão carregadas." } }) },
    storage: { from: () => ({
      createSignedUrl: async (p) => {
        const n = acharPorCaminho(p); if (!n) return { data: null, error: { message: "Object not found" } };
        return { data: { signedUrl: URL.createObjectURL(new Blob([xmlDe(n)], { type: "application/xml" })) }, error: null };
      },
      download: async (p) => {
        const n = acharPorCaminho(p); if (!n) return { data: null, error: { message: "Object not found" } };
        return { data: new Blob([xmlDe(n)], { type: "text/xml" }), error: null };
      },
    }) },
  }) };
})();
