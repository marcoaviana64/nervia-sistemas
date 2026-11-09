// Sistema Linum 2.38 — BENEFICIAMENTO (pedido do Marco em 09/11/2026).
// A peça sai da loja para bordado, tingimento, estampa… e, na volta, pode voltar igual, virar outra variação da mesma
// peça (uma peça especial que já existe ou uma nova, criada ali) ou ser perdida. Só o Dono e o Estoque enviam e
// registram o retorno; toda a equipe vê o que está fora. O valor pago ao beneficiador é só registrado (por peça), por
// quem tem "Valores da produção" (e o Dono); não muda o custo nem o preço da peça. Regras no banco: lin_beneficiamento_*.
// Usa as globais do index.html (sb, $, esc, checar, n, brl, numBR, LOJAS, loja, PRODUTOS, qtd, nomeVar, ordemVar, semAc,
// quando, todas, msg, controla, PERM, VISTA, carregar, render, hoje...).

let BENEF_FORA = 0;   // beneficiamentos ainda abertos (número na aba)
const BF_SIT = { no_beneficiamento: "No beneficiamento", concluido: "Concluído" };
const BF_RES = { igual: "voltou igual", outra: "virou", perda: "perdida" };
const FBF = { sit: "no_beneficiamento" };
const bfValores = () => !!(PERM && PERM.producao_valores);
const bfData = d => d ? d.split("-").reverse().join("/") : "";

async function carregarBenef() {
  const r = await sb.from("lin_beneficiamentos").select("id", { count: "exact", head: true }).eq("situacao", "no_beneficiamento");
  BENEF_FORA = r.error ? 0 : r.count || 0;   // sem a tabela (antes da migração) a tela segue sem beneficiamento
  const b = $("abaBenef");
  if (b) b.innerHTML = "Beneficiamento" + (BENEF_FORA ? ` <span class="badge">${BENEF_FORA}</span>` : "");
}

// todas as variações conhecidas (para achar a peça de um item e as variações da mesma peça)
function bfVariantes() {
  const m = new Map();
  PRODUTOS.forEach(p => (p.variantes || []).forEach(v => m.set(v.id, { p, v })));
  return m;
}
const bfPeca = it => `${esc(it.descricao)}${it.referencia ? ` <span class="mut">(${esc(it.referencia)})</span>` : ""} — ${esc([it.cor || "—", it.tamanho, it.edicao].filter(Boolean).join(" "))}`;
const bfPend = it => it.quantidade - it.voltaram - it.perdidas;

async function telaBeneficiamento() {
  $("tela").innerHTML = '<div class="card">Carregando…</div>';
  let bs, its, rs, vals = [];
  try {
    const desde = new Date(Date.now() - 180 * 864e5).toISOString();
    bs = await todas(() => sb.from("lin_beneficiamentos").select("*").or(`situacao.eq.no_beneficiamento,enviado_em.gte.${desde}`).order("id", { ascending: false }));
    const ids = bs.map(b => b.id);
    [its, rs] = ids.length ? await Promise.all([
      todas(() => sb.from("lin_benef_itens").select("*").in("beneficiamento_id", ids).order("id")),
      todas(() => sb.from("lin_benef_retornos").select("*").in("beneficiamento_id", ids).order("id"))]) : [[], []];
    if (bfValores() && its.length) vals = await todas(() => sb.from("lin_benef_valores").select("item_id, valor_unitario").in("item_id", its.map(i => i.id)));
  } catch (e) { $("tela").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  const val = new Map(vals.map(v => [v.item_id, Number(v.valor_unitario)]));
  const itensDe = id => its.filter(i => i.beneficiamento_id === id);
  const retDe = id => rs.filter(r => r.beneficiamento_id === id);
  const soma = (id, f) => itensDe(id).reduce((s, i) => s + f(i), 0);
  const abertos = bs.filter(b => b.situacao === "no_beneficiamento");
  BENEF_FORA = abertos.length; carregarBenef().catch(() => {});
  const atrasado = b => b.situacao === "no_beneficiamento" && b.previsto && b.previsto < hoje();
  const vis = FBF.sit === "todos" ? bs : FBF.sit === "atrasados" ? bs.filter(atrasado) : bs.filter(b => b.situacao === FBF.sit);
  const pil = (k, t) => `<button type="button" class="pilula ${FBF.sit === k ? "on" : ""}" data-fbf="${k}">${t}</button>`;
  const totalFora = abertos.reduce((s, b) => s + soma(b.id, bfPend), 0);
  const valorDe = id => itensDe(id).reduce((s, i) => s + (val.has(i.id) ? val.get(i.id) * i.quantidade : 0), 0);
  $("tela").innerHTML = `<div class="cabtela"><h2>Beneficiamento</h2>${controla() ? '<button type="button" class="bt pri" id="bfnovo">+ Enviar para beneficiamento</button>' : ""}</div>
    <p class="mut" style="margin-top:0">Peças que saíram da loja para bordado, tingimento, estampa… Saem do estoque no envio e só voltam quando o retorno é registrado: <b>igual</b>, como <b>peça especial</b> (ou outra cor) ou <b>perdida</b>.${controla() ? "" : " Só o Dono e o Estoque enviam e registram o retorno."}</p>
    <div class="kpis">
      <div class="kpi"><small>No beneficiamento</small><b>${n(abertos.length)}</b><span>${n(totalFora)} peça(s) fora das lojas</span></div>
      <div class="kpi"><small>Atrasados</small><b>${n(abertos.filter(atrasado).length)}</b><span>passaram da volta prevista</span></div>
      ${bfValores() ? `<div class="kpi"><small>Valor das peças fora</small><b>${brl(abertos.reduce((s, b) => s + itensDe(b.id).reduce((t, i) => t + (val.get(i.id) || 0) * bfPend(i), 0), 0))}</b><span>pelo valor pago informado</span></div>` : ""}
    </div>
    <div class="filtros">${pil("no_beneficiamento", "No beneficiamento")}${pil("atrasados", "Atrasados")}${pil("concluido", "Concluídos")}${pil("todos", "Todos (180 dias)")}</div>
    <div>${vis.length ? vis.map(b => { const l = itensDe(b.id), r = retDe(b.id), tot = soma(b.id, i => i.quantidade), pend = soma(b.id, bfPend);
      return `<div class="card" data-bf="${b.id}"><div class="cab" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <h3 style="margin:0"><button type="button" class="lnk" data-bfficha="${b.id}" title="Abrir a ficha" style="font:inherit;font-weight:700">Nº ${b.id}</button> · ${esc(b.servico)} · ${esc(b.beneficiador)} <span class="tag ${b.situacao === "concluido" ? "ok" : atrasado(b) ? "fora" : "possivel"}">${atrasado(b) ? "Atrasado" : BF_SIT[b.situacao]}</span></h3>
          <span class="mut">${n(tot)} peça(s)${pend && pend < tot ? ` · ${n(pend)} ainda fora` : ""}</span></div>
        <div class="mut">Saiu de ${esc(loja(b.loja_id).nome)} · enviado por ${esc(b.enviado_nome || "—")} em ${quando(b.enviado_em)}${b.previsto ? ` · volta prevista ${bfData(b.previsto)}` : ""}${b.observacao ? " · " + esc(b.observacao) : ""}</div>
        ${b.concluido_em ? `<div class="mut">Concluído em ${quando(b.concluido_em)}</div>` : ""}
        <ul style="margin:8px 0 0;padding-left:18px">${l.map(i => `<li>${i.quantidade}× ${bfPeca(i)}${i.voltaram ? ` · voltaram ${i.voltaram}` : ""}${i.perdidas ? ` · <b style="color:var(--crit)">perdidas ${i.perdidas}</b>` : ""}${bfPend(i) && bfPend(i) < i.quantidade ? ` · <b>fora ${bfPend(i)}</b>` : ""}${bfValores() && val.has(i.id) ? ` · <span class="mut">${brl(val.get(i.id))}/peça</span>` : ""}</li>`).join("")}</ul>
        ${r.length ? `<div style="margin-top:6px"><b style="font-size:13px">Retornos</b><ul style="margin:4px 0 0;padding-left:18px">${r.map(x => { const i = l.find(y => y.id === x.item_id) || {};
          return `<li class="mut">${quando(x.criado_em)} · ${x.quantidade}× ${esc(i.descricao || "")} ${esc([i.cor, i.tamanho, i.edicao].filter(Boolean).join(" "))} ${x.resultado === "outra" ? `<b>virou ${esc([x.cor, x.tamanho, x.edicao].filter(Boolean).join(" "))}</b>` : BF_RES[x.resultado]}${x.loja_id ? ` → ${esc(loja(x.loja_id).nome)}` : ""}${x.motivo ? " · " + esc(x.motivo) : ""} · ${esc(x.criado_nome || "")}</li>`; }).join("")}</ul></div>` : ""}
        ${bfValores() && valorDe(b.id) ? `<div style="margin-top:6px"><b>Valor pago: ${brl(valorDe(b.id))}</b></div>` : ""}
        <div class="acoes" style="justify-content:flex-start;margin-top:10px">
          ${controla() && b.situacao === "no_beneficiamento" ? `<button type="button" class="bt pri" data-bfret="${b.id}">Registrar retorno</button>` : ""}
          ${bfValores() ? `<button type="button" class="bt" data-bfval="${b.id}">Valor pago</button>` : ""}
          <button type="button" class="bt" data-bfficha="${b.id}">Ficha / imprimir</button></div>
      </div>`; }).join("") : `<div class="vazio">${FBF.sit === "no_beneficiamento" ? "Nenhuma peça no beneficiamento." : "Nada aqui."}</div>`}</div>`;
  if ($("bfnovo")) $("bfnovo").onclick = () => novoBeneficiamento(null, bs);
  document.querySelectorAll("[data-fbf]").forEach(b => b.onclick = () => { FBF.sit = b.dataset.fbf; telaBeneficiamento(); });
  document.querySelectorAll("[data-bfret]").forEach(b => b.onclick = () => { const x = bs.find(y => y.id === +b.dataset.bfret); retornoBeneficiamento(x, itensDe(x.id)); });
  document.querySelectorAll("[data-bfval]").forEach(b => b.onclick = () => { const x = bs.find(y => y.id === +b.dataset.bfval); valoresBeneficiamento(x, itensDe(x.id), val); });
  document.querySelectorAll("[data-bfficha]").forEach(b => b.onclick = () => { const x = bs.find(y => y.id === +b.dataset.bfficha); fichaBeneficiamento(x, itensDe(x.id), retDe(x.id), val); });
}

// ---------------------------------------------------------------- ficha do beneficiamento (versão 2.40, pergunta do Marco em
// 09/11/2026: "beneficiamento não tem ficha?"): dados, peças (enviadas, voltaram, perdidas, fora), andamento (envio e cada
// retorno ou perda, com quem e quando), as ações e Imprimir / PDF para ir junto com as peças ao beneficiador.
async function abrirFichaBenef(id) {
  const b = checar(await sb.from("lin_beneficiamentos").select("*").eq("id", id).maybeSingle());
  const [its, rs] = await Promise.all([todas(() => sb.from("lin_benef_itens").select("*").eq("beneficiamento_id", id).order("id")),
    todas(() => sb.from("lin_benef_retornos").select("*").eq("beneficiamento_id", id).order("id"))]);
  let vals = [];
  if (bfValores() && its.length) vals = await todas(() => sb.from("lin_benef_valores").select("item_id, valor_unitario").in("item_id", its.map(i => i.id)));
  fichaBeneficiamento(b, its, rs, new Map(vals.map(v => [v.item_id, Number(v.valor_unitario)])));
}
const bfComo = x => [x.cor, x.tamanho, x.edicao].filter(Boolean).join(" ");
// linha do tempo: o envio e cada retorno (ou perda), na ordem
function bfAndamento(b, its, rs) {
  const ev = [{ em: b.enviado_em, tipo: "enviado", txt: `Enviado para ${b.beneficiador} (${b.servico})`, quem: b.enviado_nome,
    det: its.map(i => `${i.quantidade}× ${i.descricao} ${bfComo(i)}`).join("; ") }];
  rs.forEach(x => { const i = its.find(y => y.id === x.item_id) || {};
    ev.push({ em: x.criado_em, tipo: x.resultado, quem: x.criado_nome,
      txt: x.resultado === "perda" ? `${x.quantidade}× ${i.descricao || ""} ${bfComo(i)} perdida${x.quantidade > 1 ? "s" : ""}`
        : `${x.quantidade}× ${i.descricao || ""} ${bfComo(i)} ${x.resultado === "outra" ? "voltou como " + bfComo(x) : "voltou igual"} → ${loja(x.loja_id).nome}`,
      det: x.motivo || "" }); });
  if (b.concluido_em) ev.push({ em: b.concluido_em, tipo: "concluido", txt: "Concluído: todas as peças voltaram ou foram perdidas", quem: "" });
  return ev;
}
function fichaBeneficiamento(b, its, rs, val) {
  const f = $("dlgf"), h = hoje(), atr = b.situacao === "no_beneficiamento" && b.previsto && b.previsto < h;
  const tot = its.reduce((s, i) => s + i.quantidade, 0), fora = its.reduce((s, i) => s + bfPend(i), 0);
  const valor = its.reduce((s, i) => s + (val && val.has(i.id) ? val.get(i.id) * i.quantidade : 0), 0);
  const linha = (rot, v) => v ? `<div class="vlin"><span class="mut">${rot}</span><span style="text-align:right">${v}</span></div>` : "";
  const ev = bfAndamento(b, its, rs);
  f.innerHTML = `<h3>Beneficiamento nº ${b.id} <span class="tag ${b.situacao === "concluido" ? "ok" : atr ? "fora" : "possivel"}">${atr ? "Atrasado" : BF_SIT[b.situacao]}</span></h3>
    <div class="campo">
      ${linha("Serviço", `<b>${esc(b.servico)}</b>`)}
      ${linha("Quem faz", esc(b.beneficiador))}
      ${linha("Saiu da loja", esc(loja(b.loja_id).nome))}
      ${linha("Enviado", `${quando(b.enviado_em)} · ${esc(b.enviado_nome || "—")}`)}
      ${linha("Volta prevista", b.previsto ? (atr ? `<b style="color:var(--crit)">${bfData(b.previsto)} · atrasado</b>` : bfData(b.previsto)) : '<span class="mut">não informada</span>')}
      ${b.observacao ? linha("Observação", esc(b.observacao)) : ""}
      ${bfValores() && valor ? linha("Valor pago", `<b>${brl(valor)}</b>`) : ""}
    </div>
    <div class="campo tw"><table><thead><tr><th>Peça</th><th class="num">Enviadas</th><th class="num">Voltaram</th><th class="num">Perdidas</th><th class="num">Fora</th>${bfValores() ? '<th class="num">R$/peça</th>' : ""}</tr></thead><tbody>
      ${its.map(i => `<tr><td>${bfPeca(i)}</td><td class="num">${i.quantidade}</td><td class="num">${i.voltaram || "—"}</td><td class="num">${i.perdidas ? `<b style="color:var(--crit)">${i.perdidas}</b>` : "—"}</td>
        <td class="num">${bfPend(i) ? `<b>${bfPend(i)}</b>` : "—"}</td>${bfValores() ? `<td class="num">${val && val.has(i.id) ? brl(val.get(i.id)) : "—"}</td>` : ""}</tr>`).join("")}
      <tr><td><b>Total</b></td><td class="num"><b>${tot}</b></td><td class="num">${its.reduce((s, i) => s + i.voltaram, 0)}</td><td class="num">${its.reduce((s, i) => s + i.perdidas, 0)}</td><td class="num"><b>${fora}</b></td>${bfValores() ? "<td></td>" : ""}</tr>
    </tbody></table></div>
    <div class="campo"><b>Andamento</b>
      <ol class="ajlinha">${ev.map(e => `<li class="ev-${e.tipo === "perda" ? "cancelado" : e.tipo === "concluido" ? "entregue" : e.tipo}"><b>${esc(e.txt)}</b> <span class="mut">${quando(e.em)}${e.quem ? " · " + esc(e.quem) : ""}</span>${e.det ? `<div>${esc(e.det)}</div>` : ""}</li>`).join("")}
        ${b.situacao === "no_beneficiamento" ? `<li class="prox"><span class="mut">Próximo: registrar a volta de ${fora} peça(s)${b.previsto ? " até " + bfData(b.previsto) : ""}</span></li>` : ""}</ol></div>
    <div class="acoes" style="flex-wrap:wrap">
      ${controla() && b.situacao === "no_beneficiamento" ? '<button type="button" class="bt pri" id="bffret">Registrar retorno</button>' : ""}
      ${bfValores() ? '<button type="button" class="bt" id="bffval">Valor pago</button>' : ""}
      <button type="button" class="bt" id="bffimp">Imprimir / PDF</button><button type="button" class="bt" id="bffx">Fechar</button></div>`;
  if ($("bffret")) $("bffret").onclick = () => retornoBeneficiamento(b, its, () => fichaBeneficiamento(b, its, rs, val));
  if ($("bffval")) $("bffval").onclick = () => valoresBeneficiamento(b, its, val || new Map());
  $("bffimp").onclick = () => imprimirBeneficiamento(b, its, rs, val);
  $("bffx").onclick = () => $("dlg").close();
  if (!$("dlg").open) $("dlg").showModal();
}
// ficha para imprimir ou salvar em PDF (vai junto com as peças); valor só para quem pode ver
function imprimirBeneficiamento(b, its, rs, val) {
  const w = window.open("", "_blank"); if (!w) return msg("err", "O navegador bloqueou a janela de impressão.");
  const vv = bfValores() && val, ev = bfAndamento(b, its, rs);
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Beneficiamento nº ${b.id} — Linum</title>
    <style>body{font:14px system-ui,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0 0 2px}.mut{color:#555}table{width:100%;border-collapse:collapse;margin-top:10px}
    td,th{padding:5px 6px;border-bottom:1px solid #ccc;text-align:left;vertical-align:top}th{font-size:12px;color:#555}.n{text-align:right}.cx{border:1px solid #999;border-radius:6px;padding:10px 12px;margin-top:12px}
    .ass{margin-top:26px;display:flex;gap:30px;flex-wrap:wrap}.ass div{flex:1;min-width:220px;border-top:1px solid #333;padding-top:4px;font-size:12px;color:#555}</style></head><body>
    <h1>LINUM · Beneficiamento nº ${b.id}</h1><div class="mut">Emitida em ${bfData(hoje())} · situação: <b>${BF_SIT[b.situacao]}</b></div>
    <div class="cx"><table>
      <tr><td class="mut" style="width:150px">Serviço</td><td><b>${esc(b.servico)}</b></td></tr>
      <tr><td class="mut">Quem faz</td><td><b>${esc(b.beneficiador)}</b></td></tr>
      <tr><td class="mut">Saiu da loja</td><td>${esc(loja(b.loja_id).nome)} · ${quando(b.enviado_em)} · ${esc(b.enviado_nome || "")}</td></tr>
      <tr><td class="mut">Volta prevista</td><td><b>${b.previsto ? bfData(b.previsto) : "—"}</b></td></tr>
      ${b.observacao ? `<tr><td class="mut">Observação</td><td>${esc(b.observacao)}</td></tr>` : ""}
    </table></div>
    <table><thead><tr><th>Peça</th><th class="n">Enviadas</th><th class="n">Voltaram</th><th class="n">Perdidas</th><th class="n">Fora</th>${vv ? '<th class="n">R$/peça</th>' : ""}</tr></thead><tbody>
      ${its.map(i => `<tr><td>${esc(i.referencia)} ${esc(i.descricao)} — ${esc(bfComo(i) || "—")}</td><td class="n">${i.quantidade}</td><td class="n">${i.voltaram}</td><td class="n">${i.perdidas}</td><td class="n">${bfPend(i)}</td>${vv ? `<td class="n">${val.has(i.id) ? brl(val.get(i.id)) : "—"}</td>` : ""}</tr>`).join("")}
      <tr><td><b>Total</b></td><td class="n"><b>${its.reduce((s, i) => s + i.quantidade, 0)}</b></td><td class="n">${its.reduce((s, i) => s + i.voltaram, 0)}</td><td class="n">${its.reduce((s, i) => s + i.perdidas, 0)}</td><td class="n"><b>${its.reduce((s, i) => s + bfPend(i), 0)}</b></td>${vv ? `<td class="n"><b>${brl(its.reduce((s, i) => s + (val.get(i.id) || 0) * i.quantidade, 0))}</b></td>` : ""}</tr>
    </tbody></table>
    <h3 style="margin:18px 0 4px;font-size:15px">Andamento</h3>
    ${ev.map(e => `<div>${quando(e.em)} · <b>${esc(e.txt)}</b>${e.quem ? " · " + esc(e.quem) : ""}${e.det && e.tipo !== "enviado" ? ` — ${esc(e.det)}` : ""}</div>`).join("")}
    <div class="ass"><div>Recebido por ${esc(b.beneficiador)} em ____/____/______</div><div>Devolvido à loja em ____/____/______ · conferido por</div></div>
    </body></html>`);
  w.document.close(); w.focus(); w.print();
}

// envio; ini = {variante, loja} quando vem do quadrado do Estoque; anteriores = para sugerir beneficiador e serviço
async function novoBeneficiamento(ini, anteriores) {
  const f = $("dlgf");
  if (!anteriores) { const r = await sb.from("lin_beneficiamentos").select("beneficiador, servico").order("id", { ascending: false }).limit(200); anteriores = r.data || []; }
  const unicos = k => [...new Set(anteriores.map(b => b[k]).filter(Boolean))];
  const T = { loja: (ini && ini.loja) || MINHA_LOJA || (LOJAS[0] || {}).id || "", quem: "", serv: "", prev: "", obs: "", itens: [], q: "" };
  const vmap = bfVariantes();
  if (ini && ini.variante && vmap.has(ini.variante)) T.itens.push({ variante: ini.variante, quantidade: 1, valor: "" });
  const rot = id => { const x = vmap.get(id); return x ? `${esc(x.p.descricao)} <span class="mut">(${esc(x.p.referencia || "")})</span> — ${esc(nomeVar(x.v))}` : "?"; };
  const resultados = () => {
    const t = semAc(T.q); if (t.length < 2) return [];
    const out = [];
    for (const p of PRODUTOS) {
      const casaP = semAc([p.referencia, p.descricao, p.codigo_barras].join(" ")).includes(t);
      for (const v of p.variantes || []) {
        if (qtd(v.id, T.loja) <= 0 || T.itens.some(i => i.variante === v.id)) continue;
        if (casaP || semAc([p.referencia, p.descricao, v.cor, v.tamanho, v.edicao, v.codigo_barras].join(" ")).includes(t)) out.push(v.id);
        if (out.length >= 40) return out;
      }
    }
    return out;
  };
  const guardar = () => {
    [["bfq", "q"], ["bfquem", "quem"], ["bfserv", "serv"], ["bfprev", "prev"], ["bfobs", "obs"]].forEach(([id, k]) => { if ($(id)) T[k] = $(id).value; });
    f.querySelectorAll("[data-bfq]").forEach(i => { const it = T.itens[+i.dataset.bfq]; if (it) it.quantidade = i.value; });
    f.querySelectorAll("[data-bfv]").forEach(i => { const it = T.itens[+i.dataset.bfv]; if (it) it.valor = i.value; });
  };
  const desenharRes = () => {
    const r = resultados();
    $("bfres").className = r.length ? "cres" : "";
    $("bfres").innerHTML = T.q.trim().length < 2 ? '<div class="mut" style="font-size:12px">Digite pelo menos 2 letras do nome, da referência ou o código de barras.</div>'
      : r.length ? r.map(id => `<button type="button" data-bfadd="${id}">${rot(id)} · <b>${n(qtd(id, T.loja))} em ${esc(loja(T.loja).nome)}</b></button>`).join("")
      : `<div class="mut" style="font-size:12px">Nenhuma peça com estoque em ${esc(loja(T.loja).nome)} com esse texto.</div>`;
    $("bfres").querySelectorAll("[data-bfadd]").forEach(b => b.onclick = () => { guardar(); T.itens.push({ variante: b.dataset.bfadd, quantidade: 1, valor: "" }); T.q = ""; desenhar(); $("bfq").focus(); });
  };
  const desenhar = erro => {
    f.innerHTML = `<h3>Enviar para beneficiamento</h3>
      <div class="campo"><label>Sai da loja</label><div class="opcoes">${LOJAS.map(l => `<button type="button" class="pilula ${T.loja === l.id ? "on" : ""}" data-bfl="${l.id}">${esc(l.nome)}</button>`).join("")}</div></div>
      <div class="campo"><label for="bfquem">Quem faz (beneficiador)</label><input id="bfquem" list="bfdlq" maxlength="120" value="${esc(T.quem)}" placeholder="Ex.: Ateliê da Rosa"><datalist id="bfdlq">${unicos("beneficiador").map(x => `<option value="${esc(x)}">`).join("")}</datalist></div>
      <div class="campo"><label for="bfserv">Serviço</label><input id="bfserv" list="bfdls" maxlength="200" value="${esc(T.serv)}" placeholder="Ex.: bordado à mão, tingimento, estampa"><datalist id="bfdls">${unicos("servico").map(x => `<option value="${esc(x)}">`).join("")}</datalist></div>
      <div class="campo"><label for="bfprev">Volta prevista (opcional)</label><input id="bfprev" type="date" min="${hoje()}" value="${esc(T.prev)}"></div>
      <div class="campo"><label for="bfq">Acrescentar peça</label><input id="bfq" type="search" autocomplete="off" placeholder="Nome, referência ou código de barras" value="${esc(T.q)}"><div id="bfres"></div></div>
      <div class="campo"><label>Peças que vão</label>${T.itens.length ? `<div class="tw"><table><thead><tr><th>Peça</th><th class="num">Em ${esc(loja(T.loja).nome)}</th><th class="num">Enviar</th>${bfValores() ? '<th class="num">Valor por peça (R$)</th>' : ""}<th></th></tr></thead><tbody>
        ${T.itens.map((it, k) => `<tr><td>${rot(it.variante)}</td><td class="num">${n(qtd(it.variante, T.loja))}</td>
          <td class="num"><input type="number" inputmode="numeric" min="1" max="${qtd(it.variante, T.loja)}" step="1" value="${esc(it.quantidade)}" data-bfq="${k}" style="width:70px" aria-label="Quantidade"></td>
          ${bfValores() ? `<td class="num"><input inputmode="decimal" value="${esc(it.valor)}" data-bfv="${k}" style="width:90px" placeholder="opcional" aria-label="Valor pago por peça"></td>` : ""}
          <td><button type="button" class="lnk perigo" data-bfdel="${k}">Tirar</button></td></tr>`).join("")}</tbody></table></div>
        <div class="mut" style="font-size:12px">${n(T.itens.reduce((s, i) => s + (Number(i.quantidade) || 0), 0))} peça(s)${bfValores() ? " · o valor pago é só registro: não muda o custo nem o preço da peça" : ""}</div>` : '<div class="mut">Nenhuma peça ainda: procure acima.</div>'}</div>
      <div class="campo"><label for="bfobs">Observação (opcional)</label><input id="bfobs" maxlength="300" value="${esc(T.obs)}" placeholder="Ex.: flores na barra, cor azul-marinho"></div>
      <p class="mut" style="font-size:12.5px">O que a peça vai virar (peça especial, outra cor) é escolhido na volta.</p>
      ${erro ? `<div class="msg err">${esc(erro)}</div>` : ""}
      <div class="acoes"><button type="button" class="bt" id="bfx">Cancelar</button><button type="button" class="bt pri" id="bfok">Enviar peças</button></div>`;
    f.querySelectorAll("[data-bfl]").forEach(b => b.onclick = () => { guardar(); T.loja = b.dataset.bfl; T.itens = T.itens.filter(i => qtd(i.variante, T.loja) > 0); desenhar(); });
    f.querySelectorAll("[data-bfdel]").forEach(b => b.onclick = () => { guardar(); T.itens.splice(+b.dataset.bfdel, 1); desenhar(); });
    $("bfq").oninput = () => { T.q = $("bfq").value; desenharRes(); };
    $("bfq").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); const p = $("bfres").querySelector("[data-bfadd]"); if (p) p.click(); } };
    $("bfx").onclick = () => $("dlg").close();
    $("bfok").onclick = enviar;
    desenharRes();
  };
  const enviar = async () => {
    guardar();
    if (T.quem.trim().length < 2) return desenhar("Informe quem vai fazer o beneficiamento.");
    if (T.serv.trim().length < 3) return desenhar("Informe o serviço (ex.: bordado, tingimento, estampa).");
    if (!T.itens.length) return desenhar("Escolha pelo menos uma peça.");
    for (const it of T.itens) {
      const q = Number(it.quantidade), tem = qtd(it.variante, T.loja);
      if (!Number.isInteger(q) || q < 1) return desenhar("Informe uma quantidade inteira maior que zero em cada peça.");
      if (q > tem) { const x = vmap.get(it.variante); return desenhar(`${x ? x.p.descricao + " " + nomeVar(x.v) : "A peça"}: ${loja(T.loja).nome} só tem ${tem}.`); }
      if (String(it.valor || "").trim() && !/^\d+(\.\d{1,2})?$/.test(numBR(it.valor))) return desenhar("Valor por peça inválido (ex.: 45,00).");
    }
    const tot = T.itens.reduce((s, i) => s + Number(i.quantidade), 0);
    if (!confirm(`Enviar ${tot} peça(s) de ${loja(T.loja).nome} para ${T.serv.trim()} com ${T.quem.trim()}?\n\nAs peças saem agora do estoque de ${loja(T.loja).nome} e só voltam quando o retorno for registrado.`)) return;
    $("bfok").disabled = true; $("bfok").textContent = "Enviando…";
    try {
      const id = checar(await sb.rpc("lin_beneficiamento_enviar", { p: { loja: T.loja, beneficiador: T.quem.trim(), servico: T.serv.trim(), previsto: T.prev, observacao: T.obs.trim(),
        itens: T.itens.map(i => Object.assign({ variante_id: i.variante, quantidade: Number(i.quantidade) }, bfValores() && String(i.valor || "").trim() ? { valor_unitario: Number(numBR(i.valor)) } : {})) } }));
      $("dlg").close();
      await carregar(); await carregarBenef();
      FBF.sit = "no_beneficiamento";
      if (VISTA === "beneficiamento") telaBeneficiamento(); else render();
      msg("ok", `Beneficiamento nº ${id}: ${tot} peça(s) enviadas para ${T.serv.trim()}. Imprima a ficha para ir junto com as peças.`);
      abrirFichaBenef(id).catch(() => {});
    } catch (e) { desenhar(e.message); }
  };
  desenhar();
  $("dlg").showModal();
  $("bfq").focus();
}

// retorno: para cada peça ainda fora, quantas voltaram iguais, quantas viraram outra variação (escolhida ou criada
// na hora como peça especial) e quantas se perderam (com motivo); a loja de entrada é escolhida (padrão = a de origem)
function retornoBeneficiamento(b, its, voltar) {   // voltar (opcional) = o botão "Voltar" volta para a ficha
  const f = $("dlgf");
  let vmap = bfVariantes();   // relida depois de criar uma peça especial (carregar() troca o PRODUTOS)
  const pend = its.filter(i => bfPend(i) > 0);
  const R = pend.map(i => ({ id: i.id, igual: "", outra: "", alvo: "", perda: "", motivo: "" }));
  const O = { loja: b.loja_id, obs: "" };
  const opcoes = i => {   // outras variações da mesma peça: especiais primeiro
    const x = vmap.get(i.variante_id); if (!x) return [];
    return (x.p.variantes || []).filter(v => v.id !== i.variante_id).sort((a, c) => (c.edicao ? 1 : 0) - (a.edicao ? 1 : 0) || ordemVar(a, c));
  };
  const guardar = () => {
    f.querySelectorAll("[data-rbf]").forEach(el => { R[+el.dataset.k][el.dataset.rbf] = el.value; });
    if ($("rbfobs")) O.obs = $("rbfobs").value;
  };
  const desenhar = erro => {
    f.innerHTML = `<h3>Retorno do beneficiamento nº ${b.id}</h3>
      <div class="mut">${esc(b.servico)} · ${esc(b.beneficiador)} · saiu de ${esc(loja(b.loja_id).nome)} em ${quando(b.enviado_em)}</div>
      <div class="campo"><label>As peças entram na loja</label><div class="opcoes">${LOJAS.map(l => `<button type="button" class="pilula ${O.loja === l.id ? "on" : ""}" data-rbl="${l.id}">${esc(l.nome)}</button>`).join("")}</div></div>
      <p class="mut" style="font-size:12.5px">Para cada peça, diga quantas <b>voltaram iguais</b>, quantas <b>viraram outra</b> (peça especial ou outra cor; escolha qual ou crie a peça especial) e quantas <b>se perderam</b>. Pode registrar só uma parte agora; o resto continua no beneficiamento.</p>
      ${pend.map((i, k) => { const ops = opcoes(i);
        return `<div class="card" style="padding:10px;margin:8px 0"><b>${bfPeca(i)}</b> <span class="mut">· ${bfPend(i)} fora</span>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:6px">
          <div class="campo" style="margin:0"><label>Voltou igual</label><input type="number" inputmode="numeric" min="0" max="${bfPend(i)}" step="1" data-rbf="igual" data-k="${k}" value="${esc(R[k].igual)}" placeholder="0"></div>
          <div class="campo" style="margin:0"><label>Virou outra</label><input type="number" inputmode="numeric" min="0" max="${bfPend(i)}" step="1" data-rbf="outra" data-k="${k}" value="${esc(R[k].outra)}" placeholder="0"></div>
          <div class="campo" style="margin:0"><label>Perdida</label><input type="number" inputmode="numeric" min="0" max="${bfPend(i)}" step="1" data-rbf="perda" data-k="${k}" value="${esc(R[k].perda)}" placeholder="0"></div>
        </div>
        ${Number(R[k].outra) > 0 ? `<div class="campo" style="margin:6px 0 0"><label>Virou qual?</label>
          ${vmap.has(i.variante_id) ? `<select data-rbf="alvo" data-k="${k}"><option value="">— escolha —</option>${ops.map(v => `<option value="${v.id}" ${R[k].alvo === v.id ? "selected" : ""}>${v.edicao ? "★ " : ""}${esc(nomeVar(v))}</option>`).join("")}</select>
          <button type="button" class="lnk" data-rbnova="${k}">+ Nova peça especial</button>` : '<div class="mut">Esta peça está desativada no cadastro; só dá para voltar igual ou perdida.</div>'}</div>` : ""}
        ${Number(R[k].perda) > 0 ? `<div class="campo" style="margin:6px 0 0"><label>O que aconteceu? (obrigatório)</label><input maxlength="300" data-rbf="motivo" data-k="${k}" value="${esc(R[k].motivo)}" placeholder="Ex.: manchou no tingimento"></div>` : ""}
      </div>`; }).join("")}
      <div class="campo"><label for="rbfobs">Observação (opcional)</label><input id="rbfobs" maxlength="300" value="${esc(O.obs)}"></div>
      ${erro ? `<div class="msg err">${esc(erro)}</div>` : ""}
      <div class="acoes"><button type="button" class="bt" id="rbtodas">Todas voltaram iguais</button><button type="button" class="bt" id="rbx">Voltar</button><button type="button" class="bt pri" id="rbok">Registrar retorno</button></div>`;
    f.querySelectorAll("[data-rbl]").forEach(x => x.onclick = () => { guardar(); O.loja = x.dataset.rbl; desenhar(); });
    // redesenha só quando muda o que aparece (escolha da variação / motivo), para não perder o foco ao digitar
    f.querySelectorAll('[data-rbf="outra"],[data-rbf="perda"]').forEach(el => el.onchange = () => { guardar(); desenhar(); });
    f.querySelectorAll("[data-rbnova]").forEach(x => x.onclick = () => { guardar(); novaEspecialRetorno(pend[+x.dataset.rbnova], vid => { vmap = bfVariantes(); R[+x.dataset.rbnova].alvo = vid; desenhar(); }); });
    $("rbtodas").onclick = () => { R.forEach((r, k) => { r.igual = String(bfPend(pend[k])); r.outra = ""; r.perda = ""; }); desenhar(); };
    $("rbx").onclick = () => voltar ? voltar() : $("dlg").close();
    $("rbok").onclick = registrar;
  };
  const registrar = async () => {
    guardar();
    const itens = [];
    for (const [k, r] of R.entries()) {
      const i = pend[k], nome = i.descricao + " " + [i.cor, i.tamanho, i.edicao].filter(Boolean).join(" ");
      const q = { igual: Number(r.igual || 0), outra: Number(r.outra || 0), perda: Number(r.perda || 0) };
      if (Object.values(q).some(v => !Number.isInteger(v) || v < 0)) return desenhar(`${nome}: use números inteiros.`);
      if (q.igual + q.outra + q.perda > bfPend(i)) return desenhar(`${nome}: só ${bfPend(i)} peça(s) estão fora.`);
      if (q.outra && !r.alvo) return desenhar(`${nome}: escolha em que peça ela se transformou (ou crie a peça especial).`);
      if (q.perda && r.motivo.trim().length < 5) return desenhar(`${nome}: escreva o que aconteceu com a peça perdida.`);
      if (q.igual) itens.push({ item_id: i.id, resultado: "igual", quantidade: q.igual });
      if (q.outra) itens.push({ item_id: i.id, resultado: "outra", quantidade: q.outra, variante_id: r.alvo });
      if (q.perda) itens.push({ item_id: i.id, resultado: "perda", quantidade: q.perda, motivo: r.motivo.trim() });
    }
    if (!itens.length) return desenhar("Informe pelo menos uma peça que voltou (ou foi perdida).");
    const volt = itens.filter(x => x.resultado !== "perda").reduce((s, x) => s + x.quantidade, 0);
    if (!confirm(`Registrar o retorno?${volt ? `\n\n${volt} peça(s) entram agora no estoque de ${loja(O.loja).nome}.` : ""}`)) return;
    $("rbok").disabled = true; $("rbok").textContent = "Salvando…";
    try {
      const sit = checar(await sb.rpc("lin_beneficiamento_retorno", { p_id: b.id, p: { loja: O.loja, observacao: O.obs.trim(), itens } }));
      $("dlg").close();
      await carregar(); await carregarBenef();
      telaBeneficiamento();
      msg("ok", `Beneficiamento nº ${b.id}: retorno registrado${volt ? `, ${volt} peça(s) no estoque de ${loja(O.loja).nome}` : ""}.${sit === "concluido" ? " Beneficiamento concluído." : " Ainda há peças fora."}`);
    } catch (e) { desenhar(e.message); }
  };
  desenhar();
  $("dlg").showModal();
}

// cria a peça especial na hora (mesma peça; cor e tamanho vêm da que foi enviada); preço de venda opcional
// (o preço e o custo novos podem ser acertados depois em Produtos)
function novaEspecialRetorno(i, pronto) {
  const f = $("dlg2f") || $("dlg2");
  const x = bfVariantes().get(i.variante_id);
  const E = { cor: i.cor || "", tam: i.tamanho || "", ed: "", preco: "" };
  const desenhar = erro => {
    f.innerHTML = `<h3>Nova peça especial</h3>
      <div class="mut">${esc(i.descricao)} (${esc(i.referencia || "")}) — enviada como ${esc([i.cor, i.tamanho, i.edicao].filter(Boolean).join(" "))}</div>
      <div class="campo"><label for="need">Edição (o que a torna especial)</label><input id="need" maxlength="80" value="${esc(E.ed)}" placeholder="Ex.: Bordada à mão, Tingida"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="campo"><label for="necor">Cor</label><input id="necor" maxlength="80" value="${esc(E.cor)}"></div>
        <div class="campo"><label for="netam">Tamanho</label><input id="netam" maxlength="20" value="${esc(E.tam)}"></div></div>
      <div class="campo"><label for="nepre">Preço de venda (opcional; vazio = o da peça)</label><input id="nepre" inputmode="decimal" value="${esc(E.preco)}" placeholder="Ex.: 690,00"></div>
      ${erro ? `<div class="msg err">${esc(erro)}</div>` : ""}
      <div class="acoes"><button type="button" class="bt" id="nex">Cancelar</button><button type="button" class="bt pri" id="neok">Criar peça especial</button></div>`;
    $("nex").onclick = () => $("dlg2").close();
    $("neok").onclick = async () => {
      E.ed = $("need").value.trim(); E.cor = $("necor").value.trim(); E.tam = $("netam").value.trim(); E.preco = $("nepre").value.trim();
      if (!E.ed) return desenhar("Informe a edição (ex.: Bordada à mão).");
      if (!E.cor || !E.tam) return desenhar("Informe a cor e o tamanho.");
      $("neok").disabled = true;
      try {
        const vid = checar(await sb.rpc("lin_variante_salvar", { p: { produto_id: x.p.id, cor: E.cor, tamanho: E.tam, edicao: E.ed, preco_venda: numBR(E.preco), preco_custo: "" } }));
        await carregar();
        $("dlg2").close();
        pronto(vid);
      } catch (e) { desenhar(e.message); }
    };
  };
  desenhar();
  $("dlg2").showModal();
  $("need").focus();
}

// valor pago por peça (Dono ou "Valores da produção"); só registro, não mexe no custo da peça
function valoresBeneficiamento(b, its, val) {
  const f = $("dlgf");
  const V = its.map(i => (val.has(i.id) ? String(val.get(i.id)).replace(".", ",") : ""));
  const desenhar = erro => {
    f.innerHTML = `<h3>Valor pago · beneficiamento nº ${b.id}</h3>
      <div class="mut">${esc(b.servico)} · ${esc(b.beneficiador)}</div>
      <div class="tw"><table><thead><tr><th>Peça</th><th class="num">Qtd.</th><th class="num">Valor por peça (R$)</th></tr></thead><tbody>
      ${its.map((i, k) => `<tr><td>${bfPeca(i)}</td><td class="num">${i.quantidade}</td><td class="num"><input inputmode="decimal" data-vv="${k}" value="${esc(V[k])}" style="width:90px" aria-label="Valor por peça"></td></tr>`).join("")}
      </tbody></table></div>
      <p class="mut" style="font-size:12.5px">Só registro do que foi pago. Não muda o custo nem o preço das peças (acerte em Produtos, se precisar). Vazio = sem valor.</p>
      ${erro ? `<div class="msg err">${esc(erro)}</div>` : ""}
      <div class="acoes"><button type="button" class="bt" id="vvx">Cancelar</button><button type="button" class="bt pri" id="vvok">Salvar</button></div>`;
    $("vvx").onclick = () => $("dlg").close();
    $("vvok").onclick = async () => {
      f.querySelectorAll("[data-vv]").forEach(el => { V[+el.dataset.vv] = el.value; });
      const itens = [];
      for (const [k, i] of its.entries()) {
        const t = numBR(V[k]);
        if (t && !/^\d+(\.\d{1,2})?$/.test(t)) return desenhar("Valor inválido (ex.: 45,00).");
        itens.push({ item_id: i.id, valor_unitario: t ? Number(t) : "" });
      }
      $("vvok").disabled = true;
      try {
        checar(await sb.rpc("lin_beneficiamento_valores", { p_id: b.id, p_itens: itens }));
        $("dlg").close(); telaBeneficiamento(); msg("ok", `Valor do beneficiamento nº ${b.id} salvo.`);
      } catch (e) { desenhar(e.message); }
    };
  };
  desenhar();
  $("dlg").showModal();
}
