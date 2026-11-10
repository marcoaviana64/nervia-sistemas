// Aba Dashboard do app Contratos (versão 2.0): fluxo dos recebimentos e análises da empresa escolhida, em SVG próprio
// (sem biblioteca de gráficos). Tudo é calculado no navegador a partir das cobranças que a tela já leu (ctr_cobrancas_v).
// Cores: categóricas na ordem fixa (1 = recebido, 2 = cobrado), validadas com o validador de paleta (CVD e contraste);
// "em atraso" usa a cor de alerta do app, sempre com rótulo. Cada gráfico tem dica ao passar o mouse e "Ver tabela".
(function () {
  "use strict";
  const COR = { s1: "#2a78d6", s2: "#eb6834", alerta: "#b3261e", grade: "#e3eaef", eixo: "#6b7a8c", texto: "#4f5f73" };
  const NS = "http://www.w3.org/2000/svg";
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  function svg(tag, attrs, ...kids) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v);
    for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  }
  const mesLabel = ym => MESES[+ym.slice(5, 7) - 1] + "/" + ym.slice(2, 4);
  const somaMes = (ym, n) => { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) + n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return y + "-" + String(m).padStart(2, "0"); };
  const fimMes = ym => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10);
  const curto = v => { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi" : a >= 1e3 ? (v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil" : Math.round(v).toLocaleString("pt-BR"); };
  function escala(max) {   // passo "redondo" para a grade (até 4 linhas)
    if (max <= 0) return { topo: 1, passo: 1 };
    const bruto = max / 4, p = Math.pow(10, Math.floor(Math.log10(bruto))), f = bruto / p;
    const passo = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
    return { topo: Math.ceil(max / passo) * passo, passo };
  }
  // barra com as pontas de cima arredondadas (4 px) e base reta na linha zero
  function barra(x, y0, w, h, cor, dica) {
    const r = Math.min(4, w / 2, Math.abs(h));
    const yT = y0 - h;
    const d = h >= 0
      ? `M${x},${y0}V${yT + r}Q${x},${yT} ${x + r},${yT}H${x + w - r}Q${x + w},${yT} ${x + w},${yT + r}V${y0}Z`
      : `M${x},${y0}V${yT - r}Q${x},${yT} ${x + r},${yT}H${x + w - r}Q${x + w},${yT} ${x + w},${yT - r}V${y0}Z`;
    return svg("path", { d, fill: cor, "data-dica": dica });
  }

  // dica (tooltip) comum: qualquer elemento com data-dica
  let dicaEl;
  function ligarDicas(raiz) {
    if (!dicaEl) { dicaEl = document.createElement("div"); dicaEl.className = "dica"; dicaEl.hidden = true; document.body.append(dicaEl); }
    raiz.addEventListener("pointermove", e => {
      const t = e.target.closest("[data-dica]");
      if (!t) { dicaEl.hidden = true; return; }
      dicaEl.textContent = t.getAttribute("data-dica"); dicaEl.hidden = false;
      const x = Math.min(e.clientX + 14, window.innerWidth - dicaEl.offsetWidth - 8);
      dicaEl.style.left = x + "px"; dicaEl.style.top = (e.clientY + 14) + "px";
    });
    raiz.addEventListener("pointerleave", () => { dicaEl.hidden = true; });
  }

  // colunas agrupadas (uma ou mais séries, mesmo eixo em R$)
  function colunas(larg, cats, series, fmt) {
    const H = 230, m = { t: 12, r: 8, b: 26, l: 46 }, w = larg - m.l - m.r, h = H - m.t - m.b;
    const max = Math.max(0, ...series.flatMap(s => s.valores)), { topo, passo } = escala(max);
    const g = svg("svg", { width: larg, height: H, viewBox: `0 0 ${larg} ${H}`, role: "img", class: "grafico" });
    for (let v = 0; v <= topo + 1e-9; v += passo) {
      const y = m.t + h - v / topo * h;
      g.append(svg("line", { x1: m.l, x2: larg - m.r, y1: y, y2: y, stroke: v ? COR.grade : COR.eixo, "stroke-width": 1 }),
        svg("text", { x: m.l - 6, y: y + 4, "text-anchor": "end", class: "eixo" }, curto(v)));
    }
    const banda = w / cats.length, gap = 2, bw = Math.max(2, Math.min(22, (banda * 0.72 - gap * (series.length - 1)) / series.length));
    const cada = Math.max(1, Math.ceil(cats.length / Math.max(1, Math.floor(w / 46))));
    cats.forEach((c, i) => {
      const x0 = m.l + banda * i + (banda - (bw * series.length + gap * (series.length - 1))) / 2;
      series.forEach((s, j) => {
        const v = s.valores[i]; if (!v) return;
        g.append(barra(x0 + j * (bw + gap), m.t + h, bw, v / topo * h, s.cor, c.rot + " · " + s.nome + ": " + fmt(v)));
      });
      // alvo de passar o mouse maior que a barra
      g.append(svg("rect", { x: m.l + banda * i, y: m.t, width: banda, height: h, fill: "transparent",
        "data-dica": c.rot + " · " + series.map(s => s.nome + ": " + fmt(s.valores[i] || 0)).join(" · ") }));
      if (i % cada === 0) g.append(svg("text", { x: m.l + banda * i + banda / 2, y: H - 8, "text-anchor": "middle", class: "eixo" }, c.curto));
    });
    return g;
  }

  // linha (uma série) com área clara embaixo
  function linha(larg, cats, valores, cor, fmt) {
    const H = 200, m = { t: 12, r: 12, b: 26, l: 46 }, w = larg - m.l - m.r, h = H - m.t - m.b;
    const { topo, passo } = escala(Math.max(0, ...valores));
    const g = svg("svg", { width: larg, height: H, viewBox: `0 0 ${larg} ${H}`, role: "img", class: "grafico" });
    for (let v = 0; v <= topo + 1e-9; v += passo) {
      const y = m.t + h - v / topo * h;
      g.append(svg("line", { x1: m.l, x2: larg - m.r, y1: y, y2: y, stroke: v ? COR.grade : COR.eixo }), svg("text", { x: m.l - 6, y: y + 4, "text-anchor": "end", class: "eixo" }, curto(v)));
    }
    const px = i => m.l + (cats.length === 1 ? w / 2 : w * i / (cats.length - 1)), py = v => m.t + h - v / topo * h;
    const pts = valores.map((v, i) => px(i) + "," + py(v)).join(" ");
    g.append(svg("polygon", { points: `${px(0)},${m.t + h} ${pts} ${px(valores.length - 1)},${m.t + h}`, fill: cor, "fill-opacity": 0.1 }),
      svg("polyline", { points: pts, fill: "none", stroke: cor, "stroke-width": 2, "stroke-linejoin": "round" }));
    const cada = Math.max(1, Math.ceil(cats.length / Math.max(1, Math.floor(w / 46)))), passoX = cats.length > 1 ? w / (cats.length - 1) : w;
    valores.forEach((v, i) => {
      g.append(svg("rect", { x: px(i) - passoX / 2, y: m.t, width: passoX, height: h, fill: "transparent", "data-dica": cats[i].rot + ": " + fmt(v) }));
      if (i === valores.length - 1 || v === Math.max(...valores)) g.append(svg("circle", { cx: px(i), cy: py(v), r: 4, fill: cor, stroke: "#fff", "stroke-width": 2, "data-dica": cats[i].rot + ": " + fmt(v) }));
      if (i % cada === 0) g.append(svg("text", { x: px(i), y: H - 8, "text-anchor": "middle", class: "eixo" }, cats[i].curto));
    });
    return g;
  }

  // barras deitadas (ranking), com o valor escrito na ponta; aceita negativos (linha zero no meio)
  function deitadas(larg, itens, cor, fmt) {
    const lin = 26, m = { t: 4, r: 88, b: 4, l: Math.min(170, Math.max(90, larg * 0.32)) }, w = larg - m.l - m.r, H = m.t + m.b + lin * itens.length;
    const min = Math.min(0, ...itens.map(x => x.v)), max = Math.max(0, ...itens.map(x => x.v)), faixa = (max - min) || 1, x0 = m.l + (-min / faixa) * w;
    const g = svg("svg", { width: larg, height: H, viewBox: `0 0 ${larg} ${H}`, role: "img", class: "grafico" });
    itens.forEach((it, i) => {
      const y = m.t + i * lin, bw = Math.abs(it.v) / faixa * w, x = it.v >= 0 ? x0 : x0 - bw;
      const nome = it.nome.length > 24 ? it.nome.slice(0, 23) + "…" : it.nome;
      g.append(svg("text", { x: m.l - 8, y: y + lin / 2 + 4, "text-anchor": "end", class: "rot" }, nome));
      if (bw > 0) {
        const r = Math.min(4, bw / 2), y1 = y + 5, hh = lin - 10;
        const d = it.v >= 0 ? `M${x},${y1}H${x + bw - r}Q${x + bw},${y1} ${x + bw},${y1 + r}V${y1 + hh - r}Q${x + bw},${y1 + hh} ${x + bw - r},${y1 + hh}H${x}Z`
          : `M${x + bw},${y1}H${x + r}Q${x},${y1} ${x},${y1 + r}V${y1 + hh - r}Q${x},${y1 + hh} ${x + r},${y1 + hh}H${x + bw}Z`;
        g.append(svg("path", { d, fill: it.cor || cor }));
      }
      g.append(svg("text", { x: it.v >= 0 ? x0 + bw + 6 : x0 + 6, y: y + lin / 2 + 4, class: "val" }, fmt(it.v)));
      g.append(svg("rect", { x: 0, y, width: larg, height: lin, fill: "transparent", "data-dica": it.nome + ": " + (it.dica || fmt(it.v)) }));
    });
    if (min < 0) g.append(svg("line", { x1: x0, x2: x0, y1: 0, y2: H, stroke: COR.eixo }));
    return g;
  }

  // ---------------------------------------------------------------- a aba
  window.CTR_DASH = function (c, ctx) {
    const { S, el, R, N, br, hoje, cliNome, abrirContrato, irCobrancas } = ctx;
    const hj = hoje(), mesHoje = hj.slice(0, 7);
    const n = S.fd.meses, inicio = somaMes(mesHoje, -(n - 1));
    const meses = Array.from({ length: n }, (_, i) => somaMes(inicio, i));
    const cats = meses.map(ym => ({ ym, curto: mesLabel(ym), rot: mesLabel(ym) }));
    const compMes = comp => comp.slice(0, 4) + "-" + (comp.endsWith("/13") ? "12" : comp.slice(5, 7));
    const cob = S.cob, num = v => Number(v || 0);

    c.append(el("div", { class: "filtros" },
      el("div", { class: "campo" }, el("label", {}, "Período"), (() => {
        const s = el("select", { onchange: e => { S.fd.meses = +e.target.value; ctx.render(); } });
        for (const [v, t] of [[12, "Últimos 12 meses"], [24, "Últimos 24 meses"], [36, "Últimos 36 meses"]]) s.append(el("option", { value: v, selected: v === n }, t));
        return s; })())));

    if (!cob.length) { c.append(el("div", { class: "painel mut" }, "Ainda não há cobranças nesta empresa: crie os contratos e as cobranças (ou faça a carga da planilha em Configuração) para ver o dashboard.")); return; }

    // séries por mês
    const cobrado = meses.map(ym => cob.filter(x => compMes(x.competencia) === ym).reduce((s, x) => s + num(x.valor), 0));
    const recebido = meses.map(ym => cob.filter(x => x.pago_em && x.pago_em.slice(0, 7) === ym).reduce((s, x) => s + num(x.valor_pago), 0));
    const atrasoFim = meses.map(ym => { const f = ym === mesHoje ? hj : fimMes(ym);
      return cob.filter(x => x.vencimento < f && (!x.pago_em || x.pago_em > f)).reduce((s, x) => s + num(x.valor), 0); });
    const noPeriodo = cob.filter(x => x.pago_em && x.pago_em.slice(0, 7) >= inicio && x.pago_em.slice(0, 7) <= mesHoje);
    const totRec = noPeriodo.reduce((s, x) => s + num(x.valor_pago), 0), totImp = noPeriodo.reduce((s, x) => s + num(x.imposto), 0);
    const atrasadas = cob.filter(x => x.situacao === "atrasada"), totAtraso = atrasadas.reduce((s, x) => s + num(x.valor), 0);
    const prox = Array.from({ length: 6 }, (_, i) => somaMes(mesHoje, i));
    const aReceber = prox.map(ym => cob.filter(x => !x.pago_em && x.vencimento >= hj && x.vencimento.slice(0, 7) === ym).reduce((s, x) => s + num(x.valor), 0));
    const prazos = noPeriodo.map(x => (Date.parse(x.pago_em) - Date.parse(x.vencimento)) / 864e5);
    const prazoMedio = prazos.length ? prazos.reduce((a, b) => a + b, 0) / prazos.length : null;
    const vigentes = [...S.contratos.values()].filter(k => k.situacao === "assinado" && k.inicio <= hj && (!k.fim || k.fim >= hj));
    const mensal = vigentes.reduce((s, k) => s + num(k.valor_mensal), 0);
    const dias = v => (v > 0 ? "+" : "") + v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + (Math.abs(v) === 1 ? " dia" : " dias");

    const kpi = (l, v, h, cls) => el("div", { class: "kpi " + (cls || "") }, el("div", { class: "l" }, l), el("div", { class: "v" }, v), h ? el("div", { class: "h" }, h) : null);
    c.append(el("div", { class: "kpis" },
      kpi("Recebido no período", R(totRec), noPeriodo.length + " pagamentos"),
      kpi("Imposto estimado", R(totImp), "líquido " + R(totRec - totImp)),
      kpi("Em atraso hoje", R(totAtraso), atrasadas.length + " cobranças", atrasadas.length ? "alerta" : ""),
      kpi("A receber (6 meses)", R(aReceber.reduce((a, b) => a + b, 0)), "cobranças já criadas"),
      kpi("Prazo médio de recebimento", prazoMedio == null ? "—" : dias(Math.round(prazoMedio * 10) / 10), "em relação ao vencimento"),
      kpi("Receita mensal contratada", R(mensal), vigentes.length + " contrato(s) assinado(s) em vigor")));

    const cartao = (titulo, sub, desenho, tabela, legenda, cls) => {
      const corpo = el("div", { class: "graf" }), d = el("div", { class: "painel cartao " + (cls || "") }, el("h2", {}, titulo), sub ? el("p", { class: "mut", style: "margin:-6px 0 8px" }, sub) : null,
        legenda || null, corpo, el("details", { class: "vertab" }, el("summary", {}, "Ver tabela"), tabela));
      d._desenhar = () => { corpo.replaceChildren(desenho(Math.max(280, corpo.clientWidth))); };
      return d;
    };
    const leg = itens => el("div", { class: "legenda" }, itens.map(([nome, cor]) => el("span", {}, el("i", { style: "background:" + cor }), nome)));
    const tab = (cab, linhas) => el("table", { class: "tab" }, el("thead", {}, el("tr", {}, cab.map((t, i) => el("th", { class: i ? "n" : "" }, t)))),
      el("tbody", {}, linhas.map(l => el("tr", {}, l.map((v, i) => el("td", { class: i ? "n" : "" }, v))))));

    const cards = [];
    cards.push(cartao("Cobrado × recebido por mês", "Cobrado pelo mês de competência (a parcela extra de dezembro entra em dezembro); recebido pelo dia em que o dinheiro entrou.",
      w => colunas(w, cats, [{ nome: "Recebido", cor: COR.s1, valores: recebido }, { nome: "Cobrado", cor: COR.s2, valores: cobrado }], R),
      tab(["Mês", "Cobrado", "Recebido", "Diferença"], meses.map((ym, i) => [mesLabel(ym), N(cobrado[i]), N(recebido[i]), N(recebido[i] - cobrado[i])])),
      leg([["Recebido", COR.s1], ["Cobrado", COR.s2]]), "largo"));
    cards.push(cartao("Previsão: a receber nos próximos 6 meses", "Cobranças já criadas e ainda não pagas, pelo vencimento. O que já venceu está em \"Em atraso\".",
      w => colunas(w, prox.map(ym => ({ curto: mesLabel(ym), rot: mesLabel(ym) })), [{ nome: "A receber", cor: COR.s1, valores: aReceber }], R),
      tab(["Mês", "A receber"], prox.map((ym, i) => [mesLabel(ym), N(aReceber[i])]))));
    cards.push(cartao("Em atraso no fim de cada mês", "Soma das cobranças vencidas e ainda não pagas naquela data.",
      w => linha(w, cats, atrasoFim, COR.alerta, R), tab(["Mês", "Em atraso"], meses.map((ym, i) => [mesLabel(ym), N(atrasoFim[i])]))));

    // concentração da receita por cliente (recebido no período), 8 maiores + outros
    const porCli = new Map(); for (const x of noPeriodo) porCli.set(x.cliente_id, (porCli.get(x.cliente_id) || 0) + num(x.valor_pago));
    let conc = [...porCli].sort((a, b) => b[1] - a[1]).map(([id, v]) => ({ nome: cliNome(id), v }));
    if (conc.length > 8) conc = [...conc.slice(0, 7), { nome: "Outros (" + (conc.length - 7) + ")", v: conc.slice(7).reduce((s, x) => s + x.v, 0) }];
    const pct = v => totRec ? (v / totRec * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%" : "—";
    cards.push(cartao("Concentração da receita por cliente", "Participação de cada cliente no recebido do período.",
      w => conc.length ? deitadas(w, conc.map(x => ({ ...x, dica: R(x.v) + " (" + pct(x.v) + ")" })), COR.s1, pct) : el("p", { class: "mut" }, "Nada recebido no período."),
      tab(["Cliente", "Recebido", "%"], conc.map(x => [x.nome, N(x.v), pct(x.v)]))));
    // prazo médio por cliente
    const pz = new Map(); for (const x of noPeriodo) { const o = pz.get(x.cliente_id) || { s: 0, n: 0 }; o.s += (Date.parse(x.pago_em) - Date.parse(x.vencimento)) / 864e5; o.n++; pz.set(x.cliente_id, o); }
    const prazo = [...pz].map(([id, o]) => ({ nome: cliNome(id), v: Math.round(o.s / o.n * 10) / 10, n: o.n })).sort((a, b) => b.v - a.v);
    cards.push(cartao("Prazo de recebimento por cliente", "Média de dias entre o vencimento e o pagamento no período (negativo = pagou antes do vencimento).",
      w => prazo.length ? deitadas(w, prazo.map(x => ({ ...x, cor: x.v > 0 ? COR.s2 : COR.s1, dica: dias(x.v) + " em média (" + x.n + " pagamentos)" })), COR.s1, dias) : el("p", { class: "mut" }, "Nada recebido no período."),
      tab(["Cliente", "Dias (média)", "Pagamentos"], prazo.map(x => [x.nome, x.v.toLocaleString("pt-BR"), x.n])),
      leg([["pagou antes ou no dia", COR.s1], ["pagou depois do vencimento", COR.s2]])));

    const grade = el("div", { class: "dash" }, cards);
    c.append(grade);
    // contratos que terminam nos próximos 6 meses
    const lim = fimMes(somaMes(mesHoje, 5)), renovados = new Set([...S.contratos.values()].map(k => k.anterior_id).filter(Boolean));
    const vencendo = [...S.contratos.values()].filter(k => k.fim && k.fim >= hj && k.fim <= lim && !["encerrado", "rescindido", "rascunho"].includes(k.situacao)).sort((a, b) => a.fim.localeCompare(b.fim));
    c.append(el("div", { class: "painel" }, el("h2", {}, "Contratos que terminam nos próximos 6 meses"),
      vencendo.length ? el("table", { class: "tab" }, el("thead", {}, el("tr", {}, ["Cliente", "Termina em", "Valor mensal", "Renovação"].map((t, i) => el("th", { class: i === 2 ? "n" : "" }, t)))),
        el("tbody", {}, vencendo.map(k => el("tr", { class: "clica", onclick: () => abrirContrato(k.id) }, el("td", {}, cliNome(k.cliente_id)), el("td", { class: "mono" }, br(k.fim)),
          el("td", { class: "n" }, N(k.valor_mensal)), el("td", {}, renovados.has(k.id) ? el("span", { class: "pill ok" }, "renovação criada") : el("span", { class: "pill atencao" }, "renovar")))))) :
        el("p", { class: "mut" }, "Nenhum contrato termina nos próximos 6 meses."),
      atrasadas.length ? el("p", { style: "margin:10px 0 0" }, el("button", { class: "btn lnk", onclick: irCobrancas }, "Ver as " + atrasadas.length + " cobrança(s) em atraso →")) : null));
    for (const d of cards) d._desenhar();
    ligarDicas(grade);
    // redesenha ao mudar a largura (celular girado, painel de ajuda aberto)
    let t; const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { if (grade.isConnected) for (const d of cards) d._desenhar(); else ro.disconnect(); }, 150); });
    ro.observe(grade);
  };
})();
