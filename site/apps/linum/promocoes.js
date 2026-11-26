// Sistema Linum 2.58 — PROMOÇÕES (pedido do Marco em 23/11/2026: promoção de uma semana com peças a preço diferenciado).
// O Dono e o Estoque cadastram: nome, loja (ou as duas), início e fim, e as peças com o preço da promoção (a peça toda =
// todas as cores e tamanhos normais; ou uma cor/tamanho, inclusive peça especial). A equipe toda vê. Na venda, a peça
// entra sozinha com o preço da promoção válida na loja e na data da venda (com mais de uma, vale o MENOR preço); o banco
// marca a promoção na peça vendida (lin_venda_itens.promocao_nome) e o resultado aparece aqui.
// Regras no banco: lin_promocao_salvar / lin_promocao_cancelar / lin_promocoes_resumo (migração ..._linum_promocoes.sql).
// Usa as globais do index.html (sb, $, esc, checar, n, brl, LOJAS, loja, PRODUTOS, nomeVar, semAc, quando, dataBR, hoje,
// controla, msg, moeda, numV, numBR, r2, decBR...).

let PROMOS = [];          // [{id, nome, loja_id, inicio, fim, cancelada_em, ..., itens: [{produto_id, variante_id, preco}]}]
const FPROMO = { sit: "vigentes", zerados: false };

async function carregarPromos() {
  const [a, b] = await Promise.all([
    sb.from("lin_promocoes").select("*").order("inicio", { ascending: false }).order("id", { ascending: false }),
    sb.from("lin_promo_itens").select("*").order("id")]);
  if (a.error || b.error) throw new Error((a.error || b.error).message);
  const its = b.data || [];
  PROMOS = (a.data || []).map(p => Object.assign(p, { itens: its.filter(i => i.promocao_id === p.id) }));
  return PROMOS;
}

const prSituacao = p => p.cancelada_em ? "cancelada" : p.fim < hoje() ? "encerrada" : p.inicio > hoje() ? "futura" : "vigente";
const PR_SIT = { vigente: ["Valendo", "ok"], futura: ["Começa depois", ""], encerrada: ["Encerrada", "fora"], cancelada: ["Cancelada", "fora"] };
const prProduto = id => PRODUTOS.find(p => p.id === id);
const prVariante = id => { for (const p of PRODUTOS) { const v = (p.variantes || []).find(x => x.id === id); if (v) return [p, v]; } return [null, null]; };
const prTabela = (p, v) => Number(v && v.preco_venda != null ? v.preco_venda : p && p.preco_venda) || 0;

// preço da promoção de uma variação, na loja e na data (o MENOR entre as válidas; peça toda = só cores/tamanhos normais)
// devolve {id, nome, preco} ou null — mesma regra do banco (_lin_promo_da)
function promoDa(vid, lojaId, data) {
  const [p, v] = prVariante(vid); if (!p) return null;
  let melhor = null;
  for (const pr of PROMOS) {
    if (pr.cancelada_em || data < pr.inicio || data > pr.fim || (pr.loja_id && pr.loja_id !== lojaId)) continue;
    for (const i of pr.itens) {
      if (i.produto_id !== p.id) continue;
      if (i.variante_id ? i.variante_id !== vid : (v.edicao || "").trim() !== "") continue;
      const preco = Number(i.preco);
      if (!melhor || preco < melhor.preco || (preco === melhor.preco && pr.id < melhor.id)) melhor = { id: pr.id, nome: pr.nome, preco };
    }
  }
  return melhor;
}

async function telaPromocoes() {
  $("tela").innerHTML = '<div class="card">Carregando…</div>';
  let res = {};
  try { await carregarPromos(); if (controla()) res = checar(await sb.rpc("lin_promocoes_resumo")) || {}; }
  catch (e) { $("tela").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  const cont = s => PROMOS.filter(p => prSituacao(p) === s).length;
  const vis = PROMOS.filter(p => FPROMO.sit === "todas" ? true : FPROMO.sit === "vigentes" ? ["vigente", "futura"].includes(prSituacao(p)) : prSituacao(p) === FPROMO.sit);
  const pil = (v, t) => `<button type="button" class="pilula ${FPROMO.sit === v ? "on" : ""}" data-fpr="${v}">${esc(t)}</button>`;
  const linhaItem = i => {
    const p = prProduto(i.produto_id); if (!p) return `<li class="mut">peça excluída · ${brl(i.preco)}</li>`;
    const [, v] = i.variante_id ? prVariante(i.variante_id) : [p, null];
    const tab = prTabela(p, v);
    return `<li><b>${esc(p.referencia)}</b> ${esc(p.descricao)} — ${i.variante_id ? esc(v ? nomeVar(v) : "cor/tamanho excluído") : "todas as cores e tamanhos"}
      · <s class="mut">${brl(tab)}</s> <b>${brl(i.preco)}</b>${tab > 0 ? ` <span class="tag ok">−${decBR(r2((1 - i.preco / tab) * 100))}%</span>` : ""}</li>`;
  };
  $("tela").innerHTML = `<div class="cabtela"><h2>Promoções</h2>${controla() ? '<button type="button" class="bt pri" id="prnova">+ Nova promoção</button>' : ""}</div>
    <p class="mut" style="margin-top:0">Peças com preço de promoção por um período. Na venda, a peça entra sozinha com o preço da promoção da loja e da data da venda; se houver mais de uma promoção valendo, vale o <b>menor preço</b>. ${controla() ? "" : "Quem cadastra é a Dona ou o Estoque."}</p>
    <div class="filtros">${pil("vigentes", `Valendo e próximas (${cont("vigente") + cont("futura")})`)}${pil("encerrada", `Encerradas (${cont("encerrada")})`)}${pil("cancelada", `Canceladas (${cont("cancelada")})`)}${pil("todas", "Todas")}</div>
    ${vis.length ? vis.map(p => { const s = prSituacao(p), r = res[p.id];
      return `<div class="card" style="margin-bottom:10px">
        <div class="vlin" style="border:0"><span><b style="font-size:16px">${esc(p.nome)}</b> <span class="tag ${PR_SIT[s][1]}">${PR_SIT[s][0]}</span></span>
          <span class="mut">${p.loja_id ? "Loja " + esc(loja(p.loja_id).nome) : "Todas as lojas"} · ${dataBR(p.inicio)} a ${dataBR(p.fim)}</span></div>
        ${p.observacao ? `<div class="mut">${esc(p.observacao)}</div>` : ""}
        <details class="prpecas" open><summary>Peças da promoção (${n(prVarsDaPromo(p).size)})</summary><div class="prlista">${prCartoes(p)}</div></details>
        ${r ? `<div class="vlin"><span>Vendido na promoção</span><span><b>${n(r.pecas)}</b> peça(s) em ${n(r.vendas)} venda(s) · ${brl(r.vendido)} · desconto dado ${brl(r.desconto)}</span></div>` : controla() ? '<div class="vlin mut"><span>Nenhuma peça vendida nesta promoção ainda.</span></div>' : ""}
        ${p.cancelada_em ? `<div class="msg err">Cancelada por ${esc(p.cancelada_nome || "")} em ${quando(p.cancelada_em)}: ${esc(p.motivo_cancelamento || "")}</div>` : ""}
        ${controla() && !p.cancelada_em ? `<div class="acoes" style="justify-content:flex-start"><button type="button" class="bt" data-prrel="${p.id}" title="Lista das peças em ordem alfabética, por tamanho e cor, para imprimir ou salvar em PDF">Relatório (PDF)</button><button type="button" class="bt" data-prvend="${p.id}" title="Peças vendidas nesta promoção: consulta, PDF e CSV">Vendas da promoção</button><button type="button" class="bt" data-pred="${p.id}">Editar</button>${s !== "encerrada" ? `<button type="button" class="bt" data-prenc="${p.id}">Encerrar hoje</button>` : ""}<button type="button" class="bt" data-prcanc="${p.id}" style="color:var(--crit);border-color:var(--crit)">Cancelar</button></div>` : ""}
        ${controla() && p.cancelada_em && r ? `<div class="acoes" style="justify-content:flex-start"><button type="button" class="bt" data-prvend="${p.id}">Vendas da promoção</button></div>` : ""}
        ${!controla() && !p.cancelada_em ? `<div class="acoes" style="justify-content:flex-start"><button type="button" class="bt" data-prrel="${p.id}" title="Lista das peças em ordem alfabética, por tamanho e cor, para imprimir ou salvar em PDF">Relatório (PDF)</button></div>` : ""}
        <div class="mut" style="font-size:12px">Criada por ${esc(p.criado_nome || "")} em ${quando(p.criado_em)}${p.alterado_em ? ` · alterada por ${esc(p.alterado_nome || "")} em ${quando(p.alterado_em)}` : ""}</div>
      </div>`; }).join("") : '<div class="card mut">Nenhuma promoção aqui.</div>'}`;
  document.querySelectorAll("[data-fpr]").forEach(b => b.onclick = () => { FPROMO.sit = b.dataset.fpr; telaPromocoes(); });
  if ($("prnova")) $("prnova").onclick = () => editarPromocao(null);
  document.querySelectorAll("[data-prrel]").forEach(b => b.onclick = () => relatorioPromocao(PROMOS.find(p => p.id === +b.dataset.prrel)));
  document.querySelectorAll("[data-prvend]").forEach(b => b.onclick = () => vendasPromocao(PROMOS.find(p => p.id === +b.dataset.prvend)));
  document.querySelectorAll("[data-pred]").forEach(b => b.onclick = () => editarPromocao(PROMOS.find(p => p.id === +b.dataset.pred)));
  document.querySelectorAll("[data-prenc]").forEach(b => b.onclick = async () => {
    const p = PROMOS.find(x => x.id === +b.dataset.prenc);
    const fim = p.inicio > hoje() ? null : hoje();
    if (!fim) return msg("err", "Esta promoção ainda não começou: use Editar ou Cancelar.");
    if (!confirm(`Encerrar a promoção "${p.nome}" hoje (${dataBR(fim)})? Amanhã as peças voltam ao preço normal.`)) return;
    try { checar(await sb.rpc("lin_promocao_salvar", { p: { id: p.id, nome: p.nome, loja_id: p.loja_id, inicio: p.inicio, fim, observacao: p.observacao,
      itens: p.itens.map(i => ({ produto_id: i.produto_id, variante_id: i.variante_id, preco: i.preco })) } })); msg("ok", "Promoção encerrada hoje."); telaPromocoes(); }
    catch (e) { msg("err", e.message); }
  });
  document.querySelectorAll("[data-prcanc]").forEach(b => b.onclick = async () => {
    const p = PROMOS.find(x => x.id === +b.dataset.prcanc);
    const motivo = prompt(`Cancelar a promoção "${p.nome}"? Ela deixa de valer na hora (as vendas já feitas ficam como estão).\n\nMotivo:`);
    if (motivo == null) return;
    try { checar(await sb.rpc("lin_promocao_cancelar", { p_id: p.id, p_motivo: motivo })); msg("ok", "Promoção cancelada."); telaPromocoes(); }
    catch (e) { msg("err", e.message); }
  });
}

// 2.60 (pedido do Marco: "relatório das peças em ordem alfabética do nome da peça, tamanho e cor, para deixar com as
// vendedoras"): uma folha A4 para imprimir ou salvar em PDF. Peças pelo nome (sem acento/maiúscula), cada uma num quadro com
// "de → por" e o desconto, e embaixo uma linha por tamanho com as cores. "Todas as cores e tamanhos" é aberto nas
// variações normais ativas de hoje; peça especial sai à parte, com a edição. Preços diferentes na mesma peça = quadros separados.
function relatorioPromocao(pr) {
  if (!pr) return;
  const blocos = new Map();   // chave produto|preço → {p, preco, tab:Set, normais:[v], especiais:[v]}
  const por = (p, preco) => { const k = p.id + "|" + Number(preco); if (!blocos.has(k)) blocos.set(k, { p, preco: Number(preco), tab: new Set(), normais: [], especiais: [] }); return blocos.get(k); };
  const visto = new Set();
  for (const i of pr.itens) {
    const p = prProduto(i.produto_id); if (!p) continue;
    const vs = i.variante_id ? [prVariante(i.variante_id)[1]].filter(Boolean) : prNormais(p);
    for (const v of vs) {
      if (visto.has(v.id)) continue; visto.add(v.id);
      const b = por(p, i.preco); b.tab.add(prTabela(p, v));
      ((v.edicao || "").trim() ? b.especiais : b.normais).push(v);
    }
  }
  const lista = [...blocos.values()].sort((a, b) => semAc(a.p.descricao || "").localeCompare(semAc(b.p.descricao || ""), "pt-BR")
    || (a.p.referencia || "").localeCompare(b.p.referencia || "", "pt-BR")
    || (a.normais.length ? 0 : 1) - (b.normais.length ? 0 : 1) || a.preco - b.preco);
  if (!lista.length) return msg("err", "Esta promoção não tem peças para listar.");
  const w = window.open("", "_blank"); if (!w) return msg("err", "O navegador bloqueou a janela de impressão.");
  const pct = (tab, preco) => tab > 0 ? "−" + Math.round((1 - preco / tab) * 100) + "%" : "";
  const linhas = vs => {
    const tams = [...new Set(vs.map(v => v.tamanho || ""))].sort(ordemTam);
    return tams.map(t => `<tr><td class="tam">${esc(t || "—")}</td><td>${[...new Set(vs.filter(v => (v.tamanho || "") === t).map(v => v.cor || "—"))]
      .sort((a, b) => a.localeCompare(b, "pt-BR")).map(esc).join(" · ")}</td></tr>`).join("");
  };
  const quadro = b => {
    const tabs = [...b.tab], tab = Math.max(...tabs);
    const de = tabs.length > 1 ? `de ${brl(Math.min(...tabs))} a ${brl(tab)}` : `de ${brl(tab)}`;
    const esp = [...b.especiais].sort(ordemVar);
    return `<div class="pc"><div class="cab"><div><b>${esc(b.p.descricao || "")}</b><span class="ref">${esc(b.p.referencia || "")}</span></div>
      <div class="pr"><s>${de}</s> <b>${brl(b.preco)}</b>${tabs.length === 1 && pct(tab, b.preco) ? ` <span class="pct">${pct(tab, b.preco)}</span>` : ""}</div></div>
      <table>${b.normais.length ? linhas(b.normais) : ""}
      ${esp.map(v => `<tr><td class="tam">${esc(v.tamanho || "—")}</td><td>★ ${esc(v.cor || "—")} · peça especial ${esc(v.edicao)}</td></tr>`).join("")}</table></div>`;
  };
  const nvar = lista.reduce((s, b) => s + b.normais.length + b.especiais.length, 0);
  const sit = PR_SIT[prSituacao(pr)][0];
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Promoção ${esc(pr.nome)} — Linum</title>
    <style>@page{size:A4;margin:10mm}*{box-sizing:border-box}body{font:13px system-ui,sans-serif;margin:0;color:#111}
    .topo{border-bottom:3px solid #9b1d3a;padding-bottom:6px;margin-bottom:10px;display:flex;justify-content:space-between;gap:12px;align-items:flex-end}
    h1{font-size:22px;margin:0}h1 small{font-size:13px;font-weight:400;color:#555;letter-spacing:2px;display:block}
    .info{text-align:right;font-size:13px}.info b{font-size:15px}.dica{font-size:11px;color:#555;margin:0 0 10px}
    .grade{columns:2;column-gap:12px}.pc{break-inside:avoid;border:1px solid #999;border-radius:6px;margin:0 0 10px;padding:6px 8px}
    .cab{display:flex;justify-content:space-between;gap:8px;align-items:baseline;border-bottom:1px solid #ddd;padding-bottom:4px;margin-bottom:3px}
    .cab b{font-size:14px}.ref{color:#555;font-size:11px;margin-left:6px}.pr{white-space:nowrap;text-align:right}.pr s{color:#777;font-size:11px}.pr b{font-size:16px;color:#9b1d3a}
    .pct{background:#9b1d3a;color:#fff;border-radius:4px;padding:0 4px;font-size:11px;font-weight:700}
    table{width:100%;border-collapse:collapse}td{padding:2px 4px;border-bottom:1px dotted #ddd;vertical-align:top}tr:last-child td{border-bottom:0}
    td.tam{width:42px;font-weight:700;white-space:nowrap}
    @media print{.pct{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>
    <div class="topo"><h1><small>LINUM · PROMOÇÃO</small>${esc(pr.nome)}</h1>
      <div class="info"><b>${dataBR(pr.inicio)} a ${dataBR(pr.fim)}</b><br>${pr.loja_id ? "Só na loja " + esc(loja(pr.loja_id).nome) : "Todas as lojas"} · ${esc(sit)}</div></div>
    <p class="dica">${lista.length} peça(s), ${nvar} cor(es)/tamanho(s) · em ordem alfabética, por tamanho e cor · na venda o preço da promoção entra sozinho · emitido em ${quando(new Date().toISOString())}${pr.observacao ? " · " + esc(pr.observacao) : ""}</p>
    <div class="grade">${lista.map(quadro).join("")}</div>
    </body></html>`);
  w.document.close(); w.focus(); w.print();
}

// formulário: nome, loja, datas, observação e as peças com o preço da promoção.
// 2.59 (pedido do Marco: "por lista suspensa fica muito difícil"): cada peça mostra a GRADE de cores × tamanhos como no
// Estoque; um clique marca/desmarca a variação, clicar na cor marca a linha, no tamanho a coluna; Todas / Nenhuma / Só as
// com estoque; peças especiais à parte. Um preço vale para as marcadas da peça; outro preço = adicionar a peça de novo.
// Gravação igual à 2.58: todas as cores/tamanhos normais marcadas (e nenhuma especial) = uma linha sem variante; senão uma
// linha por variação marcada.
const prNormais = p => (p.variantes || []).filter(v => v.ativo !== false && !(v.edicao || "").trim()).sort(ordemVar);
const prEspeciais = p => (p.variantes || []).filter(v => v.ativo !== false && (v.edicao || "").trim()).sort(ordemVar);
function editarPromocao(pr) {
  $("dlg").classList.add("largo");
  const f = $("dlgf");
  // itens: {produto_id, sel: Set(variante_id), preco}
  const itensDe = pr => {
    const grupos = new Map();
    for (const i of pr.itens) {
      const k = i.produto_id + "|" + Number(i.preco).toFixed(2);
      if (!grupos.has(k)) grupos.set(k, { produto_id: i.produto_id, sel: new Set(), preco: moeda(i.preco) });
      const g = grupos.get(k), p = prProduto(i.produto_id);
      if (i.variante_id) g.sel.add(i.variante_id); else if (p) prNormais(p).forEach(v => g.sel.add(v.id));
    }
    return [...grupos.values()];
  };
  const P = pr ? { id: pr.id, nome: pr.nome, loja: pr.loja_id || "", inicio: pr.inicio, fim: pr.fim, obs: pr.observacao || "", itens: itensDe(pr) }
    : { id: null, nome: "", loja: "", inicio: hoje(), fim: somaDias(hoje(), 6), obs: "", itens: [] };
  const estoque = vid => P.loja ? qtd(vid, P.loja) : LOJAS.reduce((s, l) => s + qtd(vid, l.id), 0);
  const desenhar = erro => {
    f.innerHTML = `<h3>${P.id ? "Editar promoção" : "Nova promoção"}</h3>
      <div class="campo grade3">
        <div><label for="prnome">Nome da promoção</label><input id="prnome" maxlength="80" value="${esc(P.nome)}" placeholder="Ex.: Semana do Linho"></div>
        <div><label for="prini">Começa em</label><input id="prini" type="date" value="${esc(P.inicio)}"></div>
        <div><label for="prfim">Termina em (inclusive)</label><input id="prfim" type="date" value="${esc(P.fim)}"></div>
      </div>
      <div class="campo grade3">
        <div><label for="prloja">Loja</label><select id="prloja"><option value="">Todas as lojas</option>${LOJAS.map(l => `<option value="${l.id}" ${P.loja === l.id ? "selected" : ""}>${esc(l.nome)}</option>`).join("")}</select></div>
        <div style="grid-column:span 2"><label for="probs">Observação (opcional)</label><input id="probs" maxlength="300" value="${esc(P.obs)}" placeholder="Ex.: só peças da coleção de verão"></div>
      </div>
      <div class="caixa"><h4>Peças da promoção</h4>
        <input id="prq" type="search" placeholder="Procure a peça pela referência ou pelo nome" autocomplete="off"><div id="prres"></div>
        <div id="pritens" class="campo"></div>
        <div class="mut" style="font-size:12px">Clique nos quadradinhos para marcar as cores e tamanhos que entram na promoção (o número é o estoque${P.loja ? " da loja" : " das lojas"}). Clique na cor para marcar a linha e no tamanho para marcar a coluna. Para outro preço na mesma peça, adicione a peça de novo.</div>
      </div>
      ${erro ? `<div class="msg err">${esc(erro)}</div>` : ""}
      <div class="acoes"><button type="button" class="bt" id="prx">Cancelar</button><button type="button" class="bt pri" id="prok">${P.id ? "Salvar alterações" : "Criar promoção"}</button></div>`;
    const guardar = () => { P.nome = $("prnome").value; P.inicio = $("prini").value; P.fim = $("prfim").value; P.loja = $("prloja").value; P.obs = $("probs").value; };
    ["prnome", "prini", "prfim", "probs"].forEach(id => $(id).onchange = guardar);
    $("prloja").onchange = () => { guardar(); itens(); };   // o estoque mostrado muda com a loja
    const desconto = (tab, pr) => tab > 0 && pr > 0 && pr < tab ? "−" + decBR(r2((1 - pr / tab) * 100)) + "%" : "";
    const grade = (it, k, p) => {
      const vs = prNormais(p), esp = prEspeciais(p);
      const cores = [...new Set(vs.map(v => v.cor || "—"))], tams = [...new Set(vs.map(v => v.tamanho || ""))].sort(ordemTam);
      const cel = v => { if (!v) return '<td></td>'; const on = it.sel.has(v.id), q = estoque(v.id);
        return `<td><button type="button" class="prch${on ? " on" : ""}${q ? "" : " zero"}" data-prv="${k}|${v.id}" aria-pressed="${on}" title="${esc(nomeVar(v))} · ${q} em estoque">${on ? "✓ " : ""}${q}</button></td>`; };
      return `<div class="prgrade">${vs.length ? `<table><thead><tr><th></th>${tams.map(t => `<th><button type="button" class="lnk" data-prcol="${k}|${esc(t)}" title="Marcar/desmarcar o tamanho ${esc(t)} em todas as cores">${esc(t || "—")}</button></th>`).join("")}</tr></thead><tbody>
        ${cores.map(c => `<tr><th><button type="button" class="lnk" data-prrow="${k}|${esc(c)}" title="Marcar/desmarcar todos os tamanhos de ${esc(c)}">${esc(c)}</button></th>${tams.map(t => cel(vs.find(v => (v.cor || "—") === c && (v.tamanho || "") === t))).join("")}</tr>`).join("")}
        </tbody></table>` : '<div class="mut">Esta peça ainda não tem cores e tamanhos cadastrados.</div>'}
        ${esp.length ? `<div class="mut" style="margin-top:6px">★ Peças especiais (preço próprio):</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">${esp.map(v => { const on = it.sel.has(v.id);
          return `<button type="button" class="prch esp${on ? " on" : ""}" data-prv="${k}|${v.id}" aria-pressed="${on}">${on ? "✓ " : ""}${esc(nomeVar(v))} · ${brl(prTabela(p, v))} · ${estoque(v.id)}</button>`; }).join("")}</div>` : ""}</div>`;
    };
    const itens = () => {
      $("pritens").innerHTML = P.itens.length ? P.itens.map((it, k) => {
        const p = prProduto(it.produto_id) || { referencia: "?", descricao: "peça excluída", variantes: [] }, tab = Number(p.preco_venda) || 0, pr = numV(it.preco);
        const total = prNormais(p).length + prEspeciais(p).length;
        return `<div class="card prpeca" style="margin:8px 0">
          <div class="vlin" style="border:0;flex-wrap:wrap"><span><b>${esc(p.referencia)}</b> ${esc(p.descricao)} · tabela ${brl(tab)}</span>
            <span style="display:flex;gap:8px;align-items:center"><label for="prp${k}" style="margin:0">Preço na promoção</label><input id="prp${k}" data-prp="${k}" inputmode="decimal" value="${esc(it.preco)}" placeholder="0,00" style="width:110px">
              <b class="tag ok" data-prd="${k}">${desconto(tab, pr)}</b><button type="button" class="lnk perigo" data-prrm="${k}" title="Tirar a peça da promoção">Tirar</button></span></div>
          ${grade(it, k, p)}
          <div class="acoes" style="justify-content:flex-start;margin-top:4px"><button type="button" class="pilula" data-prtodas="${k}">Todas</button><button type="button" class="pilula" data-prnenh="${k}">Nenhuma</button><button type="button" class="pilula" data-prest="${k}">Só as com estoque</button>
            <span class="mut" data-prcont="${k}">${it.sel.size} de ${total} marcada(s)</span></div></div>`; }).join("")
        : '<div class="mut">Nenhuma peça ainda: procure acima.</div>';
      const peca = k => prProduto(P.itens[k].produto_id) || { variantes: [] };
      const alternar = (k, ids) => { const s = P.itens[k].sel, todos = ids.every(id => s.has(id)); ids.forEach(id => todos ? s.delete(id) : s.add(id)); itens(); };
      $("pritens").querySelectorAll("[data-prv]").forEach(b => b.onclick = () => { const [k, id] = b.dataset.prv.split("|"); alternar(+k, [id]); });
      $("pritens").querySelectorAll("[data-prrow]").forEach(b => b.onclick = () => { const [k, c] = b.dataset.prrow.split("|"); alternar(+k, prNormais(peca(+k)).filter(v => (v.cor || "—") === c).map(v => v.id)); });
      $("pritens").querySelectorAll("[data-prcol]").forEach(b => b.onclick = () => { const [k, t] = b.dataset.prcol.split("|"); alternar(+k, prNormais(peca(+k)).filter(v => (v.tamanho || "") === t).map(v => v.id)); });
      $("pritens").querySelectorAll("[data-prtodas]").forEach(b => b.onclick = () => { const k = +b.dataset.prtodas; prNormais(peca(k)).forEach(v => P.itens[k].sel.add(v.id)); itens(); });
      $("pritens").querySelectorAll("[data-prnenh]").forEach(b => b.onclick = () => { P.itens[+b.dataset.prnenh].sel.clear(); itens(); });
      $("pritens").querySelectorAll("[data-prest]").forEach(b => b.onclick = () => { const k = +b.dataset.prest; P.itens[k].sel = new Set(prNormais(peca(k)).filter(v => estoque(v.id) > 0).map(v => v.id)); itens(); });
      $("pritens").querySelectorAll("[data-prp]").forEach(i => i.oninput = () => { const k = +i.dataset.prp, it = P.itens[k]; it.preco = i.value;
        $("pritens").querySelector(`[data-prd="${k}"]`).textContent = desconto(Number(peca(k).preco_venda) || 0, numV(it.preco)); });
      $("pritens").querySelectorAll("[data-prrm]").forEach(b => b.onclick = () => { P.itens.splice(+b.dataset.prrm, 1); itens(); });
    };
    $("prq").oninput = () => {
      const t = semAc($("prq").value.trim());
      if (t.length < 2) { $("prres").innerHTML = ""; return; }
      const l = PRODUTOS.filter(p => semAc(p.referencia).includes(t) || semAc(p.descricao).includes(t)).slice(0, 12);
      $("prres").innerHTML = l.length ? l.map(p => `<div class="vlin"><span><b>${esc(p.referencia)}</b> ${esc(p.descricao)} · ${brl(p.preco_venda)}</span><button type="button" class="lnk" data-pradd="${p.id}">Adicionar</button></div>`).join("")
        : '<div class="mut">Nenhuma peça encontrada.</div>';
      $("prres").querySelectorAll("[data-pradd]").forEach(b => b.onclick = () => {
        guardar(); P.itens.push({ produto_id: b.dataset.pradd, sel: new Set(), preco: "" });
        $("prq").value = ""; $("prres").innerHTML = ""; itens();
        const ult = $("pritens").querySelector(`[data-prp="${P.itens.length - 1}"]`); if (ult) ult.focus();
      });
    };
    itens();
    $("prx").onclick = () => $("dlg").close();
    $("prok").onclick = async () => {
      guardar();
      if (P.nome.trim().length < 2) return desenhar("Dê um nome à promoção.");
      if (!P.inicio || !P.fim) return desenhar("Informe o início e o fim.");
      if (P.fim < P.inicio) return desenhar("O fim não pode ser antes do início.");
      if (!P.itens.length) return desenhar("Escolha pelo menos uma peça.");
      const linhas = [], vistas = new Map();
      for (const it of P.itens) {
        const p = prProduto(it.produto_id), nome = `${p.referencia} ${p.descricao}`, pr = numV(it.preco);
        if (!it.sel.size) return desenhar(`${nome}: marque pelo menos uma cor/tamanho.`);
        if (!(pr > 0) && String(it.preco).trim() !== "0") return desenhar(`Informe o preço da promoção de ${nome}.`);
        for (const vid of it.sel) {
          const v = (p.variantes || []).find(x => x.id === vid), tab = prTabela(p, v);
          if (tab > 0 && pr >= tab) return desenhar(`${nome} ${v ? nomeVar(v) : ""}: o preço da promoção (${brl(pr)}) tem de ser menor que o de tabela (${brl(tab)}).`);
          if (vistas.has(vid)) return desenhar(`${nome} ${v ? nomeVar(v) : ""} está marcada duas vezes na promoção (com preços diferentes). Desmarque numa delas.`);
          vistas.set(vid, true);
        }
        const normais = prNormais(p), todasNormais = normais.length && normais.every(v => it.sel.has(v.id));
        if (todasNormais) linhas.push({ produto_id: it.produto_id, variante_id: null, preco: numBR(it.preco) });
        for (const vid of it.sel) if (!(todasNormais && normais.some(v => v.id === vid))) linhas.push({ produto_id: it.produto_id, variante_id: vid, preco: numBR(it.preco) });
      }
      $("prok").disabled = true;
      try {
        const id = checar(await sb.rpc("lin_promocao_salvar", { p: { id: P.id, nome: P.nome.trim(), loja_id: P.loja || null, inicio: P.inicio, fim: P.fim, observacao: P.obs.trim(), itens: linhas } }));
        $("dlg").close(); msg("ok", `Promoção "${P.nome.trim()}" ${P.id ? "alterada" : "criada"} (nº ${id}).`);
        telaPromocoes();
      } catch (e) { desenhar(e.message); }
    };
  };
  desenhar();
  if (!$("dlg").open) $("dlg").showModal();
}

// 2.58: indicação no Estoque e em Produtos — promoções valendo ou que ainda vão começar em que a peça entra
function promosDoProduto(pid) {
  const h = hoje(), r = [];
  for (const pr of PROMOS) {
    if (pr.cancelada_em || pr.fim < h) continue;
    for (const i of pr.itens) if (i.produto_id === pid) r.push({ pr, i });
  }
  return r;
}
function promoSelo(pid) {
  const l = promosDoProduto(pid); if (!l.length) return "";
  const h = hoje();
  return `<div class="promos">${l.map(({ pr, i }) => {
    const [, v] = i.variante_id ? prVariante(i.variante_id) : [null, null];
    const quando = pr.inicio > h ? `de ${dataBR(pr.inicio)} a ${dataBR(pr.fim)}` : `até ${dataBR(pr.fim)}`;
    const onde = pr.loja_id ? " · só " + loja(pr.loja_id).nome : "";
    return `<span class="tagpromo${pr.inicio > h ? " futura" : ""}" title="Promoção “${esc(pr.nome)}”${pr.inicio > h ? " (ainda não começou)" : ""}: ${esc(i.variante_id ? (v ? nomeVar(v) : "uma cor/tamanho") : "todas as cores e tamanhos")} por ${esc(brl(i.preco))}, ${esc(quando)}${esc(onde)}">`
      + `🏷 ${esc(pr.nome)}: ${i.variante_id && v ? esc(nomeVar(v)) + " " : ""}<b>${brl(i.preco)}</b> · ${quando}${onde}</span>`;
  }).join("")}</div>`;
}


// 2.65 (pedido do Marco: "a lista de produtos em promoção igual à lista do estoque, em quadros e separada por loja"):
// variações da promoção (a peça toda = cores/tamanhos normais ativos) → Map produto → Map variação → preço da promoção
function prVarsDaPromo(pr) {
  const porProd = new Map();
  for (const i of pr.itens) {
    const p = prProduto(i.produto_id); if (!p) continue;
    if (!porProd.has(p.id)) porProd.set(p.id, new Map());
    const m = porProd.get(p.id);
    for (const v of i.variante_id ? [prVariante(i.variante_id)[1]].filter(Boolean) : prNormais(p)) {
      const atual = m.get(v.id); if (atual == null || Number(i.preco) < atual) m.set(v.id, Number(i.preco));
    }
  }
  return porProd;
}
const prFaixa = (a, b) => a === b ? brl(a) : `${brl(a)} a ${brl(b)}`;
// 2.66 (pedido do Marco: "ficou muito grande e tem clique de movimentação; só uma amostra, em blocos menores, sem clicar
// em nada"): só leitura. Um cartão pequeno por peça; em cada loja, um bloco por TAMANHO com as cores e a quantidade dentro.
const PR_CSS = `<style>.prlista{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px;margin-top:6px}
  .prc{border:1px solid var(--borda,#e3dcd6);border-radius:8px;padding:6px 8px;background:#fff;font-size:12px;line-height:1.3}
  .prc .t{display:flex;justify-content:space-between;gap:6px;align-items:baseline}.prc .t b{font-size:13px}.prc .ref{color:#888;font-size:11px}
  .prc .pp{white-space:nowrap}.prc .pp s{color:#999}.prc .pct{color:#1a7f37;font-weight:600}
  .prc .lj{margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;align-items:flex-start}.prc .lj>i{font-style:normal;font-size:10px;color:#777;width:100%;text-transform:uppercase;letter-spacing:.04em}
  .prc .tb{border:1px solid #e5dfd9;border-radius:6px;padding:2px 5px;background:#faf7f4}.prc .tb>b{display:block;font-size:11px;color:#9b1d3a}
  .prc .tb span{display:block;white-space:nowrap}.prc .tb.esp{border-color:#c9a227}</style>`;
function prCartoes(pr) {
  const porProd = prVarsDaPromo(pr);
  const lojas = pr.loja_id ? LOJAS.filter(l => l.id === pr.loja_id) : LOJAS;
  const ps = [...porProd.keys()].map(prProduto).sort((a, b) => semAc(a.descricao || "").localeCompare(semAc(b.descricao || ""), "pt-BR") || (a.referencia || "").localeCompare(b.referencia || "", "pt-BR"));
  const html = ps.map(p => {
    const m = porProd.get(p.id), vars = (p.variantes || []).filter(v => m.has(v.id)).sort(ordemVar);
    const precos = vars.map(v => m.get(v.id)), tabs = vars.map(v => prTabela(p, v));
    const pMin = Math.min(...precos), pMax = Math.max(...precos), tMin = Math.min(...tabs), tMax = Math.max(...tabs);
    const pct = tMin === tMax && pMin === pMax && tMax > 0 ? ` <span class="pct">−${Math.round((1 - pMin / tMax) * 100)}%</span>` : "";
    const faixas = lojas.map(l => {
      const vis = vars.filter(v => qtd(v.id, l.id) > 0);   // 2.67: só o que tem peça na loja (pedido do Marco)
      if (!vis.length) return "";
      const [comuns, esp] = separarEsp(vis);
      const tams = [...new Set(comuns.map(v => v.tamanho || "—"))].sort(ordemTam);
      const bloco = (rot, vs, cls = "") => `<div class="tb${cls}"><b>${esc(rot)}</b>${vs.map(v => { const q = qtd(v.id, l.id);
        return `<span class="${q > 0 ? "" : "z"}">${esc(v.cor || "—")} ${n(q)}</span>`; }).join("")}</div>`;
      return `<div class="lj" data-loja="${l.id}"><i>${esc(l.nome)}</i>${tams.map(t => bloco(t, comuns.filter(v => (v.tamanho || "—") === t))).join("")}
        ${esp.map(v => bloco(`★ ${v.tamanho || "—"}`, [Object.assign({}, v, { cor: `${v.cor || "—"} (${v.edicao})` })], " esp")).join("")}</div>`;
    }).join("");
    if (!faixas) return "";
    return `<div class="prc" title="${esc(p.descricao)}"><div class="t"><span><b>${esc(p.descricao)}</b> <span class="ref">${esc(p.referencia || "")}</span></span>
      <span class="pp"><s>${prFaixa(tMin, tMax)}</s> <b>${prFaixa(pMin, pMax)}</b>${pct}</span></div>${faixas}</div>`;
  }).join("");
  return PR_CSS + (html || '<div class="mut">Nenhuma peça desta promoção tem estoque agora.</div>');
}

// 2.65 (pedido do Marco: "consulta gerencial das vendas nas promoções, com relatório em PDF"): Dono e Estoque.
// Dados da lin_promocao_vendas (peças vendidas com a promoção, vendas não canceladas); valor = líquido (desconto geral repartido).
function pvResumo(pr, rows) {
  const ag = (chave, rot) => {
    const m = new Map();
    for (const r of rows) {
      const k = chave(r); if (k == null) continue;
      const g = m.get(k) || { rot: rot(r), q: 0, tab: 0, vend: 0, vendas: new Set() };
      g.q += r.quantidade; g.tab += r.preco_tabela * r.quantidade; g.vend += r.liquido * r.quantidade; g.vendas.add(r.venda); m.set(k, g);
    }
    return [...m.values()];
  };
  const porProd = prVarsDaPromo(pr), lojas = pr.loja_id ? LOJAS.filter(l => l.id === pr.loja_id) : LOJAS;
  const estoque = pid => { const m = porProd.get(pid); if (!m) return null; return lojas.reduce((s, l) => s + [...m.keys()].reduce((t, v) => t + qtd(v, l.id), 0), 0); };
  const pecas = ag(r => (r.produto_id || r.referencia) + "", r => ({ t: `${r.descricao} (${r.referencia})`, est: estoque(r.produto_id) }))
    .sort((a, b) => b.q - a.q || a.rot.t.localeCompare(b.rot.t, "pt-BR"));
  return {
    q: rows.reduce((s, r) => s + r.quantidade, 0), vendas: new Set(rows.map(r => r.venda)).size,
    tab: rows.reduce((s, r) => s + r.preco_tabela * r.quantidade, 0), vend: rows.reduce((s, r) => s + r.liquido * r.quantidade, 0),
    geral: rows.filter(r => r.desconto_geral).length,
    pecas,
    cortam: ag(r => [r.descricao, r.cor, r.tamanho, r.edicao].join("|"), r => `${r.descricao} — ${[r.cor, r.tamanho, r.edicao].filter(Boolean).join(" · ")}`).sort((a, b) => b.q - a.q || a.rot.localeCompare(b.rot, "pt-BR")),
    cores: ag(r => r.cor || "—", r => r.cor || "—").sort((a, b) => b.q - a.q),
    tams: ag(r => r.tamanho || "—", r => r.tamanho || "—").sort((a, b) => ordemTam(a.rot, b.rot)),
    lojas: ag(r => r.loja, r => r.loja).sort((a, b) => b.vend - a.vend),
    vendedoras: rows.some(r => r.vendedora) ? ag(r => r.vendedora || "—", r => r.vendedora || "—").sort((a, b) => b.vend - a.vend) : null,
    dias: ag(r => r.data, r => r.data).sort((a, b) => a.rot.localeCompare(b.rot))
  };
}
function pvHtml(pr, rows, R) {
  const pct = g => g.tab > 0 ? Math.round((1 - g.vend / g.tab) * 100) + "%" : "—";
  const tab = (tit, l, rot = g => esc(g.rot), extra = null) => l.length ? `<h4>${tit}</h4><table class="pvt"><thead><tr><th>${tit.split(" ").pop() === "dia" ? "Dia" : ""}</th><th class="num">Peças</th><th class="num">Vendas</th><th class="num">Tabela</th><th class="num">Vendido</th><th class="num">Desconto</th>${extra ? `<th class="num">${extra[0]}</th>` : ""}</tr></thead><tbody>
    ${l.map(g => `<tr><td>${rot(g)}</td><td class="num">${n(g.q)}</td><td class="num">${n(g.vendas.size)}</td><td class="num">${brl(g.tab)}</td><td class="num"><b>${brl(g.vend)}</b></td><td class="num">${brl(g.tab - g.vend)} (${pct(g)})</td>${extra ? `<td class="num">${extra[1](g)}</td>` : ""}</tr>`).join("")}</tbody></table>` : "";
  const k = (rot, val, sub = "") => `<div class="pvk"><small>${rot}</small><b>${val}</b>${sub ? `<span>${sub}</span>` : ""}</div>`;
  return `<div class="pvks">${k("Peças vendidas", n(R.q))}${k("Vendas", n(R.vendas), R.vendas ? "≈ " + (R.q / R.vendas).toFixed(1).replace(".", ",") + " peça(s) por venda" : "")}
      ${k("Preço de tabela", brl(R.tab))}${k("Vendido (líquido)", brl(R.vend), R.vendas ? "ticket médio " + brl(R.vend / R.vendas) : "")}${k("Desconto dado", brl(R.tab - R.vend), pct(R) + " sobre a tabela")}</div>
    ${R.geral ? `<p class="mut">${n(R.geral)} peça(s) com o desconto dado no total da venda (o valor é o líquido, com o desconto geral repartido pelas peças).</p>` : ""}
    ${tab("Por peça", R.pecas, g => esc(g.rot.t), ["Em estoque hoje", g => g.rot.est == null ? "—" : n(g.rot.est)])}
    ${tab("Por cor e tamanho", R.cortam)}
    <div class="pvduas">${tab("Por cor", R.cores)}${tab("Por tamanho", R.tams)}</div>
    ${tab("Por loja", R.lojas)}
    ${R.vendedoras ? tab("Por vendedora", R.vendedoras) : ""}
    ${tab("Por dia", R.dias, g => dataBR(g.rot))}
    <h4>Peças vendidas</h4><table class="pvt"><thead><tr><th>Data</th><th>Venda</th><th>Loja</th>${R.vendedoras ? "<th>Vendedora</th>" : ""}<th>Peça</th><th>Cor / tamanho</th><th class="num">Qtd</th><th class="num">Tabela</th><th class="num">Vendido</th><th class="num">Desc.</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${dataBR(r.data)}</td><td>nº ${r.venda}</td><td>${esc(r.loja)}</td>${R.vendedoras ? `<td>${esc(r.vendedora || "")}</td>` : ""}<td>${esc(r.descricao)} <span class="mut">${esc(r.referencia)}</span></td>
      <td>${esc([r.cor, r.tamanho, r.edicao].filter(Boolean).join(" · "))}</td><td class="num">${n(r.quantidade)}</td><td class="num">${brl(r.preco_tabela)}</td><td class="num">${brl(r.liquido)}${r.desconto_geral ? " *" : ""}</td>
      <td class="num">${r.preco_tabela > 0 ? Math.round((1 - r.liquido / r.preco_tabela) * 100) + "%" : "—"}</td></tr>`).join("")}</tbody></table>
    ${R.geral ? '<p class="mut">* desconto dado no total da venda.</p>' : ""}`;
}
const PV_CSS = `.pvks{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.pvk{border:1px solid #ddd;border-radius:8px;padding:6px 10px;min-width:130px}.pvk small{display:block;color:#666}.pvk b{font-size:17px;display:block}.pvk span{font-size:11px;color:#666}
  .pvt{border-collapse:collapse;width:100%;margin-bottom:6px;font-size:12px}.pvt th,.pvt td{border-bottom:1px solid #e5e5e5;padding:3px 5px;text-align:left;vertical-align:top}.pvt th{background:#f6f2f3}.pvt .num{text-align:right;white-space:nowrap}
  .pvduas{display:grid;grid-template-columns:1fr 1fr;gap:12px}h4{margin:12px 0 4px;color:#9b1d3a}.mut{color:#777}`;
async function vendasPromocao(pr) {
  if (!pr) return;
  let rows;
  try { rows = (checar(await sb.rpc("lin_promocao_vendas", { p_promocao: pr.id })) || []).map(r => Object.assign(r, {
    quantidade: Number(r.quantidade), preco_tabela: Number(r.preco_tabela), liquido: Number(r.liquido), valor_unitario: Number(r.valor_unitario) })); }
  catch (e) { return msg("err", e.message); }
  const R = pvResumo(pr, rows);
  const onde = `${pr.loja_id ? "Loja " + loja(pr.loja_id).nome : "Todas as lojas"} · ${dataBR(pr.inicio)} a ${dataBR(pr.fim)} · ${PR_SIT[prSituacao(pr)][0]}`;
  $("dlg").classList.add("largo");
  $("dlgf").innerHTML = `<style>${PV_CSS}</style><h3>Vendas da promoção: ${esc(pr.nome)}</h3><div class="mut">${esc(onde)}</div>
    ${rows.length ? pvHtml(pr, rows, R) : '<div class="card mut" style="margin-top:10px">Nenhuma peça vendida nesta promoção ainda.</div>'}
    <div class="acoes">${rows.length ? '<button type="button" class="bt" id="pvcsv">Baixar CSV</button><button type="button" class="bt" id="pvpdf">Imprimir / PDF</button>' : ""}<button type="button" class="bt pri" id="pvfim">Fechar</button></div>`;
  if (!$("dlg").open) $("dlg").showModal();
  $("pvfim").onclick = () => $("dlg").close();
  if (!rows.length) return;
  $("pvcsv").onclick = () => {
    const q = x => `"${String(x == null ? "" : x).replace(/"/g, '""')}"`, num = x => String(Number(x).toFixed(2)).replace(".", ",");
    const lin = [["Promoção", "Data", "Venda", "Loja", ...(R.vendedoras ? ["Vendedora"] : []), "Referência", "Peça", "Cor", "Tamanho", "Edição", "Quantidade", "Preço de tabela", "Valor da peça", "Vendido (líquido)", "Desconto %", "Desconto no total da venda"].map(q).join(";"),
      ...rows.map(r => [pr.nome, dataBR(r.data), r.venda, r.loja, ...(R.vendedoras ? [r.vendedora || ""] : []), r.referencia, r.descricao, r.cor, r.tamanho, r.edicao, r.quantidade,
        num(r.preco_tabela), num(r.valor_unitario), num(r.liquido), r.preco_tabela > 0 ? Math.round((1 - r.liquido / r.preco_tabela) * 100) : "", r.desconto_geral ? "sim" : ""].map(q).join(";"))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lin.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `vendas-promocao-${semAc(pr.nome).replace(/[^a-z0-9]+/g, "-")}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $("pvpdf").onclick = () => {
    const w = window.open("", "_blank"); if (!w) return msg("err", "O navegador bloqueou a janela de impressão.");
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Vendas da promoção ${esc(pr.nome)} — Linum</title>
      <style>@page{size:A4;margin:10mm}body{font:12px system-ui,sans-serif;margin:0;color:#111}.topo{border-bottom:3px solid #9b1d3a;padding-bottom:6px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:flex-end}
      .topo h1{margin:0;font-size:18px}${PV_CSS}tr{break-inside:avoid}h4{break-after:avoid}</style></head><body>
      <div class="topo"><div><h1>LINUM — Vendas da promoção “${esc(pr.nome)}”</h1><div class="mut">${esc(onde)}</div></div><div class="mut">Emitido em ${esc(new Date().toLocaleString("pt-BR"))}</div></div>
      ${pvHtml(pr, rows, R)}<script>setTimeout(() => print(), 300)<\/script></body></html>`);
    w.document.close();
  };
}
