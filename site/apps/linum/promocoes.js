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

// formulário: nome, loja, datas, observação e as peças com o preço da promoção
function editarPromocao(pr) {
  $("dlg").classList.add("largo");
  const f = $("dlgf");
  const P = pr ? { id: pr.id, nome: pr.nome, loja: pr.loja_id || "", inicio: pr.inicio, fim: pr.fim, obs: pr.observacao || "",
                   itens: pr.itens.map(i => ({ produto_id: i.produto_id, variante_id: i.variante_id || "", preco: moeda(i.preco) })) }
    : { id: null, nome: "", loja: "", inicio: hoje(), fim: somaDias(hoje(), 6), obs: "", itens: [] };
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
        <div class="mut" style="font-size:12px">"Todas as cores e tamanhos" vale para as cores e tamanhos normais da peça; peça especial (com preço próprio) entra só escolhida uma a uma.</div>
      </div>
      ${erro ? `<div class="msg err">${esc(erro)}</div>` : ""}
      <div class="acoes"><button type="button" class="bt" id="prx">Cancelar</button><button type="button" class="bt pri" id="prok">${P.id ? "Salvar alterações" : "Criar promoção"}</button></div>`;
    const guardar = () => { P.nome = $("prnome").value; P.inicio = $("prini").value; P.fim = $("prfim").value; P.loja = $("prloja").value; P.obs = $("probs").value; };
    ["prnome", "prini", "prfim", "prloja", "probs"].forEach(id => $(id).onchange = guardar);
    const itens = () => {
      $("pritens").innerHTML = P.itens.length ? `<div class="tw"><table><thead><tr><th>Peça</th><th>Cor / tamanho</th><th class="num">Tabela</th><th class="num">Preço na promoção</th><th class="num">Desconto</th><th></th></tr></thead><tbody>
        ${P.itens.map((it, k) => { const p = prProduto(it.produto_id) || { referencia: "?", descricao: "peça excluída", variantes: [] };
          const v = it.variante_id ? (p.variantes || []).find(x => x.id === it.variante_id) : null, tab = prTabela(p, v), pr = numV(it.preco);
          return `<tr><td><b>${esc(p.referencia)}</b> ${esc(p.descricao)}</td>
            <td><select data-prv="${k}"><option value="">Todas as cores e tamanhos</option>${(p.variantes || []).filter(x => x.ativo !== false || x.id === it.variante_id).map(x => `<option value="${x.id}" ${x.id === it.variante_id ? "selected" : ""}>${esc(nomeVar(x))}${x.preco_venda != null ? " · " + brl(x.preco_venda) : ""}</option>`).join("")}</select></td>
            <td class="num">${brl(tab)}</td>
            <td class="num"><input data-prp="${k}" inputmode="decimal" value="${esc(it.preco)}" placeholder="0,00" style="width:100px"></td>
            <td class="num" data-prd="${k}">${tab > 0 && pr > 0 && pr < tab ? "−" + decBR(r2((1 - pr / tab) * 100)) + "%" : "—"}</td>
            <td><button type="button" class="lnk perigo" data-prrm="${k}" title="Tirar">×</button></td></tr>`; }).join("")}
        </tbody></table></div>` : '<div class="mut">Nenhuma peça ainda: procure acima.</div>';
      $("pritens").querySelectorAll("[data-prv]").forEach(s => s.onchange = () => { P.itens[s.dataset.prv].variante_id = s.value; itens(); });
      $("pritens").querySelectorAll("[data-prp]").forEach(i => i.oninput = () => { const it = P.itens[i.dataset.prp]; it.preco = i.value;
        const p = prProduto(it.produto_id), v = it.variante_id ? (p.variantes || []).find(x => x.id === it.variante_id) : null, tab = prTabela(p, v), pr = numV(it.preco);
        $("pritens").querySelector(`[data-prd="${i.dataset.prp}"]`).textContent = tab > 0 && pr > 0 && pr < tab ? "−" + decBR(r2((1 - pr / tab) * 100)) + "%" : "—"; });
      $("pritens").querySelectorAll("[data-prrm]").forEach(b => b.onclick = () => { P.itens.splice(+b.dataset.prrm, 1); itens(); });
    };
    $("prq").oninput = () => {
      const t = semAc($("prq").value.trim());
      if (t.length < 2) { $("prres").innerHTML = ""; return; }
      const l = PRODUTOS.filter(p => semAc(p.referencia).includes(t) || semAc(p.descricao).includes(t)).slice(0, 12);
      $("prres").innerHTML = l.length ? l.map(p => `<div class="vlin"><span><b>${esc(p.referencia)}</b> ${esc(p.descricao)} · ${brl(p.preco_venda)}</span><button type="button" class="lnk" data-pradd="${p.id}">Adicionar</button></div>`).join("")
        : '<div class="mut">Nenhuma peça encontrada.</div>';
      $("prres").querySelectorAll("[data-pradd]").forEach(b => b.onclick = () => {
        guardar(); P.itens.push({ produto_id: b.dataset.pradd, variante_id: "", preco: "" });
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
      for (const it of P.itens) {
        const p = prProduto(it.produto_id), v = it.variante_id ? (p.variantes || []).find(x => x.id === it.variante_id) : null, tab = prTabela(p, v), pr = numV(it.preco);
        if (!(pr > 0) && String(it.preco).trim() !== "0") return desenhar(`Informe o preço da promoção de ${p.referencia} ${p.descricao}.`);
        if (tab > 0 && pr >= tab) return desenhar(`${p.referencia} ${p.descricao}: o preço da promoção (${brl(pr)}) tem de ser menor que o de tabela (${brl(tab)}).`);
      }
      $("prok").disabled = true;
      try {
        const id = checar(await sb.rpc("lin_promocao_salvar", { p: { id: P.id, nome: P.nome.trim(), loja_id: P.loja || null, inicio: P.inicio, fim: P.fim, observacao: P.obs.trim(),
          itens: P.itens.map(i => ({ produto_id: i.produto_id, variante_id: i.variante_id || null, preco: numBR(i.preco) })) } }));
        $("dlg").close(); msg("ok", `Promoção "${P.nome.trim()}" ${P.id ? "alterada" : "criada"} (nº ${id}).`);
        telaPromocoes();
      } catch (e) { desenhar(e.message); }
    };
  };
  desenhar();
  if (!$("dlg").open) $("dlg").showModal();
}
