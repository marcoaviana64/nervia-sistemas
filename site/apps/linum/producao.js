// Sistema Linum — Produção (versão 2.1): rolos de tecido (comprados por metro ou por quilo; compra pelo XML da NF-e; a peça é
// sempre em metros e o rolo por quilo usa o rendimento em metros por kg), fichas de produção e as etapas corte → costura → lavagem →
// passadoria → estoque. Usa os ajudantes do index.html ($, esc, sb, checar, msg, brl, n, dataBR, hoje, quando, numV, decBR…).
// Tudo vem da lin_producao_ler(): sem a permissão "Valores da produção" o servidor nem manda valor pago, preço por peça e custo.
const ETAPAS = ["corte", "costura", "lavagem", "passadoria"];
const ETAPA_TXT = { corte: "Corte", costura: "Costura", lavagem: "Lavagem", passadoria: "Passadoria", estoque: "Estoque" };
const ETAPA_PARC = { corte: "cortador", costura: "costureira", lavagem: "lavanderia", passadoria: "passadoria" };
const TIPO_PARC = { cortador: "Cortador", costureira: "Costureira", lavanderia: "Lavanderia", passadoria: "Passadoria" };
const ANTERIOR = { costura: "corte", lavagem: "costura", passadoria: "lavagem", estoque: "passadoria" };
let PD = null, PERM = { producao: false, producao_valores: false };
const FPR = { aba: "painel", todas: false, comSaldo: true, mesPag: "" };
const met = (v, u) => v == null || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + (u === "kg" ? " kg" : " m");
const UNID = { m: "metros", kg: "quilos" };
// soma por unidade: [{u, q}] → "51,5 m · 12,5 kg"
const porUnid = l => { const t = {}; l.forEach(([u, q]) => t[u || "m"] = (t[u || "m"] || 0) + Number(q || 0)); return Object.entries(t).filter(([, q]) => q).map(([u, q]) => met(+q.toFixed(3), u)).join(" · ") || "0 m"; };
const unRolo = id => (PD.rolos.find(r => r.id === id) || {}).unidade || "m";
// quantos metros o rolo ainda dá: o saldo (m) ou saldo × rendimento (kg); null = rolo por quilo sem rendimento
const metrosRolo = r => r.unidade === "kg" ? (r.rendimento ? Number(r.saldo) * Number(r.rendimento) : null) : Number(r.saldo);
const pecaTxtP = i => [i.referencia, i.descricao, "—", [i.cor, i.tamanho, i.edicao].filter(Boolean).join(" ")].join(" ");
const valores = () => PD && PD.valores;

async function carregarProducao() { PD = checar(await sb.rpc("lin_producao_ler")); }

// soma por etapa de um item: quantas voltaram boas, quantas se perderam, quantas estão com parceiro
function situacaoItem(o, it) {
  const s = { boas: {}, perdas: 0, fora: {} };
  ETAPAS.forEach(e => { s.boas[e] = 0; s.fora[e] = 0; });
  o.envios.forEach(e => (e.itens || []).filter(x => x.ordem_item_id === it.id).forEach(x => {
    s.boas[e.etapa] += x.recebidas; s.perdas += x.perdas; s.fora[e.etapa] += x.enviadas - x.recebidas - x.perdas; }));
  return s;
}
const pecasFora = e => (e.itens || []).reduce((t, x) => t + x.enviadas - x.recebidas - x.perdas, 0);
const atrasado = e => e.status === "aberto" && e.prazo && e.prazo < hoje();

async function telaProducao() {
  $("tela").innerHTML = '<div class="card">Carregando…</div>';
  try { await carregarProducao(); } catch (e) { $("tela").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  const abas = [["painel", "Painel"], ["fichas", "Fichas"], ["rolos", "Rolos de tecido"], ["parceiros", "Parceiros"], ["metragem", "Metragem por peça"]];
  $("tela").innerHTML = `<div class="cabtela"><h2>Produção</h2><span style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="mut">${valores() ? "com valores" : "sem valores (peça a permissão à Nervia)"}</span><a class="bt" id="pdmapa" href="ajuda/mapa-producao.html" target="_blank" rel="noopener">Mapa da produção</a></span></div>
    <div class="filtros" id="pdabas">${abas.map(([k, t]) => `<button type="button" class="pilula ${FPR.aba === k ? "on" : ""}" data-pa="${k}">${t}</button>`).join("")}</div>
    <div id="pdtela"></div>`;
  document.querySelectorAll("[data-pa]").forEach(b => b.onclick = () => { FPR.aba = b.dataset.pa; telaProducao(); });
  ({ painel: pdPainel, fichas: pdFichas, rolos: pdRolos, parceiros: pdParceiros, metragem: pdMetragem })[FPR.aba]();
}

// ---------------------------------------------------------------- painel
function pdPainel() {
  const abertos = PD.ordens.flatMap(o => o.envios.filter(e => e.status === "aberto").map(e => ({ ...e, ordem: o })));
  const linho = PD.rolos.filter(r => Number(r.saldo) > 0);
  const fora = abertos.reduce((t, e) => t + pecasFora(e), 0), atras = abertos.filter(atrasado);
  const prontas = PD.ordens.filter(o => o.status === "aberta").reduce((t, o) => t + o.itens.reduce((u, i) => u + i.disp.estoque, 0), 0);
  const grupos = {}; linho.forEach(r => { const k = `${r.tecido} · ${r.cor || "sem cor"}`; grupos[k] = grupos[k] || { m: 0, n: 0, u: r.unidade }; grupos[k].m += Number(r.saldo); grupos[k].n++; });
  FPR.mesPag = FPR.mesPag || hoje().slice(0, 7);
  const semRend = PD.rolos.filter(r => r.unidade === "kg" && !r.rendimento && Number(r.saldo) > 0);
  $("pdtela").innerHTML = `${semRend.length ? `<div class="msg info" id="pdrend"><b>Falta o rendimento</b> (quantos metros dá 1 kg) de ${semRend.length} rolo(s) comprado(s) por quilo: ${esc(semRend.map(r => r.codigo).join(", "))}. Sem ele o rolo não vai para o corte — informe em Rolos de tecido → rolo.</div>` : ""}
    <div class="kpis">
      <div class="kpi"><small>Tecido em estoque</small><b>${porUnid(linho.map(r => [r.unidade, r.saldo]))}</b><span>${n(linho.length)} rolo(s) com saldo</span></div>
      <div class="kpi"><small>Peças com parceiros</small><b>${n(fora)}</b><span>${n(abertos.length)} remessa(s) em aberto</span></div>
      <div class="kpi"><small>Atrasadas</small><b style="${atras.length ? "color:var(--crit)" : ""}">${n(atras.length)}</b><span>remessa(s) com prazo vencido</span></div>
      <div class="kpi"><small>Prontas para o estoque</small><b>${n(prontas)}</b><span>voltaram da passadoria</span></div>
      <div class="kpi"><small>Fichas abertas</small><b>${n(PD.ordens.filter(o => o.status === "aberta").length)}</b></div>
    </div>
    <div class="card"><h2>Onde estão as peças</h2>${abertos.length ? `<div class="tw"><table><thead><tr><th>Com quem</th><th>Etapa</th><th class="num">Peças</th><th>Ficha</th><th>Desde</th><th>Prazo</th></tr></thead><tbody>
      ${abertos.sort((a, b) => (a.prazo || "9") .localeCompare(b.prazo || "9")).map(e => `<tr class="pdrow" data-o="${e.ordem.id}" style="cursor:pointer"><td><b>${esc(e.parceiro_nome)}</b></td><td>${ETAPA_TXT[e.etapa]}</td>
        <td class="num">${n(pecasFora(e))}</td><td>nº ${e.ordem.id}</td><td>${dataBR(new Date(e.enviado_em).toLocaleDateString("en-CA", { timeZone: TZ }))}</td>
        <td>${e.prazo ? (atrasado(e) ? `<b style="color:var(--crit)">${dataBR(e.prazo)} · atrasado</b>` : dataBR(e.prazo)) : "—"}</td></tr>`).join("")}</tbody></table></div>`
      : '<div class="mut">Nenhuma peça com parceiros agora.</div>'}</div>
    <div class="card"><h2>Tecido por tipo e cor</h2>${Object.keys(grupos).length ? Object.entries(grupos).sort().map(([k, g]) => `<div class="vlin"><span>${esc(k)} · ${n(g.n)} rolo(s)</span><b>${met(g.m, g.u)}</b></div>`).join("") : '<div class="mut">Sem tecido em estoque.</div>'}</div>
    ${valores() ? `<div class="card" id="pdpag"><div class="cabtela"><h2>A pagar aos parceiros</h2><input type="month" id="pdmes" value="${FPR.mesPag}" style="width:auto"></div><div id="pdpagl"></div></div>` : ""}`;
  document.querySelectorAll(".pdrow").forEach(r => r.onclick = () => verFicha(Number(r.dataset.o)));
  if (valores()) { $("pdmes").onchange = e => { FPR.mesPag = e.target.value || FPR.mesPag; pagamentos(); }; pagamentos(); }
}
// peças recebidas boas no mês × preço por peça da remessa
function pagamentos() {
  const pg = {};
  PD.ordens.forEach(o => o.envios.forEach(e => (e.recebimentos || []).forEach(rc => {
    if (new Date(rc.em).toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7) !== FPR.mesPag) return;
    const q = (rc.itens || []).reduce((t, x) => t + Number(x.recebidas || 0), 0); if (!q) return;
    const k = e.parceiro_id; pg[k] = pg[k] || { nome: e.parceiro_nome, etapa: e.etapa, q: 0, v: 0 }; pg[k].q += q; pg[k].v += q * Number(e.preco_peca || 0); })));
  const l = Object.values(pg).sort((a, b) => b.v - a.v), tot = l.reduce((t, x) => t + x.v, 0);
  $("pdpagl").innerHTML = l.length ? l.map(x => `<div class="vlin"><span><b>${esc(x.nome)}</b> · ${ETAPA_TXT[x.etapa]} · ${n(x.q)} peça(s) recebida(s)</span><b>${brl(x.v)}</b></div>`).join("")
    + `<div class="vlin"><b>Total do mês</b><b>${brl(tot)}</b></div>` : '<div class="mut">Nenhuma peça recebida neste mês.</div>';
}

// ---------------------------------------------------------------- fichas
function pdFichas() {
  const l = PD.ordens.filter(o => FPR.todas || o.status === "aberta");
  const etapaTxt = o => { const fora = {}; o.envios.filter(e => e.status === "aberto").forEach(e => fora[e.etapa] = (fora[e.etapa] || 0) + pecasFora(e));
    const prontas = o.itens.reduce((t, i) => t + i.disp.estoque, 0), entr = o.itens.reduce((t, i) => t + Number(i.entraram), 0);
    return [...ETAPAS.filter(e => fora[e]).map(e => `${fora[e]} no ${ETAPA_TXT[e].toLowerCase()}`), prontas ? `${prontas} prontas` : "", entr ? `${entr} no estoque` : ""].filter(Boolean).join(" · ") || "aguardando corte"; };
  $("pdtela").innerHTML = `<div class="cabtela"><button type="button" class="pilula ${FPR.todas ? "on" : ""}" id="pdtodas">Mostrar concluídas e canceladas</button><button class="bt pri" id="pdnova">+ Nova ficha</button></div>
    <div class="card"><div class="tw"><table><thead><tr><th>Nº</th><th>Criada</th><th>Peças</th><th class="num">Qtd</th><th class="num">Metros</th><th>Situação</th></tr></thead><tbody id="pdfichas">
    ${l.length ? l.map(o => `<tr class="pdfrow" data-o="${o.id}" style="cursor:pointer"><td><b>${o.id}</b></td><td>${dataBR(new Date(o.criada_em).toLocaleDateString("en-CA", { timeZone: TZ }))}</td>
      <td>${esc([...new Set(o.itens.map(i => i.referencia + " " + i.descricao))].join(", "))}</td><td class="num">${n(o.itens.reduce((t, i) => t + i.quantidade, 0))}</td>
      <td class="num">${met(o.itens.reduce((t, i) => t + i.quantidade * Number(i.consumo), 0))}</td>
      <td>${o.status === "aberta" ? esc(etapaTxt(o)) : `<span class="tag">${o.status === "concluida" ? "concluída" : "cancelada"}</span>`}</td></tr>`).join("")
      : `<tr><td colspan="6" class="mut">${PD.ordens.length ? "Nenhuma ficha aberta." : "Nenhuma ficha ainda: + Nova ficha monta a primeira (o que o cortador vai cortar)."}</td></tr>`}</tbody></table></div></div>`;
  $("pdtodas").onclick = () => { FPR.todas = !FPR.todas; pdFichas(); };
  $("pdnova").onclick = novaFicha;
  document.querySelectorAll(".pdfrow").forEach(r => r.onclick = () => verFicha(Number(r.dataset.o)));
}

function novaFicha() {
  const f = $("dlgf"), NF = { itens: [] };
  $("dlg").classList.add("largo");
  f.innerHTML = `<h3>Nova ficha de produção</h3><div class="mut">O que o cortador vai cortar: escolha a peça e as quantidades de cada cor e tamanho.</div>
    <div class="caixa"><h4>Peças</h4><input id="nfq" type="search" placeholder="Referência ou nome da peça" autocomplete="off"><div id="nfres"></div><div id="nfitens" class="campo"></div></div>
    <div class="campo grade3"><div><label for="nfprazo">Prazo para ficar pronta</label><input type="date" id="nfprazo" min="${hoje()}"></div>
      <div><label for="nfloja">Loja que recebe</label><select id="nfloja"><option value="">Escolher depois</option>${PD.lojas.map(l => `<option value="${l.id}">${esc(l.nome)}</option>`).join("")}</select></div>
      <div><label>Linho necessário</label><div id="nftot" style="font-size:18px;font-weight:700;padding-top:4px">0 m</div></div></div>
    <div class="campo"><label for="nfmolde">Molde e instruções para o cortador</label><textarea id="nfmolde" rows="2" placeholder="Ex.: molde calça reta 2025, cortar no fio, bolso faca"></textarea></div>
    <div class="campo"><label for="nfobs">Observação</label><input id="nfobs" maxlength="300"></div>
    <div id="nferr"></div><div class="acoes"><button type="button" class="bt" id="nfx">Cancelar</button><button type="button" class="bt pri" id="nfok">Criar ficha</button></div>`;
  const desenhar = () => {
    $("nfitens").innerHTML = NF.itens.length ? `<div class="tw"><table><thead><tr><th>Peça</th><th class="num">Qtd</th><th class="num">Metros por peça</th><th class="num">Total</th><th></th></tr></thead><tbody>
      ${NF.itens.map((it, i) => `<tr><td><b>${esc(it.ref)}</b> ${esc(it.desc)}<br><span class="mut">${esc(it.var)}</span></td>
        <td class="num"><input data-i="${i}" data-k="q" type="number" min="1" value="${it.q}" style="width:70px"></td>
        <td class="num"><input data-i="${i}" data-k="c" inputmode="decimal" value="${esc(it.c)}" placeholder="metros" style="width:80px"><br><button type="button" class="lnk ${numV(it.c) && numV(it.c) !== Number(it.cad) ? "" : "oculto"}" data-atu="${i}" title="Grava esta metragem no cadastro da peça">Atualizar na peça</button></td>
        <td class="num" data-tot="${i}"></td><td><button type="button" class="lnk perigo" data-rm="${i}">×</button></td></tr>`).join("")}</tbody></table></div>` : '<div class="mut">Procure a peça acima.</div>';
    $("nfitens").querySelectorAll("input[data-i]").forEach(inp => inp.oninput = () => { const it = NF.itens[inp.dataset.i]; it[inp.dataset.k] = inp.value; totais();
      const b = f.querySelector(`[data-atu="${inp.dataset.i}"]`); if (b) b.classList.toggle("oculto", !(numV(it.c) && numV(it.c) !== Number(it.cad))); });
    // grava a metragem digitada no cadastro: no tamanho, se ele já tinha a sua; senão, na peça (todos os tamanhos sem valor próprio)
    $("nfitens").querySelectorAll("[data-atu]").forEach(b => b.onclick = async () => {
      const it = NF.itens[b.dataset.atu], p = PD.produtos.find(x => x.id === it.pid), val = numBR(it.c);
      try {
        checar(await sb.rpc("lin_consumo_salvar", { p: it.vprop ? { produto_id: it.pid, consumo_metros: p.consumo, variantes: { [it.vid]: val } } : { produto_id: it.pid, consumo_metros: val, variantes: {} } }));
        if (it.vprop) p.variantes.find(v => v.id === it.vid).consumo = Number(val); else p.consumo = Number(val);
        NF.itens.filter(x => x.pid === it.pid && (x.vid === it.vid || (!it.vprop && !x.vprop))).forEach(x => x.cad = Number(val));
        b.classList.add("oculto"); msg("ok", `Metragem de ${it.ref} ${it.vprop ? it.var : ""} atualizada no cadastro: ${decBR(val)} m por peça.`);
      } catch (e) { msg("err", e.message); }
    });
    $("nfitens").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { NF.itens.splice(+b.dataset.rm, 1); desenhar(); });
    totais();
  };
  const totais = () => { let t = 0; NF.itens.forEach((it, i) => { const x = (Number(it.q) || 0) * numV(it.c); t += x; const el = f.querySelector(`[data-tot="${i}"]`); if (el) el.textContent = met(x); }); $("nftot").textContent = met(+t.toFixed(2)); };
  $("nfq").oninput = () => {
    const t = $("nfq").value.trim().toLowerCase();
    const l = t.length < 2 ? [] : PD.produtos.filter(p => p.referencia.toLowerCase().includes(t) || p.descricao.toLowerCase().includes(t)).slice(0, 8);
    $("nfres").innerHTML = l.map(p => `<div class="caixa"><b>${esc(p.referencia)}</b> ${esc(p.descricao)} <span class="mut">· ${p.consumo ? met(p.consumo) + " por peça" : "sem metragem cadastrada"}</span>
      <div class="filtros" style="margin:6px 0 0">${p.variantes.map(v => `<button type="button" class="pilula" data-p="${p.id}" data-v="${v.id}">+ ${esc([v.cor, v.tamanho, v.edicao].filter(Boolean).join(" "))}</button>`).join("")}
        ${p.variantes.length ? "" : '<span class="mut">Peça ainda sem cores e tamanhos: cadastre aqui.</span>'}
        <button type="button" class="lnk" data-novav="${p.id}">${p.variantes.length ? "+ outra cor ou tamanho" : "+ cores e tamanhos"}</button></div>
      <div class="filtros oculto" data-novaf="${p.id}" style="margin:6px 0 0;align-items:center"><input data-ncor placeholder="Cores, separadas por vírgula (ex.: Cru, Azul)" style="flex:2 1 220px">
        <input data-ntam placeholder="Tamanhos (ex.: P, M, G)" style="flex:1 1 140px"><button type="button" class="bt" data-ncriar="${p.id}">Criar</button></div></div>`).join("") || (t.length >= 2 ? '<div class="mut">Nenhuma peça encontrada.</div>' : "");
    // cores × tamanhos criados aqui mesmo (Produção, Dono ou Estoque); entram no cadastro da peça com estoque zero
    $("nfres").querySelectorAll("[data-novav]").forEach(b => b.onclick = () => { const fm = $("nfres").querySelector(`[data-novaf="${b.dataset.novav}"]`); fm.classList.toggle("oculto"); fm.querySelector("[data-ncor]").focus(); });
    $("nfres").querySelectorAll("[data-ncriar]").forEach(b => b.onclick = async () => {
      const fm = b.closest("[data-novaf]"), lista = x => fm.querySelector(x).value.split(/[,;]/).map(s => s.trim()).filter(Boolean);
      try {
        const n = checar(await sb.rpc("lin_variantes_criar", { p_produto: b.dataset.ncriar, p_cores: lista("[data-ncor]"), p_tamanhos: lista("[data-ntam]") }));
        await carregarProducao(); $("nfq").oninput(); carregar().catch(() => {});   // o Estoque também passa a mostrar as novas (com zero)
        $("nferr").innerHTML = `<div class="msg ok">${n ? `${n} cor(es)/tamanho(s) criados na peça: clique neles para pôr na ficha.` : "Essas cores e tamanhos já existiam."}</div>`;
      } catch (e) { $("nferr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
    });
    $("nfres").querySelectorAll("[data-v]").forEach(b => b.onclick = () => {
      const p = PD.produtos.find(x => x.id === b.dataset.p), v = p.variantes.find(x => x.id === b.dataset.v);
      if (!NF.itens.some(i => i.vid === v.id)) NF.itens.push({ vid: v.id, ref: p.referencia, desc: p.descricao, var: [v.cor, v.tamanho, v.edicao].filter(Boolean).join(" "), q: "1", c: decBR(v.consumo || p.consumo || ""), cad: v.consumo || p.consumo || null, pid: p.id, vprop: !!v.consumo });
      desenhar();
    });
  };
  $("nfx").onclick = () => $("dlg").close();
  $("nfok").onclick = async () => {
    $("nfok").disabled = true;
    try {
      const id = checar(await sb.rpc("lin_ordem_criar", { p: { prazo: $("nfprazo").value, loja_destino_id: $("nfloja").value, molde: $("nfmolde").value, observacao: $("nfobs").value,
        itens: NF.itens.map(it => ({ variante_id: it.vid, quantidade: it.q, consumo: numBR(it.c) })) } }));
      $("dlg").close(); msg("ok", `Ficha nº ${id} criada.`); FPR.aba = "fichas"; await telaProducao(); verFicha(id);
    } catch (e) { $("nferr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; $("nfok").disabled = false; }
  };
  desenhar(); $("dlg").showModal(); $("nfq").focus();
}

function verFicha(id) {
  const o = PD.ordens.find(x => x.id === id); if (!o) return;
  const f = $("dlgf"), aberta = o.status === "aberta";
  $("dlg").classList.add("largo");
  const loja = o.loja_destino_id ? (PD.lojas.find(l => l.id === o.loja_destino_id) || {}).nome : "";
  f.innerHTML = `<h3>Ficha nº ${o.id} ${aberta ? "" : `<span class="tag">${o.status === "concluida" ? "concluída" : "cancelada"}</span>`}</h3>
    <div class="mut">Criada em ${quando(o.criada_em)} por ${esc(o.criado_nome)}${o.prazo ? ` · prazo ${dataBR(o.prazo)}` : ""}${loja ? ` · vai para ${esc(loja)}` : ""}</div>
    ${o.molde ? `<div style="margin-top:6px"><b>Molde:</b> ${esc(o.molde)}</div>` : ""}${o.observacao ? `<div><b>Obs.:</b> ${esc(o.observacao)}</div>` : ""}
    ${o.motivo_encerramento ? `<div class="msg info">${o.status === "cancelada" ? "Cancelada" : "Encerrada"} por ${esc(o.encerrada_nome)}: ${esc(o.motivo_encerramento)}</div>` : ""}
    <div class="tw" style="margin-top:8px"><table><thead><tr><th>Peça</th><th class="num">Pedidas</th><th class="num">Cortadas</th><th class="num">Costuradas</th><th class="num">Lavadas</th><th class="num">Passadas</th><th class="num">No estoque</th><th class="num">Perdas</th>${valores() ? '<th class="num">Custo/peça</th>' : ""}</tr></thead><tbody id="fitens">
      ${o.itens.map(i => { const s = situacaoItem(o, i); const c = e => `${n(s.boas[e])}${s.fora[e] ? ` <span class="mut">(+${s.fora[e]} fora)</span>` : ""}`;
        return `<tr><td><b>${esc(i.referencia)}</b> ${esc(i.descricao)}<br><span class="mut">${esc([i.cor, i.tamanho, i.edicao].filter(Boolean).join(" "))} · ${met(i.consumo)} por peça</span></td>
          <td class="num">${n(i.quantidade)}</td><td class="num">${c("corte")}</td><td class="num">${c("costura")}</td><td class="num">${c("lavagem")}</td><td class="num">${c("passadoria")}</td>
          <td class="num">${n(i.entraram)}</td><td class="num">${s.perdas ? `<b style="color:var(--crit)">${n(s.perdas)}</b>` : "0"}</td>${valores() ? `<td class="num">${i.custo != null && Number(i.custo) ? brl(i.custo) : "—"}</td>` : ""}</tr>`; }).join("")}
    </tbody></table></div>
    <h2 style="font-size:15px;margin:14px 0 4px">Remessas</h2>
    <div id="fenvios">${o.envios.length ? o.envios.map(e => `<div class="vlin envrow"><span><b>${ETAPA_TXT[e.etapa]}</b> · ${esc(e.parceiro_nome)} · ${n((e.itens || []).reduce((t, x) => t + x.enviadas, 0))} peça(s) em ${quando(e.enviado_em)}
        ${e.prazo ? ` · prazo ${dataBR(e.prazo)}` : ""}${valores() ? ` · ${brl(e.preco_peca)}/peça` : ""}${(e.rolos || []).length ? ` · tecido: ${esc(e.rolos.map(r => r.codigo + " " + met(r.metros)).join(", "))}` : ""}
        ${e.status === "aberto" ? (atrasado(e) ? ' <b style="color:var(--crit)">· atrasado</b>' : ` · <b>${n(pecasFora(e))} com o parceiro</b>`) : ' · <span class="tag">recebido</span>'}</span>
        <span class="acs">${e.status === "aberto" && aberta ? `<button type="button" class="lnk" data-rec="${e.id}">Receber e conferir</button>` : ""}${aberta ? `<button type="button" class="lnk" data-zap="${e.id}">WhatsApp</button>` : ""}</span></div>`).join("")
      : '<div class="mut">Nada enviado ainda.</div>'}</div>
    ${aberta ? `<div class="filtros" style="margin-top:12px">${[...ETAPAS, "estoque"].map(et => { const d = o.itens.reduce((t, i) => t + i.disp[et], 0);
        return `<button type="button" class="bt ${d ? "pri" : ""}" data-env="${et}" ${d ? "" : "disabled"}>${et === "estoque" ? "Dar entrada no estoque" : "Enviar para " + ETAPA_TXT[et].toLowerCase()} (${n(d)})</button>`; }).join("")}</div>` : ""}
    <div class="acoes"><button type="button" class="bt" id="fimp">Imprimir ficha</button>${aberta ? '<button type="button" class="bt" id="fenc">Encerrar ficha</button>' : ""}<button type="button" class="bt" id="fx">Fechar</button></div>`;
  $("fx").onclick = () => $("dlg").close();
  $("fimp").onclick = () => imprimirFicha(o);
  if ($("fenc")) $("fenc").onclick = async () => {
    const m = prompt(o.envios.length ? "Encerrar a ficha: o que faltou não vai mais ser feito. Motivo:" : "Cancelar a ficha (nada foi enviado). Motivo:"); if (!m) return;
    try { checar(await sb.rpc("lin_ordem_encerrar", { p_ordem: o.id, p_motivo: m })); $("dlg").close(); msg("ok", `Ficha nº ${o.id} encerrada.`); await telaProducao(); }
    catch (e) { msg("err", e.message); }
  };
  f.querySelectorAll("[data-env]").forEach(b => b.onclick = () => b.dataset.env === "estoque" ? entradaEstoque(o) : enviar(o, b.dataset.env));
  f.querySelectorAll("[data-rec]").forEach(b => b.onclick = () => receber(o, o.envios.find(e => e.id === +b.dataset.rec)));
  f.querySelectorAll("[data-zap]").forEach(b => b.onclick = () => zapEnvio(o, o.envios.find(e => e.id === +b.dataset.zap)));
  if (!$("dlg").open) $("dlg").showModal();
}

function zapEnvio(o, e) {
  const p = PD.parceiros.find(x => x.id === e.parceiro_id) || {};
  const linhas = (e.itens || []).map(x => { const i = o.itens.find(y => y.id === x.ordem_item_id); return `• ${x.enviadas}× ${i.referencia} ${i.descricao} ${[i.cor, i.tamanho, i.edicao].filter(Boolean).join(" ")}`; });
  const txt = `Olá, ${(p.nome || "").split(" ")[0]}! Linum — ficha nº ${o.id}, ${ETAPA_TXT[e.etapa].toLowerCase()}:\n${linhas.join("\n")}${e.etapa === "corte" && o.molde ? `\nMolde: ${o.molde}` : ""}${e.prazo ? `\nPrazo: ${dataBR(e.prazo)}` : ""}`;
  window.open(p.telefone ? `https://wa.me/55${p.telefone}?text=${encodeURIComponent(txt)}` : `https://wa.me/?text=${encodeURIComponent(txt)}`, "_blank", "noopener");
}

function imprimirFicha(o) {
  const w = window.open("", "_blank"); if (!w) return msg("err", "O navegador bloqueou a janela de impressão.");
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ficha nº ${o.id} — Linum</title>
    <style>body{font:14px system-ui,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:6px;text-align:left}td.n{text-align:right}.mut{color:#555}</style></head><body>
    <h1>LINUM · Ficha de produção nº ${o.id}</h1><div class="mut">${dataBR(new Date(o.criada_em).toLocaleDateString("en-CA", { timeZone: TZ }))}${o.prazo ? ` · prazo ${dataBR(o.prazo)}` : ""}</div>
    ${o.molde ? `<p><b>Molde e instruções:</b> ${esc(o.molde)}</p>` : ""}${o.observacao ? `<p><b>Obs.:</b> ${esc(o.observacao)}</p>` : ""}
    <table><thead><tr><th>Referência</th><th>Peça</th><th>Cor</th><th>Tamanho</th><th>Edição</th><th>Qtd</th><th>Metros/peça</th><th>Metros</th></tr></thead><tbody>
    ${o.itens.map(i => `<tr><td>${esc(i.referencia)}</td><td>${esc(i.descricao)}</td><td>${esc(i.cor)}</td><td>${esc(i.tamanho)}</td><td>${esc(i.edicao)}</td><td class="n">${i.quantidade}</td><td class="n">${decBR(i.consumo)}</td><td class="n">${decBR(+(i.quantidade * i.consumo).toFixed(2))}</td></tr>`).join("")}
    <tr><td colspan="5"><b>Total</b></td><td class="n"><b>${o.itens.reduce((t, i) => t + i.quantidade, 0)}</b></td><td></td><td class="n"><b>${decBR(+o.itens.reduce((t, i) => t + i.quantidade * i.consumo, 0).toFixed(2))}</b></td></tr></tbody></table>
    <p style="margin-top:30px">Cortador: ______________________________ &nbsp; Recebido em: ____/____/______</p></body></html>`);
  w.document.close(); w.focus(); w.print();
}

// remessa a um parceiro numa etapa
function enviar(o, etapa) {
  const f = $("dlg2f"), parcs = PD.parceiros.filter(p => p.ativo && p.tipo === ETAPA_PARC[etapa]);
  const itens = o.itens.filter(i => i.disp[etapa] > 0);
  // corte: rolos mais antigos primeiro (o linho que chegou antes sai antes)
  const rolos = etapa === "corte" ? PD.rolos.filter(r => Number(r.saldo) > 0).sort((a, b) => a.data_compra.localeCompare(b.data_compra) || a.codigo.localeCompare(b.codigo)) : [];
  f.innerHTML = `<h3>Ficha nº ${o.id} · enviar para ${ETAPA_TXT[etapa].toLowerCase()}</h3>
    ${parcs.length ? "" : `<div class="msg err">Nenhum ${TIPO_PARC[ETAPA_PARC[etapa]].toLowerCase()} cadastrado: cadastre em Produção → Parceiros.</div>`}
    <div class="campo grade2"><div><label for="envp">${TIPO_PARC[ETAPA_PARC[etapa]]}</label><select id="envp">${parcs.map(p => `<option value="${p.id}">${esc(p.nome)}${valores() ? ` · ${brl(p.preco_peca)}/peça` : ""}</option>`).join("")}</select></div>
      <div><label for="envprazo">Prazo para voltar</label><input type="date" id="envprazo" min="${hoje()}"></div></div>
    ${valores() ? `<div class="campo"><label for="envpreco">Preço por peça nesta remessa (R$)</label><input id="envpreco" inputmode="decimal" style="width:120px" placeholder="o do cadastro"></div>` : ""}
    <div class="caixa"><h4>Peças</h4>${itens.map(i => `<div class="vlin"><span>${esc(i.referencia)} ${esc([i.cor, i.tamanho, i.edicao].filter(Boolean).join(" "))} <span class="mut">· ${n(i.disp[etapa])} disponível(is)</span></span>
      <input type="number" min="0" max="${i.disp[etapa]}" value="${i.disp[etapa]}" data-env-i="${i.id}" style="width:80px" aria-label="Quantidade"></div>`).join("")}</div>
    ${etapa === "corte" ? `<div class="caixa"><h4>Tecido: precisa de <span id="envprec"></span></h4>${rolos.length ? rolos.map(r => `<div class="vlin"><span><b>${esc(r.codigo)}</b> ${esc(r.tecido)} ${esc(r.cor)}${r.composicao ? ` <span class="mut">(${esc(r.composicao)})</span>` : ""} <span class="mut">· saldo ${met(r.saldo, r.unidade)}${r.unidade === "kg" ? (r.rendimento ? ` ≈ ${met(+metrosRolo(r).toFixed(2))} (${decBR(r.rendimento)} m/kg)` : " · sem rendimento: informe em Rolos de tecido") : ""}</span></span>
      <input inputmode="decimal" data-rolo="${r.id}" data-cap="${metrosRolo(r) ?? 0}" placeholder="metros" style="width:90px" aria-label="Metros do rolo ${esc(r.codigo)}" ${metrosRolo(r) == null ? "disabled" : ""}></div>`).join("") : '<div class="msg err">Nenhum rolo com saldo: registre a compra em Rolos de tecido.</div>'}</div>` : ""}
    <div class="campo"><label for="envobs">Observação</label><input id="envobs" maxlength="300"></div>
    <div id="enverr"></div><div class="acoes"><button type="button" class="bt" id="envx">Cancelar</button><button type="button" class="bt pri" id="envok">Enviar</button></div>`;
  const precisa = () => itens.reduce((t, i) => t + (Number(f.querySelector(`[data-env-i="${i.id}"]`).value) || 0) * Number(i.consumo), 0);
  const preencher = () => {   // distribui os metros pelos rolos, na ordem, até o que cada um ainda dá (rolo por quilo: saldo × rendimento)
    if (etapa !== "corte") return; let falta = precisa(); $("envprec").textContent = met(+falta.toFixed(2));
    f.querySelectorAll("[data-rolo]:not([disabled])").forEach(inp => { const x = Math.min(falta, Number(inp.dataset.cap)); inp.value = x > 0 ? decBR(+x.toFixed(2)) : ""; falta -= Math.max(x, 0); });
  };
  f.querySelectorAll("[data-env-i]").forEach(inp => inp.oninput = preencher);
  preencher();
  $("envx").onclick = () => $("dlg2").close();
  $("envok").onclick = async () => {
    $("envok").disabled = true;
    try {
      checar(await sb.rpc("lin_envio_criar", { p: { ordem_id: o.id, etapa, parceiro_id: $("envp").value, prazo: $("envprazo").value, observacao: $("envobs").value,
        preco_peca: $("envpreco") ? numBR($("envpreco").value) : "",
        itens: [...f.querySelectorAll("[data-env-i]")].map(inp => ({ ordem_item_id: +inp.dataset.envI, quantidade: inp.value })),
        rolos: [...f.querySelectorAll("[data-rolo]")].map(inp => ({ rolo_id: inp.dataset.rolo, metros: numBR(inp.value) })) } }));
      $("dlg2").close(); msg("ok", `Enviado para ${ETAPA_TXT[etapa].toLowerCase()}.`); await carregarProducao(); verFicha(o.id);
    } catch (e) { $("enverr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; $("envok").disabled = false; }
  };
  $("dlg2").showModal();
}

// conferência na volta (pode ser parcial)
function receber(o, e) {
  const f = $("dlg2f");
  const its = (e.itens || []).filter(x => x.enviadas > x.recebidas + x.perdas);
  f.innerHTML = `<h3>Receber de ${esc(e.parceiro_nome)} · ${ETAPA_TXT[e.etapa]}</h3><div class="mut">Ficha nº ${o.id}. Confira as peças: as boas seguem para a próxima etapa; as perdidas ou com defeito precisam de motivo. Pode receber só uma parte agora.</div>
    <div class="tw" style="margin-top:8px"><table><thead><tr><th>Peça</th><th class="num">Com o parceiro</th><th class="num">Boas</th><th class="num">Perdas</th><th>Motivo da perda</th></tr></thead><tbody>
    ${its.map(x => { const i = o.itens.find(y => y.id === x.ordem_item_id), r = x.enviadas - x.recebidas - x.perdas;
      return `<tr><td>${esc(i.referencia)} ${esc([i.cor, i.tamanho, i.edicao].filter(Boolean).join(" "))}</td><td class="num">${r}</td>
        <td class="num"><input type="number" min="0" max="${r}" value="${r}" data-rb="${x.ordem_item_id}" style="width:70px" aria-label="Boas"></td>
        <td class="num"><input type="number" min="0" max="${r}" value="0" data-rp="${x.ordem_item_id}" style="width:70px" aria-label="Perdas"></td>
        <td><input data-rm="${x.ordem_item_id}" placeholder="Ex.: mancha, corte errado" aria-label="Motivo"></td></tr>`; }).join("")}</tbody></table></div>
    ${e.etapa === "corte" && (e.rolos || []).length ? `<div class="caixa"><h4>Sobra de tecido que voltou</h4>${e.rolos.map(r => `<div class="vlin"><span>${esc(r.codigo)} <span class="mut">· usados ${met(r.metros)} · sobra em ${UNID[unRolo(r.rolo_id)]}</span></span><input inputmode="decimal" data-sobra="${r.rolo_id}" placeholder="${UNID[unRolo(r.rolo_id)]}" style="width:90px" aria-label="Sobra ${esc(r.codigo)}"></div>`).join("")}</div>` : ""}
    <div class="campo"><label for="recobs">Observação da conferência</label><input id="recobs" maxlength="300"></div>
    <div id="recerr"></div><div class="acoes"><button type="button" class="bt" id="recx">Cancelar</button><button type="button" class="bt pri" id="recok">Registrar conferência</button></div>`;
  $("recx").onclick = () => $("dlg2").close();
  $("recok").onclick = async () => {
    $("recok").disabled = true;
    try {
      checar(await sb.rpc("lin_envio_receber", { p: { envio_id: e.id, observacao: $("recobs").value,
        itens: its.map(x => ({ ordem_item_id: x.ordem_item_id, recebidas: f.querySelector(`[data-rb="${x.ordem_item_id}"]`).value, perdas: f.querySelector(`[data-rp="${x.ordem_item_id}"]`).value, motivo: f.querySelector(`[data-rm="${x.ordem_item_id}"]`).value })),
        sobra: [...f.querySelectorAll("[data-sobra]")].map(inp => ({ rolo_id: inp.dataset.sobra, metros: numBR(inp.value) })) } }));
      $("dlg2").close(); msg("ok", "Conferência registrada."); await carregarProducao(); verFicha(o.id);
    } catch (err) { $("recerr").innerHTML = `<div class="msg err">${esc(err.message)}</div>`; $("recok").disabled = false; }
  };
  $("dlg2").showModal();
}

function entradaEstoque(o) {
  const f = $("dlg2f"), its = o.itens.filter(i => i.disp.estoque > 0);
  f.innerHTML = `<h3>Ficha nº ${o.id} · dar entrada no estoque</h3><div class="mut">Peças que voltaram boas da passadoria e entram para a venda.</div>
    <div class="campo"><label for="entloja">Loja</label><select id="entloja">${PD.lojas.map(l => `<option value="${l.id}" ${l.id === o.loja_destino_id ? "selected" : ""}>${esc(l.nome)}</option>`).join("")}</select></div>
    <div class="caixa">${its.map(i => `<div class="vlin"><span>${esc(i.referencia)} ${esc(i.descricao)} ${esc([i.cor, i.tamanho, i.edicao].filter(Boolean).join(" "))} <span class="mut">· ${n(i.disp.estoque)} pronta(s)</span>${valores() && Number(i.custo) ? ` <span class="mut">· custo ${brl(i.custo)}</span>` : ""}</span>
      <input type="number" min="0" max="${i.disp.estoque}" value="${i.disp.estoque}" data-ent="${i.id}" style="width:80px" aria-label="Quantidade"></div>`).join("")}</div>
    <div id="enterr"></div><div class="acoes"><button type="button" class="bt" id="entx">Cancelar</button><button type="button" class="bt pri" id="entok">Dar entrada</button></div>`;
  $("entx").onclick = () => $("dlg2").close();
  $("entok").onclick = async () => {
    $("entok").disabled = true;
    try {
      checar(await sb.rpc("lin_ordem_entrada", { p: { ordem_id: o.id, loja_id: $("entloja").value, itens: its.map(i => ({ ordem_item_id: i.id, quantidade: f.querySelector(`[data-ent="${i.id}"]`).value })) } }));
      $("dlg2").close(); msg("ok", "Peças no estoque."); await carregar(); await carregarProducao(); verFicha(o.id);
    } catch (e) { $("enterr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; $("entok").disabled = false; }
  };
  $("dlg2").showModal();
}

// ---------------------------------------------------------------- rolos
const faltaDado = r => !r.cor || !r.composicao;
function pdRolos() {
  const l = PD.rolos.filter(r => !FPR.comSaldo || Number(r.saldo) > 0);
  $("pdtela").innerHTML = `<div class="cabtela"><button type="button" class="pilula ${FPR.comSaldo ? "on" : ""}" id="pdsaldo">Só rolos com saldo</button><span style="display:flex;gap:8px;flex-wrap:wrap">${PD.rolos.some(faltaDado) ? `<button type="button" class="bt" id="pdcores">Preencher cor e composição (${PD.rolos.filter(faltaDado).length})</button>` : ""}<label class="bt" for="pdxml" style="cursor:pointer;margin:0;text-transform:none;letter-spacing:0;font-size:inherit">Importar XML da nota</label><input type="file" id="pdxml" accept=".xml,text/xml" class="oculto"><button class="bt pri" id="pdcompra">+ Registrar compra</button></span></div>
    <div class="card"><div class="tw"><table><thead><tr><th>Rolo</th><th>Tecido</th><th>Composição</th><th>Cor</th><th>Compra</th><th>Fornecedor</th><th class="num">Comprado</th><th class="num">Saldo</th>${valores() ? '<th class="num">Valor pago</th><th class="num">R$ por m/kg</th>' : ""}</tr></thead><tbody id="pdrolos">
    ${l.length ? l.map(r => `<tr class="rlrow" data-r="${r.id}" style="cursor:pointer"><td><b>${esc(r.codigo)}</b></td><td>${esc(r.tecido)}</td><td>${esc(r.composicao) || "—"}</td><td>${esc(r.cor) || "—"}</td><td>${dataBR(r.data_compra)}</td><td>${esc(r.fornecedor) || "—"}</td>
      <td class="num">${met(r.metros_iniciais, r.unidade)}</td><td class="num"><b>${met(r.saldo, r.unidade)}</b>${r.unidade === "kg" ? `<br><span class="mut">${r.rendimento ? "≈ " + met(+metrosRolo(r).toFixed(2)) : "sem rendimento"}</span>` : ""}</td>${valores() ? `<td class="num">${brl(r.valor_pago)}</td><td class="num">${brl(r.valor_pago / r.metros_iniciais)}</td>` : ""}</tr>`).join("")
      : `<tr><td colspan="10" class="mut">${PD.rolos.length ? "Nenhum rolo com saldo." : "Nenhum rolo ainda: registre a compra."}</td></tr>`}</tbody></table></div></div>`;
  $("pdsaldo").onclick = () => { FPR.comSaldo = !FPR.comSaldo; pdRolos(); };
  $("pdcompra").onclick = comprarRolos;
  if ($("pdcores")) $("pdcores").onclick = preencherCores;
  $("pdxml").onchange = e => { const arq = e.target.files[0]; e.target.value = ""; if (arq) arq.text().then(importarXml); };
  document.querySelectorAll(".rlrow").forEach(r => r.onclick = () => verRolo(r.dataset.r));
}
function comprarRolos() {
  const f = $("dlg2f");
  f.innerHTML = `<h3>Compra de rolos de tecido</h3><div class="mut">Rolos iguais (mesmo tecido, cor e tamanho) podem ser registrados juntos: cada um ganha o seu código. Com o XML da nota é mais rápido: "Importar XML da nota".</div>
    <div class="campo grade3"><div><label for="rctec">Tecido</label><input id="rctec" placeholder="Ex.: Cambraia, Mykonos"></div><div><label for="rccomp">Composição</label><input id="rccomp" list="lcomp" placeholder="Ex.: 100% Linho">${listaComp()}</div><div><label for="rccor">Cor</label><input id="rccor"></div></div>
    <div class="campo grade3"><div><label for="rcun">Comprado por</label><select id="rcun"><option value="m">Metro</option><option value="kg">Quilo</option></select></div><div><label for="rcqtd">Quantos rolos</label><input id="rcqtd" type="number" min="1" value="1"></div><div><label for="rcmet">Metros ou quilos de cada rolo</label><input id="rcmet" inputmode="decimal"></div></div>
    <div class="campo grade3">
      <div><label for="rcdata">Data da compra</label><input id="rcdata" type="date" value="${hoje()}" max="${hoje()}"></div>
      <div><label for="rcforn">Fornecedor</label><input id="rcforn"></div><div><label for="rcnota">Nota fiscal</label><input id="rcnota"></div></div>
    <div class="campo oculto" id="rcrendc"><label for="rcrend">Rendimento: quantos metros dá 1 kg (pode informar depois)</label><input id="rcrend" inputmode="decimal" style="width:120px"></div>
    ${valores() ? `<div class="campo"><label for="rcvalor">Valor pago (total da compra, R$)</label><input id="rcvalor" inputmode="decimal" style="width:160px"></div>` : ""}
    <div id="rcerr"></div><div class="acoes"><button type="button" class="bt" id="rcx">Cancelar</button><button type="button" class="bt pri" id="rcok">Registrar compra</button></div>`;
  $("rcx").onclick = () => $("dlg2").close();
  $("rcun").onchange = () => $("rcrendc").classList.toggle("oculto", $("rcun").value !== "kg");
  $("rcok").onclick = async () => {
    try {
      const r = checar(await sb.rpc("lin_rolo_comprar", { p: { unidade: $("rcun").value, rendimento: numBR($("rcrend").value), tecido: $("rctec").value, composicao: $("rccomp").value, cor: $("rccor").value, quantidade: $("rcqtd").value, metros: numBR($("rcmet").value),
        data_compra: $("rcdata").value, fornecedor: $("rcforn").value, nota: $("rcnota").value, valor_pago: $("rcvalor") ? numBR($("rcvalor").value) : "" } }));
      $("dlg2").close(); msg("ok", `Rolo(s) ${r.map(x => x.codigo).join(", ")} registrado(s).`); FPR.aba = "rolos"; await telaProducao();
    } catch (e) { $("rcerr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
  $("dlg2").showModal(); $("rctec").focus();
}
async function verRolo(id) {
  const r = PD.rolos.find(x => x.id === id), f = $("dlgf"); let h = [];
  try { h = checar(await sb.rpc("lin_rolo_historico", { p_rolo: id })) || []; } catch (e) { return msg("err", e.message); }
  const TIPO = { compra: "Compra", corte: "Corte", sobra: "Sobra do corte", ajuste: "Ajuste" };
  f.innerHTML = `<h3>Rolo ${esc(r.codigo)}</h3><div class="mut">${esc(r.tecido)} ${esc(r.cor)}${r.composicao ? " · " + esc(r.composicao) : ""} · comprado em ${dataBR(r.data_compra)}${r.fornecedor ? " de " + esc(r.fornecedor) : ""}${r.nota ? " · NF " + esc(r.nota) : ""}</div>
    ${r.observacoes ? `<div class="mut">${esc(r.observacoes)}</div>` : ""}<div style="margin-top:6px"><button type="button" class="bt" id="rled">Editar dados do rolo</button></div>
    <div class="kpis" style="margin-top:8px"><div class="kpi"><small>Saldo</small><b>${met(r.saldo, r.unidade)}</b><span>de ${met(r.metros_iniciais, r.unidade)}</span></div>${valores() ? `<div class="kpi"><small>Valor pago</small><b>${brl(r.valor_pago)}</b><span>${brl(r.valor_pago / r.metros_iniciais)} por ${r.unidade === "kg" ? "quilo" : "metro"}${r.unidade === "kg" && r.rendimento ? ` · ${brl(r.valor_pago / (r.metros_iniciais * r.rendimento))} por metro` : ""}</span></div>` : ""}${r.unidade === "kg" ? `<div class="kpi"><small>Rendimento</small><b>${r.rendimento ? decBR(r.rendimento) + " m/kg" : "—"}</b><span>${r.rendimento ? "≈ " + met(+metrosRolo(r).toFixed(2)) + " no saldo" : "falta informar"}</span></div>` : ""}</div>
    <div class="tw"><table><thead><tr><th>Quando</th><th>O quê</th><th class="num">${r.unidade === "kg" ? "Quilos" : "Metros"}</th><th class="num">Saldo</th><th>Quem</th></tr></thead><tbody>
    ${h.map(m => `<tr><td>${quando(m.em)}</td><td>${TIPO[m.tipo]}${m.motivo ? `<br><span class="mut">${esc(m.motivo)}</span>` : ""}</td><td class="num">${Number(m.metros) > 0 ? "+" : ""}${decBR(m.metros)}</td><td class="num">${met(m.saldo_depois, r.unidade)}</td><td>${esc(m.por_nome)}</td></tr>`).join("")}</tbody></table></div>
    ${r.unidade === "kg" ? `<div class="caixa"><h4>Rendimento (metros por kg)</h4><div class="mut">Comprado por quilo: a peça é medida em metros, então o corte usa este rendimento para baixar o rolo.</div>
      <div class="filtros" style="margin:6px 0 0;align-items:center"><input id="rrend" inputmode="decimal" value="${esc(decBR(r.rendimento || ""))}" placeholder="metros por kg" style="flex:0 1 140px"><button type="button" class="bt" id="rrendok">Salvar rendimento</button></div><div id="rrenderr"></div></div>` : ""}
    <div class="caixa"><h4>Ajustar o saldo</h4><div class="mut">Depois de medir o rolo, de um retalho perdido ou quando o rolo acabar.</div>
      <div class="filtros" style="margin:6px 0 0;align-items:center"><input id="rajs" inputmode="decimal" placeholder="saldo real (${r.unidade})" style="flex:0 1 140px"><input id="rajm" placeholder="Motivo"><button type="button" class="bt" id="rajok">Ajustar</button></div><div id="rajerr"></div></div>
    <div class="acoes"><button type="button" class="bt" id="rlx">Fechar</button></div>`;
  $("rlx").onclick = () => $("dlg").close();
  $("rled").onclick = () => editarRolo(r);
  if ($("rrendok")) $("rrendok").onclick = async () => {
    try { checar(await sb.rpc("lin_rolo_rendimento", { p_rolo: id, p_rendimento: numBR($("rrend").value) === "" ? null : Number(numBR($("rrend").value)) }));
      await carregarProducao(); msg("ok", "Rendimento salvo."); verRolo(id); pdRolos(); }
    catch (e) { $("rrenderr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
  $("rajok").onclick = async () => {
    try { checar(await sb.rpc("lin_rolo_ajustar", { p_rolo: id, p_saldo: numBR($("rajs").value) === "" ? null : Number(numBR($("rajs").value)), p_motivo: $("rajm").value }));
      await carregarProducao(); msg("ok", "Saldo ajustado."); verRolo(id); pdRolos(); }
    catch (e) { $("rajerr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
  if (!$("dlg").open) $("dlg").showModal();
}

// corrige a descrição do rolo (tecido, cor, fornecedor, nota, data, observações; valor só com Valores). Saldo = "Ajustar o saldo".
function editarRolo(r) {
  const f = $("dlg2f"), sug = !r.cor ? corDaDescricao(r.tecido) : null;
  f.innerHTML = `<h3>Editar o rolo ${esc(r.codigo)}</h3><div class="mut">Quantidade e saldo não mudam aqui: use "Ajustar o saldo".</div>
    <div class="campo grade2"><div><label for="retec">Tecido</label><input id="retec" value="${esc(sug && sug.cor ? sug.tecido : r.tecido)}"></div>
      <div><label for="recor">Cor</label><input id="recor" value="${esc(r.cor || (sug && sug.cor) || "")}"></div></div>
    <div class="campo"><label for="recomp">Composição</label><input id="recomp" list="lcomp" value="${esc(r.composicao || composicaoDaDescricao(r.tecido))}" placeholder="Ex.: 100% Linho, 55% Linho 45% Algodão">${listaComp()}</div>
    ${(sug && sug.cor) || (!r.composicao && composicaoDaDescricao(r.tecido)) ? `<div class="msg info">Cor e composição sugeridas pela descrição da nota ("${esc(r.tecido)}"): confira antes de salvar.</div>` : ""}
    <div class="campo grade3"><div><label for="redata">Data da compra</label><input id="redata" type="date" value="${esc(r.data_compra)}" max="${hoje()}"></div>
      <div><label for="reforn">Fornecedor</label><input id="reforn" value="${esc(r.fornecedor)}"></div><div><label for="renota">Nota fiscal</label><input id="renota" value="${esc(r.nota)}"></div></div>
    ${valores() ? `<div class="campo"><label for="revalor">Valor pago (R$)</label><input id="revalor" inputmode="decimal" value="${esc(moeda(r.valor_pago))}" style="width:160px"></div>` : ""}
    <div class="campo"><label for="reobs">Observações</label><input id="reobs" value="${esc(r.observacoes)}"></div>
    <div id="reerr"></div><div class="acoes"><button type="button" class="bt" id="rex">Cancelar</button><button type="button" class="bt pri" id="reok">Salvar</button></div>`;
  $("rex").onclick = () => $("dlg2").close();
  $("reok").onclick = async () => {
    const d = { id: r.id, tecido: $("retec").value, cor: $("recor").value, composicao: $("recomp").value, data_compra: $("redata").value, fornecedor: $("reforn").value, nota: $("renota").value, observacoes: $("reobs").value };
    if ($("revalor")) d.valor_pago = numBR($("revalor").value);
    try { checar(await sb.rpc("lin_rolos_editar", { p: { rolos: [d] } }));
      $("dlg2").close(); await carregarProducao(); msg("ok", `Rolo ${r.codigo} alterado.`); verRolo(r.id); pdRolos(); }
    catch (e) { $("reerr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
  $("dlg2").showModal(); $("recor").focus();
}
// rolos sem cor ou sem composição: sugere pela descrição (a NF-e não tem esses campos) e grava tudo de uma vez
function preencherCores() {
  const l = PD.rolos.filter(faltaDado), f = $("dlgf"); $("dlg").classList.add("largo");
  f.innerHTML = `<h3>Preencher cor e composição dos rolos</h3>
    <div class="msg info">A nota fiscal não tem campo de cor nem de composição: a sugestão vem da descrição do item (a cor é a parte depois do nome do tecido; "PURO LINHO" = 100% Linho; percentuais escritos na descrição). Confira, corrija ou deixe em branco.</div>
    <div class="tw"><table><thead><tr><th>Rolo</th><th>Descrição atual</th><th>Tecido</th><th>Composição</th><th>Cor</th></tr></thead><tbody>
    ${l.map(r => { const s = r.cor ? { tecido: r.tecido, cor: r.cor } : corDaDescricao(r.tecido);
      return `<tr><td><b>${esc(r.codigo)}</b><br><span class="mut">${esc(r.fornecedor)}${r.nota ? " · NF " + esc(r.nota) : ""}</span></td><td class="mut">${esc(r.tecido)}</td>
        <td><input data-pct="${r.id}" value="${esc(s.cor ? s.tecido : r.tecido)}"></td>
        <td><input data-pcx="${r.id}" list="lcomp" value="${esc(r.composicao || composicaoDaDescricao(r.tecido))}" placeholder="composição" style="width:170px"></td>
        <td><input data-pcc="${r.id}" value="${esc(s.cor)}" placeholder="cor" style="width:130px"></td></tr>`; }).join("")}</tbody></table></div>${listaComp()}
    <div id="pcerr"></div><div class="acoes"><button type="button" class="bt" id="pcx">Cancelar</button><button type="button" class="bt pri" id="pcok">Salvar</button></div>`;
  $("pcx").onclick = () => $("dlg").close();
  $("pcok").onclick = async () => {
    const rolos = l.map(r => ({ r, x: { id: r.id, tecido: f.querySelector(`[data-pct="${r.id}"]`).value.trim(), cor: f.querySelector(`[data-pcc="${r.id}"]`).value.trim(),
        composicao: f.querySelector(`[data-pcx="${r.id}"]`).value.trim() } }))
      .filter(({ r, x }) => x.tecido !== r.tecido || x.cor !== (r.cor || "") || x.composicao !== (r.composicao || "")).map(({ x }) => x);
    if (!rolos.length) return $("dlg").close();
    $("pcok").disabled = true;
    try { const q = checar(await sb.rpc("lin_rolos_editar", { p: { rolos } }));
      $("dlg").close(); msg("ok", `${q} rolo(s) alterado(s).`); FPR.aba = "rolos"; await telaProducao(); }
    catch (e) { $("pcerr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; $("pcok").disabled = false; }
  };
  $("dlg").showModal();
}

// ---------------------------------------------------------------- parceiros
function pdParceiros() {
  $("pdtela").innerHTML = `<div class="cabtela"><span class="mut">Cortadores, costureiras, lavanderia e passadoria${valores() ? ", com o preço por peça" : ""}.</span><button class="bt pri" id="pdnovop">+ Novo parceiro</button></div>
    <div class="card"><div class="tw"><table><thead><tr><th>Parceiro</th><th>Tipo</th><th>Telefone</th><th class="num">Com ele agora</th>${valores() ? '<th class="num">Preço/peça</th>' : ""}</tr></thead><tbody id="pdparcs">
    ${PD.parceiros.length ? PD.parceiros.map(p => { const fora = PD.ordens.reduce((t, o) => t + o.envios.filter(e => e.status === "aberto" && e.parceiro_id === p.id).reduce((u, e) => u + pecasFora(e), 0), 0);
      return `<tr class="pprow" data-p="${p.id}" style="cursor:pointer"><td><b>${esc(p.nome)}</b>${p.ativo ? "" : ' <span class="tag">inativo</span>'}${p.contato ? `<br><span class="mut">${esc(p.contato)}</span>` : ""}</td><td>${TIPO_PARC[p.tipo]}</td>
        <td>${p.telefone ? `<a href="https://wa.me/55${esc(p.telefone)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(fone(p.telefone))}</a>` : "—"}</td><td class="num">${fora ? n(fora) + " peça(s)" : "—"}</td>${valores() ? `<td class="num">${brl(p.preco_peca)}</td>` : ""}</tr>`; }).join("")
      : '<tr><td colspan="5" class="mut">Nenhum parceiro ainda.</td></tr>'}</tbody></table></div></div>`;
  $("pdnovop").onclick = () => editarParceiro(null);
  document.querySelectorAll(".pprow").forEach(r => r.onclick = () => editarParceiro(PD.parceiros.find(p => p.id === r.dataset.p)));
}
function editarParceiro(p) {
  const f = $("dlg2f"), P = Object.assign({ nome: "", tipo: "costureira", telefone: "", contato: "", preco_peca: 0, ativo: true, observacoes: "" }, p || {});
  f.innerHTML = `<h3>${P.id ? "Editar parceiro" : "Novo parceiro"}</h3>
    <div class="campo grade2"><div><label for="ppnome">Nome</label><input id="ppnome" value="${esc(P.nome)}"></div>
      <div><label for="pptipo">Tipo</label><select id="pptipo">${Object.entries(TIPO_PARC).map(([k, t]) => `<option value="${k}" ${k === P.tipo ? "selected" : ""}>${t}</option>`).join("")}</select></div></div>
    <div class="campo grade2"><div><label for="pptel">Telefone (WhatsApp)</label><input id="pptel" inputmode="tel" value="${esc(fone(P.telefone))}"></div><div><label for="ppcont">Contato / endereço</label><input id="ppcont" value="${esc(P.contato)}"></div></div>
    ${valores() ? `<div class="campo"><label for="pppreco">Preço por peça (R$)</label><input id="pppreco" inputmode="decimal" value="${esc(moeda(P.preco_peca))}" style="width:120px"></div>` : ""}
    <div class="campo"><label for="ppobs">Observações</label><input id="ppobs" value="${esc(P.observacoes)}"></div>
    ${P.id ? `<label class="chk"><input type="checkbox" id="ppativo" ${P.ativo ? "checked" : ""}> Ativo (inativo não aparece para novas remessas)</label>` : ""}
    <div id="pperr"></div><div class="acoes"><button type="button" class="bt" id="ppx">Cancelar</button><button type="button" class="bt pri" id="ppok">Salvar</button></div>`;
  $("ppx").onclick = () => $("dlg2").close();
  $("ppok").onclick = async () => {
    try { checar(await sb.rpc("lin_parceiro_salvar", { p: { id: P.id || null, nome: $("ppnome").value, tipo: $("pptipo").value, telefone: $("pptel").value, contato: $("ppcont").value,
        observacoes: $("ppobs").value, preco_peca: $("pppreco") ? numBR($("pppreco").value) : "", ativo: $("ppativo") ? $("ppativo").checked : true } }));
      $("dlg2").close(); msg("ok", "Parceiro salvo."); FPR.aba = "parceiros"; await telaProducao(); }
    catch (e) { $("pperr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
  $("dlg2").showModal(); $("ppnome").focus();
}

// ---------------------------------------------------------------- metragem por peça
function pdMetragem() {
  $("pdtela").innerHTML = `<div class="card"><p class="mut">Quantos metros de tecido cada peça gasta (a peça é sempre medida em metros, mesmo quando o tecido é comprado por quilo). Se um tamanho gasta diferente, informe no tamanho; vazio = usa a da peça. A ficha copia a metragem do momento, e na própria ficha dá para trocar e "Atualizar na peça".</p>
    <input id="mtq" type="search" placeholder="Procurar peça" style="margin-bottom:8px"><div id="mtlista"></div></div>`;
  const lista = () => {
    const t = $("mtq").value.trim().toLowerCase();
    const l = PD.produtos.filter(p => !t || p.referencia.toLowerCase().includes(t) || p.descricao.toLowerCase().includes(t)).slice(0, 60);
    $("mtlista").innerHTML = l.map(p => `<div class="caixa mtprod" data-p="${p.id}"><div class="vlin"><span><b>${esc(p.referencia)}</b> ${esc(p.descricao)}</span>
        <span class="acs"><input inputmode="decimal" data-mt="${p.id}" value="${esc(decBR(p.consumo || ""))}" placeholder="metros" style="width:90px" aria-label="Metros por peça de ${esc(p.referencia)}"><button type="button" class="lnk" data-mtok="${p.id}">Salvar</button></span></div>
      ${p.variantes.length ? `<details><summary class="mut">Por tamanho (${p.variantes.filter(v => v.consumo).length} diferente(s))</summary>${p.variantes.map(v => `<div class="vlin"><span>${esc([v.cor, v.tamanho, v.edicao].filter(Boolean).join(" "))}</span>
        <input inputmode="decimal" data-mtv="${v.id}" value="${esc(decBR(v.consumo || ""))}" placeholder="igual à peça" style="width:110px"></div>`).join("")}</details>` : ""}</div>`).join("")
      || '<div class="mut">Nenhuma peça.</div>';
    document.querySelectorAll("[data-mtok]").forEach(b => b.onclick = async () => {
      const box = b.closest(".mtprod"), vs = {};
      box.querySelectorAll("[data-mtv]").forEach(inp => vs[inp.dataset.mtv] = numBR(inp.value));
      try { checar(await sb.rpc("lin_consumo_salvar", { p: { produto_id: b.dataset.mtok, consumo_metros: numBR(box.querySelector("[data-mt]").value), variantes: vs } }));
        await carregarProducao(); msg("ok", "Metragem salva."); }
      catch (e) { msg("err", e.message); }
    });
  };
  $("mtq").oninput = lista; lista();
}

// ---------------------------------------------------------------- importar o XML da NF-e de compra (lido no navegador)
// layout 4.00: infNFe@Id = "NFe" + chave; ide/nNF, ide/dhEmi; emit/xNome; det@nItem → prod (xProd, uCom, qCom, vProd, vDesc,
// vFrete, vSeg, vOutro) e imposto (IPI/vIPI, ICMS vICMSST). Valor do item = vProd − vDesc + frete + seguro + outras + IPI + ST.
const UN_NFE = u => { const x = String(u || "").trim().toUpperCase().replace(/\./g, "");
  return /^(KG|KGS|KILO|KILOS|QUILO|QUILOS|QUILOGRAMA)$/.test(x) ? "kg" : /^(M|MT|MTS|MTR|METRO|METROS|ML|MTL)$/.test(x) ? "m" : ""; };
// a NF-e não tem campo de cor: procura a primeira palavra de cor na descrição ("PURO LINHO MYKONOS BRANCO OPTICO" →
// tecido "PURO LINHO MYKONOS", cor "Branco Optico"); o resto da descrição a partir dela é a cor. Sem cor conhecida = vazio.
const CORES = ["NATURAL", "CRU", "CRUA", "BRANCO", "BRANCA", "OFF", "OFFWHITE", "PRETO", "PRETA", "MARITIMO", "MARINHO", "AZUL", "CHOCO", "CHOCOLATE",
  "MILITAR", "AREIA", "BEGE", "VERDE", "OLIVA", "ROSA", "ROSE", "VERMELHO", "VERMELHA", "CINZA", "GRAFITE", "CHUMBO", "CARAMELO", "TERRACOTA", "TELHA",
  "MOSTARDA", "AMARELO", "AMARELA", "MARROM", "CAQUI", "KAKI", "CAMEL", "NUDE", "LILAS", "LAVANDA", "VINHO", "BORDO", "LARANJA", "CORAL", "CREME", "MARFIM",
  "PEROLA", "GELO", "TABACO", "CAFE", "FENDI", "PETROLEO", "TURQUESA", "SALMAO", "MENTA", "PALHA", "LINHACA", "OURO", "DOURADO", "PRATA", "ESTAMPADO"];
function corDaDescricao(txt) {
  const t = String(txt || "").trim(), pal = t.split(/\s+/);
  const norm = w => w.split(/[-/]/)[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z]/g, "");
  const i = pal.findIndex((w, k) => k > 0 && CORES.includes(norm(w)));
  if (i < 1) return { tecido: t, cor: "" };
  const resto = pal.slice(i), j = resto.findIndex(w => /\d/.test(w)), cor = j < 0 ? resto : resto.slice(0, j);   // "AREIA 1,40M": a largura fica no tecido
  return { tecido: pal.slice(0, i).concat(j < 0 ? [] : resto.slice(j)).join(" "), cor: cor.join(" ").toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()) };
}
// composição pela descrição: percentuais escritos ("98.500% ALGODAO 1.500% ELASTANO" → "98,5% Algodão 1,5% Elastano")
// ou "PURO LINHO" / "LINHO PURO" → "100% Linho". Sem nada disso = vazio (a pessoa escreve).
const FIBRAS = { ALGODAO: "Algodão", LINHO: "Linho", ELASTANO: "Elastano", VISCOSE: "Viscose", POLIESTER: "Poliéster", POLIAMIDA: "Poliamida",
  SEDA: "Seda", LA: "Lã", LIOCEL: "Liocel", LYOCELL: "Liocel", MODAL: "Modal", RAMI: "Rami", ACRILICO: "Acrílico", CANHAMO: "Cânhamo" };
function composicaoDaDescricao(txt) {
  const t = String(txt || "");
  const ps = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*%\s*(?:DE\s+)?([A-Za-zÀ-ÿ]+)/gi)].map(m => {
    const fib = m[2].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    return `${Number(m[1].replace(",", ".")).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% ${FIBRAS[fib] || m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase()}`;
  });
  if (ps.length) return ps.join(" ");
  return /\bPURO\s+LINHO\b|\bLINHO\s+PURO\b/i.test(t) ? "100% Linho" : "";
}
const COMPOSICOES = ["100% Linho", "100% Algodão", "Linho e Algodão", "Linho e Viscose", "Linho com Elastano", "Algodão com Elastano", "100% Viscose", "100% Seda"];
const listaComp = () => `<datalist id="lcomp">${COMPOSICOES.map(c => `<option value="${c}">`).join("")}</datalist>`;
function lerNfe(xml) {
  const d = new DOMParser().parseFromString(xml, "application/xml");
  if (d.getElementsByTagName("parsererror").length) throw new Error("O arquivo não é um XML válido.");
  const tag = (el, t) => { const x = el && el.getElementsByTagNameNS("*", t)[0]; return x ? x.textContent.trim() : ""; };
  const inf = d.getElementsByTagNameNS("*", "infNFe")[0];
  if (!inf) throw new Error("Este XML não é de uma NF-e (não tem infNFe).");
  const chave = (inf.getAttribute("Id") || "").replace(/\D/g, "");
  const ide = inf.getElementsByTagNameNS("*", "ide")[0], emit = inf.getElementsByTagNameNS("*", "emit")[0];
  const itens = [...inf.getElementsByTagNameNS("*", "det")].map(det => {
    const pr = det.getElementsByTagNameNS("*", "prod")[0], im = det.getElementsByTagNameNS("*", "imposto")[0];
    const v = t => Number(tag(pr, t) || 0);
    const ipi = im ? Number(tag(im.getElementsByTagNameNS("*", "IPI")[0], "vIPI") || 0) : 0, st = im ? Number(tag(im, "vICMSST") || 0) : 0;
    const ad = [...det.children].find(x => x.localName === "infAdProd");
    return { item: Number(det.getAttribute("nItem")), xProd: tag(pr, "xProd"), infAdProd: ad ? ad.textContent.trim() : "", uCom: tag(pr, "uCom"), qCom: Number(tag(pr, "qCom") || 0),
             valor: +(v("vProd") - v("vDesc") + v("vFrete") + v("vSeg") + v("vOutro") + ipi + st).toFixed(2) };
  });
  return { chave, numero: tag(ide, "nNF"), data: (tag(ide, "dhEmi") || tag(ide, "dEmi")).slice(0, 10), fornecedor: tag(emit, "xNome"), cnpj: tag(emit, "CNPJ"), itens };
}
function importarXml(xml) {
  let nf; try { nf = lerNfe(xml); } catch (e) { return msg("err", e.message); }
  if (nf.chave.length !== 44) return msg("err", "Não achei a chave de 44 dígitos da nota no XML.");
  const ja = new Set(PD.rolos.filter(r => r.nfe_item != null && r.nota === nf.numero && r.fornecedor === nf.fornecedor).map(r => r.nfe_item));
  const f = $("dlgf"); $("dlg").classList.add("largo");
  f.innerHTML = `<h3>Importar nota nº ${esc(nf.numero)}</h3>
    <div class="mut">${esc(nf.fornecedor)}${nf.cnpj ? " · CNPJ " + esc(nf.cnpj) : ""} · emitida em ${dataBR(nf.data)} · chave ${esc(nf.chave)}</div>
    <div class="msg info">Marque os itens que são tecido, confira a <b>composição</b> e a <b>cor</b> (a nota não tem esses campos: a sugestão vem da descrição) e informe <b>quantos rolos</b> vieram em cada item (a nota não diz): a quantidade é dividida igualmente entre eles${valores() ? ", assim como o valor" : ""}. Tecido comprado por quilo precisa depois do rendimento (metros por kg) para ir ao corte.</div>
    <div class="tw"><table><thead><tr><th></th><th>Item da nota</th><th>Tecido</th><th>Composição</th><th>Cor</th><th>Comprado por</th><th class="num">Quantidade</th><th class="num">Rolos</th>${valores() ? '<th class="num">Valor</th>' : ""}</tr></thead><tbody>
    ${nf.itens.map((it, k) => { const un = UN_NFE(it.uCom), feito = ja.has(it.item), sg = corDaDescricao(it.xProd), sa = !sg.cor && it.infAdProd ? corDaDescricao("- " + it.infAdProd).cor.split(" ").slice(0, 2).join(" ") : "";
      if (sa) sg.cor = sa, sg.tecido = it.xProd;
      return `<tr class="nfrow"><td><input type="checkbox" data-nfi="${k}" ${feito || !un ? "" : "checked"} ${feito ? "disabled" : ""} aria-label="Importar item ${it.item}"></td>
        <td>${it.item}. ${esc(it.xProd)}${it.infAdProd ? `<br><span class="mut">${esc(it.infAdProd.slice(0, 160))}</span>` : ""}<br><span class="mut">${esc(it.qCom.toLocaleString("pt-BR"))} ${esc(it.uCom)}${feito ? " · já importado" : !un ? " · unidade não reconhecida: confira" : ""}</span></td>
        <td><input data-nft="${k}" value="${esc(sg.cor ? sg.tecido : it.xProd)}"></td><td><input data-nfx="${k}" list="lcomp" value="${esc(composicaoDaDescricao(it.xProd + " " + it.infAdProd))}" placeholder="ex.: 100% Linho" style="width:150px"></td><td><input data-nfc="${k}" value="${esc(sg.cor)}" placeholder="ex.: Cru" style="width:110px"></td>
        <td><select data-nfu="${k}" style="width:auto"><option value="m" ${un !== "kg" ? "selected" : ""}>metro</option><option value="kg" ${un === "kg" ? "selected" : ""}>quilo</option></select></td>
        <td class="num"><input data-nfq="${k}" inputmode="decimal" value="${esc(decBR(it.qCom))}" style="width:80px"></td>
        <td class="num"><input data-nfr="${k}" type="number" min="1" max="50" value="1" style="width:60px"></td>
        ${valores() ? `<td class="num">${brl(it.valor)}</td>` : ""}</tr>`; }).join("")}</tbody></table></div>
    ${listaComp()}<div id="nfeerr"></div><div class="acoes"><button type="button" class="bt" id="nfex">Cancelar</button><button type="button" class="bt pri" id="nfeok">Importar rolos</button></div>`;
  $("nfex").onclick = () => $("dlg").close();
  $("nfeok").onclick = async () => {
    const itens = nf.itens.map((it, k) => ({ it, k })).filter(({ k }) => f.querySelector(`[data-nfi="${k}"]`).checked).map(({ it, k }) => ({
      item: it.item, tecido: f.querySelector(`[data-nft="${k}"]`).value, composicao: f.querySelector(`[data-nfx="${k}"]`).value, cor: f.querySelector(`[data-nfc="${k}"]`).value, unidade: f.querySelector(`[data-nfu="${k}"]`).value,
      total: numBR(f.querySelector(`[data-nfq="${k}"]`).value), rolos: f.querySelector(`[data-nfr="${k}"]`).value, valor: it.valor }));
    $("nfeok").disabled = true;
    try {
      const r = checar(await sb.rpc("lin_rolos_importar_nfe", { p: { chave: nf.chave, numero: nf.numero, fornecedor: nf.fornecedor, data: nf.data, itens } }));
      $("dlg").close(); msg("ok", `Nota ${nf.numero}: rolo(s) ${r.map(x => x.codigo).join(", ")} registrado(s).`); FPR.aba = "rolos"; await telaProducao();
    } catch (e) { $("nfeerr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; $("nfeok").disabled = false; }
  };
  $("dlg").showModal();
}
