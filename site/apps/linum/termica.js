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

// construtor das linhas { t: texto, c: centro, b: negrito, g: grande }; serve para a térmica e para a prévia/impressão do navegador
function termMontar(w) {
  const L = [], o = { L, w };
  o.linha = (t, op = {}) => L.push(Object.assign({ t }, op));
  o.sep = () => o.linha("-".repeat(w));
  o.quebra = (t, op) => termQuebrar(t, w).forEach(x => o.linha(x, op));
  o.par = (a, b, op) => termPar(a, b, w).forEach(x => o.linha(x, op));
  o.cabecalho = nomeLoja => {
    o.linha("LINUM", { c: 1, b: 1, g: 1 }); o.linha("Roupas de Linho", { c: 1 });
    o.quebra("Loja " + nomeLoja, { c: 1 });
    (TERM_ENDERECOS[nomeLoja] || []).forEach(t => o.quebra(t, { c: 1 }));
    o.quebra("atendimento@linummm.com.br", { c: 1 });   // com 3 "m" mesmo (confirmado pelo Marco em 23/11/2026)
    o.sep();
  };
  o.via = (via, rot) => { if (via) o.quebra((rot && rot[via]) || (via === "loja" ? "VIA DA LOJA" : "VIA DA CLIENTE"), { c: 1 }); };
  o.cliente = (c, cpfTambem) => {
    if (!c || !c.nome) return o.linha("Cliente: não informada");
    o.quebra("Cliente: " + c.nome, { b: 1 });
    const d = [cpfTambem && c.cpf ? "CPF " + termCpf(c.cpf) : "", c.telefone ? "Tel. " + fone(c.telefone) : ""].filter(Boolean).join("  ");
    if (d) o.quebra(d);
  };
  o.assinatura = nome => { o.linha(""); o.linha(""); o.linha(""); o.linha("_".repeat(Math.min(w, 36)), { c: 1 }); o.quebra(nome || "Assinatura da cliente", { c: 1 }); };
  o.rodape = () => { o.linha(""); o.quebra("Emitido em " + quando(new Date().toISOString()), { c: 1 }); };
  return o;
}
const termCpf = x => x && x.length === 11 ? `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}` : (x || "");
const termPrimeiro = nome => String(nome || "").trim().split(/\s+/)[0] || "";

// extrato da venda (2.56)
function termExtrato(v, its, c, w) {
  const m = termMontar(w), { linha, sep, quebra, par } = m;
  m.cabecalho(loja(v.loja_id).nome);
  if (v.cancelada_em) quebra("*** VENDA CANCELADA ***", { c: 1, b: 1 });
  quebra(`EXTRATO DA VENDA Nº ${v.id}`, { c: 1, b: 1 });
  quebra("Não é documento fiscal", { c: 1 });
  sep();
  par("Data: " + dataBR(v.data), "Vendedora: " + termPrimeiro(v.vendedora_nome));
  m.cliente(c, true);
  sep();
  let pecas = 0;
  its.forEach(i => {
    pecas += Number(i.quantidade);
    quebra(`${i.referencia} ${i.descricao}`, { b: 1 });
    const det = [i.cor, i.tamanho, i.edicao].filter(Boolean).join(" - ");
    if (det) quebra("  " + det);
    par(`  ${Number(i.quantidade)} x ${brl(i.valor_unitario)}`, brl(i.valor_total));
    if (Number(i.desconto_pct)) quebra(`  (tabela ${brl(i.preco_tabela)}, desconto ${String(i.desconto_pct).replace(".", ",")}%)`);
    if (i.promocao_nome) quebra("  Promoção: " + i.promocao_nome);
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
  m.rodape();
  return m.L;
}

// comprovante da malinha / reserva (2.57): o que saiu com a cliente, o prazo e, depois da volta, o que comprou e devolveu
function termCondicional(c, its, cli, w, via) {
  const m = termMontar(w), { linha, sep, quebra, par } = m, mal = c.tipo === "malinha";
  m.cabecalho(loja(c.loja_id).nome);
  quebra(mal ? `MALINHA (CONDICIONAL) Nº ${c.id}` : `RESERVA DE PEÇAS Nº ${c.id}`, { c: 1, b: 1 });
  m.via(via);
  sep();
  par("Saída: " + quando(c.criado_em), "Atendente: " + termPrimeiro(c.responsavel_nome));
  m.cliente(cli);
  if (c.situacao === "aberta") quebra((mal ? "Devolver até: " : "Retirar até: ") + dataBR(c.prazo), { b: 1 });
  sep();
  let pecas = 0, total = 0, fora = 0, mexeu = false;
  its.forEach(i => {
    const q = Number(i.quantidade), pr = Number(i.preco_venda || 0), pend = q - Number(i.compradas) - Number(i.devolvidas);
    pecas += q; total += q * pr; fora += pend; if (Number(i.compradas) || Number(i.devolvidas)) mexeu = true;
    quebra(`${i.referencia || ""} ${i.descricao}`.trim(), { b: 1 });
    const det = [i.cor, i.tamanho, i.edicao].filter(Boolean).join(" - ");
    if (det) quebra("  " + det);
    par(`  ${q} x ${i.preco_venda != null ? brl(pr) : "-"}`, i.preco_venda != null ? brl(q * pr) : "");
    if (Number(i.compradas) || Number(i.devolvidas)) quebra(`  comprou ${n(i.compradas)} - voltou ${n(i.devolvidas)} - com a cliente ${n(pend)}`);
  });
  sep();
  par(`${pecas} peça${pecas === 1 ? "" : "s"} - preço de venda`, brl(total), { b: 1 });
  if (mexeu) par("Com a cliente agora", `${fora} peça${fora === 1 ? "" : "s"}`, { b: 1 });
  if (c.situacao !== "aberta" && c.concluido_em) quebra((mal ? "Malinha" : "Reserva") + " concluída em " + quando(c.concluido_em));
  if (c.observacao) quebra("Obs.: " + c.observacao);
  sep();
  if (c.situacao !== "aberta") quebra("As peças compradas e devolvidas estão indicadas acima.");
  else quebra(mal ? `Recebi as peças acima para experimentar. As que eu não comprar serão devolvidas à loja até ${dataBR(c.prazo)}, nas mesmas condições em que foram entregues.`
    : `Peças separadas para a cliente até ${dataBR(c.prazo)}. Depois do prazo a reserva pode ser desfeita.`);
  if (via !== "cliente") m.assinatura(cli && cli.nome);
  m.rodape();
  return m.L;
}

// comprovante do ajuste (2.57): ao deixar a peça (para a cliente retirar depois) e na entrega (a cliente assina)
function termAjuste(a, cli, w, via) {
  const m = termMontar(w), { linha, sep, quebra, par } = m, entregue = a.situacao === "entregue";
  m.cabecalho(loja(a.loja_id).nome);
  quebra(entregue ? `ENTREGA DE AJUSTE Nº ${a.id}` : `COMPROVANTE DE AJUSTE Nº ${a.id}`, { c: 1, b: 1 });
  m.via(via);
  sep();
  par("Venda nº " + a.venda_id, "Deixada em " + quando(a.enviado_em));
  m.cliente(cli);
  sep();
  quebra(`${a.quantidade > 1 ? a.quantidade + " x " : ""}${a.peca}`, { b: 1 });
  quebra("Ajuste: " + a.servico);
  par("Valor do ajuste", Number(a.valor_cliente) ? brl(a.valor_cliente) : "cortesia");
  if (a.situacao === "na_costureira") par("Previsão para retirar", dataBR(a.prazo), { b: 1 });
  if (a.situacao === "pronto") par("Pronta para retirar desde", quando(a.pronto_em), { b: 1 });
  if (entregue) { par("Entregue em", quando(a.entregue_em), { b: 1 }); if (a.entrega_obs) quebra("Obs.: " + a.entrega_obs); }
  if (a.situacao === "cancelado") quebra("*** AJUSTE CANCELADO ***", { c: 1, b: 1 });
  sep();
  if (entregue) { quebra("Recebi a peça com o ajuste feito."); if (via !== "cliente") m.assinatura(cli && cli.nome); }
  else if (a.situacao !== "cancelado") quebra("Apresente este comprovante para retirar a peça.", { c: 1 });
  m.rodape();
  return m.L;
}

// 2.63 (pedido do Marco em 24/11/2026: "transferência e beneficiamento ainda não têm impressão na térmica para ter
// comprovante de envio em papel"): comprovante da transferência entre lojas e da saída para beneficiamento, em 2 vias.
const TERM_VIAS_TR = { loja: "VIA DA LOJA DE ORIGEM", cliente: "VIA QUE VAI COM AS PEÇAS" };
const TERM_VIAS_BF = { loja: "VIA DA LOJA", cliente: "VIA DO BENEFICIADOR" };
const termPecaLinha = (m, i) => { m.quebra(`${i.referencia || ""} ${i.descricao || ""}`.trim(), { b: 1 }); const d = [i.cor, i.tamanho, i.edicao].filter(Boolean).join(" - "); return d; };
function termTransferencia(t, its, w, via) {
  const m = termMontar(w), { sep, quebra, par } = m, rec = t.situacao === "recebida" || t.situacao === "recebida_com_falta";
  m.cabecalho(loja(t.origem_id).nome);
  quebra(`TRANSFERÊNCIA ENTRE LOJAS Nº ${t.id}`, { c: 1, b: 1 });
  m.via(via, TERM_VIAS_TR);
  sep();
  par("De: " + loja(t.origem_id).nome, "Para: " + loja(t.destino_id).nome, { b: 1 });
  par("Enviada em " + quando(t.enviado_em), termPrimeiro(t.enviado_nome));
  if (t.situacao === "cancelada") quebra("*** TRANSFERÊNCIA CANCELADA ***", { c: 1, b: 1 });
  sep();
  let tot = 0, chegou = 0;
  its.forEach(i => {
    const q = Number(i.quantidade); tot += q; chegou += Number(i.recebida ?? 0);
    const d = termPecaLinha(m, i);
    par("  " + (d || "-"), `${q} un.`);
    if (rec && i.recebida != null && Number(i.recebida) < q) quebra(`  chegaram ${i.recebida} de ${q}`, { b: 1 });
  });
  sep();
  par(`Total enviado`, `${tot} peça${tot === 1 ? "" : "s"}`, { b: 1 });
  if (rec) { par("Total recebido", `${chegou} peça${chegou === 1 ? "" : "s"}`, { b: 1 });
    par("Recebida em " + quando(t.recebido_em), termPrimeiro(t.recebido_nome)); if (t.recebimento_obs) quebra("Obs. do recebimento: " + t.recebimento_obs); }
  if (t.observacao) quebra("Obs.: " + t.observacao);
  sep();
  if (t.situacao === "em_transito") {
    quebra(`As peças só entram no estoque de ${loja(t.destino_id).nome} depois de conferidas e recebidas no app.`);
    m.assinatura("Enviado por " + (t.enviado_nome || ""));
    m.linha(""); m.quebra("Conferido em ____/____/______", { c: 1 });
    m.assinatura("Recebido por (" + loja(t.destino_id).nome + ")");
  }
  m.rodape();
  return m.L;
}
function termBeneficiamento(b, its, w, via) {
  const m = termMontar(w), { sep, quebra, par } = m;
  m.cabecalho(loja(b.loja_id).nome);
  quebra(`SAÍDA PARA BENEFICIAMENTO Nº ${b.id}`, { c: 1, b: 1 });
  m.via(via, TERM_VIAS_BF);
  sep();
  quebra("Serviço: " + (b.servico || ""), { b: 1 });
  quebra("Quem faz: " + (b.beneficiador || ""));
  if (b.vai_virar) quebra("Vai virar: " + b.vai_virar);
  par("Saiu em " + quando(b.enviado_em), termPrimeiro(b.enviado_nome));
  if (b.previsto) par("Volta prevista", dataBR(b.previsto), { b: 1 });
  sep();
  let tot = 0, voltou = 0, perd = 0;
  its.forEach(i => {
    const q = Number(i.quantidade); tot += q; voltou += Number(i.voltaram || 0); perd += Number(i.perdidas || 0);
    const d = termPecaLinha(m, i);
    par("  " + (d || "-"), `${q} un.`);
    if (Number(i.voltaram) || Number(i.perdidas)) quebra(`  voltaram ${n(i.voltaram)} - perdidas ${n(i.perdidas)} - fora ${n(q - i.voltaram - i.perdidas)}`);
  });
  sep();
  par("Total enviado", `${tot} peça${tot === 1 ? "" : "s"}`, { b: 1 });
  if (voltou || perd) par("Voltaram / perdidas", `${voltou} / ${perd}`, { b: 1 });
  if (b.situacao === "concluido") quebra("Beneficiamento concluído em " + quando(b.concluido_em));
  if (b.observacao) quebra("Obs.: " + b.observacao);
  sep();
  if (b.situacao === "no_beneficiamento") {
    quebra(`Recebi as peças acima para o serviço "${b.servico || ""}"${b.previsto ? ", com volta prevista para " + dataBR(b.previsto) : ""}.`);
    if (via !== "cliente") m.assinatura("Recebido por " + (b.beneficiador || ""));
    else { m.linha(""); m.quebra("Apresente esta via ao devolver as peças.", { c: 1 }); }
  }
  m.rodape();
  return m.L;
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
function termNavegador(L, nome) {
  const cfg = termCfg();
  const w = window.open("", "_blank"); if (!w) return msg("err", "O navegador bloqueou a janela de impressão.");
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(nome)} — Linum</title>
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

// janela de impressão (prévia + térmica / navegador). op = { titulo, desc, nome, linhas(w, via), vias, aoFechar }
// vias = oferece "2 vias": a da loja (com a assinatura da cliente) e a da cliente, separadas por "destaque aqui"
function termJanela(op) {
  const g = $("dlg2f"), cfg = termCfg();
  const doisVias = () => op.vias && termCfg().vias !== false;
  const montar = w => !doisVias() ? op.linhas(w, null)
    : op.linhas(w, "loja").concat([{ t: "" }, { t: "" }, { t: "- - - destaque aqui - - -", c: 1 }, { t: "" }, { t: "" }], op.linhas(w, "cliente"));
  g.innerHTML = `<h3>${esc(op.titulo)}</h3>
    <div class="mut">${esc(op.desc)}</div>
    <div class="campo">Impressora: <span id="tmstatus"></span></div>
    ${op.vias ? `<label class="campo" style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:13px;font-weight:400;color:var(--ink)"><input type="checkbox" style="width:auto;flex:none;margin:0" id="tmvias"${cfg.vias !== false ? " checked" : ""}> Imprimir 2 vias (${esc(op.viasTexto || "a da loja, assinada pela cliente, e a da cliente")})</label>` : ""}
    <div class="tmprev" id="tmprev"></div>
    <details class="campo"><summary>Ajustes da impressora</summary>
      <div class="duas"><div><label for="tmcol">Colunas por linha</label><select id="tmcol">${[48, 42, 32].map(x => `<option value="${x}"${cfg.colunas === x ? " selected" : ""}>${x}${x === 48 ? " (80 mm, letra normal)" : x === 32 ? " (papel de 58 mm)" : ""}</option>`).join("")}</select></div>
        <div><label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:13px;font-weight:400;color:var(--ink)"><input type="checkbox" style="width:auto;flex:none;margin:0" id="tmac"${cfg.acentos ? " checked" : ""}> Imprimir acentos</label><div class="mut" style="font-size:12px">Desmarque se sair “Ã§” no lugar do “ç”.</div></div></div>
      <div class="acoes" style="justify-content:flex-start"><button type="button" class="bt" id="tmteste">Imprimir teste</button><button type="button" class="bt" id="tmoutra">Escolher outra impressora</button></div>
      <div class="mut" style="font-size:12px">Primeira vez: ligue a impressora, toque em “Imprimir na térmica” e escolha <b>YY0808</b> na lista do navegador. Funciona no Chrome (Android) e no Chrome/Edge (computador); no iPhone não funciona.</div>
    </details>
    <div id="tmerr"></div>
    <div class="acoes"><button type="button" class="bt" id="tmfechar">${op.voltar ? "Voltar" : "Fechar"}</button><button type="button" class="bt" id="tmnav">Imprimir pelo navegador (80 mm)</button><button type="button" class="bt pri" id="tmimp">Imprimir na térmica</button></div>`;
  const prev = () => { const c2 = termCfg(); $("tmprev").style.setProperty("--col", c2.colunas); $("tmprev").innerHTML = termHtml(montar(c2.colunas), c2); };
  const erro = t => { $("tmerr").innerHTML = t ? `<div class="msg err">${esc(t)}</div>` : ""; };
  const imprimir = async (bytes, escolher, bt) => {
    erro(""); const txt = bt.textContent; bt.disabled = true; bt.textContent = "Imprimindo…";
    try { await termEnviar(bytes, escolher); bt.textContent = "Impresso ✓"; setTimeout(() => { if (bt.isConnected) bt.textContent = txt; }, 2500); }
    catch (e) { erro(e.message); bt.textContent = txt; }
    finally { bt.disabled = false; termStatus(); }
  };
  $("tmcol").onchange = e => { termGuardar(Object.assign(termCfg(), { colunas: +e.target.value })); prev(); };
  $("tmac").onchange = e => { termGuardar(Object.assign(termCfg(), { acentos: e.target.checked })); prev(); };
  if ($("tmvias")) $("tmvias").onchange = e => { termGuardar(Object.assign(termCfg(), { vias: e.target.checked })); prev(); };
  $("tmimp").onclick = () => imprimir(termBytes(montar(termCfg().colunas), termCfg()), false, $("tmimp"));
  $("tmteste").onclick = () => imprimir(termTeste(termCfg()), false, $("tmteste"));
  $("tmoutra").onclick = () => imprimir(termTeste(termCfg()), true, $("tmoutra"));
  $("tmnav").onclick = () => termNavegador(montar(termCfg().colunas), op.nome || op.titulo);
  $("tmfechar").onclick = () => op.voltar ? op.voltar() : $("dlg2").close();
  if (op.aoFechar) $("dlg2").addEventListener("close", op.aoFechar, { once: true });
  prev(); termStatus();
  if (!$("dlg2").open) $("dlg2").showModal();
}

function extratoVenda(v, its, c, titulo) {
  termJanela({ titulo: titulo || `Extrato da venda nº ${v.id}`, nome: `Extrato da venda nº ${v.id}`,
    desc: "Espelho da venda para a cliente, na impressora térmica de 80 mm. Não é documento fiscal.", linhas: w => termExtrato(v, its, c, w) });
}
function comprovanteCondicional(c, its, cli, titulo) {
  const nome = `${c.tipo === "malinha" ? "Malinha" : "Reserva"} nº ${c.id}`;
  termJanela({ titulo: titulo || `Comprovante · ${nome}`, nome, vias: true,
    desc: c.tipo === "malinha" ? "Comprovante das peças que saíram com a cliente: ela assina a via da loja e leva a dela."
      : "Comprovante das peças separadas para a cliente: ela assina a via da loja e leva a dela.",
    linhas: (w, via) => termCondicional(c, its, cli || {}, w, via) });
}
async function comprovanteAjuste(a, op = {}) {
  try { if (!CLIENTES.length) await carregarClientes(); } catch {}
  const entregue = a.situacao === "entregue";
  termJanela(Object.assign({ titulo: `Comprovante · ajuste nº ${a.id}`, nome: `Ajuste nº ${a.id}`, vias: entregue,
    desc: entregue ? "Comprovante de entrega da peça ajustada: a cliente assina a via da loja e leva a dela."
      : "Comprovante para a cliente retirar a peça depois do ajuste.",
    linhas: (w, via) => termAjuste(a, cliente(a.cliente_id), w, via) }, op));
}

function comprovanteTransferencia(t, its, op = {}) {
  const rec = t.situacao === "recebida" || t.situacao === "recebida_com_falta";
  termJanela(Object.assign({ titulo: `Comprovante · transferência nº ${t.id}`, nome: `Transferência nº ${t.id}`, vias: t.situacao === "em_transito",
    viasTexto: "uma fica na loja de origem e a outra vai com as peças para conferir e assinar",
    desc: rec ? "Comprovante do recebimento: o que foi enviado e o que chegou." : t.situacao === "cancelada" ? "Transferência cancelada: as peças voltaram para a loja de origem."
      : `Comprovante de envio: uma via fica em ${loja(t.origem_id).nome} e a outra vai com as peças para ${loja(t.destino_id).nome} conferir e assinar.`,
    linhas: (w, via) => termTransferencia(t, its, w, via) }, op));
}
async function comprovanteTransferenciaId(id, op) {
  const [{ data: t, error: e1 }, { data: its, error: e2 }] = await Promise.all([
    sb.from("lin_transferencias").select("*").eq("id", id).maybeSingle(),
    sb.from("lin_transferencia_itens").select("*").eq("transferencia_id", id).order("id")]);
  if (e1 || e2) throw new Error((e1 || e2).message);
  if (t) comprovanteTransferencia(t, its || [], op);
}
function comprovanteBeneficiamento(b, its, op = {}) {
  termJanela(Object.assign({ titulo: `Comprovante · beneficiamento nº ${b.id}`, nome: `Beneficiamento nº ${b.id}`, vias: b.situacao === "no_beneficiamento",
    viasTexto: "a da loja, assinada por quem recebe as peças, e a do beneficiador",
    desc: b.situacao === "no_beneficiamento" ? "Comprovante de saída das peças: quem faz o serviço assina a via da loja e leva a dele." : "Comprovante do beneficiamento com o que já voltou.",
    linhas: (w, via) => termBeneficiamento(b, its, w, via) }, op));
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
