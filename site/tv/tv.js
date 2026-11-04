// Mídia Indoor — reprodutor web (computador com Chrome/Edge). Faz o mesmo que o app Android da TV (midia-tv/):
//   1) mostra um código de 6 caracteres e espera o vínculo no painel (função midia-tv: codigo / aguardar);
//   2) pergunta a playlist de tempos em tempos (playlist) e baixa as mídias direto do Google Drive (a Drive API responde
//      CORS para nervia.com.br), guardando no armazenamento do navegador (Cache API: vale depois de fechar e abrir);
//   3) passa em loop o que já está guardado, mesmo sem internet; a lista nova entra no fim do item que está passando;
//   4) manda o sinal de vida (sinal) para o painel mostrar online/offline, espaço e erros.
// Sem nada para passar, mostra a tela de espera com propaganda (igual à do app Android).
(() => {
  "use strict";
  const CFG = window.NERVIA_CONFIG || {};
  const VERSAO = "web 1.0";
  const FUNCAO = (CFG.SUPABASE_URL || "") + "/functions/v1/midia-tv";
  const CACHE = "mi-midias-v1";            // mídias baixadas (não muda a cada versão da página: senão baixaria tudo de novo)
  const MB = 1048576;
  const FRASES = ["Sua marca em todas as telas", "Ofertas novas na TV em minutos", "Troque o vídeo sem sair do lugar", "Chame a atenção de quem passa"];

  const $ = (id) => document.getElementById(id);
  const palco = $("palco"), video = $("video"), imagem = $("imagem"), painel = $("painel"), vitrine = $("vitrine");
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const guardado = {
    ler(k) { try { return localStorage.getItem(k); } catch { return null; } },
    gravar(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* navegador sem armazenamento */ } },
  };
  class Desvinculada extends Error {}

  // ---------------------------------------------------------------- identificação do aparelho
  const aparelho = guardado.ler("mi_aparelho") || (() => {
    const a = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    guardado.gravar("mi_aparelho", a);
    return a;
  })();
  let token = guardado.ler("mi_token");

  // ---------------------------------------------------------------- servidor (função midia-tv)
  async function chamar(corpo) {
    const r = await fetch(FUNCAO, {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_ANON_KEY || "" },
      body: JSON.stringify(corpo),
    });
    let j = {};
    try { j = await r.json(); } catch { j = { mensagem: `resposta ${r.status}` }; }
    return [r.status, j];
  }
  async function comToken(acao, extra = {}) {
    const [st, j] = await chamar({ ...extra, acao, token });
    if (st === 401) throw new Desvinculada();
    if (st >= 400 || !j.ok) throw new Error(j.mensagem || `erro ${st}`);
    return j;
  }

  // ---------------------------------------------------------------- playlist
  function lerPlaylist(j) {
    const itens = (j.itens || []).filter((i) => i && (i.tipo === "video" || i.tipo === "imagem") && i.id && i.url);
    const lim = (v, a, b, p) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : p; };
    return {
      tela: j.tela || "", playlist: j.playlist || "", itens, conteudo: j.conteudo || "", chaveApi: j.chave_api || "",
      intervaloPlaylistS: lim(j.intervalo_playlist_s, 20, 3600, 300), intervaloSinalS: lim(j.intervalo_sinal_s, 60, 3600, 180),
      rotacao: [0, 90, 180, 270].includes(Number(j.rotacao)) ? Number(j.rotacao) : 0,
    };
  }
  /** Nome guardado: muda quando o conteúdo muda (md5), igual ao app Android (Item.arquivo). */
  function arquivo(i) {
    const m = /\.([a-z0-9]{2,4})$/i.exec(i.nome || "");
    const ext = m ? m[1].toLowerCase() : (i.tipo === "video" ? "mp4" : "img");
    const marca = String(i.md5 || i.tamanho || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
    return `/tv/midia/${String(i.id).replace(/[^A-Za-z0-9_-]/g, "")}_${marca}.${ext}`;
  }

  // ---------------------------------------------------------------- armazenamento das mídias (Cache API)
  const prontos = new Set();
  async function recarregarProntos() {
    prontos.clear();
    try { for (const k of await (await caches.open(CACHE)).keys()) prontos.add(new URL(k.url).pathname); } catch { /* sem Cache API */ }
  }
  const pronto = (i) => prontos.has(arquivo(i));
  async function espacoLivreMb() {
    try { const e = await navigator.storage.estimate(); return Math.max(0, Math.floor(((e.quota || 0) - (e.usage || 0)) / MB)); } catch { return -1; }
  }
  /** Baixa do Google Drive e guarda. Confere o tamanho (o navegador não calcula md5). */
  async function baixar(i, chaveApi) {
    const chave = arquivo(i);
    if (prontos.has(chave)) return;
    const livre = await espacoLivreMb();
    if (livre >= 0 && livre * MB < Number(i.tamanho || 0) + 50 * MB) throw new Error(`pouco espaço no computador para baixar (${Math.round(i.tamanho / MB)} MB)`);
    const cab = i.chave_recurso ? { "X-Goog-Drive-Resource-Keys": `${i.id}/${i.chave_recurso}` } : {};
    const r = await fetch(`${i.url}&key=${encodeURIComponent(chaveApi)}`, { headers: cab, cache: "no-store" });
    if (r.status !== 200) {
      let msg = ""; try { msg = (await r.json())?.error?.message || ""; } catch { /* corpo não é JSON */ }
      throw new Error(`Google Drive respondeu ${r.status}${msg ? ": " + msg : ""}`);
    }
    const cache = await caches.open(CACHE);
    await cache.put(chave, new Response(r.body, { headers: { "Content-Type": r.headers.get("Content-Type") || (i.tipo === "video" ? "video/mp4" : "image/jpeg") } }));
    const salvo = await cache.match(chave);
    const tam = salvo ? (await salvo.blob()).size : 0;
    if (Number(i.tamanho) > 0 && tam !== Number(i.tamanho)) {
      await cache.delete(chave);
      throw new Error("arquivo baixado incompleto; será baixado de novo");
    }
    prontos.add(chave);
  }
  /** Apaga o que não está em nenhuma das listas. */
  async function limpar(manter) {
    const nomes = new Set(manter.map(arquivo));
    try {
      const cache = await caches.open(CACHE);
      for (const k of await cache.keys()) {
        const p = new URL(k.url).pathname;
        if (!nomes.has(p)) { await cache.delete(k); prontos.delete(p); }
      }
    } catch { /* sem Cache API */ }
  }

  // ---------------------------------------------------------------- telas
  let rotacao = Number(guardado.ler("mi_rotacao")) || 0;
  function aplicarRotacao(graus) {
    rotacao = graus;
    palco.style.setProperty("--rot", graus + "deg");
    palco.classList.toggle("deitado90", graus === 90 || graus === 270);
    const alto = (graus === 90 || graus === 270) ? innerWidth > innerHeight : innerHeight > innerWidth;
    palco.classList.toggle("alto", alto);
  }
  addEventListener("resize", () => aplicarRotacao(rotacao));

  let urlAtual = null, timerImagem = null, timerFrase = null, frase = 0;
  function pararReproducao() {
    clearTimeout(timerImagem);
    video.pause(); video.removeAttribute("src"); video.load();
    video.classList.remove("on"); imagem.classList.remove("on"); imagem.removeAttribute("src");
    if (urlAtual) { URL.revokeObjectURL(urlAtual); urlAtual = null; }
    atual = null;
  }
  function esconderVitrine() { clearInterval(timerFrase); timerFrase = null; vitrine.classList.remove("on"); }
  function mostrarPainel(codigo, linha, baixo) {
    pararReproducao(); esconderVitrine();
    $("pTitulo").textContent = `NERVIA • Mídia Indoor • ${VERSAO}`;
    $("pCodigo").textContent = codigo; $("pCodigo").style.display = codigo ? "" : "none";
    $("pLinha").textContent = linha; $("pRodape").textContent = baixo || "";
    painel.classList.add("on");
  }
  /** TV vinculada sem nada para passar: propaganda; a linha de baixo diz à equipe o que está acontecendo. */
  function mostrarVitrine(situacao) {
    pararReproducao();
    painel.classList.remove("on");
    $("vSituacao").textContent = [nomeTela, situacao, VERSAO].filter(Boolean).join(" · ");
    if (!vitrine.classList.contains("on")) {
      vitrine.classList.add("on");
      clearInterval(timerFrase);
      timerFrase = setInterval(() => {
        const el = $("vFrase"); el.style.opacity = 0;
        setTimeout(() => { frase = (frase + 1) % FRASES.length; el.textContent = FRASES[frase]; el.style.opacity = 1; }, 500);
      }, 7000);
    }
  }

  // ---------------------------------------------------------------- reprodução
  let lista = [], pendente = null, indice = 0, atual = null, nomeTela = "", conteudo = "", baixando = 0;
  const erros = new Map();                 // nome → motivo (vai no sinal de vida)
  const falharam = new Set();              // arquivo(i) que o navegador não tocou
  let mudo = false;
  const INICIO = Date.now();

  function atualizarLista(nova) {
    const igual = (a, b) => a.length === b.length && a.every((x, k) => arquivo(x) === arquivo(b[k]) && x.tempo_s === b[k].tempo_s);
    if (igual(nova, lista) && !pendente) return;
    if (!atual) { lista = nova; indice = 0; tocarProximo(); } else pendente = nova;
  }

  async function tocarProximo() {
    clearTimeout(timerImagem);
    // a página fica aberta dias: recarrega uma vez por dia, entre um item e outro (libera memória do navegador)
    if (Date.now() - INICIO > 20 * 3600e3 && navigator.onLine) { location.reload(); return; }
    if (pendente) { lista = pendente; pendente = null; indice = 0; }
    const tocaveis = lista.filter((i) => !falharam.has(arquivo(i)) && pronto(i));
    if (!tocaveis.length) {
      mostrarVitrine(lista.length ? "nenhum arquivo desta playlist pôde ser exibido neste computador" : "aguardando conteúdo");
      return;
    }
    const item = tocaveis[indice % tocaveis.length];
    indice = (indice % tocaveis.length) + 1;
    atual = item;
    painel.classList.remove("on"); esconderVitrine();
    let blob;
    try { blob = await (await (await caches.open(CACHE)).match(arquivo(item))).blob(); } catch {
      prontos.delete(arquivo(item)); atual = null; setTimeout(tocarProximo, 500); return;
    }
    const antiga = urlAtual;
    urlAtual = URL.createObjectURL(blob);
    if (item.tipo === "video") tocarVideo(item); else mostrarImagem(item);
    if (antiga) setTimeout(() => URL.revokeObjectURL(antiga), 2000);
  }

  function tocarVideo(item) {
    imagem.classList.remove("on");
    video.muted = mudo;
    video.src = urlAtual;
    video.classList.add("on");
    video.play().catch((e) => {
      if (e && e.name === "NotAllowedError" && !video.muted) {
        // o navegador não deixou começar com som: continua sem som e avisa no painel
        mudo = true; video.muted = true;
        erros.set("som", "o navegador bloqueou o som: abra pelo atalho do roteiro de instalação ou clique na tela uma vez");
        video.play().catch(() => falhou(item, "o navegador não iniciou o vídeo"));
      } else if (e && e.name !== "AbortError") falhou(item, "este computador não toca o vídeo");
    });
  }
  function mostrarImagem(item) {
    video.pause(); video.classList.remove("on");
    imagem.onload = () => { imagem.classList.add("on"); };
    imagem.onerror = () => falhou(item, "este computador não abriu a imagem");
    imagem.src = urlAtual;
    timerImagem = setTimeout(tocarProximo, Math.min(300, Math.max(3, Number(item.tempo_s) || 10)) * 1000);
  }
  function falhou(item, motivo) {
    falharam.add(arquivo(item)); erros.set(item.nome, motivo);
    if (atual === item) setTimeout(tocarProximo, 300);
  }
  video.addEventListener("ended", () => tocarProximo());
  video.addEventListener("error", () => { if (atual && atual.tipo === "video" && video.getAttribute("src")) falhou(atual, "este computador não toca o vídeo"); });

  // clique: tela cheia e som liberado (gesto do usuário)
  document.addEventListener("click", () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    if (mudo) { mudo = false; erros.delete("som"); video.muted = false; video.play().catch(() => {}); }
    $("dica").classList.remove("on");
  });
  // mouse aparece quando mexe e some depois de 3 s
  let timerMouse = null;
  document.addEventListener("mousemove", () => {
    document.body.classList.add("mouse"); clearTimeout(timerMouse);
    timerMouse = setTimeout(() => document.body.classList.remove("mouse"), 3000);
  });

  // ---------------------------------------------------------------- tela sempre ligada
  let trava = null;
  async function manterLigada() {
    try { if (!trava && document.visibilityState === "visible" && navigator.wakeLock) { trava = await navigator.wakeLock.request("screen"); trava.addEventListener("release", () => { trava = null; }); } } catch { /* sem permissão */ }
  }
  document.addEventListener("visibilitychange", manterLigada);

  // ---------------------------------------------------------------- ciclo principal
  async function principal() {
    for (;;) {
      if (!token) await vincular();
      else {
        try { await executar(); } catch (e) {
          if (!(e instanceof Desvinculada)) throw e;
          token = null; guardado.gravar("mi_token", null); guardado.gravar("mi_playlist", null);
          lista = []; pendente = null; await limpar([]);
        }
      }
    }
  }

  async function vincular() {
    while (!token) {
      let r = null;
      try { r = await chamar({ acao: "codigo", aparelho }); } catch { r = null; }
      if (!r || r[0] >= 400 || !r[1].codigo) {
        mostrarPainel("", "Sem conexão com a Nervia.", (r && r[1].mensagem ? r[1].mensagem + "\n" : "Confira a internet do computador. ") + "Tentando de novo…");
        await dormir(15000); continue;
      }
      const codigo = r[1].codigo;
      mostrarPainel(codigo, "Digite este código no painel em TVs → Adicionar TV", "válido por 10 minutos");
      for (;;) {
        await dormir(4000);
        let a;
        try { a = await chamar({ acao: "aguardar", aparelho, codigo }); } catch { continue; }
        const sit = a[1].situacao;
        if (sit === "aguardando") continue;
        if (sit === "vinculado") { token = a[1].token; guardado.gravar("mi_token", token); nomeTela = a[1].tela || ""; return; }
        break;   // expirado/usado: pede outro código
      }
    }
  }

  async function executar() {
    let guardada = null;
    try { guardada = JSON.parse(guardado.ler("mi_playlist") || "null"); } catch { guardada = null; }
    let intervaloSinal = guardada?.intervaloSinalS || 180;
    if (guardada) { nomeTela = guardada.tela; atualizarLista(guardada.itens.filter(pronto)); }
    else mostrarVitrine("buscando a playlist…");

    let vivo = true, desvinculou = null;
    (async () => {
      while (vivo) {
        try { await enviarSinal(); } catch (e) { if (e instanceof Desvinculada) { desvinculou = e; vivo = false; break; } }
        await dormir(intervaloSinal * 1000);
      }
    })();
    try {
      while (vivo) {
        let p;
        try { p = lerPlaylist(await comToken("playlist")); } catch (e) {
          if (e instanceof Desvinculada) throw e;
          if (!lista.length && !atual) mostrarVitrine("sem conexão, tentando de novo…");
          await dormir(60000); continue;
        }
        nomeTela = p.tela; intervaloSinal = p.intervaloSinalS;
        if (p.rotacao !== rotacao) { guardado.gravar("mi_rotacao", String(p.rotacao)); aplicarRotacao(p.rotacao); }
        guardado.gravar("mi_playlist", JSON.stringify(p));
        if (!p.itens.length) {
          lista = []; pendente = null;
          mostrarVitrine(p.playlist ? `a playlist "${p.playlist}" está vazia` : "nenhuma playlist escolhida para esta TV");
        } else await baixarTodos(p);
        conteudo = p.conteudo;
        await limpar([...p.itens, ...lista, ...(pendente || [])]);
        for (let s = 0; s < p.intervaloPlaylistS && vivo; s++) await dormir(1000);
      }
      if (desvinculou) throw desvinculou;
    } finally { vivo = false; }
  }

  async function baixarTodos(p) {
    const vistos = new Set();
    const faltam = p.itens.filter((i) => !pronto(i) && !vistos.has(arquivo(i)) && vistos.add(arquivo(i)));
    baixando = faltam.length;
    for (let n = 0; n < faltam.length; n++) {
      const i = faltam[n];
      if (!atual) mostrarVitrine(`baixando ${n + 1} de ${faltam.length}: ${i.nome}`);
      try {
        await baixar(i, p.chaveApi);
        erros.delete(i.nome);
        if (!atual) atualizarLista(p.itens.filter(pronto));
      } catch (e) { erros.set(i.nome, "não baixou: " + (e && e.message ? e.message : e)); }
      baixando--;
    }
    baixando = p.itens.filter((i) => !pronto(i)).length;
    atualizarLista(p.itens.filter(pronto));
  }

  function descreverNavegador() {
    const ua = navigator.userAgent;
    const nav = /Edg\/(\d+)/.exec(ua) ? "Edge " + /Edg\/(\d+)/.exec(ua)[1] : /Chrome\/(\d+)/.exec(ua) ? "Chrome " + /Chrome\/(\d+)/.exec(ua)[1]
      : /Firefox\/(\d+)/.exec(ua) ? "Firefox " + /Firefox\/(\d+)/.exec(ua)[1] : "navegador";
    const so = /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : /Mac OS/.test(ua) ? "macOS" : "";
    return `Computador · ${nav}${so ? " · " + so : ""}`;
  }
  async function enviarSinal() {
    await comToken("sinal", {
      versao_app: VERSAO, modelo: descreverNavegador(), android: "",
      tocando: atual ? atual.nome : "", conteudo, espaco_livre_mb: await espacoLivreMb(), baixando,
      erros: Array.from(erros, ([nome, erro]) => ({ nome, erro })).slice(0, 20),
    });
  }

  // ---------------------------------------------------------------- início
  window.addEventListener("error", () => setTimeout(() => location.reload(), 5 * 60e3), { once: true });
  aplicarRotacao(rotacao);
  if (innerHeight < screen.height - 60) { $("dica").classList.add("on"); setTimeout(() => $("dica").classList.remove("on"), 30000); }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/tv/sw.js", { scope: "/tv/" }).catch(() => {});
  navigator.storage?.persist?.().catch(() => {});
  manterLigada();
  recarregarProntos().then(principal).catch((e) => {
    mostrarPainel("", "Erro no reprodutor.", String(e && e.message || e) + "\nRecarregando em 1 minuto…");
    setTimeout(() => location.reload(), 60000);
  });
  window.__miTeste = { arquivo, lerPlaylist, estado: () => ({ token, lista: lista.map((i) => i.nome), atual: atual && atual.nome, mudo, rotacao, erros: Object.fromEntries(erros) }) };
})();
