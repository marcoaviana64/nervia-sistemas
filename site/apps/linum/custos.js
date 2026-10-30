// Sistema Linum — Custos das peças (versão 2.18, pedido do Marco em 29/10/2026): a planilha "CUSTO 2025" da dona da Linum
// (uma aba por peça) dentro do app, só para o Dono e a equipe Nervia. Mesmas contas da planilha:
//   matéria-prima/peça = preço do metro × gasto; risco/peça = custo do risco ÷ peças do risco (ou o valor digitado);
//   modelagem/peça = modelagem ÷ peças do risco; custo = soma de tudo; markup = venda ÷ custo.
// Lê a tabela lin_custos (RLS: só o Dono) e grava por lin_custo_salvar / lin_custo_excluir (auditoria no servidor).
// Usa os ajudantes do index.html ($, esc, sb, checar, msg, brl, n, numBR, decBR, quando, todas, PRODUTOS…).
let CUSTOS = [], CU_PCUSTO = {}, CU_VCUSTO = {};   // custo no cadastro: da peça (CU_PCUSTO) e das peças especiais por "peça|edição" (CU_VCUSTO)
const FCU = { aba: "fichas", q: "", linha: "", copias: false, sel: null, ord: "ficha", desc: false, comp: "" };
const CU_CUSTOS = [["mp", "Matéria-prima"], ["risco", "Risco"], ["mod", "Modelagem e pilotagem"], ["corte", "Corte"], ["lavanderia", "Lavanderia"],
  ["costura", "Costura"], ["aviamentos", "Aviamentos"], ["passadoria", "Passadoria"], ["logistica", "Logística"], ["comissao", "Comissão"],
  ["pagamento", "Pagamento / cartão / contador"]];
const CU_CORES = ["#107e99", "#0b2545", "#5fa8bd", "#c9a227", "#7a8b99", "#2e6b3a", "#a3c9d4", "#b5651d", "#8a6fb0", "#d98c8c", "#4f5f73"];
const cuNum = v => v == null || v === "" ? null : Number(v);
const cuDec = (v, c = 2) => v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: c });
const cuMk = v => v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "×";
const cuLinha = c => (String(c.referencia || c.ficha).trim().match(/^[A-Za-z]+/) || [""])[0].toUpperCase();

// itens do custo do maior para o menor (pedido do Marco); [chave, nome, índice da cor]
const cuOrdem = k => CU_CUSTOS.map(([x, t], i) => [x, t, i]).sort((a, b) => (k[b[0]] || 0) - (k[a[0]] || 0) || a[2] - b[2]);
// as contas da planilha (as mesmas colunas geradas no banco)
function cuCalc(c) {
  const v = k => Number(c[k] || 0), qr = v("qtd_risco");
  const p = { mp: v("mp_metro") * v("gasto"), risco: c.risco_peca_manual != null && c.risco_peca_manual !== "" ? v("risco_peca_manual") : (qr > 0 ? v("risco") / qr : 0),
    mod: qr > 0 ? v("modelagem") / qr : 0 };
  ["corte", "lavanderia", "costura", "aviamentos", "passadoria", "logistica", "comissao", "pagamento"].forEach(k => p[k] = v(k));
  p.risco_auto = qr > 0 ? v("risco") / qr : 0;
  p.custo = CU_CUSTOS.reduce((t, [k]) => t + p[k], 0);
  p.venda = c.venda == null || c.venda === "" ? null : v("venda");
  p.markup = p.venda != null && p.custo > 0 ? p.venda / p.custo : null;
  p.margem = p.venda != null ? p.venda - p.custo : null;
  p.margem_pct = p.venda ? (p.venda - p.custo) / p.venda * 100 : null;
  p.qtd = v("qtd");
  p.venda_total = p.venda != null ? p.venda * p.qtd : null;
  p.despesas = p.custo * p.qtd;
  p.liquido = p.venda_total != null ? p.venda_total - p.despesas : null;
  p.sugerido = c.markup_alvo ? p.custo * v("markup_alvo") : null;
  const base = p.sugerido != null ? p.sugerido : p.venda;
  p.com_desc = c.desconto_pct && base != null ? base * (1 - v("desconto_pct") / 100) : null;
  p.markup_desc = p.com_desc != null && p.custo > 0 ? p.com_desc / p.custo : null;
  return p;
}

// peça do cadastro ligada à ficha (escolhida) ou, se não houver, a de mesma referência
const cuProduto = c => c.produto_id ? PRODUTOS.find(p => p.id === c.produto_id)
  : PRODUTOS.find(p => (p.referencia || "").trim().toUpperCase() === (c.referencia || c.ficha || "").trim().toUpperCase());
// preço no sistema: o da peça ou, se ela não tem, a faixa dos preços das variações
function cuPreco(p) {
  if (!p) return null;
  const vs = (p.variantes || []).map(v => v.preco_venda).filter(x => x != null).map(Number);
  if (p.preco_venda != null && Number(p.preco_venda) > 0) return { v: Number(p.preco_venda), txt: brl(p.preco_venda) };
  if (vs.length) { const a = Math.min(...vs), b = Math.max(...vs); return { v: a, txt: a === b ? brl(a) : brl(a) + " a " + brl(b) }; }
  return { v: 0, txt: "sem preço" };
}
// peça especial (artesanal, bordada…): a ficha diz qual edição ela é; vazio = a peça normal
const cuEd = c => String(c.edicao || "").trim().toLowerCase();
const cuEdicoes = p => p ? [...new Map((p.variantes || []).filter(v => (v.edicao || "").trim()).map(v => [v.edicao.trim().toLowerCase(), v.edicao.trim()])).values()].sort((a, b) => a.localeCompare(b, "pt-BR")) : [];
function cuPrecoFicha(c, p) {
  if (!p) return null;
  const ed = cuEd(c);
  if (!ed) return cuPreco(p);
  const vs = (p.variantes || []).filter(v => (v.edicao || "").trim().toLowerCase() === ed);
  if (!vs.length) return { v: 0, txt: `sem a peça especial “${c.edicao}”`, falta: true };
  const ps = vs.map(v => v.preco_venda).filter(x => x != null).map(Number);
  if (!ps.length) return { v: 0, txt: "sem preço" };
  const a = Math.min(...ps), b = Math.max(...ps);
  return { v: a, txt: a === b ? brl(a) : brl(a) + " a " + brl(b) };
}
const cuCustoSis = (c, p) => !p ? null : cuEd(c) ? CU_VCUSTO[p.id + "|" + cuEd(c)] ?? null : CU_PCUSTO[p.id] ?? null;
// ficha de versão (artesanal, bordada…) sem a peça especial escolhida: o servidor recusa atualizar o cadastro (2.21)
const cuVersaoSemEd = c => { const v = String(c.versao || "").trim().toLowerCase();
  return !!v && !cuEd(c) && ![c.ficha, c.referencia, c.descricao].some(x => String(x || "").trim().toLowerCase() === v); };
const cuNomePeca = (c, p) => p ? p.referencia + " " + p.descricao + (cuEd(c) ? " — ★ " + c.edicao : "") : "—";

async function telaCustos() {
  $("tela").innerHTML = '<div class="card">Carregando…</div>';
  try {
    let pc, vc;
    [CUSTOS, pc, vc] = await Promise.all([todas(() => sb.from("lin_custos").select("*").order("ficha")), todas(() => sb.from("lin_produtos").select("id,preco_custo").order("id")),
      todas(() => sb.from("lin_variantes").select("id,produto_id,edicao,preco_custo").neq("edicao", "").order("id"))]);
    CU_PCUSTO = Object.fromEntries(pc.map(p => [p.id, p.preco_custo == null ? null : Number(p.preco_custo)]));
    CU_VCUSTO = {};
    vc.filter(v => v.preco_custo != null).forEach(v => { const k = v.produto_id + "|" + v.edicao.trim().toLowerCase(); CU_VCUSTO[k] = Math.min(CU_VCUSTO[k] ?? Infinity, Number(v.preco_custo)); });
  }
  catch (e) { $("tela").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  const abas = [["fichas", "Fichas"], ["todas", "Todas as peças"], ["margens", "Margens e custos"], ["sistema", "Planilha × Sistema"]];
  $("tela").innerHTML = `<div class="cabtela"><h2>Custos das peças</h2><span class="mut">só o Dono e a equipe Nervia veem esta aba</span></div>
    <div class="filtros noprint" id="cuabas">${abas.map(([k, t]) => `<button type="button" class="pilula ${FCU.aba === k ? "on" : ""}" data-ca="${k}">${t}</button>`).join("")}</div>
    <div id="cucorpo"></div>`;
  document.querySelectorAll("[data-ca]").forEach(b => b.onclick = () => { if (!cuPodeSair()) return; FCU.aba = b.dataset.ca; telaCustos(); });
  ({ fichas: cuFichas, todas: cuTodas, margens: cuMargens, sistema: cuSistema })[FCU.aba]();
}

// fichas que entram nos números (as cópias/simulações só se pedir)
const cuValidas = () => CUSTOS.filter(c => FCU.copias || !c.rascunho);
const cuBusca = c => {
  const q = semAc(FCU.q);
  if (FCU.linha && cuLinha(c) !== FCU.linha) return false;
  return !q || [c.ficha, c.referencia, c.descricao, c.materia, c.versao].some(x => semAc(x).includes(q));
};
function cuFiltros(id) {
  const linhas = [...new Set(CUSTOS.map(cuLinha).filter(Boolean))].sort();
  return `<div class="filtros noprint" id="${id}">
    <input type="search" id="cuq" placeholder="Buscar referência, peça, tecido…" value="${esc(FCU.q)}" aria-label="Buscar">
    <select id="culinha" aria-label="Linha"><option value="">Todas as linhas</option>${linhas.map(l => `<option ${l === FCU.linha ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
    <label class="chk cuchk"><input type="checkbox" id="cucop" ${FCU.copias ? "checked" : ""}> Mostrar cópias / simulações</label></div>`;
}
function cuLigarFiltros(redesenhar) {
  $("cuq").oninput = e => { FCU.q = e.target.value; redesenhar(true); };
  $("culinha").onchange = e => { FCU.linha = e.target.value; redesenhar(); };
  $("cucop").onchange = e => { FCU.copias = e.target.checked; redesenhar(); };
}

// ---------------------------------------------------------------- fichas (consulta + edição, como as abas da planilha)
let CU_EDIT = null, CU_SUJO = false;
const cuPodeSair = () => !CU_SUJO || confirm("Há alterações nesta ficha que não foram salvas. Sair sem salvar?");
function cuFichas() {
  $("cucorpo").innerHTML = `${cuFiltros("cufil")}
    <div class="cugrade"><div class="card culista"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
      <b id="cucont"></b><button class="bt pri" id="cunova">+ Nova ficha</button></div><div id="culst"></div></div>
    <div id="cuficha"></div></div>`;
  const lista = () => {
    const l = cuValidas().filter(cuBusca);
    $("cucont").textContent = `${n(l.length)} ficha(s)`;
    $("culst").innerHTML = l.length ? l.map(c => { const k = cuCalc(c); return `<button type="button" class="cuitem ${c.id === FCU.sel ? "on" : ""}" data-cid="${c.id}">
      <span><b>${esc(c.ficha)}</b>${c.rascunho ? '<span class="tag">cópia</span>' : ""}<br><small>${esc(c.descricao || "—")}</small></span>
      <span class="num"><b>${brl(k.custo)}</b><br><small>${cuMk(k.markup)}</small></span></button>`; }).join("")
      : '<div class="mut" style="padding:10px">Nenhuma ficha encontrada.</div>';
    document.querySelectorAll("[data-cid]").forEach(b => b.onclick = () => { if (b.dataset.cid === FCU.sel || !cuPodeSair()) return; FCU.sel = b.dataset.cid; lista(); cuAbrir(); });
  };
  cuLigarFiltros(lista);
  $("cunova").onclick = () => { if (!cuPodeSair()) return; FCU.sel = null; lista(); cuAbrir({}); };
  if (!FCU.sel || !CUSTOS.some(c => c.id === FCU.sel)) FCU.sel = (cuValidas().filter(cuBusca)[0] || {}).id || null;
  lista(); cuAbrir();
}

const CU_GRUPOS = [
  ["Matéria-prima", [["mp_metro", "Preço do metro (R$)"], ["gasto", "Gasto (metros por peça)"]], [["mp", "Matéria-prima por peça"]]],
  ["Risco e modelagem", [["qtd_risco", "Peças do risco"], ["risco", "Custo do risco (R$)"], ["risco_peca_manual", "Risco por peça (R$) — vazio = conta"], ["modelagem", "Modelagem e pilotagem (R$)"]],
    [["risco", "Risco por peça"], ["mod", "Modelagem por peça"]]],
  ["Produção (por peça)", [["corte", "Corte"], ["lavanderia", "Beneficiamento / lavanderia"], ["costura", "Costura externa"], ["aviamentos", "Aviamentos"], ["passadoria", "Passadoria"]], []],
  ["Venda (por peça)", [["logistica", "Logística"], ["comissao", "Comissão de venda"], ["pagamento", "Pagamento / cartão / contador"]], []],
];
function cuAbrir(nova) {
  const c = nova || CUSTOS.find(x => x.id === FCU.sel);
  CU_SUJO = false;
  if (!c) { $("cuficha").innerHTML = '<div class="card vazio">Escolha uma ficha na lista ou crie uma nova.</div>'; return; }
  CU_EDIT = { ...c };
  const val = k => esc(decBR(c[k] == null ? "" : +Number(c[k]).toFixed(4)));
  const inp = (k, rot, extra = "") => `<div class="campo"><label for="cu_${k}">${rot}</label><input id="cu_${k}" class="cu-in" data-k="${k}" inputmode="decimal" value="${val(k)}" ${extra}></div>`;
  const txt = (k, rot, extra = "") => `<div class="campo"><label for="cu_${k}">${rot}</label><input id="cu_${k}" class="cu-in" data-k="${k}" data-t="1" value="${esc(c[k] || "")}" ${extra}></div>`;
  const prods = [...PRODUTOS].sort((a, b) => (a.referencia || "").localeCompare(b.referencia || "", "pt-BR", { numeric: true }));
  $("cuficha").innerHTML = `<div class="card cuficha">
    <div class="cabtela"><h2>${c.id ? "Ficha " + esc(c.ficha) : "Nova ficha de custo"}</h2>
      <span class="noprint" style="display:flex;gap:8px;flex-wrap:wrap">${c.id && !c.rascunho ? `<button class="bt" id="cuenviar" title="Leva o preço de venda e o custo desta ficha para a peça em Produtos">${cuProduto(c) ? "Atualizar em Produtos" : "Criar em Produtos"}</button>` : ""}${c.id ? '<button class="bt" id="cudup">Duplicar</button><button class="bt" id="cuimp">Imprimir</button><button class="bt" id="cuexc" style="color:var(--crit)">Excluir</button>' : ""}
      <button class="bt pri" id="cusalvar" disabled>Salvar</button></span></div>
    ${c.id ? `<div class="mut">Atualizada em ${quando(c.atualizado_em)}${c.atualizado_nome ? " por " + esc(c.atualizado_nome) : ""}${c.origem && c.origem !== "app" ? " · veio da " + esc(c.origem) : ""}</div>` : ""}
    <div class="cuduas">
      <div>
        <div class="caixa"><h4>Peça</h4>
          <div class="grade2">${txt("ficha", "Nome da ficha", 'maxlength="60"')}${txt("referencia", "Referência")}</div>
          ${txt("descricao", "Descrição")}
          <div class="grade2">${txt("versao", "Versão (ex.: artesanal, bordada)")}${txt("materia", "Matéria-prima (tecido)")}</div>
          <div class="grade2">${inp("qtd", "Quantidade de peças")}
            <div class="campo"><label for="cu_produto_id">Peça no cadastro</label><select id="cu_produto_id" class="cu-in" data-k="produto_id" data-t="1">
              <option value="">${c.produto_id ? "— nenhuma —" : "pela referência"}</option>${prods.map(p => `<option value="${p.id}" ${p.id === c.produto_id ? "selected" : ""}>${esc(p.referencia + " " + p.descricao)}</option>`).join("")}</select></div></div>
          <div class="campo"><label for="cu_edicao">Peça especial no cadastro (artesanal, bordada…)</label><select id="cu_edicao" class="cu-in" data-k="edicao" data-t="1"></select>
            <div class="mut" id="cu_edicao_dica" style="margin-top:3px"></div></div>
          <label class="chk cuchk" style="margin-top:12px"><input type="checkbox" id="cu_rascunho" ${c.rascunho ? "checked" : ""}> Cópia / simulação (fica fora dos números)</label>
        </div>
        ${CU_GRUPOS.map(([t, campos]) => `<div class="caixa"><h4>${t}</h4><div class="grade2">${campos.map(([k, r]) => inp(k, r)).join("")}</div></div>`).join("")}
        <div class="caixa"><h4>Preço</h4><div class="grade3">${inp("venda", "Valor de venda (R$)")}${inp("markup_alvo", "Markup alvo (×)")}${inp("desconto_pct", "Desconto (%)")}</div></div>
        <div class="campo"><label for="cu_observacoes">Observações</label><textarea id="cu_observacoes" class="cu-in" data-k="observacoes" data-t="1" rows="2" maxlength="1000">${esc(c.observacoes || "")}</textarea></div>
      </div>
      <div><div class="curesumo" id="cures"></div></div>
    </div></div>`;
  document.querySelectorAll(".cu-in").forEach(i => i.addEventListener(i.tagName === "SELECT" ? "change" : "input", () => {
    CU_EDIT[i.dataset.k] = i.dataset.t ? i.value : numBR(i.value); cuSujo();
  }));
  $("cu_rascunho").onchange = e => { CU_EDIT.rascunho = e.target.checked; cuSujo(); };
  // edições (peças especiais) da peça ligada; trocar a peça limpa a escolha
  const preencherEd = () => {
    const p = cuProduto(CU_EDIT), eds = cuEdicoes(p), atual = (CU_EDIT.edicao || "").trim();
    const lista = atual && !eds.some(e => e.toLowerCase() === atual.toLowerCase()) ? [...eds, atual] : eds;
    $("cu_edicao").innerHTML = `<option value="">— a peça normal —</option>` + lista.map(e => `<option ${e.toLowerCase() === atual.toLowerCase() ? "selected" : ""}>${esc(e)}</option>`).join("");
    $("cu_edicao").disabled = !p;
    $("cu_edicao_dica").textContent = !p ? "Ligue a ficha a uma peça do cadastro para escolher." : !eds.length ? "Esta peça não tem peças especiais. Para a versão artesanal/bordada, crie em Produtos → Nova peça especial."
      : "Escolha quando a ficha for de uma versão (ex.: artesanal): o preço e o custo vão só para essas peças especiais.";
  };
  $("cu_produto_id").addEventListener("change", () => { CU_EDIT.edicao = ""; preencherEd(); cuResumo(); });
  preencherEd();
  $("cusalvar").onclick = cuSalvar;
  if (c.id) {
    $("cudup").onclick = () => { if (!cuPodeSair()) return; const base = "Cópia de " + c.ficha; let nome = base, i = 2;
      while (CUSTOS.some(x => x.ficha.toLowerCase() === nome.toLowerCase())) nome = base + " (" + i++ + ")";
      FCU.sel = null; cuAbrir({ ...c, id: null, ficha: nome, rascunho: true, origem: "app" }); CU_SUJO = true; $("cusalvar").disabled = false;
      msg("info", "Cópia pronta: altere o que quiser e clique em Salvar. Ela fica marcada como simulação (fora dos números) até você desmarcar."); };
    $("cuimp").onclick = () => cuImprimir();
    if ($("cuenviar")) $("cuenviar").onclick = async () => {
      if (CU_SUJO) { msg("err", "Salve a ficha antes de enviar para Produtos."); return; }
      const p = cuProduto(c), k = cuCalc(c);
      if (p && cuVersaoSemEd(c)) { msg("err", `Esta ficha é da versão “${c.versao}”: escolha a peça especial em “Peça especial no cadastro” antes de atualizar (ou apague o campo Versão se for a peça normal).`); return; }
      const cs = cuCustoSis(c, p);
      const txt = p ? `Atualizar ${cuEd(c) ? "as peças especiais" : "a peça"} ${cuNomePeca(c, p)} em Produtos?\n\nPreço de venda: ${cuPrecoFicha(c, p).txt} → ${brl(k.venda)}\nCusto: ${cs == null ? "—" : brl(cs)} → ${brl(k.custo)}`
        : `Criar a peça em Produtos?\n\nReferência: ${(c.referencia || "").trim() || "provisória (NOVA-…)"}\nDescrição: ${c.descricao || c.ficha}\nPreço de venda: ${brl(k.venda)} · Custo: ${brl(k.custo)}\n\nDepois, em Produtos, acrescente as cores e os tamanhos.`;
      if (!confirm(txt)) return;
      try {
        const r = checar(await sb.rpc("lin_custo_enviar", { p_id: c.id }));
        await carregar(); msg("ok", r.criado ? `Peça ${r.referencia} criada em Produtos. Acrescente as cores e os tamanhos na aba Produtos.` : "Peça atualizada em Produtos com o preço de venda e o custo da ficha.");
        await telaCustos();
      } catch (e) { msg("err", e.message); }
    };
    $("cuexc").onclick = async () => {
      if (!confirm(`Excluir a ficha ${c.ficha}? Ela continua registrada na auditoria.`)) return;
      try { checar(await sb.rpc("lin_custo_excluir", { p_id: c.id })); CU_SUJO = false; FCU.sel = null; msg("ok", `Ficha ${c.ficha} excluída.`); telaCustos(); }
      catch (e) { msg("err", e.message); }
    };
  }
  cuResumo();
}
function cuSujo() { CU_SUJO = true; $("cusalvar").disabled = false; cuResumo(); }

function cuResumo() {
  const c = CU_EDIT, k = cuCalc(c), prod = cuProduto(c), pr = cuPrecoFicha(c, prod);
  const ri = $("cu_risco_peca_manual"); if (ri) ri.placeholder = "conta: " + cuDec(k.risco_auto);
  const barra = cuOrdem(k).filter(([x]) => k[x] > 0).map(([x, t, i]) => `<i style="width:${k.custo ? k[x] / k.custo * 100 : 0}%;background:${CU_CORES[i]}" title="${t}: ${brl(k[x])}"></i>`).join("");
  const alerta = pr && pr.v > 0 && Math.abs(pr.v - k.custo) < 0.5 ? '<div class="msg err" style="margin:8px 0 0">O preço desta peça no sistema é igual ao CUSTO, não ao valor de venda.</div>' : "";
  $("cures").innerHTML = `
    <div class="cuvalores">
      <div class="kpi destaque"><small>Custo total por peça</small><b>${brl(k.custo)}</b><span>soma de todos os itens</span></div>
      <div class="kpi destaque cuvenda"><small>Valor de venda</small><b>${k.venda != null ? brl(k.venda) : "—"}</b><span>${k.markup != null ? "markup " + cuMk(k.markup) + " · margem " + brl(k.margem) : "informe o valor de venda"}</span></div>
      ${k.sugerido != null ? `<div class="kpi destaque cucalc"><small>Venda calculada (markup ${cuMk(Number(c.markup_alvo))})</small><b>${brl(k.sugerido)}</b><span>${k.com_desc != null ? "com " + cuDec(Number(c.desconto_pct), 1) + "% de desconto: " + brl(k.com_desc) : "custo × markup alvo"}</span></div>` : ""}
    </div>
    <div class="cubarra">${barra}</div>
    <table class="cutab"><tbody>
      ${cuOrdem(k).map(([x, t, i]) => `<tr><td><span class="cubola" style="background:${CU_CORES[i]}"></span>${t}</td><td class="num">${brl(k[x])}</td><td class="num mut">${k.custo ? cuDec(k[x] / k.custo * 100, 1) + "%" : ""}</td></tr>`).join("")}
      <tr class="cutot"><td>Custo total</td><td class="num">${brl(k.custo)}</td><td></td></tr>
      <tr><td>Valor de venda</td><td class="num"><b>${k.venda != null ? brl(k.venda) : "—"}</b></td><td></td></tr>
      <tr><td>Markup (venda ÷ custo)</td><td class="num"><b>${cuMk(k.markup)}</b></td><td></td></tr>
      <tr><td>Margem por peça</td><td class="num">${k.margem != null ? brl(k.margem) : "—"}</td><td class="num mut">${k.margem_pct != null ? cuDec(k.margem_pct, 1) + "%" : ""}</td></tr>
    </tbody></table>
    ${k.qtd ? `<h4 style="margin:14px 0 4px">Lote de ${cuDec(k.qtd)} peça(s)</h4><table class="cutab"><tbody>
      <tr><td>Venda total</td><td class="num">${k.venda_total != null ? brl(k.venda_total) : "—"}</td></tr>
      <tr><td>Despesas (custo × peças)</td><td class="num">${brl(k.despesas)}</td></tr>
      <tr class="cutot"><td>Líquido</td><td class="num">${k.liquido != null ? brl(k.liquido) : "—"}</td></tr></tbody></table>` : ""}
    ${k.sugerido != null || k.com_desc != null ? `<h4 style="margin:14px 0 4px">Simulação</h4><table class="cutab"><tbody>
      ${k.sugerido != null ? `<tr><td>Preço com markup ${cuMk(Number(c.markup_alvo))}</td><td class="num"><b>${brl(k.sugerido)}</b></td></tr>` : ""}
      ${k.com_desc != null ? `<tr><td>Com ${cuDec(Number(c.desconto_pct), 1)}% de desconto</td><td class="num">${brl(k.com_desc)}</td></tr><tr><td>Markup com o desconto</td><td class="num">${cuMk(k.markup_desc)}</td></tr>` : ""}
      </tbody></table>` : '<div class="mut" style="margin-top:10px">Preencha "Markup alvo" para ver o preço sugerido e "Desconto" para simular uma promoção.</div>'}
    <h4 style="margin:14px 0 4px">No sistema</h4>
    ${prod ? `<div>${esc(cuNomePeca(c, prod))}<br>Preço de venda: <b>${pr.txt}</b>${k.venda != null && pr.v > 0 && Math.abs(pr.v - k.venda) >= 0.5 ? ` <span class="tag fora">diferente da ficha</span>` : pr.v > 0 && k.venda != null ? ' <span class="tag ok">igual à ficha</span>' : ""}</div>${alerta}`
      : '<div class="mut">Nenhuma peça do cadastro com esta referência. Escolha em "Peça no cadastro" para comparar.</div>'}
    ${prod && cuVersaoSemEd(c) ? `<div class="msg info" style="margin:8px 0 0">Esta ficha é da versão “${esc(c.versao)}”: para não mudar o preço da peça normal, ela só atualiza o cadastro depois que você escolher a peça especial em “Peça especial no cadastro”${cuEdicoes(prod).length ? "" : ` (a ${esc(prod.referencia)} ainda não tem peças especiais: crie em Produtos → Nova peça especial)`}. Se esta ficha é a da peça normal, apague o campo Versão.</div>` : ""}`;
}

// impressão da ficha: uma folha A4 deitada, com cabeçalho (pedido do Marco: "sem cabeçalho e em 2 folhas")
function cuImprimir() {
  const c = CU_EDIT, k = cuCalc(c), p = cuProduto(c), pr = cuPrecoFicha(c, p), cs = cuCustoSis(c, p);
  const w = window.open("", "_blank"); if (!w) return msg("err", "O navegador bloqueou a janela de impressão.");
  const d = (v, casas = 2) => v == null || v === "" ? "—" : cuDec(Number(v), casas), r = v => v == null ? "—" : brl(v);
  const base = { mp: `${r(cuNum(c.mp_metro))} × ${d(c.gasto, 3)} m`, risco: c.risco_peca_manual != null && c.risco_peca_manual !== "" ? "valor digitado" : `${r(cuNum(c.risco))} ÷ ${d(c.qtd_risco, 0)} peças`,
    mod: `${r(cuNum(c.modelagem))} ÷ ${d(c.qtd_risco, 0)} peças` };
  const linhas = cuOrdem(k).map(([x, t]) => `<tr><td>${t}</td><td class="mut">${base[x] || ""}</td><td class="n">${brl(k[x])}</td><td class="n mut">${k.custo ? cuDec(k[x] / k.custo * 100, 1) + "%" : ""}</td></tr>`).join("");
  const dados = [["Referência", c.referencia], ["Descrição", c.descricao], ["Versão", c.versao], ["Tecido", c.materia], ["Quantidade de peças", d(c.qtd, 0)],
    ["Peça no cadastro", p ? cuNomePeca(c, p) : "—"]].filter(([, v]) => v != null && String(v).trim() !== "");
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ficha de custo ${esc(c.ficha || "")} — Linum</title>
    <style>@page{size:A4 landscape;margin:10mm 12mm}*{box-sizing:border-box}body{font:11.5px/1.35 system-ui,"Segoe UI",Arial,sans-serif;margin:0;color:#111}
    header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #0b2545;padding-bottom:6px;margin-bottom:8px}
    h1{font-size:19px;margin:0}h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#107e99;margin:8px 0 4px}.mut{color:#666}
    .cols{display:grid;grid-template-columns:1.25fr 1fr;gap:16px}.dados{display:grid;grid-template-columns:repeat(3,1fr);gap:2px 14px;margin-bottom:6px}.dados b{font-weight:600}
    table{width:100%;border-collapse:collapse}td{padding:3px 5px;border-bottom:1px solid #ddd}td.n{text-align:right;white-space:nowrap}tr.tot td{font-weight:700;border-top:2px solid #333;border-bottom:0}
    .box{display:grid;grid-template-columns:repeat(${k.sugerido != null ? 3 : 2},1fr);gap:8px;margin-bottom:6px}.box div{border:1.5px solid #0b2545;border-radius:6px;padding:6px 9px}.box small{display:block;color:#555}.box b{font-size:19px}
    .obs{border:1px dashed #999;padding:6px;white-space:pre-line;min-height:28px}footer{margin-top:8px;font-size:9.5px;color:#777;border-top:1px solid #ccc;padding-top:4px}</style></head><body>
    <header><div><h1>LINUM · Ficha de custo — ${esc(c.ficha || "nova")}${c.rascunho ? " (cópia/simulação)" : ""}</h1><div class="mut">${esc([c.referencia, c.descricao].filter(Boolean).join(" · "))}</div></div>
      <div class="mut" style="text-align:right">Emitida em ${dataBR(hoje())}${c.atualizado_em ? `<br>Atualizada em ${quando(c.atualizado_em)}${c.atualizado_nome ? " por " + esc(c.atualizado_nome) : ""}` : ""}${CU_SUJO ? "<br><b>Alterações ainda não salvas</b>" : ""}</div></header>
    <div class="dados">${dados.map(([t, v]) => `<div><span class="mut">${t}:</span> <b>${esc(v)}</b></div>`).join("")}</div>
    <div class="box"><div><small>Custo total por peça</small><b>${brl(k.custo)}</b></div><div><small>Valor de venda</small><b>${k.venda != null ? brl(k.venda) : "—"}</b>${k.markup != null ? `<small>markup ${cuMk(k.markup)} · margem ${brl(k.margem)} (${cuDec(k.margem_pct, 1)}%)</small>` : ""}</div>
      ${k.sugerido != null ? `<div><small>Venda calculada (markup ${cuMk(Number(c.markup_alvo))})</small><b>${brl(k.sugerido)}</b>${k.com_desc != null ? `<small>com ${cuDec(Number(c.desconto_pct), 1)}% de desconto: ${brl(k.com_desc)} (markup ${cuMk(k.markup_desc)})</small>` : ""}</div>` : ""}</div>
    <div class="cols"><div><h2>Composição do custo por peça</h2><table>${linhas}<tr class="tot"><td>Custo total</td><td></td><td class="n">${brl(k.custo)}</td><td></td></tr></table></div>
      <div><h2>Preço</h2><table>
        <tr><td>Valor de venda</td><td class="n"><b>${k.venda != null ? brl(k.venda) : "—"}</b></td></tr><tr><td>Markup (venda ÷ custo)</td><td class="n">${cuMk(k.markup)}</td></tr>
        <tr><td>Margem por peça</td><td class="n">${k.margem != null ? brl(k.margem) : "—"}</td></tr></table>
        ${k.qtd ? `<h2>Lote de ${d(k.qtd, 0)} peça(s)</h2><table><tr><td>Venda total</td><td class="n">${r(k.venda_total)}</td></tr><tr><td>Despesas (custo × peças)</td><td class="n">${brl(k.despesas)}</td></tr>
          <tr class="tot"><td>Líquido</td><td class="n">${r(k.liquido)}</td></tr></table>` : ""}
        <h2>No sistema</h2><table><tr><td>Preço de venda cadastrado</td><td class="n">${pr ? esc(pr.txt) : "—"}</td></tr><tr><td>Custo cadastrado</td><td class="n">${r(cs)}</td></tr></table></div></div>
    ${(c.observacoes || "").trim() ? `<h2>Observações</h2><div class="obs">${esc(c.observacoes)}</div>` : ""}
    <footer>Sistema Linum · Plataforma Nervia · nervia.com.br · Documento interno com custos — não entregar a clientes.</footer>
    </body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

async function cuSalvar() {
  const c = CU_EDIT, b = $("cusalvar");
  const p = { id: c.id || null };
  ["ficha", "referencia", "descricao", "versao", "materia", "observacoes", "produto_id", "edicao"].forEach(k => p[k] = c[k] == null ? "" : String(c[k]));
  ["qtd", "mp_metro", "gasto", "qtd_risco", "risco", "risco_peca_manual", "modelagem", "corte", "lavanderia", "costura", "aviamentos", "passadoria",
    "logistica", "comissao", "pagamento", "venda", "markup_alvo", "desconto_pct"].forEach(k => p[k] = c[k] == null ? "" : String(c[k]));
  p.rascunho = !!c.rascunho;
  b.disabled = true;
  try {
    const id = checar(await sb.rpc("lin_custo_salvar", { p }));
    CU_SUJO = false; FCU.sel = id; msg("ok", `Ficha ${p.ficha} salva.`); await telaCustos();
  } catch (e) { msg("err", e.message); b.disabled = false; }
}

// ---------------------------------------------------------------- todas as peças (tabela, como o "Painel" da planilha)
function cuTodas() {
  const cols = [["ficha", "Ficha"], ["descricao", "Descrição"], ["materia", "Tecido"], ["mp", "Matéria-prima", 1], ["custo", "Custo", 1], ["venda", "Venda", 1],
    ["markup", "Markup", 1], ["margem", "Margem", 1], ["sistema", "Preço no sistema", 1]];
  $("cucorpo").innerHTML = `${cuFiltros("cufil")}<div class="card"><div class="cabtela"><b id="cucont"></b>
    <span class="noprint" style="display:flex;gap:8px"><button class="bt" id="cucsv">Baixar CSV</button><button class="bt" id="cuimp">Imprimir</button></span></div>
    <div class="tw"><table id="cutodas"><thead><tr>${cols.map(([k, t, nm]) => `<th class="${nm ? "num" : ""}" data-o="${k}" style="cursor:pointer">${t}${FCU.ord === k ? (FCU.desc ? " ▼" : " ▲") : ""}</th>`).join("")}</tr></thead><tbody id="cutb"></tbody></table></div></div>`;
  let linhas = [];
  const desenhar = () => {
    linhas = cuValidas().filter(cuBusca).map(c => { const k = cuCalc(c), pr = cuPrecoFicha(c, cuProduto(c)); return { c, k, mp: k.mp, custo: k.custo, venda: k.venda, markup: k.markup, margem: k.margem,
      sistema: pr ? pr.v : null, sistxt: pr ? pr.txt : "—", ficha: c.ficha, descricao: c.descricao, materia: c.materia }; });
    const o = FCU.ord, s = FCU.desc ? -1 : 1;
    linhas.sort((a, b) => typeof a[o] === "string" || typeof b[o] === "string" ? s * String(a[o] || "").localeCompare(String(b[o] || ""), "pt-BR", { numeric: true })
      : s * ((a[o] ?? -Infinity) - (b[o] ?? -Infinity)));
    $("cucont").textContent = `${n(linhas.length)} ficha(s)`;
    $("cutb").innerHTML = linhas.map(x => `<tr class="cuabrir" data-cid="${x.c.id}" style="cursor:pointer"><td><b>${esc(x.ficha)}</b>${x.c.rascunho ? '<span class="tag">cópia</span>' : ""}</td><td>${esc(x.descricao)}</td><td>${esc(x.materia)}</td>
      <td class="num">${brl(x.mp)}</td><td class="num"><b>${brl(x.custo)}</b></td><td class="num">${x.venda != null ? brl(x.venda) : "—"}</td>
      <td class="num" style="${x.markup != null && x.markup < 2 ? "color:var(--crit);font-weight:700" : ""}">${cuMk(x.markup)}</td><td class="num">${x.margem != null ? brl(x.margem) : "—"}</td>
      <td class="num">${esc(x.sistxt)}${x.sistema > 0 && Math.abs(x.sistema - x.custo) < 0.5 ? ' <span class="tag fora">= custo</span>' : ""}</td></tr>`).join("")
      || '<tr><td colspan="9" class="mut">Nenhuma ficha encontrada.</td></tr>';
    document.querySelectorAll(".cuabrir").forEach(r => r.onclick = () => { FCU.sel = r.dataset.cid; FCU.aba = "fichas"; telaCustos(); });
  };
  cuLigarFiltros(desenhar);
  document.querySelectorAll("[data-o]").forEach(th => th.onclick = () => { FCU.desc = FCU.ord === th.dataset.o ? !FCU.desc : false; FCU.ord = th.dataset.o; cuTodas(); });
  $("cuimp").onclick = () => window.print();
  $("cucsv").onclick = () => {
    const q = x => `"${String(x ?? "").replace(/"/g, '""')}"`, d = x => x == null ? "" : Number(x).toFixed(2).replace(".", ",");
    const cab = ["Ficha", "Referência", "Descrição", "Versão", "Tecido", "Qtd", "Preço metro", "Gasto", "Matéria-prima", "Risco/peça", "Modelagem/peça", "Corte", "Lavanderia",
      "Costura", "Aviamentos", "Passadoria", "Logística", "Comissão", "Pagamento", "Custo", "Venda", "Markup", "Margem", "Preço no sistema", "Cópia"];
    const csv = [cab.map(q).join(";"), ...linhas.map(({ c, k, sistxt }) => [c.ficha, c.referencia, c.descricao, c.versao, c.materia, d(c.qtd), d(c.mp_metro), d(c.gasto), d(k.mp), d(k.risco), d(k.mod),
      d(k.corte), d(k.lavanderia), d(k.costura), d(k.aviamentos), d(k.passadoria), d(k.logistica), d(k.comissao), d(k.pagamento), d(k.custo), d(k.venda), d(k.markup), d(k.margem), sistxt, c.rascunho ? "sim" : ""].map(q).join(";"))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = "custos-linum.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  desenhar();
}

// ---------------------------------------------------------------- margens e custos (consultas gerenciais)
function cuMargens() {
  $("cucorpo").innerHTML = `${cuFiltros("cufil")}<div id="cumg"></div>`;
  const desenhar = () => {
    const l = cuValidas().filter(cuBusca).map(c => ({ c, k: cuCalc(c) }));
    const comV = l.filter(x => x.k.markup != null);
    const med = (a, f) => a.length ? a.reduce((t, x) => t + f(x), 0) / a.length : null;
    const faixas = [["abaixo de 2×", 0, 2], ["2× a 2,5×", 2, 2.5], ["2,5× a 3×", 2.5, 3], ["3× a 3,5×", 3, 3.5], ["3,5× ou mais", 3.5, Infinity]]
      .map(([t, a, b]) => ({ t, q: comV.filter(x => x.k.markup >= a && x.k.markup < b).length }));
    const maxF = Math.max(1, ...faixas.map(f => f.q));
    const comp = CU_CUSTOS.map(([x, t], i) => ({ t, i, v: med(l, y => y.k[x]) || 0 }));
    const totComp = comp.reduce((t, x) => t + x.v, 0);
    const porTecido = {};
    l.forEach(x => { const m = (x.c.materia || "(sem tecido)").trim().toLowerCase(); (porTecido[m] = porTecido[m] || { nome: x.c.materia || "(sem tecido)", l: [] }).l.push(x); });
    const tecidos = Object.values(porTecido).map(g => ({ nome: g.nome, q: g.l.length, metro: med(g.l.filter(x => x.c.mp_metro), x => Number(x.c.mp_metro)),
      custo: med(g.l, x => x.k.custo), mk: med(g.l.filter(x => x.k.markup != null), x => x.k.markup) })).sort((a, b) => b.q - a.q);
    const linhaPeca = x => `<tr class="cuabrir" data-cid="${x.c.id}" style="cursor:pointer"><td><b>${esc(x.c.ficha)}</b> ${esc(x.c.descricao)}</td><td class="num">${brl(x.k.custo)}</td><td class="num">${brl(x.k.venda)}</td><td class="num"><b>${cuMk(x.k.markup)}</b></td></tr>`;
    const ord = [...comV].sort((a, b) => a.k.markup - b.k.markup);
    $("cumg").innerHTML = l.length ? `
      <div class="kpis">
        <div class="kpi"><small>Fichas</small><b>${n(l.length)}</b><span>${n(l.length - comV.length)} sem valor de venda</span></div>
        <div class="kpi"><small>Custo médio por peça</small><b>${brl(med(l, x => x.k.custo))}</b><span>de ${brl(Math.min(...l.map(x => x.k.custo)))} a ${brl(Math.max(...l.map(x => x.k.custo)))}</span></div>
        <div class="kpi"><small>Venda média</small><b>${comV.length ? brl(med(comV, x => x.k.venda)) : "—"}</b><span>margem média ${comV.length ? brl(med(comV, x => x.k.margem)) : "—"}</span></div>
        <div class="kpi"><small>Markup médio</small><b>${cuMk(med(comV, x => x.k.markup))}</b><span>${n(faixas[0].q)} peça(s) abaixo de 2×</span></div>
      </div>
      <div class="cuduas">
        <div class="card"><h2>Peças por faixa de markup</h2>${faixas.map(f => `<div class="cufx"><span>${f.t}</span><span class="cufxb"><i style="width:${f.q / maxF * 100}%"></i></span><b>${n(f.q)}</b></div>`).join("")}
          <div class="mut" style="margin-top:6px">Markup = valor de venda ÷ custo. Ex.: 3× = vende por três vezes o que custa.</div></div>
        <div class="card"><h2>Do que é feito o custo (média por peça)</h2><div class="cubarra" style="height:16px">${comp.filter(x => x.v > 0).map(x => `<i style="width:${totComp ? x.v / totComp * 100 : 0}%;background:${CU_CORES[x.i]}" title="${x.t}"></i>`).join("")}</div>
          <table class="cutab"><tbody>${comp.filter(x => x.v > 0).sort((a, b) => b.v - a.v).map(x => `<tr><td><span class="cubola" style="background:${CU_CORES[x.i]}"></span>${x.t}</td><td class="num">${brl(x.v)}</td><td class="num mut">${cuDec(totComp ? x.v / totComp * 100 : 0, 1)}%</td></tr>`).join("")}</tbody></table></div>
      </div>
      <div class="cuduas">
        <div class="card"><h2>Menor markup</h2><div class="tw"><table><thead><tr><th>Peça</th><th class="num">Custo</th><th class="num">Venda</th><th class="num">Markup</th></tr></thead><tbody>${ord.slice(0, 10).map(linhaPeca).join("") || '<tr><td colspan="4" class="mut">—</td></tr>'}</tbody></table></div></div>
        <div class="card"><h2>Maior markup</h2><div class="tw"><table><thead><tr><th>Peça</th><th class="num">Custo</th><th class="num">Venda</th><th class="num">Markup</th></tr></thead><tbody>${ord.slice(-10).reverse().map(linhaPeca).join("") || '<tr><td colspan="4" class="mut">—</td></tr>'}</tbody></table></div></div>
      </div>
      <div class="card"><h2>Por tecido</h2><div class="tw"><table><thead><tr><th>Tecido</th><th class="num">Fichas</th><th class="num">Preço médio do metro</th><th class="num">Custo médio da peça</th><th class="num">Markup médio</th></tr></thead><tbody>
        ${tecidos.map(t => `<tr><td>${esc(t.nome)}</td><td class="num">${n(t.q)}</td><td class="num">${t.metro != null ? brl(t.metro) : "—"}</td><td class="num">${brl(t.custo)}</td><td class="num">${cuMk(t.mk)}</td></tr>`).join("")}</tbody></table></div></div>`
      : '<div class="card vazio">Nenhuma ficha com estes filtros.</div>';
    document.querySelectorAll(".cuabrir").forEach(r => r.onclick = () => { FCU.sel = r.dataset.cid; FCU.aba = "fichas"; telaCustos(); });
  };
  cuLigarFiltros(desenhar);
  desenhar();
}

// ---------------------------------------------------------------- planilha × sistema (preço da ficha × preço do cadastro)
function cuSistema() {
  const fichas = CUSTOS.filter(c => !c.rascunho);
  const usados = new Set();
  const l = fichas.map(c => { const p = cuProduto(c), pr = cuPrecoFicha(c, p), k = cuCalc(c); if (p) usados.add(p.id);
    let s = "fora";
    if (p) s = !pr || pr.v <= 0 ? "sem_preco" : Math.abs(pr.v - k.custo) < 0.5 ? "custo" : k.venda != null && Math.abs(pr.v - k.venda) < 0.5 ? "igual" : "diferente";
    return { c, p, pr, k, s }; });
  const semFicha = PRODUTOS.filter(p => !usados.has(p.id) && !refProvisoria(p)).sort((a, b) => (a.referencia || "").localeCompare(b.referencia || "", "pt-BR", { numeric: true }));
  const SIT = { custo: ["Preço no sistema = custo", "fora", "o preço cadastrado é o custo da ficha; deveria ser o valor de venda"],
    sem_preco: ["Sem preço no sistema", "fora", "a peça está cadastrada sem preço de venda"],
    diferente: ["Preço diferente", "possivel", "o preço do sistema não é o da ficha"], igual: ["Igual à ficha", "ok", ""],
    fora: ["Ficha sem peça no cadastro", "", "nenhuma peça com essa referência no sistema"] };
  const cont = k => l.filter(x => x.s === k).length;
  FCU.comp = FCU.comp || "custo";
  $("cucorpo").innerHTML = `<div class="kpis">${Object.entries(SIT).map(([k, [t]]) => `<button type="button" class="kpi cukpi ${FCU.comp === k ? "on" : ""}" data-sit="${k}" style="text-align:left;font:inherit;cursor:pointer"><small>${t}</small><b>${n(cont(k))}</b></button>`).join("")}
    <button type="button" class="kpi cukpi ${FCU.comp === "sem_ficha" ? "on" : ""}" data-sit="sem_ficha" style="text-align:left;font:inherit;cursor:pointer"><small>Peças do cadastro sem ficha</small><b>${n(semFicha.length)}</b></button></div>
    <div class="card" id="cusis"></div>`;
  const desenhar = () => {
    document.querySelectorAll("[data-sit]").forEach(b => b.classList.toggle("on", b.dataset.sit === FCU.comp));
    if (FCU.comp === "sem_ficha") {
      $("cusis").innerHTML = `<h2>Peças do cadastro sem ficha de custo</h2><div class="mut">Referências provisórias (NOVA-…) ficam de fora.</div><div class="tw"><table><thead><tr><th>Peça</th><th class="num">Preço no sistema</th><th></th></tr></thead><tbody>
        ${semFicha.map(p => `<tr><td><b>${esc(p.referencia)}</b> ${esc(p.descricao)}</td><td class="num">${esc(cuPreco(p).txt)}</td><td class="num"><button class="lnk cucriar" data-pid="${p.id}">criar ficha</button></td></tr>`).join("") || '<tr><td colspan="3" class="mut">Todas as peças têm ficha.</td></tr>'}</tbody></table></div>`;
      document.querySelectorAll(".cucriar").forEach(b => b.onclick = () => { const p = PRODUTOS.find(x => x.id === b.dataset.pid);
        FCU.aba = "fichas"; FCU.sel = null; telaCustos().then(() => { cuAbrir({ ficha: p.referencia, referencia: p.referencia, descricao: p.descricao, produto_id: p.id, venda: p.preco_venda }); cuSujo(); }); });
      return;
    }
    const [t, , exp] = SIT[FCU.comp], sel = l.filter(x => x.s === FCU.comp), marcavel = FCU.comp !== "fora";
    // peça com mais de uma ficha (ex.: A12 e A12 artesanal): avisa, porque só uma pode valer para o cadastro
    const chave = x => x.p.id + "|" + cuEd(x.c);
    const porPeca = {}; l.forEach(x => { if (x.p) porPeca[chave(x)] = (porPeca[chave(x)] || 0) + 1; });
    const custoSis = x => cuCustoSis(x.c, x.p);
    const pode = x => x.p && x.k.venda > 0 && x.k.custo > 0 && !(x.pr && x.pr.falta) && !cuVersaoSemEd(x.c);
    $("cusis").innerHTML = `<h2>${t}</h2>${exp ? `<div class="mut">${exp}.</div>` : ""}
      ${marcavel ? `<div class="filtros noprint" style="align-items:center;margin-top:8px"><label class="chk cuchk"><input type="checkbox" id="cutodos"> Marcar todas</label>
        <button class="bt pri" id="cuaplicar" disabled>Atualizar no cadastro</button><span class="mut" id="cumarc"></span></div>` : ""}
      <div class="tw"><table><thead><tr>${marcavel ? "<th></th>" : ""}<th>Ficha</th><th>Peça no sistema</th><th class="num">Custo na ficha</th><th class="num">Custo no sistema</th><th class="num">Venda na ficha</th><th class="num">Preço no sistema</th></tr></thead><tbody>
      ${sel.map(x => { const cs = custoSis(x), difCusto = cs == null || Math.abs(cs - x.k.custo) >= 0.005;
        return `<tr>${marcavel ? `<td>${pode(x) ? `<input type="checkbox" class="cumarca" data-cid="${x.c.id}" aria-label="Marcar ${esc(x.c.ficha)}">` : ""}</td>` : ""}
        <td class="cuabrir" data-cid="${x.c.id}" style="cursor:pointer"><b>${esc(x.c.ficha)}</b> ${esc(x.c.descricao)}${x.p && porPeca[chave(x)] > 1 ? ' <span class="tag fora" title="Mais de uma ficha aponta para esta peça: marque só a que vale">outra ficha p/ esta peça</span>' : ""}</td>
        <td>${esc(cuNomePeca(x.c, x.p))}${x.p && cuVersaoSemEd(x.c) ? ' <span class="tag possivel" title="Ficha de uma versão: abra a ficha e escolha em “Peça especial no cadastro” (ou apague a Versão se for a peça normal)">versão? escolha a peça especial</span>' : ""}</td>
        <td class="num">${brl(x.k.custo)}</td><td class="num" style="${difCusto ? "color:var(--crit)" : ""}">${cs == null ? "—" : brl(cs)}</td>
        <td class="num">${x.k.venda != null ? brl(x.k.venda) : "—"}</td><td class="num"><b>${x.pr ? esc(x.pr.txt) : "—"}</b></td></tr>`; }).join("")
        || `<tr><td colspan="${marcavel ? 7 : 6}" class="mut">Nenhuma.</td></tr>`}</tbody></table></div>
      <div class="mut" style="margin-top:6px">${marcavel ? "Marque as fichas já conferidas e clique em <b>Atualizar no cadastro</b>: a peça passa a ter o preço de venda e o custo da ficha; se a ficha for de uma peça especial (★, ex.: artesanal), só as peças especiais dessa edição mudam. Fica na auditoria. " : ""}A ficha é ligada à peça pela referência ou pelo campo "Peça no cadastro" (clique no nome da ficha para abrir).</div>`;
    document.querySelectorAll(".cuabrir").forEach(r => r.onclick = () => { FCU.sel = r.dataset.cid; FCU.aba = "fichas"; telaCustos(); });
    if (!marcavel) return;
    const marcadas = () => [...document.querySelectorAll(".cumarca:checked")].map(i => i.dataset.cid);
    const contar = () => { const m = marcadas().length; $("cuaplicar").disabled = !m; $("cuaplicar").textContent = m ? `Atualizar no cadastro (${m})` : "Atualizar no cadastro"; };
    document.querySelectorAll(".cumarca").forEach(i => i.onchange = contar);
    $("cutodos").onchange = e => { document.querySelectorAll(".cumarca").forEach(i => i.checked = e.target.checked); contar(); };
    $("cuaplicar").onclick = async () => {
      const ids = marcadas(), lst = sel.filter(x => ids.includes(x.c.id));
      const linhas = lst.slice(0, 12).map(x => `${x.p.referencia}: venda ${x.pr ? x.pr.txt : "—"} → ${brl(x.k.venda)}; custo ${custoSis(x) == null ? "—" : brl(custoSis(x))} → ${brl(x.k.custo)}`);
      if (!confirm(`Atualizar ${lst.length} peça(s) no cadastro com o preço de venda e o custo da ficha?\n\n${linhas.join("\n")}${lst.length > 12 ? `\n… e mais ${lst.length - 12}` : ""}`)) return;
      $("cuaplicar").disabled = true;
      try {
        const q = checar(await sb.rpc("lin_custos_aplicar", { p_ids: ids }));
        await carregar(); msg("ok", `${q} peça(s) atualizada(s) no cadastro.`); await telaCustos();
      } catch (e) { msg("err", e.message); contar(); }
    };
  };
  document.querySelectorAll("[data-sit]").forEach(b => b.onclick = () => { FCU.comp = b.dataset.sit; desenhar(); });
  desenhar();
}
