// Sistema Linum 2.44 — BRINDE / PRESENTE / DIVULGAÇÃO (pedido do Marco em 10/11/2026: "a Gorette deu uma peça de presente").
// A peça sai do estoque como brinde (não é venda: não entra em vendas, comissão, ranking nem lucro). Dono e Estoque
// registram e veem; o custo só o Dono vê; cancelar (registro errado) só o Dono, e as peças voltam à loja.
// Regras no banco: lin_brinde_registrar / lin_brinde_cancelar / lin_brindes_ler.
// Usa as globais do index.html (sb, $, esc, checar, n, brl, LOJAS, loja, PRODUTOS, qtd, nomeVar, semAc, quando, dataBR, hoje, dono, msg...).

const BR_MOTIVO = { presente: "Presente", divulgacao: "Divulgação", brinde: "Brinde para cliente", outro: "Outro" };
const BR_DICA = { presente: "Ex.: presente da dona, aniversário", divulgacao: "Influenciadora, parceria, fotos", brinde: "Cortesia para cliente", outro: "Escreva na observação o que foi" };
const FBR = { de: "", ate: "", loja: "", motivo: "" };
let BR_CLI = null;   // clientes (id, nome, telefone) para ligar o brinde à ficha

const brPeca = it => `${esc(it.descricao)}${it.referencia ? ` <span class="mut">(${esc(it.referencia)})</span>` : ""} — ${esc([it.cor || "—", it.tamanho, it.edicao].filter(Boolean).join(" "))}`;
const brPecas = b => (b.itens || []).reduce((s, i) => s + Number(i.quantidade || 0), 0);
const brVenda = b => (b.itens || []).reduce((s, i) => s + Number(i.quantidade || 0) * Number(i.preco_venda || 0), 0);
const brCusto = b => (b.itens || []).reduce((s, i) => s + Number(i.quantidade || 0) * Number(i.custo_unitario || 0), 0);
const brSemCusto = b => (b.itens || []).some(i => i.custo_unitario == null);

async function telaBrindes() {
  if (!FBR.de) { FBR.de = hoje().slice(0, 8) + "01"; FBR.ate = hoje(); }
  $("tela").innerHTML = '<div class="card">Carregando…</div>';
  let bs;
  try { bs = checar(await sb.rpc("lin_brindes_ler", { p_de: FBR.de || null, p_ate: FBR.ate || null })) || []; }
  catch (e) { $("tela").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  const vis = bs.filter(b => (!FBR.loja || b.loja_id === FBR.loja) && (!FBR.motivo || b.motivo === FBR.motivo));
  const ativos = vis.filter(b => !b.cancelado_em);
  const soma = f => ativos.reduce((s, b) => s + f(b), 0);
  const semCusto = ativos.filter(brSemCusto).length;
  const pil = (k, v, t) => `<button type="button" class="pilula ${FBR[k] === v ? "on" : ""}" data-fbr="${k}" data-x="${esc(v)}">${esc(t)}</button>`;
  $("tela").innerHTML = `<div class="cabtela"><h2>Brindes, presentes e divulgação</h2><button type="button" class="bt pri" id="brnovo">+ Novo brinde / presente</button></div>
    <p class="mut" style="margin-top:0">Peças que saem do estoque <b>sem venda</b>: presente, divulgação (influenciadora, parceria, fotos) ou brinde para cliente. Não entram em vendas, comissão, ranking nem no lucro das vendas.</p>
    <div class="filtros">
      <label>De <input type="date" id="brde" value="${esc(FBR.de)}"></label><label>Até <input type="date" id="brate" value="${esc(FBR.ate)}"></label>
      ${pil("loja", "", "Todas as lojas")}${LOJAS.map(l => pil("loja", l.id, l.nome)).join("")}
    </div>
    <div class="filtros">${pil("motivo", "", "Todos os motivos")}${Object.entries(BR_MOTIVO).map(([k, t]) => pil("motivo", k, t)).join("")}</div>
    <div class="kpis">
      <div class="kpi"><small>Registros</small><b>${n(ativos.length)}</b><span>${n(soma(brPecas))} peça(s)</span></div>
      <div class="kpi"><small>A preço de venda</small><b>${brl(soma(brVenda))}</b><span>o que valeriam na loja</span></div>
      ${dono() ? `<div class="kpi"><small>Custo das peças</small><b>${brl(soma(brCusto))}</b><span>${semCusto ? `${n(semCusto)} sem custo cadastrado` : "custo na data do registro"}</span></div>` : ""}
    </div>
    ${ativos.length ? `<div class="card"><h3 style="margin-top:0">Por motivo</h3><div class="tw"><table><thead><tr><th>Motivo</th><th class="num">Registros</th><th class="num">Peças</th><th class="num">A preço de venda</th>${dono() ? '<th class="num">Custo</th>' : ""}</tr></thead><tbody>
      ${Object.keys(BR_MOTIVO).filter(k => ativos.some(b => b.motivo === k)).map(k => { const l = ativos.filter(b => b.motivo === k);
        return `<tr><td>${BR_MOTIVO[k]}</td><td class="num">${n(l.length)}</td><td class="num">${n(l.reduce((s, b) => s + brPecas(b), 0))}</td><td class="num">${brl(l.reduce((s, b) => s + brVenda(b), 0))}</td>${dono() ? `<td class="num">${brl(l.reduce((s, b) => s + brCusto(b), 0))}</td>` : ""}</tr>`; }).join("")}
      </tbody></table></div></div>` : ""}
    <div class="acoes" style="justify-content:flex-start"><button type="button" class="bt" id="brcsv"${vis.length ? "" : " disabled"}>Baixar CSV</button></div>
    <div id="brlista">${vis.length ? vis.map(b => `<div class="card brcard" data-br="${b.id}">
        <div class="cab" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <h3 style="margin:0">Nº ${b.id} · ${esc(BR_MOTIVO[b.motivo] || b.motivo)} para ${esc(b.destinatario)}${b.cancelado_em ? ' <span class="tag fora">Cancelado</span>' : ""}</h3>
          <span class="mut">${n(brPecas(b))} peça(s) · ${brl(brVenda(b))}${dono() ? ` · custo ${brSemCusto(b) ? "sem custo em alguma peça" : brl(brCusto(b))}` : ""}</span></div>
        <div class="mut">${dataBR(b.data)} · saiu de ${esc(loja(b.loja_id).nome)} · registrado por ${esc(b.criado_nome || "—")} em ${quando(b.criado_em)}${b.cliente_id ? " · cliente do cadastro" : ""}${b.observacao ? " · " + esc(b.observacao) : ""}</div>
        ${b.cancelado_em ? `<div class="mut">Cancelado por ${esc(b.cancelado_nome || "—")} em ${quando(b.cancelado_em)} · ${esc(b.cancelamento_motivo || "")} (as peças voltaram)</div>` : ""}
        <ul style="margin:8px 0 0;padding-left:18px">${(b.itens || []).map(i => `<li>${i.quantidade}× ${brPeca(i)}</li>`).join("")}</ul>
        ${!b.cancelado_em && dono() ? `<div class="acoes" style="justify-content:flex-start;margin-top:10px"><button type="button" class="bt" data-brcan="${b.id}">Cancelar (registro errado)</button></div>` : ""}
      </div>`).join("") : '<div class="vazio">Nenhum brinde ou presente no período.</div>'}</div>`;
  $("brnovo").onclick = () => novoBrinde();
  $("brde").onchange = () => { FBR.de = $("brde").value; telaBrindes(); };
  $("brate").onchange = () => { FBR.ate = $("brate").value; telaBrindes(); };
  document.querySelectorAll("[data-fbr]").forEach(b => b.onclick = () => { FBR[b.dataset.fbr] = b.dataset.x; telaBrindes(); });
  document.querySelectorAll("[data-brcan]").forEach(b => b.onclick = () => cancelarBrinde(bs.find(x => x.id === +b.dataset.brcan)));
  $("brcsv").onclick = () => {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`, num = v => v == null ? "" : String(Number(v).toFixed(2)).replace(".", ",");
    const lin = [["Nº", "Data", "Loja", "Motivo", "Para quem", "Referência", "Peça", "Cor", "Tamanho", "Edição", "Quantidade", "Preço de venda", ...(dono() ? ["Custo unitário"] : []), "Observação", "Registrado por", "Cancelado"].map(q).join(";")];
    vis.forEach(b => (b.itens || []).forEach(i => lin.push([b.id, dataBR(b.data), loja(b.loja_id).nome, BR_MOTIVO[b.motivo], b.destinatario, i.referencia, i.descricao, i.cor, i.tamanho, i.edicao,
      i.quantidade, num(i.preco_venda), ...(dono() ? [num(i.custo_unitario)] : []), b.observacao, b.criado_nome, b.cancelado_em ? "sim: " + (b.cancelamento_motivo || "") : ""].map(q).join(";"))));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lin.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `brindes-linum-${FBR.de || "inicio"}-a-${FBR.ate || "hoje"}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}

// novo brinde; ini = {variante, loja} quando vem do quadrado do Estoque
async function novoBrinde(ini) {
  const f = $("dlgf");
  const B = { loja: (ini && ini.loja) || MINHA_LOJA || (LOJAS[0] || {}).id || "", motivo: "presente", dest: "", cliente: null, data: hoje(), obs: "", itens: [], q: "", qc: "" };
  const vmap = new Map();
  PRODUTOS.forEach(p => (p.variantes || []).forEach(v => vmap.set(v.id, { p, v })));
  if (ini && ini.variante && vmap.has(ini.variante)) B.itens.push({ variante: ini.variante, quantidade: 1 });
  if (!BR_CLI) {
    try { BR_CLI = (typeof CLIENTES !== "undefined" && CLIENTES.length) ? CLIENTES : await todas(() => sb.from("lin_clientes").select("id, nome, telefone").order("nome")); }
    catch (e) { BR_CLI = []; }
  }
  const rot = id => { const x = vmap.get(id); return x ? `${esc(x.p.descricao)} <span class="mut">(${esc(x.p.referencia || "")})</span> — ${esc(nomeVar(x.v))}` : "?"; };
  const resultados = () => {
    const t = semAc(B.q); if (t.length < 2) return [];
    const out = [];
    for (const p of PRODUTOS) {
      const casaP = semAc([p.referencia, p.descricao, p.codigo_barras].join(" ")).includes(t);
      for (const v of p.variantes || []) {
        if (qtd(v.id, B.loja) <= 0 || B.itens.some(i => i.variante === v.id)) continue;
        if (casaP || semAc([p.referencia, p.descricao, v.cor, v.tamanho, v.edicao, v.codigo_barras].join(" ")).includes(t)) out.push(v.id);
        if (out.length >= 40) return out;
      }
    }
    return out;
  };
  const clientes = () => {
    const t = semAc(B.qc).trim(), dig = B.qc.replace(/\D/g, "");
    if (t.length < 2) return [];
    return BR_CLI.filter(c => semAc(c.nome || "").includes(t) || (dig.length >= 4 && String(c.telefone || "").includes(dig))).slice(0, 12);
  };
  const guardar = () => {
    ["brdest:dest", "brdata:data", "brobs:obs", "brq:q", "brqc:qc"].forEach(x => { const [id, k] = x.split(":"); if ($(id)) B[k] = $(id).value; });
    f.querySelectorAll("[data-brq]").forEach(i => { const it = B.itens[+i.dataset.brq]; if (it) it.quantidade = i.value; });
  };
  const desenharRes = () => {
    const r = resultados();
    $("brres").className = r.length ? "cres" : "";
    $("brres").innerHTML = B.q.trim().length < 2 ? '<div class="mut" style="font-size:12px">Digite pelo menos 2 letras do nome, da referência ou o código de barras.</div>'
      : r.length ? r.map(id => `<button type="button" data-bradd="${id}">${rot(id)} · <b>${n(qtd(id, B.loja))} em ${esc(loja(B.loja).nome)}</b></button>`).join("")
      : `<div class="mut" style="font-size:12px">Nenhuma peça com estoque em ${esc(loja(B.loja).nome)} com esse texto.</div>`;
    $("brres").querySelectorAll("[data-bradd]").forEach(b => b.onclick = () => { guardar(); B.itens.push({ variante: b.dataset.bradd, quantidade: 1 }); B.q = ""; desenhar(); $("brq").focus(); });
  };
  const desenharCli = () => {
    if (!$("brcres")) return;
    const r = clientes();
    $("brcres").className = r.length ? "cres" : "";
    $("brcres").innerHTML = r.map(c => `<button type="button" data-brcli="${esc(c.id)}">${esc(c.nome)}${c.telefone ? ` <span class="mut">${esc(c.telefone)}</span>` : ""}</button>`).join("");
    $("brcres").querySelectorAll("[data-brcli]").forEach(b => b.onclick = () => { guardar(); B.cliente = BR_CLI.find(c => c.id === b.dataset.brcli); B.dest = B.cliente.nome; B.qc = ""; desenhar(); });
  };
  const desenhar = erro => {
    const bot = (g, val, r, on, t) => `<button type="button" class="pilula ${on ? "on" : ""}" data-brg="${g}" data-x="${esc(val)}"${t ? ` title="${esc(t)}"` : ""}>${esc(r)}</button>`;
    const tot = B.itens.reduce((s, i) => s + (Number(i.quantidade) || 0), 0);
    f.innerHTML = `<h3>Novo brinde / presente / divulgação</h3>
      <p class="mut" style="margin-top:0">As peças saem do estoque agora, sem venda.</p>
      <div class="campo"><label>Motivo</label><div class="opcoes">${Object.entries(BR_MOTIVO).map(([k, t]) => bot("motivo", k, t, B.motivo === k, BR_DICA[k])).join("")}</div>
        <div class="mut" style="font-size:12px">${esc(BR_DICA[B.motivo])}</div></div>
      <div class="campo"><label>Para quem</label>
        ${B.cliente ? `<div class="msg info" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span>Cliente do cadastro: <b>${esc(B.cliente.nome)}</b> (vai para o histórico dela)</span><button type="button" class="lnk" id="brclix">trocar</button></div>`
          : `<input id="brdest" maxlength="120" value="${esc(B.dest)}" placeholder="Nome de quem recebeu (ex.: @influenciadora, parceira, cliente)">
             <input id="brqc" type="search" autocomplete="off" style="margin-top:6px" value="${esc(B.qc)}" placeholder="…ou procure a cliente no cadastro (nome ou telefone)"><div id="brcres"></div>`}</div>
      <div class="campo"><label>Sai de (loja)</label><div class="opcoes">${LOJAS.map(l => bot("loja", l.id, l.nome, B.loja === l.id)).join("")}</div></div>
      <div class="campo"><label for="brq">Acrescentar peça</label><input id="brq" type="search" autocomplete="off" placeholder="Nome, referência ou código de barras" value="${esc(B.q)}"><div id="brres"></div></div>
      <div class="campo"><label>Peças</label>${B.itens.length ? `<div class="tw"><table><thead><tr><th>Peça</th><th class="num">Em ${esc(loja(B.loja).nome)}</th><th class="num">Quantidade</th><th></th></tr></thead><tbody>
        ${B.itens.map((it, k) => `<tr><td>${rot(it.variante)}</td><td class="num">${n(qtd(it.variante, B.loja))}</td>
          <td class="num"><input type="number" inputmode="numeric" min="1" max="${qtd(it.variante, B.loja)}" step="1" value="${esc(it.quantidade)}" data-brq="${k}" style="width:70px" aria-label="Quantidade"></td>
          <td><button type="button" class="lnk perigo" data-brdel="${k}">Tirar</button></td></tr>`).join("")}</tbody></table></div>
        <div class="mut" style="font-size:12px">${n(tot)} peça(s)</div>` : '<div class="mut">Nenhuma peça ainda: procure acima.</div>'}</div>
      <div class="campo duas"><div><label for="brdata">Data</label><input id="brdata" type="date" max="${hoje()}" value="${esc(B.data)}"></div>
        <div><label for="brobs">Observação${B.motivo === "outro" ? "" : " (opcional)"}</label><input id="brobs" maxlength="300" value="${esc(B.obs)}" placeholder="Ex.: aniversário; post no Instagram"></div></div>
      ${erro ? `<div class="msg err">${esc(erro)}</div>` : ""}
      <div class="acoes"><button type="button" class="bt" id="brx">Cancelar</button><button type="button" class="bt pri" id="brok">Registrar e tirar do estoque</button></div>`;
    f.querySelectorAll("[data-brg]").forEach(b => b.onclick = () => {
      guardar(); B[b.dataset.brg] = b.dataset.x;
      if (b.dataset.brg === "loja") B.itens = B.itens.filter(i => qtd(i.variante, B.loja) > 0);
      desenhar();
    });
    f.querySelectorAll("[data-brdel]").forEach(b => b.onclick = () => { guardar(); B.itens.splice(+b.dataset.brdel, 1); desenhar(); });
    if ($("brclix")) $("brclix").onclick = () => { B.cliente = null; B.dest = ""; desenhar(); };
    if ($("brqc")) $("brqc").oninput = () => { B.qc = $("brqc").value; desenharCli(); };
    $("brq").oninput = () => { B.q = $("brq").value; desenharRes(); };
    $("brq").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); const p = $("brres").querySelector("[data-bradd]"); if (p) p.click(); } };
    $("brx").onclick = () => $("dlg").close();
    $("brok").onclick = registrar;
    desenharRes(); desenharCli();
  };
  const registrar = async () => {
    guardar();
    const dest = B.cliente ? B.cliente.nome : B.dest.trim();
    if (dest.length < 2) return desenhar("Informe para quem foi a peça (ou escolha a cliente do cadastro).");
    if (B.motivo === "outro" && B.obs.trim().length < 3) return desenhar('Com o motivo "Outro", escreva na observação o que foi.');
    if (!B.itens.length) return desenhar("Escolha pelo menos uma peça.");
    if (!B.data || B.data > hoje()) return desenhar("Informe a data (até hoje).");
    for (const it of B.itens) {
      const q = Number(it.quantidade), tem = qtd(it.variante, B.loja);
      if (!Number.isInteger(q) || q < 1) return desenhar("Informe uma quantidade inteira maior que zero em cada peça.");
      if (q > tem) { const x = vmap.get(it.variante); return desenhar(`${x ? x.p.descricao + " " + nomeVar(x.v) : "A peça"}: ${loja(B.loja).nome} só tem ${tem}.`); }
    }
    const tot = B.itens.reduce((s, i) => s + Number(i.quantidade), 0);
    if (!confirm(`${BR_MOTIVO[B.motivo]} para ${dest}: ${tot} peça(s) saem agora do estoque de ${loja(B.loja).nome}, sem venda.\n\nConfirmar?`)) return;
    $("brok").disabled = true; $("brok").textContent = "Registrando…";
    try {
      const id = checar(await sb.rpc("lin_brinde_registrar", { p: { loja: B.loja, data: B.data, motivo: B.motivo, destinatario: dest,
        cliente_id: B.cliente ? B.cliente.id : null, observacao: B.obs.trim(),
        itens: B.itens.map(i => ({ variante_id: i.variante, quantidade: Number(i.quantidade) })) } }));
      $("dlg").close();
      await carregar();
      msg("ok", `${BR_MOTIVO[B.motivo]} nº ${id} registrado: ${tot} peça(s) saíram de ${loja(B.loja).nome}.`);
      if (VISTA === "brindes") telaBrindes(); else if (VISTA === "estoque") lista();
    } catch (e) { $("brok").disabled = false; desenhar(e.message); }
  };
  desenhar();
  if (!$("dlg").open) $("dlg").showModal();
}

function cancelarBrinde(b) {
  if (!b) return;
  const f = $("dlgf");
  const desenhar = erro => {
    f.innerHTML = `<h3>Cancelar o nº ${b.id} (${esc(BR_MOTIVO[b.motivo])} para ${esc(b.destinatario)})</h3>
      <p>Use só para registro errado. As ${n(brPecas(b))} peça(s) voltam para o estoque de ${esc(loja(b.loja_id).nome)}. O registro continua no histórico, marcado como cancelado.</p>
      <div class="campo"><label for="brcm">Motivo do cancelamento</label><input id="brcm" maxlength="300" placeholder="Ex.: registrado na loja errada"></div>
      ${erro ? `<div class="msg err">${esc(erro)}</div>` : ""}
      <div class="acoes"><button type="button" class="bt" id="brcx">Voltar</button><button type="button" class="bt pri" id="brcok">Cancelar o registro</button></div>`;
    $("brcx").onclick = () => $("dlg").close();
    $("brcok").onclick = async () => {
      const m = $("brcm").value.trim();
      if (m.length < 5) return desenhar("Escreva o motivo do cancelamento (pelo menos 5 letras).");
      $("brcok").disabled = true;
      try {
        checar(await sb.rpc("lin_brinde_cancelar", { p_id: b.id, p_motivo: m }));
        $("dlg").close(); await carregar(); msg("ok", `Nº ${b.id} cancelado: as peças voltaram para ${loja(b.loja_id).nome}.`); telaBrindes();
      } catch (e) { desenhar(e.message); }
    };
  };
  desenhar();
  $("dlg").showModal();
}
