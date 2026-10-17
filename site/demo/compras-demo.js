// Demonstração do Orçamentos de Compras: substitui o supabase-js por um "servidor" FICTÍCIO no navegador.
// Reproduz as regras das funções cmp_* do banco (supabase/migrations/..._compras.sql e ..._compras_fornecedor.sql)
// com as mesmas mensagens. Nada aqui acessa a rede ou o Supabase. Empresas, pessoas e documentos são inventados
// (CNPJ/CPF com dígito verificador propositalmente errado, para não coincidir com ninguém de verdade).
// Os dados ficam no localStorage do visitante (compartilhado entre a aba do comprador e a do fornecedor);
// "Recomeçar" apaga e volta ao início. Usado por /demo/compras/ e /demo/cotacao/ (gerados por divulgacao/demo/gerar.py).
(function () {
  "use strict";
  const CHAVE = "nervia_demo_compras_v1", CHAVE_PAPEL = "nervia_demo_compras_papel";
  // localStorage quando houver; sem ele (janela anônima restrita), memória da própria página
  const MEM = {};
  const ls = {
    get(k) { try { const v = localStorage.getItem(k); return v ?? MEM[k] ?? null; } catch (e) { return MEM[k] ?? null; } },
    set(k, v) { MEM[k] = v; try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { delete MEM[k]; try { localStorage.removeItem(k); } catch (e) {} },
  };
  const PESSOAS = {
    solicitante: { id: "u-sol", nome: "Carla Menezes", email: "carla.menezes@valeverde.exemplo", cargo: "Supervisora de manutenção" },
    comprador: { id: "u-com", nome: "Rafael Duarte", email: "rafael.duarte@valeverde.exemplo", cargo: "Comprador" },
    gerente: { id: "u-ger", nome: "Sônia Albuquerque", email: "sonia.albuquerque@valeverde.exemplo", cargo: "Gerente de operações" },
    diretor: { id: "u-dir", nome: "Augusto Prado", email: "augusto.prado@valeverde.exemplo", cargo: "Diretor da administradora" },
  };
  const papelAtual = () => { const p = ls.get(CHAVE_PAPEL); return PESSOAS[p] ? p : "comprador"; };
  let EU = PESSOAS[papelAtual()];
  const UNID = "un-valeverde";

  // ---------------------------------------------------------------- relógio (a carga inicial "volta no tempo")
  let RELOGIO = null;
  const agora = () => (RELOGIO ? new Date(RELOGIO) : new Date());
  const agoraISO = () => agora().toISOString();
  const hoje = () => agora().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const diaMais = (n) => { const d = agora(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }); };
  const r2 = (v) => Math.round(Number(v) * 100) / 100;
  const brl = (v) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dataBR = (iso) => iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "";
  const falha = (m) => { throw new Error(m); };

  // ---------------------------------------------------------------- estado
  let S = null;
  const carregarEstado = () => { const t = ls.get(CHAVE); if (t) { try { S = JSON.parse(t); return true; } catch (e) {} } return false; };
  const salvar = () => ls.set(CHAVE, JSON.stringify(S));
  const novoId = (t) => (S.seq[t] = (S.seq[t] || 0) + 1);

  function vazio() {
    return {
      seq: { req: 1000, prop: 0, aprov: 0, aval: 0, hist: 0, conv: 0 },
      perfis: Object.values(PESSOAS).map((p) => ({ user_id: p.id, email: p.email, nome: p.nome, admin: false })),
      unidades: [{ id: UNID, nome: "Shopping Vale Verde", cnpj: null, minimo_propostas: 3, alcada_automatica: 5000, alcada_gerente: 50000,
        pesos: { preco: 40, prazo: 30, pagamento: 20, qualidade: 10 }, ativo: true, criado_em: "2026-01-05T12:00:00Z" }],
      membros: Object.entries(PESSOAS).map(([papel, p]) => ({ user_id: p.id, unidade_id: UNID, papel })),
      grupos: ["Tecnologia", "Refrigeração", "Automação", "Energia", "Jardinagem", "Mão de obra", "Limpeza", "Segurança", "Obras civis", "Outros"]
        .map((nome, i) => ({ nome, ordem: (i + 1) * 10 })),
      fornecedores: [], avais: [], requisicoes: [], propostas: [], aprovacoes: [], avaliacoes: [], historico: [], convites: [], anexos: {},
    };
  }

  // ---------------------------------------------------------------- regras (espelho das funções do banco)
  const unidade = () => S.unidades[0];
  const temPapel = (papeis) => !!EU && S.membros.some((m) => m.user_id === EU.id && papeis.includes(m.papel));
  const forn = (id) => S.fornecedores.find((f) => f.id === id);
  const req = (id) => S.requisicoes.find((r) => r.id === Number(id));
  const totalP = (p, r) => r2(p.preco_unitario * r.quantidade + p.frete);
  const nomeAtual = () => (EU ? EU.nome : "sistema");

  function registrar(reqId, fornId, acao, texto, det, quemNome) {
    S.historico.push({ id: novoId("hist"), requisicao_id: reqId, fornecedor_id: fornId, unidade_id: UNID, quem: quemNome ? null : EU && EU.id,
      quem_nome: quemNome || nomeAtual(), acao, texto, detalhes: det || {}, em: agoraISO() });
  }
  function reqPara(id, papeis, status) {
    const r = req(id); if (!r) falha("Requisição não encontrada.");
    if (!temPapel(papeis)) falha(`Seu papel nesta unidade não permite esta ação (precisa ser: ${papeis.join(" ou ")}).`);
    if (!status.includes(r.status)) falha(`A requisição #${r.id} está "${r.status}" e não permite esta ação agora.`);
    return r;
  }
  function docValido(tipo, doc) {
    const s = String(doc || "").toUpperCase();
    if (tipo === "PF") {
      if (!/^\d{11}$/.test(s) || /^(.)\1{10}$/.test(s)) return false;
      let t = 0; for (let i = 0; i < 9; i++) t += +s[i] * (10 - i); let d1 = (t * 10) % 11; if (d1 === 10) d1 = 0;
      t = 0; for (let i = 0; i < 10; i++) t += +s[i] * (11 - i); let d2 = (t * 10) % 11; if (d2 === 10) d2 = 0;
      return d1 === +s[9] && d2 === +s[10];
    }
    if (tipo === "PJ") {
      if (!/^[0-9A-Z]{12}\d{2}$/.test(s) || /^(.)\1{13}$/.test(s)) return false;
      const dv = (n) => { let t = 0, w = n === 12 ? 5 : 6; for (let i = 0; i < n; i++) { t += (s.charCodeAt(i) - 48) * w; w = w === 2 ? 9 : w - 1; } const r = t % 11; return r < 2 ? 0 : 11 - r; };
      return dv(12) === +s[12] && dv(13) === +s[13];
    }
    return false;
  }
  const comprasDe = (fid) => S.requisicoes.filter((r) => ["aprovada", "pedido", "entregue", "concluida"].includes(r.status) && r.proposta_escolhida
    && (S.propostas.find((p) => p.id === r.proposta_escolhida) || {}).fornecedor_id === fid);

  function desfazEscolha(r, quemNome) {
    const tinha = r.proposta_escolhida;
    r.status = "cotacao"; r.proposta_escolhida = null; if (tinha) r.justificativa = ""; r.atualizado_em = agoraISO();
    if (tinha) registrar(r.id, null, "escolha_desfeita", "Escolha desfeita porque as propostas mudaram.", {}, quemNome);
  }

  const RPC = {
    cmp_fornecedores_lista() {
      return S.fornecedores.map((f) => {
        const av = S.avaliacoes.filter((a) => a.fornecedor_id === f.id);
        return { ...f,
          documento: f.tipo === "PJ" || f.cadastrado_por === (EU && EU.id) ? f.documento : "***" + f.documento.slice(3, 9) + "**",
          nota: av.length ? r2(av.reduce((s, a) => s + (a.prazo + a.qualidade + a.conformidade + a.atendimento) / 4, 0) / av.length) : null,
          avaliacoes: av.length, unidades_avaliacao: av.length ? [unidade().nome] : [],
          avais: S.avais.filter((v) => v.fornecedor_id === f.id).map((v) => ({ unidade_id: v.unidade_id, unidade: unidade().nome, por: v.dado_por_nome, em: v.dado_em })),
          compras: comprasDe(f.id).length };
      }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    },
    cmp_salvar_fornecedor(a) {
      const doc = String(a.p_documento || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
      if (!a.p_id) {
        if (!temPapel(["comprador", "gerente", "diretor"])) falha("Só comprador, gerente ou diretor da unidade cadastra fornecedor.");
        if (!docValido(a.p_tipo, doc)) falha(`${a.p_tipo === "PF" ? "CPF" : "CNPJ"} inválido (dígito verificador não confere). Confira o número.`);
        const ex = S.fornecedores.find((f) => f.documento === doc);
        if (ex) falha(`Este ${a.p_tipo === "PF" ? "CPF" : "CNPJ"} já está cadastrado: ${ex.nome} (por ${ex.cadastrado_nome} em ${dataBR(ex.cadastrado_em)}). Use o cadastro existente.`);
        const f = { id: "f-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), tipo: a.p_tipo, documento: doc, nome: String(a.p_nome || "").trim(),
          grupos: a.p_grupos || [], contato: a.p_contato || "", email: a.p_email || "", telefone: a.p_telefone || "", certidoes_validade: a.p_certidoes || null,
          obs: a.p_obs || "", cadastrado_por: EU.id, cadastrado_nome: EU.nome, cadastrado_unidade: UNID, cadastrado_em: agoraISO(), ativo: true };
        if (!f.nome) falha("Informe o nome.");
        S.fornecedores.push(f);
        registrar(null, f.id, "fornecedor_cadastrado", `Fornecedor cadastrado: ${f.nome} (${f.tipo}). Responsável pela homologação: ${EU.nome}`);
        return f.id;
      }
      const f = forn(a.p_id); if (!f) falha("Fornecedor não encontrado.");
      if (f.cadastrado_por !== EU.id) falha("Só quem cadastrou o fornecedor (responsável pela homologação) ou a equipe Nervia altera o cadastro.");
      Object.assign(f, { nome: String(a.p_nome || "").trim(), grupos: a.p_grupos || [], contato: a.p_contato || "", email: a.p_email || "",
        telefone: a.p_telefone || "", certidoes_validade: a.p_certidoes || null, obs: a.p_obs || "" });
      registrar(null, f.id, "fornecedor_alterado", "Cadastro alterado: " + f.nome);
      return f.id;
    },
    cmp_aval(a) {
      const f = forn(a.p_fornecedor); if (!f) falha("Fornecedor não encontrado.");
      if (!temPapel(["gerente"])) falha("Só o Gerente da unidade dá ou retira o aval.");
      const i = S.avais.findIndex((v) => v.fornecedor_id === f.id && v.unidade_id === UNID);
      if (a.p_dar && i < 0) { S.avais.push({ fornecedor_id: f.id, unidade_id: UNID, dado_por: EU.id, dado_por_nome: EU.nome, dado_em: agoraISO() }); registrar(null, f.id, "aval_dado", "Aval do Gerente dado a " + f.nome); }
      if (!a.p_dar && i >= 0) { S.avais.splice(i, 1); registrar(null, f.id, "aval_retirado", "Aval do Gerente retirado de " + f.nome); }
      return null;
    },
    cmp_salvar_proposta(a) {
      const r = reqPara(a.p_req, ["comprador"], ["nova", "cotacao"]);
      const f = forn(a.p_fornecedor); if (!f || !f.ativo) falha("Fornecedor não encontrado ou inativo.");
      if (f.certidoes_validade && f.certidoes_validade < hoje()) falha(`As certidões de ${f.nome} venceram em ${dataBR(f.certidoes_validade)}. Atualize o cadastro antes de registrar a proposta.`);
      if (a.p_preco == null || a.p_preco < 0 || a.p_prazo == null || a.p_prazo < 0 || isNaN(a.p_preco) || isNaN(a.p_prazo)) falha("Preço e prazo são obrigatórios.");
      const dados = { preco_unitario: r2(a.p_preco), frete: r2(a.p_frete || 0), custos_extras: r2(a.p_extras || 0), prazo_dias: Number(a.p_prazo),
        pagamento: a.p_pagamento || "À vista", pagamento_dias: Number(a.p_pagamento_dias || 0), validade: a.p_validade || null, obs: a.p_obs || "" };
      const ant = S.propostas.find((p) => p.requisicao_id === r.id && p.fornecedor_id === f.id);
      let id;
      if (ant && ant.origem === "fornecedor") falha(`A proposta de ${f.nome} foi enviada pelo próprio fornecedor e só ele altera (pelo link do convite). Você pode excluí-la com motivo.`);
      if (ant) {
        const totAnt = totalP(ant, r);
        if (dados.preco_unitario !== ant.preco_unitario) { ant.rodada += 1; ant.preco_anterior = ant.preco_unitario; }
        Object.assign(ant, dados, { atualizada_em: agoraISO() }); id = ant.id;
        registrar(r.id, f.id, "proposta_alterada", `Proposta de ${f.nome} alterada: ${brl(totAnt)} → ${brl(totalP(ant, r))}`);
      } else {
        const p = { id: novoId("prop"), requisicao_id: r.id, fornecedor_id: f.id, ...dados, rodada: 1, preco_anterior: null, registrada_por: EU.id,
          registrada_em: agoraISO(), atualizada_em: agoraISO(), origem: "comprador", convite_id: null, anexo: null, declarante: null, enviada_ip: null };
        S.propostas.push(p); id = p.id;
        registrar(r.id, f.id, "proposta_registrada", `Proposta de ${f.nome} registrada: total ${brl(totalP(p, r))}, prazo ${p.prazo_dias} dias, ${p.pagamento}`);
      }
      desfazEscolha(r);
      return id;
    },
    cmp_excluir_proposta(a) {
      const p = S.propostas.find((x) => x.id === Number(a.p_proposta)); if (!p) falha("Proposta não encontrada.");
      const r = reqPara(p.requisicao_id, ["comprador"], ["nova", "cotacao"]);
      const motivo = String(a.p_motivo || "").trim();
      if (p.origem === "fornecedor" && motivo.length < 5) falha("A proposta foi enviada pelo próprio fornecedor: escreva o motivo da exclusão.");
      if (r.proposta_escolhida === p.id) { r.proposta_escolhida = null; r.justificativa = ""; }
      S.propostas = S.propostas.filter((x) => x.id !== p.id);
      registrar(r.id, p.fornecedor_id, "proposta_excluida", `Proposta de ${forn(p.fornecedor_id).nome} excluída${motivo ? ": " + motivo : "."}`);
      return null;
    },
    cmp_escolher(a) {
      const r = reqPara(a.p_req, ["comprador"], ["cotacao"]);
      const p = S.propostas.find((x) => x.id === Number(a.p_proposta) && x.requisicao_id === r.id); if (!p) falha("Proposta não pertence a esta requisição.");
      const tot = totalP(p, r), min = Math.min(...S.propostas.filter((x) => x.requisicao_id === r.id).map((x) => totalP(x, r)));
      const just = String(a.p_justificativa || "").trim();
      if (tot > min && just.length < 10) falha("Escolhido não é o menor preço: escreva a justificativa (mínimo 10 caracteres).");
      r.proposta_escolhida = p.id; r.justificativa = tot > min ? just : ""; r.atualizado_em = agoraISO();
      registrar(r.id, null, "fornecedor_escolhido", `Escolheu ${forn(p.fornecedor_id).nome} (${tot > min ? "não é o menor preço" : "menor preço"})${tot > min ? " — justificativa: " + just : ""}`);
      return null;
    },
    cmp_excecao(a) {
      const r = reqPara(a.p_req, ["comprador"], ["nova", "cotacao"]);
      const t = String(a.p_texto || "").trim(); if (t.length < 15) falha("Explique a exclusividade (mínimo 15 caracteres).");
      r.excecao = t; registrar(r.id, null, "excecao_registrada", "Exceção de exclusividade: " + t); return null;
    },
    cmp_enviar_aprovacao(a) {
      const r = reqPara(a.p_req, ["comprador"], ["cotacao"]), u = unidade();
      if (!r.proposta_escolhida) falha("Escolha o fornecedor antes de enviar.");
      const props = S.propostas.filter((x) => x.requisicao_id === r.id);
      if (props.length < u.minimo_propostas && !r.excecao) falha(`Só ${props.length} proposta(s): o mínimo é ${u.minimo_propostas}. Registre mais propostas ou a exceção de exclusividade.`);
      const p = props.find((x) => x.id === r.proposta_escolhida), f = forn(p.fornecedor_id);
      if (f.certidoes_validade && f.certidoes_validade < hoje()) falha(`As certidões de ${f.nome} estão vencidas. Atualize o cadastro antes de enviar.`);
      const tot = totalP(p, r), menor = tot <= Math.min(...props.map((x) => totalP(x, r)));
      const novo = !comprasDe(f.id).some((x) => x.id !== r.id), comp = f.cadastrado_por === EU.id;
      const alcada = tot <= u.alcada_automatica && menor && !novo ? "automatica" : tot <= u.alcada_gerente ? "gerente" : "diretor";
      Object.assign(r, { alcada, valor_aprovacao: tot, fornecedor_novo: novo, cadastrado_pelo_comprador: comp, enviado_por: EU.id, enviado_em: agoraISO(),
        status: alcada === "automatica" ? "aprovada" : "aprovacao", atualizado_em: agoraISO() });
      registrar(r.id, f.id, "enviada_aprovacao", `Enviada para aprovação: ${f.nome}, ${brl(tot)}. Alçada: ${{ automatica: "automática", gerente: "Gerente", diretor: "Gerente e Diretor" }[alcada]}`
        + (novo ? ". Primeira compra com este fornecedor" : "") + (comp ? ". Fornecedor cadastrado por quem está comprando" : ""));
      if (alcada === "automatica") {
        S.aprovacoes.push({ id: novoId("aprov"), requisicao_id: r.id, etapa: "sistema", decisao: "aprovado", comentario: `Até ${brl(u.alcada_automatica)}, menor preço e fornecedor com compras anteriores.`, por: null, por_nome: "Sistema", em: agoraISO() });
        registrar(r.id, null, "aprovacao_automatica", "Aprovação automática (até a alçada, menor preço).");
      }
      return alcada;
    },
    cmp_decidir(a) {
      const r = req(a.p_req); if (!r) falha("Requisição não encontrada.");
      if (r.status !== "aprovacao") falha(`A requisição #${r.id} não está aguardando aprovação.`);
      const gerOk = S.aprovacoes.some((x) => x.requisicao_id === r.id && x.etapa === "gerente" && x.decisao === "aprovado");
      const etapa = gerOk ? "diretor" : "gerente";
      if (!temPapel([etapa])) falha(`Esta etapa é do ${etapa === "gerente" ? "Gerente" : "Diretor"}.`);
      if (r.enviado_por === EU.id) falha("Quem enviou a compra para aprovação não pode aprová-la.");
      const com = String(a.p_comentario || "").trim();
      if (!a.p_aprovar && com.length < 5) falha("Para reprovar, escreva o motivo.");
      S.aprovacoes.push({ id: novoId("aprov"), requisicao_id: r.id, etapa, decisao: a.p_aprovar ? "aprovado" : "reprovado", comentario: com, por: EU.id, por_nome: EU.nome, em: agoraISO() });
      const fid = S.propostas.find((x) => x.id === r.proposta_escolhida).fornecedor_id;
      if (!a.p_aprovar) { r.status = "reprovada"; registrar(r.id, fid, "reprovada", `Reprovada pelo ${etapa === "gerente" ? "Gerente" : "Diretor"}: ${com}`); return "reprovada"; }
      if (a.p_dar_aval && etapa === "gerente") RPC.cmp_aval({ p_fornecedor: fid, p_unidade: UNID, p_dar: true });
      const novo = etapa === "gerente" && r.alcada === "diretor" ? "aprovacao" : "aprovada";
      r.status = novo; r.atualizado_em = agoraISO();
      registrar(r.id, fid, "aprovada_" + etapa, `Aprovada pelo ${etapa === "gerente" ? "Gerente" : "Diretor"}${com ? ": " + com : ""}${novo === "aprovacao" ? ". Segue para o Diretor." : ""}`);
      return novo;
    },
    cmp_emitir_pedido(a) {
      const r = reqPara(a.p_req, ["comprador"], ["aprovada"]); r.status = "pedido"; r.pedido_em = agoraISO();
      registrar(r.id, S.propostas.find((x) => x.id === r.proposta_escolhida).fornecedor_id, "pedido_emitido", `Pedido de compra PC-${r.id} emitido.`); return null;
    },
    cmp_marcar_entregue(a) {
      const r = reqPara(a.p_req, ["comprador", "solicitante"], ["pedido"]); r.status = "entregue"; r.entregue_em = agoraISO();
      registrar(r.id, S.propostas.find((x) => x.id === r.proposta_escolhida).fornecedor_id, "entregue", "Pedido entregue. Avaliação do fornecedor pendente para o Gerente."); return null;
    },
    cmp_avaliar(a) {
      const r = reqPara(a.p_req, ["gerente"], ["entregue"]), fid = S.propostas.find((x) => x.id === r.proposta_escolhida).fornecedor_id;
      const nota = (k) => { const v = Number(a[k]); if (!(v >= 1 && v <= 5)) falha("Notas de 1 a 5."); return v; };
      S.avaliacoes.push({ id: novoId("aval"), requisicao_id: r.id, fornecedor_id: fid, unidade_id: UNID, prazo: nota("p_prazo"), qualidade: nota("p_qualidade"),
        conformidade: nota("p_conformidade"), atendimento: nota("p_atendimento"), comentario: String(a.p_comentario || "").trim(), avaliador: EU.id, avaliador_nome: EU.nome, em: agoraISO() });
      r.status = "concluida";
      registrar(r.id, fid, "fornecedor_avaliado", `${forn(fid).nome} avaliado: prazo ${a.p_prazo}, qualidade ${a.p_qualidade}, conforme a proposta ${a.p_conformidade}, atendimento ${a.p_atendimento}${a.p_comentario ? " — " + a.p_comentario : ""}`);
      return null;
    },
    cmp_cancelar(a) {
      const r = req(a.p_req); if (!r) falha("Requisição não encontrada.");
      if (!["nova", "cotacao", "reprovada"].includes(r.status)) falha("Só dá para cancelar antes da aprovação (ou depois de reprovada).");
      if (!(r.solicitante === EU.id || temPapel(["comprador", "gerente", "diretor"]))) falha("Só quem pediu, o comprador ou o gerente cancela.");
      const m = String(a.p_motivo || "").trim(); if (m.length < 5) falha("Escreva o motivo do cancelamento.");
      r.status = "cancelada"; registrar(r.id, null, "cancelada", "Cancelada: " + m); return null;
    },
    cmp_reabrir(a) {
      const r = reqPara(a.p_req, ["comprador"], ["reprovada"]);
      Object.assign(r, { status: "cotacao", alcada: null, valor_aprovacao: null, enviado_por: null, enviado_em: null });
      registrar(r.id, null, "reaberta", "Reaberta para nova cotação após reprovação."); return null;
    },
    // ---- fase 2: convites e proposta pelo link
    cmp_convidar(a) {
      const r = reqPara(a.p_req, ["comprador"], ["nova", "cotacao"]);
      if (!a.p_prazo || a.p_prazo < hoje()) falha("O prazo para o fornecedor responder precisa ser hoje ou depois.");
      let f = null;
      if (a.p_fornecedor) {
        f = forn(a.p_fornecedor); if (!f || !f.ativo) falha("Fornecedor não encontrado ou inativo.");
        const ex = S.convites.find((c) => c.requisicao_id === r.id && c.fornecedor_id === f.id && !c.revogado_em);
        if (ex) falha(`${f.nome} já tem convite nesta requisição (criado por ${ex.criado_nome}). Use o mesmo link ou cancele o anterior.`);
        if (S.propostas.some((p) => p.requisicao_id === r.id && p.fornecedor_id === f.id && p.origem === "fornecedor")) falha(`${f.nome} já enviou proposta nesta requisição.`);
      } else if (String(a.p_contato_nome || "").trim().length < 2) falha("Para fornecedor ainda sem cadastro, informe o nome da empresa ou do contato.");
      const bytes = new Uint8Array(32); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(bytes) : bytes.forEach((_, i) => (bytes[i] = Math.random() * 256));
      const c = { id: novoId("conv"), requisicao_id: r.id, fornecedor_id: f ? f.id : null, codigo: [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""),
        contato_nome: String(a.p_contato_nome || "").trim() || (f ? f.contato : ""), telefone: String(a.p_telefone || "").trim() || (f ? f.telefone : ""),
        email: String(a.p_email || "").trim() || (f ? f.email : ""), prazo: a.p_prazo, criado_por: EU.id, criado_nome: EU.nome, criado_em: agoraISO(),
        aberto_em: null, respondido_em: null, revogado_em: null, revogado_nome: null };
      S.convites.push(c);
      if (r.status === "nova") r.status = "cotacao";
      registrar(r.id, c.fornecedor_id, "convite_criado", `Convite para cotar enviado a ${f ? f.nome : c.contato_nome + " (sem cadastro)"}, prazo até ${dataBR(c.prazo)}`);
      return { id: c.id, codigo: c.codigo };
    },
    cmp_convite_prazo(a) {
      const c = S.convites.find((x) => x.id === Number(a.p_convite)); if (!c) falha("Convite não encontrado.");
      reqPara(c.requisicao_id, ["comprador"], ["nova", "cotacao"]);
      if (c.revogado_em) falha("Convite cancelado: crie outro.");
      if (!a.p_prazo || a.p_prazo < hoje()) falha("O prazo para o fornecedor responder precisa ser hoje ou depois.");
      const ant = c.prazo; c.prazo = a.p_prazo;
      registrar(c.requisicao_id, c.fornecedor_id, "convite_prazo", `Prazo do convite de ${c.fornecedor_id ? forn(c.fornecedor_id).nome : c.contato_nome} mudou de ${dataBR(ant)} para ${dataBR(c.prazo)}`);
      return null;
    },
    cmp_convite_cancelar(a) {
      const c = S.convites.find((x) => x.id === Number(a.p_convite)); if (!c) falha("Convite não encontrado.");
      if (!temPapel(["comprador"])) falha("Só o comprador cancela o convite.");
      if (c.revogado_em) return null;
      c.revogado_em = agoraISO(); c.revogado_nome = EU.nome;
      registrar(c.requisicao_id, c.fornecedor_id, "convite_cancelado", `Convite de ${c.fornecedor_id ? forn(c.fornecedor_id).nome : c.contato_nome} cancelado: o link deixa de funcionar`);
      return null;
    },
    cmp_cotacao_ler(a) {
      const c = convitePorCodigo(a.p_codigo), r = req(c.requisicao_id), f = c.fornecedor_id ? forn(c.fornecedor_id) : null;
      const p = f ? S.propostas.find((x) => x.requisicao_id === r.id && x.fornecedor_id === f.id) : null;
      if (!c.aberto_em) { c.aberto_em = agoraISO(); registrar(r.id, c.fornecedor_id, "convite_aberto", "Fornecedor abriu o link do convite", {}, (f ? f.nome : c.contato_nome || "Fornecedor") + " (pelo link)"); }
      return {
        situacao: situacao(c, r), prazo: c.prazo, unidade: unidade().nome,
        requisicao: { numero: r.id, titulo: r.titulo, descricao: r.descricao, grupo: r.grupo, quantidade: r.quantidade, unidade_medida: r.unidade_medida, precisa_ate: r.precisa_ate },
        contato_nome: c.contato_nome,
        fornecedor: f ? { nome: f.nome, tipo: f.tipo, documento: f.tipo === "PJ" ? f.documento : "***" + f.documento.slice(3, 9) + "**" } : null,
        proposta: p && p.origem === "fornecedor" ? { protocolo: "P-" + p.id, preco_unitario: p.preco_unitario, frete: p.frete, custos_extras: p.custos_extras,
          prazo_dias: p.prazo_dias, pagamento: p.pagamento, pagamento_dias: p.pagamento_dias, validade: p.validade, obs: p.obs, declarante: p.declarante,
          tem_anexo: !!p.anexo, rodada: p.rodada, em: p.atualizada_em } : null,
      };
    },
    cmp_cotacao_enviar(a) {
      const c = convitePorCodigo(a.p_codigo), r = req(c.requisicao_id), d = a.p_dados || {};
      const sit = situacao(c, r);
      if (sit === "cancelado") falha("Este convite foi cancelado pelo comprador.");
      if (sit === "fechado") falha("A cotação já foi encerrada pelo comprador: não recebe mais propostas.");
      if (sit === "encerrado") falha(`O prazo para enviar a proposta terminou em ${dataBR(c.prazo)}.`);
      const n = (v, padrao) => (v === "" || v == null ? padrao : Number(v));
      const preco = n(d.preco_unitario, null), frete = n(d.frete, 0), extras = n(d.custos_extras, 0), prazo = n(d.prazo_dias, null), pagdias = n(d.pagamento_dias, 0);
      if ([preco, frete, extras, prazo, pagdias].some((v) => v != null && isNaN(v))) falha("Confira os números: preço, frete e prazo só com algarismos.");
      if (preco == null || preco < 0 || prazo == null || prazo < 0) falha("Preço unitário e prazo de entrega são obrigatórios.");
      if (d.validade && d.validade < hoje()) falha("A validade da proposta já passou.");
      const decl = String(d.declarante || "").trim().slice(0, 120);
      if (decl.length < 3) falha("Informe o seu nome (quem está enviando a proposta).");
      if (d.aceite !== true) falha("Marque a declaração de que a proposta é válida para enviar.");
      if (d.anexo && (!d.anexo.startsWith(c.codigo + "/") || !S.anexos[d.anexo])) falha("O PDF não foi recebido. Anexe de novo.");
      let f;
      if (!c.fornecedor_id) {
        const tipo = String(d.tipo || "").toUpperCase(), doc = String(d.documento || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase(), nome = String(d.nome || "").trim();
        if (!["PJ", "PF"].includes(tipo)) falha("Escolha se é empresa (CNPJ) ou pessoa física (CPF).");
        if (!docValido(tipo, doc)) falha(`${tipo === "PF" ? "CPF" : "CNPJ"} inválido (dígito verificador não confere). Confira o número.`);
        f = S.fornecedores.find((x) => x.documento === doc);
        if (f) {
          if (!f.ativo) falha("Este cadastro está inativo para cotações. Fale com o comprador.");
          if (S.convites.some((x) => x.requisicao_id === r.id && x.fornecedor_id === f.id && !x.revogado_em && x.id !== c.id))
            falha(`Este ${tipo === "PF" ? "CPF" : "CNPJ"} já recebeu outro convite para esta cotação. Use o link desse outro convite.`);
          c.fornecedor_id = f.id;
          registrar(r.id, f.id, "convite_identificado", `Fornecedor se identificou pelo link: ${f.nome} (cadastro já existente na base)`, {}, f.nome + " (pelo link)");
        } else {
          if (nome.length < 2) falha("Informe a razão social ou o nome.");
          f = { id: "f-" + Date.now().toString(36), tipo, documento: doc, nome, grupos: [r.grupo], contato: "", email: String(d.email || ""), telefone: String(d.telefone || ""),
            certidoes_validade: null, obs: `Cadastro feito pelo próprio fornecedor no link do convite da requisição #${r.id}.`, cadastrado_por: c.criado_por,
            cadastrado_nome: c.criado_nome, cadastrado_unidade: UNID, cadastrado_em: agoraISO(), ativo: true };
          S.fornecedores.push(f); c.fornecedor_id = f.id;
          registrar(r.id, f.id, "fornecedor_cadastrado_link", `Fornecedor cadastrado pelo próprio fornecedor no link: ${f.nome} (${tipo}). Responsável pela homologação: ${c.criado_nome} (quem convidou)`, {}, f.nome + " (pelo link)");
        }
      } else {
        f = forn(c.fornecedor_id); if (!f.ativo) falha("Este cadastro está inativo para cotações. Fale com o comprador.");
      }
      const quem = `${decl} — ${f.nome} (pelo link)`;
      const pag = String(d.pagamento || "À vista").slice(0, 60);
      const dados = { preco_unitario: r2(preco), frete: r2(frete), custos_extras: r2(extras), prazo_dias: prazo, pagamento: pag, pagamento_dias: pagdias,
        validade: d.validade || null, obs: String(d.obs || "").slice(0, 1000), origem: "fornecedor", convite_id: c.id, declarante: decl, enviada_ip: "200.0.0.10 (demonstração)" };
      const ant = S.propostas.find((x) => x.requisicao_id === r.id && x.fornecedor_id === f.id);
      let p;
      if (ant) {
        const totAnt = totalP(ant, r);
        if (dados.preco_unitario !== ant.preco_unitario) { ant.rodada += 1; ant.preco_anterior = ant.preco_unitario; }
        Object.assign(ant, dados, { anexo: d.anexo || ant.anexo, atualizada_em: agoraISO() }); p = ant;
        registrar(r.id, f.id, "proposta_reenviada_fornecedor", `Proposta reenviada pelo fornecedor ${f.nome}: total ${brl(totalP(p, r))}, prazo ${prazo} dias, ${pag}${totAnt !== totalP(p, r) ? ` (antes ${brl(totAnt)})` : ""}`, {}, quem);
      } else {
        p = { id: novoId("prop"), requisicao_id: r.id, fornecedor_id: f.id, ...dados, anexo: d.anexo || null, rodada: 1, preco_anterior: null, registrada_por: null,
          registrada_em: agoraISO(), atualizada_em: agoraISO() };
        S.propostas.push(p);
        registrar(r.id, f.id, "proposta_enviada_fornecedor", `Proposta enviada pelo fornecedor ${f.nome}: total ${brl(totalP(p, r))}, prazo ${prazo} dias, ${pag}${p.anexo ? ", com PDF" : ""}`, {}, quem);
      }
      c.respondido_em = agoraISO(); if (!c.aberto_em) c.aberto_em = c.respondido_em;
      desfazEscolha(r, quem);
      return { protocolo: "P-" + p.id, em: agoraISO() };
    },
  };
  function convitePorCodigo(codigo) {
    if (!/^[0-9a-f]{64}$/.test(String(codigo || ""))) falha("Link de cotação inválido. Confira se copiou o endereço inteiro.");
    const c = S.convites.find((x) => x.codigo === codigo); if (!c) falha("Link de cotação inválido. Confira se copiou o endereço inteiro.");
    return c;
  }
  const situacao = (c, r) => (c.revogado_em ? "cancelado" : !["nova", "cotacao"].includes(r.status) ? "fechado" : hoje() > c.prazo ? "encerrado" : "aberto");

  // ---------------------------------------------------------------- carga inicial: a história de dois meses do Shopping Vale Verde
  function semear() {
    S = vazio();
    const F = (id, tipo, documento, nome, grupos, contato, telefone, email, cert, quem, diasAtras) =>
      S.fornecedores.push({ id, tipo, documento, nome, grupos, contato, telefone, email, certidoes_validade: cert, obs: "",
        cadastrado_por: PESSOAS[quem].id, cadastrado_nome: PESSOAS[quem].nome, cadastrado_unidade: UNID,
        cadastrado_em: new Date(Date.now() - diasAtras * 864e5).toISOString(), ativo: true });
    const em = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    F("f-polar", "PJ", "41852736000186", "Polar Fino Climatização Ltda", ["Refrigeração"], "Marcelo Fontes", "(21) 99701-2201", "comercial@polarfino.exemplo", em(160), "comprador", 70);
    F("f-arcadia", "PJ", "52739184000111", "Arcádia Refrigeração e Ar Ltda", ["Refrigeração"], "Patrícia Leal", "(21) 99702-3302", "vendas@arcadiaar.exemplo", em(95), "gerente", 260);
    F("f-ventura", "PJ", "63918275000140", "Ventura Frio Engenharia Ltda", ["Refrigeração", "Automação"], "Hélio Matos", "(21) 99703-4403", "orcamento@venturafrio.exemplo", em(210), "gerente", 120);
    F("f-faisca", "PJ", "74185296000118", "Faísca Instalações Elétricas Ltda", ["Energia"], "Denise Castro", "(21) 99704-5504", "contato@faisca.exemplo", em(130), "comprador", 50);
    F("f-lumen", "PJ", "85296371000126", "Lumen Prime Iluminação Ltda", ["Energia"], "Otávio Reis", "(21) 99705-6605", "vendas@lumenprime.exemplo", em(-6), "comprador", 50);
    F("f-ribamar", "PF", "73829461507", "José Ribamar Costa (eletricista)", ["Energia", "Mão de obra"], "José Ribamar", "(21) 99706-7706", "", em(75), "comprador", 49);
    F("f-aurora", "PJ", "96374182000141", "Jardim Aurora Paisagismo ME", ["Jardinagem"], "Lúcia Prado", "(21) 99707-8807", "jardimaurora@exemplo.com.br", em(140), "comprador", 25);
    F("f-folha", "PJ", "17428593000105", "Folha Nova Jardins ME", ["Jardinagem"], "Renato Alves", "(21) 99708-9908", "", em(60), "comprador", 25);
    F("f-raiz", "PJ", "28539614000176", "Raiz Forte Paisagismo Ltda", ["Jardinagem"], "Bianca Torres", "(21) 99709-1009", "", em(25), "comprador", 25);
    F("f-vigilia", "PJ", "39641725000113", "Vigília Total Segurança Eletrônica Ltda", ["Segurança", "Tecnologia"], "Fábio Nunes", "(21) 99710-1110", "projetos@vigiliatotal.exemplo", em(180), "comprador", 15);
    F("f-olho", "PJ", "40752836000178", "Olho Vivo Sistemas de Vigilância Ltda", ["Segurança"], "Cíntia Rocha", "(21) 99711-1211", "", em(90), "gerente", 200);
    F("f-nodo", "PJ", "51863947000178", "Nodo Tecnologia e Redes Ltda", ["Tecnologia", "Segurança"], "Igor Sales", "(21) 99712-1312", "comercial@nodotec.exemplo", em(22), "comprador", 15);
    F("f-telhabem", "PJ", "62974158000121", "Telhabem Coberturas e Reformas Ltda", ["Obras civis"], "Roberto Gaspar", "(21) 99713-1413", "", em(120), "comprador", 40);
    F("f-alicerce", "PJ", "73085269000102", "Alicerce Firme Construções Ltda", ["Obras civis"], "Mariana Lopes", "(21) 99714-1514", "obras@alicercefirme.exemplo", em(150), "gerente", 150);
    F("f-cobertura", "PJ", "84196370000147", "Cobertura Segura Engenharia Ltda", ["Obras civis"], "Sérgio Pinho", "(21) 99715-1615", "", em(100), "comprador", 40);
    F("f-cristalina", "PJ", "95207481000128", "Cristalina Serviços de Limpeza Ltda", ["Limpeza", "Mão de obra"], "Aline Freitas", "(21) 99716-1716", "", em(200), "gerente", 300);
    F("f-fardas", "PJ", "16308592000154", "Fardas & Cia Uniformes Ltda", ["Outros"], "Vera Lima", "(21) 99717-1817", "", em(80), "comprador", 30);

    // linha do tempo: cada passo acontece "N dias atrás", no papel de quem faz
    const eventos = [], R = {};
    const passo = (dias, hora, papel, fn) => eventos.push({ t: Date.now() - dias * 864e5 + (hora - 12) * 36e5, papel, fn });
    const criar = (k, dias, papel, dados) => passo(dias, 9, papel, () => {
      ins({ unidade_id: UNID, centro_custo: "", unidade_medida: "un", precisa_ate: null, valor_estimado: null, descricao: "", ...dados }); R[k] = S.seq.req; });
    const prop = (k, dias, f, preco, frete, prazo, pag, pagdias, obs) => passo(dias, 11, "comprador", () =>
      RPC.cmp_salvar_proposta({ p_req: R[k], p_fornecedor: f, p_preco: preco, p_frete: frete, p_extras: 0, p_prazo: prazo, p_pagamento: pag, p_pagamento_dias: pagdias, p_validade: null, p_obs: obs || "" }));
    const escolher = (k, dias, f, just) => passo(dias, 14, "comprador", () =>
      RPC.cmp_escolher({ p_req: R[k], p_proposta: S.propostas.find((p) => p.requisicao_id === R[k] && p.fornecedor_id === f).id, p_justificativa: just || "" }));
    const enviar = (k, dias) => passo(dias, 15, "comprador", () => RPC.cmp_enviar_aprovacao({ p_req: R[k] }));
    const decidir = (k, dias, papel, com, aval) => passo(dias, 10, papel, () => RPC.cmp_decidir({ p_req: R[k], p_aprovar: true, p_comentario: com || "", p_dar_aval: !!aval }));
    const pedido = (k, dias) => passo(dias, 16, "comprador", () => RPC.cmp_emitir_pedido({ p_req: R[k] }));
    const entregue = (k, dias, papel) => passo(dias, 17, papel, () => RPC.cmp_marcar_entregue({ p_req: R[k] }));
    const avaliar = (k, dias, n, com) => passo(dias, 10, "gerente", () => RPC.cmp_avaliar({ p_req: R[k], p_prazo: n[0], p_qualidade: n[1], p_conformidade: n[2], p_atendimento: n[3], p_comentario: com }));

    criar("ar", 58, "solicitante", { titulo: "Manutenção preventiva do ar-condicionado central", grupo: "Refrigeração", centro_custo: "Manutenção", quantidade: 1, unidade_medida: "serviço",
      valor_estimado: 18000, precisa_ate: diaMaisDe(-40), descricao: "Limpeza de serpentinas, troca de filtros e checagem dos 4 fan-coils da praça de alimentação." });
    prop("ar", 56, "f-polar", 15800, 0, 5, "30 dias", 30, "Inclui relatório técnico com fotos.");
    prop("ar", 55, "f-arcadia", 16900, 0, 3, "28 dias", 28);
    prop("ar", 54, "f-ventura", 17500, 0, 7, "30/60", 45);
    escolher("ar", 53, "f-polar"); enviar("ar", 53); decidir("ar", 52, "gerente", "Menor preço e bom prazo.", true);
    pedido("ar", 52); entregue("ar", 44, "solicitante"); avaliar("ar", 43, [5, 4, 5, 5], "Equipe pontual, deixou tudo limpo.");

    criar("led", 45, "solicitante", { titulo: "Lâmpadas LED tubulares 18 W para o estacionamento", grupo: "Energia", centro_custo: "Manutenção", quantidade: 200,
      valor_estimado: 5200, descricao: "Tubular T8 18 W, 6500 K, base G13. Garantia mínima de 2 anos." });
    prop("led", 44, "f-faisca", 21.5, 0, 4, "28 dias", 28); prop("led", 44, "f-lumen", 22.9, 0, 6, "À vista", 0); prop("led", 43, "f-ribamar", 23.4, 0, 3, "À vista", 0);
    escolher("led", 42, "f-faisca"); enviar("led", 42); decidir("led", 41, "gerente", "", true); pedido("led", 41); entregue("led", 36, "comprador");
    avaliar("led", 35, [4, 4, 4, 5], "Entregou em duas remessas, tudo certo.");

    criar("piso", 35, "solicitante", { titulo: "Piso antiderrapante nos banheiros do piso L1", grupo: "Obras civis", centro_custo: "Manutenção", quantidade: 64, unidade_medida: "m²",
      valor_estimado: 14000, descricao: "Remoção do piso atual e assentamento de porcelanato antiderrapante PEI 4, com rejunte epóxi." });
    prop("piso", 33, "f-alicerce", 189, 450, 12, "30/60", 45); prop("piso", 32, "f-telhabem", 205, 0, 15, "30 dias", 30); prop("piso", 32, "f-cobertura", 214, 0, 10, "30 dias", 30);
    escolher("piso", 31, "f-alicerce"); enviar("piso", 31); decidir("piso", 30, "gerente", "Ok. Executar à noite, após o fechamento.", true);
    pedido("piso", 29); entregue("piso", 3, "solicitante");

    criar("telhado", 30, "solicitante", { titulo: "Reforma do telhado da praça de alimentação", grupo: "Obras civis", centro_custo: "Obras", quantidade: 1, unidade_medida: "serviço",
      valor_estimado: 90000, precisa_ate: diaMaisDe(40), descricao: "Troca de 420 m² de telhas termoacústicas, calhas e rufos. Laudo com ART do engenheiro responsável." });
    prop("telhado", 24, "f-telhabem", 86400, 0, 30, "30/60/90", 60, "Com ART e garantia de 5 anos.");
    prop("telhado", 22, "f-alicerce", 91200, 0, 25, "30/60", 45); prop("telhado", 21, "f-cobertura", 97800, 0, 35, "30/60/90", 60);
    escolher("telhado", 9, "f-telhabem"); enviar("telhado", 8); decidir("telhado", 6, "gerente", "Prazo compatível com a obra da praça. Segue para a diretoria.", true);

    criar("fita", 25, "solicitante", { titulo: "Material elétrico de reposição (fitas, disjuntores, tomadas)", grupo: "Energia", centro_custo: "Manutenção", quantidade: 1, unidade_medida: "lote",
      valor_estimado: 1800, descricao: "Conforme lista anexa ao pedido do almoxarifado." });
    prop("fita", 24, "f-faisca", 1450, 0, 2, "28 dias", 28); prop("fita", 24, "f-lumen", 1620, 0, 4, "À vista", 0); prop("fita", 23, "f-ribamar", 1700, 0, 1, "À vista", 0);
    escolher("fita", 23, "f-faisca"); enviar("fita", 23); pedido("fita", 23); entregue("fita", 21, "solicitante"); avaliar("fita", 20, [5, 5, 5, 4], "");

    criar("poda", 20, "solicitante", { titulo: "Poda das árvores do estacionamento", grupo: "Jardinagem", centro_custo: "Paisagismo", quantidade: 1, unidade_medida: "serviço",
      valor_estimado: 4500, descricao: "38 árvores. Inclui recolhimento dos galhos e autorização ambiental." });
    prop("poda", 18, "f-aurora", 3800, 0, 7, "30 dias", 30); prop("poda", 18, "f-folha", 4200, 0, 5, "À vista", 0); prop("poda", 17, "f-raiz", 4650, 0, 10, "30 dias", 30);
    escolher("poda", 17, "f-aurora"); enviar("poda", 17); decidir("poda", 16, "gerente", "", true); pedido("poda", 15);

    criar("cadeira", 14, "solicitante", { titulo: "Cadeiras para a sala de reunião", grupo: "Outros", quantidade: 10, valor_estimado: 6000 });
    passo(13, 10, "comprador", () => RPC.cmp_cancelar({ p_req: R.cadeira, p_motivo: "Vamos reaproveitar as cadeiras do antigo escritório da administração." }));

    criar("cameras", 12, "solicitante", { titulo: "Câmeras IP 4 MP com gravador de 16 canais", grupo: "Segurança", centro_custo: "Segurança", quantidade: 8,
      valor_estimado: 14000, precisa_ate: diaMaisDe(20), descricao: "Cobertura da nova entrada da praça. Câmeras bullet IP67, gravador com 30 dias de gravação e instalação." });
    prop("cameras", 11, "f-vigilia", 1490, 0, 12, "30 dias", 30, "Instalação inclusa.");
    prop("cameras", 11, "f-olho", 1390, 300, 25, "28 dias", 28, "Instalação cobrada à parte.");
    prop("cameras", 10, "f-nodo", 1550, 0, 10, "À vista", 0);
    escolher("cameras", 9, "f-vigilia", "O prazo de 12 dias atende a reabertura da entrada; o menor preço leva 25 dias e não inclui a instalação.");
    enviar("cameras", 9);

    criar("compressor", 6, "solicitante", { titulo: "Compressor para o chiller 2", grupo: "Refrigeração", centro_custo: "Manutenção", quantidade: 1,
      valor_estimado: 26000, precisa_ate: diaMaisDe(15), descricao: "Compressor scroll 30 TR compatível com o chiller 2 (casa de máquinas). Com instalação e partida assistida." });
    const prazoConvite = em(4);
    passo(5, 10, "comprador", () => { const p = prazoConvite; R.cv1 = RPC.cmp_convidar({ p_req: R.compressor, p_fornecedor: "f-polar", p_contato_nome: "", p_telefone: "", p_email: "", p_prazo: p }).codigo;
      RPC.cmp_convidar({ p_req: R.compressor, p_fornecedor: "f-arcadia", p_contato_nome: "", p_telefone: "", p_email: "", p_prazo: p });
      RPC.cmp_convidar({ p_req: R.compressor, p_fornecedor: null, p_contato_nome: "Gelo Fácil Refrigeração (Tiago)", p_telefone: "(21) 99720-2020", p_email: "", p_prazo: p }); });
    passo(4, 9, "comprador", () => RPC.cmp_salvar_proposta({ p_req: R.compressor, p_fornecedor: "f-ventura", p_preco: 27400, p_frete: 600, p_extras: 1800, p_prazo: 15,
      p_pagamento: "30/60", p_pagamento_dias: 45, p_validade: null, p_obs: "Proposta recebida por e-mail. Extras: contrato de manutenção 12 meses." }));
    passo(4, 15, null, () => { const cod = R.cv1, nome = cod + "/proposta-polar-fino.pdf"; S.anexos[nome] = { nome: "Proposta Polar Fino.pdf" };
      RPC.cmp_cotacao_ler({ p_codigo: cod });
      RPC.cmp_cotacao_enviar({ p_codigo: cod, p_dados: { preco_unitario: "24900", frete: "0", custos_extras: "2400", prazo_dias: "10", pagamento: "30/60", pagamento_dias: "45",
        validade: diaMaisDe(26), obs: "Compressor scroll 30 TR com garantia de 12 meses; partida assistida inclusa.", declarante: "Marcelo Fontes", aceite: true, anexo: nome } }); });
    passo(3, 11, null, () => { const c = S.convites.find((x) => x.fornecedor_id === "f-arcadia"); RPC.cmp_cotacao_ler({ p_codigo: c.codigo }); });

    criar("uniformes", 1, "solicitante", { titulo: "Uniformes para a equipe de limpeza", grupo: "Outros", centro_custo: "Limpeza", quantidade: 24, unidade_medida: "kit",
      valor_estimado: 3600, precisa_ate: diaMaisDe(21), descricao: "Kit com 2 camisas, 2 calças e 1 avental, tamanhos variados (lista com a supervisão)." });

    eventos.sort((a, b) => a.t - b.t);
    for (const ev of eventos) {
      RELOGIO = ev.t; EU = ev.papel ? PESSOAS[ev.papel] : null;
      ev.fn();
    }
    RELOGIO = null; EU = PESSOAS[papelAtual()];
    salvar();
  }
  // data relativa ao "agora" do passo (para prazos coerentes com o dia em que o pedido foi feito)
  function diaMaisDe(n) { return diaMais(n); }

  // requisição nova: o servidor carimba autor e situação (gatilho cmp_req_nova)
  function ins(d) {
    if (!EU || !temPapel(["solicitante", "comprador", "gerente", "diretor"])) falha("new row violates row-level security policy");
    if (!String(d.titulo || "").trim()) falha("Informe o que precisa comprar.");
    if (!(Number(d.quantidade) > 0)) falha("A quantidade precisa ser maior que zero.");
    const r = { id: novoId("req"), unidade_id: UNID, centro_custo: d.centro_custo || "", grupo: d.grupo, titulo: String(d.titulo).trim(), descricao: d.descricao || "",
      quantidade: Number(d.quantidade), unidade_medida: d.unidade_medida || "un", precisa_ate: d.precisa_ate || null, valor_estimado: d.valor_estimado ?? null,
      solicitante: EU.id, solicitante_nome: EU.nome, status: "nova", proposta_escolhida: null, justificativa: "", excecao: "", alcada: null, valor_aprovacao: null,
      fornecedor_novo: null, cadastrado_pelo_comprador: null, enviado_por: null, enviado_em: null, pedido_em: null, entregue_em: null, criado_em: agoraISO(), atualizado_em: agoraISO() };
    S.requisicoes.push(r);
    registrar(r.id, null, "requisicao_criada", "Requisição criada: " + r.titulo);
  }

  // ---------------------------------------------------------------- consultas (subconjunto do supabase-js usado pelo app)
  const TABELAS = {
    perfis: () => S.perfis, cmp_membros: () => S.membros, cmp_unidades: () => S.unidades, cmp_grupos: () => S.grupos,
    cmp_requisicoes: () => S.requisicoes, cmp_propostas: () => S.propostas, cmp_aprovacoes: () => S.aprovacoes,
    cmp_avaliacoes: () => S.avaliacoes, cmp_historico: () => S.historico, cmp_convites: () => S.convites,
  };
  const copia = (o) => JSON.parse(JSON.stringify(o));
  function consulta(tabela) {
    const filtros = []; let ordem = [], limite = null, unico = false, inserir = null, bloq = false;
    const q = {
      select() { return q; }, limit(n) { limite = n; return q; }, maybeSingle() { unico = true; return q; }, single() { unico = true; return q; },
      order(c, o) { ordem.push([c, o?.ascending !== false]); return q; },
      eq(c, v) { filtros.push((r) => r[c] === v); return q; }, match(m) { for (const k in m) filtros.push((r) => r[k] === m[k]); return q; },
      insert(d) { inserir = d; return q; }, update() { bloq = true; return q; }, delete() { bloq = true; return q; },
      then(ok, ko) { return Promise.resolve(exec()).then(ok, ko); },
    };
    function exec() {
      try {
        recarregar();
        if (bloq) return { data: null, error: { message: "Na demonstração, a configuração da unidade é feita só pela equipe Nervia." } };
        if (inserir) {
          if (tabela !== "cmp_requisicoes") return { data: null, error: { message: "permission denied for table " + tabela } };
          ins(inserir); salvar(); return { data: null, error: null };
        }
        let out = (TABELAS[tabela] ? TABELAS[tabela]() : []).filter((r) => filtros.every((f) => f(r)));
        if (ordem.length) out = out.slice().sort((a, b) => { for (const [c, asc] of ordem) { if (a[c] === b[c]) continue; return (a[c] > b[c] ? 1 : -1) * (asc ? 1 : -1); } return 0; });
        if (limite) out = out.slice(0, limite);
        out = copia(out);
        return { data: unico ? out[0] ?? null : out, error: null };
      } catch (e) { return { data: null, error: { message: e.message } }; }
    }
    return q;
  }
  function recarregar() { if (!carregarEstado()) semear(); }

  // ---------------------------------------------------------------- cliente falso
  window.NERVIA_DEMO = true;
  window.NERVIA_DEMO_COMPRAS = {
    pessoas: PESSOAS, papel: papelAtual,
    trocarPapel(p) { ls.set(CHAVE_PAPEL, p); },
    recomecar() { ls.del(CHAVE); },
    // convite aberto e ainda sem resposta (para abrir /demo/cotacao/ sem link)
    codigoExemplo() { recarregar(); const c = S.convites.find((x) => !x.respondido_em && situacao(x, req(x.requisicao_id)) === "aberto" && x.fornecedor_id)
      || S.convites.find((x) => situacao(x, req(x.requisicao_id)) === "aberto"); return c ? c.codigo : ""; },
    chave: CHAVE,
  };
  window.supabase = { createClient: () => ({
    from: consulta,
    rpc: async (fn, args) => {
      try {
        recarregar();
        if (!RPC[fn]) return { data: null, error: { message: "Função não disponível na demonstração: " + fn } };
        const data = RPC[fn](args || {}); salvar();
        return { data: data === undefined ? null : copia(data), error: null };
      } catch (e) { recarregar(); return { data: null, error: { message: e.message } }; }
    },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: EU.id, email: EU.email } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    storage: { from: () => ({
      upload: async (caminho, arquivo) => {
        recarregar();
        const cod = String(caminho).split("/")[0], c = S.convites.find((x) => x.codigo === cod);
        if (!c || situacao(c, req(c.requisicao_id)) !== "aberto" || !/\.pdf$/i.test(caminho)) return { data: null, error: { message: "new row violates row-level security policy" } };
        S.anexos[caminho] = { nome: arquivo && arquivo.name || "proposta.pdf" }; salvar();
        return { data: { path: caminho }, error: null };
      },
      // na demonstração, todo PDF abre uma proposta comercial de exemplo (fictícia)
      createSignedUrl: async () => ({ data: { signedUrl: "/demo/compras/proposta-exemplo.html" }, error: null }),
    }) },
  }) };
  recarregar();
})();
