package app.iptv.player

import android.annotation.SuppressLint
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextUtils
import android.text.TextWatcher
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.annotation.OptIn
import androidx.core.os.HandlerCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import java.util.concurrent.Executors

@OptIn(UnstableApi::class)
class MainActivity : ComponentActivity() {

    private enum class Tipo { FAVORITOS, TODOS, GRUPO, ATUALIZAR, CONFIGURAR, SAIR }
    private data class Entrada(val rotulo: String, val tipo: Tipo, val grupo: String? = null)

    private lateinit var repo: Repositorio
    private lateinit var player: ExoPlayer
    private lateinit var video: PlayerView
    private lateinit var raiz: FrameLayout
    private lateinit var painel: LinearLayout
    private lateinit var rvGrupos: RecyclerView
    private lateinit var rvCanais: RecyclerView
    private lateinit var busca: EditText
    private lateinit var titulo: TextView
    private lateinit var barra: TextView
    private lateinit var aviso: TextView
    private var telaConfig: View? = null
    private var configurador: Configurador? = null

    private val bg = Executors.newSingleThreadExecutor()
    private val h = Handler(Looper.getMainLooper())

    private var todos: List<Canal> = emptyList()
    private var porGrupo: Map<String, List<Canal>> = emptyMap()
    private var entradas: List<Entrada> = emptyList()
    private var grupoSel = -1
    private var visiveis: List<Canal> = emptyList()
    private var atual: Canal? = null
    private var sequencia: List<Canal> = emptyList()
    private var tentativas = 0
    private var mimeForcado: String? = null
    private var parado = false
    private var primeiraCarga = true
    /** A lista tem logos? Sem nenhum, a coluna do logo some. */
    private var algumLogo = false

    private val corDestaque = Color.rgb(0x2F, 0x9F, 0xD0)
    private val Int.dp get() = (this * resources.displayMetrics.density).toInt()

    // ---------------------------------------------------------------- ciclo de vida

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        repo = Repositorio(this)
        montarTela()

        player = ExoPlayer.Builder(this).build()
        video.player = player
        player.addListener(ouvinte)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = voltar()
        })

        when {
            repo.urlLista == null -> mostrarConfig()
            repo.temCopia() -> {
                avisar("Abrindo a lista…")
                bg.execute {
                    val canais = try { repo.lerCopia() } catch (_: Exception) { emptyList() }
                    runOnUiThread {
                        if (canais.isEmpty()) baixarLista(false) else {
                            avisar(null); aplicar(canais)
                            if (repo.copiaVelha()) baixarLista(true)
                        }
                    }
                }
            }
            else -> baixarLista(false)
        }
    }

    override fun onStart() {
        super.onStart()
        if (parado) { parado = false; atual?.let { iniciar(it) } }
    }

    override fun onStop() {
        super.onStop()
        parado = true
        h.removeCallbacks(tentarDeNovo)
        player.stop()
    }

    override fun onDestroy() {
        player.release()
        configurador?.parar()
        bg.shutdownNow()
        h.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    // ---------------------------------------------------------------- tela

    private fun texto(tam: Float, cor: Int = Color.WHITE) = TextView(this).apply {
        textSize = tam; setTextColor(cor)
    }

    private fun montarTela() {
        raiz = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        video = PlayerView(this).apply {
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShutterBackgroundColor(Color.BLACK)
            isFocusable = false
        }
        raiz.addView(video, FrameLayout.LayoutParams(-1, -1))

        // painel: grupos à esquerda, canais à direita
        painel = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.argb(225, 8, 12, 16))
            setPadding(24.dp, 16.dp, 24.dp, 16.dp)
        }
        rvGrupos = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@MainActivity)
            adapter = AdGrupos()
            itemAnimator = null
        }
        painel.addView(rvGrupos, LinearLayout.LayoutParams(0, -1, 0.3f))

        val coluna = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(20.dp, 0, 0, 0) }
        titulo = texto(15f, Color.LTGRAY).apply { setPadding(4.dp, 0, 0, 6.dp) }
        coluna.addView(titulo)
        busca = EditText(this).apply {
            hint = "Buscar canal ou filme…"
            setHintTextColor(Color.GRAY); setTextColor(Color.WHITE); textSize = 16f
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            inputType = InputType.TYPE_CLASS_TEXT
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    h.removeCallbacks(filtrar); h.postDelayed(filtrar, 250)
                }
            })
        }
        coluna.addView(busca, LinearLayout.LayoutParams(-1, -2))
        rvCanais = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@MainActivity)
            adapter = AdCanais()
            itemAnimator = null
        }
        coluna.addView(rvCanais, LinearLayout.LayoutParams(-1, 0, 1f))
        painel.addView(coluna, LinearLayout.LayoutParams(0, -1, 0.7f))
        painel.visibility = View.GONE
        raiz.addView(painel, FrameLayout.LayoutParams(-1, -1))

        barra = texto(20f).apply {
            setBackgroundColor(Color.argb(200, 0, 0, 0))
            setPadding(28.dp, 14.dp, 28.dp, 14.dp)
            visibility = View.GONE
        }
        raiz.addView(barra, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))

        aviso = texto(20f).apply {
            gravity = Gravity.CENTER
            setBackgroundColor(Color.argb(170, 0, 0, 0))
            setPadding(28.dp, 16.dp, 28.dp, 16.dp)
            visibility = View.GONE
        }
        raiz.addView(aviso, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))
        setContentView(raiz)
    }

    private fun avisar(msg: String?) {
        aviso.text = msg.orEmpty()
        aviso.visibility = if (msg == null) View.GONE else View.VISIBLE
    }

    private val esconderBarra = Runnable { barra.visibility = View.GONE }

    private fun mostrarBarra() {
        val c = atual ?: return
        val pos = sequencia.indexOf(c)
        val sb = StringBuilder()
        if (pos >= 0) sb.append(pos + 1).append("   ")
        sb.append(c.nome).append('\n').append(c.grupo)
        if (ehFilme()) {
            sb.append("     ").append(tempo(player.currentPosition)).append(" / ").append(tempo(player.duration))
            if (!player.isPlaying) sb.append("   ❚❚ pausado")
        }
        barra.text = sb
        barra.visibility = View.VISIBLE
        h.removeCallbacks(esconderBarra)
        h.postDelayed(esconderBarra, 4000)
    }

    private fun tempo(ms: Long): String {
        if (ms == C.TIME_UNSET || ms < 0) return "--:--"
        val s = ms / 1000
        return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
    }

    /** Filme/episódio (tem duração): aceita pausar e avançar. Canal ao vivo, não. */
    private fun ehFilme() = player.isCurrentMediaItemSeekable && player.duration != C.TIME_UNSET && player.duration > 0

    // ---------------------------------------------------------------- lista

    private fun baixarLista(silencioso: Boolean) {
        if (!silencioso) avisar("Baixando a lista…")
        bg.execute {
            try {
                val canais = repo.baixar()
                runOnUiThread { if (!silencioso) avisar(null); aplicar(canais) }
            } catch (e: Exception) {
                runOnUiThread {
                    val msg = "Não foi possível baixar a lista: ${e.message ?: e.javaClass.simpleName}"
                    if (silencioso) return@runOnUiThread
                    avisar(null)
                    if (todos.isEmpty()) mostrarConfig(msg) else Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun aplicar(canais: List<Canal>) {
        todos = canais
        algumLogo = canais.any { it.logo != null }
        porGrupo = canais.groupBy { it.grupo }
        entradas = buildList {
            add(Entrada("★  Favoritos", Tipo.FAVORITOS))
            add(Entrada("Todos  (${canais.size})", Tipo.TODOS))
            porGrupo.forEach { (g, l) -> add(Entrada("$g  (${l.size})", Tipo.GRUPO, g)) }
            add(Entrada("↻  Atualizar lista", Tipo.ATUALIZAR))
            add(Entrada("⚙  Trocar lista", Tipo.CONFIGURAR))
            add(Entrada("✕  Sair", Tipo.SAIR))
        }
        rvGrupos.adapter?.notifyDataSetChanged()
        atual = atual?.let { a -> canais.firstOrNull { it.url == a.url } }

        if (primeiraCarga) {
            primeiraCarga = false
            val ultimo = repo.ultimoCanal?.let { u -> canais.firstOrNull { it.url == u } }
            if (ultimo != null) {
                selecionarGrupo(indiceDoGrupo(ultimo), focar = false)
                tocar(ultimo, porGrupo[ultimo.grupo].orEmpty())
                return
            }
            selecionarGrupo(if (repo.favoritos.isNotEmpty()) 0 else 1, focar = false)
            mostrarPainel()
        } else {
            selecionarGrupo(grupoSel.coerceIn(0, entradas.size - 1), focar = false)
        }
    }

    private fun indiceDoGrupo(c: Canal) = entradas.indexOfFirst { it.tipo == Tipo.GRUPO && it.grupo == c.grupo }.coerceAtLeast(1)

    private fun canaisDe(e: Entrada): List<Canal> = when (e.tipo) {
        Tipo.FAVORITOS -> repo.favoritos.let { f -> todos.filter { it.url in f } }
        Tipo.TODOS -> todos
        Tipo.GRUPO -> porGrupo[e.grupo].orEmpty()
        else -> visiveis
    }

    private fun selecionarGrupo(i: Int, focar: Boolean) {
        val e = entradas.getOrNull(i) ?: return
        if (e.tipo !in setOf(Tipo.FAVORITOS, Tipo.TODOS, Tipo.GRUPO)) return
        val antes = grupoSel
        grupoSel = i
        if (busca.text.isNotEmpty()) busca.setText("")
        visiveis = canaisDe(e)
        titulo.text = when {
            e.tipo == Tipo.FAVORITOS && visiveis.isEmpty() ->
                "Favoritos: nenhum ainda. Segure OK (ou aperte Menu) num canal para marcar."
            else -> "${e.rotulo.substringBeforeLast("  (")} · ${visiveis.size}"
        }
        rvCanais.adapter?.notifyDataSetChanged()
        rvCanais.scrollToPosition(0)
        if (antes >= 0) rvGrupos.adapter?.notifyItemChanged(antes)
        rvGrupos.adapter?.notifyItemChanged(i)
        if (focar) focarCanal(0)
    }

    private val filtrar = Runnable {
        val q = semAcento(busca.text.toString().trim())
        if (q.isEmpty()) {
            entradas.getOrNull(grupoSel)?.let { visiveis = canaisDe(it); titulo.text = "${it.rotulo.substringBeforeLast("  (")} · ${visiveis.size}" }
        } else {
            val partes = q.split(Regex("\\s+"))
            visiveis = todos.filter { c -> partes.all { c.chave.contains(it) } }
            titulo.text = "Busca: ${visiveis.size} resultado(s)"
        }
        rvCanais.adapter?.notifyDataSetChanged()
        rvCanais.scrollToPosition(0)
    }

    private fun focarCanal(i: Int) {
        if (visiveis.isEmpty()) return
        val p = i.coerceIn(0, visiveis.size - 1)
        (rvCanais.layoutManager as LinearLayoutManager).scrollToPositionWithOffset(p, 120.dp)
        rvCanais.post { rvCanais.findViewHolderForAdapterPosition(p)?.itemView?.requestFocus() }
    }

    private fun mostrarPainel() {
        painel.visibility = View.VISIBLE
        barra.visibility = View.GONE
        val i = atual?.let { visiveis.indexOf(it) } ?: -1
        if (i >= 0) focarCanal(i)
        else if (visiveis.isNotEmpty()) focarCanal(0)
        else rvGrupos.post { rvGrupos.findViewHolderForAdapterPosition(grupoSel.coerceAtLeast(0))?.itemView?.requestFocus() }
    }

    private fun esconderPainel() {
        painel.visibility = View.GONE
        currentFocus?.clearFocus()
        raiz.requestFocus()
    }

    private fun alternarFavorito(c: Canal) {
        val marcado = repo.alternarFavorito(c.url)
        Toast.makeText(this, if (marcado) "★ ${c.nome} nos favoritos" else "${c.nome} saiu dos favoritos", Toast.LENGTH_SHORT).show()
        if (entradas.getOrNull(grupoSel)?.tipo == Tipo.FAVORITOS && busca.text.isEmpty()) {
            val pos = visiveis.indexOf(c)
            selecionarGrupo(grupoSel, focar = false)
            focarCanal(pos)
        } else {
            rvCanais.adapter?.notifyItemChanged(visiveis.indexOf(c))
        }
    }

    // ---------------------------------------------------------------- reprodução

    private fun tocar(c: Canal, seq: List<Canal>) {
        val anterior = atual
        atual = c
        sequencia = seq.ifEmpty { listOf(c) }
        repo.ultimoCanal = c.url
        tentativas = 0
        mimeForcado = null
        iniciar(c)
        esconderPainel()
        mostrarBarra()
        anterior?.let { a -> visiveis.indexOf(a).takeIf { it >= 0 }?.let { rvCanais.adapter?.notifyItemChanged(it) } }
        visiveis.indexOf(c).takeIf { it >= 0 }?.let { rvCanais.adapter?.notifyItemChanged(it) }
    }

    private fun mimeDe(url: String): String? {
        val u = url.substringBefore('?').lowercase()
        return when {
            u.endsWith(".m3u8") || u.endsWith(".m3u") || url.contains("m3u8", true) -> MimeTypes.APPLICATION_M3U8
            u.endsWith(".mpd") -> MimeTypes.APPLICATION_MPD
            else -> null
        }
    }

    private fun iniciar(c: Canal) {
        h.removeCallbacks(tentarDeNovo)
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent(c.userAgent ?: Repositorio.USER_AGENT)
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(20_000)
        c.referer?.let { http.setDefaultRequestProperties(mapOf("Referer" to it)) }
        val item = MediaItem.Builder().setUri(c.url).apply { (mimeForcado ?: mimeDe(c.url))?.let { setMimeType(it) } }.build()
        val fonte = DefaultMediaSourceFactory(DefaultDataSource.Factory(this, http)).createMediaSource(item)
        player.setMediaSource(fonte)
        player.prepare()
        player.playWhenReady = true
    }

    private val tentarDeNovo = Runnable { atual?.let { iniciar(it) } }

    private val ouvinte = object : Player.Listener {
        override fun onPlaybackStateChanged(estado: Int) {
            when (estado) {
                Player.STATE_BUFFERING -> avisar("Carregando…")
                Player.STATE_READY -> { avisar(null); tentativas = 0 }
                Player.STATE_ENDED -> {
                    avisar(null)
                    // canal ao vivo que o servidor fechou: reconecta. Filme que acabou: abre a lista.
                    if (player.duration == C.TIME_UNSET || !player.isCurrentMediaItemSeekable) atual?.let { iniciar(it) }
                    else mostrarPainel()
                }
                else -> Unit
            }
        }

        override fun onPlayerError(e: PlaybackException) {
            val c = atual ?: return
            if (e.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                player.seekToDefaultPosition(); player.prepare(); return
            }
            // endereço sem extensão que na verdade é HLS: tenta de novo como HLS
            if (mimeForcado == null && mimeDe(c.url) == null && e.errorCode in setOf(
                    PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
                    PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED)) {
                mimeForcado = MimeTypes.APPLICATION_M3U8
                iniciar(c); return
            }
            if (tentativas < 3) {
                tentativas++
                avisar("Sem sinal em \"${c.nome}\"… tentando de novo ($tentativas/3)")
                h.postDelayed(tentarDeNovo, 3000)
            } else {
                avisar("Não foi possível abrir \"${c.nome}\".\n${motivo(e)}\nEscolha outro canal (OK abre a lista).")
            }
        }
    }

    private fun motivo(e: PlaybackException) = when (e.errorCode) {
        PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> "O servidor recusou (assinatura vencida, limite de telas ou canal fora do ar)."
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "Sem conexão com o servidor."
        PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES -> "Este aparelho não consegue tocar o formato deste canal."
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED -> "Formato de transmissão não suportado."
        else -> e.errorCodeName
    }

    private fun zapear(passo: Int) {
        val c = atual ?: return
        if (sequencia.size < 2) return
        val i = sequencia.indexOf(c).let { if (it < 0) 0 else it }
        val n = sequencia[(i + passo).mod(sequencia.size)]
        tocar(n, sequencia)
    }

    // ---------------------------------------------------------------- teclas

    /** Assistindo (sem lista nem configuração na tela): as teclas do controle mandam no player. */
    private fun assistindo() = telaConfig == null && painel.visibility != View.VISIBLE && atual != null

    override fun onKeyUp(keyCode: Int, ev: KeyEvent): Boolean =
        if (assistindo() && keyCode in TECLAS_PLAYER) true else super.onKeyUp(keyCode, ev)

    override fun onKeyDown(keyCode: Int, ev: KeyEvent): Boolean {
        if (!assistindo()) return super.onKeyDown(keyCode, ev)
        val filme = ehFilme()
        when (keyCode) {
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_DOWN -> if (filme) mostrarBarra() else zapear(-1)
            KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_UP -> if (filme) mostrarBarra() else zapear(+1)
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND ->
                if (filme) { player.seekTo((player.currentPosition - 10_000).coerceAtLeast(0)); mostrarBarra() } else mostrarPainel()
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD ->
                if (filme) { player.seekTo(player.currentPosition + 30_000); mostrarBarra() } else mostrarPainel()
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER ->
                if (filme) { player.playWhenReady = !player.playWhenReady; mostrarBarra() } else mostrarPainel()
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> {
                player.playWhenReady = !player.playWhenReady; mostrarBarra()
            }
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_GUIDE -> mostrarPainel()
            KeyEvent.KEYCODE_INFO -> mostrarBarra()
            else -> return super.onKeyDown(keyCode, ev)
        }
        return true
    }

    private fun voltar() {
        when {
            telaConfig != null -> if (todos.isNotEmpty()) fecharConfig() else finish()
            painel.visibility == View.VISIBLE && busca.text.isNotEmpty() -> busca.setText("")
            painel.visibility == View.VISIBLE && atual != null -> esconderPainel()
            painel.visibility == View.VISIBLE -> finish()
            else -> mostrarPainel()
        }
    }

    // ---------------------------------------------------------------- configuração da lista

    @SuppressLint("SetTextI18n")
    private fun mostrarConfig(erro: String? = null) {
        if (telaConfig != null) fecharConfig()
        player.pause()
        val conf = Configurador { url -> runOnUiThread { receberLista(url) } }
        conf.iniciar()
        configurador = conf
        val ip = Configurador.ipLocal()
        val endereco = ip?.let { "http://$it:${conf.porta}" }

        val tela = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.rgb(10, 14, 20))
            setPadding(48.dp, 32.dp, 48.dp, 32.dp)
            isClickable = true
        }
        val esq = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        esq.addView(texto(30f).apply { text = "Configurar a lista IPTV"; typeface = Typeface.DEFAULT_BOLD })
        erro?.let { esq.addView(texto(16f, Color.rgb(255, 120, 110)).apply { text = it; setPadding(0, 12.dp, 0, 0) }) }
        esq.addView(texto(18f, Color.LTGRAY).apply {
            setPadding(0, 16.dp, 0, 16.dp)
            text = if (endereco != null)
                "Pelo celular (mais fácil):\n1. Conecte o celular na mesma rede Wi-Fi da TV.\n2. Leia o QR code ou abra  $endereco\n" +
                    "3. Cole o endereço M3U do seu provedor e toque em Enviar.\n\nOu digite o endereço aqui com o controle:"
            else "Digite o endereço M3U do seu provedor com o controle:"
        })
        val campo = EditText(this).apply {
            hint = "http://servidor:porta/get.php?username=…&password=…&type=m3u_plus"
            setHintTextColor(Color.GRAY); setTextColor(Color.WHITE); textSize = 16f
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_DONE
            setText(if (repo.urlLista == null) "http://" else "")
        }
        esq.addView(campo, LinearLayout.LayoutParams(-1, -2))
        val botoes = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, 12.dp, 0, 0) }
        val salvar = Button(this).apply {
            text = "Salvar e carregar"
            setOnClickListener {
                val u = campo.text.toString().trim()
                if (u.length > 10 && (u.startsWith("http://") || u.startsWith("https://"))) receberLista(u)
                else Toast.makeText(this@MainActivity, "O endereço tem de começar com http:// ou https://", Toast.LENGTH_LONG).show()
            }
        }
        botoes.addView(salvar)
        if (todos.isNotEmpty()) botoes.addView(Button(this).apply { text = "Cancelar"; setOnClickListener { fecharConfig() } })
        esq.addView(botoes)
        tela.addView(esq, LinearLayout.LayoutParams(0, -2, 1f))
        if (endereco != null) {
            tela.addView(ImageView(this).apply {
                setImageBitmap(Configurador.qr(endereco, 420))
                setPadding(32.dp, 0, 0, 0)
            }, LinearLayout.LayoutParams(260.dp, 260.dp))
        }
        raiz.addView(tela, FrameLayout.LayoutParams(-1, -1))
        telaConfig = tela
        avisar(null)
        salvar.post { salvar.requestFocus() }
    }

    private fun fecharConfig() {
        configurador?.parar(); configurador = null
        telaConfig?.let { raiz.removeView(it) }
        telaConfig = null
        if (atual != null && painel.visibility != View.VISIBLE) player.play() else if (painel.visibility != View.VISIBLE && todos.isNotEmpty()) mostrarPainel()
    }

    private fun receberLista(url: String) {
        repo.urlLista = url
        val primeira = todos.isEmpty()
        fecharConfig()
        if (primeira) primeiraCarga = true
        baixarLista(false)
    }

    private fun acao(e: Entrada) {
        when (e.tipo) {
            Tipo.ATUALIZAR -> baixarLista(false)
            Tipo.CONFIGURAR -> mostrarConfig()
            Tipo.SAIR -> finish()
            else -> { selecionarGrupo(entradas.indexOf(e), focar = true) }
        }
    }

    // ---------------------------------------------------------------- listas (RecyclerView)

    private class VH(v: View) : RecyclerView.ViewHolder(v)

    private fun pintar(v: View, focado: Boolean, marcado: Boolean) {
        v.setBackgroundColor(when {
            focado -> corDestaque
            marcado -> Color.argb(60, 255, 255, 255)
            else -> Color.TRANSPARENT
        })
    }

    private inner class AdGrupos : RecyclerView.Adapter<VH>() {
        override fun getItemCount() = entradas.size
        override fun onCreateViewHolder(p: ViewGroup, t: Int): VH {
            val tv = texto(17f).apply {
                setPadding(14.dp, 11.dp, 14.dp, 11.dp)
                isFocusable = true; isClickable = true
                isSingleLine = true; ellipsize = TextUtils.TruncateAt.END
                layoutParams = RecyclerView.LayoutParams(-1, -2)
            }
            return VH(tv)
        }
        override fun onBindViewHolder(vh: VH, pos: Int) {
            val tv = vh.itemView as TextView
            val e = entradas[pos]
            tv.text = e.rotulo
            tv.setTextColor(if (e.tipo in setOf(Tipo.ATUALIZAR, Tipo.CONFIGURAR, Tipo.SAIR)) Color.LTGRAY else Color.WHITE)
            pintar(tv, tv.hasFocus(), pos == grupoSel)
            tv.setOnFocusChangeListener { v, f ->
                val p = vh.bindingAdapterPosition
                pintar(v, f, p == grupoSel)
                if (f && p >= 0 && p != grupoSel && entradas[p].tipo in setOf(Tipo.FAVORITOS, Tipo.TODOS, Tipo.GRUPO)) {
                    h.removeCallbacksAndMessages(TROCA_GRUPO)
                    HandlerCompat.postDelayed(h, { if (v.hasFocus()) selecionarGrupo(p, focar = false) }, TROCA_GRUPO, 200)
                }
            }
            tv.setOnClickListener { vh.bindingAdapterPosition.takeIf { it >= 0 }?.let { acao(entradas[it]) } }
        }
    }

    private inner class AdCanais : RecyclerView.Adapter<VH>() {
        override fun getItemCount() = visiveis.size
        override fun onCreateViewHolder(p: ViewGroup, t: Int): VH {
            val linha = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(10.dp, 6.dp, 10.dp, 6.dp)
                isFocusable = true; isClickable = true; isLongClickable = true
                layoutParams = RecyclerView.LayoutParams(-1, -2)
            }
            linha.addView(texto(14f, Color.GRAY).apply { gravity = Gravity.END; setPadding(0, 0, 12.dp, 0) }, LinearLayout.LayoutParams(52.dp, -2))
            linha.addView(ImageView(this@MainActivity).apply { scaleType = ImageView.ScaleType.FIT_CENTER }, LinearLayout.LayoutParams(64.dp, 36.dp))
            linha.addView(texto(18f).apply {
                isSingleLine = true; ellipsize = TextUtils.TruncateAt.END; setPadding(14.dp, 0, 8.dp, 0)
            }, LinearLayout.LayoutParams(0, -2, 1f))
            linha.addView(texto(18f, Color.rgb(255, 200, 60)))
            return VH(linha)
        }
        override fun onBindViewHolder(vh: VH, pos: Int) {
            val linha = vh.itemView as LinearLayout
            val c = visiveis[pos]
            (linha.getChildAt(0) as TextView).text = (pos + 1).toString()
            (linha.getChildAt(1) as ImageView).let { img ->
                img.visibility = if (algumLogo) View.VISIBLE else View.GONE
                Logos.mostrar(img, c.logo)
            }
            (linha.getChildAt(2) as TextView).apply {
                text = if (busca.text.isNotEmpty()) "${c.nome}   ·  ${c.grupo}" else c.nome
                setTextColor(if (c == atual) Color.rgb(120, 210, 255) else Color.WHITE)
            }
            (linha.getChildAt(3) as TextView).text = if (c.url in repo.favoritos) "★" else ""
            pintar(linha, linha.hasFocus(), false)
            linha.setOnFocusChangeListener { v, f -> pintar(v, f, false) }
            linha.setOnClickListener { vh.bindingAdapterPosition.takeIf { it >= 0 }?.let { tocar(visiveis[it], visiveis) } }
            linha.setOnLongClickListener { vh.bindingAdapterPosition.takeIf { it >= 0 }?.let { alternarFavorito(visiveis[it]) }; true }
            linha.setOnKeyListener { _, k, ev ->
                if (k == KeyEvent.KEYCODE_MENU && ev.action == KeyEvent.ACTION_UP) {
                    vh.bindingAdapterPosition.takeIf { it >= 0 }?.let { alternarFavorito(visiveis[it]) }; true
                } else k == KeyEvent.KEYCODE_MENU
            }
        }
    }

    private companion object {
        val TROCA_GRUPO = Any()
        val TECLAS_PLAYER = setOf(
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT,
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_CHANNEL_UP,
            KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_MEDIA_REWIND, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE,
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_GUIDE, KeyEvent.KEYCODE_INFO)
    }
}
