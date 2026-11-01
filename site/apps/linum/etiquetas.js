// Sistema Linum — Etiquetas (versão 2.27, pedido do Marco em 31/10/2026): o "Gerador de Etiquetas" da Linum
// (marcoaviana64/linum, gerador_etiquetas.html) dentro do app, para toda a equipe (vendedoras inclusive).
// Mesmo papel ("Etiqueta Tripla" do Singlabel, folha Carta, 4 × 3 = 12 por folha) e mesmo cabeçalho; nas duas partes de baixo
// entram o TAMANHO e o CÓDIGO DE BARRAS (Code 128, deitado), sem sair da área que o texto já ocupava (pedido do Marco:
// "não sair do molde"). Os dados vêm do cadastro (lin_estoque_ler: referência, descrição, tecido, preço, código) ou são
// digitados. O código da etiqueta é o da peça especial ou, nas outras, o do produto (o mesmo que a venda já procura).
// Usa os ajudantes do index.html ($, esc, msg, brl, n, hoje, PRODUTOS, LOJAS, MINHA_LOJA, qtd, ordemVar, nomeVar…).

// ---------------------------------------------------------------- molde (coordenadas do PDF de referência "Etiqueta_Tripla64_Carta.pdf", em pt)
const ETQ_M = { COLS: 4, ROWS: 3, COL_PITCH: 136.0, ROW_PITCH: 216.3, CENTER_X: 99.5, LEFT_X: 38.0, RIGHT_X: 163.0, LARG: 86.0 };
ETQ_M.POR_FOLHA = ETQ_M.COLS * ETQ_M.ROWS;
// as duas partes de baixo: r = linha da referência (a mesma do gerador antigo); base = onde ficava a linha do preço,
// que continua sendo o limite de baixo de tudo (o código de barras termina nela)
const ETQ_PARTES = [{ r: 166.3, base: 194.9 }, { r: 218.9, base: 246.7 }];
const ETQ_ALT_BARRAS = 8.4;   // altura das barras (≈ 3 mm); módulo até 0,9 pt (≈ 0,32 mm) com 10 módulos de margem de cada lado

// ---------------------------------------------------------------- código de barras Code 128 (B para texto, C para pares de dígitos)
const ETQ_C128 = ["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"];
// devolve a sequência de larguras (barra, espaço, barra…) em módulos; null se o texto tiver caractere fora do Code 128 B
function etqCode128(txt) {
  txt = String(txt || "").trim();
  if (!txt || /[^\x20-\x7e]/.test(txt)) return null;
  const cods = [];
  if (/^\d+$/.test(txt) && txt.length >= 2) {   // dígitos: conjunto C (2 por símbolo); número ímpar = o último vai no B
    cods.push(105);
    const par = txt.length - txt.length % 2;
    for (let i = 0; i < par; i += 2) cods.push(+txt.slice(i, i + 2));
    if (par < txt.length) cods.push(100, txt.charCodeAt(par) - 32);
  } else {
    cods.push(104);
    for (const c of txt) cods.push(c.charCodeAt(0) - 32);
  }
  cods.push(cods.reduce((s, c, i) => s + c * (i || 1), 0) % 103, 106);
  return cods.map(c => ETQ_C128[c]).join("");
}

// ---------------------------------------------------------------- PDF
const etqValor = v => "R$ " + Math.round(Number(v || 0)).toLocaleString("pt-BR");
function etqCaber(doc, txt, tam, larg, estilo, min) {
  doc.setFont("helvetica", estilo || "normal");
  for (; tam > (min || 5); tam -= 0.5) { doc.setFontSize(tam); if (doc.getTextWidth(txt) <= larg) break; }
  doc.setFontSize(tam);
  return tam;
}
// mesmo na letra mínima não cabe: corta com reticências (nada passa da borda da etiqueta)
function etqCortar(doc, txt, larg) {
  if (doc.getTextWidth(txt) <= larg) return txt;
  while (txt.length > 1 && doc.getTextWidth(txt + "…") > larg) txt = txt.slice(0, -1);
  return txt.trimEnd() + "…";
}
function etqCabecalho(doc, logo, ox, oy) {   // igual ao gerador antigo
  const M = ETQ_M;
  doc.addImage(logo, "PNG", 43.3 + ox, 64.1 + oy, 27.5, 27.6);
  doc.setFont("helvetica", "bold"); doc.setFontSize(14.97);
  doc.text("LINUM", 74.8 + ox, 81.3 + oy);
  etqCaber(doc, "Roupas de Linho", 8.98, M.RIGHT_X + ox - (74.8 + ox));
  doc.text("Roupas de Linho", 74.8 + ox, 89.7 + oy);
  doc.setFontSize(5.03); doc.text("Instagram: @linumipanema", 68.4 + ox, 97.4 + oy);
  doc.setFontSize(8.29);
  doc.text("Prazo de troca: 30 dias", 58.2 + ox, 111.1 + oy);
  doc.text("Rio de Janeiro, _____/_____/____", 41.0 + ox, 127.3 + oy);
  doc.setFontSize(6.0);
  doc.text("Rua Visconde de Pirajá, 444, loja 111", 51.8 + ox, 137.2 + oy);
  doc.text("Telefones: (21) 3734-1350 - (21) 97437-4263", 42.1 + ox, 144.8 + oy);
}
// uma parte de baixo: referência e tamanho | descrição | tecido e preço | código de barras
function etqParte(doc, it, parte, ox, oy) {
  const M = ETQ_M, L = M.LEFT_X + ox, R = M.RIGHT_X + ox, r = parte.r + oy;
  const tam = it.tamanho ? "Tam. " + it.tamanho : "";
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
  const lt = tam ? doc.getTextWidth(tam) : 0;
  if (tam) doc.text(tam, R, r, { align: "right" });
  etqCaber(doc, it.ref, 6.74, R - L - lt - 4);
  doc.text(etqCortar(doc, it.ref, R - L - lt - 4), L, r);
  etqCaber(doc, it.desc, 9, M.LARG + 30, "normal", 5.5);
  doc.text(etqCortar(doc, it.desc, M.LARG + 30), M.CENTER_X + ox, r + 9.2, { align: "center" });
  const preco = it.valorFmt;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  const lp = doc.getTextWidth(preco);
  doc.text(preco, R, r + 17.8, { align: "right" });
  if (it.tecido) { etqCaber(doc, it.tecido, 7.5, R - L - lp - 4, "normal", 4.5); doc.text(etqCortar(doc, it.tecido, R - L - lp - 4), L, r + 17.8); }
  const pad = etqCode128(it.codigo);
  if (!pad) return;
  const mods = [...pad].reduce((s, w) => s + +w, 0);
  const x0 = Math.min(0.9, (R - L) / (mods + 20));   // largura do módulo
  let x = M.CENTER_X + ox - mods * x0 / 2;
  const y = parte.base + oy - ETQ_ALT_BARRAS;
  doc.setFillColor(0, 0, 0);
  [...pad].forEach((w, i) => { if (i % 2 === 0) doc.rect(x, y, w * x0, ETQ_ALT_BARRAS, "F"); x += w * x0; });
}
// itens = [{ref, desc, tecido, tamanho, valorFmt, codigo, qtd}]; as etiquetas seguem em fluxo pelas folhas (como no gerador antigo)
function etqDesenhar(jsPDF, logo, itens) {
  const M = ETQ_M, doc = new jsPDF({ unit: "pt", format: "letter" });
  let pos = 0, comecou = false;
  itens.forEach(it => {
    for (let i = 0; i < it.qtd; i++) {
      if (pos === 0) { if (comecou) doc.addPage(); comecou = true; }
      const ox = (pos % M.COLS) * M.COL_PITCH, oy = Math.floor(pos / M.COLS) * M.ROW_PITCH;
      etqCabecalho(doc, logo, ox, oy);
      ETQ_PARTES.forEach(p => etqParte(doc, it, p, ox, oy));
      pos = (pos + 1) % M.POR_FOLHA;
    }
  });
  return doc;
}
// quantas folhas e quantos espaços sobram na última
function etqFolhas(itens) {
  const total = itens.reduce((s, i) => s + i.qtd, 0), P = ETQ_M.POR_FOLHA;
  return { total, folhas: Math.ceil(total / P), vazios: total % P ? P - total % P : 0 };
}

// ---------------------------------------------------------------- tela
let ETQ_LISTA = [];
const FET = { q: "", prod: null, loja: "" };
const ETQ_CHAVE = "linum-etiquetas-lista";
function etqGuardar() { try { localStorage.setItem(ETQ_CHAVE, JSON.stringify(ETQ_LISTA)); } catch (e) {} }
function etqLer() { try { const l = JSON.parse(localStorage.getItem(ETQ_CHAVE) || "[]"); if (Array.isArray(l)) ETQ_LISTA = l.filter(i => i && i.qtd > 0); } catch (e) {} }
let ETQ_LIDO = false;
const etqSemAcento = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function telaEtiquetas() {
  if (!ETQ_LIDO) { etqLer(); ETQ_LIDO = true; }
  if (!FET.loja) FET.loja = MINHA_LOJA || (LOJAS[0] || {}).id || "";
  $("tela").innerHTML = `
    <div class="cabtela"><h2>Etiquetas</h2><span class="mut">Etiqueta Tripla · folha Carta · 12 por folha</span></div>
    <div class="card">
      <h2>Do cadastro</h2>
      <p class="mut" style="margin:0 0 8px">Busque a peça pela referência, pelo nome ou lendo o código de barras. Referência, descrição, tecido, tamanho, preço e código vêm do cadastro.</p>
      <div class="filtros"><input id="etq" type="search" placeholder="Referência, nome ou código de barras" value="${esc(FET.q)}" autocomplete="off"></div>
      <div id="etqres"></div>
      <div id="etqprod"></div>
    </div>
    <div class="card">
      <h2>Digitar à mão</h2>
      <p class="mut" style="margin:0 0 8px">Para a peça que ainda não está no cadastro. Sem código de barras, a etiqueta sai sem as barras.</p>
      <div class="grade3">
        <div><label for="em_ref">Referência</label><input id="em_ref" maxlength="30"></div>
        <div><label for="em_desc">Descrição</label><input id="em_desc" maxlength="60"></div>
        <div><label for="em_tec">Tecido</label><input id="em_tec" value="100% Linho" maxlength="40"></div>
        <div><label for="em_tam">Tamanho</label><input id="em_tam" maxlength="10" placeholder="Ex.: M"></div>
        <div><label for="em_val">Valor (R$)</label><input id="em_val" inputmode="decimal" placeholder="Ex.: 989"></div>
        <div><label for="em_cod">Código de barras (opcional)</label><input id="em_cod" maxlength="30"></div>
        <div><label for="em_qtd">Quantidade</label><input id="em_qtd" type="number" min="1" max="500" value="1"></div>
        <div style="align-self:end"><button class="bt" id="em_add" type="button">Adicionar à lista</button></div>
      </div>
    </div>
    <div class="card" id="etqlista"></div>`;
  const busca = $("etq");
  busca.oninput = () => { FET.q = busca.value; FET.prod = null; etqResultados(); };
  busca.onkeydown = e => {   // leitor de código de barras termina com Enter: abre a peça se o código for exato
    if (e.key !== "Enter") return;
    e.preventDefault();
    const t = busca.value.trim();
    const p = PRODUTOS.find(p => p.codigo_barras === t || p.referencia.toLowerCase() === t.toLowerCase() || p.variantes.some(v => v.codigo_barras === t));
    if (p) { FET.prod = p.id; etqResultados(); }
  };
  $("em_add").onclick = etqManual;
  etqResultados();
  etqListaDesenhar();
}

function etqResultados() {
  const t = etqSemAcento(FET.q.trim());
  const res = $("etqres");
  if (FET.prod) { res.innerHTML = ""; return etqProduto(PRODUTOS.find(p => p.id === FET.prod)); }
  $("etqprod").innerHTML = "";
  if (t.length < 2) { res.innerHTML = ""; return; }
  const achados = PRODUTOS.filter(p => etqSemAcento(p.referencia + " " + p.descricao).includes(t) || p.codigo_barras === FET.q.trim()
    || p.variantes.some(v => v.codigo_barras === FET.q.trim())).slice(0, 30);
  res.innerHTML = achados.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${achados.map(p =>
    `<button type="button" class="pilula" data-ep="${p.id}">${esc(p.referencia)} · ${esc(p.descricao)}</button>`).join("")}</div>`
    : '<p class="mut">Nenhuma peça encontrada. Confira a referência ou use "Digitar à mão".</p>';
  res.querySelectorAll("[data-ep]").forEach(b => b.onclick = () => { FET.prod = b.dataset.ep; etqResultados(); });
}

// a peça escolhida: uma linha por variação, com a quantidade de etiquetas de cada uma
function etqProduto(p) {
  const box = $("etqprod");
  if (!p) { box.innerHTML = ""; return; }
  const vs = [...p.variantes].sort(ordemVar);
  const precoV = v => v.preco_venda != null ? v.preco_venda : p.preco_venda;
  const codV = v => v.codigo_barras || p.codigo_barras || "";
  box.innerHTML = `
    <div style="border-top:1px dashed var(--border);margin-top:10px;padding-top:10px">
      <div class="cabtela"><b>${esc(p.referencia)} · ${esc(p.descricao)}</b><button type="button" class="bt" id="ep_fechar">Escolher outra peça</button></div>
      ${vs.length ? `
      <div class="grade3">
        <div><label for="ep_tec">Tecido na etiqueta</label><input id="ep_tec" value="${esc(p.tecido || "100% Linho")}" maxlength="40"></div>
        <div><label for="ep_loja">Estoque da loja</label><select id="ep_loja">${LOJAS.map(l => `<option value="${l.id}" ${l.id === FET.loja ? "selected" : ""}>${esc(l.nome)}</option>`).join("")}</select></div>
        <div style="align-self:end;display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="bt" id="ep_est">Uma por peça em estoque</button><button type="button" class="bt" id="ep_zero">Zerar</button></div>
      </div>
      <div style="overflow-x:auto;margin-top:8px"><table>
        <tr><th>Variação</th><th>Código</th><th class="num">Preço</th><th class="num">Estoque</th><th class="num">Etiquetas</th></tr>
        ${vs.map(v => `<tr${v.edicao ? ' class="esp"' : ""}><td>${esc(nomeVar(v))}${v.edicao ? '<span class="tag">peça especial</span>' : ""}</td>
          <td class="mut">${esc(codV(v)) || "sem código"}</td><td class="num">${etqValor(precoV(v))}</td>
          <td class="num" data-est="${v.id}"></td>
          <td class="num"><input type="number" min="0" max="500" value="0" data-eq="${v.id}" style="width:80px;text-align:right" aria-label="Etiquetas de ${esc(nomeVar(v))}"></td></tr>`).join("")}
      </table></div>
      <div class="btn-row" style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button type="button" class="bt pri" id="ep_add">Adicionar à lista</button><span class="mut" id="ep_tot"></span></div>`
      : '<p class="mut">Esta peça ainda não tem cores e tamanhos cadastrados. Cadastre em Produtos ou use "Digitar à mão".</p>'}
    </div>`;
  $("ep_fechar").onclick = () => { FET.prod = null; etqResultados(); $("etq").focus(); };
  if (!vs.length) return;
  const estoque = () => vs.forEach(v => box.querySelector(`[data-est="${v.id}"]`).textContent = n(qtd(v.id, FET.loja)));
  const total = () => { const t = [...box.querySelectorAll("[data-eq]")].reduce((s, i) => s + Math.max(0, parseInt(i.value, 10) || 0), 0); $("ep_tot").textContent = t ? `${t} etiqueta${t === 1 ? "" : "s"}` : ""; };
  estoque();
  $("ep_loja").onchange = () => { FET.loja = $("ep_loja").value; estoque(); };
  $("ep_est").onclick = () => { vs.forEach(v => box.querySelector(`[data-eq="${v.id}"]`).value = Math.max(0, qtd(v.id, FET.loja))); total(); };
  $("ep_zero").onclick = () => { box.querySelectorAll("[data-eq]").forEach(i => i.value = 0); total(); };
  box.querySelectorAll("[data-eq]").forEach(i => i.oninput = total);
  $("ep_add").onclick = () => {
    const tecido = $("ep_tec").value.trim();
    let novos = 0;
    vs.forEach(v => {
      const q = Math.min(500, Math.max(0, parseInt(box.querySelector(`[data-eq="${v.id}"]`).value, 10) || 0));
      if (!q) return;
      etqJuntar({ ref: p.referencia, desc: [p.descricao, v.edicao].filter(Boolean).join(" "), tecido, tamanho: v.tamanho || "",
        valor: Number(precoV(v) || 0), codigo: codV(v), qtd: q });
      novos += q;
    });
    if (!novos) return msg("err", "Informe quantas etiquetas de cada tamanho (ou use “Uma por peça em estoque”).");
    msg("ok", `${novos} etiqueta${novos === 1 ? "" : "s"} de ${p.referencia} na lista.`);
    FET.prod = null; FET.q = ""; $("etq").value = ""; etqResultados(); etqListaDesenhar(); $("etq").focus();
  };
}

// a mesma etiqueta (peça, tamanho, tecido, preço, código) soma a quantidade em vez de repetir a linha
function etqJuntar(it) {
  if (!(it.valor > 0)) return;
  it.valorFmt = etqValor(it.valor);
  const igual = ETQ_LISTA.find(x => ["ref", "desc", "tecido", "tamanho", "valorFmt", "codigo"].every(k => (x[k] || "") === (it[k] || "")));
  if (igual) igual.qtd = Math.min(999, igual.qtd + it.qtd); else ETQ_LISTA.push(it);
  etqGuardar();
}

function etqManual() {
  const g = id => $(id).value.trim();
  const valor = Number(g("em_val").replace(/\./g, "").replace(",", ".")), q = parseInt(g("em_qtd"), 10);
  if (!g("em_ref")) return msg("err", "Informe a referência.");
  if (!g("em_desc")) return msg("err", "Informe a descrição.");
  if (!(valor > 0)) return msg("err", "O valor não pode ser zero.");
  if (!(q > 0 && q <= 500)) return msg("err", "Informe a quantidade de etiquetas (1 a 500).");
  if (g("em_cod") && !etqCode128(g("em_cod"))) return msg("err", "O código de barras só pode ter letras sem acento, números e símbolos simples.");
  etqJuntar({ ref: g("em_ref"), desc: g("em_desc"), tecido: g("em_tec"), tamanho: g("em_tam").toUpperCase(), valor, codigo: g("em_cod"), qtd: q });
  ["em_ref", "em_desc", "em_tam", "em_val", "em_cod"].forEach(id => $(id).value = ""); $("em_qtd").value = 1;
  msg("ok", "Etiqueta na lista."); etqListaDesenhar(); $("em_ref").focus();
}

function etqListaDesenhar() {
  const box = $("etqlista");
  if (!box) return;
  const f = etqFolhas(ETQ_LISTA);
  box.innerHTML = `<h2>Lista para imprimir</h2>` + (!ETQ_LISTA.length ? '<p class="mut">Nenhuma etiqueta na lista.</p>' : `
    <div style="overflow-x:auto"><table>
      <tr><th>Referência</th><th>Descrição</th><th>Tam.</th><th>Tecido</th><th class="num">Valor</th><th>Código</th><th class="num">Qtd.</th><th></th></tr>
      ${ETQ_LISTA.map((i, k) => `<tr><td>${esc(i.ref)}</td><td>${esc(i.desc)}</td><td>${esc(i.tamanho || "—")}</td><td>${esc(i.tecido || "—")}</td>
        <td class="num">${esc(i.valorFmt)}</td><td class="mut">${esc(i.codigo || "sem código")}</td>
        <td class="num"><input type="number" min="1" max="999" value="${i.qtd}" data-lq="${k}" style="width:72px;text-align:right" aria-label="Quantidade"></td>
        <td><button type="button" class="lnk" data-lx="${k}">tirar</button></td></tr>`).join("")}
    </table></div>
    <div class="kpis" style="margin-top:10px">
      <div class="kpi"><small>Etiquetas</small><b>${n(f.total)}</b></div>
      <div class="kpi"><small>Folhas</small><b>${n(f.folhas)}</b></div>
      <div class="kpi"><small>Espaços vazios</small><b>${n(f.vazios)}</b><span>${f.vazios ? `na última folha: com mais ${f.vazios} etiqueta${f.vazios === 1 ? "" : "s"} ela fecha` : "nenhum desperdício"}</span></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="bt pri" id="etq_pdf">Gerar PDF para imprimir</button><button type="button" class="bt" id="etq_limpar">Limpar lista</button></div>
    <p class="mut" style="margin:10px 0 0">Imprima em tamanho real (100%, sem "ajustar à página"), no papel Etiqueta Tripla Carta. Na primeira vez, imprima numa folha comum e confira contra a luz, por cima do papel de etiquetas.</p>`);
  box.querySelectorAll("[data-lq]").forEach(i => i.onchange = () => { ETQ_LISTA[+i.dataset.lq].qtd = Math.min(999, Math.max(1, parseInt(i.value, 10) || 1)); etqGuardar(); etqListaDesenhar(); });
  box.querySelectorAll("[data-lx]").forEach(b => b.onclick = () => { ETQ_LISTA.splice(+b.dataset.lx, 1); etqGuardar(); etqListaDesenhar(); });
  if (!ETQ_LISTA.length) return;
  $("etq_limpar").onclick = () => { ETQ_LISTA = []; etqGuardar(); etqListaDesenhar(); };
  $("etq_pdf").onclick = etqGerar;
}

// jsPDF e o logo só são buscados na hora de gerar
let ETQ_LOGO = null;
function etqScript(src) { return new Promise((ok, erro) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => erro(new Error("não foi possível carregar o gerador de PDF")); document.head.appendChild(s); }); }
async function etqGerar() {
  const b = $("etq_pdf"); b.disabled = true; b.textContent = "Gerando…";
  try {
    if (!window.jspdf) await etqScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    if (!ETQ_LOGO) {
      const r = await fetch("etiqueta-logo.png");
      if (!r.ok) throw new Error("não foi possível carregar o logo da etiqueta");
      const blob = await r.blob();
      ETQ_LOGO = await new Promise(ok => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(blob); });
    }
    const doc = etqDesenhar(window.jspdf.jsPDF, ETQ_LOGO, ETQ_LISTA);
    doc.save(`Etiquetas Linum ${hoje().split("-").reverse().join("-")}.pdf`);
    msg("ok", "PDF gerado. Imprima em tamanho real (100%).");
  } catch (e) { msg("err", "Não foi possível gerar o PDF: " + e.message + ". Confira a internet e tente de novo."); }
  finally { b.disabled = false; b.textContent = "Gerar PDF para imprimir"; }
}
