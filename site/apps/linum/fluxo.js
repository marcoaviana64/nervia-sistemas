// Sistema Linum 2.53 — FLUXO DA LOJA (pedido do Marco em 14/11/2026: "criar registro de fluxo da loja nas visitas";
// hoje a loja anota num papel quem entrou, o que olhou, como chegou e se volta).
// O registro é a mesma "visita" da 1.9 (lin_visitas), agora com anotação livre, como chegou, gostou, vai voltar e
// contato opcional (vira possível cliente no CRM). Aba própria com o painel do fluxo.
// Regras no banco: lin_visita_registrar. Leitura: cada um vê as próprias visitas, o Dono vê todas.
// Usa as globais do index.html (sb, $, esc, checar, n, LOJAS, loja, PRODUTOS, nomeVar, semAc, quando, dataBR, hoje,
// somaDias, dono, msg, todas, CLIENTES, carregarClientes, fichaCliente, MOTIVOS, pecaTxt, MINHA_LOJA, telaVendas, VISTA...).

const FX_COMO = { vitrine: "Vitrine", panfleto: "Panfleto", por_perto: "Estava por perto", instagram: "Instagram", indicacao: "Indicação",
  ja_cliente: "Já é cliente", passando: "Passando na rua", outro: "Outro" };
const FX_GOSTOU = { muito: "Gostou muito", gostou: "Gostou", so_olhou: "Só olhou" };
const FX_VOLTA = { sim: "Vai voltar", talvez: "Talvez volte", nao: "Não volta" };
const FX_MOTIVOS = { tamanho: "Faltou tamanho", cor: "Faltou cor", preco: "Preço", so_olhando: "Só olhando", outro: "Outro" };   // "vai voltar" virou campo próprio
const FFX = { de: "", ate: "", loja: "", retornar: false };

const fxVolta = v => v.volta === "sim" || v.volta === "talvez" || (v.motivos || []).includes("vai_voltar");
const fxComo = v => v.como_chegou === "outro" && v.como_outro ? "Outro: " + v.como_outro : (FX_COMO[v.como_chegou] || "");
const fxTel = t => String(t || "").replace(/\D/g, "");

async function telaFluxo() {
  if (!FFX.de) { FFX.ate = hoje(); FFX.de = hoje().slice(0, 8) + "01"; }
  $("tela").innerHTML = '<div class="card">Carregando…</div>';
  let vis, vendas;
  try {
    const filtro = x => { x = x.gte("data", FFX.de).lte("data", FFX.ate); return FFX.loja ? x.eq("loja_id", FFX.loja) : x; };
    [vis, vendas] = await Promise.all([
      todas(() => filtro(sb.from("lin_visitas").select("*")).order("em", { ascending: false })),
      todas(() => filtro(sb.from("lin_vendas").select("id, data, loja_id")).is("cancelada_em", null)),
      CLIENTES.length ? null : carregarClientes()]);
  } catch (e) { $("tela").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  const pessoas = l => l.reduce((s, v) => s + Number(v.pessoas || 1), 0);
  const tot = pessoas(vis), volta = vis.filter(fxVolta), comCont = vis.filter(v => v.cliente_id), gost = vis.filter(v => v.gostou === "muito" || v.gostou === "gostou");
  const conv = vendas.length + tot ? Math.round(100 * vendas.length / (vendas.length + tot)) : null;
  const lista = FFX.retornar ? vis.filter(fxVolta) : vis;
  const conta = (l, chave) => { const m = {}; l.forEach(v => [].concat(chave(v)).forEach(k => { if (k) m[k] = (m[k] || 0) + Number(v.pessoas || 1); })); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const bloco = (t, l, id) => `<div class="card" id="${id}"><h2>${t}</h2>${l.length ? l.map(([k, q]) => `<div class="vlin"><span>${esc(k)}</span><b>${n(q)}${tot ? ` <span class="mut">· ${Math.round(100 * q / tot)}%</span>` : ""}</b></div>`).join("") : '<div class="mut">—</div>'}</div>`;
  const porComo = conta(vis, v => fxComo(v) || "Não informado");
  const porDia = conta(vis, v => v.data).sort((a, b) => b[0].localeCompare(a[0])).map(([k, q]) => [dataBR(k), q]).slice(0, 31);
  const hora = v => { const h = Number(new Date(v.em).toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false })); return String(h).padStart(2, "0") + "h"; };
  const porHora = conta(vis, hora).sort((a, b) => a[0].localeCompare(b[0]));
  const motivos = conta(vis, v => (v.motivos || []).map(m => m === "outro" && v.motivo_outro ? "Outro: " + v.motivo_outro : MOTIVOS[m]));
  const pecas = conta(vis, v => (v.pecas || []).map(p => [p.descricao, p.cor, p.tamanho].filter(Boolean).join(" "))).slice(0, 10);
  const falt = conta(vis, v => (v.faltou || "").trim().toUpperCase()).slice(0, 10);
  const pil = (k, v, t) => `<button type="button" class="pilula ${FFX[k] === v ? "on" : ""}" data-ffx="${k}" data-x="${esc(String(v))}">${esc(t)}</button>`;
  const contato = v => { const c = v.cliente_id && cliente(v.cliente_id); if (!v.cliente_id) return "—";
    return `<button type="button" class="lnk" data-fxcli="${v.cliente_id}">${esc(c ? c.nome : "ver cliente")}</button>${c && c.proximo_contato ? `<br><span class="mut">retornar ${dataBR(c.proximo_contato)}</span>` : ""}`; };
  $("tela").innerHTML = `<div class="cabtela"><h2>Fluxo da loja</h2><button type="button" class="bt pri" id="fxnovo">+ Registrar visita</button></div>
    <p class="mut" style="margin-top:0">Quem entrou na loja e saiu sem comprar: o que olhou, como chegou, se gostou e se volta. ${dono() ? "Você vê o fluxo de toda a equipe." : "Você vê as visitas que registrou; a Dona vê as de toda a equipe."}</p>
    <div class="filtros">
      <label>De <input type="date" id="fxde" value="${esc(FFX.de)}"></label><label>Até <input type="date" id="fxate" value="${esc(FFX.ate)}"></label>
      ${pil("loja", "", "Todas as lojas")}${LOJAS.map(l => pil("loja", l.id, l.nome)).join("")}
    </div>
    <div class="kpis">
      <div class="kpi"><small>Visitas sem compra</small><b>${n(tot)}</b><span>pessoas, em ${n(vis.length)} registro(s)</span></div>
      <div class="kpi"><small>Vendas</small><b>${n(vendas.length)}</b><span>${conv == null ? "no período" : `conversão ${n(conv)}%`}</span></div>
      <div class="kpi"><small>Disseram que voltam</small><b>${n(pessoas(volta))}</b><span>sim ou talvez</span></div>
      <div class="kpi"><small>Gostaram</small><b>${n(pessoas(gost))}</b><span>gostou ou gostou muito</span></div>
      <div class="kpi"><small>Deixaram contato</small><b>${n(comCont.length)}</b><span>viraram possível cliente</span></div>
    </div>
    ${vis.length ? `<div class="grade3" style="margin-bottom:10px">${bloco("Como chegaram", porComo, "fxcomo")}${bloco("Por que não levaram", motivos, "fxmot")}${bloco("Peças que olharam sem levar", pecas, "fxpecas")}</div>
    <div class="grade3" style="margin-bottom:10px">${bloco("Por dia", porDia, "fxdia")}${bloco("Por horário", porHora, "fxhora")}${bloco("O que faltou", falt, "fxfalt")}</div>` : ""}
    <div class="filtros">${pil("retornar", false, "Todas as visitas")}${pil("retornar", true, `Para retornar (${n(volta.length)})`)}
      ${dono() ? `<button type="button" class="bt" id="fxcsv"${lista.length ? "" : " disabled"}>Baixar CSV</button>` : ""}</div>
    ${lista.length ? `<div class="tw"><table id="fxlista"><thead><tr><th>Quando</th><th>Loja</th><th>Quem registrou</th><th class="num">Pessoas</th><th>Como chegou</th><th>O que aconteceu</th><th>Gostou</th><th>Volta</th><th>Contato</th></tr></thead><tbody>
      ${lista.map(v => `<tr class="fxrow"><td>${quando(v.em)}</td><td>${esc(loja(v.loja_id).nome)}</td><td>${esc(v.por_nome)}</td><td class="num">${n(v.pessoas)}</td>
        <td>${esc(fxComo(v)) || "—"}</td>
        <td>${esc(v.observacao)}${(v.pecas || []).length ? `<div class="mut">Peças: ${esc(v.pecas.map(pecaTxt).join(", "))}</div>` : ""}${(v.motivos || []).length ? `<div class="mut">${esc(v.motivos.map(m => m === "outro" && v.motivo_outro ? "Outro: " + v.motivo_outro : MOTIVOS[m]).join(", "))}${v.faltou ? ` (faltou ${esc(v.faltou)})` : ""}</div>` : ""}</td>
        <td>${esc(FX_GOSTOU[v.gostou] || "—")}</td><td>${esc(FX_VOLTA[v.volta] || ((v.motivos || []).includes("vai_voltar") ? "Vai voltar" : "—"))}${v.volta_quando ? `<br><span class="mut">${esc(v.volta_quando)}</span>` : ""}</td>
        <td>${contato(v)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="vazio">${FFX.retornar ? "Ninguém disse que volta no período." : "Nenhuma visita registrada no período."}</div>`}`;
  $("fxnovo").onclick = () => novaVisita(telaFluxo);
  $("fxde").onchange = () => { FFX.de = $("fxde").value; telaFluxo(); };
  $("fxate").onchange = () => { FFX.ate = $("fxate").value; telaFluxo(); };
  document.querySelectorAll("[data-ffx]").forEach(b => b.onclick = () => { const k = b.dataset.ffx; FFX[k] = k === "retornar" ? b.dataset.x === "true" : b.dataset.x; telaFluxo(); });
  document.querySelectorAll("[data-fxcli]").forEach(b => b.onclick = () => fichaCliente(b.dataset.fxcli));
  if ($("fxcsv")) $("fxcsv").onclick = () => {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lin = [["Nº", "Quando", "Loja", "Quem registrou", "Pessoas", "Como chegou", "O que aconteceu", "Peças", "Por que não levou", "Faltou", "Gostou", "Volta", "Quando volta", "Contato"].map(q).join(";")];
    lista.forEach(v => lin.push([v.id, quando(v.em), loja(v.loja_id).nome, v.por_nome, v.pessoas, fxComo(v), v.observacao, (v.pecas || []).map(pecaTxt).join(", "),
      (v.motivos || []).map(m => MOTIVOS[m]).join(", "), v.faltou, FX_GOSTOU[v.gostou] || "", FX_VOLTA[v.volta] || "", v.volta_quando,
      v.cliente_id ? (cliente(v.cliente_id) || {}).nome || "" : ""].map(q).join(";")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lin.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `fluxo-linum-${FFX.de}-a-${FFX.ate}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}

// registro de uma visita (da aba Vendas ou da aba Fluxo da loja); depois = tela a redesenhar
function novaVisita(depois) {
  const f = $("dlgf"), V = { loja: MINHA_LOJA || (LOJAS[0] || {}).id, motivos: [], pecas: [], como: "", gostou: "", volta: "", contato: false };
  $("dlg").classList.add("largo");
  const pilulas = (obj, campo) => Object.entries(obj).map(([k, t]) => `<button type="button" class="pilula" data-${campo}="${k}" aria-pressed="false">${t}</button>`).join("");
  f.innerHTML = `<h3>Fluxo da loja — registrar visita</h3>
    <div class="mut">Alguém entrou e saiu sem comprar. Escreva como no papel; o resto é opcional.</div>
    <div class="campo"><label for="visobs">O que aconteceu</label><textarea id="visobs" maxlength="500" rows="2" placeholder="Ex.: gostou da Camisa Catela, ficou grande; viaja amanhã e volta outro dia"></textarea></div>
    <div class="campo grade2"><div><label for="visloja">Loja</label><select id="visloja">${LOJAS.map(l => `<option value="${l.id}" ${l.id === V.loja ? "selected" : ""}>${esc(l.nome)}</option>`).join("")}</select></div>
      <div><label for="vispes">Quantas pessoas</label><input id="vispes" type="number" min="1" max="20" value="1"></div></div>
    <div class="campo"><label>Como chegou</label><div class="filtros" style="margin:0" id="viscomo">${pilulas(FX_COMO, "como")}</div>
      <input id="viscomoout" class="oculto" maxlength="100" placeholder="Como chegou? Ex.: viu a sacola de uma amiga" style="margin-top:6px"></div>
    <div class="campo"><label>Gostou?</label><div class="filtros" style="margin:0" id="visgost">${pilulas(FX_GOSTOU, "gost")}</div></div>
    <div class="campo"><label for="vispq">Peças que olhou ou provou</label><input id="vispq" type="search" placeholder="Referência, nome ou código de barras" autocomplete="off"><div id="visres"></div><div id="vispecas"></div></div>
    <div class="campo"><label>Por que não levou <span class="mut">(pode marcar mais de um)</span></label><div class="filtros" style="margin:0" id="vismot">${pilulas(FX_MOTIVOS, "mot")}</div>
      <input id="visoutro" class="oculto" maxlength="200" placeholder="Qual foi o outro motivo? Ex.: procurava linho mais grosso" style="margin-top:6px"></div>
    <div class="campo"><label for="visfalt">O que faltou (tamanho, cor)</label><input id="visfalt" maxlength="100" placeholder="Ex.: M, azul marinho"></div>
    <div class="campo"><label>Vai voltar?</label><div class="filtros" style="margin:0" id="visvolta">${pilulas(FX_VOLTA, "volta")}</div>
      <input id="visquando" class="oculto" maxlength="100" placeholder="Quando? Ex.: depois da viagem, semana que vem" style="margin-top:6px"></div>
    <div class="campo"><label class="chk" style="text-transform:none;font-size:13px;color:var(--ink)"><input type="checkbox" id="viscont" style="width:auto"> Deixou nome e WhatsApp</label>
      <div id="viscontbox" class="oculto">
        <div class="grade2"><div><label for="visnome">Nome</label><input id="visnome" maxlength="100"></div><div><label for="vistel">WhatsApp com DDD</label><input id="vistel" inputmode="tel" maxlength="20" placeholder="21 99999-9999"></div></div>
        <div class="grade2"><div><label for="visprox">Retornar em</label><input id="visprox" type="date" min="${hoje()}" value="${somaDias(hoje(), 3)}"></div><div></div></div>
        <label class="chk" style="text-transform:none;font-size:13px;color:var(--ink);margin-top:8px"><input type="checkbox" id="visaceite" style="width:auto"> A pessoa autorizou receber contato da Linum pelo WhatsApp</label>
        <div class="mut">Fica como possível cliente no CRM (aba Clientes), com esta visita no histórico. Se o telefone já for de uma cliente, a visita entra na ficha dela.</div>
      </div></div>
    <div id="viserr"></div>
    <div class="acoes"><button type="button" class="bt" id="visx">Cancelar</button><button type="button" class="bt pri" id="visok">Registrar visita</button></div>`;
  // escolha única (como chegou, gostou, volta): clicar de novo desmarca
  const unica = (campo, chave, extra) => f.querySelectorAll(`[data-${campo}]`).forEach(b => b.onclick = () => {
    const k = b.dataset[campo]; V[chave] = V[chave] === k ? "" : k;
    f.querySelectorAll(`[data-${campo}]`).forEach(x => { x.classList.toggle("on", x.dataset[campo] === V[chave]); x.setAttribute("aria-pressed", x.dataset[campo] === V[chave]); });
    if (extra) extra();
  });
  unica("como", "como", () => { $("viscomoout").classList.toggle("oculto", V.como !== "outro"); if (V.como === "outro") $("viscomoout").focus(); });
  unica("gost", "gostou");
  unica("volta", "volta", () => $("visquando").classList.toggle("oculto", !(V.volta === "sim" || V.volta === "talvez")));
  f.querySelectorAll("[data-mot]").forEach(b => b.onclick = () => {
    const k = b.dataset.mot, on = !V.motivos.includes(k);
    V.motivos = on ? V.motivos.concat(k) : V.motivos.filter(x => x !== k);
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
    if (k === "outro") { $("visoutro").classList.toggle("oculto", !on); if (on) $("visoutro").focus(); }
  });
  $("viscont").onchange = () => { V.contato = $("viscont").checked; $("viscontbox").classList.toggle("oculto", !V.contato); if (V.contato) $("visnome").focus(); };
  const achar = vid => { for (const p of PRODUTOS) { const v = p.variantes.find(x => x.id === vid); if (v) return [p, v]; } return [null, null]; };
  const desenharPecas = () => {
    $("vispecas").innerHTML = V.pecas.map((vid, i) => { const [p, v] = achar(vid);
      return `<div class="vlin"><span><b>${esc(p.referencia)}</b> ${esc(p.descricao)} — ${esc(nomeVar(v))}</span><button type="button" class="lnk perigo" data-vrm="${i}">×</button></div>`; }).join("");
    $("vispecas").querySelectorAll("[data-vrm]").forEach(b => b.onclick = () => { V.pecas.splice(Number(b.dataset.vrm), 1); desenharPecas(); });
  };
  $("vispq").oninput = () => {
    const t = semAc($("vispq").value), r = [];
    if (t.length >= 2) for (const p of PRODUTOS) {
      const casaP = semAc(p.referencia).includes(t) || semAc(p.descricao).includes(t);
      for (const v of p.variantes) if ((casaP || (v.codigo_barras || "") === t) && !V.pecas.includes(v.id)) r.push([p, v]);
      if (r.length > 30) break;
    }
    $("visres").innerHTML = r.slice(0, 30).map(([p, v], i) => `<div class="vlin"><span><b>${esc(p.referencia)}</b> ${esc(p.descricao)} — ${esc(nomeVar(v))}</span><button type="button" class="lnk" data-vadd="${i}">Adicionar</button></div>`).join("")
      || (t.length >= 2 ? `<div class="mut">Nenhuma peça para “${esc(t)}”.</div>` : "");
    $("visres").querySelectorAll("[data-vadd]").forEach(b => b.onclick = () => { V.pecas.push(r[b.dataset.vadd][1].id); $("vispq").value = ""; $("visres").innerHTML = ""; desenharPecas(); });
  };
  $("visx").onclick = () => $("dlg").close();
  $("visok").onclick = async () => {
    $("visok").disabled = true; $("viserr").innerHTML = "";
    try {
      let cli = null;
      if (V.contato) {
        const nome = $("visnome").value.trim(), tel = fxTel($("vistel").value);
        if (nome.length < 2) throw new Error("Escreva o nome da pessoa (ou desmarque “Deixou nome e WhatsApp”)");
        if (tel.length < 10 || tel.length > 13) throw new Error("WhatsApp com DDD: 10 ou 11 dígitos");
        if (!$("visaceite").checked) throw new Error("Marque que a pessoa autorizou o contato (sem autorização, não guarde o telefone)");
        if (!CLIENTES.length) await carregarClientes();
        const ja = CLIENTES.find(c => fxTel(c.telefone) && fxTel(c.telefone).slice(-9) === tel.slice(-9));
        cli = ja ? ja.id : checar(await sb.rpc("lin_cliente_salvar", { p: { nome, telefone: tel, situacao: "possivel", loja_id: $("visloja").value,
          origem: "Fluxo da loja" + (V.como ? " – " + (V.como === "outro" ? $("viscomoout").value.trim() || "Outro" : FX_COMO[V.como]) : ""),
          interesses: V.pecas.map(vid => { const [p, v] = achar(vid); return p ? `${p.descricao} ${nomeVar(v)}` : ""; }).filter(Boolean).join(", ") } }));
      }
      checar(await sb.rpc("lin_visita_registrar", { p: { loja_id: $("visloja").value, pessoas: $("vispes").value, observacao: $("visobs").value,
        como_chegou: V.como, como_outro: V.como === "outro" ? $("viscomoout").value : "", gostou: V.gostou,
        motivos: V.motivos, motivo_outro: V.motivos.includes("outro") ? $("visoutro").value : "", faltou: $("visfalt").value, pecas: V.pecas,
        volta: V.volta, volta_quando: (V.volta === "sim" || V.volta === "talvez") ? $("visquando").value : "",
        cliente_id: cli, aceite: !!cli, proximo_contato: cli ? $("visprox").value : "" } }));
      $("dlg").close();
      if (cli) await carregarClientes();
      await (depois || telaVendas)(); msg("ok", cli ? "Visita registrada e contato guardado no CRM." : "Visita registrada.");
    } catch (e) { $("viserr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; $("visok").disabled = false; }
  };
  $("dlg").showModal();
}
