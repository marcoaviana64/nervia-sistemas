// Complemento do testes/supabase_falso.js para o teste das propostas: imita as tabelas prop_* e as funções
// prop_salvar, prop_acao, prop_ler, prop_responder e apps_vitrine_publica (mesmas mensagens do SQL de
// supabase/migrations/20261110000400_propostas.sql). As regras de verdade estão testadas em testes/teste_sql.sql.
// Os dados ficam no localStorage, para a página da Área do Cliente e a página do prospect (mesma origem) verem o mesmo.
(function () {
  const CHAVE = "prop_teste";
  let db;
  const carregar = () => { db = JSON.parse(localStorage.getItem(CHAVE) || '{"prop_propostas":[],"prop_eventos":[],"seq":0,"evseq":0}'); };
  carregar();
  const gravar = () => localStorage.setItem(CHAVE, JSON.stringify(db));
  const papel = (new URLSearchParams(location.search).get("papel")) || localStorage.getItem("papel_teste") || "anon";
  const admin = () => papel === "admin" && !location.pathname.startsWith("/proposta/");
  const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const ev = (p, tipo, texto, nome) => { db.prop_eventos.push({ id: ++db.evseq, proposta_id: p.id, quando: new Date().toISOString(), tipo, texto,
    quem: admin() ? "u-admin" : null, quem_nome: nome || (admin() ? "Marco" : ""), ip: admin() ? null : "200.1.2.3" }); };
  const lista = (l, desc) => (Array.isArray(l) ? l : []).map(e => desc ? { t: String(e.t ?? e).trim(), d: String(e.d || "").trim() } : String(e.t ?? e).trim()).filter(e => (desc ? e.t : e));
  const publica = p => ({ numero: p.numero, prospect: p.prospect, contato: p.contato, titulo: p.titulo, resumo: p.resumo, modelo_url: p.modelo_url,
    conteudo: p.conteudo, valida_ate: p.valida_ate, versao: p.versao, situacao: p.situacao === "cliente" ? "aprovada" : p.situacao,
    vencida: p.valida_ate < hoje() && ["enviada", "ajuste"].includes(p.situacao), respondida_em: p.respondida_em, resposta_nome: p.resposta_nome,
    resposta_texto: p.situacao === "ajuste" ? p.resposta_texto : "" });
  const conferir = (link, cod) => {
    if (!/^[a-f0-9]{12}$/.test(link || "")) return { erro: "Link inválido. Confira o endereço que você recebeu." };
    const p = db.prop_propostas.find(x => x.link === link);
    if (!p || p.codigo !== String(cod).replace(/\D/g, "")) return { erro: String(cod).replace(/\D/g, "").length !== 6 ? "Digite o código de 6 números que veio junto com o link." : "Código incorreto. Confira a mensagem que você recebeu." };
    if (["rascunho", "cancelada"].includes(p.situacao)) return { erro: "Esta proposta não está disponível. Fale com a Nervia pelo WhatsApp." };
    return { p };
  };
  const erro = m => ({ data: null, error: { message: m } });
  const RPC = {
    apps_vitrine: () => ({ data: [], error: null }),
    apps_vitrine_publica: () => ({ data: [
      { id: "site-negocios", nome: "Site para negócios", descricao: "Site profissional pronto para celular.", icone: "SN", situacao: "disponivel", demo_url: "", ordem: 70 },
      { id: "compras", nome: "Orçamentos de Compras", descricao: "Cotações com três fornecedores.", icone: "OC", situacao: "disponivel", demo_url: "/demo/compras/", ordem: 40 },
      { id: "studio", nome: "Nervia Studio", descricao: "Agenda, alunos e mensalidades.", icone: "NS", situacao: "em_desenvolvimento", demo_url: "", ordem: 75 }], error: null }),
    prop_salvar: ({ p }) => {
      if (!admin()) return erro("Só a equipe Nervia monta propostas.");
      if (!p.valida_ate) return erro("Informe até quando a proposta vale.");
      if (p.valida_ate < hoje()) return erro("A validade precisa ser hoje ou depois.");
      const c = p.conteudo || {}, cont = { incluido: lista(c.incluido, true), depois: lista(c.depois, true), etapas: lista(c.etapas, true),
        precisamos: lista(c.precisamos, false), investimento: (c.investimento || []).filter(i => i.t).map(i => ({ t: i.t, d: i.d || "", v: i.v || "" })), condicoes: c.condicoes || "" };
      let r;
      if (!p.id) {
        r = { id: ++db.seq, numero: hoje().slice(0, 4) + "-" + String(db.seq).padStart(3, "0"), link: Math.random().toString(16).slice(2, 8) + Date.now().toString(16).slice(-6),
          codigo: String(100000 + Math.floor(Math.random() * 899999)), situacao: "rascunho", versao: 1, visualizacoes: 0, ultima_visita: null, primeira_visita: null,
          respondida_em: null, resposta_nome: "", resposta_texto: "", cancelada_motivo: "", criado_em: new Date().toISOString() };
        r.link = (r.link + "000000000000").slice(0, 12);
        db.prop_propostas.push(r);
        Object.assign(r, { prospect: p.prospect, contato: p.contato || "", whatsapp: p.whatsapp || "", email: (p.email || "").toLowerCase(), titulo: p.titulo,
          resumo: p.resumo || "", modelo_url: p.modelo_url || "", obs: p.obs || "", conteudo: cont, valida_ate: p.valida_ate });
        ev(r, "criada", "Proposta criada (rascunho).");
      } else {
        r = db.prop_propostas.find(x => x.id === p.id);
        if (["aprovada", "cliente", "cancelada"].includes(r.situacao)) return erro(`Proposta ${r.numero}: não dá para alterar depois de ${r.situacao}.`);
        Object.assign(r, { prospect: p.prospect, contato: p.contato, whatsapp: p.whatsapp, email: p.email, titulo: p.titulo, resumo: p.resumo,
          modelo_url: p.modelo_url, obs: p.obs, conteudo: cont, valida_ate: p.valida_ate });
        if (["enviada", "ajuste"].includes(r.situacao)) { r.versao++; r.situacao = "enviada"; }
        ev(r, "alterada", r.versao > 1 ? `Nova versão (${r.versao}) no mesmo link.` : "Proposta alterada.");
      }
      gravar();
      return { data: { id: r.id, numero: r.numero, link: r.link, codigo: r.codigo, situacao: r.situacao, versao: r.versao }, error: null };
    },
    prop_acao: ({ p_id, p_acao, p_motivo }) => {
      if (!admin()) return erro("Só a equipe Nervia.");
      const r = db.prop_propostas.find(x => x.id === p_id);
      if (p_acao === "enviada") { r.situacao = "enviada"; ev(r, "enviada", "Enviada ao prospect."); }
      else if (p_acao === "novo_codigo") { r.codigo = String(100000 + Math.floor(Math.random() * 899999)); ev(r, "novo_codigo", "Código de acesso trocado (o anterior deixa de valer)."); }
      else if (p_acao === "cancelar") { if ((p_motivo || "").trim().length < 5) return erro("Informe o motivo do cancelamento (pelo menos 5 letras)."); r.situacao = "cancelada"; r.cancelada_motivo = p_motivo; ev(r, "cancelada", p_motivo); }
      else if (p_acao === "reabrir") { r.situacao = "rascunho"; ev(r, "reaberta", "Reaberta como rascunho."); }
      else if (p_acao === "cliente") { if (r.situacao !== "aprovada") return erro("Só proposta aprovada vira cliente."); r.situacao = "cliente"; ev(r, "cliente", "Prospect virou cliente."); }
      gravar();
      return { data: { id: r.id, numero: r.numero, link: r.link, codigo: r.codigo, situacao: r.situacao }, error: null };
    },
    prop_ler: ({ p_link, p_codigo }) => {
      const c = conferir(p_link, p_codigo); if (c.erro) return { data: { ok: false, erro: c.erro }, error: null };
      const p = c.p;
      if (!p.ultima_visita || Date.now() - new Date(p.ultima_visita) > 30 * 6e4) { p.visualizacoes++; p.primeira_visita = p.primeira_visita || new Date().toISOString();
        ev(p, "visualizada", `Proposta aberta pelo link (versão ${p.versao}).`); }
      p.ultima_visita = new Date().toISOString(); gravar();
      return { data: { ok: true, proposta: publica(p) }, error: null };
    },
    prop_responder: ({ p_link, p_codigo, p_acao, p_nome, p_texto }) => {
      const c = conferir(p_link, p_codigo); if (c.erro) return { data: { ok: false, erro: c.erro }, error: null };
      const p = c.p, nome = (p_nome || "").trim(), txt = (p_texto || "").trim();
      if (!["enviada", "ajuste"].includes(p.situacao)) return { data: { ok: false, erro: "Esta proposta já foi respondida. Para mudar algo, fale com a Nervia pelo WhatsApp." }, error: null };
      if (nome.length < 2) return { data: { ok: false, erro: "Informe o seu nome." }, error: null };
      if (p_acao === "ajuste" && txt.length < 5) return { data: { ok: false, erro: "Escreva o que você gostaria de mudar." }, error: null };
      p.situacao = p_acao === "aprovar" ? "aprovada" : "ajuste"; p.respondida_em = new Date().toISOString(); p.resposta_nome = nome; p.resposta_texto = txt;
      ev(p, p.situacao, p.situacao === "aprovada" ? "Aprovada por " + nome : `Ajuste pedido por ${nome}: ${txt}`, nome);
      gravar();
      return { data: { ok: true, situacao: p.situacao }, error: null };
    },
  };
  function tabela(nome) {
    const filtros = []; let ordem = null;
    const q = {
      select() { return q; }, eq(c, v) { filtros.push(r => r[c] === v); return q; }, order(c, o) { ordem = [c, o?.ascending !== false]; return q; },
      then(ok, falha) {
        carregar();
        let out = admin() ? db[nome].filter(r => filtros.every(f => f(r))).map(r => ({ ...r })) : [];
        if (ordem) out.sort((a, b) => (a[ordem[0]] > b[ordem[0]] ? 1 : -1) * (ordem[1] ? 1 : -1));
        return Promise.resolve({ data: out, error: null }).then(ok, falha);
      },
    };
    return q;
  }
  const original = window.supabase.createClient;
  window.supabase.createClient = (...a) => {
    const c = original(...a), from = c.from;
    c.from = n => (n === "prop_propostas" || n === "prop_eventos") ? tabela(n) : from(n);
    c.rpc = async (nome, args) => { window.__chamadas && window.__chamadas.push(["rpc:" + nome, args]);
      carregar();
      return RPC[nome] ? RPC[nome](args || {}) : erro("função não imitada no teste: " + nome); };
    return c;
  };
})();
