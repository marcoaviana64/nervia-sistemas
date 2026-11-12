// Sistema Linum 2.49 — FICHA PARA MOSTRAR À CLIENTE com os vídeos (e fotos) do produto (pedido do Marco em 12/11/2026).
// Cada produto pode ter uma pasta no Google Drive ("qualquer pessoa com o link"); a função linum-videos lista a pasta
// (a chave do Google fica no servidor) e o vídeo toca no player do próprio Drive (drive.google.com/file/d/<id>/preview).
// A ficha mostra só o que a cliente pode ver: nome, preço, tecido, cores e tamanhos disponíveis (sem quantidades nem custo).
// Feita para celular e computador da loja (e tablet depois): vídeo grande, lista ao lado (ou embaixo, no celular).
// Usa as globais do index.html (sb, $, esc, brl, PRODUTOS, LOJAS, qtd, semAc, ordemTam, msg).

let VIDEOS = {};   // produto → link da pasta (lin_videos_produtos)
async function carregarVideos() {
  const r = await sb.rpc("lin_videos_produtos");
  VIDEOS = r.error ? {} : r.data || {};   // sem a migração (ou sem acesso) a ficha só não aparece
}
async function videosFuncao(produto) {
  const { data, error } = await sb.functions.invoke("linum-videos", { body: { produto } });
  if (error) { let m = error.message; try { const j = await error.context.json(); m = j.mensagem || m; } catch (e) { /* sem corpo */ } throw new Error(m); }
  if (data && data.ok === false) throw new Error(data.mensagem);
  return data;
}
const vdUrl = a => `https://drive.google.com/file/d/${encodeURIComponent(a.id)}/preview${a.chave ? "?resourcekey=" + encodeURIComponent(a.chave) : ""}`;

// ficha da cliente; o vídeo cuja nome tem a cor escolhida vem primeiro
async function mostrarCliente(pid) {
  const p = PRODUTOS.find(x => x.id === pid); if (!p) return;
  const vs = (p.variantes || []).filter(v => v.ativo !== false);
  const temNaLoja = v => LOJAS.some(l => qtd(v.id, l.id) > 0);
  const cores = [...new Set(vs.map(v => (v.cor || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const tams = [...new Set(vs.filter(temNaLoja).map(v => (v.tamanho || "").trim()).filter(Boolean))].sort(ordemTam);
  const especiais = vs.filter(v => v.edicao && v.preco_venda != null && Number(v.preco_venda) !== Number(p.preco_venda));
  const V = { arquivos: null, erro: "", atual: 0, cor: "" };
  const d = $("dlg"), f = $("dlgf");
  d.classList.add("largo", "vitrine");
  const lista = () => { if (!V.arquivos) return [];
    if (!V.cor) return V.arquivos;
    const c = semAc(V.cor), com = V.arquivos.filter(a => semAc(a.nome).includes(c));
    return com.length ? com.concat(V.arquivos.filter(a => !com.includes(a))) : V.arquivos; };
  const desenhar = () => {
    const l = lista(), a = l[V.atual] || l[0];
    f.innerHTML = `<div class="vtopo"><h3>${esc(p.descricao)}</h3><span class="acs"><button type="button" class="bt" id="vdcheia" title="Tela cheia">⛶ Tela cheia</button><button type="button" class="bt" id="vdx">Fechar</button></span></div>
      <div class="vcorpo">
        <div class="vplayer">${V.erro ? `<div class="msg err">${esc(V.erro)}</div>`
          : !V.arquivos ? '<div class="vvazio">Carregando os vídeos…</div>'
          : !l.length ? '<div class="vvazio">A pasta deste produto ainda não tem vídeos nem fotos.</div>'
          : `<iframe src="${vdUrl(a)}" allow="autoplay; fullscreen" allowfullscreen title="${esc(a.nome)}"></iframe>`}</div>
        ${l.length ? `<div class="vlista">${l.map((x, i) => `<button type="button" class="${x === a ? "on" : ""}" data-vd="${i}">${x.tipo === "video" ? "▶" : "▣"} ${esc(x.nome)}</button>`).join("")}</div>` : ""}
      </div>
      <div class="vinfo">
        <div class="vpreco">${p.preco_venda != null ? brl(p.preco_venda) : ""}${p.tecido ? `<span> · ${esc(p.tecido)}</span>` : ""}</div>
        ${especiais.length ? `<div class="mut">${[...new Set(especiais.map(v => `${v.edicao}: ${brl(v.preco_venda)}`))].map(esc).join(" · ")}</div>` : ""}
        ${cores.length ? `<div class="vlin2"><b>Cores</b>${cores.map(c => `<button type="button" class="pilula ${V.cor === c ? "on" : ""}" data-vcor="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : ""}
        ${tams.length ? `<div class="vlin2"><b>Tamanhos</b>${tams.map(t => `<span class="vtam">${esc(t)}</span>`).join("")}</div>` : ""}
      </div>`;
    $("vdx").onclick = () => d.close();
    $("vdcheia").onclick = () => { const el = d; (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen ? el.webkitRequestFullscreen() : null); };
    f.querySelectorAll("[data-vd]").forEach(b => b.onclick = () => { V.atual = +b.dataset.vd; desenhar(); });
    f.querySelectorAll("[data-vcor]").forEach(b => b.onclick = () => { V.cor = V.cor === b.dataset.vcor ? "" : b.dataset.vcor; V.atual = 0; desenhar(); });
  };
  d.addEventListener("close", () => { d.classList.remove("vitrine"); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }, { once: true });
  desenhar();
  if (!d.open) d.showModal();
  try { V.arquivos = (await videosFuncao(pid)).arquivos || []; } catch (e) { V.erro = e.message; }
  if (d.open && d.classList.contains("vitrine")) desenhar();
}
