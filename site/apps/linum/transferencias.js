// Sistema Linum 2.33 — transferência entre lojas COM ACEITE (pedido do Marco em 05/11/2026).
// Envio: as peças saem da loja de origem na hora e ficam "em trânsito". Recebimento: quem está na outra loja confere
// peça por peça e confirma; só então as peças entram no estoque de lá. Toda a equipe (Dono, Estoque, Vendedora) envia e
// recebe; cancelar (as peças voltam) = quem enviou, o Dono ou o Estoque. Regras no banco: lin_transferencia_*.
// Usa as globais do index.html (sb, $, esc, checar, n, LOJAS, loja, PRODUTOS, qtd, nomeVar, semAc, quando, todas, msg...).

let TRANSITO = [];   // transferências em trânsito (para o aviso no Estoque e o número na aba)
const TR_SIT = { em_transito: "Em trânsito", recebida: "Recebida", recebida_com_falta: "Recebida com falta", cancelada: "Cancelada" };
const FTR = { sit: "em_transito" };

async function carregarTransito() {
  const r = await sb.from("lin_transferencias").select("id, origem_id, destino_id").eq("situacao", "em_transito");
  TRANSITO = r.error ? [] : r.data || [];   // sem a tabela (antes da migração) a tela segue sem transferências
  const b = $("abaTransf");
  if (b) b.innerHTML = "Transferências" + (TRANSITO.length ? ` <span class="badge">${TRANSITO.length}</span>` : "");
  const g = $("grp_estoque");
  if (g) g.innerHTML = "Estoque" + (TRANSITO.length ? ` <span class="badge">${TRANSITO.length}</span>` : "");
}

// aviso no alto do Estoque
function avisoTransito() {
  if (!TRANSITO.length) return "";
  const minha = MINHA_LOJA && TRANSITO.filter(t => t.destino_id === MINHA_LOJA).length;
  return `<div class="msg info" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span><b>${n(TRANSITO.length)} transferência(s) em trânsito</b>${minha ? ` · ${n(minha)} para ${esc(loja(MINHA_LOJA).nome)}` : ""}. As peças só entram na loja de destino depois de conferidas e recebidas.</span>
    <button type="button" class="bt" id="irTransf">Ver transferências</button></div>`;
}

const trPeca = it => `${esc(it.descricao)}${it.referencia ? ` <span class="mut">(${esc(it.referencia)})</span>` : ""} — ${esc([it.cor || "—", it.tamanho, it.edicao].filter(Boolean).join(" "))}`;

async function telaTransferencias() {
  $("tela").innerHTML = '<div class="card">Carregando…</div>';
  let ts, its;
  try {
    const desde = new Date(Date.now() - 90 * 864e5).toISOString();
    ts = await todas(() => sb.from("lin_transferencias").select("*").or(`situacao.eq.em_transito,enviado_em.gte.${desde}`).order("id", { ascending: false }));
    const ids = ts.map(t => t.id);
    its = ids.length ? await todas(() => sb.from("lin_transferencia_itens").select("*").in("transferencia_id", ids).order("id")) : [];
  } catch (e) { $("tela").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  const itensDe = id => its.filter(i => i.transferencia_id === id);
  const pecas = (id, campo) => itensDe(id).reduce((s, i) => s + Number(i[campo] ?? 0), 0);
  TRANSITO = ts.filter(t => t.situacao === "em_transito").map(t => ({ id: t.id, origem_id: t.origem_id, destino_id: t.destino_id }));
  carregarTransito().catch(() => {});
  const transito = ts.filter(t => t.situacao === "em_transito");
  const vis = FTR.sit === "todas" ? ts : ts.filter(t => t.situacao === FTR.sit);
  const pil = (k, t) => `<button type="button" class="pilula ${FTR.sit === k ? "on" : ""}" data-ftr="${k}">${t}</button>`;
  const podeCancelar = t => controla() || t.enviado_por === EU;
  $("tela").innerHTML = `<div class="cabtela"><h2>Transferências entre lojas</h2><button type="button" class="bt pri" id="trnova">+ Nova transferência</button></div>
    <p class="mut" style="margin-top:0">As peças saem da loja de origem no envio e ficam <b>em trânsito</b>. Só entram na loja de destino quando alguém de lá <b>confere e confirma o recebimento</b>.</p>
    <div class="kpis">
      <div class="kpi"><small>Em trânsito</small><b>${n(transito.length)}</b><span>${n(transito.reduce((s, t) => s + pecas(t.id, "quantidade"), 0))} peça(s) a receber</span></div>
      ${LOJAS.map(l => { const q = transito.filter(t => t.destino_id === l.id); return `<div class="kpi"><small>A receber em ${esc(l.nome)}</small><b>${n(q.length)}</b><span>${n(q.reduce((s, t) => s + pecas(t.id, "quantidade"), 0))} peça(s)</span></div>`; }).join("")}
    </div>
    <div class="filtros">${pil("em_transito", "Em trânsito")}${pil("recebida", "Recebidas")}${pil("recebida_com_falta", "Com falta")}${pil("cancelada", "Canceladas")}${pil("todas", "Todas (90 dias)")}</div>
    <div id="trlista">${vis.length ? vis.map(t => { const l = itensDe(t.id), tot = pecas(t.id, "quantidade");
      return `<div class="card trcard" data-tr="${t.id}"><div class="cab" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <h3 style="margin:0">Nº ${t.id} · ${esc(loja(t.origem_id).nome)} → ${esc(loja(t.destino_id).nome)} <span class="tag ${t.situacao === "recebida" ? "ok" : t.situacao === "em_transito" ? "possivel" : "fora"}">${TR_SIT[t.situacao]}</span></h3>
          <span class="mut">${n(tot)} peça(s)</span></div>
        <div class="mut">Enviada por ${esc(t.enviado_nome || "—")} em ${quando(t.enviado_em)}${t.observacao ? " · " + esc(t.observacao) : ""}</div>
        ${t.recebido_em ? `<div class="mut">Recebida por ${esc(t.recebido_nome || "—")} em ${quando(t.recebido_em)}${t.situacao === "recebida_com_falta" ? ` · <b style="color:var(--crit)">faltaram ${n(tot - pecas(t.id, "recebida"))}</b>` : ""}${t.recebimento_obs ? " · " + esc(t.recebimento_obs) : ""}</div>` : ""}
        ${t.cancelado_em ? `<div class="mut">Cancelada por ${esc(t.cancelado_nome || "—")} em ${quando(t.cancelado_em)} · ${esc(t.cancelamento_motivo || "")}</div>` : ""}
        <ul style="margin:8px 0 0;padding-left:18px">${l.map(i => `<li>${i.quantidade}× ${trPeca(i)}${i.recebida != null && i.recebida < i.quantidade ? ` · <b style="color:var(--crit)">chegaram ${i.recebida}</b>` : ""}</li>`).join("")}</ul>
        ${t.situacao === "em_transito" ? `<div class="acoes" style="justify-content:flex-start;margin-top:10px">
          <button type="button" class="bt pri" data-trrec="${t.id}">Conferir e receber em ${esc(loja(t.destino_id).nome)}</button>
          ${podeCancelar(t) ? `<button type="button" class="bt" data-trcan="${t.id}">Cancelar (voltam para ${esc(loja(t.origem_id).nome)})</button>` : ""}</div>` : ""}
      </div>`; }).join("") : `<div class="vazio">${FTR.sit === "em_transito" ? "Nenhuma transferência em trânsito." : "Nenhuma transferência aqui."}</div>`}</div>`;
  $("trnova").onclick = () => novaTransferencia();
  document.querySelectorAll("[data-ftr]").forEach(b => b.onclick = () => { FTR.sit = b.dataset.ftr; telaTransferencias(); });
  document.querySelectorAll("[data-trrec]").forEach(b => b.onclick = () => { const t = ts.find(x => x.id === +b.dataset.trrec); receberTransferencia(t, itensDe(t.id)); });
  document.querySelectorAll("[data-trcan]").forEach(b => b.onclick = () => cancelarTransferencia(ts.find(x => x.id === +b.dataset.trcan)));
}

// nova transferência; ini = {variante, loja} quando vem do quadrado do Estoque
function novaTransferencia(ini) {
  const f = $("dlgf");
  const origem0 = (ini && ini.loja) || MINHA_LOJA || (LOJAS[0] || {}).id || "";
  const T = { origem: origem0, destino: (LOJAS.find(l => l.id !== origem0) || {}).id || "", obs: "", itens: [], q: "" };
  const vmap = new Map();
  PRODUTOS.forEach(p => (p.variantes || []).forEach(v => vmap.set(v.id, { p, v })));
  if (ini && ini.variante && vmap.has(ini.variante)) T.itens.push({ variante: ini.variante, quantidade: 1 });
  const rot = id => { const x = vmap.get(id); return x ? `${esc(x.p.descricao)} <span class="mut">(${esc(x.p.referencia || "")})</span> — ${esc(nomeVar(x.v))}` : "?"; };
  const resultados = () => {
    const t = semAc(T.q); if (t.length < 2) return [];
    const out = [];
    for (const p of PRODUTOS) {
      const casaP = semAc([p.referencia, p.descricao, p.codigo_barras].join(" ")).includes(t);
      for (const v of p.variantes || []) {
        if (qtd(v.id, T.origem) <= 0 || T.itens.some(i => i.variante === v.id)) continue;
        if (casaP || semAc([p.referencia, p.descricao, v.cor, v.tamanho, v.edicao, v.codigo_barras].join(" ")).includes(t)) out.push(v.id);
        if (out.length >= 40) return out;
      }
    }
    return out;
  };
  const guardar = () => {
    if ($("tro")) T.obs = $("tro").value;
    if ($("trq")) T.q = $("trq").value;
    f.querySelectorAll("[data-trq]").forEach(i => { const it = T.itens[+i.dataset.trq]; if (it) it.quantidade = i.value; });
  };
  const desenharRes = () => {
    const r = resultados();
    $("trres").className = r.length ? "cres" : "";
    $("trres").innerHTML = T.q.trim().length < 2 ? '<div class="mut" style="font-size:12px">Digite pelo menos 2 letras do nome, da referência ou o código de barras.</div>'
      : r.length ? r.map(id => `<button type="button" data-tradd="${id}">${rot(id)} · <b>${n(qtd(id, T.origem))} em ${esc(loja(T.origem).nome)}</b></button>`).join("")
      : `<div class="mut" style="font-size:12px">Nenhuma peça com estoque em ${esc(loja(T.origem).nome)} com esse texto.</div>`;
    $("trres").querySelectorAll("[data-tradd]").forEach(b => b.onclick = () => { guardar(); T.itens.push({ variante: b.dataset.tradd, quantidade: 1 }); T.q = ""; desenhar(); $("trq").focus(); });
  };
  const desenhar = erro => {
    const bot = (g, val, r, on) => `<button type="button" class="pilula ${on ? "on" : ""}" data-trg="${g}" data-x="${esc(val)}">${esc(r)}</button>`;
    f.innerHTML = `<h3>Nova transferência</h3>
      <div class="campo"><label>Sai de (loja de origem)</label><div class="opcoes">${LOJAS.map(l => bot("origem", l.id, l.nome, T.origem === l.id)).join("")}</div></div>
      <div class="campo"><label>Vai para (loja de destino)</label><div class="opcoes">${LOJAS.filter(l => l.id !== T.origem).map(l => bot("destino", l.id, l.nome, T.destino === l.id)).join("")}</div></div>
      <div class="campo"><label for="trq">Acrescentar peça</label><input id="trq" type="search" autocomplete="off" placeholder="Nome, referência ou código de barras" value="${esc(T.q)}"><div id="trres"></div></div>
      <div class="campo"><label>Peças da transferência</label>${T.itens.length ? `<div class="tw"><table><thead><tr><th>Peça</th><th class="num">Em ${esc(loja(T.origem).nome)}</th><th class="num">Enviar</th><th></th></tr></thead><tbody>
        ${T.itens.map((it, k) => `<tr><td>${rot(it.variante)}</td><td class="num">${n(qtd(it.variante, T.origem))}</td>
          <td class="num"><input type="number" inputmode="numeric" min="1" max="${qtd(it.variante, T.origem)}" step="1" value="${esc(it.quantidade)}" data-trq="${k}" style="width:70px" aria-label="Quantidade"></td>
          <td><button type="button" class="lnk perigo" data-trdel="${k}">Tirar</button></td></tr>`).join("")}</tbody></table></div>
        <div class="mut" style="font-size:12px">${n(T.itens.reduce((s, i) => s + (Number(i.quantidade) || 0), 0))} peça(s)</div>` : '<div class="mut">Nenhuma peça ainda: procure acima.</div>'}</div>
      <div class="campo"><label for="tro">Observação (opcional)</label><input id="tro" maxlength="300" value="${esc(T.obs)}" placeholder="Ex.: cliente vai buscar na outra loja; reposição da vitrine"></div>
      ${erro ? `<div class="msg err">${esc(erro)}</div>` : ""}
      <div class="acoes"><button type="button" class="bt" id="trx">Cancelar</button><button type="button" class="bt pri" id="trok">Enviar peças</button></div>`;
    f.querySelectorAll("[data-trg]").forEach(b => b.onclick = () => {
      guardar(); T[b.dataset.trg] = b.dataset.x;
      if (b.dataset.trg === "origem") { if (T.destino === T.origem) T.destino = (LOJAS.find(l => l.id !== T.origem) || {}).id || ""; T.itens = T.itens.filter(i => qtd(i.variante, T.origem) > 0); }
      desenhar();
    });
    f.querySelectorAll("[data-trdel]").forEach(b => b.onclick = () => { guardar(); T.itens.splice(+b.dataset.trdel, 1); desenhar(); });
    $("trq").oninput = () => { T.q = $("trq").value; desenharRes(); };
    $("trq").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); const p = $("trres").querySelector("[data-tradd]"); if (p) p.click(); } };
    $("trx").onclick = () => $("dlg").close();
    $("trok").onclick = enviar;
    desenharRes();
  };
  const enviar = async () => {
    guardar();
    if (!T.itens.length) return desenhar("Escolha pelo menos uma peça.");
    for (const it of T.itens) {
      const q = Number(it.quantidade), tem = qtd(it.variante, T.origem);
      if (!Number.isInteger(q) || q < 1) return desenhar("Informe uma quantidade inteira maior que zero em cada peça.");
      if (q > tem) { const x = vmap.get(it.variante); return desenhar(`${x ? x.p.descricao + " " + nomeVar(x.v) : "A peça"}: ${loja(T.origem).nome} só tem ${tem}.`); }
    }
    const tot = T.itens.reduce((s, i) => s + Number(i.quantidade), 0);
    if (!confirm(`Enviar ${tot} peça(s) de ${loja(T.origem).nome} para ${loja(T.destino).nome}?\n\nAs peças saem agora do estoque de ${loja(T.origem).nome} e só entram em ${loja(T.destino).nome} quando alguém de lá conferir e receber.`)) return;
    $("trok").disabled = true; $("trok").textContent = "Enviando…";
    try {
      const id = checar(await sb.rpc("lin_transferencia_enviar", { p: { origem: T.origem, destino: T.destino, observacao: T.obs.trim(),
        itens: T.itens.map(i => ({ variante_id: i.variante, quantidade: Number(i.quantidade) })) } }));
      $("dlg").close();
      await carregar(); await carregarTransito();
      FTR.sit = "em_transito";
      if (VISTA === "transferencias") telaTransferencias(); else render();
      msg("ok", `Transferência nº ${id} enviada: ${tot} peça(s) em trânsito para ${loja(T.destino).nome}.`);
    } catch (e) { desenhar(e.message); }
  };
  desenhar();
  $("dlg").showModal();
  $("trq").focus();
}

// conferência: cada peça marcada como "chegou"; o que faltar exige a quantidade que chegou e o motivo
function receberTransferencia(t, its) {
  const f = $("dlgf");
  const R = its.map(i => ({ id: i.id, ok: false, recebida: String(i.quantidade) })), O = { obs: "" };
  const guardar = () => {
    f.querySelectorAll("[data-rok]").forEach(c => { R[+c.dataset.rok].ok = c.checked; });
    f.querySelectorAll("[data-rq]").forEach(i => { R[+i.dataset.rq].recebida = i.value; });
    if ($("rob")) O.obs = $("rob").value;
  };
  const desenhar = erro => {
    const falta = R.some((r, k) => !r.ok && Number(r.recebida) < its[k].quantidade);
    const todos = R.every(r => r.ok);
    f.innerHTML = `<h3>Receber transferência nº ${t.id}</h3>
      <div class="mut">${esc(loja(t.origem_id).nome)} → <b>${esc(loja(t.destino_id).nome)}</b> · enviada por ${esc(t.enviado_nome || "—")} em ${quando(t.enviado_em)}${t.observacao ? " · " + esc(t.observacao) : ""}</div>
      <p>Confira cada peça que chegou e marque <b>Chegou</b>. Se alguma não veio, desmarque e informe quantas chegaram.</p>
      <div class="tw"><table><thead><tr><th>Peça</th><th class="num">Enviadas</th><th>Chegou?</th><th class="num">Chegaram</th></tr></thead><tbody>
      ${its.map((i, k) => `<tr><td>${trPeca(i)}</td><td class="num"><b>${i.quantidade}</b></td>
        <td><label class="chk"><input type="checkbox" data-rok="${k}" ${R[k].ok ? "checked" : ""}> Chegou</label></td>
        <td class="num">${R[k].ok ? `<b>${i.quantidade}</b>` : `<input type="number" inputmode="numeric" min="0" max="${i.quantidade}" step="1" value="${esc(R[k].recebida)}" data-rq="${k}" style="width:70px" aria-label="Quantas chegaram">`}</td></tr>`).join("")}
      </tbody></table></div>
      <button type="button" class="bt" id="rtodas" style="margin-top:8px">Marcar todas como conferidas</button>
      ${falta ? `<div class="campo"><label for="rob">O que aconteceu com as peças que faltaram? (obrigatório)</label><input id="rob" maxlength="500" value="${esc(O.obs)}" placeholder="Ex.: uma peça não veio na sacola; vou falar com quem enviou"></div>
        <div class="msg info">Só as peças que chegaram entram no estoque de ${esc(loja(t.destino_id).nome)}. A falta fica registrada para o Dono resolver.</div>` : ""}
      ${erro ? `<div class="msg err">${esc(erro)}</div>` : ""}
      <div class="acoes"><button type="button" class="bt" id="rx">Voltar</button>
        <button type="button" class="bt pri" id="rok">${todos ? "Recebi todas as peças" : falta ? "Registrar recebimento com falta" : "Confirmar recebimento"}</button></div>`;
    f.querySelectorAll("[data-rok]").forEach(c => c.onchange = () => { guardar(); desenhar(); });
    const temFalta = () => R.some((r, k) => !r.ok && Number(r.recebida) < its[k].quantidade);
    f.querySelectorAll("[data-rq]").forEach(i => i.oninput = () => {
      const antes = temFalta(); guardar();
      if (antes !== temFalta()) { desenhar(); const el = f.querySelector(`[data-rq="${i.dataset.rq}"]`); if (el) el.focus(); }
    });
    $("rtodas").onclick = () => { R.forEach(r => { r.ok = true; }); desenhar(); };
    $("rx").onclick = () => $("dlg").close();
    $("rok").onclick = receber;
  };
  const receber = async () => {
    guardar();
    const itens = R.map((r, k) => ({ id: r.id, recebida: r.ok ? its[k].quantidade : Number(r.recebida) }));
    if (itens.some((x, k) => !Number.isInteger(x.recebida) || x.recebida < 0 || x.recebida > its[k].quantidade)) return desenhar("Informe quantas chegaram (de 0 até o que foi enviado).");
    const falta = itens.reduce((s, x, k) => s + its[k].quantidade - x.recebida, 0);
    if (falta && O.obs.trim().length < 5) return desenhar(`Faltaram ${falta} peça(s): escreva o que aconteceu.`);
    if (falta && !confirm(`Faltaram ${falta} peça(s). Só as que chegaram vão entrar no estoque de ${loja(t.destino_id).nome}. Confirmar?`)) return;
    $("rok").disabled = true; $("rok").textContent = "Salvando…";
    try {
      checar(await sb.rpc("lin_transferencia_receber", { p_id: t.id, p_itens: itens, p_obs: O.obs.trim() }));
      $("dlg").close();
      await carregar(); await carregarTransito();
      telaTransferencias();
      msg("ok", falta ? `Transferência nº ${t.id} recebida com falta de ${falta} peça(s). As que chegaram já estão no estoque de ${loja(t.destino_id).nome}.`
        : `Transferência nº ${t.id} recebida: todas as peças já estão no estoque de ${loja(t.destino_id).nome}.`);
    } catch (e) { desenhar(e.message); }
  };
  desenhar();
  $("dlg").showModal();
}

async function cancelarTransferencia(t) {
  const m = prompt(`Cancelar a transferência nº ${t.id}? As peças voltam para o estoque de ${loja(t.origem_id).nome}.\n\nMotivo:`);
  if (m === null) return;
  try {
    checar(await sb.rpc("lin_transferencia_cancelar", { p_id: t.id, p_motivo: m.trim() }));
    await carregar(); await carregarTransito();
    telaTransferencias();
    msg("ok", `Transferência nº ${t.id} cancelada: as peças voltaram para ${loja(t.origem_id).nome}.`);
  } catch (e) { msg("err", e.message); }
}
