// Sistema Linum 2.37 — Gerencial, fase 2: Vendas Rede e Análise de Vendas (as abas do painel gerencial antigo), só Dono.
// Fonte: lin_ger_rede (vendas da maquininha Rede, com a data e a hora REAIS da venda) + lin_ger_outras_vendas (caderno: dinheiro,
// Pix direto; uma por loja e mês, no último dia do mês — entram nos totais e no gráfico por mês, nunca nas contas por dia).
// Importa o CSV do portal da Rede (colunas pelo nome; hora em 12 h sem AM/PM: 1 a 9 → +12; canceladas fora), o Pix mensal
// da maquininha, outras vendas e o terminal → loja. Grava pelas funções lin_ger_* (auditoria no servidor).
// Usa as globais do index.html e do gerencial.js (sb, $, esc, checar, msg, brl, n, dataBR, hoje, todas, semAc, quando, decBR,
// numBR, gGraf, gEixo, gTip, gPct, gerChartJs, gCsvLinhas, gLerTexto, GER_MESES, GER_CORES, GER_CH).

let GERV = null;   // {rede, outras, terminais, imps, lido}
const FGV = { ano: null, mes: "", loja: "", acum: false, q: "" };
const GV_DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const GV_MS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
let GV_IMP = null;   // CSV da Rede em conferência

async function gvCarregar(forcar) {
  if (GERV && !forcar && Date.now() - GERV.lido < 120000) return;
  const [rede, outras, terminais, imps] = await Promise.all([
    todas(() => sb.from("lin_ger_rede").select("*").order("data").order("hora").order("id")),
    todas(() => sb.from("lin_ger_outras_vendas").select("*").order("data").order("id")),
    todas(() => sb.from("lin_ger_terminais").select("*").order("terminal")),
    todas(() => sb.from("lin_ger_importacoes").select("*").eq("conta", "rede").order("id", { ascending: false }))]);
  GERV = { rede, outras, terminais, imps, lido: Date.now() };
  if (FGV.ano === null) { const anos = new Set(rede.map(r => r.data.slice(0, 4))); FGV.ano = anos.has(hoje().slice(0, 4)) ? hoje().slice(0, 4) : ""; }
}
const gvLojas = () => [...new Set(GERV.rede.map(r => r.loja).concat(GERV.outras.map(o => o.loja), GERV.terminais.map(t => t.loja)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
const gvFiltro = x => (!FGV.ano || x.data.startsWith(FGV.ano)) && (!FGV.mes || x.data.slice(5, 7) === FGV.mes) && (!FGV.loja || x.loja === FGV.loja);
function gvFiltrosHtml(extra = "") {
  const anos = [...new Set(GERV.rede.map(r => r.data.slice(0, 4)).concat(GERV.outras.map(o => o.data.slice(0, 4))))].sort().reverse();
  return `<div class="filtros">
    <select id="gvano" aria-label="Ano"><option value="">Todos os anos</option>${anos.map(a => `<option ${a === FGV.ano ? "selected" : ""}>${a}</option>`).join("")}</select>
    <select id="gvmes" aria-label="Mês"><option value="">Todos os meses</option>${GER_MESES.map((m, i) => { const v = String(i + 1).padStart(2, "0"); return `<option value="${v}" ${v === FGV.mes ? "selected" : ""}>${m}</option>`; }).join("")}</select>
    <select id="gvloja" aria-label="Loja"><option value="">Todas as lojas</option>${gvLojas().map(l => `<option ${l === FGV.loja ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
    ${extra}</div>`;
}
function gvFiltrosLigar(fn) {
  $("gvano").onchange = e => { FGV.ano = e.target.value; fn(); };
  $("gvmes").onchange = e => { FGV.mes = e.target.value; fn(); };
  $("gvloja").onchange = e => { FGV.loja = e.target.value; fn(); };
}
const gvDia = d => { const x = new Date(d + "T12:00:00").getDay(); return x === 0 ? 6 : x - 1; };   // 0 = segunda
const gvUltima = () => { const d = GERV.rede.map(r => r.data).sort().pop(); return d ? "Vendas da maquininha até " + dataBR(d) : "Nenhuma venda da maquininha importada ainda."; };
async function telaGerencialVendas(sub) {
  GER_CH.forEach(c => c.destroy()); GER_CH = [];
  if (!GERV) $("tela").innerHTML = '<div class="card">Carregando…</div>';
  const vista = VISTA;
  try { await Promise.all([gvCarregar(), gerChartJs()]); }
  catch (e) { if (VISTA === vista) $("tela").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  if (VISTA !== vista) return;
  (sub === "rede" ? gerRede : gerAnalise)();
}
// tabela agrupada: vendas, bruto, taxas, taxa média, ticket médio
function gvTabela(ls, chave, titulo, ordem) {
  const g = {};
  ls.forEach(r => { const k = chave(r); const x = g[k] = g[k] || { n: 0, b: 0, t: 0 }; x.n++; x.b += Number(r.bruto); x.t += Number(r.tx_val); });
  let ents = Object.entries(g);
  ents = ordem ? ents.sort((a, b) => ordem(a[0], b[0])) : ents.sort((a, b) => b[1].b - a[1].b);
  const tot = ls.reduce((a, r) => a + Number(r.bruto), 0);
  return `<div class="card"><h2>${titulo}</h2><div class="tw"><table><thead><tr><th></th><th class="num">Vendas</th><th class="num">Bruto</th><th class="num">%</th><th class="num">Taxas</th><th class="num">Taxa média</th><th class="num">Ticket médio</th></tr></thead><tbody>
    ${ents.map(([k, x]) => `<tr><td>${esc(k)}</td><td class="num">${n(x.n)}</td><td class="num">${brl(x.b)}</td><td class="num">${gPct(x.b, tot)}</td><td class="num">${brl(x.t)}</td><td class="num">${gPct(x.t, x.b)}</td><td class="num">${brl(x.b / x.n)}</td></tr>`).join("") || '<tr><td colspan="7" class="mut">Sem vendas.</td></tr>'}
    </tbody></table></div></div>`;
}

// ---------------------------------------------------------------- Vendas Rede
function gerRede() {
  const ls = GERV.rede.filter(gvFiltro);
  const b = ls.reduce((a, r) => a + Number(r.bruto), 0), t = ls.reduce((a, r) => a + Number(r.tx_val), 0), l = ls.reduce((a, r) => a + Number(r.liquido), 0);
  const semLoja = ls.filter(r => r.loja === "Não identificada" && r.modalidade !== "Pix").length;
  const lojas = [...new Set(GERV.rede.map(r => r.loja))].sort();
  // comparativo mês a mês por ano (anos da maquininha, sem o filtro de ano)
  const base = GERV.rede.filter(r => !FGV.loja || r.loja === FGV.loja);
  const anos = [...new Set(base.map(r => r.data.slice(0, 4)))].sort().slice(-4);
  const mat = Object.fromEntries(anos.map(y => [y, Array(12).fill(0)]));
  base.forEach(r => { const y = r.data.slice(0, 4); if (mat[y]) mat[y][Number(r.data.slice(5, 7)) - 1] += Number(r.bruto); });
  const lojaMes = Object.fromEntries(lojas.map(lj => [lj, Array(12).fill(0)]));
  GERV.rede.filter(r => r.data.startsWith(FGV.ano || hoje().slice(0, 4))).forEach(r => { lojaMes[r.loja][Number(r.data.slice(5, 7)) - 1] += Number(r.bruto); });
  const anoLoja = FGV.ano || hoje().slice(0, 4);
  const det = ls.filter(r => !FGV.q || semAc([r.bandeira, r.modalidade, r.tipo, r.loja, r.terminal, r.nsu].join(" ")).includes(semAc(FGV.q))).slice().reverse();
  $("tela").innerHTML = `
    <div class="cabtela"><h2>Gerencial · Vendas Rede</h2><span class="noprint" style="display:flex;gap:8px"><button class="bt" id="gvcsv">Baixar CSV</button><button class="bt" id="gvimp">Imprimir</button></span></div>
    <div class="mut" style="margin:-2px 0 10px">${esc(gvUltima())}. Data e hora reais da venda (relatório da maquininha), não a do crédito no banco. A loja vem do terminal.</div>
    ${semLoja ? `<div class="msg info">${n(semLoja)} venda(s) sem loja: terminal sem cadastro. Cadastre em “Terminais” abaixo; vale para as próximas importações.</div>` : ""}
    ${gvFiltrosHtml()}
    <div class="kpis">
      <div class="kpi"><small>Vendas brutas</small><b>${brl(b)}</b><span>${n(ls.length)} venda(s)</span></div>
      <div class="kpi"><small>Taxas pagas</small><b class="gneg">${brl(t)}</b><span>${gPct(t, b)} do bruto</span></div>
      <div class="kpi"><small>Líquido recebido</small><b class="gpos">${brl(l)}</b><span>bruto − taxas</span></div>
      <div class="kpi"><small>Ticket médio</small><b>${brl(ls.length ? b / ls.length : 0)}</b><span>por venda</span></div>
    </div>
    ${window.Chart ? `<div class="ggraf">
      <div class="card"><h2>Comparativo mês a mês por ano</h2><canvas id="gv1"></canvas><label class="chk noprint" style="margin-top:6px;text-transform:none;letter-spacing:0"><input type="checkbox" id="gvacum" ${FGV.acum ? "checked" : ""}> Acumulado no ano</label></div>
      <div class="card"><h2>Por loja — ${anoLoja}</h2><canvas id="gv2"></canvas></div>
      <div class="card"><h2>Vendas por horário</h2><canvas id="gv3"></canvas></div>
      <div class="card"><h2>Ticket médio por dia da semana</h2><canvas id="gv4"></canvas></div></div>` : ""}
    <div class="card"><h2>Mês a mês por ano</h2><div class="tw"><table><thead><tr><th>Ano</th>${GV_MS.map(m => `<th class="num">${m}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>
      ${anos.map(y => `<tr><td><b>${y}</b></td>${mat[y].map(v => `<td class="num">${v ? n(Math.round(v)) : "—"}</td>`).join("")}<td class="num"><b>${n(Math.round(mat[y].reduce((a, v) => a + v, 0)))}</b></td></tr>`).join("")}
    </tbody></table></div><div class="mut">Valores em R$ (bruto). Sem o filtro de ano e mês; com o de loja.</div></div>
    <div class="ggraf" style="grid-template-columns:repeat(auto-fit,minmax(min(460px,100%),1fr))">
      ${gvTabela(ls, r => r.loja, "Por loja")}
      ${gvTabela(ls, r => r.bandeira || "(sem bandeira)", "Por bandeira")}
      ${gvTabela(ls, r => r.modalidade + (r.tipo ? " · " + r.tipo : ""), "Por modalidade")}
      ${gvTabela(ls, r => (r.parcelas || 1) + "x", "Por número de parcelas", (a, b) => parseInt(a) - parseInt(b))}
      ${gvTabela(ls.filter(r => r.hora), r => r.hora.slice(0, 2) + "h", "Por horário", (a, b) => a.localeCompare(b))}
      ${gvTabela(ls, r => GV_DIAS[gvDia(r.data)], "Por dia da semana", (a, b) => GV_DIAS.indexOf(a) - GV_DIAS.indexOf(b))}
    </div>
    <div class="card"><div class="cabtela"><h2>Detalhamento</h2><input type="search" id="gvq" placeholder="Bandeira, modalidade, loja, NSU" value="${esc(FGV.q)}" style="max-width:260px"></div>
      <div class="tw" style="max-height:60vh"><table><thead><tr><th>Data</th><th>Hora</th><th>Loja</th><th>Modalidade</th><th>Bandeira</th><th class="num">Parc.</th><th class="num">Bruto</th><th class="num">Taxa</th><th class="num">Líquido</th><th class="noprint"></th></tr></thead><tbody>
      ${det.slice(0, 1500).map(r => `<tr><td>${dataBR(r.data)}</td><td>${r.hora ? r.hora.slice(0, 5) : "—"}</td><td>${esc(r.loja)}</td><td>${esc(r.modalidade)}${r.tipo ? ` <span class="mut">${esc(r.tipo)}</span>` : ""}</td><td>${esc(r.bandeira)}</td>
        <td class="num">${r.parcelas}</td><td class="num">${brl(r.bruto)}</td><td class="num">${brl(r.tx_val)} <span class="mut">${decBR(Number(r.tx_pct).toFixed(2))}%</span></td><td class="num">${brl(r.liquido)}</td>
        <td class="noprint"><button type="button" class="bt gvdel" data-id="${r.id}" title="Excluir venda importada por engano">✕</button></td></tr>`).join("") || '<tr><td colspan="10" class="mut">Sem vendas.</td></tr>'}
      </tbody></table></div></div>
    ${gvCadastrosHtml()}`;
  gvFiltrosLigar(gerRede);
  $("gvimp").onclick = () => window.print();
  $("gvq").oninput = e => { FGV.q = e.target.value; clearTimeout(gerRede.t); gerRede.t = setTimeout(() => { if (VISTA !== "ger_rede") return; gerRede(); const i = $("gvq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 350); };
  document.querySelectorAll(".gvdel").forEach(bt => bt.onclick = async () => {
    const m = prompt("Excluir esta venda do Gerencial? (ex.: a sócia passou o próprio cartão para levantar caixa)\nEscreva o motivo:");
    if (m === null) return;
    try { checar(await sb.rpc("lin_ger_rede_excluir", { p_id: Number(bt.dataset.id), p_motivo: m })); await gvCarregar(true); msg("ok", "Venda excluída (fica no histórico de alterações)."); gerRede(); }
    catch (e) { msg("err", e.message); }
  });
  $("gvcsv").onclick = () => {
    const c = x => `"${String(x ?? "").replace(/"/g, '""')}"`, num = x => Number(x).toFixed(2).replace(".", ",");
    const lin = [["Data", "Hora", "Loja", "Terminal", "Modalidade", "Tipo", "Parcelas", "Bandeira", "Bruto", "Taxa %", "Taxa R$", "Líquido", "NSU"].map(c).join(";"),
      ...det.map(r => [dataBR(r.data), r.hora || "", r.loja, r.terminal, r.modalidade, r.tipo, r.parcelas, r.bandeira, num(r.bruto), num(r.tx_pct), num(r.tx_val), num(r.liquido), r.nsu || ""].map(c).join(";"))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lin.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `linum-vendas-rede-${FGV.ano || "todos"}${FGV.mes ? "-" + FGV.mes : ""}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  gvCadastrosLigar();
  if (!window.Chart) return;
  const ac = v => { let s = 0; return v.map((x, i) => { s += x; return v.slice(0, i + 1).some(Boolean) ? s : null; }); };
  gGraf("gv1", { type: "line", data: { labels: GV_MS, datasets: anos.map((y, i) => ({ label: y, data: (FGV.acum ? ac(mat[y]) : mat[y]).map(v => v || null), borderColor: GER_CORES[i], backgroundColor: GER_CORES[i], tension: .3 })) },
    options: { plugins: { tooltip: gTip }, scales: { y: gEixo } } });
  $("gvacum").onchange = e => { FGV.acum = e.target.checked; gerRede(); };
  gGraf("gv2", { type: "bar", data: { labels: GV_MS, datasets: lojas.map((lj, i) => ({ label: lj, data: lojaMes[lj], backgroundColor: GER_CORES[i] })) },
    options: { plugins: { tooltip: gTip }, scales: { x: { stacked: true }, y: { stacked: true, ...gEixo } } } });
  const hs = {}; ls.filter(r => r.hora).forEach(r => { const h = r.hora.slice(0, 2); hs[h] = (hs[h] || 0) + Number(r.bruto); });
  const hk = Object.keys(hs).sort();
  gGraf("gv3", { type: "bar", data: { labels: hk.map(h => h + "h"), datasets: [{ label: "Vendas", data: hk.map(h => hs[h]), backgroundColor: "#107e99aa" }] }, options: { plugins: { legend: { display: false }, tooltip: gTip }, scales: { y: gEixo } } });
  const dv = Array(7).fill(0), dn = Array(7).fill(0); ls.forEach(r => { const d = gvDia(r.data); dv[d] += Number(r.bruto); dn[d]++; });
  gGraf("gv4", { type: "bar", data: { labels: GV_DIAS, datasets: [{ label: "Ticket médio", data: dv.map((v, i) => dn[i] ? v / dn[i] : 0), backgroundColor: "#c9a227aa" }] }, options: { plugins: { legend: { display: false }, tooltip: gTip }, scales: { y: gEixo } } });
}

// ---------------------------------------------------------------- Análise de vendas (por dia: só a maquininha; totais: + outras vendas)
const gvNth = (y, m, wd, n) => { const d = new Date(y, m - 1, 1); let c = 0; while (true) { if (d.getDay() === wd && ++c === n) return d; d.setDate(d.getDate() + 1); } };
function gvComemorativas(y) {
  const f = {}, add = (m, d, nome) => { f[`${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`] = nome; };
  [[1, 1, "Confraternização Universal"], [4, 21, "Tiradentes"], [5, 1, "Dia do Trabalho"], [6, 12, "Dia dos Namorados"], [9, 7, "Independência do Brasil"], [10, 12, "Nossa Sra. Aparecida / Dia das Crianças"],
    [11, 2, "Finados"], [11, 15, "Proclamação da República"], [12, 24, "Véspera de Natal"], [12, 25, "Natal"], [12, 31, "Véspera de Ano Novo"]].forEach(x => add(...x));
  const md = (d, nome) => add(d.getMonth() + 1, d.getDate(), nome);
  md(gvNth(y, 5, 0, 2), "Dia das Mães"); md(gvNth(y, 8, 0, 2), "Dia dos Pais"); md(gvNth(y, 11, 5, 4), "Black Friday");
  return f;
}
const gvComem = d => gvComemorativas(Number(d.slice(0, 4)))[d.slice(5)] || "";
function gerAnalise() {
  const ls = GERV.rede.filter(gvFiltro), outras = GERV.outras.filter(gvFiltro);
  const dia = {}; ls.forEach(r => { dia[r.data] = (dia[r.data] || 0) + Number(r.bruto); });
  const dias = Object.entries(dia).sort((a, b) => a[0].localeCompare(b[0]));
  const totCartao = dias.reduce((a, [, v]) => a + v, 0), totOutras = outras.reduce((a, o) => a + Number(o.valor), 0), tot = totCartao + totOutras;
  const melhor = dias.reduce((m, x) => x[1] > m[1] ? x : m, ["", 0]);
  const mes = {}; dias.forEach(([d, v]) => { const k = d.slice(0, 7); (mes[k] = mes[k] || { c: 0, o: 0 }).c += v; });
  outras.forEach(o => { const k = o.data.slice(0, 7); (mes[k] = mes[k] || { c: 0, o: 0 }).o += Number(o.valor); });
  const meses = Object.keys(mes).sort();
  const wd = Array(7).fill(0), dom = Array(31).fill(0);
  dias.forEach(([d, v]) => { wd[gvDia(d)] += v; dom[Number(d.slice(8)) - 1] += v; });
  const comem = dias.filter(([d]) => gvComem(d)).map(([d, v]) => ({ d, v, nome: gvComem(d) }));
  const top = dias.slice().sort((a, b) => b[1] - a[1]).slice(0, 15);
  const medDia = dias.length ? totCartao / dias.length : 0;
  $("tela").innerHTML = `
    <div class="cabtela"><h2>Gerencial · Análise de vendas</h2><span class="noprint"><button class="bt" id="gvimp">Imprimir</button></span></div>
    <div class="mut" style="margin:-2px 0 10px">${esc(gvUltima())}. Usa a data real da venda. As outras vendas (caderno) entram nos totais e no gráfico por mês, mas não nas contas por dia (a data delas é o fim do mês).</div>
    ${gvFiltrosHtml()}
    <div class="kpis">
      <div class="kpi"><small>Total de vendas</small><b>${brl(tot)}</b><span>${totOutras ? `inclui ${brl(totOutras)} de outras vendas` : "maquininha"}</span></div>
      <div class="kpi"><small>Dias com venda</small><b>${n(dias.length)}</b><span>data real da venda</span></div>
      <div class="kpi"><small>Média por dia</small><b>${brl(medDia)}</b><span>dias com movimento</span></div>
      <div class="kpi"><small>Melhor dia</small><b>${melhor[0] ? dataBR(melhor[0]) : "—"}</b><span>${brl(melhor[1])}${melhor[0] && gvComem(melhor[0]) ? " · " + esc(gvComem(melhor[0])) : ""}</span></div>
      <div class="kpi"><small>Média mensal</small><b>${brl(meses.length ? tot / meses.length : 0)}</b><span>${n(meses.length)} mês(es)</span></div>
    </div>
    ${window.Chart ? `<div class="ggraf">
      <div class="card"><h2>Vendas por mês</h2><canvas id="ga1"></canvas></div>
      <div class="card"><h2>Vendas por dia da semana</h2><canvas id="ga2"></canvas></div>
      <div class="card"><h2>Vendas por dia do mês</h2><canvas id="ga3"></canvas></div>
      <div class="card"><h2>Evolução diária</h2><canvas id="ga4"></canvas></div></div>` : ""}
    <div class="ggraf">
      <div class="card"><h2>Datas comemorativas</h2><div class="tw"><table><thead><tr><th>Data</th><th>Data comemorativa</th><th>Dia</th><th class="num">Vendas</th><th class="num">× média do dia</th></tr></thead><tbody>
        ${comem.map(c => `<tr><td>${dataBR(c.d)}</td><td>${esc(c.nome)}</td><td>${GV_DIAS[gvDia(c.d)]}</td><td class="num">${brl(c.v)}</td><td class="num">${medDia ? decBR((c.v / medDia).toFixed(1)) + "×" : "—"}</td></tr>`).join("") || '<tr><td colspan="5" class="mut">Nenhuma venda em data comemorativa no período.</td></tr>'}
      </tbody></table></div><div class="mut">Datas fixas e as móveis calculadas (Dia das Mães, Dia dos Pais, Black Friday); Carnaval e Páscoa não entram.</div></div>
      <div class="card"><h2>Top 15 dias de maior venda</h2><div class="tw"><table><thead><tr><th>#</th><th>Data</th><th>Dia</th><th class="num">Vendas</th><th></th></tr></thead><tbody>
        ${top.map(([d, v], i) => `<tr><td>${i + 1}</td><td>${dataBR(d)}</td><td>${GV_DIAS[gvDia(d)]}</td><td class="num">${brl(v)}</td><td>${gvComem(d) ? `<span class="tag possivel">${esc(gvComem(d))}</span>` : ""}</td></tr>`).join("") || '<tr><td colspan="5" class="mut">Sem vendas.</td></tr>'}
      </tbody></table></div></div>
      <div class="card"><h2>Por dia da semana</h2><div class="tw"><table><thead><tr><th>Dia</th><th class="num">Vendas</th><th class="num">%</th></tr></thead><tbody>
        ${GV_DIAS.map((d, i) => `<tr><td>${d}</td><td class="num">${brl(wd[i])}</td><td class="num">${gPct(wd[i], totCartao)}</td></tr>`).join("")}
      </tbody></table></div></div>
      <div class="card"><h2>Outras vendas (caderno)</h2><div class="tw"><table><thead><tr><th>Mês</th><th>Loja</th><th class="num">Valor</th><th>Descrição</th></tr></thead><tbody>
        ${outras.slice().reverse().map(o => `<tr><td>${dataBR(o.data)}</td><td>${esc(o.loja)}</td><td class="num">${brl(o.valor)}</td><td>${esc(o.descricao)}</td></tr>`).join("") || '<tr><td colspan="4" class="mut">Nenhuma no período.</td></tr>'}
      </tbody></table></div><div class="mut">Incluir ou excluir: aba Vendas Rede → Cadastros.</div></div>
    </div>`;
  gvFiltrosLigar(gerAnalise);
  $("gvimp").onclick = () => window.print();
  if (!window.Chart) return;
  gGraf("ga1", { type: "bar", data: { labels: meses.map(m => GV_MS[Number(m.slice(5)) - 1] + "/" + m.slice(2, 4)), datasets: [
    { label: "Maquininha", data: meses.map(m => mes[m].c), backgroundColor: "#107e99aa" }, { label: "Outras vendas", data: meses.map(m => mes[m].o), backgroundColor: "#c9a227aa" }] },
    options: { plugins: { tooltip: gTip }, scales: { x: { stacked: true }, y: { stacked: true, ...gEixo } } } });
  gGraf("ga2", { type: "bar", data: { labels: GV_DIAS, datasets: [{ label: "Vendas", data: wd, backgroundColor: wd.map((_, i) => i < 5 ? "#107e99aa" : "#0b2545aa") }] }, options: { plugins: { legend: { display: false }, tooltip: gTip }, scales: { y: gEixo } } });
  gGraf("ga3", { type: "bar", data: { labels: dom.map((_, i) => i + 1), datasets: [{ label: "Vendas", data: dom, backgroundColor: "#5fa8bdaa" }] }, options: { plugins: { legend: { display: false }, tooltip: gTip }, scales: { y: gEixo } } });
  gGraf("ga4", { type: "line", data: { labels: dias.map(([d]) => dataBR(d).slice(0, 5)), datasets: [{ label: "Vendas", data: dias.map(([, v]) => v), borderColor: "#107e99", pointRadius: 2, tension: .2 }] },
    options: { plugins: { legend: { display: false }, tooltip: gTip }, scales: { y: gEixo } } });
}

// ---------------------------------------------------------------- importar CSV da Rede, Pix mensal, outras vendas, terminais
function gvCadastrosHtml() {
  const I = GV_IMP;
  return `<div class="card noprint"><h2>Importar e cadastros</h2>
    <div class="filtros" style="margin:0">
      <label class="bt" style="cursor:pointer;text-transform:none;letter-spacing:0">Importar CSV da Rede<input type="file" id="gvarq" accept=".csv,.txt" style="display:none"></label>
      <button type="button" class="bt" id="gvpix">+ Pix da maquininha (mês)</button>
      <button type="button" class="bt" id="gvout">+ Outras vendas (caderno)</button>
      <button type="button" class="bt" id="gvter">Terminais (${n(GERV.terminais.length)})</button>
    </div>
    <div class="mut" style="margin-top:6px">CSV: portal da Rede → Vendas → Exportar (CSV). Pode repetir períodos: o que já entrou é pulado (NSU ou data, hora, terminal e valor). A hora do relatório vem em 12 h sem AM/PM: 1 a 9 viram 13 a 21 h. Vendas canceladas não entram.</div>
    <div id="gverr"></div>
    ${I ? `<h3 style="margin-top:12px">Confira — ${esc(I.arquivo)}</h3>
      <div class="kpis"><div class="kpi"><small>No arquivo</small><b>${n(I.linhas.length + I.fora)}</b><span>${I.fora ? n(I.fora) + " cancelada(s)/negada(s) fora" : "todas aprovadas"}</span></div>
        <div class="kpi"><small>Novas</small><b>${n(I.linhas.filter(l => !l.existe).length)}</b><span>${brl(I.linhas.filter(l => !l.existe).reduce((a, l) => a + l.bruto, 0))}</span></div>
        <div class="kpi"><small>Já importadas</small><b>${n(I.linhas.filter(l => l.existe).length)}</b><span>puladas</span></div>
        <div class="kpi"><small>Sem loja</small><b>${n(I.linhas.filter(l => !l.existe && !l.loja).length)}</b><span>terminal sem cadastro</span></div></div>
      <div class="tw" style="max-height:45vh"><table><thead><tr><th>Data</th><th>Hora</th><th>Terminal</th><th>Loja</th><th>Modalidade</th><th>Bandeira</th><th class="num">Parc.</th><th class="num">Bruto</th><th class="num">Taxas</th><th class="num">Líquido</th><th></th></tr></thead><tbody>
      ${I.linhas.map(l => `<tr class="${l.existe ? "grep" : ""}"><td>${dataBR(l.data)}</td><td>${l.hora ? l.hora.slice(0, 5) : "—"}</td><td>${esc(l.terminal)}</td><td>${l.loja ? esc(l.loja) : '<span class="tag fora">sem loja</span>'}</td>
        <td>${esc(l.modalidade)} <span class="mut">${esc(l.tipo)}</span></td><td>${esc(l.bandeira)}</td><td class="num">${l.parcelas}</td><td class="num">${brl(l.bruto)}</td><td class="num">${brl(l.tx_val)}</td><td class="num">${brl(l.liquido)}</td>
        <td>${l.existe ? '<span class="tag">já importada</span>' : '<span class="tag ok">nova</span>'}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="acoes"><button type="button" class="bt" id="gvic">Descartar</button><button type="button" class="bt pri" id="gvok" ${I.linhas.some(l => !l.existe) ? "" : "disabled"}>Importar ${n(I.linhas.filter(l => !l.existe).length)} venda(s)</button></div>` : ""}
    <h3 style="margin-top:14px">Importações</h3><div class="tw"><table><thead><tr><th>Quando</th><th>Arquivo</th><th>Período</th><th class="num">Entraram</th><th class="num">Puladas</th><th>Quem</th></tr></thead><tbody>
      ${GERV.imps.slice(0, 12).map(x => `<tr><td>${quando(x.criado_em)}</td><td>${esc(x.arquivo)}</td><td>${x.de ? dataBR(x.de) + " a " + dataBR(x.ate) : "—"}</td><td class="num">${n(x.novos)}</td><td class="num">${n(x.repetidos)}</td><td>${esc(x.criado_nome)}</td></tr>`).join("") || '<tr><td colspan="6" class="mut">Nenhuma ainda.</td></tr>'}
    </tbody></table></div></div>`;
}
const gvN = t => { t = String(t ?? "").replace(/R\$|%|\s/g, ""); if (!t) return 0; if (t.includes(",")) t = t.replace(/\./g, "").replace(",", "."); const v = Number(t); return isFinite(v) ? v : 0; };
// hora do relatório em 12 h sem AM/PM (regra do painel antigo, conferida com o horário das lojas): 1–9 → +12; 10, 11, 12 ficam
function gvHora(t) {
  const m = String(t || "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return "";
  let h = Number(m[1]); if (h >= 1 && h <= 9) h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}:${m[3] || "00"}`;
}
function gvData(t) {
  t = String(t || "").trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}
// colunas pelo nome (sem acento, minúsculas); a primeira que casar vale
const GV_COLS = { data: ["data da venda", "data"], hora: ["hora da venda", "hora"], nsu: ["nsu/cv", "nsu", "cv"], terminal: ["numero do terminal", "terminal", "maquininha"],
  modalidade: ["modalidade"], tipo: ["tipo"], parcelas: ["numero de parcelas", "quantidade de parcelas", "parcelas"], bandeira: ["bandeira"],
  bruto: ["valor da venda original", "valor da venda", "valor bruto", "valor original"], mdr_pct: ["taxa mdr"], mdr_val: ["valor mdr", "valor da taxa mdr"],
  ant_pct: ["taxa de antecipacao", "taxa antecipacao"], ant_val: ["valor da antecipacao", "valor antecipacao", "valor da taxa de antecipacao"],
  tx_pct: ["taxa total", "taxas cobradas (%)"], tx_val: ["valor total das taxas", "taxas cobradas", "valor das taxas"], liquido: ["valor liquido"], prazo: ["prazo"], status: ["status"] };
function gvLerRede(txt) {
  const rs = gCsvLinhas(txt.replace(/^﻿/, ""));
  const iCab = rs.findIndex(r => r.some(c => semAc(c).startsWith("data")) && r.some(c => semAc(c).includes("valor")));
  if (iCab < 0) throw new Error("Não achei o cabeçalho do relatório da Rede (colunas de data e valor). É o CSV de vendas do portal da Rede?");
  const cab = rs[iCab].map(c => semAc(c));
  const col = {};
  Object.entries(GV_COLS).forEach(([k, nomes]) => { for (const nm of nomes) { const i = cab.findIndex((c, j) => !Object.values(col).includes(j) && (c === nm || c.startsWith(nm))); if (i >= 0) { col[k] = i; break; } } });
  if (col.data == null || col.bruto == null) throw new Error("O relatório não tem as colunas de data e valor da venda. Colunas encontradas: " + rs[iCab].join(" · "));
  const term = Object.fromEntries(GERV.terminais.map(t => [t.terminal, t.loja]));
  const cont = {}; let fora = 0;
  const linhas = [];
  rs.slice(iCab + 1).forEach(r => {
    const g = k => col[k] == null ? "" : (r[col[k]] || "").trim();
    const data = gvData(g("data")), bruto = gvN(g("bruto"));
    if (!data || !bruto) return;
    if (/cancel|chargeback|negad|desfeit|estorn/i.test(semAc(g("status")))) { fora++; return; }
    const l = { data, hora: gvHora(g("hora")), nsu: g("nsu").replace(/^0+(?=\d)/, ""), terminal: g("terminal"), modalidade: g("modalidade"), tipo: g("tipo"),
      parcelas: parseInt(g("parcelas")) || 1, bandeira: g("bandeira"), bruto, mdr_pct: gvN(g("mdr_pct")), mdr_val: gvN(g("mdr_val")), ant_pct: gvN(g("ant_pct")),
      ant_val: gvN(g("ant_val")), tx_pct: gvN(g("tx_pct")), tx_val: gvN(g("tx_val")), liquido: gvN(g("liquido")), prazo: g("prazo") };
    if (!l.tx_val) l.tx_val = Math.round((l.mdr_val + l.ant_val) * 100) / 100;
    if (!l.tx_pct) l.tx_pct = Math.round((l.mdr_pct + l.ant_pct) * 100) / 100;
    if (!l.liquido) l.liquido = Math.round((l.bruto - l.tx_val) * 100) / 100;
    l.loja = term[l.terminal] || "";
    const base = [l.data, l.hora, l.terminal, l.bruto.toFixed(2)].join("|"); cont[base] = (cont[base] || 0) + 1; l.chave = base + "|" + cont[base];
    linhas.push(l);
  });
  if (!linhas.length) throw new Error("Nenhuma venda aprovada no arquivo.");
  const chaves = new Set(GERV.rede.map(r => r.chave)), nsus = new Set(GERV.rede.map(r => r.nsu).filter(Boolean));
  linhas.forEach(l => { l.existe = chaves.has(l.chave) || (l.nsu && nsus.has(l.nsu)); });
  linhas.sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
  return { linhas, fora };
}
function gvCadastrosLigar() {
  $("gvarq").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { await gvCarregar(true); GV_IMP = { arquivo: f.name, ...gvLerRede(await gLerTexto(f)) }; gerRede(); $("gvok") && $("gvok").scrollIntoView({ block: "center" }); }
    catch (er) { $("gverr").innerHTML = `<div class="msg err">${esc(er.message)}</div>`; }
  };
  if (GV_IMP) {
    $("gvic").onclick = () => { GV_IMP = null; gerRede(); };
    $("gvok").onclick = async () => {
      try {
        $("gvok").disabled = true;
        const r = checar(await sb.rpc("lin_ger_rede_importar", { p: { arquivo: GV_IMP.arquivo, vendas: GV_IMP.linhas.filter(l => !l.existe).map(({ existe, ...l }) => ({ ...l, loja: l.loja || null, nsu: l.nsu || null, hora: l.hora || null })) } }));
        GV_IMP = null; await gvCarregar(true);
        msg("ok", `Importadas ${n(r.novas)} venda(s)${r.repetidas ? `; ${n(r.repetidas)} já estavam no sistema` : ""}.${r.sem_loja ? ` ${n(r.sem_loja)} sem loja: cadastre o terminal.` : ""}`);
        gerRede();
      } catch (e) { $("gvok").disabled = false; $("gverr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
    };
  }
  $("gvpix").onclick = () => gvForm("pix");
  $("gvout").onclick = () => gvForm("outra");
  $("gvter").onclick = gvTerminais;
}
// valor digitado: "5.167,00", "5167", "2.000" (milhar) ou "189.90"
const gvValor = t => { t = String(t || "").trim().replace(/R\$|\s/g, ""); if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ""); return Number(numBR(t)) || 0; };
const gvFimMes = am => { const [y, m] = am.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
function gvForm(tipo) {
  const pix = tipo === "pix", mesAnt = (() => { const d = new Date(hoje() + "T12:00:00"); d.setDate(0); return d.toISOString().slice(0, 7); })();
  $("dlgf").innerHTML = `<h3>${pix ? "Pix da maquininha do mês" : "Outras vendas (caderno)"}</h3>
    <div class="mut">${pix ? "A Rede não informa o Pix dia a dia: o total do mês entra como uma venda do último dia do mês, sem loja e sem taxa." : "Vendas fora da maquininha (dinheiro, Pix direto), anotadas no caderno: o total do mês por loja, no último dia do mês. Valor negativo desconta (ex.: venda-teste)."}</div>
    <label class="campo">Mês<input id="gvfm" type="month" value="${mesAnt}" max="${hoje().slice(0, 7)}"></label>
    ${pix ? "" : `<label class="campo">Loja<select id="gvfl">${gvLojas().filter(l => l !== "Não identificada").map(l => `<option>${esc(l)}</option>`).join("")}</select></label>`}
    <label class="campo">Valor (R$)<input id="gvfv" inputmode="decimal" placeholder="ex.: 5.167,00"></label>
    ${pix ? "" : '<label class="campo">Descrição<input id="gvfd" value="Venda no caderno" maxlength="200"></label>'}
    <div id="gvferr"></div><div class="acoes"><button type="button" class="bt" id="gvfx">Cancelar</button><button type="button" class="bt pri" id="gvfok">Salvar</button></div>`;
  $("gvfx").onclick = () => $("dlg").close();
  $("gvfok").onclick = async () => {
    const m = $("gvfm").value, v = gvValor($("gvfv").value);
    try {
      if (!m) throw new Error("Escolha o mês");
      if (!v) throw new Error("Informe o valor");
      $("gvfok").disabled = true;
      const data = gvFimMes(m);
      if (pix) {
        const r = checar(await sb.rpc("lin_ger_rede_importar", { p: { arquivo: "Pix da maquininha " + m, vendas: [{ chave: "pix|" + m, data, terminal: "PIX-QR", loja: "Não identificada", modalidade: "Pix",
          tipo: "à vista", parcelas: 1, bandeira: "Pix", bruto: v, liquido: v }] } }));
        if (!r.novas) throw new Error("O Pix desse mês já foi lançado. Para trocar, exclua o anterior no Detalhamento.");
      } else checar(await sb.rpc("lin_ger_outra_venda_salvar", { p: { data, loja: $("gvfl").value, valor: v, descricao: $("gvfd").value } }));
      $("dlg").close(); await gvCarregar(true); msg("ok", pix ? "Pix do mês lançado." : "Outra venda lançada."); render();
    } catch (e) { $("gvfok").disabled = false; $("gvferr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
  $("dlg").classList.remove("largo"); $("dlg").showModal();
}
function gvTerminais() {
  const out = GERV.outras.slice().reverse();
  $("dlgf").innerHTML = `<h3>Terminais e outras vendas</h3>
    <div class="mut">A loja de cada venda vem do terminal da maquininha (o nome do estabelecimento vem igual nas duas lojas). Vale para as próximas importações.</div>
    <div class="tw"><table><thead><tr><th>Terminal</th><th>Loja</th><th>Observação</th></tr></thead><tbody>
      ${GERV.terminais.map(t => `<tr><td>${esc(t.terminal)}</td><td>${esc(t.loja)}</td><td>${esc(t.observacao)}</td></tr>`).join("") || '<tr><td colspan="3" class="mut">Nenhum terminal cadastrado.</td></tr>'}
    </tbody></table></div>
    <div class="filtros" style="margin-top:8px"><input id="gvtt" placeholder="Terminal (ex.: SD123456)" style="max-width:170px"><select id="gvtl">${["Ipanema", "Gávea", ...gvLojas().filter(l => !["Ipanema", "Gávea", "Não identificada"].includes(l))].map(l => `<option>${esc(l)}</option>`).join("")}</select>
      <input id="gvto" placeholder="Observação" style="max-width:170px"><button type="button" class="bt" id="gvtok">Salvar terminal</button></div>
    <h3 style="margin-top:14px">Outras vendas lançadas</h3><div class="tw" style="max-height:30vh"><table><thead><tr><th>Mês</th><th>Loja</th><th class="num">Valor</th><th>Descrição</th><th></th></tr></thead><tbody>
      ${out.map(o => `<tr><td>${dataBR(o.data)}</td><td>${esc(o.loja)}</td><td class="num">${brl(o.valor)}</td><td>${esc(o.descricao)}</td><td><button type="button" class="bt gvod" data-id="${o.id}">✕</button></td></tr>`).join("") || '<tr><td colspan="5" class="mut">Nenhuma.</td></tr>'}
    </tbody></table></div>
    <div id="gvterr"></div><div class="acoes"><button type="button" class="bt pri" id="gvtx">Fechar</button></div>`;
  $("gvtx").onclick = () => { $("dlg").close(); render(); };
  $("gvtok").onclick = async () => {
    try { checar(await sb.rpc("lin_ger_terminal_salvar", { p_terminal: $("gvtt").value, p_loja: $("gvtl").value, p_observacao: $("gvto").value })); await gvCarregar(true); gvTerminais(); }
    catch (e) { $("gvterr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
  document.querySelectorAll(".gvod").forEach(b => b.onclick = async () => {
    const m = prompt("Excluir esta outra venda? Escreva o motivo:"); if (m === null) return;
    try { checar(await sb.rpc("lin_ger_outra_venda_excluir", { p_id: Number(b.dataset.id), p_motivo: m })); await gvCarregar(true); gvTerminais(); }
    catch (e) { $("gvterr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  });
  $("dlg").classList.add("largo"); $("dlg").showModal();
}
