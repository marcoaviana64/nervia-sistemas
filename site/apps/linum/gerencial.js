// Sistema Linum 2.36 — Gerencial, fase 1 (pedido do Marco em 06/11/2026): o "Dashboard Gerencial" da Linum (um HTML com
// os dados escritos dentro, atualizado à mão) dentro do app, só para o Dono e a equipe Nervia.
// Fase 1 = extratos do Itaú e do Nubank: Visão geral, Categorias, Lançamentos, Considerações e Importar (OFX/CSV lidos no
// navegador; repetidos pulados pela chave e pelo FITID; regras de classificação; conferência do saldo).
// Mesmas contas do painel antigo: Receita real = créditos e Despesas reais = débitos, SEM as classes neutras
// (Transferência Interna, Aportes, Retiradas). Conta corrente da sócia = Aportes − Retiradas.
// Lê lin_ger_* (RLS: só o Dono); grava pelas funções lin_ger_* (auditoria no servidor). As Considerações são escritas pela
// Nervia pelo SQL do Supabase; aqui só se leem (o HTML é limpo antes de mostrar).
// Usa as globais do index.html (sb, $, esc, checar, msg, brl, n, dataBR, hoje, todas, semAc, quando, decBR, numBR).

const GER_NEUTRAS = ["Transferência Interna", "Aportes", "Retiradas"];
const GER_CONTAS = { itau: "Itaú", nubank: "Nubank", socia: "Fora do banco" };
const GER_BANCOS = { itau: "Itaú", nubank: "Nubank" };   // os que têm extrato para importar
const GER_MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const GER_CORES = ["#107e99", "#0b2545", "#c9a227", "#b3261e", "#2e6b3a", "#8a6fb0", "#b5651d", "#5fa8bd", "#d98c8c", "#4f5f73", "#a3c9d4", "#7a8b99"];
let GER = null;   // {lanc, regras, imps, cons, lido}
const FGE = { ano: null, mes: "", conta: "", q: "", classe: "", tipo: "", revisar: false, abertos: new Set() };
const GER_SEL = new Set();
let GER_IMP = null;   // importação em preparação {conta, arquivo, linhas, saldo_final, saldo_data}
let GER_CH = [];

const gNeutra = c => GER_NEUTRAS.includes(c);
const gValor = l => Number(l.credito) - Number(l.debito);
const gMesTxt = am => { const [a, m] = am.split("-"); return GER_MESES[Number(m) - 1].slice(0, 3) + "/" + a.slice(2); };
const gMesLongo = am => { const [a, m] = am.split("-"); return GER_MESES[Number(m) - 1] + " / " + a; };
const gPct = (a, b) => b ? decBR((100 * a / b).toFixed(1)) + "%" : "—";

(function gerEstilo() {
  const s = document.createElement("style");
  s.textContent = `
.gbox{display:flex;flex-wrap:wrap;gap:6px 22px;align-items:center;border:1px dashed var(--border);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:13px}
.gbox b.t{font-size:11.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--ink-soft)}
.gbox.soc{border-color:#c98a1f;background:#c98a1f14}
.ggraf{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:12px}.ggraf .card{min-width:0}
.ggraf .card{min-height:280px}.ggraf canvas{max-height:250px}
.gpos{color:var(--ok)}.gneg{color:var(--crit)}
tr.gcl{cursor:pointer}tr.gcl:hover td{background:var(--surface-2)}
tr.gsub td{background:var(--surface-2);font-size:12.5px}tr.gsub td:first-child{padding-left:26px}
.gsep td{background:var(--surface-2);font-size:11px;color:var(--ink-faint);font-weight:700;letter-spacing:.04em}
.gdesc{max-width:340px;min-width:160px;white-space:normal;font-size:12.5px;overflow-wrap:anywhere}
.gnovo td{background:var(--ok-bg)}.grep td{opacity:.55}.gtalvez td{background:#c9a22722}
.gcons{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin-bottom:14px}
.gcons .gch{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;border-bottom:2px solid var(--border);padding-bottom:9px;margin-bottom:12px}
.gcons .gch h3{margin:0;font-size:17px}
.gnota{padding:3px 12px;border-radius:999px;font-size:12.5px;font-weight:800;color:#fff}
.gnota.A{background:#1d7f46}.gnota.B{background:#6f9b2e}.gnota.C{background:#c98a1f}.gnota.D{background:#b3261e}
.gmets{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:10px}
.gmet{background:var(--surface-2);border-radius:8px;padding:9px 10px;text-align:center}
.gmet b{display:block;font-size:15.5px}.gmet small{font-size:10.5px;color:var(--ink-faint);text-transform:uppercase;font-weight:700;letter-spacing:.03em}
.gmet.pos b{color:var(--ok)}.gmet.neg b{color:var(--crit)}.gmet.ins b{color:#b5751f}.gmet.neu b{color:var(--ink-soft)}
.gcorpo h4{margin:12px 0 5px;font-size:13.5px}.gcorpo p,.gcorpo li{font-size:13.5px;line-height:1.6;color:var(--ink-soft)}.gcorpo ul{padding-left:20px;margin:4px 0}
.gcorpo .cons-alert,.gcorpo .cons-positivo,.gcorpo .cons-negativo{border-left:4px solid #c98a1f;background:#c98a1f18;padding:8px 12px;border-radius:0 8px 8px 0;font-size:13px;margin-top:8px}
.gcorpo .cons-positivo{border-color:var(--ok);background:var(--ok-bg)}.gcorpo .cons-negativo{border-color:var(--crit);background:var(--crit-bg)}
.gcons.final{background:linear-gradient(135deg,#0b2545,#123a5f);color:#fff;border:0}
.gcons.final .gch{border-color:#ffffff33}.gcons.final .gcorpo p,.gcons.final .gcorpo li,.gcons.final .mut{color:#ffffffdd}
.gcons.final .gmet{background:#ffffff14}.gcons.final .gmet small{color:#ffffffaa}
.gcorpo .cons-scores{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:12px 0}
.gcorpo .cons-score{background:#ffffff14;border-radius:8px;padding:10px;text-align:center}.gcorpo .cons-score-val{font-size:20px;font-weight:800}
.gcorpo .cons-score-lbl{font-size:10.5px;text-transform:uppercase;opacity:.75;font-weight:700}
.gcorpo .periodo-badge{display:inline-block;padding:3px 11px;border-radius:999px;font-size:12px;font-weight:700;background:#ffffff22}
@media print{.gcons{break-inside:avoid}.gcons.final{background:#0b2545!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
  document.head.appendChild(s);
})();

// ---------------------------------------------------------------- dados
async function gerCarregar(forcar) {
  if (GER && !forcar && Date.now() - GER.lido < 120000) return;
  const [lanc, regras, imps, cons] = await Promise.all([
    todas(() => sb.from("lin_ger_lancamentos").select("*").order("data").order("id")),
    todas(() => sb.from("lin_ger_regras").select("*").order("prioridade").order("id")),
    todas(() => sb.from("lin_ger_importacoes").select("*").order("id", { ascending: false })),
    todas(() => sb.from("lin_ger_consideracoes").select("*").order("mes"))]);
  GER = { lanc, regras, imps, cons, lido: Date.now() };
  const anos = [...new Set(lanc.map(l => l.data.slice(0, 4)))];
  if (FGE.ano === null) FGE.ano = anos.includes(hoje().slice(0, 4)) ? hoje().slice(0, 4) : "";
}
const gFiltrados = () => GER.lanc.filter(l => (!FGE.ano || l.data.startsWith(FGE.ano)) && (!FGE.mes || l.data.slice(5, 7) === FGE.mes) && (!FGE.conta || l.conta === FGE.conta));
function gTotais(ls) {
  const t = { rec: 0, desp: 0, ins: 0, alu: 0, imp: 0, tiC: 0, tiD: 0, apo: 0, ret: 0, rev: 0 };
  ls.forEach(l => {
    const c = Number(l.credito), d = Number(l.debito);
    if (l.revisar) t.rev++;
    if (l.classe === "Transferência Interna") { t.tiC += c; t.tiD += d; return; }
    if (l.classe === "Aportes" || l.classe === "Retiradas") { t.apo += c; t.ret += d; return; }
    t.rec += c; t.desp += d;
    if (l.classe === "Insumos") t.ins += d;
    if (l.classe === "Aluguel") t.alu += d;
    if (l.classe === "Impostos") t.imp += d;
  });
  t.res = t.rec - t.desp;
  return t;
}
function gPorClasse(ls) {
  const m = {};
  ls.filter(l => !gNeutra(l.classe)).forEach(l => {
    const x = m[l.classe] = m[l.classe] || { c: 0, d: 0, n: 0, sub: {} };
    x.c += Number(l.credito); x.d += Number(l.debito); x.n++;
    const k = l.classificacao || "(sem classificação)", s = x.sub[k] = x.sub[k] || { c: 0, d: 0, n: 0 };
    s.c += Number(l.credito); s.d += Number(l.debito); s.n++;
  });
  return m;
}
// positivos primeiro (maior → menor), depois os negativos (mais negativo primeiro), como no painel antigo
const gOrdemSaldo = ents => ents.map(([k, v]) => ({ k, v, s: v.c - v.d })).sort((a, b) => (a.s >= 0) !== (b.s >= 0) ? (a.s >= 0 ? -1 : 1) : a.s >= 0 ? b.s - a.s : a.s - b.s);

// ---------------------------------------------------------------- gráficos (Chart.js só quando o Gerencial abre)
let GER_CHART = null;
function gerChartJs() {
  if (window.Chart) return Promise.resolve(true);
  if (!GER_CHART) GER_CHART = new Promise(ok => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
    s.onload = () => ok(true); s.onerror = () => { GER_CHART = null; ok(false); };
    document.head.appendChild(s);
  });
  return GER_CHART;
}
function gGraf(id, cfg) {
  const el = $(id);
  if (!el || !window.Chart) return;
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false }, cfg.options || {});
  GER_CH.push(new Chart(el, cfg));
}
const gEixo = { ticks: { callback: v => "R$ " + (Math.abs(v) >= 1000 ? (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + " mil" : v) } };
const gTip = { callbacks: { label: c => " " + (c.dataset.label ? c.dataset.label + ": " : "") + brl(c.raw) } };

// ---------------------------------------------------------------- moldura comum (filtros, pendências)
function gFiltrosHtml(extra = "") {
  const anos = [...new Set(GER.lanc.map(l => l.data.slice(0, 4)))].sort().reverse();
  return `<div class="filtros">
    <select id="gano" aria-label="Ano"><option value="">Todos os anos</option>${anos.map(a => `<option ${a === FGE.ano ? "selected" : ""}>${a}</option>`).join("")}</select>
    <select id="gmes" aria-label="Mês"><option value="">Todos os meses</option>${GER_MESES.map((m, i) => { const v = String(i + 1).padStart(2, "0"); return `<option value="${v}" ${v === FGE.mes ? "selected" : ""}>${m}</option>`; }).join("")}</select>
    <select id="gconta" aria-label="Conta"><option value="">Itaú + Nubank</option>${Object.entries(GER_CONTAS).map(([k, t]) => `<option value="${k}" ${k === FGE.conta ? "selected" : ""}>${t}</option>`).join("")}</select>
    ${extra}</div>`;
}
function gFiltrosLigar(fn) {
  $("gano").onchange = e => { FGE.ano = e.target.value; fn(); };
  $("gmes").onchange = e => { FGE.mes = e.target.value; fn(); };
  $("gconta").onchange = e => { FGE.conta = e.target.value; fn(); };
}
function gPeriodo(ls) {
  if (!ls.length) return "sem lançamentos";
  const ds = ls.map(l => l.data).sort();
  return dataBR(ds[0]) + " a " + dataBR(ds[ds.length - 1]);
}
function gAvisos() {
  const rev = GER.lanc.filter(l => l.revisar).length;
  const ult = GER.imps[0];
  const ultima = Object.keys(GER_BANCOS).map(c => { const l = GER.lanc.filter(x => x.conta === c); return l.length ? `${GER_CONTAS[c]} até ${dataBR(l[l.length - 1].data)}` : ""; }).filter(Boolean).join(" · ");
  return `<div class="mut" style="margin:-2px 0 10px">${ultima ? "Extratos: " + esc(ultima) : "Nenhum extrato importado ainda."}${ult ? ` · última importação ${quando(ult.criado_em)} por ${esc(ult.criado_nome || "—")}` : ""}</div>
    ${rev ? `<div class="msg info noprint" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span><b>${n(rev)} lançamento(s) a classificar.</b> Até serem classificados contam como despesa/receita na classe “A classificar”.</span><button type="button" class="bt" id="girrev">Classificar agora</button></div>` : ""}`;
}
function gAvisosLigar() {
  const b = $("girrev");
  if (b) b.onclick = () => { FGE.revisar = true; FGE.ano = ""; FGE.mes = ""; FGE.conta = ""; irPara("ger_lanc"); };
}
async function telaGerencial(sub) {
  GER_CH.forEach(c => c.destroy()); GER_CH = [];
  if (!GER) $("tela").innerHTML = '<div class="card">Carregando…</div>';
  const vista = VISTA;
  try { await Promise.all([gerCarregar(), sub === "geral" || sub === "cat" ? gerChartJs() : null]); }
  catch (e) { if (VISTA === vista) $("tela").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  if (VISTA !== vista) return;   // trocou de aba enquanto carregava
  ({ geral: gerGeral, cat: gerCategorias, lanc: gerLancamentos, cons: gerConsideracoes, imp: gerImportar })[sub]();
}

// ---------------------------------------------------------------- Visão geral
function gerGeral() {
  const ls = gFiltrados(), t = gTotais(ls), soc = t.apo - t.ret;
  const mm = {};
  ls.filter(l => !gNeutra(l.classe)).forEach(l => { const k = l.data.slice(0, 7); (mm[k] = mm[k] || { c: 0, d: 0 }); mm[k].c += Number(l.credito); mm[k].d += Number(l.debito); });
  const meses = Object.keys(mm).sort();
  const cm = gPorClasse(ls), desp = Object.entries(cm).filter(([, v]) => v.d > 0).sort((a, b) => b[1].d - a[1].d);
  const ord = gOrdemSaldo(Object.entries(cm));
  $("tela").innerHTML = `
    <div class="cabtela"><h2>Gerencial · Visão geral</h2><span class="noprint"><button class="bt" id="gimp">Imprimir</button></span></div>
    ${gAvisos()}
    ${gFiltrosHtml()}
    <div class="mut" style="margin-bottom:8px">Período: ${esc(gPeriodo(ls))}. Itaú e Nubank somados; as vendas das duas lojas caem juntas no Itaú (por loja, só pela maquininha, na próxima fase).</div>
    <div class="kpis">
      <div class="kpi"><small>Receita real</small><b class="gpos">${brl(t.rec)}</b><span>recebido nas contas</span></div>
      <div class="kpi"><small>Despesas reais</small><b class="gneg">${brl(t.desp)}</b><span>pagamentos efetivos</span></div>
      <div class="kpi"><small>Resultado</small><b class="${t.res >= 0 ? "gpos" : "gneg"}">${brl(t.res)}</b><span>margem ${gPct(t.res, t.rec)}</span></div>
      <div class="kpi"><small>Insumos</small><b>${brl(t.ins)}</b><span>${gPct(t.ins, t.desp)} das despesas</span></div>
      <div class="kpi"><small>Aluguel</small><b>${brl(t.alu)}</b><span>${gPct(t.alu, t.desp)} das despesas</span></div>
      <div class="kpi"><small>Impostos</small><b>${brl(t.imp)}</b><span>${gPct(t.imp, t.desp)} das despesas</span></div>
    </div>
    <div class="gbox"><b class="t">Transferências internas (Itaú ↔ Nubank) — fora do resultado</b><span>Créditos: <b>${brl(t.tiC)}</b></span><span>Débitos: <b>${brl(t.tiD)}</b></span><span>Diferença: <b class="${t.tiC - t.tiD >= 0 ? "gpos" : "gneg"}">${brl(t.tiC - t.tiD)}</b></span></div>
    <div class="gbox soc"><b class="t">Conta corrente da sócia — fora do resultado</b><span>Aportes: <b class="gpos">${brl(t.apo)}</b></span><span>Retiradas: <b class="gneg">${brl(t.ret)}</b></span><span>Saldo: <b class="${soc >= 0 ? "gpos" : "gneg"}">${brl(soc)}</b> <span class="mut">${soc >= 0 ? "a empresa deve devolver à sócia" : "retirado além do aportado (a favor da empresa)"}</span></span></div>
    ${window.Chart ? `<div class="ggraf">
      <div class="card"><h2>Receita × despesas por mês</h2><canvas id="gc1"></canvas></div>
      <div class="card"><h2>Resultado por mês</h2><canvas id="gc2"></canvas></div>
      <div class="card"><h2>Onde o dinheiro saiu</h2><canvas id="gc3"></canvas></div>
      <div class="card"><h2>Proporção das despesas</h2><canvas id="gc4"></canvas></div></div>`
      : '<div class="msg info">Os gráficos não carregaram (sem acesso ao serviço de gráficos). Os números abaixo estão completos.</div>'}
    <div class="card"><h2>Resultado por classe <span class="mut">· clique para ver os lançamentos</span></h2><div class="tw"><table>
      <thead><tr><th>Classe</th><th class="num">Créditos</th><th class="num">Débitos</th><th class="num">Saldo</th><th class="num">Lançamentos</th></tr></thead><tbody>
      ${gLinhasClasse(ord, false)}
      <tr><td><b>Total</b></td><td class="num"><b>${brl(t.rec)}</b></td><td class="num"><b>${brl(t.desp)}</b></td><td class="num"><b class="${t.res >= 0 ? "gpos" : "gneg"}">${brl(t.res)}</b></td><td></td></tr>
      </tbody></table></div></div>`;
  gFiltrosLigar(gerGeral); gAvisosLigar();
  $("gimp").onclick = () => window.print();
  gLigarClasses(ls);
  if (!window.Chart) return;
  const lab = meses.map(gMesTxt);
  gGraf("gc1", { type: "bar", data: { labels: lab, datasets: [
    { label: "Receita", data: meses.map(m => mm[m].c), backgroundColor: "#1d7f46aa" },
    { label: "Despesas", data: meses.map(m => mm[m].d), backgroundColor: "#b3261eaa" }] },
    options: { plugins: { tooltip: gTip }, scales: { y: gEixo } } });
  const res = meses.map(m => mm[m].c - mm[m].d);
  gGraf("gc2", { type: "bar", data: { labels: lab, datasets: [{ label: "Resultado", data: res, backgroundColor: res.map(v => v >= 0 ? "#107e99aa" : "#b3261eaa") }] },
    options: { plugins: { legend: { display: false }, tooltip: gTip }, scales: { y: gEixo } } });
  gGraf("gc3", { type: "bar", data: { labels: desp.slice(0, 10).map(([k]) => k), datasets: [{ label: "Despesas", data: desp.slice(0, 10).map(([, v]) => v.d), backgroundColor: GER_CORES }] },
    options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: gTip }, scales: { x: gEixo } } });
  gGraf("gc4", { type: "doughnut", data: { labels: desp.slice(0, 9).map(([k]) => k), datasets: [{ data: desp.slice(0, 9).map(([, v]) => v.d), backgroundColor: GER_CORES }] },
    options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 11, font: { size: 11 } } }, tooltip: { callbacks: { label: c => ` ${c.label}: ${brl(c.raw)}` } } } } });
}
function gLinhasClasse(ord, comSub, totDesp) {
  let sep = false;
  return ord.map(({ k, v, s }) => {
    let h = "";
    if (s < 0 && !sep) { sep = true; h += `<tr class="gsep"><td colspan="${comSub ? 6 : 5}">▼ GASTOS (saldo negativo)</td></tr>`; }
    const aberto = comSub && FGE.abertos.has(k);
    h += `<tr class="gcl" data-classe="${esc(k)}"><td>${comSub ? (aberto ? "▾ " : "▸ ") : ""}<b>${esc(k)}</b></td><td class="num gpos">${v.c ? brl(v.c) : "—"}</td><td class="num gneg">${v.d ? brl(v.d) : "—"}</td>
      <td class="num"><b class="${s >= 0 ? "gpos" : "gneg"}">${brl(s)}</b></td>${comSub ? `<td class="num">${v.d ? gPct(v.d, totDesp) : "—"}</td>` : ""}<td class="num">${n(v.n)}</td></tr>`;
    if (aberto) h += gOrdemSaldo(Object.entries(v.sub)).map(x => `<tr class="gsub gcl" data-classe="${esc(k)}" data-clas="${esc(x.k)}"><td>${esc(x.k)}</td><td class="num gpos">${x.v.c ? brl(x.v.c) : "—"}</td><td class="num gneg">${x.v.d ? brl(x.v.d) : "—"}</td>
      <td class="num">${brl(x.s)}</td><td class="num">${x.v.d ? gPct(x.v.d, totDesp) : "—"}</td><td class="num">${n(x.v.n)}</td></tr>`).join("");
    return h;
  }).join("") || `<tr><td colspan="6" class="mut">Nenhum lançamento no período.</td></tr>`;
}
function gLigarClasses(ls, alternar) {
  document.querySelectorAll("tr.gcl").forEach(tr => tr.onclick = () => {
    const c = tr.dataset.classe, s = tr.dataset.clas;
    if (alternar && s === undefined) { FGE.abertos.has(c) ? FGE.abertos.delete(c) : FGE.abertos.add(c); alternar(); return; }
    gLista(ls.filter(l => l.classe === c && (s === undefined || (l.classificacao || "(sem classificação)") === s)), s === undefined ? c : c + " · " + s);
  });
}
function gLista(ls, titulo) {
  const tot = ls.reduce((a, l) => a + gValor(l), 0);
  $("dlgf").innerHTML = `<h3>${esc(titulo)}</h3><div class="mut">${n(ls.length)} lançamento(s) · ${esc(gPeriodo(ls))} · total ${brl(tot)}</div>
    <div class="tw" style="max-height:60vh;margin-top:8px"><table><thead><tr><th>Data</th><th>Descrição</th><th>Classificação</th><th>Conta</th><th class="num">Valor</th></tr></thead><tbody>
    ${ls.map(l => `<tr><td>${dataBR(l.data)}</td><td class="gdesc">${esc(l.descricao)}</td><td>${esc(l.classificacao)}</td><td>${GER_CONTAS[l.conta]}</td><td class="num ${gValor(l) >= 0 ? "gpos" : "gneg"}">${brl(gValor(l))}</td></tr>`).join("")}
    </tbody></table></div><div class="acoes"><button type="button" class="bt pri" id="glx">Fechar</button></div>`;
  $("glx").onclick = () => $("dlg").close();
  $("dlg").classList.add("largo"); $("dlg").showModal();
}

// ---------------------------------------------------------------- Categorias
function gerCategorias() {
  const ls = gFiltrados(), cm = gPorClasse(ls);
  const totDesp = Object.values(cm).reduce((a, v) => a + v.d, 0);
  const ord = gOrdemSaldo(Object.entries(cm));
  const top = Object.entries(cm).filter(([, v]) => v.d > 0).sort((a, b) => b[1].d - a[1].d);
  $("tela").innerHTML = `
    <div class="cabtela"><h2>Gerencial · Categorias</h2><span class="noprint"><button class="bt" id="gimp">Imprimir</button></span></div>
    ${gAvisos()}${gFiltrosHtml()}
    <div class="kpis">${top.slice(0, 5).map(([k, v], i) => `<div class="kpi" style="border-top:3px solid ${GER_CORES[i]}"><small>${i + 1}. ${esc(k)}</small><b>${brl(v.d)}</b><span>${gPct(v.d, totDesp)} das despesas</span></div>`).join("")}</div>
    ${window.Chart && top.length ? `<div class="ggraf"><div class="card"><h2>Saldo por classe</h2><canvas id="gc5"></canvas></div><div class="card"><h2>% das despesas</h2><canvas id="gc6"></canvas></div></div>` : ""}
    <div class="card"><h2>Classes e classificações <span class="mut">· clique na classe para abrir; na classificação, para ver os lançamentos</span></h2><div class="tw"><table>
      <thead><tr><th>Classe / classificação</th><th class="num">Créditos</th><th class="num">Débitos</th><th class="num">Saldo</th><th class="num">% desp.</th><th class="num">Qtd</th></tr></thead>
      <tbody>${gLinhasClasse(ord, true, totDesp)}</tbody></table></div>
      <div class="mut" style="margin-top:6px">Sem Transferência Interna, Aportes e Retiradas (não são receita nem despesa).</div></div>`;
  gFiltrosLigar(gerCategorias); gAvisosLigar();
  $("gimp").onclick = () => window.print();
  gLigarClasses(ls, gerCategorias);
  if (!window.Chart || !top.length) return;
  gGraf("gc5", { type: "bar", data: { labels: ord.map(x => x.k), datasets: [{ label: "Saldo", data: ord.map(x => x.s), backgroundColor: ord.map(x => x.s >= 0 ? "#1d7f46aa" : "#b3261eaa") }] },
    options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: gTip }, scales: { x: gEixo } } });
  gGraf("gc6", { type: "doughnut", data: { labels: top.slice(0, 8).map(([k]) => k), datasets: [{ data: top.slice(0, 8).map(([, v]) => v.d), backgroundColor: GER_CORES }] },
    options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 11, font: { size: 11 } } }, tooltip: { callbacks: { label: c => ` ${c.label}: ${brl(c.raw)} (${gPct(c.raw, totDesp)})` } } } } });
}

// ---------------------------------------------------------------- Lançamentos (classificar, excluir, CSV)
const gClasses = () => [...new Set(GER.lanc.map(l => l.classe).concat(GER.regras.map(r => r.classe)).filter(c => c && c !== "A classificar"))].sort((a, b) => a.localeCompare(b, "pt-BR"));
const gClassifs = classe => [...new Set(GER.lanc.filter(l => !classe || l.classe === classe).map(l => l.classificacao).concat(GER.regras.filter(r => !classe || r.classe === classe).map(r => r.classificacao)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
function gerLancamentos() {
  const q = semAc(FGE.q);
  const ls = gFiltrados().filter(l => (!FGE.classe || l.classe === FGE.classe) && (!FGE.revisar || l.revisar)
      && (!FGE.tipo || (FGE.tipo === "c" ? Number(l.credito) > 0 : Number(l.debito) > 0))
      && (!q || semAc(l.descricao + " " + l.classificacao + " " + l.classe + " " + l.observacao).includes(q)))
    .sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
  [...GER_SEL].forEach(id => { if (!ls.some(l => l.id === id)) GER_SEL.delete(id); });
  const t = gTotais(ls);
  const MAX = 1500, vis = ls.slice(0, MAX);
  $("tela").innerHTML = `
    <div class="cabtela"><h2>Gerencial · Lançamentos</h2><span class="noprint" style="display:flex;gap:8px"><button class="bt" id="gman">+ Fora do banco</button><button class="bt" id="gcsv">Baixar CSV</button><button class="bt" id="gimp">Imprimir</button></span></div>
    ${gAvisos()}
    ${gFiltrosHtml(`<input type="search" id="gq" placeholder="Buscar na descrição" value="${esc(FGE.q)}">
      <select id="gcl" aria-label="Classe"><option value="">Todas as classes</option>${["A classificar", ...gClasses()].map(c => `<option ${c === FGE.classe ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <select id="gtp" aria-label="Tipo"><option value="">Créditos e débitos</option><option value="c" ${FGE.tipo === "c" ? "selected" : ""}>Só créditos</option><option value="d" ${FGE.tipo === "d" ? "selected" : ""}>Só débitos</option></select>
      <label class="chk"><input type="checkbox" id="grev" ${FGE.revisar ? "checked" : ""}> Só a classificar</label>`)}
    <div class="mut" style="margin-bottom:8px">${n(ls.length)} lançamento(s) · receita ${brl(t.rec)} · despesas ${brl(t.desp)} · resultado <b class="${t.res >= 0 ? "gpos" : "gneg"}">${brl(t.res)}</b> (sem transferências, aportes e retiradas)</div>
    <div class="acoes noprint" style="justify-content:flex-start;margin:0 0 8px"><button type="button" class="bt pri" id="gclass" ${GER_SEL.size ? "" : "disabled"}>Classificar marcados (${n(GER_SEL.size)})</button></div>
    <div class="card"><div class="tw"><table><thead><tr><th class="noprint"><input type="checkbox" id="gtodos" aria-label="Marcar todos"></th><th>Data</th><th>Descrição do extrato</th><th>Classificação</th><th>Classe</th><th>Conta</th><th class="num">Valor</th></tr></thead><tbody>
    ${vis.map(l => `<tr data-id="${l.id}" class="glin" style="cursor:pointer"><td class="noprint"><input type="checkbox" class="gsel" data-id="${l.id}" ${GER_SEL.has(l.id) ? "checked" : ""}></td><td>${dataBR(l.data)}</td>
      <td class="gdesc">${esc(l.descricao)}${l.observacao ? `<div class="mut">${esc(l.observacao)}</div>` : ""}</td><td>${esc(l.classificacao)}</td>
      <td>${l.revisar ? '<span class="tag fora">a classificar</span>' : esc(l.classe)}</td><td>${GER_CONTAS[l.conta]}</td>
      <td class="num ${gValor(l) >= 0 ? "gpos" : "gneg"}">${brl(gValor(l))}</td></tr>`).join("") || '<tr><td colspan="7" class="mut">Nenhum lançamento.</td></tr>'}
    </tbody></table></div>${ls.length > MAX ? `<div class="mut">Mostrando os ${n(MAX)} mais recentes; use os filtros para ver os outros (o CSV leva todos).</div>` : ""}</div>`;
  gFiltrosLigar(gerLancamentos); gAvisosLigar();
  $("gq").oninput = e => { FGE.q = e.target.value; clearTimeout(gerLancamentos.t); gerLancamentos.t = setTimeout(() => { if (VISTA !== "ger_lanc") return; gerLancamentos(); const i = $("gq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 350); };
  $("gcl").onchange = e => { FGE.classe = e.target.value; gerLancamentos(); };
  $("gtp").onchange = e => { FGE.tipo = e.target.value; gerLancamentos(); };
  $("grev").onchange = e => { FGE.revisar = e.target.checked; gerLancamentos(); };
  $("gimp").onclick = () => window.print();
  $("gtodos").onchange = e => { vis.forEach(l => e.target.checked ? GER_SEL.add(l.id) : GER_SEL.delete(l.id)); gerLancamentos(); };
  document.querySelectorAll(".gsel").forEach(c => { c.onclick = e => e.stopPropagation(); c.onchange = () => { c.checked ? GER_SEL.add(Number(c.dataset.id)) : GER_SEL.delete(Number(c.dataset.id)); $("gclass").disabled = !GER_SEL.size; $("gclass").textContent = `Classificar marcados (${n(GER_SEL.size)})`; }; });
  document.querySelectorAll(".glin").forEach(tr => tr.onclick = () => gEditar(GER.lanc.find(l => l.id === Number(tr.dataset.id))));
  $("gclass").onclick = () => gClassificar(GER.lanc.filter(l => GER_SEL.has(l.id)));
  $("gman").onclick = gForaDoBanco;
  $("gcsv").onclick = () => {
    const c = x => `"${String(x ?? "").replace(/"/g, '""')}"`, num = x => Number(x).toFixed(2).replace(".", ",");
    const l = [["Data", "Conta", "Descrição", "Classe", "Classificação", "Crédito", "Débito", "Valor", "Observação", "A classificar"].map(c).join(";"),
      ...ls.map(x => [dataBR(x.data), GER_CONTAS[x.conta], x.descricao, x.classe, x.classificacao, num(x.credito), num(x.debito), num(gValor(x)), x.observacao, x.revisar ? "sim" : ""].map(c).join(";"))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + l.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `linum-lancamentos-${FGE.ano || "todos"}${FGE.mes ? "-" + FGE.mes : ""}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}
// classificar um ou vários; opcional: criar a regra para os próximos extratos
function gClassificar(ls, depois) {
  if (!ls.length) return;
  const um = ls.length === 1 ? ls[0] : null;
  const sug = um && !um.revisar ? um : null;
  $("dlgf").innerHTML = `<h3>Classificar ${um ? "lançamento" : n(ls.length) + " lançamentos"}</h3>
    ${um ? `<div class="mut">${dataBR(um.data)} · ${GER_CONTAS[um.conta]} · <b>${brl(gValor(um))}</b><br>${esc(um.descricao)}</div>` : `<div class="mut">Total ${brl(ls.reduce((a, l) => a + gValor(l), 0))}</div>`}
    <datalist id="gdlc">${gClasses().map(c => `<option value="${esc(c)}">`).join("")}</datalist><datalist id="gdls"></datalist>
    <label class="campo">Classe<input id="gfc" list="gdlc" value="${esc(sug ? sug.classe : "")}" placeholder="ex.: Insumos, Salários, Receitas, Retiradas"></label>
    <label class="campo">Classificação<input id="gfs" list="gdls" value="${esc(sug ? sug.classificacao : "")}" placeholder="ex.: Costureira, Aluguel Gávea"></label>
    ${um ? `<label class="campo">Observação<input id="gfo" value="${esc(um.observacao)}" maxlength="300"></label>` : ""}
    <label class="chk campo"><input type="checkbox" id="gfr"> Criar regra: classificar assim os próximos extratos que tiverem o trecho</label>
    <input id="gfp" value="${esc(um ? gTrechoSugerido(um.descricao) : "")}" placeholder="trecho da descrição (ex.: o CPF/CNPJ ou o nome)" style="display:none;margin-top:6px">
    <div class="mut" style="margin-top:6px">Transferência Interna, Aportes e Retiradas ficam fora da receita e da despesa.</div>
    <div id="gferr"></div><div class="acoes"><button type="button" class="bt" id="gfx">Cancelar</button><button type="button" class="bt pri" id="gfok">Salvar</button></div>`;
  const dls = () => { $("gdls").innerHTML = gClassifs($("gfc").value.trim()).map(c => `<option value="${esc(c)}">`).join(""); };
  $("gfc").oninput = dls; dls();
  $("gfr").onchange = e => { $("gfp").style.display = e.target.checked ? "" : "none"; };
  $("gfx").onclick = () => $("dlg").close();
  $("gfok").onclick = async () => {
    const classe = $("gfc").value.trim(), clas = $("gfs").value.trim();
    try {
      $("gfok").disabled = true;
      if ($("gfr").checked) {
        const tipo = ls.every(l => Number(l.credito) > 0) ? "credito" : ls.every(l => Number(l.debito) > 0) ? "debito" : "";
        checar(await sb.rpc("lin_ger_regra_salvar", { p: { padrao: $("gfp").value.trim(), classe, classificacao: clas, tipo } }));
      }
      const p = { ids: ls.map(l => l.id), classe, classificacao: clas };
      if (um) p.observacao = $("gfo").value;
      checar(await sb.rpc("lin_ger_classificar", { p }));
      $("dlg").close(); GER_SEL.clear();
      await gerCarregar(true);
      msg("ok", `${n(ls.length)} lançamento(s) classificado(s) em ${classe}${clas ? " · " + clas : ""}.`);
      (depois || gerLancamentos)();
    } catch (e) { $("gfok").disabled = false; $("gferr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
  $("dlg").classList.remove("largo"); $("dlg").showModal();
}
// trecho para a regra: o CPF/CNPJ se houver; senão as palavras do meio (sem datas e números soltos)
function gTrechoSugerido(d) {
  const doc = gDoc(d);
  if (doc) return doc;
  return String(d || "").replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, " ").replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}
// CPF/CNPJ (inteiro ou mascarado, como ••• .212.167-••) para reconhecer a mesma pessoa em outros extratos
function gDoc(d) {
  const s = String(d || "");
  const m = s.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/) || s.match(/\d{3}\.\d{3}\.\d{3}-\d{2}/) || s.match(/[•*]{3}\.(\d{3}\.\d{3})-[•*]{2}/);
  return m ? (m[1] || m[0]) : "";
}
// lançamento que não passa pelo banco (ex.: a sócia pagou uma conta da empresa com dinheiro dela = Aporte)
function gForaDoBanco() {
  $("dlgf").innerHTML = `<h3>Lançamento fora do banco</h3>
    <div class="mut">Para o que não aparece no extrato do Itaú nem do Nubank. Exemplo: a sócia pagou uma conta da Linum com dinheiro dela (classe Aportes). Valor positivo = entrou; negativo = saiu.</div>
    <datalist id="gdlc">${gClasses().map(c => `<option value="${esc(c)}">`).join("")}</datalist><datalist id="gdls"></datalist>
    <label class="campo">Data<input id="gmd" type="date" max="${hoje()}" value="${hoje()}"></label>
    <label class="campo">Descrição<input id="gmt" maxlength="300"></label>
    <label class="campo">Valor (R$)<input id="gmv" inputmode="decimal" placeholder="ex.: 10.610,00 ou -250,00"></label>
    <label class="campo">Classe<input id="gfc" list="gdlc" placeholder="ex.: Aportes"></label>
    <label class="campo">Classificação<input id="gfs" list="gdls"></label>
    <label class="campo">Por que não está no extrato?<input id="gmo" maxlength="300"></label>
    <div id="gferr"></div><div class="acoes"><button type="button" class="bt" id="gfx">Cancelar</button><button type="button" class="bt pri" id="gfok">Salvar</button></div>`;
  const dls = () => { $("gdls").innerHTML = gClassifs($("gfc").value.trim()).map(c => `<option value="${esc(c)}">`).join(""); };
  $("gfc").oninput = dls; dls();
  $("gfx").onclick = () => $("dlg").close();
  $("gfok").onclick = async () => {
    try {
      $("gfok").disabled = true;
      checar(await sb.rpc("lin_ger_lancamento_incluir", { p: { data: $("gmd").value, descricao: $("gmt").value, valor: numBR($("gmv").value), classe: $("gfc").value.trim(),
        classificacao: $("gfs").value.trim(), observacao: $("gmo").value } }));
      $("dlg").close(); await gerCarregar(true); msg("ok", "Lançamento fora do banco incluído."); gerLancamentos();
    } catch (e) { $("gfok").disabled = false; $("gferr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
  $("dlg").classList.remove("largo"); $("dlg").showModal();
}
function gEditar(l) {
  if (!l) return;
  $("dlgf").innerHTML = `<h3>Lançamento</h3><div class="mut">${dataBR(l.data)} · ${GER_CONTAS[l.conta]} · <b>${brl(gValor(l))}</b></div>
    <p style="margin:8px 0">${esc(l.descricao)}</p>
    <div class="mut">Classe: <b>${esc(l.classe)}</b>${l.classificacao ? " · " + esc(l.classificacao) : ""}${l.observacao ? "<br>Observação: " + esc(l.observacao) : ""}<br>
      Importado em ${quando(l.criado_em)} por ${esc(l.criado_nome || "—")}${l.alterado_em ? ` · alterado em ${quando(l.alterado_em)} por ${esc(l.alterado_nome)}` : ""}</div>
    <div id="gerr"></div><div class="acoes"><button type="button" class="bt" id="gex">Excluir…</button><button type="button" class="bt" id="gfx2">Fechar</button><button type="button" class="bt pri" id="gecl">Classificar</button></div>`;
  $("gfx2").onclick = () => $("dlg").close();
  $("gecl").onclick = () => { $("dlg").close(); gClassificar([l]); };
  $("gex").onclick = async () => {
    const m = prompt("Excluir este lançamento do Gerencial? (ex.: transferência que falhou e foi estornada)\nEscreva o motivo:");
    if (m === null) return;
    try { checar(await sb.rpc("lin_ger_lancamento_excluir", { p_id: l.id, p_motivo: m })); $("dlg").close(); await gerCarregar(true); msg("ok", "Lançamento excluído (fica registrado no histórico de alterações)."); gerLancamentos(); }
    catch (e) { $("gerr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
  $("dlg").classList.remove("largo"); $("dlg").showModal();
}

// ---------------------------------------------------------------- Considerações (escritas pela Nervia; só leitura)
const G_TAGS = new Set(["P", "UL", "OL", "LI", "STRONG", "B", "EM", "I", "H4", "H5", "BR", "DIV", "SPAN", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "SMALL"]);
function gLimpo(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ""}</div>`, "text/html");
  const limpar = el => [...el.childNodes].forEach(c => {
    if (c.nodeType === 3) return;
    if (c.nodeType !== 1 || !G_TAGS.has(c.tagName)) { if (c.nodeType === 1 && !["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(c.tagName)) c.replaceWith(...c.childNodes); else c.remove(); return limpar(el); }
    [...c.attributes].forEach(a => { if (a.name === "class") { c.setAttribute("class", a.value.split(/\s+/).filter(x => /^(cons|periodo)-[a-z-]+$|^periodo-badge$/.test(x)).join(" ")); } else c.removeAttribute(a.name); });
    limpar(c);
  });
  const raiz = doc.body.firstChild;
  limpar(raiz);
  return raiz.innerHTML;
}
function gerConsideracoes() {
  const vale = c => c.mes === "final" || ((!FGE.ano || c.mes.startsWith(FGE.ano)) && (!FGE.mes || c.mes.slice(5, 7) === FGE.mes));
  const lista = GER.cons.filter(vale).sort((a, b) => a.mes === "final" ? -1 : b.mes === "final" ? 1 : b.mes.localeCompare(a.mes));
  const met = m => `<div class="gmet ${["pos", "neg", "ins", "neu"].includes(m.cor) ? m.cor : ""}"><b>${esc(m.val)}</b><small>${esc(m.rot)}</small></div>`;
  const hojeTxt = c => {
    if (c.mes === "final") return "";
    const ls = GER.lanc.filter(l => l.data.startsWith(c.mes)), t = gTotais(ls);
    return ls.length ? `<div class="mut" style="margin:-4px 0 8px">Hoje, pelos lançamentos do mês: receita ${brl(t.rec)} · despesas ${brl(t.desp)} · resultado ${brl(t.res)} · margem ${gPct(t.res, t.rec)}${t.rev ? ` · <b>${n(t.rev)} a classificar</b>` : ""}</div>` : "";
  };
  $("tela").innerHTML = `
    <div class="cabtela"><h2>Gerencial · Considerações</h2><span class="noprint"><button class="bt" id="gimp">Imprimir</button></span></div>
    ${gAvisos()}${gFiltrosHtml()}
    <div class="mut" style="margin-bottom:10px">Análise de cada mês escrita pela Nervia, com nota de A a D. Os números do quadro são os do dia da análise; logo abaixo, os de hoje pelos lançamentos (mudam se algo for reclassificado). Para uma análise nova ou revisada, peça à Nervia.</div>
    ${lista.map(c => `<div class="gcons ${c.mes === "final" ? "final" : ""}"><div class="gch"><h3>${esc(c.titulo || (c.mes === "final" ? "Avaliação executiva" : gMesLongo(c.mes)))}</h3>
        ${c.nota ? `<span class="gnota ${c.nota}">${c.nota}${c.nota_texto ? " — " + esc(c.nota_texto) : ""}</span>` : ""}</div>
      ${(c.metricas || []).length ? `<div class="gmets">${c.metricas.map(met).join("")}</div>` : ""}
      ${hojeTxt(c)}
      <div class="gcorpo">${gLimpo(c.corpo)}</div>
      <div class="mut" style="margin-top:8px;font-size:11.5px">Escrito por ${esc(c.atualizado_nome || "Nervia")} em ${quando(c.atualizado_em)}</div></div>`).join("")
      || '<div class="card mut">Nenhuma análise para o período escolhido.</div>'}`;
  gFiltrosLigar(gerConsideracoes); gAvisosLigar();
  $("gimp").onclick = () => window.print();
}

// ---------------------------------------------------------------- Importar extratos (OFX do Itaú/Nubank, CSV do Nubank) e regras
async function gLerTexto(f) {
  const buf = await f.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { return new TextDecoder("windows-1252").decode(buf); }
}
const gTag = (b, t) => { const m = b.match(new RegExp("<" + t + ">([^<\\r\\n]*)", "i")); return m ? m[1].trim() : ""; };
const gNum = t => { t = String(t || "").trim(); if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", "."); return Number(t); };
const gData8 = t => /^\d{8}/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : "";
// OFX (SGML ou XML): cada <STMTTRN> vira um lançamento; linhas de saldo ("SALDO …") não são lançamentos
function gLerOfx(txt) {
  const linhas = [];
  (txt.match(/<STMTTRN>[\s\S]*?(<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi) || []).forEach(b => {
    const v = gNum(gTag(b, "TRNAMT")), data = gData8(gTag(b, "DTPOSTED"));
    const memo = gTag(b, "MEMO"), nome = gTag(b, "NAME");
    const desc = (memo && nome && !memo.includes(nome) && !nome.includes(memo) ? nome + " - " + memo : memo || nome).replace(/\s+/g, " ").trim();
    if (!data || !isFinite(v) || v === 0 || /^SALDO\b/i.test(desc)) return;
    linhas.push({ data, descricao: desc, valor: v, fitid: gTag(b, "FITID") });
  });
  const bal = (txt.match(/<LEDGERBAL>[\s\S]*?(<\/LEDGERBAL>|$)/i) || [""])[0];
  const saldo = bal ? gNum(gTag(bal, "BALAMT")) : null;
  return { linhas, saldo_final: isFinite(saldo) && bal ? saldo : null, saldo_data: bal ? gData8(gTag(bal, "DTASOF")) : "" };
}
// separador: o que aparece mais nas primeiras linhas (o relatório pode começar com um título) (Nubank usa vírgula; a Rede, ponto e vírgula com vírgula decimal)
function gCsvLinhas(txt) {
  const l1 = txt.split(/\r?\n/).slice(0, 6).join("\n"), sep = (l1.match(/;/g) || []).length > (l1.match(/,/g) || []).length ? ";" : ",";
  const out = []; let row = [], cel = "", q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) { if (ch === '"') { if (txt[i + 1] === '"') { cel += '"'; i++; } else q = false; } else cel += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cel); cel = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && txt[i + 1] === "\n") i++; row.push(cel); out.push(row); row = []; cel = ""; }
    else cel += ch;
  }
  if (cel || row.length) { row.push(cel); out.push(row); }
  return out.filter(r => r.some(c => c.trim()));
}
// CSV do Nubank (conta): Data,Valor,Identificador,Descrição
function gLerCsvNubank(txt) {
  const rs = gCsvLinhas(txt.replace(/^﻿/, ""));
  const cab = (rs.shift() || []).map(c => semAc(c));
  const iD = cab.findIndex(c => c === "data"), iV = cab.findIndex(c => c === "valor"), iI = cab.findIndex(c => c.startsWith("identificador")), iT = cab.findIndex(c => c.startsWith("descri"));
  if (iD < 0 || iV < 0 || iT < 0) throw new Error("CSV sem as colunas Data, Valor e Descrição (formato do extrato da conta Nubank)");
  return { linhas: rs.map(r => { const [d, m, a] = (r[iD] || "").trim().split("/"); return { data: a && m && d ? `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : "", valor: gNum(r[iV]), descricao: (r[iT] || "").replace(/\s+/g, " ").trim(), fitid: iI >= 0 ? (r[iI] || "").trim() : "" }; })
    .filter(l => l.data && isFinite(l.valor) && l.valor !== 0), saldo_final: null, saldo_data: "" };
}
// chave = conta|data|valor|descrição sem acento|nº da repetição no arquivo (dois Pix iguais no mesmo dia são dois lançamentos)
function gChaves(conta, linhas) {
  const cont = {};
  linhas.forEach(l => { const base = [conta, l.data, l.valor.toFixed(2), semAc(l.descricao)].join("|"); cont[base] = (cont[base] || 0) + 1; l.chave = base + "|" + cont[base]; });
}
// sugestão: 1) regra; 2) o mesmo texto ou o mesmo CPF/CNPJ já classificado antes; 3) a classificar
function gSugerir(conta, l) {
  const d = semAc(l.descricao), tipo = l.valor > 0 ? "credito" : "debito";
  const r = GER.regras.find(r => r.ativo && (!r.conta || r.conta === conta) && (!r.tipo || r.tipo === tipo) && d.includes(semAc(r.padrao)));
  if (r) return { classe: r.classe, classificacao: r.classificacao, regra_id: r.id, origem: "regra “" + r.padrao + "”" };
  const ok = GER.lanc.filter(x => !x.revisar && (Number(x.credito) > 0) === (l.valor > 0));
  const nd = t => semAc(t).replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, "").replace(/\s+/g, " ").trim();
  let p = [...ok].reverse().find(x => nd(x.descricao) === nd(l.descricao));
  if (p) return { classe: p.classe, classificacao: p.classificacao, origem: "igual ao de " + dataBR(p.data) };
  const doc = gDoc(l.descricao);
  if (doc) { p = [...ok].reverse().find(x => x.descricao.includes(doc)); if (p) return { classe: p.classe, classificacao: p.classificacao, origem: "mesmo CPF/CNPJ de " + dataBR(p.data) }; }
  return { classe: "", classificacao: "", origem: "" };
}
async function gArquivo(f, conta) {
  const txt = await gLerTexto(f);
  const r = /<OFX>|OFXHEADER|<STMTTRN>/i.test(txt) ? gLerOfx(txt) : gLerCsvNubank(txt);
  if (!r.linhas.length) throw new Error("Nenhum lançamento encontrado no arquivo (é o extrato OFX do Itaú/Nubank ou o CSV da conta Nubank?)");
  gChaves(conta, r.linhas);
  // já importado? pela chave/FITID = certo; mesma data e valor na mesma conta = talvez (descrição mudou de formato)
  const chaves = new Set(GER.lanc.map(l => l.chave)), fitids = new Set(GER.lanc.filter(l => l.conta === conta && l.fitid).map(l => l.fitid));
  const sobra = {};
  GER.lanc.filter(l => l.conta === conta).forEach(l => { const k = l.data + "|" + gValor(l).toFixed(2); sobra[k] = (sobra[k] || 0) + 1; });
  r.linhas.forEach(l => { if (chaves.has(l.chave) || (l.fitid && fitids.has(l.fitid))) { l.sit = "existe"; const k = l.data + "|" + l.valor.toFixed(2); if (sobra[k]) sobra[k]--; } });
  r.linhas.forEach(l => {
    if (l.sit) return;
    const k = l.data + "|" + l.valor.toFixed(2);
    if (sobra[k]) { sobra[k]--; l.sit = "talvez"; l.marcado = false; } else { l.sit = "novo"; l.marcado = true; }
    Object.assign(l, gSugerir(conta, l));
  });
  r.linhas.sort((a, b) => a.data.localeCompare(b.data));
  GER_IMP = { conta, arquivo: f.name, ...r };
}
// conferência do saldo: saldo anterior conhecido + movimentos (os do banco e os novos marcados) = saldo do extrato?
function gConferirSaldo() {
  const I = GER_IMP;
  if (I.saldo_final == null || !I.saldo_data) return "";
  const ant = GER.imps.filter(x => x.conta === I.conta && x.saldo_final != null && x.saldo_data && x.saldo_data < I.saldo_data).sort((a, b) => b.saldo_data.localeCompare(a.saldo_data))[0];
  const txt = `Saldo informado no extrato em ${dataBR(I.saldo_data)}: <b>${brl(I.saldo_final)}</b>.`;
  if (!ant) return `<div class="msg info">${txt} Não há saldo anterior registrado desta conta para conferir; ele fica guardado para conferir o próximo extrato.</div>`;
  const mov = GER.lanc.filter(l => l.conta === I.conta && l.data > ant.saldo_data && l.data <= I.saldo_data).reduce((a, l) => a + gValor(l), 0)
    + I.linhas.filter(l => l.marcado && l.data > ant.saldo_data && l.data <= I.saldo_data).reduce((a, l) => a + l.valor, 0);
  const calc = Number(ant.saldo_final) + mov, dif = Math.round((Number(I.saldo_final) - calc) * 100) / 100;
  return `<div class="msg ${Math.abs(dif) < 1 ? "ok" : "err"}" style="white-space:normal">${txt} Saldo anterior ${brl(ant.saldo_final)} (${dataBR(ant.saldo_data)}) + movimentos ${brl(mov)} = <b>${brl(calc)}</b>${Math.abs(dif) < 0.005 ? " — confere." : ` — diferença de <b>${brl(dif)}</b>${Math.abs(dif) < 1 ? " (arredondamento ou rendimento do dia)" : ": confira se falta ou sobra lançamento (marque/desmarque os “talvez já importado”)"}.`}</div>`;
}
function gerImportar() {
  const I = GER_IMP;
  const sit = { novo: '<span class="tag ok">novo</span>', talvez: '<span class="tag possivel">talvez já importado</span>', existe: '<span class="tag">já importado</span>' };
  const marc = I ? I.linhas.filter(l => l.marcado) : [];
  $("tela").innerHTML = `
    <div class="cabtela"><h2>Gerencial · Importar extratos</h2></div>
    <div class="card"><h2>1. Escolha a conta e o arquivo</h2>
      <div class="filtros" style="margin:0">
        <select id="gicta"><option value="">Conta do extrato…</option>${Object.entries(GER_BANCOS).map(([k, t]) => `<option value="${k}" ${I && I.conta === k ? "selected" : ""}>${t}</option>`).join("")}</select>
        <input type="file" id="giarq" accept=".ofx,.csv,.txt">
      </div>
      <div class="mut" style="margin-top:6px">Itaú: extrato em <b>OFX</b> (Internet Banking → Extrato → Salvar em OFX/Money). Nubank: <b>OFX</b> ou o <b>CSV</b> da conta. Pode importar um mês já começado: depois, o mês inteiro; o que já entrou é pulado sozinho. O arquivo é lido no seu computador; só os lançamentos vão para o sistema.</div>
      <div id="gierr"></div></div>
    ${I ? `<div class="card"><h2>2. Confira — ${esc(I.arquivo)} (${GER_CONTAS[I.conta]})</h2>
      <div class="kpis"><div class="kpi"><small>No arquivo</small><b>${n(I.linhas.length)}</b><span>${dataBR(I.linhas[0].data)} a ${dataBR(I.linhas[I.linhas.length - 1].data)}</span></div>
        <div class="kpi"><small>Novos</small><b>${n(I.linhas.filter(l => l.sit === "novo").length)}</b><span>vão entrar</span></div>
        <div class="kpi"><small>Talvez já importados</small><b>${n(I.linhas.filter(l => l.sit === "talvez").length)}</b><span>mesma data e valor; desmarcados</span></div>
        <div class="kpi"><small>Já importados</small><b>${n(I.linhas.filter(l => l.sit === "existe").length)}</b><span>pulados</span></div>
        <div class="kpi"><small>A importar</small><b>${n(marc.length)}</b><span>${n(marc.filter(l => !l.classe).length)} sem classe</span></div></div>
      ${gConferirSaldo()}
      <datalist id="gdlc">${gClasses().map(c => `<option value="${esc(c)}">`).join("")}</datalist><datalist id="gdla">${gClassifs("").map(c => `<option value="${esc(c)}">`).join("")}</datalist>
      <div class="tw" style="max-height:60vh"><table><thead><tr><th></th><th>Data</th><th>Descrição</th><th class="num">Valor</th><th>Classe</th><th>Classificação</th><th>Situação</th></tr></thead><tbody>
      ${I.linhas.map((l, i) => `<tr class="${l.sit === "novo" ? "" : l.sit === "talvez" ? "gtalvez" : "grep"}"><td>${l.sit === "existe" ? "" : `<input type="checkbox" class="gimk" data-i="${i}" ${l.marcado ? "checked" : ""}>`}</td>
        <td>${dataBR(l.data)}</td><td class="gdesc">${esc(l.descricao)}</td><td class="num ${l.valor >= 0 ? "gpos" : "gneg"}">${brl(l.valor)}</td>
        <td>${l.sit === "existe" ? "" : `<input class="gicl" data-i="${i}" list="gdlc" value="${esc(l.classe)}" placeholder="a classificar" style="min-width:130px">`}</td>
        <td>${l.sit === "existe" ? "" : `<input class="gics" data-i="${i}" list="gdla" value="${esc(l.classificacao)}" style="min-width:130px">`}${l.origem ? `<div class="mut" style="font-size:11px">${esc(l.origem)}</div>` : ""}</td>
        <td>${sit[l.sit]}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="acoes"><button type="button" class="bt" id="gicanc">Descartar</button><button type="button" class="bt pri" id="giok" ${marc.length ? "" : "disabled"}>Importar ${n(marc.length)} lançamento(s)</button></div></div>` : ""}
    <div class="card"><div class="cabtela"><h2>Regras de classificação</h2><button type="button" class="bt" id="ginr">+ Nova regra</button></div>
      <div class="mut">Na importação, a primeira regra ativa (menor prioridade) cujo trecho aparece na descrição define a classe. Sem regra, vale a classe de um lançamento igual (mesmo texto ou mesmo CPF/CNPJ) já classificado; senão fica “a classificar”.</div>
      <div class="tw"><table><thead><tr><th>Trecho da descrição</th><th>Conta</th><th>Tipo</th><th>Classe</th><th>Classificação</th><th class="num">Prior.</th><th></th></tr></thead><tbody>
      ${GER.regras.map(r => `<tr${r.ativo ? "" : ' style="opacity:.5"'}><td><b>${esc(r.padrao)}</b>${r.observacao ? `<div class="mut">${esc(r.observacao)}</div>` : ""}</td><td>${r.conta ? GER_BANCOS[r.conta] : "as duas"}</td>
        <td>${{ credito: "créditos", debito: "débitos" }[r.tipo] || "os dois"}</td><td>${esc(r.classe)}</td><td>${esc(r.classificacao)}</td><td class="num">${r.prioridade}</td>
        <td><button type="button" class="bt ger-r" data-id="${r.id}">Editar</button></td></tr>`).join("") || '<tr><td colspan="7" class="mut">Nenhuma regra ainda.</td></tr>'}
      </tbody></table></div></div>
    <div class="card"><h2>Importações</h2><div class="tw"><table><thead><tr><th>Quando</th><th>Conta</th><th>Arquivo</th><th>Período</th><th class="num">Entraram</th><th class="num">Pulados</th><th class="num">Saldo do extrato</th><th>Quem</th></tr></thead><tbody>
      ${GER.imps.map(x => `<tr><td>${quando(x.criado_em)}</td><td>${GER_CONTAS[x.conta]}</td><td>${esc(x.arquivo)}</td><td>${x.de ? dataBR(x.de) + " a " + dataBR(x.ate) : "—"}</td><td class="num">${n(x.novos)}</td><td class="num">${n(x.repetidos)}</td>
        <td class="num">${x.saldo_final != null ? brl(x.saldo_final) + ` <span class="mut">${dataBR(x.saldo_data)}</span>` : "—"}</td><td>${esc(x.criado_nome)}</td></tr>`).join("") || '<tr><td colspan="8" class="mut">Nenhuma importação ainda.</td></tr>'}
      </tbody></table></div></div>`;
  $("giarq").onchange = async e => {
    const f = e.target.files[0], conta = $("gicta").value;
    if (!f) return;
    if (!conta) { $("gierr").innerHTML = '<div class="msg err">Escolha antes a conta do extrato (Itaú ou Nubank).</div>'; e.target.value = ""; return; }
    try { await gerCarregar(true); await gArquivo(f, conta); gerImportar(); }
    catch (er) { $("gierr").innerHTML = `<div class="msg err">${esc(er.message)}</div>`; }
  };
  document.querySelectorAll(".ger-r").forEach(b => b.onclick = () => gRegra(GER.regras.find(r => r.id === Number(b.dataset.id))));
  $("ginr").onclick = () => gRegra(null);
  if (!I) return;
  document.querySelectorAll(".gimk").forEach(c => c.onchange = () => { I.linhas[c.dataset.i].marcado = c.checked; gerImportar(); });
  document.querySelectorAll(".gicl").forEach(c => c.onchange = () => { const l = I.linhas[c.dataset.i]; l.classe = c.value.trim(); l.regra_id = null; l.origem = "à mão"; });
  document.querySelectorAll(".gics").forEach(c => c.onchange = () => { const l = I.linhas[c.dataset.i]; l.classificacao = c.value.trim(); l.regra_id = null; });
  $("gicanc").onclick = () => { GER_IMP = null; gerImportar(); };
  $("giok").onclick = async () => {
    const ls = I.linhas.filter(l => l.marcado);
    try {
      $("giok").disabled = true;
      const r = checar(await sb.rpc("lin_ger_importar", { p: { conta: I.conta, arquivo: I.arquivo, saldo_final: I.saldo_final, saldo_data: I.saldo_data || null,
        lancamentos: ls.map(l => ({ chave: l.chave, fitid: l.fitid || null, data: l.data, descricao: l.descricao, credito: l.valor > 0 ? l.valor : 0, debito: l.valor < 0 ? -l.valor : 0,
          classe: l.classe || null, classificacao: l.classificacao || "", regra_id: l.regra_id || null, revisar: !l.classe })) } }));
      GER_IMP = null; await gerCarregar(true);
      msg("ok", `Importados ${n(r.novos)} lançamento(s)${r.repetidos ? `; ${n(r.repetidos)} já estavam no sistema` : ""}.${r.a_classificar ? ` ${n(r.a_classificar)} ficaram a classificar.` : ""}`);
      if (r.a_classificar) { FGE.revisar = true; FGE.ano = ""; FGE.mes = ""; FGE.conta = ""; irPara("ger_lanc"); } else gerImportar();
    } catch (e) { $("giok").disabled = false; $("gierr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; window.scrollTo(0, 0); }
  };
}
function gRegra(r) {
  $("dlgf").innerHTML = `<h3>${r ? "Editar regra" : "Nova regra"}</h3>
    <datalist id="gdlc">${gClasses().map(c => `<option value="${esc(c)}">`).join("")}</datalist><datalist id="gdls"></datalist>
    <label class="campo">Trecho da descrição (sem diferença de acento e maiúscula)<input id="grp" value="${esc(r ? r.padrao : "")}" placeholder="ex.: RECEBIMENTO REDE, 11.030.024/0001-00, ALINE CUPERTINO"></label>
    <label class="campo">Classe<input id="grc" list="gdlc" value="${esc(r ? r.classe : "")}"></label>
    <label class="campo">Classificação<input id="grs" list="gdls" value="${esc(r ? r.classificacao : "")}"></label>
    <div class="filtros" style="margin-top:12px">
      <select id="grct"><option value="">Itaú e Nubank</option>${Object.entries(GER_BANCOS).map(([k, t]) => `<option value="${k}" ${r && r.conta === k ? "selected" : ""}>Só ${t}</option>`).join("")}</select>
      <select id="grtp"><option value="">Créditos e débitos</option><option value="credito" ${r && r.tipo === "credito" ? "selected" : ""}>Só créditos</option><option value="debito" ${r && r.tipo === "debito" ? "selected" : ""}>Só débitos</option></select>
      <label class="chk">Prioridade <input id="grpr" type="number" value="${r ? r.prioridade : 100}" style="width:80px"></label>
      <label class="chk"><input type="checkbox" id="grat" ${!r || r.ativo ? "checked" : ""}> Ativa</label></div>
    <label class="campo">Observação<input id="grob" value="${esc(r ? r.observacao : "")}"></label>
    <div id="grerr"></div><div class="acoes">${r ? '<button type="button" class="bt" id="grdel">Excluir</button>' : ""}<button type="button" class="bt" id="grx">Cancelar</button><button type="button" class="bt pri" id="grok">Salvar</button></div>`;
  const dls = () => { $("gdls").innerHTML = gClassifs($("grc").value.trim()).map(c => `<option value="${esc(c)}">`).join(""); };
  $("grc").oninput = dls; dls();
  $("grx").onclick = () => $("dlg").close();
  if (r) $("grdel").onclick = async () => {
    if (!confirm("Excluir a regra “" + r.padrao + "”? Os lançamentos já classificados não mudam.")) return;
    try { checar(await sb.rpc("lin_ger_regra_excluir", { p_id: r.id })); $("dlg").close(); await gerCarregar(true); gerImportar(); } catch (e) { $("grerr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
  $("grok").onclick = async () => {
    const p = { padrao: $("grp").value.trim(), classe: $("grc").value.trim(), classificacao: $("grs").value.trim(), conta: $("grct").value, tipo: $("grtp").value,
      prioridade: $("grpr").value, ativo: $("grat").checked, observacao: $("grob").value.trim() };
    if (r) p.id = r.id;
    try {
      checar(await sb.rpc("lin_ger_regra_salvar", { p }));
      $("dlg").close(); await gerCarregar(true);
      // a regra nova vale também para o que está "a classificar"?
      const t = semAc(p.padrao), alvo = p.ativo ? GER.lanc.filter(l => l.revisar && semAc(l.descricao).includes(t) && (!p.conta || l.conta === p.conta)
        && (!p.tipo || (p.tipo === "credito" ? Number(l.credito) > 0 : Number(l.debito) > 0))) : [];
      if (alvo.length && confirm(`${alvo.length} lançamento(s) a classificar têm “${p.padrao}”. Classificar agora como ${p.classe}${p.classificacao ? " · " + p.classificacao : ""}?`)) {
        checar(await sb.rpc("lin_ger_classificar", { p: { ids: alvo.map(l => l.id), classe: p.classe, classificacao: p.classificacao } }));
        await gerCarregar(true);
      }
      if (GER_IMP) GER_IMP.linhas.filter(l => l.sit !== "existe" && !l.classe).forEach(l => Object.assign(l, gSugerir(GER_IMP.conta, l)));
      gerImportar();
    } catch (e) { $("grerr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
  $("dlg").classList.remove("largo"); $("dlg").showModal();
}
