/* Mídia Indoor — créditos de dias de uso por TV (versão 2.5, pedido do Marco em 19/11/2026: vender o sistema por TV
   instalada, em créditos de dias; acabaram os dias + a tolerância do cliente, a TV pausa sozinha).
   Regras no banco (migração midia_creditos): mi_creditos_adicionar, mi_tela_isenta, mi_conta_tolerancia,
   mi_creditos_extrato, mi_tela_trocar_aparelho. A conta da tela abaixo repete a do banco só para mostrar a prévia.
   Usa os globais do index (sb, CONTA, TELAS, ADMIN, esc, tag, checar, carregar, render, msg, $). */

const CR_DIA = 864e5;
/** Hoje em Brasília, "AAAA-MM-DD". */
const crHoje = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const crSoma = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const crDif = (a, b) => Math.round((new Date(a + "T12:00:00Z") - new Date(b + "T12:00:00Z")) / CR_DIA);   // a − b em dias
const crData = d => d ? d.split("-").reverse().join("/") : "—";
const crTol = () => (CONTA && CONTA.tolerancia_dias != null ? CONTA.tolerancia_dias : 3);

/** Situação dos dias de uso da TV: {estado, dias, texto}
    estado: isenta | ok | acabando (≤ 7 dias) | tolerancia (acabou, ainda passando) | pausada | sem (nunca recebeu dias) */
function creditoDe(t) {
  if (t.isenta) return { estado: "isenta", dias: null, texto: "sem cobrança por dias" };
  const hoje = crHoje(), tol = crTol();
  if (!t.valida_ate) return { estado: "sem", dias: 0, texto: "sem dias de uso: a TV fica na tela de espera" };
  const dias = crDif(t.valida_ate, hoje) + 1;          // contando hoje
  if (dias > 7) return { estado: "ok", dias, texto: `${dias} dias · até ${crData(t.valida_ate)}` };
  if (dias >= 1) return { estado: "acabando", dias, texto: `${dias} dia${dias > 1 ? "s" : ""} · até ${crData(t.valida_ate)}` };
  const pausa = crSoma(t.valida_ate, tol + 1);
  if (hoje < pausa) return { estado: "tolerancia", dias: 0, texto: `dias acabaram em ${crData(t.valida_ate)} · pausa em ${crData(pausa)}` };
  return { estado: "pausada", dias: 0, texto: `pausada desde ${crData(pausa)}` };
}
const CR_TAG = { isenta: ["isenta", "t-mut"], ok: ["com dias", "t-ok"], acabando: ["acabando", "t-warn"], tolerancia: ["dias acabaram", "t-crit"],
  pausada: ["pausada", "t-crit"], sem: ["sem dias", "t-crit"] };

/** Coluna "Dias de uso" da tabela de TVs. */
function colCredito(t) {
  const c = creditoDe(t), [n, cls] = CR_TAG[c.estado];
  return `<td>${tag(n, cls)}<div class="mut">${esc(c.texto)}</div>${ADMIN ? `<button class="lnk" data-acao="porDias" data-id="${t.id}">pôr dias</button>` : ""}</td>`;
}

/** Aviso no alto da aba TVs. */
function avisoCreditos() {
  const l = TELAS.map(t => [t, creditoDe(t)]);
  const parada = l.filter(([, c]) => c.estado === "pausada" || c.estado === "sem"), fim = l.filter(([, c]) => c.estado === "tolerancia" || c.estado === "acabando");
  let h = "";
  if (parada.length) h += `<div class="aviso crit">${parada.map(([t]) => `<b>${esc(t.nome)}</b>`).join(", ")} ${parada.length > 1 ? "estão pausadas" : "está pausada"}, sem dias de uso: a TV mostra a tela de espera da Nervia. ${ADMIN ? "Use <b>Pôr dias</b>." : "Fale com a Nervia para liberar os dias."}</div>`;
  if (fim.length) h += `<div class="aviso warn">Dias de uso acabando: ${fim.map(([t, c]) => `<b>${esc(t.nome)}</b> (${esc(c.texto)})`).join(" · ")}. ${ADMIN ? "" : "Fale com a Nervia para renovar e a TV não parar."}</div>`;
  return h;
}

/** Botões no alto da tabela de TVs. */
function botoesCreditos() {
  return (ADMIN ? `<button class="bt" data-acao="porDias">Pôr dias</button> ` : "") + `<button class="bt" data-acao="extrato">Dias de uso: extrato</button> `;
}

// ---------------------------------------------------------------- pôr / tirar dias (equipe Nervia)
function dlgPorDias(marcada) {
  const tol = crTol(), hoje = crHoje();
  $("dlg").classList.add("largo");
  $("dlgf").innerHTML = `<h3>Pôr dias de uso</h3>
    <div class="mut">${esc(CONTA.nome)} · tolerância: ${tol} dia${tol === 1 ? "" : "s"} (depois que os dias acabam, a TV continua passando por esse tempo e então pausa sozinha). TV pausada recebe os dias contando de hoje; as outras continuam do último dia já pago.</div>
    <label>Dias</label>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><input id="pDias" inputmode="numeric" style="width:110px" value="30">
      ${[30, 90, 180, 365].map(n => `<button class="bt peq" type="button" data-pd="${n}">${n}</button>`).join("")}<span class="mut">negativo = tirar dias (com motivo)</span></div>
    <label>TVs</label>
    <div class="tw"><table><tr><th></th><th>TV</th><th>Hoje</th><th>Depois</th><th></th></tr>
    ${TELAS.map(t => `<tr><td><input type="checkbox" class="pTv" value="${t.id}" ${!marcada || marcada === t.id ? "checked" : ""}></td>
      <td><b>${esc(t.nome)}</b></td><td class="mut">${esc(creditoDe(t).texto)}</td><td id="pDep-${t.id}" class="mut"></td>
      <td><button class="lnk" type="button" data-isenta="${t.id}">${t.isenta ? "passar a cobrar" : "tornar isenta"}</button></td></tr>`).join("")}</table></div>
    <label>Valor recebido (opcional, só a equipe Nervia vê)</label><input id="pValor" data-moeda inputmode="decimal" placeholder="Ex.: 149,70" style="max-width:200px">
    <label>Observação</label><input id="pObs" maxlength="300" placeholder="Ex.: Pix de 19/11, 3 TVs × 30 dias">
    <div id="pErr"></div>
    <div class="fim"><button class="bt" value="x">Cancelar</button><button class="bt pri" type="button" id="pOk">Salvar</button></div>`;
  const prever = () => {
    if (!$("pDias")) { $("dlgf").oninput = $("dlgf").onchange = null; return; }   // o diálogo já mostra outra coisa
    const n = parseInt($("pDias").value, 10);
    TELAS.forEach(t => {
      const td = $("pDep-" + t.id), marc = $("dlgf").querySelector(`.pTv[value="${t.id}"]`).checked;
      if (!marc || !Number.isFinite(n) || n === 0) { td.textContent = ""; return; }
      let novo;
      if (n < 0) novo = t.valida_ate ? crSoma(t.valida_ate, n) : null;
      else novo = crSoma(!t.valida_ate || hoje > crSoma(t.valida_ate, tol) ? crSoma(hoje, -1) : t.valida_ate, n);
      td.textContent = novo ? `até ${crData(novo)}${t.isenta ? " (isenta: não usa os dias)" : ""}` : "sem dias para tirar";
    });
  };
  $("dlg").showModal(); prever();
  $("dlgf").oninput = prever; $("dlgf").onchange = prever;
  $("dlgf").querySelectorAll("[data-pd]").forEach(b => b.onclick = () => { $("pDias").value = b.dataset.pd; prever(); });
  $("dlgf").querySelectorAll("[data-isenta]").forEach(b => b.onclick = () => mudarIsenta(TELAS.find(t => t.id === b.dataset.isenta)));
  $("pOk").onclick = async () => {
    const erro = t => $("pErr").innerHTML = `<div class="msg err">${esc(t)}</div>`;
    try {
      const dias = $("pDias").value.trim(), telas = [...$("dlgf").querySelectorAll(".pTv:checked")].map(i => i.value);
      if (!/^-?\d{1,4}$/.test(dias) || Number(dias) === 0) return erro("Informe o número de dias (por exemplo, 30).");
      if (!telas.length) return erro("Marque pelo menos uma TV.");
      const valor = NERVIA_MOEDA.valor($("pValor").value, "Valor");
      $("pOk").disabled = true;
      const r = checar(await sb.rpc("mi_creditos_adicionar", { p: { telas, dias: Number(dias), valor: valor == null ? "" : valor.toFixed(2), obs: $("pObs").value } }));
      $("dlg").close(); $("dlg").classList.remove("largo"); await carregar(); render();
      msg("ok", `${Number(dias) > 0 ? "Dias postos" : "Dias tirados"} em ${r.telas} TV${r.telas > 1 ? "s" : ""}. A TV pausada volta a passar em até 1 minuto.`);
    } catch (e) { erro(e.message); $("pOk").disabled = false; }
  };
}

async function mudarIsenta(t) {
  const motivo = prompt(t.isenta
    ? `"${t.nome}" passa a ser cobrada por dias de uso. ${t.valida_ate ? "Dias pagos até " + crData(t.valida_ate) + "." : "Ela ainda não tem dias: fica pausada até você pôr os dias."}\n\nMotivo:`
    : `"${t.nome}" fica isenta: passa sem precisar de dias de uso (TV da Nervia, piloto, cortesia).\n\nMotivo:`);
  if (motivo == null) return;
  try {
    checar(await sb.rpc("mi_tela_isenta", { p_tela: t.id, p_isenta: !t.isenta, p_motivo: motivo }));
    $("dlg").close(); $("dlg").classList.remove("largo"); await carregar(); render(); msg("ok", `"${t.nome}" ${t.isenta ? "passou a ser cobrada" : "ficou isenta"}.`);
  } catch (e) { alert(e.message); }
}

// ---------------------------------------------------------------- extrato (cliente e equipe Nervia)
const CR_TIPO = { dias: "dias", isenta: "ficou isenta", cobrada: "passou a ser cobrada", aparelho: "aparelho trocado" };
async function dlgExtrato() {
  const l = checar(await sb.rpc("mi_creditos_extrato", { p_conta: CONTA.id }));
  // quem recebe o aviso por e-mail (2.6); se falhar, o extrato abre assim mesmo
  const dest = await sb.rpc("mi_avisos_destinos", { p_conta: CONTA.id }).then(r => r.error ? null : r.data || [], () => null);
  const brl = v => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  $("dlg").classList.add("largo");
  $("dlgf").innerHTML = `<h3>Dias de uso: extrato</h3><div class="mut">${esc(CONTA.nome)} · cada TV tem os seus dias; acabaram os dias, a TV continua passando por ${crTol()} dia(s) e depois pausa.</div>
    <div class="tw" style="max-height:60vh;overflow:auto;margin-top:8px"><table><tr><th>Quando</th><th>TV</th><th>O quê</th><th class="num">Dias</th><th>Válida até</th>${ADMIN ? '<th class="num">Valor</th><th>Quem</th>' : ""}<th>Observação</th></tr>
    ${l.map(e => `<tr><td>${dataHora(e.criado_em)}</td><td>${esc(e.tela_nome)}</td><td>${esc(CR_TIPO[e.tipo] || e.tipo)}</td>
      <td class="num">${e.tipo === "dias" ? (e.dias > 0 ? "+" : "") + e.dias : ""}</td><td>${e.tipo === "dias" ? `${crData(e.antes)} → <b>${crData(e.depois)}</b>` : crData(e.depois)}</td>
      ${ADMIN ? `<td class="num">${e.valor != null ? brl(e.valor) : ""}</td><td>${esc(e.user_nome)}</td>` : ""}<td>${esc(e.obs)}</td></tr>`).join("") ||
      `<tr><td colspan="8" class="mut">Nenhum registro ainda.</td></tr>`}</table></div>
    ${dest ? `<p class="mut" id="avDest"><b>Aviso por e-mail</b> 7, 3 e 1 dia antes de acabarem os dias de cada TV, quando acabam e quando a TV pausa: ${dest.length ? dest.map(esc).join(", ") : "ninguém (libere o app Mídia Indoor e a conta para um login)"}.</p>` : ""}
    <div class="fim"><button class="bt" value="x">Fechar</button></div>`;
  $("dlg").showModal();
  $("dlg").addEventListener("close", () => $("dlg").classList.remove("largo"), { once: true });
}

// ---------------------------------------------------------------- trocar o aparelho (mantém nome, playlist, posição e dias)
function dlgTrocarAparelho(t) {
  $("dlgf").innerHTML = `<h3>Trocar o aparelho de "${esc(t.nome)}"</h3>
    <div class="mut">Para quando o TV box ou a TV for substituído: a TV continua com o mesmo nome, playlist, posição e dias de uso. Instale o app no aparelho novo e digite aqui o código que ele mostra. O aparelho antigo volta para a tela do código.</div>
    <label>Código mostrado no aparelho novo</label><input id="tCod" class="codigo" maxlength="6" placeholder="------" autocomplete="off">
    <div id="tErr"></div>
    <div class="fim"><button class="bt" value="x">Cancelar</button><button class="bt pri" id="tOk" type="button">Trocar</button></div>`;
  $("dlg").showModal(); setTimeout(() => $("tCod").focus(), 30);
  $("tOk").onclick = async () => {
    const cod = $("tCod").value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(cod)) return $("tErr").innerHTML = '<div class="msg err">O código tem 6 letras ou números.</div>';
    $("tOk").disabled = true;
    try {
      checar(await sb.rpc("mi_tela_trocar_aparelho", { p_tela: t.id, p_codigo: cod }));
      $("dlg").close(); await carregar(); render(); msg("ok", `Aparelho de "${t.nome}" trocado. Em alguns segundos o novo começa a baixar as mídias.`);
    } catch (e) { $("tErr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; $("tOk").disabled = false; }
  };
}
