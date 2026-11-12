// Sistema Linum 2.46 — MALINHA (condicional) e RESERVA (pedido do Marco em 10–11/11/2026).
// Malinha: peças vão para a casa da cliente, ela experimenta, compra umas e devolve o resto (ou compra/devolve tudo).
// Reserva: peças separadas para a cliente retirar depois. As duas tiram as peças do estoque na hora; na volta, peça por
// peça: "devolveu" volta ao estoque; "comprou" abre a Nova venda já preenchida (comissão de quem montou).
// Toda a equipe registra. Regras no banco: lin_condicional_criar / _devolver / _venda / _prazo e lin_cond_no_estoque.
// Usa as globais do index.html (sb, $, esc, checar, n, brl, LOJAS, loja, PRODUTOS, qtd, nomeVar, semAc, quando, dataBR,
// hoje, somaDias, dono, msg, todas, carregar, novaVenda, editarCliente, fone, MINHA_LOJA, EU...).

const CD_TIPO = { malinha: "Malinha", reserva: "Reserva" };
const CD_PRAZO = { malinha: 3, reserva: 7 };   // dias (padrão; dá para mudar)
const FCD = { sit: "aberta", tipo: "" };
let CD_ABERTAS = [];   // para o número na aba

async function carregarCond() {
  const r = await sb.from("lin_condicionais").select("id, prazo").eq("situacao", "aberta");
  CD_ABERTAS = r.error ? [] : r.data || [];
  const b = $("abaCond"); if (!b) return;
  const atr = CD_ABERTAS.filter(c => c.prazo < hoje()).length;
  b.innerHTML = "Malinhas e reservas" + (CD_ABERTAS.length ? ` <span class="badge"${atr ? ' title="' + atr + ' atrasada(s)"' : ""}>${CD_ABERTAS.length}</span>` : "");
}

const cdPeca = it => `${esc(it.descricao)}${it.referencia ? ` <span class="mut">(${esc(it.referencia)})</span>` : ""} — ${esc([it.cor || "—", it.tamanho, it.edicao].filter(Boolean).join(" "))}`;
const cdPend = it => it.quantidade - it.compradas - it.devolvidas;
const cdAtrasada = c => c.situacao === "aberta" && c.prazo < hoje();
const cdPrimeiro = nome => String(nome || "").trim().split(/\s+/)[0] || "";

async function cdLerClientes(ids) {
  if (!ids.length) return new Map();
  const l = await todas(() => sb.from("lin_clientes").select("id, nome, telefone").in("id", ids));
  return new Map(l.map(c => [c.id, c]));
}

async function telaCondicionais() {
  $("tela").innerHTML = '<div class="card">Carregando…</div>';
  let cs, its, bs, cli;
  try {
    const desde = new Date(Date.now() - 90 * 864e5).toISOString();
    cs = await todas(() => sb.from("lin_condicionais").select("*").or(`situacao.eq.aberta,criado_em.gte.${desde}`).order("id", { ascending: false }));
    const ids = cs.map(c => c.id);
    [its, bs, cli] = await Promise.all([
      ids.length ? todas(() => sb.from("lin_cond_itens").select("*").in("condicional_id", ids).order("id")) : [],
      ids.length ? todas(() => sb.from("lin_cond_baixas").select("*").in("condicional_id", ids).order("id")) : [],
      cdLerClientes([...new Set(cs.map(c => c.cliente_id))])]);
  } catch (e) { $("tela").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  const itensDe = id => its.filter(i => i.condicional_id === id);
  const fora = id => itensDe(id).reduce((s, i) => s + cdPend(i), 0);
  const abertas = cs.filter(c => c.situacao === "aberta");
  const concl = cs.filter(c => c.situacao === "concluida");
  const pecasConcl = concl.flatMap(c => itensDe(c.id));
  const comp = pecasConcl.reduce((s, i) => s + i.compradas, 0), tot = pecasConcl.reduce((s, i) => s + i.quantidade, 0);
  const vis = cs.filter(c => (!FCD.tipo || c.tipo === FCD.tipo) && (FCD.sit === "todas" || (FCD.sit === "atrasada" ? cdAtrasada(c) : c.situacao === FCD.sit)));
  const pil = (k, v, t) => `<button type="button" class="pilula ${FCD[k] === v ? "on" : ""}" data-fcd="${k}" data-x="${esc(v)}">${esc(t)}</button>`;
  const kpiTipo = t => { const l = abertas.filter(c => c.tipo === t); return `<div class="kpi"><small>${t === "malinha" ? "Malinhas com clientes" : "Reservas"}</small><b>${n(l.length)}</b><span>${n(l.reduce((s, c) => s + fora(c.id), 0))} peça(s) fora do estoque</span></div>`; };
  $("tela").innerHTML = `<div class="cabtela"><h2>Malinhas e reservas</h2><span class="acs"><button type="button" class="bt pri" id="cdmal">+ Malinha</button> <button type="button" class="bt pri" id="cdreserva">+ Reserva</button></span></div>
    <p class="mut" style="margin-top:0"><b>Malinha</b>: peças que vão para a casa da cliente experimentar. <b>Reserva</b>: peças separadas para a cliente retirar depois. As peças saem do estoque na hora; na volta, o que ela comprou vira venda e o resto volta ao estoque.</p>
    <div class="kpis">${kpiTipo("malinha")}${kpiTipo("reserva")}
      <div class="kpi"><small>Atrasadas</small><b style="${abertas.some(cdAtrasada) ? "color:var(--crit)" : ""}">${n(abertas.filter(cdAtrasada).length)}</b><span>passaram do prazo</span></div>
      <div class="kpi"><small>Viraram venda (90 dias)</small><b>${tot ? Math.round(comp / tot * 100) + "%" : "—"}</b><span>${n(comp)} de ${n(tot)} peça(s) das concluídas</span></div></div>
    <div class="filtros">${pil("sit", "aberta", "Com a cliente")}${pil("sit", "atrasada", "Atrasadas")}${pil("sit", "concluida", "Concluídas")}${pil("sit", "todas", "Todas (90 dias)")}</div>
    <div class="filtros">${pil("tipo", "", "Malinhas e reservas")}${pil("tipo", "malinha", "Só malinhas")}${pil("tipo", "reserva", "Só reservas")}</div>
    <div id="cdlista">${vis.length ? vis.map(c => { const cl = cli.get(c.cliente_id) || {}, l = itensDe(c.id), f = fora(c.id);
      return `<div class="card cdcard" data-cd="${c.id}"><div class="cab" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <h3 style="margin:0"><button type="button" class="lnk" data-cdficha="${c.id}">${CD_TIPO[c.tipo]} nº ${c.id}</button> · ${esc(cl.nome || "?")}
            ${c.situacao === "concluida" ? '<span class="tag ok">Concluída</span>' : cdAtrasada(c) ? '<span class="tag fora">Atrasada</span>' : '<span class="tag possivel">Com a cliente</span>'}</h3>
          <span class="mut">${c.situacao === "aberta" ? `${n(f)} peça(s) fora · ${c.tipo === "malinha" ? "devolver" : "retirar"} até <b>${dataBR(c.prazo)}</b>` : `concluída em ${quando(c.concluido_em)}`}</span></div>
        <div class="mut">${esc(loja(c.loja_id).nome)} · montada por ${esc(c.responsavel_nome || c.criado_nome || "—")} em ${quando(c.criado_em)}${c.observacao ? " · " + esc(c.observacao) : ""}</div>
        <ul style="margin:8px 0 0;padding-left:18px">${l.map(i => `<li>${i.quantidade}× ${cdPeca(i)}${i.compradas ? ` · <b style="color:var(--ok)">comprou ${i.compradas}</b>` : ""}${i.devolvidas ? ` · devolveu ${i.devolvidas}` : ""}</li>`).join("")}</ul>
        ${c.situacao === "aberta" ? `<div class="acoes" style="justify-content:flex-start;margin-top:10px">
          <button type="button" class="bt pri" data-cdvolta="${c.id}">Registrar volta</button>
          <button type="button" class="bt" data-cdtudo="comprou:${c.id}">${c.tipo === "malinha" ? "Comprou tudo" : "Retirou e comprou tudo"}</button>
          <button type="button" class="bt" data-cdtudo="devolveu:${c.id}">${c.tipo === "malinha" ? "Devolveu tudo" : "Desistiu de tudo"}</button>
          <button type="button" class="bt" data-cdficha="${c.id}">Ficha / imprimir</button></div>` : ""}
      </div>`; }).join("") : '<div class="vazio">Nenhuma malinha ou reserva aqui.</div>'}</div>`;
  $("cdmal").onclick = () => novaCondicional("malinha");
  $("cdreserva").onclick = () => novaCondicional("reserva");
  document.querySelectorAll("[data-fcd]").forEach(b => b.onclick = () => { FCD[b.dataset.fcd] = b.dataset.x; telaCondicionais(); });
  const pega = id => { const c = cs.find(x => x.id === +id); return [c, itensDe(c.id), bs.filter(b => b.condicional_id === c.id), cli.get(c.cliente_id) || {}]; };
  document.querySelectorAll("[data-cdficha]").forEach(b => b.onclick = () => fichaCondicional(...pega(b.dataset.cdficha)));
  document.querySelectorAll("[data-cdvolta]").forEach(b => b.onclick = () => voltaCondicional(...pega(b.dataset.cdvolta)));
  document.querySelectorAll("[data-cdtudo]").forEach(b => b.onclick = () => { const [modo, id] = b.dataset.cdtudo.split(":"); voltaCondicional(...pega(id), modo); });
  carregarCond().catch(() => {});
}

async function abrirCondicional(id) {
  const [c] = checar(await sb.from("lin_condicionais").select("*").eq("id", id));
  const its = await todas(() => sb.from("lin_cond_itens").select("*").eq("condicional_id", id).order("id"));
  const bs = await todas(() => sb.from("lin_cond_baixas").select("*").eq("condicional_id", id).order("id"));
  const cli = (await cdLerClientes([c.cliente_id])).get(c.cliente_id) || {};
  fichaCondicional(c, its, bs, cli);
}

// nova malinha / reserva; ini = {variante, loja} quando vem do quadrado do Estoque
async function novaCondicional(tipo, ini) {
  const f = $("dlgf");
  const C = { tipo, loja: (ini && ini.loja) || MINHA_LOJA || (LOJAS[0] || {}).id || "", cliente: null, qc: "", prazo: somaDias(hoje(), CD_PRAZO[tipo]), obs: "", itens: [], q: "" };
  const vmap = new Map();
  PRODUTOS.forEach(p => (p.variantes || []).forEach(v => vmap.set(v.id, { p, v })));
  if (ini && ini.variante && vmap.has(ini.variante)) C.itens.push({ variante: ini.variante, quantidade: 1 });
  let cliErro = "";
  try { if (!CLIENTES.length) await carregarClientes(); } catch (e) { cliErro = e.message || String(e); }
  try { await carregarVendedoras(); } catch (e) { /* só serve para o cadastro rápido */ }
  const rot = id => { const x = vmap.get(id); return x ? `${esc(x.p.descricao)} <span class="mut">(${esc(x.p.referencia || "")})</span> — ${esc(nomeVar(x.v))}` : "?"; };
  const preco = id => { const x = vmap.get(id); return x ? Number(x.v.preco_venda != null ? x.v.preco_venda : x.p.preco_venda) || 0 : 0; };
  const resultados = () => {
    const t = semAc(C.q); if (t.length < 2) return [];
    const out = [];
    for (const p of PRODUTOS) {
      const casaP = semAc([p.referencia, p.descricao, p.codigo_barras].join(" ")).includes(t);
      for (const v of p.variantes || []) {
        if (qtd(v.id, C.loja) <= 0 || C.itens.some(i => i.variante === v.id)) continue;
        if (casaP || semAc([p.referencia, p.descricao, v.cor, v.tamanho, v.edicao, v.codigo_barras].join(" ")).includes(t)) out.push(v.id);
        if (out.length >= 40) return out;
      }
    }
    return out;
  };
  const guardar = () => {
    ["cdq:q", "cdqc:qc", "cdprazo:prazo", "cdobs:obs"].forEach(x => { const [id, k] = x.split(":"); if ($(id)) C[k] = $(id).value; });
    f.querySelectorAll("[data-cdq]").forEach(i => { const it = C.itens[+i.dataset.cdq]; if (it) it.quantidade = i.value; });
  };
  const desenharRes = () => {
    const r = resultados();
    $("cdpres").className = r.length ? "cres" : "";
    $("cdpres").innerHTML = C.q.trim().length < 2 ? '<div class="mut" style="font-size:12px">Digite pelo menos 2 letras do nome, da referência ou o código de barras.</div>'
      : r.length ? r.map(id => `<button type="button" data-cdadd="${id}">${rot(id)} · <b>${n(qtd(id, C.loja))} em ${esc(loja(C.loja).nome)}</b></button>`).join("")
      : `<div class="mut" style="font-size:12px">Nenhuma peça com estoque em ${esc(loja(C.loja).nome)} com esse texto.</div>`;
    $("cdpres").querySelectorAll("[data-cdadd]").forEach(b => b.onclick = () => { guardar(); C.itens.push({ variante: b.dataset.cdadd, quantidade: 1 }); C.q = ""; desenhar(); $("cdq").focus(); });
  };
  // 2.47: a lista aparece já com o campo vazio (as clientes em ordem de nome) e o "+ Cadastrar cliente" fica sempre à mão;
  // antes só apareciam depois de 2 letras e parecia que a busca não funcionava (Marco, 12/11/2026)
  const desenharCli = () => {
    if (!$("cdcres")) return;
    const t = C.qc.trim(), tt = semAc(t);
    const l = !t ? CLIENTES.slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR")).slice(0, 8)
      : t.length < 2 ? CLIENTES.filter(x => semAc(x.nome).split(" ").some(w => w.startsWith(tt))).slice(0, 8) : buscarClientes(t, 8);
    $("cdcres").innerHTML = (cliErro ? `<div class="msg err">Não consegui carregar as clientes: ${esc(cliErro)}</div>` : "")
      + (!t && CLIENTES.length ? `<div class="mut" style="font-size:12px">${CLIENTES.length > l.length ? `Digite o nome ou o telefone para achar entre as ${n(CLIENTES.length)} clientes:` : "Clientes cadastradas:"}</div>` : "")
      + l.map(x => `<div class="vlin"><span><b>${esc(x.nome)}</b>${x.telefone ? " · " + esc(fone(x.telefone)) : ""}</span><button type="button" class="lnk" data-cdcli="${x.id}">Escolher</button></div>`).join("")
      + `<div class="vlin"><span class="mut">${!t ? (CLIENTES.length ? "É uma cliente nova?" : "Nenhuma cliente cadastrada ainda.") : l.length ? "Não é nenhuma dessas?" : "Cliente não encontrada."}</span><button type="button" class="lnk" id="cdcnovo">+ Cadastrar cliente</button></div>`;
    $("cdcres").querySelectorAll("[data-cdcli]").forEach(b => b.onclick = () => { guardar(); C.cliente = cliente(b.dataset.cdcli); C.qc = ""; desenhar(); });
    $("cdcnovo").onclick = () => { guardar(); editarCliente(clienteDigitado(t), novo => {
      if (novo && !CLIENTES.some(x => x.id === novo.id)) CLIENTES.push(novo);
      C.cliente = novo; C.qc = ""; desenhar(); if (!$("dlg").open) $("dlg").showModal(); }); };
  };
  const desenhar = erro => {
    const bot = (g, val, r, on) => `<button type="button" class="pilula ${on ? "on" : ""}" data-cdg="${g}" data-x="${esc(val)}">${esc(r)}</button>`;
    const tot = C.itens.reduce((s, i) => s + (Number(i.quantidade) || 0), 0), val = C.itens.reduce((s, i) => s + (Number(i.quantidade) || 0) * preco(i.variante), 0);
    f.innerHTML = `<h3>${C.tipo === "malinha" ? "Nova malinha (peças para a cliente experimentar em casa)" : "Nova reserva (peças separadas para a cliente retirar)"}</h3>
      <div class="campo"><div class="opcoes">${bot("tipo", "malinha", "Malinha", C.tipo === "malinha")}${bot("tipo", "reserva", "Reserva", C.tipo === "reserva")}</div></div>
      <div class="campo"><label>Cliente</label>
        ${C.cliente ? `<div class="vlin"><span><b>${esc(C.cliente.nome)}</b>${C.cliente.telefone ? " · " + esc(fone(C.cliente.telefone)) : ""}</span><button type="button" class="lnk" id="cdclix">Trocar</button></div>`
          : `<input id="cdqc" type="search" autocomplete="off" value="${esc(C.qc)}" placeholder="Nome e/ou telefone da cliente"><div id="cdcres"></div>`}</div>
      <div class="campo"><label>Sai de (loja)</label><div class="opcoes">${LOJAS.map(l => bot("loja", l.id, l.nome, C.loja === l.id)).join("")}</div></div>
      <div class="campo"><label for="cdq">Acrescentar peça</label><input id="cdq" type="search" autocomplete="off" placeholder="Nome, referência ou código de barras" value="${esc(C.q)}"><div id="cdpres"></div></div>
      <div class="campo"><label>Peças</label>${C.itens.length ? `<div class="tw"><table><thead><tr><th>Peça</th><th class="num">Em ${esc(loja(C.loja).nome)}</th><th class="num">Preço</th><th class="num">Quantidade</th><th></th></tr></thead><tbody>
        ${C.itens.map((it, k) => `<tr><td>${rot(it.variante)}</td><td class="num">${n(qtd(it.variante, C.loja))}</td><td class="num">${brl(preco(it.variante))}</td>
          <td class="num"><input type="number" inputmode="numeric" min="1" max="${qtd(it.variante, C.loja)}" step="1" value="${esc(it.quantidade)}" data-cdq="${k}" style="width:70px" aria-label="Quantidade"></td>
          <td><button type="button" class="lnk perigo" data-cddel="${k}">Tirar</button></td></tr>`).join("")}</tbody></table></div>
        <div class="mut" style="font-size:12px">${n(tot)} peça(s) · ${brl(val)} a preço de venda</div>` : '<div class="mut">Nenhuma peça ainda: procure acima.</div>'}</div>
      <div class="campo duas"><div><label for="cdprazo">${C.tipo === "malinha" ? "Devolver até" : "Retirar até"}</label><input id="cdprazo" type="date" min="${hoje()}" value="${esc(C.prazo)}"></div>
        <div><label for="cdobs">Observação (opcional)</label><input id="cdobs" maxlength="300" value="${esc(C.obs)}" placeholder="${C.tipo === "malinha" ? "Ex.: motoboy leva hoje à tarde" : "Ex.: vem buscar no sábado"}"></div></div>
      ${erro ? `<div class="msg err">${esc(erro)}</div>` : ""}
      <div class="acoes"><button type="button" class="bt" id="cdx">Cancelar</button><button type="button" class="bt pri" id="cdok">${C.tipo === "malinha" ? "Registrar malinha" : "Registrar reserva"}</button></div>`;
    f.querySelectorAll("[data-cdg]").forEach(b => b.onclick = () => {
      guardar(); const g = b.dataset.cdg;
      if (g === "tipo" && b.dataset.x !== C.tipo) { C.tipo = b.dataset.x; C.prazo = somaDias(hoje(), CD_PRAZO[C.tipo]); }
      else C[g] = b.dataset.x;
      if (g === "loja") C.itens = C.itens.filter(i => qtd(i.variante, C.loja) > 0);
      desenhar();
    });
    f.querySelectorAll("[data-cddel]").forEach(b => b.onclick = () => { guardar(); C.itens.splice(+b.dataset.cddel, 1); desenhar(); });
    if ($("cdclix")) $("cdclix").onclick = () => { guardar(); C.cliente = null; desenhar(); $("cdqc").focus(); };
    if ($("cdqc")) $("cdqc").oninput = () => { C.qc = $("cdqc").value; desenharCli(); };
    $("cdq").oninput = () => { C.q = $("cdq").value; desenharRes(); };
    $("cdq").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); const p = $("cdpres").querySelector("[data-cdadd]"); if (p) p.click(); } };
    $("cdx").onclick = () => $("dlg").close();
    $("cdok").onclick = registrar;
    desenharRes(); desenharCli();
  };
  const registrar = async () => {
    guardar();
    if (!C.cliente) return desenhar("Escolha a cliente (ou cadastre: nome e telefone bastam).");
    if (!C.itens.length) return desenhar("Escolha pelo menos uma peça.");
    if (!C.prazo || C.prazo < hoje()) return desenhar("O prazo não pode ser antes de hoje.");
    for (const it of C.itens) {
      const q = Number(it.quantidade), tem = qtd(it.variante, C.loja);
      if (!Number.isInteger(q) || q < 1) return desenhar("Informe uma quantidade inteira maior que zero em cada peça.");
      if (q > tem) { const x = vmap.get(it.variante); return desenhar(`${x ? x.p.descricao + " " + nomeVar(x.v) : "A peça"}: ${loja(C.loja).nome} só tem ${tem}.`); }
    }
    $("cdok").disabled = true; $("cdok").textContent = "Registrando…";
    try {
      const id = checar(await sb.rpc("lin_condicional_criar", { p: { tipo: C.tipo, loja: C.loja, cliente_id: C.cliente.id, prazo: C.prazo, observacao: C.obs.trim(),
        itens: C.itens.map(i => ({ variante_id: i.variante, quantidade: Number(i.quantidade) })) } }));
      await carregar();
      msg("ok", `${CD_TIPO[C.tipo]} nº ${id} registrada: as peças saíram do estoque de ${loja(C.loja).nome}.`);
      if (VISTA === "condicionais") telaCondicionais(); else if (VISTA === "estoque") lista();
      await abrirCondicional(id);   // ficha para imprimir e mandar junto
    } catch (e) { $("cdok").disabled = false; $("cdok").textContent = C.tipo === "malinha" ? "Registrar malinha" : "Registrar reserva"; desenhar(e.message); }
  };
  desenhar();
  if (!$("dlg").open) $("dlg").showModal();
}

// ficha: dados, peças, andamento, ações e Imprimir
function fichaCondicional(c, its, bs, cli) {
  const f = $("dlgf"), fora = its.reduce((s, i) => s + cdPend(i), 0);
  const andamento = [`<li><b>${quando(c.criado_em)}</b> · ${c.tipo === "malinha" ? "Malinha enviada" : "Reserva feita"} por ${esc(c.criado_nome || "—")} (${n(its.reduce((s, i) => s + i.quantidade, 0))} peça(s))</li>`]
    .concat(bs.map(b => { const i = its.find(x => x.id === b.item_id) || {};
      return `<li><b>${quando(b.criado_em)}</b> · ${b.resultado === "comprou" ? `<b style="color:var(--ok)">comprou</b> ${b.quantidade}× (venda nº ${b.venda_id})` : `devolveu ${b.quantidade}×`} ${esc(i.descricao || "")} ${esc([i.cor, i.tamanho].filter(Boolean).join(" "))} · ${esc(b.criado_nome || "—")}${b.observacao ? " · " + esc(b.observacao) : ""}</li>`; }))
    .concat(c.concluido_em ? [`<li><b>${quando(c.concluido_em)}</b> · Concluída</li>`] : []);
  f.innerHTML = `<h3>${CD_TIPO[c.tipo]} nº ${c.id} · ${esc(cli.nome || "?")}</h3>
    <div class="mut">${esc(loja(c.loja_id).nome)} · montada por ${esc(c.responsavel_nome || "—")} · ${c.situacao === "aberta" ? `${c.tipo === "malinha" ? "devolver" : "retirar"} até <b>${dataBR(c.prazo)}</b>${cdAtrasada(c) ? ' <span class="tag fora">Atrasada</span>' : ""}` : '<span class="tag ok">Concluída</span>'}${c.observacao ? " · " + esc(c.observacao) : ""}</div>
    <div class="tw" style="margin-top:10px"><table><thead><tr><th>Peça</th><th class="num">Preço</th><th class="num">Levou</th><th class="num">Comprou</th><th class="num">Devolveu</th><th class="num">Com a cliente</th></tr></thead><tbody>
      ${its.map(i => `<tr><td>${cdPeca(i)}</td><td class="num">${i.preco_venda != null ? brl(i.preco_venda) : "—"}</td><td class="num">${n(i.quantidade)}</td><td class="num">${n(i.compradas)}</td><td class="num">${n(i.devolvidas)}</td><td class="num"><b>${n(cdPend(i))}</b></td></tr>`).join("")}
    </tbody></table></div>
    <div class="caixa"><h4>Andamento</h4><ul class="ajlinha" style="margin:0;padding-left:18px">${andamento.join("")}</ul></div>
    ${c.situacao === "aberta" ? `<p class="mut">Próximo passo: quando a cliente ${c.tipo === "malinha" ? "devolver a malinha" : "vier retirar"}, clique em <b>Registrar volta</b> e diga peça por peça o que ela comprou e o que voltou. ${n(fora)} peça(s) ainda com a cliente.</p>` : ""}
    <div class="acoes" style="flex-wrap:wrap">
      ${c.situacao === "aberta" ? `<button type="button" class="bt pri" id="cdfvolta">Registrar volta</button><button type="button" class="bt" id="cdfprazo">Mudar prazo</button>${cli.telefone ? '<button type="button" class="bt" id="cdfzap">WhatsApp da cliente</button>' : ""}` : ""}
      <button type="button" class="bt" id="cdfimp">Imprimir / PDF</button><button type="button" class="bt" id="cdfx">Fechar</button></div>`;
  if ($("cdfvolta")) $("cdfvolta").onclick = () => voltaCondicional(c, its, bs, cli, null, true);
  if ($("cdfprazo")) $("cdfprazo").onclick = () => prazoCondicional(c, its, bs, cli);
  if ($("cdfzap")) $("cdfzap").onclick = () => {
    const txt = c.tipo === "malinha"
      ? `Olá, ${cdPrimeiro(cli.nome)}! Aqui é da Linum. Tudo bem com a malinha (${n(fora)} peça(s))? Combinamos a devolução até ${dataBR(c.prazo)}. Gostou de alguma? Qualquer coisa é só falar!`
      : `Olá, ${cdPrimeiro(cli.nome)}! Aqui é da Linum. Suas peças reservadas (${n(fora)}) estão separadas na loja ${loja(c.loja_id).nome} até ${dataBR(c.prazo)}. Te esperamos!`;
    window.open(`https://wa.me/55${cli.telefone}?text=${encodeURIComponent(txt)}`, "_blank", "noopener");
  };
  $("cdfimp").onclick = () => imprimirCondicional(c, its, cli);
  $("cdfx").onclick = () => $("dlg").close();
  if (!$("dlg").open) $("dlg").showModal();
}

function prazoCondicional(c, its, bs, cli) {
  const f = $("dlgf");
  const desenhar = erro => {
    f.innerHTML = `<h3>Mudar o prazo · ${CD_TIPO[c.tipo]} nº ${c.id}</h3>
      <div class="campo"><label for="cdnp">${c.tipo === "malinha" ? "Devolver até" : "Retirar até"}</label><input id="cdnp" type="date" min="${hoje()}" value="${esc(c.prazo < hoje() ? somaDias(hoje(), 2) : c.prazo)}"></div>
      ${erro ? `<div class="msg err">${esc(erro)}</div>` : ""}
      <div class="acoes"><button type="button" class="bt" id="cdnpx">Voltar</button><button type="button" class="bt pri" id="cdnpok">Salvar prazo</button></div>`;
    $("cdnpx").onclick = () => fichaCondicional(c, its, bs, cli);
    $("cdnpok").onclick = async () => {
      const d = $("cdnp").value; if (!d || d < hoje()) return desenhar("O prazo não pode ser antes de hoje.");
      try { checar(await sb.rpc("lin_condicional_prazo", { p_id: c.id, p_prazo: d })); c.prazo = d; await carregar();
        if (VISTA === "condicionais") telaCondicionais(); fichaCondicional(c, its, bs, cli); } catch (e) { desenhar(e.message); }
    };
  };
  desenhar();
}

// volta: peça por peça, quantas comprou e quantas devolveu. modo = "comprou" | "devolveu" preenche tudo de um lado.
function voltaCondicional(c, its, bs, cli, modo, daFicha) {
  const f = $("dlgf");
  const pend = its.filter(i => cdPend(i) > 0);
  const R = new Map(pend.map(i => [i.id, { comprou: modo === "comprou" ? cdPend(i) : 0, devolveu: modo === "devolveu" ? cdPend(i) : 0 }]));
  let obs = "";
  const guardar = () => {
    f.querySelectorAll("[data-cdv]").forEach(inp => { const [k, id] = inp.dataset.cdv.split(":"); R.get(+id)[k] = inp.value; });
    if ($("cdvobs")) obs = $("cdvobs").value;
  };
  const desenhar = erro => {
    f.innerHTML = `<h3>Volta da ${c.tipo === "malinha" ? "malinha" : "reserva"} nº ${c.id} · ${esc(cli.nome || "?")}</h3>
      <p class="mut" style="margin-top:0">Para cada peça, diga quantas a cliente <b>comprou</b> e quantas <b>voltaram</b> para a loja. O que ficar em branco continua com a cliente.</p>
      <div class="tw"><table><thead><tr><th>Peça</th><th class="num">Com a cliente</th><th class="num">Comprou</th><th class="num">Voltou</th></tr></thead><tbody>
        ${pend.map(i => `<tr><td>${cdPeca(i)}</td><td class="num">${n(cdPend(i))}</td>
          <td class="num"><input type="number" min="0" max="${cdPend(i)}" step="1" value="${esc(R.get(i.id).comprou)}" data-cdv="comprou:${i.id}" style="width:64px" aria-label="Comprou"></td>
          <td class="num"><input type="number" min="0" max="${cdPend(i)}" step="1" value="${esc(R.get(i.id).devolveu)}" data-cdv="devolveu:${i.id}" style="width:64px" aria-label="Voltou"></td></tr>`).join("")}
      </tbody></table></div>
      <div class="acoes" style="justify-content:flex-start"><button type="button" class="lnk" id="cdvtc">Comprou tudo</button><button type="button" class="lnk" id="cdvtd">Voltou tudo</button></div>
      <div class="campo"><label for="cdvobs">Observação da devolução (opcional)</label><input id="cdvobs" maxlength="300" value="${esc(obs)}" placeholder="Ex.: não serviu o tamanho; gostou mas vai pensar"></div>
      ${erro ? `<div class="msg err">${esc(erro)}</div>` : ""}
      <div class="acoes"><button type="button" class="bt" id="cdvx">${daFicha ? "Voltar" : "Cancelar"}</button><button type="button" class="bt pri" id="cdvok">Confirmar</button></div>`;
    $("cdvtc").onclick = () => { pend.forEach(i => { R.get(i.id).comprou = cdPend(i); R.get(i.id).devolveu = 0; }); desenharSem(); };
    $("cdvtd").onclick = () => { pend.forEach(i => { R.get(i.id).comprou = 0; R.get(i.id).devolveu = cdPend(i); }); desenharSem(); };
    $("cdvx").onclick = () => daFicha ? fichaCondicional(c, its, bs, cli) : $("dlg").close();
    $("cdvok").onclick = confirmar;
  };
  const desenharSem = () => { obs = $("cdvobs") ? $("cdvobs").value : obs; desenhar(); };
  const confirmar = async () => {
    guardar();
    const dev = [], comp = [];
    for (const i of pend) {
      const a = Number(R.get(i.id).comprou || 0), b = Number(R.get(i.id).devolveu || 0);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return desenhar("Use números inteiros (0 ou mais).");
      if (a + b > cdPend(i)) return desenhar(`${i.descricao} ${[i.cor, i.tamanho].filter(Boolean).join(" ")}: só ${cdPend(i)} peça(s) estão com a cliente.`);
      if (b) dev.push({ item_id: i.id, quantidade: b });
      if (a) comp.push({ item_id: i.id, vid: i.variante_id, q: a });
    }
    if (!dev.length && !comp.length) return desenhar("Diga quantas peças a cliente comprou ou quantas voltaram.");
    const nd = dev.reduce((s, x) => s + x.quantidade, 0), nc = comp.reduce((s, x) => s + x.q, 0);
    if (!confirm([nd ? `${nd} peça(s) voltam agora para o estoque de ${loja(c.loja_id).nome}.` : "", nc ? `${nc} peça(s) compradas: a seguir abre a venda já preenchida para registrar o pagamento.` : ""].filter(Boolean).join("\n") + "\n\nConfirmar?")) return;
    $("cdvok").disabled = true;
    try {
      if (nd) checar(await sb.rpc("lin_condicional_devolver", { p_id: c.id, p_itens: dev, p_obs: obs.trim() }));
      await carregar();
      if (nc) {
        if (!CLIENTES.length) await carregarClientes();
        await carregarVendedoras().catch(() => {});
        const cl = cliente(c.cliente_id) || { id: c.cliente_id, nome: cli.nome, telefone: cli.telefone };
        if (nd) msg("ok", `${nd} peça(s) voltaram ao estoque. Agora registre a venda das compradas.`);
        $("dlg").close();
        return novaVenda({ cliente: cl, condicional: { id: c.id, tipo: c.tipo, loja: c.loja_id, resp: c.responsavel_id, respNome: c.responsavel_nome, itens: comp.map(x => ({ item_id: x.item_id, vid: x.vid, q: x.q })) } });
      }
      $("dlg").close();
      msg("ok", `${nd} peça(s) voltaram ao estoque de ${loja(c.loja_id).nome}.`);
      if (VISTA === "condicionais") telaCondicionais(); else if (VISTA === "estoque") lista();
    } catch (e) { $("cdvok").disabled = false; desenhar(e.message); }
  };
  desenhar();
  if (!$("dlg").open) $("dlg").showModal();
}

// ficha impressa (vai junto com a sacola): peças, preços, prazo e assinatura da cliente
function imprimirCondicional(c, its, cli) {
  const w = window.open("", "_blank"); if (!w) return msg("err", "O navegador bloqueou a janela de impressão.");
  const total = its.reduce((s, i) => s + i.quantidade * Number(i.preco_venda || 0), 0);
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${CD_TIPO[c.tipo]} nº ${c.id} - LINUM</title>
    <style>@page{size:A4;margin:14mm}body{font:12px system-ui,Arial,sans-serif;color:#111}h1{font-size:18px;margin:0}table{width:100%;border-collapse:collapse;margin-top:10px}
    th,td{border:1px solid #999;padding:5px 6px;text-align:left}th{background:#eee}.n{text-align:right}.cab{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:6px}
    .ass{margin-top:40px;display:flex;gap:30px}.ass div{flex:1;border-top:1px solid #111;padding-top:4px;text-align:center}.mut{color:#555}</style></head><body>
    <div class="cab"><div><h1>LINUM · ${c.tipo === "malinha" ? "Malinha (condicional)" : "Reserva de peças"}</h1><div class="mut">Loja ${esc(loja(c.loja_id).nome)}</div></div>
      <div style="text-align:right"><b>Nº ${c.id}</b><br>${quando(c.criado_em)}</div></div>
    <p><b>Cliente:</b> ${esc(cli.nome || "")}${cli.telefone ? " · " + esc(fone(cli.telefone)) : ""}<br>
       <b>${c.tipo === "malinha" ? "Devolver até" : "Retirar até"}:</b> ${dataBR(c.prazo)} · <b>Atendida por:</b> ${esc(c.responsavel_nome || "")}${c.observacao ? "<br><b>Observação:</b> " + esc(c.observacao) : ""}</p>
    <table><thead><tr><th>Ref.</th><th>Peça</th><th>Cor / tamanho</th><th class="n">Qtd</th><th class="n">Preço</th><th class="n">Total</th><th>Comprou / Voltou</th></tr></thead><tbody>
      ${its.map(i => `<tr><td>${esc(i.referencia)}</td><td>${esc(i.descricao)}</td><td>${esc([i.cor, i.tamanho, i.edicao].filter(Boolean).join(" · "))}</td><td class="n">${i.quantidade}</td>
        <td class="n">${brl(i.preco_venda)}</td><td class="n">${brl(i.quantidade * Number(i.preco_venda || 0))}</td><td></td></tr>`).join("")}
      <tr><td colspan="5" class="n"><b>Total a preço de venda</b></td><td class="n"><b>${brl(total)}</b></td><td></td></tr></tbody></table>
    <p class="mut">${c.tipo === "malinha" ? "Recebi as peças acima para experimentar. As que eu não comprar serão devolvidas à loja até a data indicada, nas mesmas condições em que foram entregues." : "Peças separadas para a cliente na data acima; depois do prazo a reserva pode ser desfeita."}</p>
    <div class="ass"><div>${esc(cli.nome || "Cliente")}</div><div>LINUM · ${esc(c.responsavel_nome || "")}</div></div>
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}
