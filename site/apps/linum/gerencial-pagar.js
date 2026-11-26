// Sistema Linum 2.70 — Gerencial → Contas a pagar (pedido do Marco em 26/11/2026), só Dono/admin.
// Visão principal: fornecedores nas linhas, meses no cabeçalho, em cada célula o que vence no mês para aquele fornecedor;
// clicar no valor abre o desmembramento (parcelas), onde se dá baixa, edita, cancela ou reabre.
// Fontes: NF-e de compra do Buscador de NF (as duplicatas do XML guardado; a nota precisa estar completa) e o XML importado à
// mão; contas sem NF-e lançadas à mão, com repetição mensal. "Contas recorrentes": o histórico dos extratos do Gerencial
// (e as contas pagas sem extrato) mostra o que se repete todo mês e gera as próximas com a média (valor estimado, "~").
// Grava pelas funções lin_ger_pagar_* (auditoria no servidor). Usa as globais do index.html e do gerencial.js
// (sb, $, esc, checar, msg, brl, n, dataBR, hoje, todas, semAc, quando, GER, gerCarregar, gClasses, gDoc, GER_MESES, GER_NEUTRAS,
// GER_CONTAS, gValor) e o /moeda.js (NERVIA_MOEDA).

const LINUM_CNPJ = "46469501000112";   // CNPJ da Linum no Buscador de NF (nf_empresas)
let GPAG = null;   // {contas, notas, lido}
const FGP = { de: null, meses: 12, ver: "aberta", q: "", tipo: "", cat: "", forns: new Set(JSON.parse(localStorage.getItem("linum-pagar-forns") || "[]")) };
let GP_PREV = null;   // parcelas lidas das NF-e, em conferência antes de gravar

(function () {
  const s = document.createElement("style");
  s.textContent = `
.gpgrade{border-collapse:separate;border-spacing:0;font-size:12.5px}
.gpgrade th,.gpgrade td{white-space:nowrap;padding:7px 5px}
.gpgrade th:first-child,.gpgrade td:first-child{position:sticky;left:0;background:var(--surface);z-index:1;white-space:normal;min-width:170px;max-width:240px}
.gpgrade td.v,.gpgrade th.v{text-align:right}
.gpgrade tfoot td{font-weight:700;border-top:2px solid var(--border)}
.gpcel{font:inherit;background:none;border:0;padding:2px 4px;border-radius:6px;cursor:pointer;color:var(--ink)}
.gpcel:hover{background:var(--accent-soft)}
.gpcel.venc{color:var(--crit);font-weight:700}.gpcel.pago{color:var(--ok)}.gpcel.est::before{content:"~ ";color:var(--ink-soft)}
.gpforn{font:inherit;background:none;border:0;padding:0;cursor:pointer;color:var(--ink);text-align:left;font-weight:600}
.gpforn:hover{color:var(--accent)}
.gpgrade th.mesatual{color:var(--accent)}
.gpsug{max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:6px;margin-top:6px}
.gpsug label{display:flex;gap:8px;align-items:flex-start;padding:4px 2px;font-size:13px}
.gpprev input[type=date]{font:inherit;font-size:12.5px}
.gpfkpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:10px 0}
.gpfkpi>div{border:1px solid var(--border);border-radius:10px;padding:8px 10px}.gpfkpi small,.gpfkpi span{display:block;color:var(--ink-soft);font-size:12px}.gpfkpi b{font-size:17px}
#dlgf h4{margin:14px 0 6px}.gpnf{border:1px solid var(--border);border-radius:8px;margin-bottom:8px;overflow-x:auto}
.gpnfcab{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;background:var(--surface-2,#f4f5f7);padding:6px 10px;font-size:13px}
@media print{.gpgrade th:first-child,.gpgrade td:first-child{position:static}}`;
  document.head.appendChild(s);
})();

// ---------------------------------------------------------------- dados
async function gpCarregar(forcar) {
  if (GPAG && !forcar && Date.now() - GPAG.lido < 120000) return;
  const [contas, notas] = await Promise.all([
    todas(() => sb.from("lin_ger_pagar").select("*").order("vencimento").order("id")),
    // NF-e de compra da Linum no Buscador (RLS do Buscador: quem tem a empresa liberada ou a equipe Nervia)
    todas(() => sb.from("nf_notas").select("id, chave, numero, emit_cnpj, emit_nome, data_emissao, valor, situacao, completo, xml_path")
      .eq("cnpj_consulta", LINUM_CNPJ).eq("tipo", "NFE").eq("papel", "recebida").order("data_emissao", { ascending: false }))
      .catch(() => null)]);
  GPAG = { contas, notas, lido: Date.now() };
}
const gpMes = d => String(d).slice(0, 7);
const gpSomaMes = (am, k) => { const [a, m] = am.split("-").map(Number); const d = new Date(Date.UTC(a, m - 1 + k, 1)); return d.toISOString().slice(0, 7); };
const gpMesCurto = am => { const [a, m] = am.split("-"); return GER_MESES[Number(m) - 1].slice(0, 3) + "/" + a.slice(2); };
const gpDocTxt = d => d && d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : d && d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : d || "";
const gpNum = v => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });   // célula da grade (em R$)
const gpForn1 = t => semAc(t).toUpperCase().replace(/[^A-Z0-9 ]/g, " ").trim().split(/\s+/)[0] || "";
// um fornecedor = mesmo CNPJ/CPF; sem documento, o nome sem acento
const gpChaveForn = c => c.fornecedor_doc || "n:" + semAc(c.fornecedor);
const gpVencida = c => c.situacao === "aberta" && c.vencimento < hoje();
const gpValor = c => Number(c.situacao === "paga" ? c.valor_pago : c.valor);
function gpSituacao(c) {
  if (c.situacao === "paga") return `<span class="tag ok">paga em ${dataBR(c.pago_em)}</span>`;
  if (c.situacao === "cancelada") return `<span class="tag">cancelada</span>`;
  if (gpVencida(c)) return `<span class="tag fora">vencida</span>`;
  const dias = Math.round((new Date(c.vencimento + "T12:00:00") - new Date(hoje() + "T12:00:00")) / 864e5);
  return dias <= 7 ? `<span class="tag lento">vence ${dias === 0 ? "hoje" : "em " + dias + " dia" + (dias > 1 ? "s" : "")}</span>` : `<span class="tag possivel">a vencer</span>`;
}

async function telaGerencialPagar() {
  if (!GPAG) $("tela").innerHTML = '<div class="card">Carregando…</div>';
  const vista = VISTA;
  try { await Promise.all([gpCarregar(), gerCarregar()]); }
  catch (e) { if (VISTA === vista) $("tela").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  if (VISTA !== vista) return;
  gerPagar();
}

// ---------------------------------------------------------------- tela principal: fornecedor × mês
function gerPagar() {
  if (!FGP.de) FGP.de = gpMes(hoje());
  const meses = Array.from({ length: FGP.meses }, (_, i) => gpSomaMes(FGP.de, i));
  const ate = gpSomaMes(FGP.de, FGP.meses);   // primeiro mês fora da janela
  const q = semAc(FGP.q);
  const visivel = c => c.situacao !== "cancelada" && (FGP.ver === "todas" || (FGP.ver === "paga" ? c.situacao === "paga" : c.situacao === "aberta"))
    && (!q || semAc(c.fornecedor + " " + c.categoria + " " + c.historico + " " + c.documento).includes(q) || c.fornecedor_doc.includes(FGP.q.replace(/\D/g, "") || "§"));
  const comNf = c => !!(c.documento || c.nfe_chave);
  const todas_ = GPAG.contas.filter(visivel).filter(c => (!FGP.tipo || (FGP.tipo === "nf" ? comNf(c) : !comNf(c)))
    && (!FGP.cat || c.categoria === FGP.cat) && (!FGP.forns.size || FGP.forns.has(gpChaveForn(c))));
  const naJanela = todas_.filter(c => { const m = gpMes(c.vencimento); return m >= FGP.de && m < ate; });
  const vencAntes = FGP.ver !== "paga" ? todas_.filter(c => gpVencida(c) && gpMes(c.vencimento) < FGP.de) : [];
  const usa = naJanela.concat(vencAntes);
  // linhas = fornecedores
  const linhas = new Map();
  usa.forEach(c => {
    const k = gpChaveForn(c);
    const L = linhas.get(k) || { k, nome: c.fornecedor, doc: c.fornecedor_doc, cont: [], ult: "" };
    if (c.vencimento >= L.ult) { L.nome = c.fornecedor; L.ult = c.vencimento; }
    L.cont.push(c); linhas.set(k, L);
  });
  const ord = [...linhas.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const celula = (ls, chaveDlg) => {
    if (!ls.length) return "";
    const v = ls.reduce((a, c) => a + gpValor(c), 0);
    const cls = ls.some(gpVencida) ? "venc" : ls.every(c => c.situacao === "paga") ? "pago" : "";
    return `<button type="button" class="gpcel ${cls} ${ls.some(c => c.estimado && c.situacao === "aberta") ? "est" : ""}" data-gp="${esc(chaveDlg)}" title="${ls.length} conta(s) — clique para ver">${gpNum(v)}</button>`;
  };
  const GRUPOS = {};   // chave do clique → contas
  const reg = (k, ls) => { GRUPOS[k] = ls; return k; };
  const totMes = meses.map(m => naJanela.filter(c => gpMes(c.vencimento) === m));
  const corpo = ord.map((L, i) => {
    const venc = L.cont.filter(c => gpMes(c.vencimento) < FGP.de);
    const porMes = meses.map(m => L.cont.filter(c => gpMes(c.vencimento) === m));
    const tot = L.cont.reduce((a, c) => a + gpValor(c), 0);
    return `<tr><td><button type="button" class="gpforn" data-gp="${reg("f" + i, L.cont)}">${esc(L.nome)}</button>${L.doc ? `<div class="mut">${esc(gpDocTxt(L.doc))}</div>` : ""}</td>
      ${vencAntes.length ? `<td class="v">${celula(venc, reg("fv" + i, venc))}</td>` : ""}
      ${porMes.map((ls, j) => `<td class="v">${celula(ls, reg("c" + i + "_" + j, ls))}</td>`).join("")}
      <td class="v"><b>${gpNum(tot)}</b></td></tr>`;
  }).join("");
  const totGeral = usa.reduce((a, c) => a + gpValor(c), 0);
  const rod = `<tr><td>Total</td>${vencAntes.length ? `<td class="v">${celula(vencAntes, reg("tv", vencAntes))}</td>` : ""}
    ${totMes.map((ls, j) => `<td class="v">${celula(ls, reg("t" + j, ls))}</td>`).join("")}<td class="v">${gpNum(totGeral)}</td></tr>`;

  // indicadores (sempre sobre as contas em aberto, sem filtro de janela)
  const ab = GPAG.contas.filter(c => c.situacao === "aberta");
  const vencidas = ab.filter(gpVencida);
  const em7 = ab.filter(c => !gpVencida(c) && c.vencimento <= new Date(Date.parse(hoje() + "T12:00:00") + 7 * 864e5).toISOString().slice(0, 10));
  const doMes = ab.filter(c => gpMes(c.vencimento) === gpMes(hoje()));
  const pagoMes = GPAG.contas.filter(c => c.situacao === "paga" && gpMes(c.pago_em) === gpMes(hoje()));
  const est = ab.filter(c => c.estimado);
  const s = ls => ls.reduce((a, c) => a + gpValor(c), 0);
  const pendNf = gpNotasPendentes();
  const recs = gpRecorrentes().filter(r => r.mensal && !r.jaTem);

  const opMes = [];
  const ini = [GPAG.contas[0] ? gpMes(GPAG.contas[0].vencimento) : gpMes(hoje()), gpSomaMes(gpMes(hoje()), -12)].sort()[0];
  for (let m = ini; m <= gpSomaMes(gpMes(hoje()), 24); m = gpSomaMes(m, 1)) opMes.push(m);
  $("tela").innerHTML = `
    <div class="cabtela"><h2>Gerencial · Contas a pagar</h2><span class="noprint">
      <button class="bt" id="gpnova">+ Conta a pagar</button>
      <button class="bt" id="gpimp">Importar NF-e${pendNf.length ? ` (${pendNf.length})` : ""}</button>
      <button class="bt" id="gprec">Contas recorrentes${recs.length ? ` (${recs.length})` : ""}</button>
      <button class="bt" id="gpcsv">Baixar CSV</button><button class="bt" id="gpprint">Imprimir</button></span></div>
    ${pendNf.length ? `<div class="msg info noprint">${n(pendNf.length)} NF-e de compra no Buscador de NF ainda não ${pendNf.length > 1 ? "estão" : "está"} aqui. <button class="lnk" id="gpimp2">Importar as parcelas</button></div>` : ""}
    ${GPAG.notas === null ? `<div class="msg info noprint">Sem acesso às notas da Linum no Buscador de NF: importe o XML da NF-e pelo botão Importar NF-e.</div>` : ""}
    <div class="kpis">
      <div class="kpi"><small>Vencidas</small><b class="${vencidas.length ? "gneg" : ""}">${brl(s(vencidas))}</b><span>${n(vencidas.length)} conta(s) em aberto</span></div>
      <div class="kpi"><small>Vencem em 7 dias</small><b>${brl(s(em7))}</b><span>${n(em7.length)} conta(s)</span></div>
      <div class="kpi"><small>A pagar em ${GER_MESES[Number(hoje().slice(5, 7)) - 1].toLowerCase()}</small><b>${brl(s(doMes))}</b><span>${n(doMes.length)} conta(s) em aberto</span></div>
      <div class="kpi"><small>Pago em ${GER_MESES[Number(hoje().slice(5, 7)) - 1].toLowerCase()}</small><b class="gpos">${brl(s(pagoMes))}</b><span>${n(pagoMes.length)} conta(s)</span></div>
      <div class="kpi"><small>Em aberto (tudo)</small><b>${brl(s(ab))}</b><span>${n(ab.length)} conta(s)${est.length ? ` · ${n(est.length)} com valor estimado` : ""}</span></div>
    </div>
    <div class="filtros noprint">
      <label>A partir de <select id="gpde">${opMes.map(m => `<option value="${m}" ${m === FGP.de ? "selected" : ""}>${gpMesCurto(m)}</option>`).join("")}</select></label>
      <select id="gpqt" aria-label="Meses">${[6, 12, 18, 24].map(x => `<option value="${x}" ${x === FGP.meses ? "selected" : ""}>${x} meses</option>`).join("")}</select>
      <select id="gpver" aria-label="Mostrar"><option value="aberta" ${FGP.ver === "aberta" ? "selected" : ""}>Em aberto</option><option value="todas" ${FGP.ver === "todas" ? "selected" : ""}>Em aberto e pagas</option><option value="paga" ${FGP.ver === "paga" ? "selected" : ""}>Só pagas</option></select>
      <select id="gptipo" aria-label="Tipo"><option value="">Todas as contas</option><option value="nf" ${FGP.tipo === "nf" ? "selected" : ""}>Só com NF (fornecedores)</option><option value="sem" ${FGP.tipo === "sem" ? "selected" : ""}>Sem NF (aluguel, contas)</option></select>
      <select id="gpcat" aria-label="Categoria"><option value="">Todas as categorias</option>${[...new Set(GPAG.contas.map(c => c.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")).map(c => `<option ${c === FGP.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <button type="button" class="bt ${FGP.forns.size ? "pri" : ""}" id="gpfs">${FGP.forns.size ? `Fornecedores escolhidos (${FGP.forns.size})` : "Escolher fornecedores"}</button>
      <input id="gpq" placeholder="Buscar fornecedor, categoria, NF…" value="${esc(FGP.q)}">
    </div>
    <div class="mut" style="margin-bottom:6px">Valores em R$ de cada fornecedor no mês do vencimento. Clique no valor para ver as parcelas, dar baixa ou corrigir; clique no nome para a ficha do fornecedor. <span style="color:var(--crit);font-weight:700">Vermelho</span> = vencida em aberto; <span style="color:var(--ok)">verde</span> = paga; “~” = valor estimado (conta recorrente, a confirmar).${vencAntes.length ? " A coluna Vencidas junta o que venceu antes de " + gpMesCurto(FGP.de) + " e não foi pago." : ""}</div>
    <div class="card"><div class="tw">${ord.length ? `<table class="gpgrade"><thead><tr><th>Fornecedor</th>${vencAntes.length ? '<th class="v" style="color:var(--crit)">Vencidas</th>' : ""}
      ${meses.map(m => `<th class="v ${m === gpMes(hoje()) ? "mesatual" : ""}">${gpMesCurto(m)}</th>`).join("")}<th class="v">Total</th></tr></thead>
      <tbody>${corpo}</tbody><tfoot>${rod}</tfoot></table>` : `<div class="vazio">Nenhuma conta ${FGP.ver === "paga" ? "paga" : "a pagar"} nesse período.${GPAG.contas.length ? "" : " Comece importando as NF-e, lançando uma conta ou gerando as contas recorrentes."}</div>`}</div></div>`;

  $("gpde").onchange = e => { FGP.de = e.target.value; gerPagar(); };
  $("gpqt").onchange = e => { FGP.meses = Number(e.target.value); gerPagar(); };
  $("gpver").onchange = e => { FGP.ver = e.target.value; gerPagar(); };
  $("gptipo").onchange = e => { FGP.tipo = e.target.value; gerPagar(); };
  $("gpcat").onchange = e => { FGP.cat = e.target.value; gerPagar(); };
  $("gpfs").onclick = gpEscolherForns;
  $("gpq").oninput = e => { FGP.q = e.target.value; clearTimeout(gerPagar.t); gerPagar.t = setTimeout(() => { gerPagar(); const i = $("gpq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); };
  document.querySelectorAll(".gpforn[data-gp]").forEach(b => b.onclick = () => gpFicha(gpChaveForn(GRUPOS[b.dataset.gp][0])));
  document.querySelectorAll(".gpcel[data-gp]").forEach(b => b.onclick = () => {
    const ls = GRUPOS[b.dataset.gp]; const k = b.dataset.gp;
    const forn = k.startsWith("f") || k.startsWith("c") ? ls[0].fornecedor : "Todos os fornecedores";
    const per = k.startsWith("c") || k.startsWith("t") && k !== "tv" ? gpMesCurto(gpMes(ls[0].vencimento)) : k.endsWith("v") || k.startsWith("fv") ? "vencidas antes de " + gpMesCurto(FGP.de) : "";
    gpDetalhe(ls.map(c => c.id), forn + (per ? " · " + per : ""));
  });
  $("gpnova").onclick = () => gpEditar(null);
  $("gpimp").onclick = gpImportar;
  if ($("gpimp2")) $("gpimp2").onclick = gpImportar;
  $("gprec").onclick = gpTelaRecorrentes;
  $("gpprint").onclick = () => window.print();
  $("gpcsv").onclick = () => {
    const c = x => `"${String(x ?? "").replace(/"/g, '""')}"`, num = x => x == null ? "" : Number(x).toFixed(2).replace(".", ",");
    const l = [["Vencimento", "Fornecedor", "CNPJ/CPF", "Documento", "Parcela", "Categoria", "Histórico", "Valor", "Estimado", "Situação", "Pago em", "Valor pago", "Origem"].map(c).join(";"),
      ...usa.sort((a, b) => a.vencimento.localeCompare(b.vencimento)).map(x => [dataBR(x.vencimento), x.fornecedor, gpDocTxt(x.fornecedor_doc), x.documento, x.parcela, x.categoria, x.historico,
        num(x.valor), x.estimado ? "sim" : "", gpVencida(x) ? "vencida" : x.situacao, x.pago_em ? dataBR(x.pago_em) : "", num(x.valor_pago), { nfe: "NF-e", manual: "à mão", carga: "painel antigo" }[x.origem]].map(c).join(";"))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + l.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `linum-contas-a-pagar-${FGP.de}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}

// ---------------------------------------------------------------- desmembramento de um valor (ou de um fornecedor)
function gpDetalhe(ids, titulo) {
  const ls = GPAG.contas.filter(c => ids.includes(c.id)).sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.id - b.id);
  const tot = ls.reduce((a, c) => a + gpValor(c), 0);
  const g = $("dlgf");
  g.innerHTML = `<h3>${esc(titulo)}</h3><div class="mut">${n(ls.length)} conta(s) · total ${brl(tot)}</div>
    <div class="tw"><table><thead><tr><th></th><th>Vencimento</th><th>Fornecedor</th><th>Documento</th><th>Histórico</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>
    ${ls.map(c => `<tr><td>${c.situacao === "aberta" ? `<input type="checkbox" class="gpsel" data-id="${c.id}" aria-label="Marcar">` : ""}</td>
      <td>${dataBR(c.vencimento)}</td><td>${esc(c.fornecedor)}</td>
      <td>${c.documento ? "NF " + esc(c.documento) : ""}${c.parcela ? ` <span class="mut">parc. ${esc(c.parcela)}</span>` : ""}</td>
      <td>${esc(c.historico || "")}${c.categoria ? `<div class="mut">${esc(c.categoria)}</div>` : ""}</td>
      <td class="num">${c.estimado && c.situacao === "aberta" ? '<span class="mut" title="valor estimado (média)">~ </span>' : ""}${brl(gpValor(c))}${c.situacao === "paga" && Number(c.valor_pago) !== Number(c.valor) ? `<div class="mut">parcela ${brl(c.valor)}</div>` : ""}</td>
      <td>${gpSituacao(c)}${c.situacao === "cancelada" && c.cancelado_motivo ? `<div class="mut">${esc(c.cancelado_motivo)}</div>` : ""}${c.situacao === "paga" && c.lancamento_id ? `<div class="mut">${esc(gpLancTxt(c.lancamento_id))}</div>` : ""}</td>
      <td style="white-space:nowrap">${c.situacao === "aberta" ? `<button type="button" class="lnk" data-pg="${c.id}">Pagar</button> · <button type="button" class="lnk" data-ed="${c.id}">Editar</button> · <button type="button" class="lnk perigo" data-ca="${c.id}">Cancelar</button>`
        : `<button type="button" class="lnk" data-re="${c.id}">Reabrir</button>`}</td></tr>`).join("")}
    </tbody></table></div>
    <div id="gperr"></div>
    <div class="acoes"><button type="button" class="bt" id="gpdx">Fechar</button><button type="button" class="bt pri" id="gpdb" disabled>Dar baixa nas marcadas</button></div>`;
  const voltar = () => { gpDetalhe(ids, titulo); };
  const sel = () => [...document.querySelectorAll(".gpsel:checked")].map(x => Number(x.dataset.id));
  document.querySelectorAll(".gpsel").forEach(x => x.onchange = () => { const k = sel(); $("gpdb").disabled = !k.length; $("gpdb").textContent = k.length > 1 ? `Dar baixa nas ${k.length} marcadas` : "Dar baixa na marcada"; });
  $("gpdx").onclick = () => $("dlg").close();
  $("gpdb").onclick = () => gpBaixa(sel(), voltar);
  g.querySelectorAll("[data-pg]").forEach(b => b.onclick = () => gpBaixa([Number(b.dataset.pg)], voltar));
  g.querySelectorAll("[data-ed]").forEach(b => b.onclick = () => gpEditar(GPAG.contas.find(c => c.id === Number(b.dataset.ed)), null, voltar));
  g.querySelectorAll("[data-ca], [data-re]").forEach(b => b.onclick = async () => {
    const cancelar = !!b.dataset.ca, id = Number(b.dataset.ca || b.dataset.re);
    const m = prompt(cancelar ? "Cancelar esta conta (ela some das contas a pagar, mas fica no histórico).\nEscreva o motivo:" : "Reabrir esta conta (volta a ficar em aberto; o pagamento registrado é desfeito).\nEscreva o motivo:");
    if (m === null) return;
    try {
      checar(await sb.rpc("lin_ger_pagar_situacao", { p_id: id, p_acao: cancelar ? "cancelar" : "reabrir", p_motivo: m }));
      await gpCarregar(true); msg("ok", cancelar ? "Conta cancelada." : "Conta reaberta."); gerPagar(); voltar();
    } catch (e) { $("gperr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  });
  $("dlg").classList.add("largo"); if (!$("dlg").open) $("dlg").showModal();
}
function gpLancTxt(id) {
  const l = GER && GER.lanc.find(x => x.id === id);
  return l ? `${GER_CONTAS[l.conta]} ${dataBR(l.data)} · ${l.descricao.slice(0, 60)}` : "lançamento do extrato";
}

// ---------------------------------------------------------------- baixa: data, valor e o lançamento do extrato (sugerido)
function gpSugestoes(cs) {
  if (!GER) return [];
  const soma = cs.reduce((a, c) => a + Number(c.valor), 0);
  const docs = [...new Set(cs.map(c => c.fornecedor_doc).filter(Boolean))];
  const nomes = [...new Set(cs.map(c => gpForn1(c.fornecedor)).filter(x => x.length >= 3))];
  const v0 = cs.map(c => c.vencimento).sort()[0], v1 = cs.map(c => c.vencimento).sort().pop();
  const dmin = new Date(Date.parse(v0 + "T12:00:00") - 20 * 864e5).toISOString().slice(0, 10);
  const dmax = new Date(Date.parse(v1 + "T12:00:00") + 60 * 864e5).toISOString().slice(0, 10);
  const usados = new Set(GPAG.contas.filter(c => c.lancamento_id && !cs.includes(c)).map(c => c.lancamento_id));
  return GER.lanc.filter(l => Number(l.debito) > 0 && l.data >= dmin && l.data <= dmax && !GER_NEUTRAS.includes(l.classe))
    .map(l => {
      const d = l.descricao.replace(/\D/g, ""), txt = semAc(l.descricao).toUpperCase();
      const porDoc = docs.some(x => d.includes(x) || (x.length === 14 && d.includes(x.slice(0, 8))));
      const porNome = nomes.some(x => txt.includes(x));
      const dv = Math.abs(Number(l.debito) - soma);
      return { l, porDoc, porNome, dv, usado: usados.has(l.id), dd: Math.abs(Date.parse(l.data) - Date.parse(v0)) / 864e5 };
    })
    .filter(x => x.porDoc || x.porNome || x.dv < 0.01)
    .sort((a, b) => (a.dv < 0.01 ? 0 : 1) - (b.dv < 0.01 ? 0 : 1) || (b.porDoc - a.porDoc) || a.dd - b.dd).slice(0, 12);
}
function gpBaixa(ids, voltar) {
  const cs = GPAG.contas.filter(c => ids.includes(c.id));
  const soma = cs.reduce((a, c) => a + Number(c.valor), 0);
  const sug = gpSugestoes(cs);
  const ultExtrato = GER ? GER.lanc.reduce((m, l) => l.data > m ? l.data : m, "") : "";
  const g = $("dlg2f");
  g.innerHTML = `<h3>Dar baixa ${cs.length > 1 ? `em ${cs.length} contas` : ""}</h3>
    <div class="mut">${cs.map(c => `${esc(c.fornecedor)} · venc. ${dataBR(c.vencimento)}${c.documento ? " · NF " + esc(c.documento) : ""}${c.parcela ? " parc. " + esc(c.parcela) : ""} · ${c.estimado ? "~ " : ""}${brl(c.valor)}`).join("<br>")}</div>
    ${cs.length > 1 ? `<div style="margin-top:6px"><b>Total ${brl(soma)}</b></div>` : ""}
    <label class="campo">Pago em<input type="date" id="gpbd" max="${hoje()}" value="${hoje()}"></label>
    ${cs.length === 1 ? `<label class="campo">Valor pago (R$)<input id="gpbv" data-moeda inputmode="decimal" value="${NERVIA_MOEDA.fmt(cs[0].valor)}"></label>
      ${cs[0].estimado ? '<div class="mut">Valor estimado pela média: troque pelo valor que foi pago.</div>' : ""}` : ""}
    <div class="campo"><b>Lançamento do extrato que pagou</b> <span class="mut">(opcional; extratos importados até ${ultExtrato ? dataBR(ultExtrato) : "—"})</span>
      <div class="gpsug">
        <label><input type="radio" name="gpbl" value="" ${sug.length ? "" : "checked"}> Sem lançamento do extrato (pago fora do banco ou o extrato ainda não foi importado)</label>
        ${sug.map((x, i) => `<label><input type="radio" name="gpbl" value="${x.l.id}" ${i === 0 && (x.dv < 0.01 || x.porDoc) && !x.usado ? "checked" : ""}>
          <span>${dataBR(x.l.data)} · ${GER_CONTAS[x.l.conta]} · <b>${brl(x.l.debito)}</b>${x.dv < 0.01 ? ' <span class="tag ok">mesmo valor</span>' : ""}${x.porDoc ? ' <span class="tag">mesmo CNPJ</span>' : ""}${x.usado ? ' <span class="tag lento">já ligado a outra conta</span>' : ""}<br><span class="mut">${esc(x.l.descricao)}</span></span></label>`).join("")}
      </div></div>
    <label class="campo">Observação<input id="gpbo" maxlength="300" placeholder="opcional (ex.: pago com desconto, pago pela sócia)"></label>
    <div id="gpberr"></div>
    <div class="acoes"><button type="button" class="bt" id="gpbx">Voltar</button><button type="button" class="bt pri" id="gpbok">Confirmar pagamento</button></div>`;
  const marcar = () => { const r = g.querySelector("input[name=gpbl]:checked"); const l = r && r.value && GER.lanc.find(x => x.id === Number(r.value)); if (l && l.data <= hoje()) $("gpbd").value = l.data; };
  g.querySelectorAll("input[name=gpbl]").forEach(r => r.onchange = marcar); marcar();
  $("gpbx").onclick = () => $("dlg2").close();
  $("gpbok").onclick = async () => {
    try {
      $("gpbok").disabled = true;
      const r = g.querySelector("input[name=gpbl]:checked");
      const p = { ids, pago_em: $("gpbd").value, lancamento_id: r && r.value ? Number(r.value) : null, obs: $("gpbo").value };
      if (cs.length === 1) { const v = NERVIA_MOEDA.valor($("gpbv").value, "Valor pago"); if (v != null && Math.abs(v - Number(cs[0].valor)) >= 0.005) p.valor_pago = v; }
      checar(await sb.rpc("lin_ger_pagar_baixa", { p }));
      $("dlg2").close(); await gpCarregar(true); msg("ok", `${cs.length > 1 ? cs.length + " contas pagas" : "Conta paga"}.`); gerPagar(); if (voltar) voltar();
    } catch (e) { $("gpbok").disabled = false; $("gpberr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
  $("dlg2").showModal();
}

// ---------------------------------------------------------------- conta à mão (nova, edição ou gerada pelas recorrentes)
function gpEditar(c, pre, voltar) {
  const F = c || Object.assign({ fornecedor: "", fornecedor_doc: "", documento: "", parcela: "", vencimento: "", valor: "", categoria: "", historico: "", estimado: false }, pre || {});
  const forns = [...new Set(GPAG.contas.map(x => x.fornecedor))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const dlg = c ? "dlg2" : "dlg", g = $(dlg + "f");
  g.innerHTML = `<h3>${c ? "Editar conta a pagar" : pre ? "Gerar conta recorrente" : "Nova conta a pagar"}</h3>
    ${pre && pre.aviso ? `<div class="mut">${esc(pre.aviso)}</div>` : ""}
    <datalist id="gpdlf">${forns.map(x => `<option value="${esc(x)}">`).join("")}</datalist>
    <datalist id="gpdlc">${gClasses().map(x => `<option value="${esc(x)}">`).join("")}</datalist>
    <label class="campo">Fornecedor<input id="gpef" list="gpdlf" value="${esc(F.fornecedor)}" maxlength="200" placeholder="ex.: Light, Imobiliária…"></label>
    <label class="campo">CNPJ/CPF <span class="mut">(opcional)</span><input id="gped" value="${esc(gpDocTxt(F.fornecedor_doc))}" maxlength="20"></label>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <label class="campo" style="flex:1">Vencimento${c ? "" : " (do 1º)"}<input type="date" id="gpev" value="${esc(F.vencimento)}"></label>
      <label class="campo" style="flex:1">Valor (R$)<input id="gpeval" data-moeda inputmode="decimal" value="${F.valor === "" ? "" : NERVIA_MOEDA.fmt(F.valor)}"></label></div>
    <label class="chk campo"><input type="checkbox" id="gpeest" ${F.estimado ? "checked" : ""}> Valor estimado (muda todo mês, como a conta de luz): aparece com “~” até ser confirmado</label>
    ${c ? "" : `<label class="campo">Repetir todo mês por <select id="gper">${[1, 2, 3, 6, 12, 18, 24, 36].map(x => `<option value="${x}" ${x === (F.repetir || 1) ? "selected" : ""}>${x === 1 ? "não repetir (só esta)" : x + " meses"}</option>`).join("")}</select></label>`}
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <label class="campo" style="flex:1">Documento <span class="mut">(nº da NF ou boleto)</span><input id="gpedoc" value="${esc(F.documento)}" maxlength="60"></label>
      ${c ? `<label class="campo" style="flex:1">Parcela<input id="gpep" value="${esc(F.parcela)}" maxlength="20"></label>` : ""}</div>
    <label class="campo">Categoria<input id="gpec" list="gpdlc" value="${esc(F.categoria)}" maxlength="80" placeholder="ex.: Aluguel, Energia Elétrica, Insumos"></label>
    <label class="campo">Histórico<input id="gpeh" value="${esc(F.historico)}" maxlength="500" placeholder="ex.: Aluguel + condomínio loja 111"></label>
    <div id="gpeerr"></div>
    <div class="acoes"><button type="button" class="bt" id="gpex">${voltar ? "Voltar" : "Cancelar"}</button><button type="button" class="bt pri" id="gpeok">Salvar</button></div>`;
  $("gpeval").oninput = () => { if (c && c.estimado) $("gpeest").checked = false; };
  $("gpex").onclick = () => { $(dlg).close(); };
  $("gpeok").onclick = async () => {
    try {
      $("gpeok").disabled = true;
      const p = { fornecedor: $("gpef").value, fornecedor_doc: $("gped").value, vencimento: $("gpev").value, valor: NERVIA_MOEDA.valor($("gpeval").value, "Valor"),
        estimado: $("gpeest").checked, documento: $("gpedoc").value, categoria: $("gpec").value, historico: $("gpeh").value };
      if (c) { p.id = c.id; p.parcela = $("gpep").value; } else p.repetir = Number($("gper").value);
      const r = checar(await sb.rpc("lin_ger_pagar_salvar", { p }));
      $(dlg).close(); await gpCarregar(true);
      msg("ok", c ? "Conta alterada." : r > 1 ? `${r} contas lançadas (uma por mês).` : "Conta lançada."); gerPagar();
      if (voltar) voltar(); else if (pre && pre.depois) pre.depois();
    } catch (e) { $("gpeok").disabled = false; $("gpeerr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
  if (dlg === "dlg") $("dlg").classList.remove("largo");
  if (!$(dlg).open) $(dlg).showModal();
}

// ---------------------------------------------------------------- NF-e → parcelas
// lê o XML (nota sozinha ou nfeProc): chave, número, emissão, emitente, destinatário, valor e as duplicatas (cobr/dup)
function gpLerNfe(txt) {
  const x = new DOMParser().parseFromString(txt, "application/xml");
  if (x.getElementsByTagName("parsererror").length) throw new Error("O arquivo não é um XML válido");
  const um = (el, t) => el ? el.getElementsByTagNameNS("*", t)[0] || null : null;
  const tx = (el, t) => { const e = um(el, t); return e ? e.textContent.trim() : ""; };
  const inf = um(x, "infNFe");
  if (!inf) throw new Error("O XML não é de uma NF-e");
  const ide = um(inf, "ide"), emit = um(inf, "emit"), dest = um(inf, "dest");
  const chave = (inf.getAttribute("Id") || "").replace(/^NFe/, "") || tx(x, "chNFe");
  const dups = [...(um(inf, "cobr") ? um(inf, "cobr").getElementsByTagNameNS("*", "dup") : [])]
    .map(d => ({ nDup: tx(d, "nDup"), venc: tx(d, "dVenc").slice(0, 10), valor: Number(tx(d, "vDup")) }));
  return { chave, numero: tx(ide, "nNF"), emissao: (tx(ide, "dhEmi") || tx(ide, "dEmi")).slice(0, 10), fornecedor: tx(emit, "xNome"),
    doc: tx(emit, "CNPJ") || tx(emit, "CPF"), dest: tx(dest, "CNPJ") || tx(dest, "CPF"), valor: Number(tx(um(inf, "ICMSTot"), "vNF")), dups };
}
function gpParcelas(nf) {
  const base = { fornecedor: nf.fornecedor, fornecedor_doc: nf.doc, documento: nf.numero, nfe_chave: nf.chave, nota: nf };
  if (!nf.dups.length) return [{ ...base, chave: `nfe|${nf.chave}|unica`, parcela: "", vencimento: "", valor: nf.valor, semDup: true }];
  const tot = nf.dups.length;
  const parc = (d, i) => /^\d+$/.test(d.nDup) ? `${Number(d.nDup)}/${tot}` : d.nDup || `${i + 1}/${tot}`;
  return nf.dups.map((d, i) => ({ ...base, chave: `nfe|${nf.chave}|${d.nDup || i + 1}`, parcela: parc(d, i), vencimento: d.venc, valor: d.valor }));
}
const gpChavesImportadas = () => new Set(GPAG.contas.filter(c => c.nfe_chave).map(c => c.nfe_chave));
function gpNotasPendentes() {
  if (!GPAG.notas) return [];
  const ja = gpChavesImportadas();
  // nota já tratada: chave importada ou a mesma NF do mesmo fornecedor vinda da carga do painel antigo
  const antigas = new Set(GPAG.contas.filter(c => c.documento).map(c => c.documento.replace(/^0+/, "") + "|" + gpForn1(c.fornecedor)));
  return GPAG.notas.filter(nf => nf.situacao !== "cancelada" && !ja.has(nf.chave) && !antigas.has(String(nf.numero).replace(/^0+/, "") + "|" + gpForn1(nf.emit_nome)));
}
function gpImportar() {
  const pend = gpNotasPendentes();
  const g = $("dlgf");
  g.innerHTML = `<h3>Importar NF-e (parcelas a pagar)</h3>
    <div class="mut">Cada duplicata da nota (parcela, vencimento e valor) vira uma conta a pagar. Nota sem duplicatas vira uma conta só, com o valor da nota: informe o vencimento.</div>
    <div class="caixa"><b>NF-e de compra no Buscador de NF</b>
      ${GPAG.notas === null ? '<div class="mut">Sem acesso às notas da Linum no Buscador de NF.</div>'
        : pend.length ? `<div class="tw"><table><thead><tr><th><input type="checkbox" id="gpntodas" checked aria-label="Todas"></th><th>Emissão</th><th>Fornecedor</th><th>NF</th><th class="num">Valor</th><th></th></tr></thead><tbody>
          ${pend.map(nf => `<tr><td>${nf.completo ? `<input type="checkbox" class="gpnf" value="${nf.id}" checked aria-label="Marcar">` : ""}</td><td>${dataBR(nf.data_emissao)}</td><td>${esc(nf.emit_nome || "")}</td><td>${esc(nf.numero || "")}</td><td class="num">${brl(nf.valor)}</td>
            <td>${nf.completo ? "" : '<span class="tag lento" title="O XML completo só vem depois da Ciência da Operação no Buscador de NF">só resumo: falta a ciência</span>'}</td></tr>`).join("")}</tbody></table></div>
          <div class="acoes" style="justify-content:flex-start"><button type="button" class="bt pri" id="gpnler">Ler as notas marcadas</button></div>`
        : '<div class="mut">Todas as NF-e de compra do Buscador já estão nas contas a pagar.</div>'}
    </div>
    <div class="caixa"><b>XML recebido por e-mail</b>
      <div class="mut">Escolha um ou mais arquivos .xml da NF-e (o fornecedor manda junto com a nota).</div>
      <input type="file" id="gpxml" accept=".xml,text/xml,application/xml" multiple style="margin-top:6px"></div>
    <div id="gpierr"></div>
    <div class="acoes"><button type="button" class="bt" id="gpix">Fechar</button></div>`;
  $("gpix").onclick = () => $("dlg").close();
  if ($("gpntodas")) $("gpntodas").onchange = e => document.querySelectorAll(".gpnf").forEach(x => x.checked = e.target.checked);
  if ($("gpnler")) $("gpnler").onclick = async () => {
    const ids = [...document.querySelectorAll(".gpnf:checked")].map(x => Number(x.value));
    if (!ids.length) return;
    $("gpnler").disabled = true; $("gpnler").textContent = "Lendo…";
    const parc = [], erros = [];
    for (const nf of GPAG.notas.filter(x => ids.includes(x.id))) {
      try {
        const { data, error } = await sb.storage.from("nf-xml").download(nf.xml_path);
        if (error) throw error;
        parc.push(...gpParcelas(gpLerNfe(await data.text())));
      } catch (e) { erros.push(`NF ${nf.numero}: ${e.message || e}`); }
    }
    gpConferir(parc, "Buscador de NF", erros);
  };
  $("gpxml").onchange = async e => {
    const parc = [], erros = [];
    for (const f of e.target.files) {
      try {
        const nf = gpLerNfe(await f.text());
        if (nf.dest && nf.dest !== LINUM_CNPJ && nf.dest.slice(0, 8) !== LINUM_CNPJ.slice(0, 8)) erros.push(`${f.name}: a nota é para outro CNPJ (${gpDocTxt(nf.dest)}), não para a Linum — conferir.`);
        parc.push(...gpParcelas(nf));
      } catch (er) { erros.push(`${f.name}: ${er.message}`); }
    }
    gpConferir(parc, [...e.target.files].map(f => f.name).join(", "), erros);
  };
  $("dlg").classList.add("largo"); if (!$("dlg").open) $("dlg").showModal();
}
function gpConferir(parc, arquivo, erros) {
  const ja = new Set(GPAG.contas.map(c => c.chave).filter(Boolean));
  parc.forEach(p => { p.repetida = ja.has(p.chave); });
  GP_PREV = { parc, arquivo };
  const novas = parc.filter(p => !p.repetida);
  const g = $("dlgf");
  g.innerHTML = `<h3>Conferir as parcelas</h3>
    ${erros.length ? `<div class="msg err">${erros.map(esc).join("<br>")}</div>` : ""}
    ${parc.length ? `<div class="tw gpprev"><table><thead><tr><th></th><th>Fornecedor</th><th>NF</th><th>Parcela</th><th>Vencimento</th><th class="num">Valor</th></tr></thead><tbody>
      ${parc.map((p, i) => `<tr><td>${p.repetida ? "" : `<input type="checkbox" class="gpps" data-i="${i}" checked aria-label="Importar">`}</td><td>${esc(p.fornecedor)}<div class="mut">${esc(gpDocTxt(p.fornecedor_doc))}</div></td>
        <td>${esc(p.documento)}<div class="mut">emitida ${dataBR(p.nota.emissao)}</div></td><td>${esc(p.parcela || "única")}</td>
        <td>${p.repetida ? dataBR(p.vencimento) : `<input type="date" class="gppv" data-i="${i}" value="${esc(p.vencimento)}">`}${p.semDup && !p.repetida ? '<div class="mut">a nota não traz duplicatas</div>' : ""}</td>
        <td class="num">${brl(p.valor)}${p.repetida ? '<div class="mut">já importada</div>' : ""}</td></tr>`).join("")}</tbody></table></div>
      <div class="mut">${n(novas.length)} parcela(s) nova(s), total ${brl(novas.reduce((a, p) => a + p.valor, 0))}.</div>`
      : '<div class="mut">Nenhuma parcela lida.</div>'}
    <label class="campo">Categoria <span class="mut">(opcional, vale para todas)</span><input id="gppc" list="gpdlc2" placeholder="ex.: Insumos"><datalist id="gpdlc2">${gClasses().map(x => `<option value="${esc(x)}">`).join("")}</datalist></label>
    <div id="gpperr"></div>
    <div class="acoes"><button type="button" class="bt" id="gppx">Voltar</button><button type="button" class="bt pri" id="gppok" ${novas.length ? "" : "disabled"}>Gravar as parcelas marcadas</button></div>`;
  $("gppx").onclick = gpImportar;
  $("gppok").onclick = async () => {
    try {
      $("gppok").disabled = true;
      const venc = {}; document.querySelectorAll(".gppv").forEach(x => venc[x.dataset.i] = x.value);
      const contas = [...document.querySelectorAll(".gpps:checked")].map(x => { const i = x.dataset.i, p = parc[i];
        return { chave: p.chave, fornecedor: p.fornecedor, fornecedor_doc: p.fornecedor_doc, documento: p.documento, nfe_chave: p.nfe_chave, parcela: p.parcela,
          vencimento: venc[i] || "", valor: p.valor, emissao: p.nota.emissao || "", categoria: $("gppc").value, historico: `NF ${p.documento}${p.parcela ? " · parcela " + p.parcela : ""} · emitida em ${dataBR(p.nota.emissao)}` }; });
      if (!contas.length) throw new Error("Marque ao menos uma parcela");
      const r = checar(await sb.rpc("lin_ger_pagar_importar", { p: { origem: "nfe", arquivo: arquivo.slice(0, 200), contas } }));
      $("dlg").close(); await gpCarregar(true);
      msg("ok", `${n(r.novos)} parcela(s) importada(s)${r.repetidos ? `, ${n(r.repetidos)} já estava(m) nas contas a pagar` : ""}.`); gerPagar();
    } catch (e) { $("gppok").disabled = false; $("gpperr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
}

// ---------------------------------------------------------------- contas recorrentes (pelo histórico de pagamentos)
// Olha os 6 meses completos antes do mês atual: extratos do Gerencial (saídas, fora Transferência Interna/Aportes/Retiradas;
// uma "conta" = classe + classificação) e as contas pagas aqui sem lançamento do extrato (por fornecedor).
// Recorrente = pago em 3 ou mais desses meses. "Mensal" = até 2 pagamentos por mês em média (aluguel, luz, internet);
// o resto (Pix de costureiras, insumos…) fica à parte. Valor sugerido = média mensal dos 3 últimos meses com pagamento;
// fixo quando o maior e o menor mês diferem até 3%. Dia = o dia mais comum do primeiro pagamento de cada mês.
// nome da conta pelo extrato: a classificação ("Aluguel Ipanema"); se ela sozinha não diz o que é ("Ipanema"), com a classe na frente
const gpRotulo = (classe, clas) => !clas ? classe : semAc(clas).includes(semAc(classe).split(" ")[0]) ? clas : classe + " " + clas;
function gpRecorrentes() {
  const fim = gpMes(hoje()), ini = gpSomaMes(fim, -6);
  const grupos = new Map();
  const add = (k, rot, cat, data, v, doc) => {
    const m = gpMes(data); if (m < ini || m >= fim) return;
    const G = grupos.get(k) || { k, rot, cat, doc, mes: {} };
    (G.mes[m] = G.mes[m] || { v: 0, n: 0, dia: 99 });
    G.mes[m].v += v; G.mes[m].n++; G.mes[m].dia = Math.min(G.mes[m].dia, Number(data.slice(8, 10)));
    grupos.set(k, G);
  };
  if (GER) GER.lanc.forEach(l => { if (Number(l.debito) > 0 && !GER_NEUTRAS.includes(l.classe) && l.classe !== "A classificar")
    add("l:" + l.classe + "|" + l.classificacao, gpRotulo(l.classe, l.classificacao), l.classe, l.data, Number(l.debito), ""); });
  GPAG.contas.forEach(c => { if (c.situacao === "paga" && !c.lancamento_id) add("c:" + gpChaveForn(c), c.fornecedor, c.categoria, c.pago_em, Number(c.valor_pago), c.fornecedor_doc); });
  const abertas = GPAG.contas.filter(c => c.situacao === "aberta" && c.vencimento >= gpSomaMes(fim, 0) + "-01");
  return [...grupos.values()].map(G => {
    const ms = Object.keys(G.mes).sort();
    if (ms.length < 3) return null;
    const ult = ms.slice(-3).map(m => G.mes[m].v);
    const media = Math.round(ult.reduce((a, v) => a + v, 0) / ult.length * 100) / 100;
    const vs = ms.map(m => G.mes[m].v), mi = Math.min(...vs), ma = Math.max(...vs);
    const vezes = ms.reduce((a, m) => a + G.mes[m].n, 0) / ms.length;
    const dias = ms.map(m => G.mes[m].dia), cont = {};
    dias.forEach(d => cont[d] = (cont[d] || 0) + 1);
    const dia = Number(Object.entries(cont).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]);
    const rotS = semAc(G.rot);
    const ja = abertas.filter(c => semAc(c.fornecedor) === rotS || (G.doc && c.fornecedor_doc === G.doc));
    return { ...G, meses: ms.length, media, mi, ma, fixo: ma - mi <= ma * 0.03, vezes, mensal: vezes <= 2, dia,
      jaTem: ja.length, jaAte: ja.length ? ja.map(c => c.vencimento).sort().pop() : "" };
  }).filter(Boolean).sort((a, b) => b.meses - a.meses || b.media - a.media);
}
function gpTelaRecorrentes() {
  const rs = gpRecorrentes(), mens = rs.filter(r => r.mensal), freq = rs.filter(r => !r.mensal);
  const fim = gpMes(hoje()), ini = gpSomaMes(fim, -6);
  const linha = (r, i) => `<tr><td><b>${esc(r.rot)}</b>${r.cat && r.cat !== r.rot ? `<div class="mut">${esc(r.cat)}</div>` : ""}</td>
    <td>${r.meses} de 6</td><td>${(Math.round(r.vezes * 10) / 10).toLocaleString("pt-BR")}×/mês</td><td>dia ${r.dia}</td>
    <td class="num">${brl(r.media)}<div class="mut">${r.fixo ? "valor fixo" : `varia de ${brl(r.mi)} a ${brl(r.ma)}`}</div></td>
    <td>${r.jaTem ? `<span class="tag ok">${r.jaTem} em aberto até ${gpMesCurto(gpMes(r.jaAte))}</span>` : ""}</td>
    <td><button type="button" class="bt" data-rg="${i}">${r.jaTem ? "Gerar mais" : "Gerar"}</button></td></tr>`;
  const tab = (ls, off) => `<div class="tw"><table><thead><tr><th>Conta</th><th>Pago em</th><th>Frequência</th><th>Vence</th><th class="num">Média (3 últimos meses)</th><th></th><th></th></tr></thead><tbody>${ls.map((r, i) => linha(r, i + off)).join("")}</tbody></table></div>`;
  const g = $("dlgf");
  g.innerHTML = `<h3>Contas recorrentes</h3>
    <div class="mut">O que foi pago em pelo menos 3 dos 6 meses de ${gpMesCurto(ini)} a ${gpMesCurto(gpSomaMes(fim, -1))}, pelos extratos do Gerencial (extratos importados até ${GER && GER.lanc.length ? dataBR(GER.lanc.reduce((m, l) => l.data > m ? l.data : m, "")) : "—"}) e pelas contas pagas fora do extrato. <b>Gerar</b> lança as próximas contas com a média; quando o valor muda todo mês, ela entra como estimada (“~”) — corrija quando a conta chegar.</div>
    ${mens.length ? `<h4 style="margin:12px 0 4px">Contas mensais</h4>${tab(mens, 0)}` : '<div class="vazio">Nenhuma conta mensal encontrada no histórico.</div>'}
    ${freq.length ? `<details style="margin-top:10px"><summary><b>Pagamentos que se repetem várias vezes no mês</b> <span class="mut">(${freq.length}: Pix de prestadores, insumos… em geral não viram conta a pagar)</span></summary>${tab(freq, mens.length)}</details>` : ""}
    <div class="acoes"><button type="button" class="bt" id="gprx">Fechar</button></div>`;
  $("gprx").onclick = () => $("dlg").close();
  const todos = mens.concat(freq);
  g.querySelectorAll("[data-rg]").forEach(b => b.onclick = () => {
    const r = todos[Number(b.dataset.rg)];
    // 1º vencimento: o mês seguinte ao último já em aberto, ou este mês (se o dia ainda não passou), senão o próximo
    let m = r.jaTem ? gpSomaMes(gpMes(r.jaAte), 1) : gpMes(hoje());
    const diaDe = mm => { const [a, x] = mm.split("-").map(Number); const ult = new Date(Date.UTC(a, x, 0)).getUTCDate(); return `${mm}-${String(Math.min(r.dia, ult)).padStart(2, "0")}`; };
    if (diaDe(m) < hoje()) m = gpSomaMes(m, 1);
    gpEditar(null, { fornecedor: r.rot, fornecedor_doc: r.doc || "", categoria: r.cat || "", vencimento: diaDe(m), valor: r.media, estimado: !r.fixo, repetir: 12,
      historico: r.fixo ? "" : "Valor estimado pela média dos últimos meses",
      aviso: `${r.rot}: pago em ${r.meses} dos últimos 6 meses, ${r.fixo ? "valor fixo" : `de ${brl(r.mi)} a ${brl(r.ma)}`}. Valor sugerido = média dos 3 últimos meses.`,
      depois: gpTelaRecorrentes });
  });
  $("dlg").classList.add("largo"); if (!$("dlg").open) $("dlg").showModal();
}

// ---------------------------------------------------------------- escolher fornecedores (ex.: só os de linho), guardado no aparelho
function gpFornecedores() {
  const m = new Map();
  GPAG.contas.filter(c => c.situacao !== "cancelada").forEach(c => {
    const k = gpChaveForn(c), F = m.get(k) || { k, nome: c.fornecedor, doc: c.fornecedor_doc, nf: false, aberto: 0, ult: "" };
    if (c.vencimento >= F.ult) { F.nome = c.fornecedor; F.ult = c.vencimento; }
    if (c.documento || c.nfe_chave) F.nf = true;
    if (c.situacao === "aberta") F.aberto += Number(c.valor);
    m.set(k, F);
  });
  return [...m.values()].sort((a, b) => (b.nf - a.nf) || a.nome.localeCompare(b.nome, "pt-BR"));
}
function gpEscolherForns() {
  const fs = gpFornecedores(), g = $("dlg2f");
  const sel = new Set(FGP.forns);
  g.innerHTML = `<h3>Escolher fornecedores</h3>
    <div class="mut">A grade mostra só os marcados. A escolha fica guardada neste aparelho (ex.: os fornecedores de linho).</div>
    <div class="acoes" style="justify-content:flex-start;margin-top:8px"><button type="button" class="bt" id="gpfst">Todos</button><button type="button" class="bt" id="gpfsn">Nenhum</button><button type="button" class="bt" id="gpfsnf">Só os com NF</button></div>
    <div class="gpsug" style="max-height:360px">${fs.map(F => `<label><input type="checkbox" class="gpfck" value="${esc(F.k)}" ${sel.has(F.k) ? "checked" : ""}>
      <span><b>${esc(F.nome)}</b>${F.nf ? ' <span class="tag">NF</span>' : ""}<br><span class="mut">${esc(gpDocTxt(F.doc))}${F.aberto ? ` · em aberto ${brl(F.aberto)}` : ""}</span></span></label>`).join("")}</div>
    <div class="acoes"><button type="button" class="bt" id="gpfsx">Cancelar</button><button type="button" class="bt" id="gpfslimpa">Mostrar todos</button><button type="button" class="bt pri" id="gpfsok">Mostrar os marcados</button></div>`;
  const marcar = f => g.querySelectorAll(".gpfck").forEach(x => { x.checked = f(fs.find(F => F.k === x.value)); });
  $("gpfst").onclick = () => marcar(() => true);
  $("gpfsn").onclick = () => marcar(() => false);
  $("gpfsnf").onclick = () => marcar(F => F.nf);
  $("gpfsx").onclick = () => $("dlg2").close();
  const aplicar = ks => { FGP.forns = new Set(ks); localStorage.setItem("linum-pagar-forns", JSON.stringify(ks)); $("dlg2").close(); gerPagar(); };
  $("gpfslimpa").onclick = () => aplicar([]);
  $("gpfsok").onclick = () => aplicar([...g.querySelectorAll(".gpfck:checked")].map(x => x.value));
  $("dlg2").showModal();
}

// ---------------------------------------------------------------- ficha do fornecedor (como a do painel antigo)
// resumo, o que vence nos próximos meses, notas agrupadas por NF (parcelas, situação, pagamento), pagamentos do extrato e
// NF-e do Buscador com o mesmo CNPJ; imprime em A4.
function gpFichaDados(k) {
  const cs = GPAG.contas.filter(c => gpChaveForn(c) === k).sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.id - b.id);
  const vivo = cs.filter(c => c.situacao !== "cancelada");
  const ult = cs.reduce((m, c) => !m || c.vencimento >= m.vencimento ? c : m, null);
  const nome = ult ? ult.fornecedor : "", doc = cs.map(c => c.fornecedor_doc).find(Boolean) || "";
  const notasBusc = (GPAG.notas || []).filter(nf => doc && (nf.emit_cnpj === doc));
  const notaDe = c => (GPAG.notas || []).find(nf => (c.nfe_chave && nf.chave === c.nfe_chave)
    || (c.documento && String(nf.numero).replace(/^0+/, "") === c.documento.replace(/^0+/, "") && (nf.emit_cnpj === doc || gpForn1(nf.emit_nome) === gpForn1(nome))));
  // notas: uma por documento (sem documento = cada conta sozinha)
  const grupos = new Map();
  cs.forEach(c => { const g = c.documento ? "nf:" + c.documento.replace(/^0+/, "") : "c:" + c.id; (grupos.get(g) || grupos.set(g, []).get(g)).push(c); });
  const notas = [...grupos.values()].map(ps => {
    const nf = notaDe(ps[0]);
    const emi = ps.map(c => c.emissao).find(Boolean) || (nf && String(nf.data_emissao).slice(0, 10))
      || ((ps.map(c => (c.historico.match(/emitida em (\d{2})\/(\d{2})\/(\d{4})/) || [])).find(m => m.length)) || []).slice(1).reverse().join("-") || "";
    return { ps, nf, emi, doc: ps[0].documento, total: ps.filter(c => c.situacao !== "cancelada").reduce((a, c) => a + Number(c.valor), 0),
      prim: ps.map(c => c.vencimento).sort()[0] };
  }).sort((a, b) => a.prim.localeCompare(b.prim));
  const nomes = [gpForn1(nome)].filter(x => x.length >= 3);
  const lancs = (GER ? GER.lanc : []).filter(l => Number(l.debito) > 0 && (
    (doc && (l.descricao.replace(/\D/g, "").includes(doc) || (doc.length === 14 && l.descricao.replace(/\D/g, "").includes(doc.slice(0, 8)))))
    || cs.some(c => c.lancamento_id === l.id) || nomes.some(x => semAc(l.descricao).toUpperCase().includes(x)))).sort((a, b) => a.data.localeCompare(b.data));
  const ab = vivo.filter(c => c.situacao === "aberta"), pagas = vivo.filter(c => c.situacao === "paga");
  const meses = Array.from({ length: 12 }, (_, i) => gpSomaMes(gpMes(hoje()), i));
  return { k, cs, nome, doc, notas, notasBusc, lancs, ab, pagas, meses,
    comprado: vivo.reduce((a, c) => a + Number(c.valor), 0), pago: pagas.reduce((a, c) => a + Number(c.valor_pago), 0),
    aberto: ab.reduce((a, c) => a + Number(c.valor), 0), vencido: ab.filter(gpVencida).reduce((a, c) => a + Number(c.valor), 0),
    prox: ab.filter(c => !gpVencida(c))[0] || null,
    porMes: meses.map(m => ab.filter(c => gpMes(c.vencimento) === m).reduce((a, c) => a + Number(c.valor), 0)),
    depois: ab.filter(c => gpMes(c.vencimento) > meses[11]).reduce((a, c) => a + Number(c.valor), 0),
    pagoExtrato: lancs.reduce((a, l) => a + Number(l.debito), 0) };
}
function gpFichaHtml(D, imp) {
  const sit = c => imp ? ({ paga: "Paga", cancelada: "Cancelada" }[c.situacao] || (gpVencida(c) ? "Vencida" : "A vencer")) : gpSituacao(c);
  const fora = new Set(D.notas.map(n => n.nf && n.nf.id).filter(Boolean));
  const naoImp = D.notasBusc.filter(nf => !fora.has(nf.id) && nf.situacao !== "cancelada");
  return `
    <div class="gpfkpi">
      <div><small>Comprado (NF e contas)</small><b>${brl(D.comprado)}</b><span>${n(D.notas.length)} nota(s)/conta(s)</span></div>
      <div><small>Pago</small><b class="gpos">${brl(D.pago)}</b><span>${n(D.pagas.length)} parcela(s)</span></div>
      <div><small>Em aberto</small><b>${brl(D.aberto)}</b><span>${n(D.ab.length)} parcela(s)</span></div>
      <div><small>Vencido</small><b class="${D.vencido ? "gneg" : ""}">${brl(D.vencido)}</b><span>${D.prox ? "próxima: " + dataBR(D.prox.vencimento) + " · " + brl(D.prox.valor) : "nada a vencer"}</span></div>
    </div>
    <h4>A pagar nos próximos meses</h4>
    <div class="tw"><table class="gpgrade"><thead><tr>${D.meses.map(m => `<th class="v">${gpMesCurto(m)}</th>`).join("")}<th class="v">Depois</th></tr></thead>
      <tbody><tr>${D.porMes.map(v => `<td class="v">${v ? gpNum(v) : "—"}</td>`).join("")}<td class="v">${D.depois ? gpNum(D.depois) : "—"}</td></tr></tbody></table></div>
    <h4>Notas e parcelas</h4>
    ${D.notas.map(N => `<div class="gpnf"><div class="gpnfcab"><b>${N.doc ? "NF nº " + esc(N.doc) : esc(N.ps[0].historico || "Conta sem NF")}</b>
        <span>Emitida em ${N.emi ? dataBR(N.emi) : "—"}</span><span>${N.ps.length} parcela${N.ps.length > 1 ? "s" : ""} · total ${brl(N.total)}</span>
        ${!imp && N.nf && N.nf.xml_path ? `<a class="lnk" href="/apps/notas/espelho.html?ids=${N.nf.id}" target="_blank" rel="noopener">espelho da nota</a>` : ""}</div>
      <table><thead><tr><th>Vencimento</th><th>Parcela</th><th class="num">Valor</th><th>Situação</th><th>Pagamento</th>${imp ? "" : "<th></th>"}</tr></thead><tbody>
      ${N.ps.map(c => `<tr><td>${dataBR(c.vencimento)}</td><td>${esc(c.parcela || "—")}</td><td class="num">${c.estimado && c.situacao === "aberta" ? "~ " : ""}${brl(c.valor)}</td><td>${sit(c)}</td>
        <td>${c.situacao === "paga" ? `${dataBR(c.pago_em)} · ${brl(c.valor_pago)}${c.lancamento_id ? "" : ' <span class="mut">(sem extrato)</span>'}` : c.situacao === "cancelada" ? esc(c.cancelado_motivo) : "—"}</td>
        ${imp ? "" : `<td><button type="button" class="lnk" data-gpfd="${c.id}">abrir</button></td>`}</tr>`).join("")}
      </tbody></table></div>`).join("") || '<div class="mut">Nenhuma conta deste fornecedor.</div>'}
    ${naoImp.length ? `<h4>NF-e no Buscador ainda fora das contas a pagar</h4><table><thead><tr><th>Emissão</th><th>NF</th><th class="num">Valor</th><th></th></tr></thead><tbody>
      ${naoImp.map(nf => `<tr><td>${dataBR(nf.data_emissao)}</td><td>${esc(nf.numero || "")}</td><td class="num">${brl(nf.valor)}</td><td>${nf.completo ? "" : "só resumo: falta a ciência"}</td></tr>`).join("")}</tbody></table>` : ""}
    <h4>Pagamentos no extrato <span class="mut" style="font-weight:400">(Itaú/Nubank do Gerencial, pelo CNPJ ou pelo nome)</span></h4>
    ${D.lancs.length ? `<table><thead><tr><th>Data</th><th>Conta</th><th>Descrição</th><th class="num">Valor</th></tr></thead><tbody>
      ${D.lancs.map(l => `<tr><td>${dataBR(l.data)}</td><td>${GER_CONTAS[l.conta] || l.conta}</td><td>${esc(l.descricao)}${D.cs.some(c => c.lancamento_id === l.id) ? "" : ' <span class="mut">(não ligado a parcela)</span>'}</td><td class="num">${brl(l.debito)}</td></tr>`).join("")}
      </tbody><tfoot><tr><td colspan="3"><b>Total pago no extrato</b></td><td class="num"><b>${brl(D.pagoExtrato)}</b></td></tr></tfoot></table>` : '<div class="mut">Nenhum pagamento achado nos extratos importados.</div>'}`;
}
function gpFicha(k) {
  const D = gpFichaDados(k), g = $("dlgf");
  g.innerHTML = `<h3>${esc(D.nome)}</h3><div class="mut">${D.doc ? (D.doc.length === 11 ? "CPF " : "CNPJ ") + esc(gpDocTxt(D.doc)) : "sem CNPJ cadastrado"}</div>
    ${gpFichaHtml(D, false)}
    <div class="acoes"><button type="button" class="bt" id="gpfx">Fechar</button><button type="button" class="bt" id="gpfimp">Imprimir / PDF</button>${D.ab.length ? `<button type="button" class="bt pri" id="gpfab">Pagar parcelas em aberto</button>` : ""}</div>`;
  $("gpfx").onclick = () => $("dlg").close();
  $("gpfimp").onclick = () => gpFichaImprimir(D);
  if ($("gpfab")) $("gpfab").onclick = () => gpDetalhe(D.ab.map(c => c.id), D.nome + " · em aberto");
  g.querySelectorAll("[data-gpfd]").forEach(b => b.onclick = () => gpDetalhe([Number(b.dataset.gpfd)], D.nome));
  $("dlg").classList.add("largo"); if (!$("dlg").open) $("dlg").showModal();
}
function gpFichaImprimir(D) {
  const w = window.open("", "_blank");
  if (!w) { alert("O navegador bloqueou a janela de impressão. Permita janelas para este site e tente de novo."); return; }
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ficha do fornecedor - ${esc(D.nome)}</title><style>
    @page{size:A4;margin:12mm} body{font-family:Arial,Helvetica,sans-serif;color:#1b1b1b;font-size:12px;margin:0}
    .cab{display:flex;justify-content:space-between;border-bottom:3px solid #0b2545;padding-bottom:8px;margin-bottom:10px}.cab b{font-size:18px}
    h3{margin:6px 0 2px;font-size:16px}h4{font-size:13px;margin:16px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px;break-after:avoid}
    table{width:100%;border-collapse:collapse;margin-bottom:6px}th,td{text-align:left;padding:4px 6px;border-bottom:1px solid #e3e3e3;vertical-align:top}
    th{background:#0b2545;color:#fff;font-size:11px}.num,.v{text-align:right}tr{break-inside:avoid}.mut{color:#666;font-size:11px}
    .gpfkpi{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.gpfkpi div{border:1px solid #ddd;border-radius:6px;padding:8px;text-align:center}
    .gpfkpi small,.gpfkpi span{display:block;color:#666;font-size:10px}.gpfkpi b{font-size:14px}.gneg{color:#b3261e}.gpos{color:#2e6b3a}
    .gpnf{break-inside:avoid;margin-bottom:8px}.gpnfcab{display:flex;gap:14px;background:#eef2f7;padding:5px 8px;font-size:11.5px}
    .tw{overflow:visible}</style></head><body>
    <div class="cab"><div><b>LINUM</b><div class="mut">Ficha do fornecedor · Gerencial</div></div><div class="mut" style="text-align:right">Emitida em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</div></div>
    <h3>${esc(D.nome)}</h3><div class="mut">${D.doc ? (D.doc.length === 11 ? "CPF " : "CNPJ ") + esc(gpDocTxt(D.doc)) : ""}</div>
    ${gpFichaHtml(D, true)}
    <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
  w.document.close();
}
