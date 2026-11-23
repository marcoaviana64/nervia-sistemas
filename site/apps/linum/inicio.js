// Sistema Linum 2.62 — aba INÍCIO (pedido do Marco em 23/11/2026: "uma aba logo no início com informações relevantes do
// sistema: aniversários desta semana com clique levando para quem faz aniversário, ajustes e malinhas vencendo esta semana,
// produtos com estoque até 5 unidades, cores e tamanhos que mais vendem e o que precisa de atenção sem ficar procurando;
// cada um vê o que já pode ver, seguindo as regras que já temos").
// Tudo é lido pelas regras que já existem (RLS e funções): a vendedora vê as próprias vendas, o Estoque e a Dona o que já
// veem nas abas deles. Só o ranking de cores e tamanhos tem função própria (lin_mais_vendidos), e é só da Dona e do Estoque
// (decisão do Marco), em peças, sem valores. Cada quadro leva à tela onde se resolve a pendência.
// Usa as globais do index.html (sb, $, esc, checar, n, brl, LOJAS, loja, PRODUTOS, QTD/qtd, MINHA_LOJA, EU, hoje, dataBR,
// somaDias, dono, controla, todas, CLIENTES, carregarClientes, fichaCliente, fichaAjuste, TRANSITO, PROMOS, irPara, F...).

const FIN = { loja: null, dias: 30 };
const IN_LIMITE = 5;          // estoque baixo: até 5 peças da cor/tamanho na loja
const IN_SEMANA = 7;          // "esta semana" = hoje e os próximos 6 dias

// próximos aniversários (hoje + 6 dias), pela data do aniversário no ano
function inAniversarios(clientes) {
  const h = new Date(hoje() + "T12:00:00Z"), r = [];
  for (let i = 0; i < IN_SEMANA; i++) {
    const d = new Date(h); d.setUTCDate(h.getUTCDate() + i);
    const dia = d.getUTCDate(), mes = d.getUTCMonth() + 1;
    clientes.filter(c => Number(c.aniversario_dia) === dia && Number(c.aniversario_mes) === mes)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).forEach(c => r.push({ c, i, data: d.toISOString().slice(0, 10) }));
  }
  return r;
}

// cores/tamanhos com 1 a 5 peças na loja, juntos por peça
function inEstoqueBaixo(lojaId) {
  const lojas = lojaId ? LOJAS.filter(l => l.id === lojaId) : LOJAS, r = [];
  let zerados = 0;
  for (const p of PRODUTOS) {
    const itens = [];
    for (const v of (p.variantes || [])) for (const l of lojas) {
      const q = qtd(v.id, l.id);
      if (q >= 1 && q <= IN_LIMITE) itens.push({ v, l, q });
      else if (q === 0) zerados++;
    }
    if (itens.length) r.push({ p, itens, menor: Math.min(...itens.map(x => x.q)) });
  }
  r.sort((a, b) => a.menor - b.menor || a.p.descricao.localeCompare(b.p.descricao, "pt-BR"));
  return { lista: r, variacoes: r.reduce((s, x) => s + x.itens.length, 0), zerados };
}

async function telaInicio() {
  $("tela").innerHTML = '<div class="card">Carregando…</div>';
  if (FIN.loja === null) FIN.loja = MINHA_LOJA || "";
  const h = hoje(), sem = somaDias(h, IN_SEMANA - 1);
  const leve = p => p.then(r => r && r.error ? null : r && "data" in r ? r.data : r).catch(() => null);   // um quadro com erro não derruba a tela
  const [ajs, conds, vendasHoje, semCli, vendas30, benefs, mais] = await Promise.all([
    leve(carregarClientes()),
    leve(sb.from("lin_ajustes").select("*").in("situacao", ["na_costureira", "pronto"]).order("prazo")),
    leve(sb.from("lin_condicionais").select("*").eq("situacao", "aberta").lte("prazo", sem).order("prazo")),
    leve(sb.from("lin_vendas").select("id, loja_id, valor_total, vendedora_nome").eq("data", h).is("cancelada_em", null)),
    leve(sb.rpc("lin_vendas_sem_cliente", { p_dias: 30 })),
    leve(sb.from("lin_vendas").select("id, data, loja_id, vendedora_nome, valor_total, pagamentos, cancelada_em").gte("data", somaDias(h, -29)).is("cancelada_em", null)),
    controla() ? leve(sb.from("lin_beneficiamentos").select("id, servico, beneficiador, previsto, loja_id").eq("situacao", "no_beneficiamento").lt("previsto", h)) : null,
    controla() ? leve(sb.rpc("lin_mais_vendidos", { p_dias: FIN.dias })) : null,
  ]).then(([, ...r]) => r);
  const ajustes = ajs || [];
  const condicionais = conds || [];
  const cdCli = condicionais.length && typeof cdLerClientes === "function" ? await cdLerClientes([...new Set(condicionais.map(c => c.cliente_id))]).catch(() => new Map()) : new Map();
  const nomeCli = id => { const c = cliente(id) || cdCli.get(id); return c ? c.nome : "cliente"; };
  const primeiro = s => String(s || "").trim().split(/\s+/)[0];

  // ---- quadros
  const quadro = (id, titulo, cont, corpo, acao, alerta) => `<div class="card inq${alerta ? " alerta" : ""}" id="${id}">
    <div class="inqcab"><h2>${titulo}${cont != null ? ` <span class="${alerta ? "badge" : "inqn"}">${n(cont)}</span>` : ""}</h2>${acao || ""}</div>${corpo}</div>`;
  const vazio = t => `<div class="mut">${t}</div>`;
  const linha = (attrs, esq, dir) => `<button type="button" class="inlin" ${attrs}><span>${esq}</span>${dir ? `<span class="mut">${dir}</span>` : ""}</button>`;
  const mais8 = (l, f, ir) => l.slice(0, 8).map(f).join("") + (l.length > 8 ? `<button type="button" class="lnk" data-inir="${ir}">e mais ${n(l.length - 8)}…</button>` : "");
  const quando = i => i === 0 ? '<span class="tag fora">hoje</span>' : i === 1 ? '<span class="tag possivel">amanhã</span>' : "";

  // vendas de hoje (cada um vê as próprias; a Dona, todas)
  const vh = vendasHoje || [];
  const porLoja = LOJAS.map(l => ({ l, vs: vh.filter(v => v.loja_id === l.id) })).filter(x => x.vs.length);
  const qVendas = quadro("invendas", dono() ? "Vendas de hoje" : "Suas vendas hoje", null,
    `<div class="inbig">${n(vh.length)} <small>venda(s)</small> · ${brl(vh.reduce((s, v) => s + Number(v.valor_total), 0))}</div>
     ${porLoja.length > 1 ? porLoja.map(x => `<div class="mut">${esc(x.l.nome)}: ${n(x.vs.length)} · ${brl(x.vs.reduce((s, v) => s + Number(v.valor_total), 0))}</div>`).join("") : ""}`,
    `<button type="button" class="lnk" data-inir="vendas">Abrir Vendas</button>`);

  // aniversários da semana
  const nv = inAniversarios(CLIENTES || []);
  const qNiver = quadro("inniver", "🎂 Aniversários da semana", nv.length,
    nv.length ? mais8(nv, x => linha(`data-incli="${x.c.id}"`, `${quando(x.i)} <b>${esc(x.c.nome)}</b>`, `${dataBR(x.data).slice(0, 5)}${x.c.telefone ? " · " + esc(fone(x.c.telefone)) : ""}`), "clientes")
      : vazio("Nenhuma cliente faz aniversário nos próximos 7 dias."));

  // contatos do CRM para fazer (a Dona vê todos; os outros, os que acompanham)
  const agenda = (CLIENTES || []).filter(c => c.proximo_contato && c.proximo_contato <= h && (dono() || c.responsavel_id === EU))
    .sort((a, b) => a.proximo_contato.localeCompare(b.proximo_contato));
  const atrasCt = agenda.filter(c => c.proximo_contato < h).length;
  const qAgenda = quadro("inagenda", dono() ? "Clientes para contatar" : "Suas clientes para contatar", agenda.length,
    agenda.length ? mais8(agenda, c => linha(`data-incli="${c.id}"`, `<b>${esc(c.nome)}</b>${c.proximo_contato < h ? ' <span class="tag fora">atrasado</span>' : ' <span class="tag ok">hoje</span>'}`,
      `${dataBR(c.proximo_contato).slice(0, 5)}${dono() && c.responsavel_nome ? " · " + esc(primeiro(c.responsavel_nome)) : ""}`), "clientes")
      : vazio("Nenhum contato marcado para hoje."), "", atrasCt > 0);

  // ajustes: com a costureira vencendo na semana (ou atrasados) e prontos esperando a cliente
  const ajSem = ajustes.filter(a => a.situacao === "na_costureira" && a.prazo <= sem), ajPront = ajustes.filter(a => a.situacao === "pronto");
  const ajAtr = ajSem.filter(a => a.prazo < h).length;
  const qAjustes = quadro("inajustes", "✂ Ajustes", ajSem.length + ajPront.length,
    (ajSem.length ? `<div class="insub">Com a costureira, volta até ${dataBR(sem).slice(0, 5)}</div>` + mais8(ajSem, a => linha(`data-inaj="${a.id}"`,
        `${a.prazo < h ? '<span class="tag fora">atrasado</span> ' : ""}<b>${esc(a.peca || "")}</b> · ${esc(a.servico || "")} · ${esc(primeiro(nomeCli(a.cliente_id)))}`,
        `volta ${dataBR(a.prazo).slice(0, 5)} · ${esc(a.costureira || "")}`), "ajustes") : "")
    + (ajPront.length ? `<div class="insub">Prontos na loja, esperando a cliente</div>` + mais8(ajPront, a => linha(`data-inaj="${a.id}"`,
        `<span class="tag ok">pronto</span> <b>${esc(a.peca || "")}</b> · ${esc(primeiro(nomeCli(a.cliente_id)))}`, `${esc(loja(a.loja_id).nome)}`), "ajustes") : "")
    || vazio("Nenhum ajuste vencendo nesta semana."), "", ajAtr > 0);

  // malinhas e reservas vencendo na semana (ou atrasadas)
  const cdAtr = condicionais.filter(c => c.prazo < h).length;
  const qCond = quadro("incond", "👜 Malinhas e reservas", condicionais.length,
    condicionais.length ? mais8(condicionais, c => linha(`data-incd="${c.id}"`,
      `${c.prazo < h ? '<span class="tag fora">atrasada</span> ' : ""}${c.tipo === "reserva" ? "Reserva" : "Malinha"} nº ${c.id} · <b>${esc(nomeCli(c.cliente_id))}</b>`,
      `prazo ${dataBR(c.prazo).slice(0, 5)} · ${esc(loja(c.loja_id).nome)}`), "condicionais")
      : vazio("Nenhuma malinha ou reserva vencendo nesta semana."), "", cdAtr > 0);

  // estoque baixo
  const eb = inEstoqueBaixo(FIN.loja);
  const pilL = (v, t) => `<button type="button" class="pilula ${FIN.loja === v ? "on" : ""}" data-inloja="${v}">${esc(t)}</button>`;
  const qBaixo = quadro("inbaixo", `📦 Estoque baixo (até ${IN_LIMITE} peças)`, eb.variacoes,
    `<div class="filtros" style="margin:0 0 6px">${pilL("", "Todas as lojas")}${LOJAS.map(l => pilL(l.id, l.nome)).join("")}</div>
     ${eb.lista.length ? mais8(eb.lista, x => linha(`data-inpeca="${x.p.id}"`, `<b>${esc(x.p.referencia || "")} ${esc(x.p.descricao)}</b>`,
        x.itens.sort((a, b) => a.q - b.q).slice(0, 6).map(i => `${esc([i.v.cor, i.v.tamanho].filter(Boolean).join(" "))}${LOJAS.length > 1 && !FIN.loja ? " (" + esc(i.l.nome) + ")" : ""}: ${i.q}`).join(" · ") + (x.itens.length > 6 ? " …" : "")), "estoque")
      : vazio("Nenhuma cor/tamanho com 1 a 5 peças.")}
     <div class="mut" style="margin-top:4px">${n(eb.zerados)} cor(es)/tamanho(s) sem peça${FIN.loja ? " nesta loja" : " nas lojas"} (ficam fora desta lista).</div>`);

  // transferências em trânsito
  const tr = TRANSITO || [], paraMim = MINHA_LOJA ? tr.filter(t => t.destino_id === MINHA_LOJA).length : 0;
  const qTransf = tr.length ? quadro("intransf", "🚚 Transferências em trânsito", tr.length,
    `<div>${n(tr.length)} transferência(s) esperando a conferência na loja de destino${paraMim ? ` · <b>${n(paraMim)} para ${esc(loja(MINHA_LOJA).nome)}</b>` : ""}.</div>`,
    `<button type="button" class="lnk" data-inir="transferencias">Conferir e receber</button>`, true) : "";

  // promoções que terminam ou começam nesta semana
  const prs = (PROMOS || []).filter(p => !p.cancelada_em && p.fim >= h && (p.fim <= sem || (p.inicio > h && p.inicio <= sem)));
  const qPromo = prs.length ? quadro("inpromo", "🏷 Promoções", prs.length,
    prs.map(p => linha(`data-inir="promocoes"`, `<b>${esc(p.nome)}</b> ${p.inicio > h ? `<span class="tag possivel">começa ${dataBR(p.inicio).slice(0, 5)}</span>` : `<span class="tag lento">termina ${dataBR(p.fim).slice(0, 5)}</span>`}`,
      p.loja_id ? esc(loja(p.loja_id).nome) : "todas as lojas")).join("")) : "";

  // vendas para completar (sem cliente; cartão sem o CV do comprovante)
  const sc = semCli || [], cv = (vendas30 || []).filter(semCv);
  const qComp = sc.length || cv.length ? quadro("incompletar", "Vendas para completar", sc.length + cv.length,
    (sc.length ? linha(`data-inir="vendas"`, `<b>${n(sc.length)}</b> venda(s) sem a cliente`, "últimos 30 dias") : "")
    + (cv.length ? linha(`data-inir="vendas"`, `<b>${n(cv.length)}</b> venda(s) no cartão sem o CV do comprovante`, "últimos 30 dias") : "")) : "";

  // só Dona e Estoque: beneficiamento atrasado, referências provisórias e o que mais vende
  let qBenef = "", qProv = "", qMais = "";
  if (controla()) {
    const bf = benefs || [];
    if (bf.length) qBenef = quadro("inbenef", "⟳ Beneficiamento atrasado", bf.length,
      bf.map(b => linha(`data-inir="beneficiamento"`, `Nº ${b.id} · <b>${esc(b.servico || "")}</b> · ${esc(b.beneficiador || "")}`, `previsto ${dataBR(b.previsto).slice(0, 5)}`)).join(""), "", true);
    const prov = PRODUTOS.filter(refProvisoria);
    if (prov.length) qProv = quadro("inprov", "Referências provisórias", prov.length,
      mais8(prov, p => linha(`data-inprov="${p.id}"`, `<b>${esc(p.referencia)}</b> ${esc(p.descricao)}`, "trocar pela referência certa"), "produtos"));
    const m = mais || { cores: [], tamanhos: [], produtos: [], pecas: 0 };
    const barras = (l, k) => { const max = Math.max(1, ...l.map(x => Number(x.pecas)));
      return l.slice(0, 8).map(x => `<div class="inbar"><span>${esc(x[k])}</span><i style="width:${Math.round(Number(x.pecas) / max * 100)}%"></i><b>${n(x.pecas)}</b></div>`).join("") || vazio("Sem vendas no período."); };
    const pilD = (v, t) => `<button type="button" class="pilula ${FIN.dias === v ? "on" : ""}" data-indias="${v}">${t}</button>`;
    qMais = quadro("inmais", "O que mais vende", null,
      `<div class="filtros" style="margin:0 0 6px">${pilD(30, "30 dias")}${pilD(90, "90 dias")}${pilD(365, "1 ano")}<span class="mut">${n(m.pecas)} peça(s) vendida(s)</span></div>
       <div class="ingrade3"><div><div class="insub">Cores</div>${barras(m.cores, "cor")}</div><div><div class="insub">Tamanhos</div>${barras(m.tamanhos, "tamanho")}</div>
       <div><div class="insub">Peças</div>${barras((m.produtos || []).map(p => ({ nome: [p.referencia, p.descricao].filter(Boolean).join(" "), pecas: p.pecas })), "nome")}</div></div>`);
  }

  $("tela").innerHTML = `<div class="cabtela"><h2>Início</h2><span class="mut">${esc(new Date(h + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" }))}</span></div>
    <div class="ingrade">${[qVendas, qAgenda, qNiver, qAjustes, qCond, qTransf, qComp, qBenef, qPromo, qBaixo, qProv].filter(Boolean).join("")}</div>${qMais}`;

  // ---- cliques
  document.querySelectorAll("[data-inir]").forEach(b => b.onclick = () => irPara(b.dataset.inir));
  document.querySelectorAll("[data-incli]").forEach(b => b.onclick = () => fichaCliente(b.dataset.incli));
  document.querySelectorAll("[data-inaj]").forEach(b => b.onclick = () => { const a = ajustes.find(x => String(x.id) === b.dataset.inaj); if (a) fichaAjuste(a, () => telaInicio()); });
  document.querySelectorAll("[data-incd]").forEach(b => b.onclick = () => abrirCondicional(+b.dataset.incd).catch(e => msg("err", e.message)));
  document.querySelectorAll("[data-inpeca]").forEach(b => b.onclick = () => { const p = PRODUTOS.find(x => String(x.id) === b.dataset.inpeca);
    Object.assign(F, { q: p ? (p.referencia || p.descricao) : "", loja: FIN.loja || "", cat: "", cor: "", tam: "", prov: false, promo: false }); irPara("estoque"); });
  document.querySelectorAll("[data-inprov]").forEach(b => b.onclick = () => { Object.assign(F, { q: "", loja: "", cat: "", cor: "", tam: "", prov: true, promo: false }); irPara("estoque"); });
  document.querySelectorAll("[data-inloja]").forEach(b => b.onclick = () => { FIN.loja = b.dataset.inloja; telaInicio(); });
  document.querySelectorAll("[data-indias]").forEach(b => b.onclick = () => { FIN.dias = +b.dataset.indias; telaInicio(); });
}
