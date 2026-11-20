package br.com.nervia.midia

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import androidx.core.content.edit
import androidx.core.net.toUri
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Tela única do app: código de vinculação → tela de espera → reprodução em loop do armazenamento local.
 * Fica sempre ligada (FLAG_KEEP_SCREEN_ON), em tela cheia, e volta sozinha se for fechada (Relancar).
 */
@SuppressLint("SetTextI18n")
class MainActivity : Activity() {
    private val escopo = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val prefs by lazy { getSharedPreferences("midia", Context.MODE_PRIVATE) }
    private val baixador by lazy { Baixador(File(filesDir, "midia")) }
    private val exibicoes by lazy { Exibicoes(File(filesDir, "exibicoes")) }   // tempo de tela (relatório do painel)
    private val handler = Handler(Looper.getMainLooper())

    private lateinit var raiz: FrameLayout
    private lateinit var palco: FrameLayout       // tudo o que aparece; gira quando a TV está em pé
    private var rotacao = 0
    private lateinit var playerView: PlayerView
    private lateinit var imagem: ImageView
    private lateinit var painel: LinearLayout     // código / espera
    private lateinit var titulo: TextView
    private lateinit var grande: TextView
    private lateinit var detalhe: TextView
    private lateinit var rodape: TextView
    private lateinit var vitrine: Vitrine            // tela de espera com propaganda (vinculada, sem nada para passar)
    private var player: ExoPlayer? = null
    private var bitmapAtual: Bitmap? = null

    // reprodução
    private var lista: List<Item> = emptyList()
    private var pendente: List<Item>? = null
    private var indice = 0
    private var atual: Item? = null
    private val proximaImagem = Runnable { tocarProximo() }
    /** arquivos que o aparelho não conseguiu tocar ou baixar: nome → motivo (vai no sinal de vida) */
    private val erros = ConcurrentHashMap<String, String>()
    private val falharamAoTocar = ConcurrentHashMap.newKeySet<String>()   // Item.arquivo
    private var baixando = 0
    private var pelaNervia = false   // a rede deste local recusa o Google Drive: baixar pela função da Nervia (até o app reabrir)
    private var avisoDownload = ""   // aviso da última rodada com download falhando; continua na tela enquanto tenta de novo
    private var conteudo = ""
    private var nomeTela = ""
    private val atualizador by lazy { Atualizador(this) }
    private var liberadaAte: String? = null   // último dia liberado pelos créditos (vem na playlist; vale também sem internet)
    private var saindoDeProposito = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        montarTela()
        escopo.launch { principal() }
    }

    override fun onResume() {
        super.onResume()
        telaCheia()
        atual?.let { exibicoes.iniciar(it) }   // voltou à tela: o que está passando volta a contar
        Relancar.cancelar(this)
    }

    override fun onStop() {
        super.onStop()
        exibicoes.fechar()   // fora da tela não conta como tempo de tela
        // saiu da tela (botão Home, outro app, economia de energia): volta sozinho em 3 minutos.
        // O técnico que precisa mexer na TV tem esse tempo; para parar de vez, desinstale ou force a parada.
        if (!saindoDeProposito && !isChangingConfigurations) Relancar.agendar(this, 3 * 60_000L)
    }

    override fun onDestroy() {
        escopo.cancel()
        handler.removeCallbacksAndMessages(null)
        player?.release()
        super.onDestroy()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) telaCheia()
    }

    @Suppress("DEPRECATION")
    private fun telaCheia() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
    }

    // ------------------------------------------------------------------ montagem da tela (sem XML)
    private fun sp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, resources.displayMetrics)
    private fun texto(tam: Float, cor: Int, negrito: Boolean = false) = TextView(this).apply {
        setTextColor(cor); setTextSize(TypedValue.COMPLEX_UNIT_PX, sp(tam)); gravity = Gravity.CENTER
        if (negrito) typeface = Typeface.DEFAULT_BOLD
    }

    @OptIn(UnstableApi::class)
    private fun montarTela() {
        raiz = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        palco = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        playerView = layoutInflater.inflate(R.layout.player, palco, false) as PlayerView
        imagem = ImageView(this).apply { scaleType = ImageView.ScaleType.FIT_CENTER; setBackgroundColor(Color.BLACK); visibility = View.GONE }
        titulo = texto(18f, Color.rgb(154, 170, 176)).apply { text = "NERVIA • Mídia Indoor • app ${BuildConfig.VERSION_NAME}" }
        grande = texto(64f, Color.rgb(95, 211, 211), negrito = true).apply { letterSpacing = 0.3f }
        detalhe = texto(20f, Color.rgb(207, 216, 218))
        rodape = texto(14f, Color.rgb(111, 125, 129))
        painel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setBackgroundColor(Color.rgb(12, 17, 19))
            val m = (sp(12f)).toInt()
            listOf(titulo, grande, detalhe, rodape).forEach { v ->
                addView(v, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { setMargins(m * 3, m, m * 3, m) })
            }
        }
        palco.addView(playerView, FrameLayout.LayoutParams(-1, -1))
        palco.addView(imagem, FrameLayout.LayoutParams(-1, -1))
        palco.addView(painel, FrameLayout.LayoutParams(-1, -1))
        vitrine = Vitrine(this, handler)
        palco.addView(vitrine.view, FrameLayout.LayoutParams(-1, -1))
        raiz.addView(palco, FrameLayout.LayoutParams(-1, -1))
        raiz.addOnLayoutChangeListener { _, l, t, r, b, ol, ot, or_, ob -> if (r - l != or_ - ol || b - t != ob - ot) raiz.post { aplicarRotacao(rotacao) } }
        setContentView(raiz)
        aplicarRotacao(prefs.getInt("rotacao", 0))
        mostrarPainel("", "Iniciando…", "")
    }

    /** Gira o palco (vídeo, imagem e telas do app) para a TV montada em pé ou de cabeça para baixo. */
    private fun aplicarRotacao(graus: Int) {
        rotacao = graus
        val w = raiz.width.takeIf { it > 0 } ?: resources.displayMetrics.widthPixels
        val h = raiz.height.takeIf { it > 0 } ?: resources.displayMetrics.heightPixels
        val deitada = graus == 90 || graus == 270
        palco.layoutParams = if (deitada) FrameLayout.LayoutParams(h, w, Gravity.CENTER) else FrameLayout.LayoutParams(-1, -1)
        palco.rotation = graus.toFloat()
        // tela de espera: empilhada quando o palco fica mais alto que largo (TV em pé ou tela vertical)
        val (pw, ph) = if (deitada) h to w else w to h
        if (::vitrine.isInitialized) vitrine.arrumar(emPe = ph > pw)
        // com a imagem girada, a amostragem da imagem usa o tamanho do palco
        palco.requestLayout()
    }

    private fun pararReproducao() {
        exibicoes.fechar()
        handler.removeCallbacks(proximaImagem)
        player?.stop()
        playerView.visibility = View.GONE
        imagem.visibility = View.GONE
        imagem.setImageDrawable(null)
        bitmapAtual?.recycle(); bitmapAtual = null
        atual = null
    }

    private fun esconderVitrine() = vitrine.esconder()

    /** TV vinculada sem nada para passar: mostra a vitrine; a linha de baixo diz à equipe o que está acontecendo. */
    private fun mostrarVitrine(situacao: String, alerta: String = "") {
        pararReproducao()
        painel.visibility = View.GONE
        val aviso = if (!Relancar.podeAbrirSozinho(this)) "falta a permissão \"Sobrepor a outros apps\"" else ""
        vitrine.mostrar(listOf(nomeTela, situacao, aviso, "app ${BuildConfig.VERSION_NAME}").filter { it.isNotBlank() }.joinToString(" · "), alerta)
    }

    /** Sem créditos de dias: tela de espera com a mensagem neutra (sem falar em pagamento: a tela é vista pelo público). */
    private fun mostrarPausada() = mostrarVitrine("pausada (sem dias liberados)", Creditos.MENSAGEM)

    private fun mostrarPainel(codigo: String, linha: String, baixo: String) {
        pararReproducao()
        esconderVitrine()
        grande.text = codigo; grande.visibility = if (codigo.isEmpty()) View.GONE else View.VISIBLE
        detalhe.text = linha
        val aviso = if (!Relancar.podeAbrirSozinho(this)) "\nAtenção: falta a permissão \"Sobrepor a outros apps\" para abrir sozinho ao ligar a TV." else ""
        rodape.text = baixo + aviso
        painel.visibility = View.VISIBLE
    }

    // ------------------------------------------------------------------ ciclo principal
    private val aparelho: String
        get() = prefs.getString("aparelho", null) ?: UUID.randomUUID().toString().replace("-", "").also { prefs.edit { putString("aparelho", it) } }
    private var token: String?
        get() = prefs.getString("token", null)
        set(v) { prefs.edit { putString("token", v) } }

    private suspend fun principal() {
        while (escopo.isActive) {
            val t = token
            if (t == null) vincular() else try {
                executar(t)
            } catch (_: Desvinculada) {
                Log.i(TAG, "TV desvinculada no painel")
                token = null
                prefs.edit { remove("playlist") }
                lista = emptyList(); pendente = null
                withContext(Dispatchers.IO) { baixador.limpar(emptyList()) }
            }
        }
    }

    /** Mostra o código de 6 caracteres e espera o vínculo no painel. */
    private suspend fun vincular() {
        while (token == null) {
            val r = runCatching { withContext(Dispatchers.IO) { Api.chamar(JSONObject().put("acao", "codigo").put("aparelho", aparelho)) } }.getOrNull()
            if (r == null || r.first >= 400 || r.second.optString("codigo").isEmpty()) {
                mostrarPainel("", "Sem conexão com a Nervia.", r?.second?.optString("mensagem")?.let { "$it\nTentando de novo…" } ?: "Confira a internet da TV. Tentando de novo…")
                delay(15_000); continue
            }
            val codigo = r.second.getString("codigo")
            mostrarPainel(codigo, "Digite este código no painel em TVs → Adicionar TV", "válido por 10 minutos")
            while (true) {
                delay(4_000)
                val a = runCatching { withContext(Dispatchers.IO) {
                    Api.chamar(JSONObject().put("acao", "aguardar").put("aparelho", aparelho).put("codigo", codigo)) } }.getOrNull() ?: continue
                when (a.second.optString("situacao")) {
                    "aguardando" -> continue
                    "vinculado" -> { token = a.second.getString("token"); nomeTela = a.second.optString("tela"); return }
                    else -> break     // expirado/usado/desconhecido: pede outro código
                }
            }
        }
    }

    /** TV vinculada: toca o que já tem, pergunta a playlist de tempos em tempos e manda o sinal de vida. */
    private suspend fun executar(t: String) = coroutineScope {
        val guardada = prefs.getString("playlist", null)?.let { runCatching { Playlist.deJson(JSONObject(it)) }.getOrNull() }
        var intervaloSinal = guardada?.intervaloSinalS ?: 180
        liberadaAte = guardada?.liberadaAte
        if (guardada != null && (guardada.pausada || Creditos.vencida(liberadaAte))) { nomeTela = guardada.tela; mostrarPausada() }
        else if (guardada != null) { nomeTela = guardada.tela; atualizarLista(guardada.itens.filter { baixador.pronto(it) }) }
        else mostrarVitrine("buscando a playlist…")

        val sinal: Job = launch {
            while (isActive) {
                enviarSinal(t)
                enviarExibicoes(t)
                delay(intervaloSinal * 1000L)
            }
        }
        try {
            while (isActive) {
                val p = try {
                    withContext(Dispatchers.IO) { Playlist.deJson(Api.comToken("playlist", t)) }
                } catch (e: Desvinculada) { throw e } catch (e: Exception) {
                    Log.w(TAG, "playlist: ${e.message}")
                    if (Creditos.vencida(liberadaAte)) mostrarPausada()   // sem internet e passou do último dia liberado
                    else if (lista.isEmpty() && atual == null) mostrarVitrine("sem conexão, tentando de novo…")
                    delay(60_000); continue
                }
                nomeTela = p.tela; intervaloSinal = p.intervaloSinalS; liberadaAte = p.liberadaAte
                // atualização pedida pelo painel: baixa e abre a instalação (fora da thread da tela)
                withContext(Dispatchers.IO) {
                    val sit = atualizador.tratar(p.atualizar, System.currentTimeMillis()) { i -> handler.post { runCatching { startActivity(i) } } }
                    if (sit == null) erros.remove(Atualizador.CHAVE) else erros[Atualizador.CHAVE] = sit
                }
                if (p.rotacao != rotacao) { prefs.edit { putInt("rotacao", p.rotacao) }; aplicarRotacao(p.rotacao) }
                prefs.edit { putString("playlist", playlistJson(p)) }
                if (p.pausada) {
                    lista = emptyList(); pendente = null
                    mostrarPausada()
                } else if (p.itens.isEmpty()) {
                    lista = emptyList(); pendente = null
                    mostrarVitrine(if (p.playlist.isEmpty()) "nenhuma playlist escolhida para esta TV" else "a playlist \"${p.playlist}\" está vazia")
                } else {
                    baixarTodos(p, t)
                }
                conteudo = p.conteudo
                // apaga o que não está mais em uso (nem na lista atual, nem na nova)
                val manter = p.itens + lista + (pendente ?: emptyList())
                withContext(Dispatchers.IO) { baixador.limpar(manter) }
                delay(p.intervaloPlaylistS * 1000L)
            }
        } finally {
            sinal.cancel()
        }
    }

    /** Baixa o que falta, um por vez. Parada (sem nada tocando), começa a tocar assim que o 1º arquivo fica pronto;
     *  tocando, a lista nova entra no fim do item que está passando, quando tudo terminar de baixar. */
    private suspend fun baixarTodos(p: Playlist, token: String) {
        val faltam = p.itens.filter { !baixador.pronto(it) }.distinctBy { it.arquivo }
        baixando = faltam.size
        var falhas = 0
        var ultimaFalha = ""
        faltam.forEachIndexed { n, i ->
            if (atual == null) mostrarVitrine("baixando ${n + 1} de ${faltam.size}: ${i.nome}",
                if (falhas > 0) "$falhas de ${faltam.size} arquivo(s) não baixaram: ${explicarFalha(ultimaFalha)}" else avisoDownload)
            try {
                withContext(Dispatchers.IO) { baixar(i, p.chaveApi, token) }
                erros.remove(i.nome)
                if (atual == null) atualizarLista(p.itens.filter { baixador.pronto(it) })
            } catch (e: Exception) {
                Log.w(TAG, "download ${i.nome}: ${e.message}")
                falhas++; ultimaFalha = e.message ?: e.javaClass.simpleName
                erros[i.nome] = "não baixou: $ultimaFalha"
            }
            baixando--
        }
        baixando = p.itens.count { !baixador.pronto(it) }
        // lista completa com o que está no aparelho (o que falhou entra na próxima rodada)
        atualizarLista(p.itens.filter { baixador.pronto(it) })
        // nada para passar porque os downloads falharam: avisa na tela em vez de deixar "baixando…" (não adianta esperar)
        avisoDownload = if (falhas > 0)
            "Não foi possível baixar ${if (falhas == faltam.size) "os arquivos" else "$falhas arquivo(s)"} da playlist: ${explicarFalha(ultimaFalha)}"
        else ""
        if (atual == null && falhas > 0) mostrarVitrine("tenta de novo a cada ${(p.intervaloPlaylistS + 59) / 60} min", avisoDownload)
    }

    /** Direto do Google Drive; se a rede recusar o Google (403, sem conexão com ele), tenta na hora pela Nervia e, dando
     *  certo, passa a usar esse caminho nesta TV até o app reabrir (pedido do Marco em 18/11/2026, rede Nio da Linum Gávea). */
    private fun baixar(i: Item, chaveApi: String, token: String) {
        if (pelaNervia) { baixador.baixar(i, chaveApi, token); return }
        try {
            baixador.baixar(i, chaveApi)
        } catch (e: java.io.IOException) {
            val m = e.message.orEmpty()
            if (m.contains("pouco espaço") || m.contains("md5")) throw e
            Log.w(TAG, "direto falhou (${i.nome}: $m); tentando pela Nervia")
            try {
                baixador.baixar(i, chaveApi, token)
            } catch (e2: java.io.IOException) {
                throw java.io.IOException("$m; pela Nervia: ${e2.message}")
            }
            pelaNervia = true
            Log.i(TAG, "rede deste local recusa o Google Drive: downloads pela Nervia")
        }
    }

    /** Motivo do download que falhou, em linguagem de quem está na loja, com o que fazer. */
    private fun explicarFalha(msg: String): String = when {
        msg.contains("pela Nervia") -> "não foi possível baixar nem direto do Google Drive nem pelo servidor da Nervia. Confira a internet deste local. Detalhe: $msg"
        msg.contains("respondeu 403") ->
            "o Google Drive recusou o download (403). A rede deste local pode estar bloqueando o Google Drive: " +
                "teste com outra internet (ex.: roteador do celular) ou peça para liberar www.googleapis.com. Detalhe: $msg"
        msg.contains("respondeu 404") -> "o arquivo não foi encontrado no Google Drive (apagado ou sem compartilhamento). Detalhe: $msg"
        msg.contains("pouco espaço") -> msg
        msg.contains("Unable to resolve host", true) || msg.contains("UnknownHost", true) || msg.contains("timeout", true) ||
            msg.contains("failed to connect", true) -> "sem conexão com o Google Drive (internet ou rede deste local). Detalhe: $msg"
        else -> msg
    }

    private fun atualizarLista(nova: List<Item>) {
        val atualTocavel = lista
        if (nova.map { it.arquivo to it.tempoS } == atualTocavel.map { it.arquivo to it.tempoS } && pendente == null) return
        if (atual == null) { lista = nova; indice = 0; tocarProximo() }   // parado (espera): começa já
        else pendente = nova                                              // tocando: troca no fim do item
    }

    // ------------------------------------------------------------------ reprodução
    private fun tocarProximo() {
        exibicoes.fechar()
        handler.removeCallbacks(proximaImagem)
        pendente?.let { lista = it; pendente = null; indice = 0 }
        if (Creditos.vencida(liberadaAte)) { mostrarPausada(); return }
        val tocaveis = lista.filter { it.arquivo !in falharamAoTocar && baixador.pronto(it) }
        if (tocaveis.isEmpty()) {
            mostrarVitrine(if (lista.isEmpty()) "aguardando conteúdo" else "nenhum arquivo desta playlist pôde ser exibido neste aparelho")
            return
        }
        val item = tocaveis[indice % tocaveis.size]
        indice = (indice % tocaveis.size) + 1
        atual = item
        exibicoes.iniciar(item)
        painel.visibility = View.GONE
        esconderVitrine()
        val f = baixador.arquivo(item)
        if (item.tipo == "video") tocarVideo(item, f) else mostrarImagem(item, f)
    }

    private fun tocarVideo(item: Item, f: File) {
        val p = player ?: ExoPlayer.Builder(this).build().also { novo ->
            player = novo
            playerView.player = novo
            novo.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    if (state == Player.STATE_ENDED) tocarProximo()
                }
                override fun onPlayerError(error: PlaybackException) {
                    val a = atual ?: return
                    Log.w(TAG, "não tocou ${a.nome}: ${error.errorCodeName}")
                    falharamAoTocar.add(a.arquivo)
                    erros[a.nome] = "este aparelho não toca o vídeo (${error.errorCodeName})"
                    handler.post { tocarProximo() }
                }
            })
        }
        imagem.visibility = View.GONE
        playerView.visibility = View.VISIBLE
        p.setMediaItem(MediaItem.fromUri(android.net.Uri.fromFile(f)))
        p.repeatMode = Player.REPEAT_MODE_OFF
        p.prepare()
        p.play()
    }

    private fun mostrarImagem(item: Item, f: File) {
        player?.stop()
        val bmp = decodificar(f)
        if (bmp == null) {
            falharamAoTocar.add(item.arquivo)
            erros[item.nome] = "este aparelho não abriu a imagem"
            handler.post { tocarProximo() }
            return
        }
        imagem.setImageBitmap(bmp)
        bitmapAtual?.recycle(); bitmapAtual = bmp
        imagem.visibility = View.VISIBLE
        playerView.visibility = View.GONE
        handler.postDelayed(proximaImagem, (item.tempoS ?: 10).coerceIn(3, 300) * 1000L)
    }

    /** Lê a imagem já reduzida para o tamanho da tela (imagem grande demais estoura a memória de TV box) e, se o formato
     *  for diferente do da tela, põe a moldura desfocada no lugar das faixas pretas (Moldura). */
    private fun decodificar(f: File): Bitmap? {
        val b = lerReduzida(f) ?: return null
        val larga = palco.width.takeIf { it > 0 } ?: resources.displayMetrics.widthPixels
        val alta = palco.height.takeIf { it > 0 } ?: resources.displayMetrics.heightPixels
        val m = runCatching { Moldura.montar(b, larga, alta) }.getOrDefault(b)   // sem memória para a moldura: foto como antes
        if (m !== b) b.recycle()
        return m
    }

    private fun lerReduzida(f: File): Bitmap? = runCatching {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.path, o)
        val larga = palco.width.takeIf { it > 0 } ?: resources.displayMetrics.widthPixels
        val alta = palco.height.takeIf { it > 0 } ?: resources.displayMetrics.heightPixels
        val w = larga.coerceAtLeast(720); val h = alta.coerceAtLeast(720)
        var amostra = 1
        while (o.outWidth / (amostra * 2) >= w && o.outHeight / (amostra * 2) >= h) amostra *= 2
        BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = amostra })
    }.getOrNull()

    // ------------------------------------------------------------------ sinal de vida
    /** Manda o tempo de tela anotado (lotes; o que falhar vai no próximo sinal). TV desvinculada: o erro sobe como no sinal. */
    private suspend fun enviarExibicoes(t: String) {
        try {
            withContext(Dispatchers.IO) {
                exibicoes.enviar { codigo, itens -> Api.comToken("exibicoes", t, JSONObject().put("lote", codigo).put("itens", itens)) }
            }
        } catch (e: Desvinculada) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "tempo de tela: ${e.message}")
        }
    }

    private suspend fun enviarSinal(t: String) {
        val corpo = JSONObject()
            .put("versao_app", BuildConfig.VERSION_NAME)
            .put("modelo", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
            .put("android", Build.VERSION.RELEASE)
            .put("tocando", atual?.nome ?: "")
            .put("conteudo", conteudo)
            .put("espaco_livre_mb", baixador.espacoLivreMb())
            .put("baixando", baixando)
            .put("download_pela_nervia", pelaNervia)
            .apply { telaFisica()?.let { (w, h) -> put("tela_largura", w).put("tela_altura", h) } }
            .put("erros", JSONArray(erros.entries.take(20).map { JSONObject().put("nome", it.key).put("erro", it.value) }))
            .put("abre_sozinho", Relancar.podeAbrirSozinho(this))
        try {
            withContext(Dispatchers.IO) { Api.comToken("sinal", t, corpo) }
        } catch (e: Desvinculada) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "sinal: ${e.message}")
        }
    }

    /** Pixels do painel da TV (o maior modo que o aparelho informa; em TV 4K a interface costuma ser 1920×1080, mas o painel é
     *  3840×2160). Vai para o painel, que mostra o tamanho ideal das mídias para esta TV (com a Posição da TV). */
    private fun telaFisica(): Pair<Int, Int>? = runCatching {
        val d = (getSystemService(DISPLAY_SERVICE) as android.hardware.display.DisplayManager).getDisplay(android.view.Display.DEFAULT_DISPLAY)
        val m = d.supportedModes.maxByOrNull { it.physicalWidth.toLong() * it.physicalHeight } ?: d.mode
        m.physicalWidth to m.physicalHeight
    }.getOrNull()?.takeIf { it.first >= 100 && it.second >= 100 }

    private fun playlistJson(p: Playlist) = JSONObject()
        .put("tela", p.tela).put("playlist", p.playlist).put("conteudo", p.conteudo).put("chave_api", p.chaveApi)
        .put("intervalo_playlist_s", p.intervaloPlaylistS).put("intervalo_sinal_s", p.intervaloSinalS).put("rotacao", p.rotacao)
        .put("pausada", p.pausada).put("liberada_ate", p.liberadaAte ?: JSONObject.NULL)
        .put("atualizar", p.atualizar?.let { JSONObject().put("codigo", it.codigo).put("nome", it.nome).put("sha256", it.sha256).put("url", it.url) } ?: JSONObject.NULL)
        .put("itens", JSONArray(p.itens.map {
            JSONObject().put("id", it.id).put("nome", it.nome).put("tipo", it.tipo).put("md5", it.md5).put("tamanho", it.tamanho)
                .put("tempo_s", it.tempoS ?: JSONObject.NULL).put("url", it.url).put("chave_recurso", it.chaveRecurso ?: JSONObject.NULL)
        })).toString()

    companion object {
        private const val TAG = "MidiaIndoor"
    }

    @Suppress("unused")
    private fun abrirPermissaoSobrepor() {
        // em TV box a tela costuma não existir; a Nervia concede por ADB (IMPLANTACAO.md §10)
        runCatching { startActivity(android.content.Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, "package:$packageName".toUri())) }
    }
}
