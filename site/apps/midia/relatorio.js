// Mídia Indoor — aba Relatório: TEMPO DE TELA de cada mídia em cada TV (pedido do Marco em 18/11/2026, para o relatório
// mensal aos clientes). Lê mi_exibicoes (resumo por TV × dia × mídia, gravado pelo app da TV 1.6+ pela função midia-tv;
// RLS: o cliente vê as contas liberadas, a Nervia todas). Usa as variáveis e funções do index (sb, CONTA, esc, checar, tag…).
let REL = { mes: "", tela: "", chave: "", linhas: null, erro: "" };

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const hojeBR = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });   // AAAA-MM-DD em Brasília
const mesNome = m => `${MESES[+m.slice(5, 7) - 1]} de ${m.slice(0, 4)}`;
const ultimoDia = m => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
/** Dias do período para a média: o mês inteiro, ou até ONTEM no mês atual (a TV manda o dia no dia seguinte). */
const diasPeriodo = m => { const h = hojeBR(); return h.slice(0, 7) === m ? Math.max(1, +h.slice(8, 10) - 1) : ultimoDia(m); };
const tempoTxt = s => {
  s = Math.round(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : m ? `${m} min ${String(x).padStart(2, "0")} s` : `${x} s`;
};
const numBR = n => Number(n || 0).toLocaleString("pt-BR");
const pctTxt = (a, b) => b ? (a / b * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%" : "—";
const tipoTxt = t => t === "video" ? "vídeo" : t === "imagem" ? "imagem" : "";

async function carregarRelatorio() {
  const chave = CONTA.id + "|" + REL.mes;
  if (REL.chave === chave) return;
  REL.chave = chave; REL.linhas = null; REL.erro = "";
  try {
    const ini = REL.mes + "-01", fim = REL.mes + "-" + String(ultimoDia(REL.mes)).padStart(2, "0");
    const todas = [];
    for (let de = 0; ; de += 1000) {   // em páginas de 1000 (limite da API)
      const p = checar(await sb.from("mi_exibicoes").select("tela_id, tela_nome, dia, drive_id, nome, tipo, vezes, segundos")
        .eq("conta_id", CONTA.id).gte("dia", ini).lte("dia", fim).order("dia").order("tela_id").order("drive_id").range(de, de + 999));
      todas.push(...p);
      if (p.length < 1000) break;
    }
    if (REL.chave === chave) REL.linhas = todas;
  } catch (e) { if (REL.chave === chave) REL.erro = e.message; }
  if (VISTA === "relatorio") render();
}

/** Soma as linhas pela chave (função) e devolve a lista ordenada pelo tempo. */
function somar(linhas, chave, extra) {
  const m = new Map();
  for (const l of linhas) {
    const k = chave(l);
    const a = m.get(k) || { ...extra(l), vezes: 0, segundos: 0, dias: new Set(), telas: new Set() };
    a.vezes += l.vezes; a.segundos += Number(l.segundos); a.dias.add(l.dia); a.telas.add(l.tela_id);
    m.set(k, a);
  }
  return [...m.values()].sort((x, y) => y.segundos - x.segundos);
}

function vRelatorio() {
  if (!CONTA) return avisoConta();
  if (!REL.mes) REL.mes = hojeBR().slice(0, 7);
  if (REL.chave !== CONTA.id + "|" + REL.mes) { carregarRelatorio(); }
  const todas = REL.linhas || [];
  const telasDoMes = somar(todas, l => l.tela_id, l => ({ id: l.tela_id, nome: l.tela_nome }));
  // o nome mais recente de cada TV (a TV pode ter sido renomeada no mês)
  for (const t of telasDoMes) t.nome = (todas.filter(l => l.tela_id === t.id).pop() || {}).tela_nome || t.nome;
  if (REL.tela && !telasDoMes.some(t => t.id === REL.tela)) REL.tela = "";
  const linhas = REL.tela ? todas.filter(l => l.tela_id === REL.tela) : todas;
  const dias = diasPeriodo(REL.mes);
  const total = linhas.reduce((a, l) => a + Number(l.segundos), 0), vezes = linhas.reduce((a, l) => a + l.vezes, 0);
  const porMidia = somar(linhas, l => l.drive_id, l => ({ nome: l.nome, tipo: l.tipo }));
  const porTela = somar(linhas, l => l.tela_id, l => ({ id: l.tela_id, nome: (telasDoMes.find(t => t.id === l.tela_id) || {}).nome || l.tela_nome }));
  const porTelaMidia = somar(linhas, l => l.tela_id + "|" + l.drive_id, l => ({ tela: l.tela_id, nome: l.nome, tipo: l.tipo }));
  const nomeTela = id => (porTela.find(t => t.id === id) || {}).nome || "";
  const totTela = id => (porTela.find(t => t.id === id) || {}).segundos || 0;
  const telaSel = REL.tela ? nomeTela(REL.tela) : "";

  const controles = `<div class="card noprint"><h2>Tempo de tela<span class="dir">
      <button class="bt" data-acao="relImprimir" ${linhas.length ? "" : "disabled"}>Imprimir / PDF</button>
      <button class="bt" data-acao="relCsv" ${linhas.length ? "" : "disabled"}>Baixar CSV</button></span></h2>
    <div class="filtros">
      <div><label for="relMes">Mês</label><input type="month" id="relMes" value="${REL.mes}" max="${hojeBR().slice(0, 7)}"></div>
      <div><label for="relTela">TV</label><select id="relTela"><option value="">Todas as TVs</option>${telasDoMes.map(t => `<option value="${t.id}" ${t.id === REL.tela ? "selected" : ""}>${esc(t.nome)}</option>`).join("")}</select></div>
    </div>
    <p class="mut">Tempo em que cada mídia ficou de fato na tela (TV ligada, com o app aberto), anotado pela própria TV, inclusive sem internet, em horário de Brasília. Exibições de menos de 1 segundo não contam. <b>Os números de cada dia chegam no dia seguinte</b>: a TV manda uma vez por dia, depois da meia-noite (ou quando a internet voltar). A contagem começa quando a TV recebe o app 1.6 ou mais novo.</p></div>`;
  const cabecalho = `<div class="so-imp"><div class="imp-topo"><div><b>Relatório de tempo de tela</b><br>${esc(CONTA.nome)} · ${esc(mesNome(REL.mes))}${telaSel ? " · " + esc(telaSel) : ""}</div>
    <div class="mut">Mídia Indoor · Nervia Tecnologia<br>Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</div></div></div>`;
  if (REL.erro) return controles + `<div class="aviso crit">Não foi possível carregar o relatório: ${esc(REL.erro)}</div>`;
  if (!REL.linhas) return controles + '<div class="vazio">Carregando…</div>';
  if (!linhas.length) return controles + `<div class="vazio">Nenhuma exibição registrada em ${esc(mesNome(REL.mes))}${telaSel ? " nesta TV" : ""}.${REL.mes === hojeBR().slice(0, 7) ? " Os números de hoje chegam amanhã." : ""}</div>`;

  return controles + cabecalho + `<div class="kpis">
      <div class="kpi"><b>${tempoTxt(total)}</b><span>tempo de tela no período</span></div>
      <div class="kpi"><b>${numBR(vezes)}</b><span>exibições</span></div>
      <div class="kpi"><b>${porMidia.length}</b><span>mídias exibidas</span></div>
      <div class="kpi"><b>${REL.tela ? tempoTxt(total / dias) : porTela.length}</b><span>${REL.tela ? "média por dia" : "TVs com exibição"}</span></div>
    </div>
    <div class="card"><h2>Por mídia${telaSel ? " — " + esc(telaSel) : ""}</h2><div class="tw"><table>
      <tr><th>Mídia</th>${REL.tela ? "" : '<th class="num">TVs</th>'}<th class="num">Exibições</th><th class="num">Tempo de tela</th><th class="num">Média por dia</th><th class="num">% do tempo</th></tr>
      ${porMidia.map(m => `<tr><td><b>${esc(m.nome)}</b> ${m.tipo !== "outro" ? tag(tipoTxt(m.tipo), m.tipo === "video" ? "t-info" : "t-mut") : ""}</td>${REL.tela ? "" : `<td class="num">${m.telas.size}</td>`}
        <td class="num">${numBR(m.vezes)}</td><td class="num">${tempoTxt(m.segundos)}</td><td class="num">${tempoTxt(m.segundos / dias)}</td><td class="num">${pctTxt(m.segundos, total)}</td></tr>`).join("")}
      <tr class="tot"><td>Total</td>${REL.tela ? "" : `<td class="num">${porTela.length}</td>`}<td class="num">${numBR(vezes)}</td><td class="num">${tempoTxt(total)}</td><td class="num">${tempoTxt(total / dias)}</td><td class="num">100,0%</td></tr>
    </table></div></div>
    ${REL.tela ? "" : `<div class="card"><h2>Por TV</h2><div class="tw"><table>
      <tr><th>TV</th><th class="num">Dias com exibição</th><th class="num">Exibições</th><th class="num">Tempo de tela</th><th class="num">Média por dia</th></tr>
      ${porTela.map(t => `<tr><td><b>${esc(t.nome)}</b>${TELAS.some(x => x.id === t.id) ? "" : ' <span class="mut">(desvinculada)</span>'}</td><td class="num">${t.dias.size} de ${dias}</td>
        <td class="num">${numBR(t.vezes)}</td><td class="num">${tempoTxt(t.segundos)}</td><td class="num">${tempoTxt(t.segundos / dias)}</td></tr>`).join("")}
    </table></div></div>
    <div class="card"><h2>Cada mídia em cada TV</h2><div class="tw"><table>
      <tr><th>TV</th><th>Mídia</th><th class="num">Exibições</th><th class="num">Tempo de tela</th><th class="num">% do tempo da TV</th></tr>
      ${porTelaMidia.sort((a, b) => nomeTela(a.tela).localeCompare(nomeTela(b.tela), "pt-BR") || b.segundos - a.segundos)
        .map(x => `<tr><td>${esc(nomeTela(x.tela))}</td><td>${esc(x.nome)}</td><td class="num">${numBR(x.vezes)}</td><td class="num">${tempoTxt(x.segundos)}</td><td class="num">${pctTxt(x.segundos, totTela(x.tela))}</td></tr>`).join("")}
    </table></div></div>`}
    <p class="mut so-imp">Tempo em que cada mídia ficou de fato na tela (TV ligada, com o app aberto), anotado pela própria TV, em horário de Brasília. Média por dia = tempo ÷ ${dias} dia(s) do período${REL.mes === hojeBR().slice(0, 7) ? " (até ontem)" : ""}.</p>`;
}

/** CSV por dia (separado por ponto e vírgula, com BOM, para abrir certo no Excel). */
function relCsv() {
  const linhas = (REL.tela ? REL.linhas.filter(l => l.tela_id === REL.tela) : REL.linhas);
  const q = v => /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const corpo = [["Dia", "TV", "Mídia", "Tipo", "Exibições", "Segundos", "Tempo de tela"].join(";"),
    ...linhas.map(l => [l.dia.split("-").reverse().join("/"), l.tela_nome, l.nome, tipoTxt(l.tipo), l.vezes,
      String(Number(l.segundos)).replace(".", ","), tempoTxt(l.segundos)].map(q).join(";"))].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + corpo], { type: "text/csv;charset=utf-8" }));
  a.download = `tempo-de-tela-${CONTA.nome.replace(/[^\wÀ-ſ-]+/g, "-")}-${REL.mes}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}

document.addEventListener("change", e => {
  if (e.target.id === "relMes" && /^\d{4}-\d{2}$/.test(e.target.value)) { REL.mes = e.target.value; REL.tela = ""; render(); }
  else if (e.target.id === "relTela") { REL.tela = e.target.value; render(); }
});
document.addEventListener("click", e => {
  const b = e.target.closest("[data-acao]"); if (!b) return;
  if (b.dataset.acao === "relImprimir") window.print();
  else if (b.dataset.acao === "relCsv") relCsv();
});
