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
      { id: "chamados", nome: "Chamados", descricao: "Abertura e acompanhamento de chamados.", url: "/apps/chamados/", icone: "CH", ordem: 20, ativo: false },
    ],
    app_acessos: [{ user_id: "u-cli", app_id: "notas" }],
    nf_acessos: [{ user_id: "u-cli", cnpj: "22222222000122" }],
    nf_empresas: [
      { cnpj: "11111111000111", nome: "Nervia", uf: "RJ", ativo: true, busca_automatica: true, cert_secret_id: "s1", cert_titular: "NERVIA TECNOLOGIA DA INFORMACAO LTDA:11111111000111", cert_validade: futuro, ultima_sinc_nfe: new Date().toISOString(), bloqueio_nfe: new Date(Date.now() + 40 * 6e4).toISOString(), ultima_sinc_nfse: new Date().toISOString() },
      { cnpj: "22222222000122", nome: "Linum", uf: "RJ", ativo: true, busca_automatica: true, cert_secret_id: null },
    ],
    nf_notas: [],
    nf_log: [{ id: 1, cnpj: "11111111000111", quando: new Date().toISOString(), origem: "NFE", mensagem: "Tudo baixado. {\"nova\":4}" }],
  };
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
  const pode = (cnpj) => papel === "admin" || db.nf_acessos.some((a) => a.user_id === eu.id && a.cnpj === cnpj);
  const rls = { nf_notas: (r) => pode(r.cnpj_consulta), nf_empresas: (r) => pode(r.cnpj), nf_log: (r) => pode(r.cnpj),
    perfis: (r) => papel === "admin" || r.user_id === eu.id,
    apps: (r) => papel === "admin" || (r.ativo && db.app_acessos.some((a) => a.app_id === r.id && a.user_id === eu.id)),
    app_acessos: (r) => papel === "admin" || r.user_id === eu.id, nf_acessos: (r) => papel === "admin" || r.user_id === eu.id };
  window.__chamadas = [];

  function consulta(tabela) {
    const filtros = []; let ordem = null, faixa = null, op = "select", valores = null, unico = false;
    const q = {
      select() { return q; }, order(c, o) { ordem = [c, o?.ascending !== false]; return q; },
      eq(c, v) { filtros.push((r) => r[c] === v); return q; }, neq(c, v) { filtros.push((r) => r[c] !== v); return q; },
      gte(c, v) { filtros.push((r) => new Date(r[c]) >= new Date(v)); return q; }, lte(c, v) { filtros.push((r) => new Date(r[c]) <= new Date(v)); return q; },
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
        for (const v of valores) { if (tabela === "nf_empresas" && t.some((e) => e.cnpj === v.cnpj)) return { data: null, error: { message: "duplicate key" } }; t.push({ ...v }); }
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
    storage: { from: () => ({ createSignedUrl: async (p) => ({ data: { signedUrl: "about:blank#" + p }, error: null }) }) },
  }) };
})();
