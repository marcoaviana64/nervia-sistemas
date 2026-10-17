// Substitui o supabase-js nos testes de tela (Playwright): dados em memória, sem rede.
(function () {
  const papelUrl = new URLSearchParams(location.search).get("papel");
  if (papelUrl) localStorage.setItem("papel_teste", papelUrl);
  const papel = papelUrl || localStorage.getItem("papel_teste") || "admin";
  const EUS = { admin: ["u-admin", "marco@nervia.com.br"], cliente: ["u-cli", "financeiro@linum.com.br"], semapp: ["u-sem", "outro@x.com"],
    recuperacao: ["u-cli", "financeiro@linum.com.br"], anon: ["", ""] };
  const eu = { id: EUS[papel][0], email: EUS[papel][1] };
  let logado = papel !== "anon";
  const futuro = new Date(Date.now() + 300 * 864e5).toISOString();
  const db = {
    perfis: [
      { user_id: "u-admin", email: "marco@nervia.com.br", nome: "Marco", admin: true },
      { user_id: "u-cli", email: "financeiro@linum.com.br", nome: "Financeiro Linum", admin: false },
      { user_id: "u-sem", email: "outro@x.com", nome: "Outro Cliente", admin: false },
    ],
    apps: [
      { id: "notas", nome: "Notas Fiscais", descricao: "NF-e e NFS-e emitidas contra os seus CNPJs.", url: "/apps/notas/", icone: "NF", ordem: 10, ativo: true,
        cartao_url: "/apps/notas/ajuda/cartao.html", manual_url: "/apps/notas/ajuda/manual.html" },
      { id: "painel-nf", nome: "Painel de Notas", descricao: "Compras e vendas por fornecedor.", url: "/apps/painel-nf/", icone: "PN", ordem: 15, ativo: true,
        cartao_url: "/apps/painel-nf/ajuda/cartao.html", manual_url: "/apps/painel-nf/ajuda/manual.html" },
      { id: "telefonia", nome: "Auditoria de Telefonia Móvel", descricao: "Consumo, franquias e economia de cada linha móvel.", url: "/apps/telefonia/", icone: "TM", ordem: 30, ativo: true,
        cartao_url: "/apps/telefonia/ajuda/cartao.html", manual_url: "/apps/telefonia/ajuda/manual.html" },
      { id: "chamados", nome: "Chamados", descricao: "Abertura e acompanhamento de chamados.", url: "/apps/chamados/", icone: "CH", ordem: 20, ativo: false },
    ],
    app_acessos: [{ user_id: "u-cli", app_id: "notas" }, { user_id: "u-cli", app_id: "painel-nf" }, { user_id: "u-cli", app_id: "telefonia" }],
    // Auditoria de Telefonia Móvel: o teste pode semear um relatório publicado (window.__TEL_SEED = dados da demonstração)
    tel_relatorios: window.__TEL_SEED ? [{ ...window.__TEL_SEED, id: "r1", cnpj: null, publicado: true, dados_em: "2026-10-15T12:00:00-03:00" },
      { ...window.__TEL_SEED, id: "r2", titulo: "Outro Cliente", publicado: true }] : [],
    tel_acessos: window.__TEL_SEED ? [{ user_id: "u-cli", relatorio_id: "r1" }] : [],
    tel_arquivos: [],
    nf_acessos: [{ user_id: "u-cli", cnpj: "22222222000122" }],
    nf_empresas: [
      { cnpj: "11111111000111", nome: "Nervia", uf: "RJ", ativo: true, busca_automatica: true, cert_secret_id: "s1", cert_titular: "NERVIA TECNOLOGIA DA INFORMACAO LTDA:11111111000111", cert_validade: futuro, termo_status: "dispensado", termo_obs: "Empresa da própria Nervia.", ult_nsu_nfe: 50, ultima_sinc_nfe: new Date().toISOString(), bloqueio_nfe: new Date(Date.now() + 40 * 6e4).toISOString(), ultima_sinc_nfse: new Date().toISOString() },
      { cnpj: "22222222000122", nome: "Linum", uf: "RJ", ativo: true, busca_automatica: true, cert_secret_id: null, termo_status: "pendente" },
    ],
    nf_notas: [],
    nf_log: [{ id: 1, cnpj: "11111111000111", quando: new Date().toISOString(), origem: "NFE", mensagem: "Tudo baixado. {\"nova\":4}" }],
    auditoria: [
      { id: 1, quando: "2026-10-14T21:40:00-03:00", user_id: "u-cli", email: "financeiro@linum.com.br", nome: "Financeiro Linum", papel: "cliente",
        acao: "manifestacao_ciencia", cnpj: "22222222000122", ip: "200.1.2.3", navegador: "Mozilla/5.0",
        detalhes: { evento: "Ciência da Operação", tpEvento: "210210", ignoradas_fora_do_prazo: 0, arquivos: ["22222222000122/eventos-enviados/x-enviado.xml"],
          notas: [{ chave: "1".repeat(44), cStat: "135", xMotivo: "Evento registrado e vinculado a NF-e", nProt: "891260000123456", dhRegEvento: "2026-10-14T21:40:05-03:00" }] } },
      { id: 2, quando: "2026-10-14T20:00:00-03:00", user_id: "u-admin", email: "marco@nervia.com.br", nome: "Marco", papel: "admin",
        acao: "certificado_cadastrado", cnpj: "11111111000111", ip: "200.1.2.4", navegador: "Mozilla/5.0", detalhes: { titular: "NERVIA", validade: "2027-08-10T00:00:00Z" } },
      { id: 3, quando: "2026-10-14T19:00:00-03:00", user_id: "u-admin", email: "marco@nervia.com.br", nome: "Marco", papel: "admin",
        acao: "login_criado", cnpj: null, detalhes: { login: "financeiro@linum.com.br", apps: ["notas"], cnpjs: ["22222222000122"] } },
    ],
  };
  // acessos do site: 3 visitantes nos últimos dias (RJ, SP e exterior) + um antigo sem IP (anonimizado)
  const hAtras = (h) => new Date(Date.now() - h * 36e5).toISOString();
  db.site_acessos = [
    { quando: hAtras(1), ip: "189.10.20.30", pais: "BR", estado: "Rio de Janeiro", estado_sigla: "RJ", cidade: "Niterói", pagina: "/", origem: "google.com", dispositivo: "Celular" },
    { quando: hAtras(1.1), ip: "189.10.20.30", pais: "BR", estado: "Rio de Janeiro", estado_sigla: "RJ", cidade: "Niterói", pagina: "/demo/", origem: null, dispositivo: "Celular" },
    { quando: hAtras(30), ip: "177.55.66.77", pais: "BR", estado: "São Paulo", estado_sigla: "SP", cidade: "Campinas", pagina: "/", origem: "whatsapp", dispositivo: "Computador" },
    { quando: hAtras(50), ip: "8.8.4.4", pais: "US", estado: "California", estado_sigla: "CA", cidade: "Mountain View", pagina: "/privacidade.html", origem: null, dispositivo: "Computador" },
    { quando: hAtras(24 * 100), ip: null, pais: "BR", estado: "Rio de Janeiro", estado_sigla: "RJ", cidade: "Rio de Janeiro", pagina: "/", origem: null, dispositivo: "Computador" },
  ];
  const linhas = [
    ["NFE", "1", "33333333000133", "DISTRIBUIDORA DE REDES LTDA", "2026-10-08T10:00:00-03:00", 1840.9, "Autorizada", false, false],
    ["NFE", "4521", "44444444000144", "KALUNGA COMERCIO SA", "2026-10-02T10:00:00-03:00", 389.7, "Autorizada", true, false],
    ["NFSE", "88", "55555555000155", "LINK FIBRA TELECOM ME", "2026-10-05T10:00:00-03:00", 1000, "Autorizada", true, false],
    ["NFE", "990", "66666666000166", "CABOS E CONECTORES EIRELI", "2026-09-22T10:00:00-03:00", 612, "Cancelada", true, false],
    ["NFE", "77", "77777777000177", "UBIQUITI BRASIL DIST", "2026-09-18T10:00:00-03:00", 5320, "Autorizada", false, true],
  ];
  let id = 1;
  for (const cnpj of ["11111111000111", "22222222000122"]) for (const [t, n, ec, en, d, v, s, comp, man] of linhas) {
    db.nf_notas.push({ id: id++, cnpj_consulta: cnpj, tipo: t, chave: String(id).repeat(44).slice(0, 44), numero: n, emit_cnpj: ec, emit_nome: en,
      dest_cnpj: cnpj, dest_nome: cnpj === "11111111000111" ? "NERVIA TECNOLOGIA" : "LINUM", data_emissao: d, valor: v, situacao: s,
      papel: "recebida", completo: comp, manifestada: man, xml_path: `${cnpj}/nfe/x${id}.xml` });
  }
  // ?painel=1: mais notas (anos, meses e vendas) para testar o Painel de Notas sem mudar os outros testes
  if (new URLSearchParams(location.search).has("painel")) {
    const extra = [
      ["NFE", "120", "44444444000144", "KALUNGA COMERCIO SA", "2025-11-12T10:00:00-03:00", 800, "Autorizada", "recebida"],
      ["NFE", "121", "44444444000144", "KALUNGA COMERCIO SA", "2025-12-03T10:00:00-03:00", 1200, "Autorizada", "recebida"],
      ["NFSE", "70", "55555555000155", "LINK FIBRA TELECOM ME", "2026-09-05T10:00:00-03:00", 1000, "Autorizada", "recebida"],
      ["NFSE", "9", "11111111000111", "NERVIA TECNOLOGIA", "2026-10-10T10:00:00-03:00", 4500, "Autorizada", "emitida"],
    ];
    for (const [t, n, ec, en, d, v, sit, pap] of extra) db.nf_notas.push({ id: id++, cnpj_consulta: "11111111000111", tipo: t, chave: String(id).repeat(44).slice(0, 44),
      numero: n, emit_cnpj: ec, emit_nome: en, dest_cnpj: pap === "emitida" ? "88888888000188" : "11111111000111", dest_nome: pap === "emitida" ? "COMERCIAL EXEMPLO SA" : "NERVIA TECNOLOGIA",
      data_emissao: d, valor: v, situacao: sit, papel: pap, completo: true, manifestada: false, xml_path: null });
  }
  const pode = (cnpj) => papel === "admin" || db.nf_acessos.some((a) => a.user_id === eu.id && a.cnpj === cnpj);
  const rls = { nf_notas: (r) => pode(r.cnpj_consulta), nf_empresas: (r) => pode(r.cnpj), nf_log: (r) => pode(r.cnpj),
    auditoria: (r) => papel === "admin" || (r.cnpj && pode(r.cnpj)), site_acessos: () => papel === "admin",
    perfis: (r) => papel === "admin" || r.user_id === eu.id,
    apps: (r) => papel === "admin" || (r.ativo && db.app_acessos.some((a) => a.app_id === r.id && a.user_id === eu.id)),
    app_acessos: (r) => papel === "admin" || r.user_id === eu.id, nf_acessos: (r) => papel === "admin" || r.user_id === eu.id,
    tel_relatorios: (r) => papel === "admin" || (r.publicado && db.tel_acessos.some((a) => a.relatorio_id === r.id && a.user_id === eu.id)),
    tel_acessos: (r) => papel === "admin" || r.user_id === eu.id, tel_arquivos: () => papel === "admin" };
  window.__chamadas = [];

  function consulta(tabela) {
    const filtros = []; let ordem = null, faixa = null, op = "select", valores = null, unico = false;
    const q = {
      select() { return q; }, order(c, o) { ordem = [c, o?.ascending !== false]; return q; },
      eq(c, v) { filtros.push((r) => r[c] === v); return q; }, neq(c, v) { filtros.push((r) => r[c] !== v); return q; },
      gte(c, v) { filtros.push((r) => new Date(r[c]) >= new Date(v)); return q; }, lte(c, v) { filtros.push((r) => new Date(r[c]) <= new Date(v)); return q; }, lt(c, v) { filtros.push((r) => new Date(r[c]) < new Date(v)); return q; },
      in(c, v) { filtros.push((r) => v.includes(r[c])); return q; }, limit() { return q; },
      or(expr) { const termos = [...expr.matchAll(/(\w+)\.ilike\.\*([^*]*)\*/g)];
        filtros.push((r) => termos.some(([, c, t]) => String(r[c] ?? "").toLowerCase().includes(t.toLowerCase()))); return q; },
      range(a, b) { faixa = [a, b]; return q; }, maybeSingle() { unico = true; return q; },
      insert(v) { op = "insert"; valores = Array.isArray(v) ? v : [v]; return q; },
      update(v) { op = "update"; valores = v; return q; }, delete() { op = "delete"; return q; },
      then(ok, falha) { return Promise.resolve(exec()).then(ok, falha); },
    };
    function exec() {
      window.__chamadas.push([tabela, op]);
      const t = db[tabela];
      if (op === "insert") {
        if (papel !== "admin") return { data: null, error: { message: "new row violates row-level security policy" } };
        for (const v of valores) { if (tabela === "nf_empresas" && t.some((e) => e.cnpj === v.cnpj)) return { data: null, error: { message: "duplicate key" } }; t.push(tabela === "nf_empresas" ? { termo_status: "pendente", ...v } : { ...v }); }
        return { data: null, error: null };
      }
      const alvo = t.filter((r) => (rls[tabela] ?? (() => true))(r) && filtros.every((f) => f(r)));
      if (op === "update") { alvo.forEach((r) => Object.assign(r, valores)); return { data: null, error: null }; }
      if (op === "delete") { db[tabela] = t.filter((r) => !alvo.includes(r)); return { data: null, error: null }; }
      let out = alvo.map((r) => ({ ...r }));
      if (ordem) out.sort((a, b) => (a[ordem[0]] > b[ordem[0]] ? 1 : -1) * (ordem[1] ? 1 : -1));
      if (faixa) out = out.slice(faixa[0], faixa[1] + 1);
      return { data: unico ? out[0] ?? null : out, error: null };
    }
    return q;
  }

  // XMLs de exemplo (fictícios) no formato real: procNFe 4.00, NFS-e nacional e resumo
  const ch44 = (n) => ("33261" + n.emit_cnpj + "55001" + String(n.numero).padStart(9, "0") + "1" + "12345678").padEnd(43, "0").slice(0, 43) + "7";
  function xmlNFe(n) {
    const ch = ch44(n);
    return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${ch}" versao="4.00">
<ide><cUF>33</cUF><natOp>VENDA DE MERCADORIA</natOp><mod>55</mod><serie>1</serie><nNF>${n.numero}</nNF><dhEmi>${n.data_emissao}</dhEmi><dhSaiEnt>${n.data_emissao}</dhSaiEnt><tpNF>1</tpNF><tpAmb>1</tpAmb></ide>
<emit><CNPJ>${n.emit_cnpj}</CNPJ><xNome>${n.emit_nome}</xNome><enderEmit><xLgr>RUA DAS FLORES</xLgr><nro>100</nro><xBairro>CENTRO</xBairro><cMun>3304557</cMun><xMun>RIO DE JANEIRO</xMun><UF>RJ</UF><CEP>20040000</CEP><fone>2133334444</fone></enderEmit><IE>12345678</IE><CRT>3</CRT></emit>
<dest><CNPJ>${n.dest_cnpj}</CNPJ><xNome>${n.dest_nome}</xNome><enderDest><xLgr>AV BRASIL</xLgr><nro>500</nro><xBairro>PENHA</xBairro><xMun>RIO DE JANEIRO</xMun><UF>RJ</UF><CEP>21000000</CEP></enderDest><IE>87654321</IE></dest>
<det nItem="1"><prod><cProd>A-10</cProd><xProd>CABO DE REDE CAT6 CAIXA 305M</xProd><NCM>85444900</NCM><CFOP>5102</CFOP><uCom>CX</uCom><qCom>2.0000</qCom><vUnCom>${(n.valor / 2).toFixed(4)}</vUnCom><vProd>${n.valor.toFixed(2)}</vProd></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>${n.valor.toFixed(2)}</vBC><pICMS>18.00</pICMS><vICMS>${(n.valor * .18).toFixed(2)}</vICMS></ICMS00></ICMS></imposto></det>
<total><ICMSTot><vBC>${n.valor.toFixed(2)}</vBC><vICMS>${(n.valor * .18).toFixed(2)}</vICMS><vBCST>0.00</vBCST><vST>0.00</vST><vProd>${n.valor.toFixed(2)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vOutro>0.00</vOutro><vNF>${n.valor.toFixed(2)}</vNF></ICMSTot></total>
<transp><modFrete>0</modFrete><vol><qVol>2</qVol><esp>CAIXA</esp><pesoL>20.000</pesoL><pesoB>21.500</pesoB></vol></transp>
<cobr><dup><nDup>001</nDup><dVenc>2026-11-10</dVenc><vDup>${n.valor.toFixed(2)}</vDup></dup></cobr>
<infAdic><infCpl>Pedido 4521. Documento de teste.</infCpl></infAdic></infNFe></NFe>
<protNFe versao="4.00"><infProt><chNFe>${ch}</chNFe><dhRecbto>${n.data_emissao}</dhRecbto><nProt>333260000123456</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
  }
  function xmlResumo(n) { return `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${n.chave}</chNFe><CNPJ>${n.emit_cnpj}</CNPJ><xNome>${n.emit_nome}</xNome><vNF>${n.valor}</vNF></resNFe>`; }
  function xmlNFSe(n) {
    return `<?xml version="1.0" encoding="utf-8"?><NFSe versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS33045572${n.emit_cnpj}000000000${String(n.numero).padStart(6, "0")}26011040620492"><xLocEmi>Rio de Janeiro</xLocEmi><xLocPrestacao>Rio de Janeiro</xLocPrestacao><nNFSe>${n.numero}</nNFSe><cLocIncid>3304557</cLocIncid><xLocIncid>Rio de Janeiro</xLocIncid><xTribNac>Provimento de acesso à internet</xTribNac><cStat>100</cStat><dhProc>${n.data_emissao}</dhProc><nDFSe>16347980</nDFSe><emit><CNPJ>${n.emit_cnpj}</CNPJ><xNome>${n.emit_nome}</xNome><enderNac><xLgr>RIO BRANCO</xLgr><nro>81</nro><xBairro>CENTRO</xBairro><cMun>3304557</cMun><UF>RJ</UF><CEP>20040004</CEP></enderNac><fone>2121224203</fone><email>FINANCEIRO@EXEMPLO.COM.BR</email></emit><valores><vBC>${n.valor.toFixed(2)}</vBC><pAliqAplic>5.00</pAliqAplic><vISSQN>${(n.valor * .05).toFixed(2)}</vISSQN><vLiq>${n.valor.toFixed(2)}</vLiq></valores><DPS versao="1.00"><infDPS Id="DPS1"><tpAmb>1</tpAmb><dhEmi>${n.data_emissao}</dhEmi><serie>00001</serie><nDPS>2953923</nDPS><dCompet>${n.data_emissao.slice(0, 10)}</dCompet><cLocEmi>3304557</cLocEmi><prest><CNPJ>${n.emit_cnpj}</CNPJ><regTrib><opSimpNac>3</opSimpNac><regEspTrib>0</regEspTrib></regTrib></prest><toma><CNPJ>${n.dest_cnpj}</CNPJ><xNome>${n.dest_nome}</xNome><end><endNac><cMun>3304557</cMun><CEP>22763070</CEP></endNac><xLgr>RUA GEOVANI DE CASTRO</xLgr><nro>90</nro><xBairro>FREGUESIA</xBairro></end></toma><serv><locPrest><cLocPrestacao>3304557</cLocPrestacao></locPrest><cServ><cTribNac>010701</cTribNac><xDescServ>LINK DEDICADO 500 MEGA - OUTUBRO/2026</xDescServ></cServ></serv><valores><vServPrest><vServ>${n.valor.toFixed(2)}</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun><totTrib><vTotTrib><vTotTribFed>0.00</vTotTribFed><vTotTribEst>0.00</vTotTribEst><vTotTribMun>${(n.valor * .05).toFixed(2)}</vTotTribMun></vTotTrib></totTrib></trib></valores></infDPS></DPS></infNFSe></NFSe>`;
  }

  window.supabase = { createClient: () => ({
    from: consulta,
    auth: {
      getSession: async () => ({ data: { session: logado ? { user: eu } : null } }),
      signInWithPassword: async () => ({ error: { message: "Invalid login credentials" } }), signOut: async () => ({}),
      updateUser: async (v) => { window.__chamadas.push(["auth:updateUser", v]); return { error: null }; },
      resetPasswordForEmail: async (email, op) => { window.__chamadas.push(["auth:reset", email, op]); return { error: null }; },
      onAuthStateChange: () => {},
    },
    functions: { invoke: async (nome, { body }) => {
      window.__chamadas.push(["fn:" + nome, body]);
      if (nome === "sincronizar") return { data: { ok: true, mensagem: "Tudo baixado. A SEFAZ libera a próxima consulta em 1h.", resumo: { nova: 3, atualizada: 1, evento: 0 } } };
      if (nome === "ciencia") return { data: { ok: true, registradas: body.ids.length, falhas: [], mensagem: `Ciência registrada em ${body.ids.length} de ${body.ids.length} nota(s).` } };
      if (nome === "certificado") return { data: { ok: true, titular: "LINUM:22222222000122", validade: futuro } };
      if (nome === "usuarios") return { data: { ok: true, mensagem: "Login criado." } };
      return { data: null, error: { message: "?" } };
    } },
    storage: { from: () => ({
      createSignedUrl: async (p) => ({ data: { signedUrl: "about:blank#" + p }, error: null }),
      download: async (p) => {
        const n = db.nf_notas.find((x) => x.xml_path === p);
        if (!n || !pode(n.cnpj_consulta)) return { data: null, error: { message: "Object not found" } };
        const xml = n.tipo === "NFE" ? (n.completo ? xmlNFe(n) : xmlResumo(n)) : xmlNFSe(n);
        return { data: new Blob([xml], { type: "text/xml" }), error: null };
      },
    }) },
  }) };
})();
