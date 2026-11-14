// Sistema Linum 2.52 — GIRO DO ESTOQUE (pedido do Marco em 14/11/2026: "medir quanto tempo um produto fica no estoque
// e quem mais gira para dar retorno"). Decisões do Marco (14/11/2026):
//   * só a Dona e o admin veem (tem custo, lucro e retorno);
//   * as peças da contagem inicial (levantamento de 26/10 a 13/11/2026) contam como "no estoque desde 27/10" — o tempo
//     delas aparece com "≥" (pelo menos), porque muitas já estavam na loja antes do sistema;
//   * comparar por peça (clique abre cores e tamanhos), cor, tamanho, loja, tipo de peça e tecido.
// Só tela, sem migração: lê lin_movimentos (a Dona lê pela policy), lin_lucro_itens (vendido e custo de cada peça
// vendida, só a Dona), o cadastro (PRODS/VARS com custo) e o estoque atual (QTD).
//
// Como cada número é calculado (giroCalcular):
//   * IDADE das peças: o histórico de movimentações é refeito em ordem, peça por peça, "a primeira que entra é a primeira
//     que sai" (PEPS). Entrada/produção/ajuste para mais criam um lote com a data; venda, saída, ajuste para menos tiram os
//     lotes mais antigos. Transferência, beneficiamento, malinha/reserva e brinde LEVAM o lote junto (a peça não fica
//     "nova" porque mudou de loja ou voltou da cliente). Devolução de cliente entra como lote novo.
//   * Tempo até vender = idade do lote na data da venda (vendas do período).
//   * Estoque médio = média do estoque da loja em cada dia do período (refeita a partir do estoque de hoje).
//   * Giro = peças vendidas ÷ estoque médio (quantas vezes o estoque "girou" no período).
//   * Cobertura = estoque de hoje ÷ venda média por dia = em quantos dias o estoque acaba no ritmo do período.
//   * Retorno = lucro direto do período (vendido − custo, como na aba Lucro) ÷ custo do estoque médio
//     = quanto cada R$ 1 de estoque parado devolveu de lucro no período.
// Usa as globais do index.html (sb, $, esc, checar, n, brl, decBR, LOJAS, loja, QTD, chave, PRODS, VARS, carregarProdutos,
// classifDe, todas, hoje, dataBR, semAc, ordemVar, nomeVar, dono).

const GIRO_INICIO = "2026-10-27";       // começo do sistema: a contagem inicial conta daqui
const GIRO_LEVANT_ATE = "2026-11-13";   // até aqui as entradas são da contagem inicial, salvo as marcadas como peça nova
const GIRO_NOVA = /\bnovas?\b|chegaram/i;
const GIRO_POR = { peca: "Peça", cor: "Cor", tamanho: "Tamanho", loja: "Loja", tipo: "Tipo de peça", tecido: "Tecido" };
const GIRO_ORDEM = { giro: "Mais giro", retorno: "Mais retorno", lucro: "Mais lucro", vendidas: "Mais vendidas", parado: "Mais dinheiro parado", idade: "Há mais tempo no estoque" };
const FGI = { dias: 90, loja: "", por: "peca", ordem: "giro", q: "" };

const giroDias = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
const giroSomaDias = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// Contagem inicial (levantamento) = entrada/ajuste até GIRO_LEVANT_ATE que não diz "peça nova"/"chegaram"
const giroImplantacao = m => m.data <= GIRO_LEVANT_ATE && !GIRO_NOVA.test(m.observacao || "");

// movs: lin_movimentos em ordem; itens: lin_lucro_itens do período; qtd: Map "variante:loja" → estoque de hoje
// devolve um Map "variante:loja" → célula com os números (ver o fim da função)
function giroCalcular({ movs, itens, qtd, ini, fim }) {
  const N = giroDias(ini, fim) + 1;
  const cel = new Map();
  const C = (v, l) => { const k = v + ":" + l; let c = cel.get(k);
    if (!c) cel.set(k, c = { v, l, lotes: [], est: 0, efeito: 0, vendQ: 0, vendR: 0, vendC: 0, vendSemC: 0, vendSemCR: 0, idVend: 0, idVendQ: 0, idVendImp: false });
    return c; };
  const pools = new Map();   // peças fora da loja (transferência a caminho, beneficiamento, malinha, brinde): levam o lote
  const lote = (m, imp) => ({ d: imp ? GIRO_INICIO : m.data, imp, q: 0 });
  const tirar = (lotes, q) => { const out = [];
    while (q > 0 && lotes.length) { const t = lotes[0], k = Math.min(q, t.q); out.push({ ...t, q: k }); t.q -= k; q -= k; if (!t.q) lotes.shift(); }
    return { out, falta: q }; };
  const por = (lotes, ls) => { ls.forEach(x => { if (x.q > 0) lotes.push({ ...x }); }); lotes.sort((a, b) => a.d.localeCompare(b.d)); };
  const entrar = (c, m, q, imp) => { if (q > 0) por(c.lotes, [{ ...lote(m, imp), q }]); };
  const sair = (c, q) => tirar(c.lotes, q).out;
  const doPool = (k, m, q) => { const ls = pools.get(k) || []; const r = tirar(ls, q);
    if (r.falta) r.out.push({ ...lote(m, giroImplantacao(m)), q: r.falta });
    return r.out; };
  const paraPool = (k, ls) => { const p = pools.get(k) || []; por(p, ls); pools.set(k, p); };
  const kPool = m => m.transferencia_id ? "t" + m.transferencia_id : m.beneficiamento_id ? "b" + m.beneficiamento_id
    : m.brinde_id ? "r" + m.brinde_id : m.condicional_id ? "c" + m.condicional_id : "m" + m.id;
  for (const m of movs) {
    const q = Number(m.quantidade || 0), c = C(m.variante_id, m.loja_id);
    // estoque médio: soma de efeito × dias do período ANTES da movimentação (refeito do estoque de hoje para trás)
    const ef = mvEfeito(m, m.loja_id);
    if (m.data > ini) c.efeito += ef * Math.min(giroDias(ini, m.data), N);
    if (m.tipo === "transferencia" && m.loja_destino_id) {
      const d = C(m.variante_id, m.loja_destino_id);
      if (m.data > ini) d.efeito += q * Math.min(giroDias(ini, m.data), N);
      por(d.lotes, sair(c, q));
      continue;
    }
    switch (m.tipo) {
      case "entrada": entrar(c, m, q, giroImplantacao(m)); break;
      case "producao": case "devolucao": entrar(c, m, q, false); break;
      case "ajuste": { const dl = Number(m.depois) - Number(m.antes);
        if (dl > 0) entrar(c, m, dl, giroImplantacao(m)); else if (dl < 0) sair(c, -dl); break; }
      case "saida": sair(c, q); break;
      case "venda": { const ls = sair(c, q);
        if (m.data >= ini && m.data <= fim) ls.forEach(x => { c.idVend += x.q * giroDias(x.d, m.data); c.idVendQ += x.q; if (x.imp) c.idVendImp = true; });
        break; }
      case "transf_envio": case "benef_envio": case "brinde": case "cond_saida": paraPool(kPool(m), sair(c, q)); break;
      case "transf_recebida": case "transf_retorno": case "benef_retorno": case "brinde_cancelado": case "cond_volta": por(c.lotes, doPool(kPool(m), m, q)); break;
      default: break;
    }
  }
  // confere com o estoque de hoje: o que faltar no histórico entra como contagem inicial; o que sobrar sai (o mais antigo)
  for (const [k, q] of qtd) { if (q > 0) { const [v, l] = k.split(":"); C(v, l); } }
  for (const c of cel.values()) {
    c.est = qtd.get(c.v + ":" + c.l) || 0;
    const tem = c.lotes.reduce((s, x) => s + x.q, 0);
    if (tem < c.est) por(c.lotes, [{ d: GIRO_INICIO, imp: true, q: c.est - tem }]);
    else if (tem > c.est) tirar(c.lotes, tem - c.est);
    c.estMedio = Math.max(0, c.est - c.efeito / N);
  }
  for (const i of itens) {
    if (i.data < ini || i.data > fim || !i.variante_id) continue;
    const c = C(i.variante_id, i.loja_id);
    if (c.est == null) { c.est = 0; c.estMedio = 0; }
    c.vendQ += i.quantidade;
    if (i.custo == null) { c.vendSemC += i.quantidade; c.vendSemCR += Number(i.vendido); } else { c.vendR += Number(i.vendido); c.vendC += Number(i.custo); }
  }
  return { cel, N };
}

// soma das células de um grupo (custo e preço de hoje vêm do cadastro)
function giroSomar(cs, hojeD, N) {
  const t = { est: 0, estMedio: 0, vendQ: 0, vendR: 0, vendC: 0, vendSemC: 0, vendSemCR: 0, idVend: 0, idVendQ: 0, idVendImp: false,
    idEst: 0, idEstImp: false, valCusto: 0, valVenda: 0, medCusto: 0, semCustoEst: 0, parado60: 0, cels: cs };
  for (const c of cs) {
    const va = GIRO_VAR.get(c.v), p = va && GIRO_PROD.get(va.produto_id);
    const cu = va && va.preco_custo != null ? Number(va.preco_custo) : p && p.preco_custo != null ? Number(p.preco_custo) : null;
    const pv = va && va.preco_venda != null ? Number(va.preco_venda) : p ? Number(p.preco_venda || 0) : 0;
    t.est += c.est; t.estMedio += c.estMedio; t.vendQ += c.vendQ; t.vendR += c.vendR; t.vendC += c.vendC; t.vendSemC += c.vendSemC; t.vendSemCR += c.vendSemCR;
    t.idVend += c.idVend; t.idVendQ += c.idVendQ; if (c.idVendImp) t.idVendImp = true;
    c.lotes.forEach(x => { const d = giroDias(x.d, hojeD); t.idEst += x.q * d; if (x.imp) t.idEstImp = true; if (d > 60) t.parado60 += x.q; });
    t.valVenda += c.est * pv;
    if (cu == null) t.semCustoEst += c.est; else { t.valCusto += c.est * cu; t.medCusto += c.estMedio * cu; }
  }
  t.lucro = t.vendR - t.vendC;
  t.giro = t.estMedio > 0 ? t.vendQ / t.estMedio : null;
  t.cobertura = t.vendQ > 0 ? t.est / (t.vendQ / N) : null;
  t.idadeEst = t.est > 0 ? t.idEst / t.est : null;
  t.idadeVend = t.idVendQ > 0 ? t.idVend / t.idVendQ : null;
  t.retorno = t.medCusto > 0 ? t.lucro / t.medCusto : null;
  t.vendido = t.vendQ + t.est > 0 ? t.vendQ / (t.vendQ + t.est) : null;
  t.parado = t.est > 0 && !t.vendQ;
  return t;
}
function giroSituacao(t) {
  if (!t.est && !t.vendQ) return ["", ""];
  if (!t.est) return ["Esgotou", "ok"];
  if (!t.vendQ) return ["Sem venda", "fora"];
  if (t.cobertura <= 30) return ["Gira rápido", "ok"];
  if (t.cobertura <= 90) return ["Normal", ""];
  return ["Lento", "lento"];
}
let GIRO_VAR = new Map(), GIRO_PROD = new Map();

async function telaGiro() {
  $("tela").innerHTML = '<div class="card">Carregando…</div>';
  const fim = hoje();
  const pedido = giroSomaDias(fim, -(FGI.dias - 1));
  const ini = pedido < GIRO_INICIO ? GIRO_INICIO : pedido;
  let movs, itens;
  try {
    [movs, itens] = await Promise.all([
      todas(() => sb.from("lin_movimentos").select("id,variante_id,loja_id,loja_destino_id,tipo,quantidade,antes,depois,data,observacao,transferencia_id,beneficiamento_id,brinde_id,condicional_id")
        .order("criado_em").order("id")),
      todas(() => sb.rpc("lin_lucro_itens", { p_de: ini, p_ate: fim })),
      carregarProdutos()]);
  } catch (e) { $("tela").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  GIRO_VAR = new Map(VARS.map(v => [v.id, v])); GIRO_PROD = new Map(PRODS.map(p => [p.id, p]));
  const { cel, N } = giroCalcular({ movs, itens, qtd: QTD, ini, fim });
  const prodDe = c => GIRO_PROD.get((GIRO_VAR.get(c.v) || {}).produto_id) || {};
  const nomePeca = p => [p.referencia, p.descricao].filter(Boolean).join(" ") || "Peça excluída";
  const tipoDe = p => { const cl = classifDe(p); return cl ? cl.tipo_peca : (p.categoria || "Sem tipo"); };
  const CHAVE = { peca: c => prodDe(c).id || "?", cor: c => (GIRO_VAR.get(c.v) || {}).cor || "Sem cor", tamanho: c => (GIRO_VAR.get(c.v) || {}).tamanho || "Sem tamanho",
    loja: c => loja(c.l).nome, tipo: c => tipoDe(prodDe(c)), tecido: c => prodDe(c).tecido || "Sem tecido" };
  const rotulo = (k, c) => FGI.por === "peca" ? nomePeca(prodDe(c)) : k;
  const q = semAc(FGI.q);
  let cs = [...cel.values()].filter(c => (!FGI.loja || c.l === FGI.loja) && (c.est || c.vendQ || c.estMedio));
  if (q) cs = cs.filter(c => { const p = prodDe(c), v = GIRO_VAR.get(c.v) || {}; return semAc([p.referencia, p.descricao, v.cor, v.tamanho, v.edicao, p.tecido].join(" ")).includes(q); });
  const grupos = new Map();
  cs.forEach(c => { const k = CHAVE[FGI.por](c); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(c); });
  const linhas = [...grupos.entries()].map(([k, l]) => ({ k, rot: rotulo(k, l[0]), t: giroSomar(l, fim, N) }));
  const ORD = { giro: t => t.giro ?? -1, retorno: t => t.retorno ?? -1e9, lucro: t => t.lucro, vendidas: t => t.vendQ, parado: t => t.parado ? t.valCusto : -1, idade: t => t.idadeEst ?? -1 };
  linhas.sort((a, b) => ORD[FGI.ordem](b.t) - ORD[FGI.ordem](a.t) || b.t.vendQ - a.t.vendQ || a.rot.localeCompare(b.rot, "pt-BR"));
  const T = giroSomar(cs, fim, N);
  const vendas = new Set(itens.filter(i => !FGI.loja || i.loja_id === FGI.loja).map(i => i.venda_id)).size;
  const dec = (x, c = 1) => x == null ? "—" : decBR(Number(x).toFixed(c));
  const pc = x => x == null ? "—" : decBR((100 * x).toFixed(0)) + "%";
  const dias = (x, imp) => x == null ? "—" : `${imp ? "≥ " : ""}${n(Math.round(x))} dia${Math.round(x) === 1 ? "" : "s"}`;
  const cob = t => !t.est ? "—" : t.cobertura == null ? "sem venda" : t.cobertura > 999 ? "+999 dias" : `${n(Math.round(t.cobertura))} dias`;
  const ret = t => t.retorno == null ? "—" : `${brl(t.retorno)}`;
  const nGrupos = grupos.size;
  const SV = giroSomar(cs.filter(c => c.est > 0 && !c.vendQ), fim, N);   // cores/tamanhos (por loja) sem nenhuma venda
  const jovem = giroDias(GIRO_INICIO, fim) < 90;
  $("tela").innerHTML = `
    <div class="cabtela"><h2>Giro do estoque</h2><span class="noprint" style="display:flex;gap:8px"><button class="bt" id="gicsv">Baixar CSV</button><button class="bt" id="giimp">Imprimir</button></span></div>
    <p class="mut" style="margin-top:0">Quanto tempo as peças ficam no estoque, quais vendem mais rápido e quanto lucro cada real parado em estoque devolve. Período: ${dataBR(ini)} a ${dataBR(fim)} (${n(N)} dia${N === 1 ? "" : "s"}).</p>
    <div class="filtros">
      <select id="gidias" aria-label="Período">${[30, 60, 90, 180, 365].map(d => `<option value="${d}" ${d === FGI.dias ? "selected" : ""}>Últimos ${d} dias</option>`).join("")}</select>
      <select id="giloja" aria-label="Loja"><option value="">Todas as lojas</option>${LOJAS.map(l => `<option value="${l.id}" ${l.id === FGI.loja ? "selected" : ""}>${esc(l.nome)}</option>`).join("")}</select>
      <select id="gipor" aria-label="Comparar por">${Object.entries(GIRO_POR).map(([k, t]) => `<option value="${k}" ${k === FGI.por ? "selected" : ""}>Por ${t.toLowerCase()}</option>`).join("")}</select>
      <select id="giord" aria-label="Ordenar">${Object.entries(GIRO_ORDEM).map(([k, t]) => `<option value="${k}" ${k === FGI.ordem ? "selected" : ""}>${t}</option>`).join("")}</select>
      <input id="giq" type="search" placeholder="Buscar peça, cor, tecido…" value="${esc(FGI.q)}" style="max-width:240px">
    </div>
    ${jovem || vendas < 30 ? `<div class="msg">O sistema começou em ${dataBR(GIRO_INICIO)} e tem ${n(vendas)} venda(s) neste período: os números ainda mudam muito de uma semana para outra e ficam mais confiáveis depois de 2 a 3 meses de vendas. As peças da contagem inicial contam como no estoque desde ${dataBR(GIRO_INICIO)} — por isso o tempo delas aparece com "≥" (pelo menos).</div>` : ""}
    <div class="kpis">
      <div class="kpi"><small>Estoque hoje</small><b>${n(T.est)} peças</b><span>${brl(T.valCusto)} a custo · ${brl(T.valVenda)} a preço de venda</span></div>
      <div class="kpi"><small>Vendidas no período</small><b>${n(T.vendQ)} peças</b><span>${brl(T.vendR + T.vendSemCR)} vendidos · ${pc(T.vendido)} do que havia</span></div>
      <div class="kpi"><small>Giro do estoque</small><b>${dec(T.giro, 2)}×</b><span>vendidas ÷ estoque médio (${n(Math.round(T.estMedio))} peças)</span></div>
      <div class="kpi"><small>Cobertura</small><b>${cob(T)}</b><span>tempo para vender o estoque de hoje no ritmo do período</span></div>
      <div class="kpi"><small>Tempo médio no estoque</small><b>${dias(T.idadeEst, T.idEstImp)}</b><span>das peças que estão na loja hoje</span></div>
      <div class="kpi"><small>Tempo até vender</small><b>${dias(T.idadeVend, T.idVendImp)}</b><span>da entrada até a venda (média)</span></div>
      <div class="kpi"><small>Retorno do estoque</small><b>${ret(T)}</b><span>de lucro para cada R$ 1 de estoque a custo no período</span></div>
      <div class="kpi"><small>Sem venda no período</small><b>${n(SV.est)} peças</b><span>${brl(SV.valCusto)} a custo, em ${n(SV.cels.length)} cor(es)/tamanho(s) que não venderam nenhuma</span></div>
    </div>
    ${T.semCustoEst || T.vendSemC ? `<div class="msg">${T.semCustoEst ? `${n(T.semCustoEst)} peça(s) em estoque sem preço de custo não entram no valor a custo nem no retorno. ` : ""}${T.vendSemC ? `${n(T.vendSemC)} peça(s) vendida(s) sem custo não entram no lucro. ` : ""}Cadastre o custo em Produtos (ou pela ficha de custo).</div>` : ""}
    <div class="card"><h2>Por ${GIRO_POR[FGI.por].toLowerCase()} <span class="mut" style="font-weight:400;font-size:.85rem">(${n(nGrupos)})</span></h2><div class="tw"><table id="gitab"><thead><tr>
      <th>${GIRO_POR[FGI.por]}</th><th>Situação</th><th class="num">Estoque hoje</th><th class="num">Vendidas</th><th class="num">Giro</th><th class="num">Cobertura</th>
      <th class="num">Tempo no estoque</th><th class="num">Tempo até vender</th><th class="num">Estoque a custo</th><th class="num">Lucro</th><th class="num">Retorno</th></tr></thead><tbody>
      ${linhas.length ? linhas.map(({ k, rot, t }) => { const [st, cl] = giroSituacao(t); return `<tr${FGI.por === "peca" ? ` class="girow" data-p="${esc(k)}" style="cursor:pointer" title="Ver cores, tamanhos e lojas"` : ""}>
        <td>${FGI.por === "peca" ? `<button type="button" class="lnk">${esc(rot)}</button>` : esc(rot)}</td><td>${st ? `<span class="tag ${cl}">${st}</span>` : ""}</td>
        <td class="num">${n(t.est)}</td><td class="num">${n(t.vendQ)}</td><td class="num">${dec(t.giro, 2)}</td><td class="num">${cob(t)}</td>
        <td class="num">${dias(t.idadeEst, t.idEstImp)}</td><td class="num">${dias(t.idadeVend, t.idVendImp)}</td>
        <td class="num">${brl(t.valCusto)}${t.semCustoEst ? ' <span class="mut">*</span>' : ""}</td><td class="num">${t.vendQ ? brl(t.lucro) : "—"}</td><td class="num"><b>${ret(t)}</b></td></tr>`; }).join("")
      : '<tr><td colspan="11" class="mut">Nada para mostrar com estes filtros.</td></tr>'}
    </tbody></table></div>
    <div class="mut" style="margin-top:6px">
      <b>Giro</b> = peças vendidas ÷ estoque médio do período (2 = o estoque médio foi vendido duas vezes). <b>Cobertura</b> = em quantos dias o estoque de hoje acaba no ritmo de venda do período (até 30 dias = gira rápido; até 90 = normal; mais = lento).
      <b>Tempo no estoque</b> = há quantos dias, em média, as peças de hoje entraram; <b>tempo até vender</b> = da entrada até a venda (a primeira peça que entra é a primeira que sai; transferência, malinha e beneficiamento não zeram o tempo). "≥" = inclui peças da contagem inicial (no estoque desde pelo menos ${dataBR(GIRO_INICIO)}).
      <b>Lucro</b> = vendido − custo (como na aba Lucro). <b>Retorno</b> = lucro ÷ custo do estoque médio: quanto cada R$ 1 em estoque devolveu de lucro no período. * = parte das peças sem custo. Trocas e devoluções não mudam as vendas.</div></div>`;
  $("gidias").onchange = e => { FGI.dias = Number(e.target.value); telaGiro(); };
  $("giloja").onchange = e => { FGI.loja = e.target.value; telaGiro(); };
  $("gipor").onchange = e => { FGI.por = e.target.value; telaGiro(); };
  $("giord").onchange = e => { FGI.ordem = e.target.value; telaGiro(); };
  $("giq").onchange = e => { FGI.q = e.target.value; telaGiro(); };
  $("giimp").onclick = () => window.print();
  document.querySelectorAll(".girow").forEach(r => r.onclick = () => giroDetalhe(r.dataset.p, grupos.get(r.dataset.p) || [], fim, N, ini));
  $("gicsv").onclick = () => {
    const c = x => `"${String(x ?? "").replace(/"/g, '""')}"`, num = (x, k = 2) => x == null ? "" : Number(x).toFixed(k).replace(".", ",");
    const l = [[GIRO_POR[FGI.por], "Situação", "Estoque hoje", "Vendidas", "Estoque médio", "Giro", "Cobertura (dias)", "Tempo no estoque (dias)", "Contagem inicial no estoque",
      "Tempo até vender (dias)", "Estoque a custo", "Estoque a preço de venda", "Vendido", "Lucro", "Retorno por R$ 1"].map(c).join(";"),
      ...linhas.map(({ rot, t }) => [rot, giroSituacao(t)[0], t.est, t.vendQ, num(t.estMedio, 1), num(t.giro), num(t.cobertura, 0), num(t.idadeEst, 0), t.idEstImp ? "sim" : "",
        num(t.idadeVend, 0), num(t.valCusto), num(t.valVenda), num(t.vendR + t.vendSemCR), num(t.lucro), num(t.retorno)].map(c).join(";"))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + l.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `giro-estoque-linum-${FGI.por}-${ini}-a-${fim}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}

// uma peça: cada cor/tamanho em cada loja
function giroDetalhe(pid, cs, fim, N, ini) {
  const p = GIRO_PROD.get(pid) || {};
  const linhas = cs.map(c => ({ c, va: GIRO_VAR.get(c.v) || {}, t: giroSomar([c], fim, N) }))
    .sort((a, b) => ordemVar(a.va, b.va) || loja(a.c.l).nome.localeCompare(loja(b.c.l).nome, "pt-BR"));
  const dias = (x, imp) => x == null ? "—" : `${imp ? "≥ " : ""}${n(Math.round(x))}`;
  const f = $("dlgf");
  f.innerHTML = `<h3>${esc([p.referencia, p.descricao].filter(Boolean).join(" ") || "Peça")}</h3>
    <p class="mut">Giro de ${dataBR(ini)} a ${dataBR(fim)}, por cor, tamanho e loja. Dias com "≥" incluem peças da contagem inicial.</p>
    <div class="tw"><table id="gidet"><thead><tr><th>Cor / tamanho</th><th>Loja</th><th>Situação</th><th class="num">Estoque</th><th class="num">Vendidas</th><th class="num">Giro</th><th class="num">Dias no estoque</th><th class="num">Dias até vender</th></tr></thead><tbody>
      ${linhas.map(({ c, va, t }) => { const [st, cl] = giroSituacao(t); return `<tr><td>${esc(nomeVar(va))}${va.edicao ? " ★" : ""}</td><td>${esc(loja(c.l).nome)}</td><td>${st ? `<span class="tag ${cl}">${st}</span>` : ""}</td>
        <td class="num">${n(t.est)}</td><td class="num">${n(t.vendQ)}</td><td class="num">${t.giro == null ? "—" : decBR(t.giro.toFixed(2))}</td><td class="num">${dias(t.idadeEst, t.idEstImp)}</td><td class="num">${dias(t.idadeVend, t.idVendImp)}</td></tr>`; }).join("")}
    </tbody></table></div>
    <div class="acoes"><button type="button" class="bt" id="gidx">Fechar</button></div>`;
  $("gidx").onclick = () => $("dlg").close();
  $("dlg").classList.add("largo");
  $("dlg").showModal();
}
