// Impressora térmica de 80 mm por Bluetooth (ESC/POS) e EXTRATO DA VENDA (Sistema Linum 2.56, pedido do Marco em 23/11/2026,
// com a impressora RP Printer YY0808: 80 mm, "ESC/POS Compatible", Bluetooth SPP + BLE, página de teste com codepage UTF-8).
// O navegador fala direto com a impressora pelo Web Bluetooth (BLE): só Chrome/Edge no computador e Chrome no Android;
// no iPhone/iPad não existe (o Safari e o Chrome do iPhone não têm Web Bluetooth). Alternativa: "Imprimir pelo navegador
// (80 mm)" abre a página do extrato no tamanho do papel, para impressora instalada no computador ou um app de impressão.
// O extrato é um espelho da venda para a cliente; NÃO é documento fiscal (a nota continua sendo emitida à parte).
// Usa do index: $, esc, brl, dataBR, quando, loja, cliente, fone, FORMAS, eCartao, msg, sb, checar.

// serviços BLE das impressoras térmicas mais comuns (o navegador só deixa usar os serviços listados aqui)
const TERM_SERVICOS = [
  "000018f0-0000-1000-8000-00805f9b34fb", "0000ff00-0000-1000-8000-00805f9b34fb", "0000ffe0-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb", "0000ae30-0000-1000-8000-00805f9b34fb", "0000af30-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "49535343-fe7d-4ae5-8fa9-9fafd205e455", "0000ffb0-0000-1000-8000-00805f9b34fb",
];
const TERM = { dev: null, car: null };
const TERM_CHAVE = "linum-termica";
// colunas: 48 = letra normal (12×24) em 80 mm; 42 e 32 se a linha sair cortada. acentos: a YY0808 vem em UTF-8.
const termCfg = () => { try { return Object.assign({ colunas: 48, acentos: true }, JSON.parse(localStorage.getItem(TERM_CHAVE) || "{}")); } catch { return { colunas: 48, acentos: true }; } };
const termGuardar = c => localStorage.setItem(TERM_CHAVE, JSON.stringify(c));
const termSuporta = () => !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
const termConectada = () => !!(TERM.car && TERM.dev && TERM.dev.gatt && TERM.dev.gatt.connected);

async function termConectar(escolher) {
  if (!termSuporta()) throw new Error("Este navegador não imprime por Bluetooth. Use o Chrome no Android ou o Chrome/Edge no computador (no iPhone e no iPad não funciona). Ou use “Imprimir pelo navegador (80 mm)”.");
  if (!escolher && termConectada()) return TERM.car;
  if (escolher || !TERM.dev) {
    try { TERM.dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: TERM_SERVICOS }); }
    catch (e) { if (e && e.name === "NotFoundError") throw new Error("Nenhuma impressora escolhida. Ligue a impressora (luz azul do Bluetooth) e escolha “YY0808” na lista."); throw e; }
    TERM.car = null;
    TERM.dev.addEventListener("gattserverdisconnected", () => { TERM.car = null; termStatus(); });
  }
  let srv;
  try { srv = await TERM.dev.gatt.connect(); }
  catch (e) { throw new Error(`Não consegui conectar em “${TERM.dev.name || "impressora"}”: ${e.message}. Confira se ela está ligada, perto e não conectada a outro aparelho.`); }
  let servicos = [];
  try { servicos = await srv.getPrimaryServices(); } catch { servicos = []; }
  for (const s of servicos) {
    let cs = []; try { cs = await s.getCharacteristics(); } catch { cs = []; }
    const c = cs.find(x => x.properties.write) || cs.find(x => x.properties.writeWithoutResponse);
    if (c) { TERM.car = c; termStatus(); return c; }
  }
  try { TERM.dev.gatt.disconnect(); } catch {}
  throw new Error(`“${TERM.dev.name || "Este aparelho"}” não parece ser uma impressora (sem canal de impressão conhecido). Escolha a impressora “YY0808”.`);
}

const espera = ms => new Promise(r => setTimeout(r, ms));
async function termEnviar(bytes, escolher) {
  const c = await termConectar(escolher);
  const comResposta = !!c.properties.write;
  let tam = 100;
  for (let i = 0; i < bytes.length;) {
    const parte = bytes.slice(i, i + tam);
    try {
      if (comResposta) await c.writeValueWithResponse(parte); else { await c.writeValueWithoutResponse(parte); await espera(25); }
      i += parte.length;
    } catch (e) {
      if (tam > 20) { tam = 20; continue; }   // pacote grande demais para essa impressora: tenta de 20 em 20
      throw new Error("A impressão parou no meio: " + e.message);
    }
  }
}

// ---------------------------------------------------------------- texto
// troca os caracteres que a impressora não tem; sem acentos = tira os acentos (para impressora que não aceita UTF-8)
function termLimpo(t, acentos) {
  let s = String(t ?? "").replace(/[   ]/g, " ").replace(/[·•]/g, "-").replace(/[–—]/g, "-").replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'")
    .replace(/×/g, "x").replace(/…/g, "...").replace(/[✓★]/g, "*");
  if (!acentos) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "?");
  return s;
}
function termQuebrar(t, w) {
  const out = []; let l = "";
  for (const p of String(t).split(/\s+/).filter(Boolean)) {
    let pal = p;
    while (pal.length > w) { if (l) { out.push(l); l = ""; } out.push(pal.slice(0, w)); pal = pal.slice(w); }
    if (!pal) continue;
    if (!l) l = pal; else if (l.length + 1 + pal.length <= w) l += " " + pal; else { out.push(l); l = pal; }
  }
  if (l) out.push(l);
  return out.length ? out : [""];
}
// esquerda ... direita na mesma linha (a esquerda quebra se não couber)
function termPar(esq, dir, w) {
  const d = String(dir), l = termQuebrar(esq, w);
  const ult = l[l.length - 1];
  if (ult.length + 1 + d.length <= w) l[l.length - 1] = ult + " ".repeat(w - ult.length - d.length) + d;
  else l.push(" ".repeat(Math.max(0, w - d.length)) + d);
  return l;
}

// endereço impresso no cabeçalho (o mesmo da etiqueta da Linum); loja sem endereço aqui sai só com o nome
// (site da Linum, enviado pelo Marco em 23/11/2026; o "loja 111" de Ipanema vem da etiqueta)
const TERM_ENDERECOS = {
  "Ipanema": ["Rua Visconde de Pirajá, 444, loja 111", "Rio de Janeiro - RJ, 22410-002", "Tel. (21) 3734-1350"],
  "Gávea": ["R. Marquês de São Vicente, 52, loja 161", "Rio de Janeiro - RJ, 22451-040", "Tel. (21) 97437-4263"],
};

// linhas do extrato: { t: texto, c: centro, b: negrito, g: grande }; serve para a térmica e para a prévia/impressão do navegador
function termExtrato(v, its, c, w) {
  const L = [], linha = (t, o = {}) => L.push(Object.assign({ t }, o)), sep = () => linha("-".repeat(w));
  const quebra = (t, o) => termQuebrar(t, w).forEach(x => linha(x, o)), par = (a, b, o) => termPar(a, b, w).forEach(x => linha(x, o));
  const cpf = x => x && x.length === 11 ? `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}` : (x || "");
  const nomeLoja = loja(v.loja_id).nome;
  linha("LINUM", { c: 1, b: 1, g: 1 }); linha("Roupas de Linho", { c: 1 });
  quebra("Loja " + nomeLoja, { c: 1 });
  (TERM_ENDERECOS[nomeLoja] || []).forEach(t => termQuebrar(t, w).forEach(x => linha(x, { c: 1 })));
  sep();
  if (v.cancelada_em) quebra("*** VENDA CANCELADA ***", { c: 1, b: 1 });
  quebra(`EXTRATO DA VENDA Nº ${v.id}`, { c: 1, b: 1 });
  quebra("Não é documento fiscal", { c: 1 });
  sep();
  par("Data: " + dataBR(v.data), "Vendedora: " + (v.vendedora_nome || "").split(" ")[0]);
  if (c) {
    quebra("Cliente: " + c.nome, { b: 1 });
    const d = [c.cpf ? "CPF " + cpf(c.cpf) : "", c.telefone ? "Tel. " + fone(c.telefone) : ""].filter(Boolean).join("  ");
    if (d) quebra(d);
  } else linha("Cliente: não informada");
  sep();
  let pecas = 0;
  its.forEach(i => {
    pecas += Number(i.quantidade);
    quebra(`${i.referencia} ${i.descricao}`, { b: 1 });
    const det = [i.cor, i.tamanho, i.edicao].filter(Boolean).join(" - ");
    if (det) quebra("  " + det);
    par(`  ${Number(i.quantidade)} x ${brl(i.valor_unitario)}`, brl(i.valor_total));
    if (Number(i.desconto_pct)) quebra(`  (tabela ${brl(i.preco_tabela)}, desconto ${String(i.desconto_pct).replace(".", ",")}%)`);
  });
  sep();
  par(`${pecas} peça${pecas === 1 ? "" : "s"} - valor de tabela`, brl(v.valor_bruto));
  const descPecas = Number(v.valor_bruto) - Number(v.valor_itens);
  if (descPecas > 0.004) par("Desconto nas peças", "- " + brl(descPecas));
  if (Number(v.desconto)) par("Desconto geral", "- " + brl(v.desconto));
  par("TOTAL", brl(v.valor_total), { b: 1, g: 1 });
  if (Number(v.credito_usado)) { par("Crédito da cliente usado", "- " + brl(v.credito_usado)); par("Valor da nota fiscal", brl(v.valor_nf), { b: 1 }); }
  sep();
  linha("PAGAMENTO", { b: 1 });
  (v.pagamentos || []).forEach(p => {
    par((FORMAS[p.forma] || p.forma) + (p.forma === "credito" ? ` em ${p.parcelas}x` : ""), brl(p.valor));
    if (eCartao(p) && p.cv) linha("  CV " + p.cv);
  });
  if (v.observacao) { sep(); quebra("Obs.: " + v.observacao); }
  sep();
  quebra("Prazo de troca: 30 dias, com esta via e a etiqueta na peça.", { c: 1 });
  linha(""); quebra("Obrigada pela preferência!", { c: 1, b: 1 });
  quebra("Instagram: @linumipanema", { c: 1 });
  linha(""); quebra("Emitido em " + quando(new Date().toISOString()), { c: 1 });
  return L;
}

// linha em letra dupla (metade das colunas): "TOTAL ......... R$ 849,00" refeita para caber
function termGrande(t, w) {
  const w2 = Math.floor(w / 2), m = t.replace(/\s{2,}/g, "  ").match(/^(.*?\S)\s{2,}(\S.*)$/);
  if (!m) return t.trim();
  return m[1].length + m[2].length + 1 <= w2 ? m[1] + " ".repeat(w2 - m[1].length - m[2].length) + m[2] : m[1] + " " + m[2];
}

// ESC/POS: ESC @ (inicia), ESC a (alinhamento), ESC E (negrito), GS ! (tamanho duplo), ESC d (avança linhas)
function termBytes(L, cfg) {
  const enc = new TextEncoder(), b = [];
  const cmd = (...x) => b.push(...x), txt = t => b.push(...enc.encode(termLimpo(t, cfg.acentos)));
  cmd(0x1b, 0x40);
  for (const l of L) {
    cmd(0x1b, 0x61, l.c ? 1 : 0); cmd(0x1b, 0x45, l.b ? 1 : 0);
    if (l.g) {
      cmd(0x1d, 0x21, 0x11);   // letra dupla = metade das colunas
      txt(l.c ? l.t : termGrande(l.t, cfg.colunas));
      cmd(0x1d, 0x21, 0x00);
    } else txt(l.t);
    cmd(0x0a);
  }
  cmd(0x1b, 0x45, 0, 0x1b, 0x61, 0, 0x1b, 0x64, 4);
  return new Uint8Array(b);
}

function termTeste(cfg) {
  const w = cfg.colunas, L = [{ t: "TESTE DA IMPRESSORA", c: 1, b: 1 }, { t: "Sistema Linum", c: 1 }, { t: "-".repeat(w) },
    { t: "Acentos: ação, pão, café, você, Gávea" }, { t: "Régua de " + w + " colunas:" }, { t: "1234567890".repeat(Math.ceil(w / 10)).slice(0, w) },
    { t: "|" + " ".repeat(w - 2) + "|" }, { t: "TOTAL      R$ 1.234,56", b: 1, g: 1 }, { t: "Se a régua quebrou em 2 linhas, use menos colunas.", c: 0 },
    { t: "Se os acentos sairam errados, desmarque \"Imprimir acentos\"." }];
  return termBytes(L, cfg);
}

// prévia na tela e impressão pelo navegador (papel de 80 mm: impressora instalada no computador ou app de impressão)
function termHtml(L, cfg) {
  const w = cfg.colunas;
  return L.map(l => {
    let t = termLimpo(l.g && !l.c ? termGrande(l.t, w) : l.t, cfg.acentos);
    if (l.c) t = " ".repeat(Math.max(0, Math.floor(((l.g ? Math.floor(w / 2) : w) - t.length) / 2))) + t;   // na letra dupla o espaço também é duplo
    return `<div class="${l.b ? "b " : ""}${l.g ? "g" : ""}">${esc(t) || "&nbsp;"}</div>`;
  }).join("");
}
function termNavegador(v, its, c) {
  const cfg = termCfg(), L = termExtrato(v, its, c, cfg.colunas);
  const w = window.open("", "_blank"); if (!w) return msg("err", "O navegador bloqueou a janela de impressão.");
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Extrato da venda nº ${v.id} — Linum</title>
    <style>@page{size:80mm auto;margin:3mm}body{margin:0;font:11px/1.25 "Courier New",monospace;color:#000}
    .p{width:72mm;white-space:pre;overflow:hidden}.b{font-weight:700}.g{font-size:20px;line-height:1.2}</style></head><body><div class="p">${termHtml(L, Object.assign({}, cfg, { acentos: true }))}</div></body></html>`);
  w.document.close(); w.focus(); w.print();
}

// ---------------------------------------------------------------- tela
function termStatus() {
  const s = document.getElementById("tmstatus"); if (!s) return;
  s.innerHTML = !termSuporta() ? '<span class="tag fora">sem Bluetooth neste navegador</span>'
    : termConectada() ? `<span class="tag">conectada: ${esc(TERM.dev.name || "impressora")}</span>`
    : TERM.dev ? `<span class="mut">${esc(TERM.dev.name || "impressora")} (desconectada; conecta de novo ao imprimir)</span>` : '<span class="mut">nenhuma escolhida ainda</span>';
}

// janela do extrato: prévia + imprimir na térmica / pelo navegador; titulo = texto de cima (ex.: "Venda nº 12 registrada")
function extratoVenda(v, its, c, titulo) {
  const g = $("dlg2f"), cfg = termCfg();
  g.innerHTML = `<h3>${esc(titulo || `Extrato da venda nº ${v.id}`)}</h3>
    <div class="mut">Espelho da venda para a cliente, na impressora térmica de 80 mm. Não é documento fiscal.</div>
    <div class="campo">Impressora: <span id="tmstatus"></span></div>
    <div class="tmprev" id="tmprev"></div>
    <details class="campo"><summary>Ajustes da impressora</summary>
      <div class="duas"><div><label for="tmcol">Colunas por linha</label><select id="tmcol">${[48, 42, 32].map(x => `<option value="${x}"${cfg.colunas === x ? " selected" : ""}>${x}${x === 48 ? " (80 mm, letra normal)" : x === 32 ? " (papel de 58 mm)" : ""}</option>`).join("")}</select></div>
        <div><label><input type="checkbox" id="tmac"${cfg.acentos ? " checked" : ""}> Imprimir acentos</label><div class="mut" style="font-size:12px">Desmarque se sair “Ã§” no lugar do “ç”.</div></div></div>
      <div class="acoes" style="justify-content:flex-start"><button type="button" class="bt" id="tmteste">Imprimir teste</button><button type="button" class="bt" id="tmoutra">Escolher outra impressora</button></div>
      <div class="mut" style="font-size:12px">Primeira vez: ligue a impressora, toque em “Imprimir na térmica” e escolha <b>YY0808</b> na lista do navegador. Funciona no Chrome (Android) e no Chrome/Edge (computador); no iPhone não funciona.</div>
    </details>
    <div id="tmerr"></div>
    <div class="acoes"><button type="button" class="bt" id="tmfechar">Fechar</button><button type="button" class="bt" id="tmnav">Imprimir pelo navegador (80 mm)</button><button type="button" class="bt pri" id="tmimp">Imprimir na térmica</button></div>`;
  const prev = () => { const c2 = termCfg(); $("tmprev").style.setProperty("--col", c2.colunas); $("tmprev").innerHTML = termHtml(termExtrato(v, its, c, c2.colunas), c2); };
  const erro = t => { $("tmerr").innerHTML = t ? `<div class="msg err">${esc(t)}</div>` : ""; };
  const imprimir = async (bytes, escolher, bt) => {
    erro(""); const txt = bt.textContent; bt.disabled = true; bt.textContent = "Imprimindo…";
    try { await termEnviar(bytes, escolher); bt.textContent = "Impresso ✓"; setTimeout(() => { if (bt.isConnected) bt.textContent = txt; }, 2500); }
    catch (e) { erro(e.message); bt.textContent = txt; }
    finally { bt.disabled = false; termStatus(); }
  };
  $("tmcol").onchange = e => { termGuardar(Object.assign(termCfg(), { colunas: +e.target.value })); prev(); };
  $("tmac").onchange = e => { termGuardar(Object.assign(termCfg(), { acentos: e.target.checked })); prev(); };
  $("tmimp").onclick = () => imprimir(termBytes(termExtrato(v, its, c, termCfg().colunas), termCfg()), false, $("tmimp"));
  $("tmteste").onclick = () => imprimir(termTeste(termCfg()), false, $("tmteste"));
  $("tmoutra").onclick = () => imprimir(termTeste(termCfg()), true, $("tmoutra"));
  $("tmnav").onclick = () => termNavegador(v, its, c);
  $("tmfechar").onclick = () => $("dlg2").close();
  prev(); termStatus();
  if (!$("dlg2").open) $("dlg2").showModal();
}

// depois de registrar a venda: busca a venda gravada e abre o extrato
async function extratoDepoisDaVenda(id, cli) {
  try {
    const [{ data: v, error: e1 }, { data: its, error: e2 }] = await Promise.all([
      sb.from("lin_vendas").select("*").eq("id", id).maybeSingle(),
      sb.from("lin_venda_itens").select("*").eq("venda_id", id).order("id")]);
    if (e1 || e2) throw new Error((e1 || e2).message);
    if (!v) return;
    extratoVenda(v, its || [], cli || (v.cliente_id ? cliente(v.cliente_id) : null), `Venda nº ${id} registrada`);
  } catch (e) { msg("err", "Venda registrada, mas não consegui abrir o extrato: " + e.message); }
}
