// Sistema Linum 2.58 — PROMOÇÕES (pedido do Marco em 23/11/2026: promoção de uma semana com peças a preço diferenciado).
// O Dono e o Estoque cadastram: nome, loja (ou as duas), início e fim, e as peças com o preço da promoção (a peça toda =
// todas as cores e tamanhos normais; ou uma cor/tamanho, inclusive peça especial). A equipe toda vê. Na venda, a peça
// entra sozinha com o preço da promoção válida na loja e na data da venda (com mais de uma, vale o MENOR preço); o banco
// marca a promoção na peça vendida (lin_venda_itens.promocao_nome) e o resultado aparece aqui.
// Regras no banco: lin_promocao_salvar / lin_promocao_cancelar / lin_promocoes_resumo (migração ..._linum_promocoes.sql).
// Usa as globais do index.html (sb, $, esc, checar, n, brl, LOJAS, loja, PRODUTOS, nomeVar, semAc, quando, dataBR, hoje,
// controla, msg, moeda, numV, numBR, r2, decBR...).

let PROMOS = [];          // [{id, nome, loja_id, inicio, fim, cancelada_em, ..., itens: [{produto_id, variante_id, preco}]}]
const FPROMO = { sit: "vigentes" };

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
        <ul style="margin:6px 0 0;padding-left:18px">${p.itens.map(linhaItem).join("")}</ul>
        ${r ? `<div class="vlin"><span>Vendido na promoção</span><span><b>${n(r.pecas)}</b> peça(s) em ${n(r.vendas)} venda(s) · ${brl(r.vendido)} · desconto dado ${brl(r.desconto)}</span></div>` : controla() ? '<div class="vlin mut"><span>Nenhuma peça vendida nesta promoção ainda.</span></div>' : ""}
        ${p.cancelada_em ? `<div class="msg err">Cancelada por ${esc(p.cancelada_nome || "")} em ${quando(p.cancelada_em)}: ${esc(p.motivo_cancelamento || "")}</div>` : ""}
        ${controla() && !p.cancelada_em ? `<div class="acoes" style="justify-content:flex-start"><button type="button" class="bt" data-pred="${p.id}">Editar</button>${s !== "encerrada" ? `<button type="button" class="bt" data-prenc="${p.id}">Encerrar hoje</button>` : ""}<button type="button" class="bt" data-prcanc="${p.id}" style="color:var(--crit);border-color:var(--crit)">Cancelar</button></div>` : ""}
        <div class="mut" style="font-size:12px">Criada por ${esc(p.criado_nome || "")} em ${quando(p.criado_em)}${p.alterado_em ? ` · alterada por ${esc(p.alterado_nome || "")} em ${quando(p.alterado_em)}` : ""}</div>
      </div>`; }).join("") : '<div class="card mut">Nenhuma promoção aqui.</div>'}`;
  document.querySelectorAll("[data-fpr]").forEach(b => b.onclick = () => { FPROMO.sit = b.dataset.fpr; telaPromocoes(); });
  if ($("prnova")) $("prnova").onclick = () => editarPromocao(null);
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
