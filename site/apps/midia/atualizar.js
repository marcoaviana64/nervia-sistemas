/* Mídia Indoor 2.7 — atualização do app da TV pedida pelo painel (pedido do Marco em 19/11/2026, opção 1).
   A versão publicada vem de /tv.json ({codigo, nome, sha256}), atualizado junto com o /tv.apk. A equipe Nervia pede a
   atualização de uma TV ou de todas as desatualizadas (rpc mi_tela_atualizar); a TV (app 1.11+) baixa, confere e abre
   a tela de instalação; alguém no local aperta "Instalar". O pedido some quando a TV manda o sinal com a versão nova.
   TV com app anterior ao 1.11 não sabe se atualizar: precisa da instalação à mão uma vez (Downloader).
   Usa os globais do index (sb, TELAS, ADMIN, esc, tag, checar, carregar, render, msg, dataHora). */

let APP_PUB = null;              // {codigo, nome, sha256} do /tv.json
const APP_MIN_ATUALIZA = "1.11"; // primeira versão do app da TV que se atualiza pelo painel
async function carregarAppPub() {
  try { const r = await fetch("/tv.json", { cache: "no-store" }); if (r.ok) APP_PUB = await r.json(); } catch { APP_PUB = null; }
}
/** compara "1.10" com "1.9" como números (negativo = a < b) */
function verCmp(a, b) {
  const x = String(a || "").split(".").map(Number), y = String(b || "").split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}
const appVelho = t => APP_PUB && t.versao_app && verCmp(t.versao_app, APP_PUB.nome) < 0;
const appSeAtualiza = t => t.versao_app && verCmp(t.versao_app, APP_MIN_ATUALIZA) >= 0;
const situacaoAtualizacao = t => ((Array.isArray(t.erros) ? t.erros : []).find(e => e.nome === "Atualização do app") || {}).erro || "";

/** Linha extra na coluna Aparelho. */
function colApp(t) {
  if (t.atualizar) {
    const sit = situacaoAtualizacao(t);
    return `<div>${tag(`atualização para ${t.atualizar.nome} pedida`, "t-info")}</div>
      <div class="mut">${esc(sit || "a TV recebe o pedido em até 5 minutos")}</div>
      ${ADMIN ? `<button class="lnk" data-acao="appCancelar" data-id="${t.id}">cancelar o pedido</button>` : ""}`;
  }
  if (!appVelho(t)) return "";
  if (!appSeAtualiza(t)) return `<div>${tag(`app desatualizado (${APP_PUB.nome} disponível)`, "t-warn")}</div>
    <div class="mut">esta versão não se atualiza pelo painel: instale à mão uma vez pelo Downloader (nervia.com.br/tv.apk)</div>`;
  return `<div>${tag(`app desatualizado (${APP_PUB.nome} disponível)`, "t-warn")}</div>
    ${ADMIN ? `<button class="lnk" data-acao="appAtualizar" data-id="${t.id}">atualizar app</button>` : ""}`;
}

/** Botão no alto da tabela (só equipe Nervia, só quando há TV para atualizar). */
function botaoAtualizarTodas() {
  if (!ADMIN) return "";
  const n = TELAS.filter(t => appVelho(t) && appSeAtualiza(t) && !t.atualizar).length;
  return n ? `<button class="bt" data-acao="appAtualizarTodas">Atualizar app (${n} TV${n > 1 ? "s" : ""})</button> ` : "";
}

async function pedirAtualizacao(ids) {
  if (!APP_PUB) return msg("err", "Não consegui ler a versão publicada (tv.json). Tente de novo.");
  if (!confirm(`Pedir a atualização do app para a versão ${APP_PUB.nome} em ${ids.length} TV${ids.length > 1 ? "s" : ""}?\n\n` +
    "Em até 5 minutos a TV baixa a versão nova e abre a tela de instalação. Alguém no local precisa apertar \"Instalar\" com o controle " +
    "(o Android não instala sem confirmação). Até lá, a tela de instalação fica aparecendo na TV.")) return;
  const n = checar(await sb.rpc("mi_tela_atualizar", { p_telas: ids, p_versao: { codigo: APP_PUB.codigo, nome: APP_PUB.nome, sha256: APP_PUB.sha256 } }));
  await carregar(); render(); msg("ok", `Atualização pedida em ${n} TV${n === 1 ? "" : "s"}. Combine com o local para apertarem "Instalar" quando a tela aparecer.`);
}
async function cancelarAtualizacao(id) {
  checar(await sb.rpc("mi_tela_atualizar", { p_telas: [id], p_versao: null }));
  await carregar(); render(); msg("ok", "Pedido de atualização cancelado.");
}
