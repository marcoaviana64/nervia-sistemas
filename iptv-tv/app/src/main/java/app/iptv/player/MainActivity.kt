package app.iptv.player

import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputFilter
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
import android.widget.HorizontalScrollView
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
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import java.util.concurrent.TimeUnit
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

@OptIn(UnstableApi::class)
class MainActivity : ComponentActivity() {

    enum class Aba(val rotulo: String) { TV("TV ao vivo"), FILMES("Filmes"), SERIES("Séries"), AJUSTES("Ajustes") }
    private enum class TE { FAVORITOS, CONTINUAR, TODOS, GRUPO, ACAO }
    private data class Entrada(val rotulo: String, val tipo: TE, val grupo: String? = null, val acao: String? = null, val bloqueado: Boolean = false)

    private lateinit var repo: Repositorio
    private lateinit var guia: Guia
    private lateinit var player: ExoPlayer
    /** O PlayerView em uso agora: [videoCheio] (tela cheia) ou [videoPrevia] (caixa da prévia). */
    private lateinit var video: PlayerView
    private lateinit var videoCheio: PlayerView
    private lateinit var videoPrevia: PlayerView
    private lateinit var raiz: FrameLayout
    private lateinit var painel: LinearLayout
    private lateinit var rvGrupos: RecyclerView
    private lateinit var rvItens: RecyclerView
    private lateinit var busca: EditText
    private lateinit var titulo: TextView
    private lateinit var guiaBox: TextView
    private lateinit var infoAjustes: TextView
    private lateinit var barra: TextView
    private lateinit var aviso: TextView
    // 2.7 (pedido do Marco em 18/11/2026, com a foto de outro app): TV ao vivo em 3 colunas — grupos, canais e,
    // à direita, a prévia do canal (o mesmo player, menor) com a programação embaixo.
    private lateinit var lado: LinearLayout
    private lateinit var previa: FrameLayout
    private lateinit var previaTexto: TextView
    private lateinit var coluna: LinearLayout
    private lateinit var relogio: TextView
    private lateinit var status: TextView
    /** 2.10: aviso pequeno de vencimento da lista, no canto de baixo à esquerda. */
    private lateinit var lembrete: TextView
    private var proximoLembrete = 0L
    /** 2.12: resumo de uso para o painel da Nervia (somado aqui, enviado a cada 30 min). */
    private val telemetria by lazy { Telemetria(this, Telemetria.destino ?: BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_CHAVE) }
    /** 2.10: vigia do canal ao vivo (reconecta quando a imagem para). */
    private val vigia = Vigia()
    /** Lista nova baixada em segundo plano enquanto a pessoa assiste em tela cheia: aplica ao abrir a lista. */
    private var catalogoPendente: Catalogo? = null
    private val abas = LinkedHashMap<Aba, TextView>()
    private var telaConfig: View? = null
    private var ficha: View? = null
    private var configurador: Configurador? = null

    private val bg = Executors.newSingleThreadExecutor()
    private val rede = Executors.newFixedThreadPool(2)
    private val h = Handler(Looper.getMainLooper())

    private var catalogo: Catalogo? = null
    private var porAba: Map<Aba, List<Item>> = emptyMap()
    private var gruposDe: Map<Aba, Map<String, List<Item>>> = emptyMap()
    private var porUrl: Map<String, Item> = emptyMap()
    private var porSerie: Map<String, Item> = emptyMap()
    private var aba = Aba.TV
    private var entradas: List<Entrada> = emptyList()
    private var grupoSel = -1
    private val grupoDaAba = HashMap<Aba, String>()
    private var visiveis: List<Item> = emptyList()
    private var atual: Item? = null
    private var sequencia: List<Item> = emptyList()
    private var voltarPara: Item? = null
    private var tentativas = 0
    private var mimeForcado: String? = null
    private var parado = false
    private var primeiraCarga = true
    private var desbloqueado = false
    private var focadoGuia: Item? = null
    private var algumLogo = false

    private val Int.dp get() = (this * resources.displayMetrics.density).toInt()
    private val hhmm = SimpleDateFormat("HH:mm", Locale.US)

    // ---------------------------------------------------------------- ciclo de vida

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        repo = Repositorio(this)
        guia = Guia(repo)
        guia.aoAtualizar = {
            if (aba == Aba.TV) rvItens.adapter?.notifyDataSetChanged()
            if (aba == Aba.AJUSTES) atualizarInfoAjustes()
        }
        montarTela()

        player = ExoPlayer.Builder(this).build()
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().apply {
            setPreferredAudioLanguage(repo.idiomaAudio ?: "pt")
            when (val l = repo.idiomaLegenda) {
                null -> Unit
                "off" -> setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                else -> setPreferredTextLanguage(l)
            }
        }.build()
        video.player = player
        h.postDelayed(vigiar, 2000)
        h.postDelayed(conferirVencimento, 5000)
        FORMATOS[repo.formatoTela.coerceIn(0, FORMATOS.size - 1)].second.let { videoCheio.resizeMode = it; videoPrevia.resizeMode = it }
        player.addListener(ouvinte)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = voltar()
        })

        when {
            !repo.configurado() -> mostrarConfig()
            else -> carregarCatalogo(baixar = false, silencioso = false)
        }
        // 2.6: confere no site se há versão nova (e o endereço atual do servidor)
        rede.execute {
            repo.atualizarServidores()
            runOnUiThread { if (!isFinishing && !isDestroyed) procurarAtualizacao(automatico = true) }
        }
    }

    override fun onResume() {
        super.onResume()
        atualizador.voltou()
    }

    private val atualizador by lazy { Atualizador(this, ::avisar, ::toast) }

    private fun procurarAtualizacao(automatico: Boolean) {
        atualizador.oferecer(repo.versaoPublicada, automatico, repo.atualizacaoAdiadaAte, { repo.atualizacaoAdiadaAte = it }) { v ->
            player.pause()
            avisar("Baixando a atualização ${v.nome}…")
            rede.execute {
                val r = try { Result.success(atualizador.baixar(v)) } catch (e: Exception) { Result.failure(e) }
                runOnUiThread {
                    avisar(null)
                    r.onSuccess { atualizador.instalar(it) }
                        .onFailure { toast("Não foi possível baixar a atualização: ${it.message ?: it.javaClass.simpleName}") }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        if (parado) {
            parado = false
            atual?.let { if (it.tipo == Tipo.AO_VIVO) iniciar(it) else iniciar(it, repo.posicao(it.url)?.first ?: 0, tocar = false) }
        }
    }

    override fun onStop() {
        super.onStop()
        salvarProgresso()
        parado = true
        telemetria.guardar()
        enviarUso()
        h.removeCallbacks(tentarDeNovo)
        player.stop()
    }

    override fun onDestroy() {
        player.release()
        configurador?.parar()
        bg.shutdownNow(); rede.shutdownNow()
        h.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    // ---------------------------------------------------------------- peças da tela

    private fun texto(tam: Float, cor: Int = Color.WHITE) = TextView(this).apply { textSize = tam; setTextColor(cor) }
    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    private fun botao(rotulo: String, acao: () -> Unit) = Button(this).apply {
        text = rotulo
        isAllCaps = false
        textSize = 17f
        setOnClickListener { acao() }
        layoutParams = LinearLayout.LayoutParams(-2, -2).apply { marginEnd = 12.dp }
        Estilo.botao(this)
    }

    private fun pintar(v: View, focado: Boolean, marcado: Boolean) = Estilo.pintar(v, focado, marcado)

    private fun montarTela() {
        raiz = FrameLayout(this).apply { background = Estilo.fundoTela() }
        // 2.11 (o Marco: travava em tela cheia): tela cheia em SurfaceView, prévia em TextureView (cantos redondos)
        fun pv(layout: Int) = (layoutInflater.inflate(layout, raiz, false) as PlayerView).apply {
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShutterBackgroundColor(Color.BLACK)
            isFocusable = false
        }
        videoCheio = pv(R.layout.video_cheio)
        videoPrevia = pv(R.layout.video)
        video = videoCheio
        raiz.addView(videoCheio, FrameLayout.LayoutParams(-1, -1))

        painel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Estilo.fundoTela(238)
            setPadding(36.dp, 18.dp, 36.dp, 18.dp)
            clipChildren = false; clipToPadding = false
        }
        // topo: marca à esquerda, abas em pílulas no meio, relógio à direita
        val barraAbas = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, 10.dp); clipChildren = false; clipToPadding = false
        }
        barraAbas.addView(texto(24f).apply {
            text = android.text.SpannableStringBuilder().apply {
                append("NV", android.text.style.ForegroundColorSpan(Estilo.AZUL_CLARO), 0)
                append("Player")
            }
            typeface = Estilo.NEGRITO; letterSpacing = -0.02f
            setPadding(4.dp, 0, 28.dp, 0)
        })
        val pilulas = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = Estilo.cartao(this@MainActivity, Color.argb(18, 255, 255, 255), 26f)
            setPadding(5.dp, 5.dp, 5.dp, 5.dp); clipChildren = false; clipToPadding = false
        }
        Aba.entries.forEach { a ->
            val t = texto(16f).apply {
                text = a.rotulo
                typeface = Estilo.MEDIO
                setPadding(20.dp, 7.dp, 20.dp, 7.dp)
                isFocusable = true; isClickable = true
                setOnClickListener { trocarAba(a, focar = true) }
                setOnFocusChangeListener { v, f -> Estilo.pintar(v, f, a == aba, 22f) }
            }
            abas[a] = t
            pilulas.addView(t)
        }
        barraAbas.addView(pilulas)
        barraAbas.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        relogio = texto(20f, Estilo.TEXTO_2).apply { typeface = Estilo.LEVE }
        barraAbas.addView(relogio)
        painel.addView(barraAbas)

        val corpo = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        rvGrupos = RecyclerView(this).apply {
            clipChildren = false; clipToPadding = false; setPadding(4.dp, 4.dp, 8.dp, 4.dp)
            layoutManager = LinearLayoutManager(this@MainActivity)
            adapter = AdGrupos()
            itemAnimator = null
        }
        corpo.addView(rvGrupos, LinearLayout.LayoutParams(0, -1, 0.3f))

        coluna = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(20.dp, 0, 0, 0) }
        titulo = texto(14f, Estilo.TEXTO_2).apply { setPadding(8.dp, 0, 0, 4.dp); typeface = Estilo.MEDIO; isAllCaps = false }
        coluna.addView(titulo)
        busca = EditText(this).apply {
            hint = "Buscar…"
            setHintTextColor(Estilo.TEXTO_3); setTextColor(Color.WHITE); textSize = 15f
            Estilo.campo(this)
            setPadding(14.dp, 7.dp, 14.dp, 7.dp)
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            inputType = InputType.TYPE_CLASS_TEXT
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: Editable?) { h.removeCallbacks(filtrar); h.postDelayed(filtrar, 300) }
            })
        }
        coluna.addView(busca, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = 6.dp; marginStart = 4.dp; marginEnd = 8.dp })
        rvItens = RecyclerView(this).apply {
            clipChildren = false; clipToPadding = false; setPadding(4.dp, 4.dp, 8.dp, 4.dp)
            layoutManager = LinearLayoutManager(this@MainActivity)
            adapter = AdItens()
            itemAnimator = null
        }
        coluna.addView(rvItens, LinearLayout.LayoutParams(-1, 0, 1f))
        guiaBox = texto(15f, Estilo.TEXTO).apply {
            background = Estilo.cartao(this@MainActivity, Color.argb(16, 255, 255, 255), 18f)
            setPadding(22.dp, 18.dp, 22.dp, 18.dp)
            setLineSpacing(4.dp.toFloat(), 1f)
            maxLines = 6; ellipsize = TextUtils.TruncateAt.END
        }
        lado = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(20.dp, 0, 0, 0); visibility = View.GONE }
        previa = object : FrameLayout(this) {
            // caixa 16:9 (a largura manda)
            override fun onMeasure(w: Int, hh: Int) {
                val l = MeasureSpec.getSize(w)
                super.onMeasure(w, MeasureSpec.makeMeasureSpec(l * 9 / 16, MeasureSpec.EXACTLY))
            }
        }.apply { setBackgroundColor(Color.BLACK); Estilo.arredondar(this, 18f) }
        previaTexto = texto(16f, Estilo.TEXTO_2).apply {
            gravity = Gravity.CENTER
            text = "Escolha um canal: OK mostra aqui, OK de novo abre em tela cheia."
            setPadding(16.dp, 0, 16.dp, 0)
        }
        previa.addView(videoPrevia, FrameLayout.LayoutParams(-1, -1))
        previa.addView(previaTexto, FrameLayout.LayoutParams(-1, -1))
        lado.addView(previa, LinearLayout.LayoutParams(-1, -2))
        guiaBox.textSize = 17f
        guiaBox.maxLines = 12
        lado.addView(guiaBox, LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = 10.dp })
        infoAjustes = texto(17f, Estilo.TEXTO).apply {
            background = Estilo.cartao(this@MainActivity, Color.argb(16, 255, 255, 255), 18f)
            setPadding(24.dp, 18.dp, 24.dp, 18.dp); setLineSpacing(4.dp.toFloat(), 1f); visibility = View.GONE
        }
        coluna.addView(infoAjustes, LinearLayout.LayoutParams(-1, 0, 1f))
        corpo.addView(coluna, LinearLayout.LayoutParams(0, -1, 0.7f))
        corpo.addView(lado, LinearLayout.LayoutParams(0, -1, 0.42f))
        painel.addView(corpo, LinearLayout.LayoutParams(-1, 0, 1f))
        painel.visibility = View.GONE
        raiz.addView(painel, FrameLayout.LayoutParams(-1, -1))

        barra = texto(18f).apply {
            background = Estilo.cartao(this@MainActivity, Color.argb(214, 14, 18, 28), 22f)
            setPadding(30.dp, 20.dp, 30.dp, 20.dp)
            setLineSpacing(3.dp.toFloat(), 1f)
            visibility = View.GONE
            elevation = 8.dp.toFloat()
        }
        raiz.addView(barra, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM).apply { setMargins(48.dp, 0, 48.dp, 36.dp) })

        aviso = texto(19f).apply {
            gravity = Gravity.CENTER
            typeface = Estilo.MEDIO
            background = Estilo.cartao(this@MainActivity, Color.argb(225, 16, 20, 30), 20f)
            setPadding(30.dp, 18.dp, 30.dp, 18.dp)
            visibility = View.GONE
            elevation = 10.dp.toFloat()
        }
        raiz.addView(aviso, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))

        // 2.8: "Atualizando a lista…" no canto enquanto a lista é baixada sem travar a tela
        status = texto(15f, Estilo.TEXTO).apply {
            typeface = Estilo.MEDIO
            background = Estilo.cartao(this@MainActivity, Color.argb(215, 16, 20, 30), 18f)
            setPadding(18.dp, 9.dp, 18.dp, 9.dp)
            visibility = View.GONE
            elevation = 10.dp.toFloat()
        }
        raiz.addView(status, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.END).apply { setMargins(0, 24.dp, 36.dp, 0) })

        lembrete = texto(14f, Estilo.TEXTO).apply {
            background = Estilo.cartao(this@MainActivity, Color.argb(170, 16, 20, 30), 14f)
            setPadding(14.dp, 7.dp, 14.dp, 7.dp)
            visibility = View.GONE
            elevation = 6.dp.toFloat()
        }
        raiz.addView(lembrete, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.START).apply { setMargins(28.dp, 0, 0, 24.dp) })
        atualizarRelogio.run()
        setContentView(raiz)
    }

    private val atualizarRelogio = object : Runnable {
        override fun run() {
            relogio.text = SimpleDateFormat("EEE, d 'de' MMM   HH:mm", Locale.forLanguageTag("pt-BR")).format(Date())
            h.postDelayed(this, 20_000)
        }
    }

    /** 2.10: a cada minuto confere se é hora do aviso de vencimento (a cada 2 h, fica 10 min). */
    private val conferirVencimento = object : Runnable {
        override fun run() {
            h.postDelayed(this, 60_000)
            val agora = System.currentTimeMillis()
            val t = Vencimento.texto(catalogo?.conta?.validade, agora)
            if (t == null) { lembrete.visibility = View.GONE; return }
            if (agora >= proximoLembrete) {
                proximoLembrete = agora + Vencimento.INTERVALO
                lembrete.text = t
                lembrete.visibility = View.VISIBLE
                lembrete.bringToFront()
                h.removeCallbacks(esconderLembrete)
                h.postDelayed(esconderLembrete, Vencimento.DURACAO)
            }
        }
    }
    private val esconderLembrete = Runnable { lembrete.visibility = View.GONE }

    /** 2.10: a cada 2 s confere se o canal ao vivo travou; se travou, reconecta sozinho. */
    private val vigiar = object : Runnable {
        override fun run() {
            h.postDelayed(this, 2000)
            val agora = System.currentTimeMillis()
            val c = atual
            if (c != null && !parado && player.isPlaying) uso(c).let { (n, g) -> telemetria.tocando(c.tipo, n, g, 2) }
            if (!parado && catalogo != null && telemetria.hora(forcar = false)) enviarUso()
            if (c == null || c.tipo != Tipo.AO_VIVO || parado || player.playerError != null) { vigia.reiniciar(agora); return }
            val q = player.videoDecoderCounters?.let {
                it.ensureUpdated()
                (it.renderedOutputBufferCount + it.droppedBufferCount + it.skippedOutputBufferCount).toLong()
            } ?: -1L
            val pronto = player.playbackState == Player.STATE_READY
            if (vigia.conferir(agora, player.playWhenReady, pronto, player.currentPosition, q)) {
                anotar("${c.nome}: ${if (pronto) "a imagem parou" else "ficou carregando"}; reconectado sozinho")
                mostrarStatus("⟳  O sinal parou · reconectando…")
                h.postDelayed({ if (status.text.startsWith("⟳  O sinal")) mostrarStatus(null) }, 5000)
                iniciar(c)
            }
        }
    }

    /** Nome e grupo para o resumo de uso: episódio conta pela série. */
    private fun uso(c: Item): Pair<String, String> {
        val serie = c.pai?.let { porSerie[it] }
        return if (serie != null) serie.nome to serie.grupo else c.nome to c.grupo
    }

    /** 2.12: manda o resumo de uso (fora da tela; falhou = vai no próximo). */
    private fun enviarUso() {
        val info = infoUso()
        rede.execute { telemetria.enviar(info) }
    }

    private fun infoUso(): JSONObject {
        val x = repo.xtream
        val k = catalogo?.conta
        val l = JSONObject().put("tipo", if (x != null) "xtream" else "m3u")
            .put("servidor", x?.endereco ?: repo.urlLista?.substringBefore("?")?.substringAfter("://")?.substringBefore("/") ?: "")
            .put("usuario", if (x != null) repo.usuario else "")
            .put("canais", porAba[Aba.TV]?.size ?: 0).put("filmes", porAba[Aba.FILMES]?.size ?: 0).put("series", porAba[Aba.SERIES]?.size ?: 0)
        k?.status?.let { l.put("status", it) }
        k?.validade?.let { l.put("validade", it) }
        k?.conexoes?.let { l.put("telas", it) }
        k?.ativas?.let { l.put("telas_uso", it) }
        val o = JSONObject().put("versao", versao()).put("codigo", codigoVersao()).put("lista", l)
            .put("problemas", JSONArray(eventos().take(12)))
        val c = atual
        if (c != null && !parado && player.playWhenReady) {
            val (n, g) = uso(c)
            o.put("assistindo", JSONObject().put("nome", n).put("grupo", g).put("desde", inicioAtual)
                .put("tipo", when (c.tipo) { Tipo.AO_VIVO -> "vivo"; Tipo.FILME -> "filme"; Tipo.SERIE -> "serie" }))
        }
        return o
    }

    private var inicioAtual = 0L

    private fun codigoVersao(): Long = try {
        val i = packageManager.getPackageInfo(packageName, 0)
        if (Build.VERSION.SDK_INT >= 28) i.longVersionCode else @Suppress("DEPRECATION") i.versionCode.toLong()
    } catch (_: Exception) { 0 }

    /** 2.10: registro dos problemas do vídeo (últimos 30), mostrado em Ajustes. */
    private fun anotar(msg: String) {
        val p = getSharedPreferences("diario", MODE_PRIVATE)
        val linha = SimpleDateFormat("dd/MM HH:mm", Locale.US).format(Date()) + "  " + msg.replace('\n', ' ')
        val l = (listOf(linha) + p.getString("eventos", "").orEmpty().split('\n').filter { it.isNotBlank() }).take(30)
        p.edit().putString("eventos", l.joinToString("\n")).apply()
    }

    private fun eventos(): List<String> =
        getSharedPreferences("diario", MODE_PRIVATE).getString("eventos", "").orEmpty().split('\n').filter { it.isNotBlank() }

    /** Recado discreto no canto (null = some). */
    private fun mostrarStatus(msg: String?) {
        status.text = msg.orEmpty()
        status.visibility = if (msg == null) View.GONE else View.VISIBLE
        status.bringToFront()
    }

    private fun avisar(msg: String?) {
        aviso.text = msg.orEmpty()
        aviso.visibility = if (msg == null) View.GONE else View.VISIBLE
        aviso.bringToFront()
    }

    /** Recado do player: na prévia aparece dentro da caixa do vídeo; em tela cheia, no meio da tela. */
    private fun avisarVideo(msg: String?) {
        if (video.parent === previa) {
            avisar(null)
            previaTexto.text = msg.orEmpty()
            previaTexto.visibility = if (msg == null) View.GONE else View.VISIBLE
            previaTexto.bringToFront()
        } else avisar(msg)
    }

    private fun tempo(ms: Long): String {
        if (ms == C.TIME_UNSET || ms < 0) return "--:--"
        val s = ms / 1000
        return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
    }

    // ---------------------------------------------------------------- carregar

    private fun carregarCatalogo(baixar: Boolean, silencioso: Boolean) {
        if (!silencioso) avisar(if (baixar) "Baixando a lista…" else "Abrindo a lista…")
        else mostrarStatus("⟳  Atualizando a lista… pode continuar assistindo")
        bg.execute {
            // 2.8: a atualização em segundo plano roda com prioridade baixa, para não disputar com o vídeo
            android.os.Process.setThreadPriority(if (silencioso) android.os.Process.THREAD_PRIORITY_BACKGROUND else android.os.Process.THREAD_PRIORITY_DEFAULT)
            try {
                val c = repo.carregar(baixar) { p ->
                    runOnUiThread { if (!silencioso) avisar(p) else mostrarStatus("⟳  Atualizando a lista · ${p.trimEnd('…')}…") }
                }
                runOnUiThread {
                    if (!silencioso) avisar(null)
                    if (silencioso) {
                        mostrarStatus("✓  Lista atualizada")
                        h.postDelayed({ if (status.text.startsWith("✓")) mostrarStatus(null) }, 3500)
                        // assistindo em tela cheia: troca a lista só quando a pessoa abrir a lista (sem engasgar o vídeo)
                        if (assistindo()) { catalogoPendente = c; return@runOnUiThread }
                    }
                    aplicar(c)
                    if (!baixar && repo.copiaVelha()) carregarCatalogo(baixar = true, silencioso = true)
                }
            } catch (e: Exception) {
                runOnUiThread {
                    if (silencioso) {
                        mostrarStatus("Não deu para atualizar a lista agora; seguimos com a cópia do aparelho")
                        h.postDelayed({ if (!status.text.startsWith("⟳")) mostrarStatus(null) }, 6000)
                        return@runOnUiThread
                    }
                    avisar(null)
                    val msg = "Não foi possível carregar a lista: ${e.message ?: e.javaClass.simpleName}"
                    when {
                        catalogo != null -> toast(msg)
                        !baixar -> carregarCatalogo(baixar = true, silencioso = false)
                        else -> mostrarConfig(msg)
                    }
                }
            }
        }
    }

    private fun abaDe(i: Item) = when (i.tipo) { Tipo.AO_VIVO -> Aba.TV; Tipo.FILME -> Aba.FILMES; Tipo.SERIE -> Aba.SERIES }

    private fun aplicar(c: Catalogo) {
        catalogo = c
        val m = c.itens.groupBy { abaDe(it) }
        porAba = Aba.entries.associateWith { m[it].orEmpty() }
        gruposDe = porAba.mapValues { (_, l) -> l.groupByTo(LinkedHashMap()) { it.grupo } }
        porUrl = c.itens.filter { it.url.isNotBlank() }.associateBy { it.url }
        porSerie = c.itens.filter { it.tipo == Tipo.SERIE && it.url.isBlank() && it.id != null }.associateBy { it.id!! }
        guia.preparar(c)
        abas.forEach { (a, t) ->
            val n = porAba[a]?.size ?: 0
            t.text = if (a == Aba.AJUSTES) a.rotulo else "${a.rotulo}  ${"%,d".format(Locale.forLanguageTag("pt-BR"), n)}"
        }
        atual = atual?.let { a -> porUrl[a.url] ?: a }
        if (primeiraCarga) {
            primeiraCarga = false
            val ultimo = repo.ultimoCanal?.let { u -> porUrl[u] }?.takeIf { it.tipo == Tipo.AO_VIVO && !travado(it) }
            if (ultimo != null) {
                grupoDaAba[Aba.TV] = ultimo.grupo
                trocarAba(Aba.TV, focar = false)
                tocar(ultimo, gruposDe[Aba.TV]?.get(ultimo.grupo).orEmpty())
                return
            }
            trocarAba(Aba.TV, focar = false)
            mostrarPainel()
        } else {
            trocarAba(aba, focar = false)
        }
    }

    // ---------------------------------------------------------------- abas, grupos e itens

    private fun adulto(i: Item) = i.adulto || RX_ADULTO.containsMatchIn(i.grupo)
    private fun travado(i: Item) = repo.pin != null && !desbloqueado && adulto(i)
    private fun semTravados(l: List<Item>) = if (repo.pin == null || desbloqueado) l else l.filter { !adulto(it) }

    private fun trocarAba(a: Aba, focar: Boolean) {
        aba = a
        abas.forEach { (k, v) -> pintar(v, v.hasFocus(), k == a) }
        montarEntradas()
        val ajustes = a == Aba.AJUSTES
        busca.visibility = if (ajustes) View.GONE else View.VISIBLE
        rvItens.visibility = if (ajustes) View.GONE else View.VISIBLE
        infoAjustes.visibility = if (ajustes) View.VISIBLE else View.GONE
        guiaBox.visibility = if (a == Aba.TV) View.VISIBLE else View.GONE
        guiaBox.text = "Escolha um canal para ver a programação."
        val tv3 = a == Aba.TV
        lado.visibility = if (tv3) View.VISIBLE else View.GONE
        rvGrupos.layoutParams = (rvGrupos.layoutParams as LinearLayout.LayoutParams).apply { weight = if (tv3) 0.22f else 0.26f }
        coluna.layoutParams = (coluna.layoutParams as LinearLayout.LayoutParams).apply { weight = if (tv3) 0.38f else 0.74f }
        posicionarVideo()
        busca.hint = when (a) { Aba.TV -> "Buscar canal…"; Aba.FILMES -> "Buscar filme…"; else -> "Buscar série…" }
        algumLogo = porAba[a].orEmpty().any { it.logo != null }
        if (busca.text.isNotEmpty()) busca.setText("")
        if (ajustes) {
            grupoSel = -1
            titulo.text = "Ajustes"
            atualizarInfoAjustes()
            if (focar) rvGrupos.post { rvGrupos.findViewHolderForAdapterPosition(0)?.itemView?.requestFocus() }
            return
        }
        val nomeGrupo = grupoDaAba[a]
        var i = nomeGrupo?.let { g -> entradas.indexOfFirst { it.tipo == TE.GRUPO && it.grupo == g } } ?: -1
        if (i < 0) i = entradas.indexOfFirst { e -> e.tipo != TE.GRUPO && itensDe(e).isNotEmpty() }
        if (i < 0) i = entradas.indexOfFirst { it.tipo == TE.TODOS }
        selecionarGrupo(i, focar)
    }

    private fun montarEntradas() {
        entradas = if (aba == Aba.AJUSTES) buildList {
            add(Entrada("↻  Atualizar lista agora", TE.ACAO, acao = "atualizar"))
            add(Entrada("⚙  Trocar lista / login", TE.ACAO, acao = "trocar"))
            add(Entrada("🔒  Controle dos pais: ${if (repo.pin == null) "desligado" else "ligado"}", TE.ACAO, acao = "pin"))
            if (repo.xtream != null) add(Entrada("📺  Canais ao vivo em: ${if (repo.formatoAoVivo == "m3u8") "HLS" else "TS"}", TE.ACAO, acao = "formato"))
            add(Entrada("🗑  Limpar \"Continuar assistindo\"", TE.ACAO, acao = "limpar"))
            val nova = repo.versaoPublicada?.takeIf { it.codigo > atualizador.versaoAtual() }
            add(Entrada(if (nova != null) "⬆  Atualizar o app para a versão ${nova.nome}" else "⬆  Procurar atualização do app", TE.ACAO, acao = "versao"))
            add(Entrada("✕  Sair do app", TE.ACAO, acao = "sair"))
        } else buildList {
            add(Entrada("★  Favoritos", TE.FAVORITOS))
            if (aba != Aba.TV) add(Entrada("▶  Continuar assistindo", TE.CONTINUAR))
            add(Entrada("Todos  (${porAba[aba]?.size ?: 0})", TE.TODOS))
            gruposDe[aba]?.forEach { (g, l) ->
                val b = repo.pin != null && !desbloqueado && (RX_ADULTO.containsMatchIn(g) || l.any { it.adulto })
                add(Entrada((if (b) "🔒 " else "") + "$g  (${l.size})", TE.GRUPO, g, bloqueado = b))
            }
        }
        rvGrupos.adapter?.notifyDataSetChanged()
    }

    private fun itensDe(e: Entrada): List<Item> {
        val lista = porAba[aba].orEmpty()
        return when (e.tipo) {
            TE.FAVORITOS -> repo.favoritos.let { f -> semTravados(lista.filter { repo.chave(it) in f }) }
            TE.CONTINUAR -> semTravados(
                if (aba == Aba.SERIES) repo.seriesRecentes().mapNotNull { porSerie[it] }
                else repo.recentes().mapNotNull { porUrl[it] }.filter { abaDe(it) == aba }
            )
            TE.TODOS -> semTravados(lista)
            TE.GRUPO -> if (e.bloqueado) emptyList() else gruposDe[aba]?.get(e.grupo).orEmpty()
            TE.ACAO -> emptyList()
        }
    }

    private fun selecionarGrupo(i: Int, focar: Boolean) {
        val e = entradas.getOrNull(i) ?: return
        if (e.tipo == TE.ACAO) return
        val antes = grupoSel
        grupoSel = i
        e.grupo?.let { grupoDaAba[aba] = it } ?: grupoDaAba.remove(aba)
        if (busca.text.isNotEmpty()) busca.setText("")
        visiveis = itensDe(e)
        titulo.text = when {
            e.bloqueado -> "Grupo protegido: aperte OK no grupo e digite a senha do controle dos pais."
            e.tipo == TE.FAVORITOS && visiveis.isEmpty() -> "Favoritos: nenhum ainda. Segure OK (ou aperte Menu) num item para marcar."
            e.tipo == TE.CONTINUAR && visiveis.isEmpty() -> "Nada começado ainda."
            else -> "${e.rotulo.substringBeforeLast("  (").removePrefix("🔒 ")} · ${visiveis.size}"
        }
        rvItens.adapter?.notifyDataSetChanged()
        rvItens.scrollToPosition(0)
        if (antes >= 0) rvGrupos.adapter?.notifyItemChanged(antes)
        rvGrupos.adapter?.notifyItemChanged(i)
        if (focar) focarItem(0)
    }

    private val filtrar = Runnable {
        if (aba == Aba.AJUSTES) return@Runnable
        val q = semAcento(busca.text.toString().trim())
        if (q.isEmpty()) {
            entradas.getOrNull(grupoSel)?.let { visiveis = itensDe(it); titulo.text = "${it.rotulo.substringBeforeLast("  (")} · ${visiveis.size}" }
        } else {
            val partes = q.split(Regex("\\s+"))
            visiveis = semTravados(porAba[aba].orEmpty()).filter { c -> partes.all { c.chave.contains(it) } }
            titulo.text = "Busca: ${visiveis.size} resultado(s)"
        }
        rvItens.adapter?.notifyDataSetChanged()
        rvItens.scrollToPosition(0)
    }

    private fun focarItem(i: Int) {
        if (visiveis.isEmpty()) return
        val p = i.coerceIn(0, visiveis.size - 1)
        (rvItens.layoutManager as LinearLayoutManager).scrollToPositionWithOffset(p, 120.dp)
        rvItens.post { rvItens.findViewHolderForAdapterPosition(p)?.itemView?.requestFocus() }
    }

    /** Com a lista de canais aberta, o vídeo vai para a prévia; senão, ocupa a tela toda (atrás do resto). */
    private fun posicionarVideo() {
        val naPrevia = painel.visibility == View.VISIBLE && aba == Aba.TV && telaConfig == null && ficha == null
        val destino: FrameLayout = if (naPrevia) previa else raiz
        val alvo = if (destino === previa) videoPrevia else videoCheio
        if (video !== alvo && ::player.isInitialized) {
            PlayerView.switchTargetView(player, video, alvo)
            video = alvo
        }
        videoCheio.visibility = if (alvo === videoCheio) View.VISIBLE else View.GONE
        painel.background = Estilo.fundoTela(if (naPrevia) 255 else 238)
        if (atual?.tipo != Tipo.AO_VIVO) previaTexto.text = "Escolha um canal: OK mostra aqui, OK de novo abre em tela cheia."
        previaTexto.visibility = if (atual?.tipo == Tipo.AO_VIVO) View.GONE else View.VISIBLE
        if (naPrevia && atual?.tipo != Tipo.AO_VIVO && ehVod()) player.pause()
    }

    private fun mostrarPainel(foco: Item? = atual) {
        catalogoPendente?.let { catalogoPendente = null; aplicar(it) }
        painel.visibility = View.VISIBLE
        barra.visibility = View.GONE
        posicionarVideo()
        val i = foco?.let { visiveis.indexOf(it) } ?: -1
        when {
            i >= 0 -> focarItem(i)
            aba != Aba.AJUSTES && visiveis.isNotEmpty() -> focarItem(0)
            else -> rvGrupos.post { rvGrupos.findViewHolderForAdapterPosition(grupoSel.coerceAtLeast(0))?.itemView?.requestFocus() }
        }
    }

    private fun esconderPainel() {
        painel.visibility = View.GONE
        posicionarVideo()
        currentFocus?.clearFocus()
        raiz.requestFocus()
        if (ehVod() && telaConfig == null && ficha == null) player.play()
    }

    private fun alternarFavorito(c: Item) {
        val marcado = repo.alternarFavorito(c)
        Toast.makeText(this, if (marcado) "★ ${c.nome} nos favoritos" else "${c.nome} saiu dos favoritos", Toast.LENGTH_SHORT).show()
        if (painel.visibility != View.VISIBLE) return
        if (entradas.getOrNull(grupoSel)?.tipo == TE.FAVORITOS && busca.text.isEmpty()) {
            val p = visiveis.indexOf(c)
            selecionarGrupo(grupoSel, focar = false)
            focarItem(p)
        } else visiveis.indexOf(c).takeIf { it >= 0 }?.let { rvItens.adapter?.notifyItemChanged(it) }
    }

    private fun abrirItem(i: Item) {
        if (travado(i)) { desbloquear { abrirItem(i) }; return }
        when {
            i.tipo == Tipo.AO_VIVO -> {
                val seq = visiveis.filter { it.tipo == Tipo.AO_VIVO }.ifEmpty { listOf(i) }
                val naLista = painel.visibility == View.VISIBLE && aba == Aba.TV
                when {
                    // 2º OK no canal que já está na prévia = tela cheia
                    naLista && i == atual -> { sequencia = seq; esconderPainel(); mostrarBarra() }
                    naLista -> tocar(i, seq, telaCheia = false)
                    else -> tocar(i, seq)
                }
            }
            i.tipo == Tipo.SERIE && i.url.isBlank() -> abrirFichaSerie(i)
            else -> abrirFichaFilme(i)
        }
    }

    // ---------------------------------------------------------------- guia de programação

    private fun textoGuia(l: List<Programa>): String {
        if (l.isEmpty()) return "Sem guia de programação para este canal."
        val n = System.currentTimeMillis()
        val sb = StringBuilder()
        l.take(4).forEachIndexed { k, p ->
            if (n >= p.inicio && n < p.fim) sb.append("Agora   ")
            sb.append(hhmm.format(Date(p.inicio))).append("–").append(hhmm.format(Date(p.fim))).append("   ").append(p.titulo)
            if (k == 0 && p.descricao.isNotBlank()) sb.append("\n      ").append(p.descricao.replace('\n', ' ').take(160))
            sb.append('\n')
        }
        return sb.toString().trimEnd()
    }

    /** Programação do canal para o quadro ao lado da prévia: nome grande, horários em azul, o de agora destacado. */
    private fun guiaRica(i: Item, l: List<Programa>): CharSequence {
        val sb = android.text.SpannableStringBuilder()
        fun span(t: String, vararg sp: Any) { val a = sb.length; sb.append(t); sp.forEach { sb.setSpan(it, a, sb.length, 0) } }
        span(i.nome, android.text.style.StyleSpan(Typeface.BOLD), android.text.style.RelativeSizeSpan(1.35f))
        if (i.grupo.isNotBlank()) { sb.append("\n"); span(i.grupo, android.text.style.ForegroundColorSpan(Estilo.TEXTO_3), android.text.style.RelativeSizeSpan(0.85f)) }
        sb.append("\n\n")
        if (l.isEmpty()) { span("Sem guia de programação para este canal.", android.text.style.ForegroundColorSpan(Estilo.TEXTO_2)); return sb }
        val n = System.currentTimeMillis()
        l.take(5).forEachIndexed { k, p ->
            val agora = n >= p.inicio && n < p.fim
            span(hhmm.format(Date(p.inicio)) + " – " + hhmm.format(Date(p.fim)) + "   ",
                android.text.style.ForegroundColorSpan(if (agora) Estilo.AZUL_CLARO else Estilo.TEXTO_2))
            if (agora) span(" AGORA ", android.text.style.BackgroundColorSpan(Estilo.VERMELHO), android.text.style.ForegroundColorSpan(Color.WHITE),
                android.text.style.StyleSpan(Typeface.BOLD), android.text.style.RelativeSizeSpan(0.7f))
            if (agora) sb.append("  ")
            span(p.titulo, android.text.style.StyleSpan(if (agora) Typeface.BOLD else Typeface.NORMAL))
            if (k == 0 && p.descricao.isNotBlank()) {
                sb.append("\n")
                span(p.descricao.replace('\n', ' ').take(180), android.text.style.ForegroundColorSpan(Estilo.TEXTO_2), android.text.style.RelativeSizeSpan(0.88f))
            }
            sb.append("\n\n")
        }
        return sb.trimEnd() as CharSequence
    }

    private val atualizarGuia = Runnable {
        val i = focadoGuia ?: return@Runnable
        guiaBox.text = "${i.nome}: carregando a programação…"
        guia.programas(i) { l ->
            if (focadoGuia != i) return@programas
            guiaBox.text = guiaRica(i, l)
            visiveis.indexOf(i).takeIf { it >= 0 }?.let { rvItens.adapter?.notifyItemChanged(it) }
        }
    }

    // ---------------------------------------------------------------- fichas (filme e série)

    private class FichaV(val tela: View, val capa: ImageView, val nome: TextView, val meta: TextView,
                         val sinopse: TextView, val botoes: LinearLayout, val extra: LinearLayout)

    private fun novaFicha(item: Item): FichaV {
        fecharFicha(mostrar = false)
        painel.visibility = View.GONE
        if (ehVod()) player.pause()
        val tela = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = Estilo.fundoTela()
            setPadding(56.dp, 44.dp, 56.dp, 28.dp)
            isClickable = true
            clipChildren = false; clipToPadding = false
        }
        val capa = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = Estilo.cartao(this@MainActivity, Color.argb(22, 255, 255, 255), 18f)
            Estilo.arredondar(this, 18f); elevation = 12.dp.toFloat()
        }
        tela.addView(capa, LinearLayout.LayoutParams(210.dp, 315.dp))
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40.dp, 0, 0, 0); clipChildren = false; clipToPadding = false }
        val nome = texto(32f).apply { typeface = Estilo.NEGRITO; letterSpacing = -0.01f; text = item.nome }
        val meta = texto(15f, Estilo.TEXTO_2).apply {
            setPadding(0, 6.dp, 0, 10.dp)
            text = listOfNotNull(item.ano, item.nota?.let { "★ $it" }, item.grupo).joinToString("   ·   ")
        }
        val sinopse = texto(17f, Color.rgb(0xD5, 0xDA, 0xE2)).apply { maxLines = 6; ellipsize = TextUtils.TruncateAt.END; setLineSpacing(4.dp.toFloat(), 1f) }
        val botoes = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, 22.dp, 0, 14.dp); clipChildren = false; clipToPadding = false }
        val extra = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        col.addView(nome); col.addView(meta); col.addView(sinopse); col.addView(botoes)
        col.addView(extra, LinearLayout.LayoutParams(-1, 0, 1f))
        tela.addView(col, LinearLayout.LayoutParams(0, -1, 1f))
        raiz.addView(tela, FrameLayout.LayoutParams(-1, -1))
        aviso.bringToFront()
        ficha = tela
        Logos.mostrar(capa, item.logo, 380)
        return FichaV(tela, capa, nome, meta, sinopse, botoes, extra)
    }

    private fun fecharFicha(mostrar: Boolean) {
        ficha?.let { raiz.removeView(it) }
        ficha = null
        if (mostrar) mostrarPainel(voltarPara ?: atual)
    }

    private fun botaoFavorito(i: Item): Button {
        fun rot() = if (repo.chave(i) in repo.favoritos) "★ Nos favoritos" else "☆ Favoritar"
        return botao(rot()) {}.apply { setOnClickListener { alternarFavorito(i); text = rot() } }
    }

    private fun abrirFichaFilme(item: Item) {
        val f = novaFicha(item)
        f.sinopse.text = if (repo.xtream != null && item.tipo == Tipo.FILME) "Carregando…" else ""
        val p = repo.posicao(item.url)
        val primeiro: Button = if (p != null && p.first > 60_000 && p.first < p.second * 95 / 100) {
            val b = botao("▶  Continuar de ${tempo(p.first)}") { tocarVod(item, listOf(item), p.first, item) }
            f.botoes.addView(b)
            f.botoes.addView(botao("Do início") { tocarVod(item, listOf(item), 0, item) })
            b
        } else botao(if (p != null && p.second > 0 && p.first >= p.second * 95 / 100) "▶  Assistir de novo" else "▶  Assistir") {
            tocarVod(item, listOf(item), 0, item)
        }.also { f.botoes.addView(it) }
        f.botoes.addView(botaoFavorito(item))
        primeiro.post { primeiro.requestFocus() }
        val x = repo.xtream
        val id = item.id
        if (x == null || id == null || item.tipo != Tipo.FILME) return
        rede.execute {
            val d = try { x.filme(id) } catch (_: Exception) { null }
            runOnUiThread {
                if (ficha !== f.tela) return@runOnUiThread
                if (d == null) { f.sinopse.text = ""; return@runOnUiThread }
                f.meta.text = listOfNotNull(d.ano ?: item.ano, d.duracao, d.genero, (d.nota ?: item.nota)?.let { "★ $it" })
                    .joinToString("   ·   ")
                f.sinopse.text = listOfNotNull(d.sinopse, d.diretor?.let { "Direção: $it" }, d.elenco?.let { "Elenco: $it" })
                    .joinToString("\n\n")
                if (item.logo == null && d.capa != null) Logos.mostrar(f.capa, d.capa, 380)
            }
        }
    }

    private fun epItem(serie: Item, e: Episodio, capa: String?) = Item(
        tipo = Tipo.SERIE, nome = "${serie.nome} — T${e.temporada} E${e.numero}  ${e.titulo}", url = e.url,
        grupo = serie.grupo, logo = e.imagem ?: capa ?: serie.logo, id = e.id, adulto = serie.adulto,
        pai = serie.id, temporada = e.temporada, num = e.numero,
    )

    private fun abrirFichaSerie(item: Item) {
        val f = novaFicha(item)
        f.botoes.addView(botaoFavorito(item).also { b -> b.post { b.requestFocus() } })
        f.sinopse.text = "Carregando as temporadas…"
        val x = repo.xtream ?: return
        val id = item.id ?: return
        rede.execute {
            val s = try { x.serie(id) } catch (e: Exception) { e }
            runOnUiThread {
                if (ficha !== f.tela) return@runOnUiThread
                if (s is FichaSerie) montarTemporadas(f, item, s)
                else f.sinopse.text = "Não foi possível carregar a série: ${(s as Exception).message}"
            }
        }
    }

    private fun montarTemporadas(f: FichaV, serie: Item, s: FichaSerie) {
        f.meta.text = listOfNotNull(s.ano ?: serie.ano, s.genero, (s.nota ?: serie.nota)?.let { "★ $it" },
            "${s.episodios.size} temporada(s)").joinToString("   ·   ")
        f.sinopse.text = listOfNotNull(s.sinopse, s.elenco?.let { "Elenco: $it" }).joinToString("\n\n")
        if (serie.logo == null && s.capa != null) Logos.mostrar(f.capa, s.capa, 380)
        if (s.episodios.isEmpty()) { f.sinopse.append("\n\nNenhum episódio encontrado no servidor."); return }
        val ult = repo.serieUltimo(serie.id!!)
        var temp = ult?.first?.takeIf { it in s.episodios } ?: s.episodios.keys.first()
        val itensDaTemp = { t: Int -> s.episodios[t].orEmpty().map { epItem(serie, it, s.capa) } }
        if (ult != null) {
            val eps = itensDaTemp(ult.first)
            eps.firstOrNull { it.id == ult.second }?.let { e ->
                val p = repo.posicao(e.url)
                val rot = if (p != null && p.first > 60_000 && p.first < p.second * 95 / 100)
                    "▶  Continuar T${e.temporada} E${e.num} (${tempo(p.first)})" else "▶  Continuar T${e.temporada} E${e.num}"
                val b = botao(rot) { tocarVod(e, eps, p?.first?.takeIf { it < (p.second * 95 / 100) } ?: 0, serie) }
                f.botoes.addView(b, 0)
                b.post { b.requestFocus() }
            }
        }
        val linha = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val rolar = HorizontalScrollView(this).apply { addView(linha); isHorizontalScrollBarEnabled = false }
        val lista = RecyclerView(this).apply { layoutManager = LinearLayoutManager(this@MainActivity); itemAnimator = null }
        val ad = AdEpisodios(serie)
        lista.adapter = ad
        val botoesT = HashMap<Int, TextView>()
        fun escolher(t: Int) {
            temp = t
            ad.lista = itensDaTemp(t)
            ad.notifyDataSetChanged()
            botoesT.forEach { (k, v) -> pintar(v, v.hasFocus(), k == t) }
        }
        s.episodios.keys.forEach { t ->
            val b = texto(17f).apply {
                text = if (t == 0) "Extras" else "Temporada $t"
                setPadding(16.dp, 8.dp, 16.dp, 8.dp)
                isFocusable = true; isClickable = true
                setOnFocusChangeListener { v, foc -> pintar(v, foc, t == temp); if (foc && t != temp) escolher(t) }
                setOnClickListener { lista.post { lista.findViewHolderForAdapterPosition(0)?.itemView?.requestFocus() } }
            }
            botoesT[t] = b
            linha.addView(b)
        }
        f.extra.addView(rolar)
        f.extra.addView(lista, LinearLayout.LayoutParams(-1, 0, 1f))
        escolher(temp)
        if (f.botoes.childCount == 1) botoesT[temp]?.post { botoesT[temp]?.requestFocus() }
    }

    // ---------------------------------------------------------------- reprodução

    private fun ehVod() = atual?.let { it.tipo != Tipo.AO_VIVO } == true

    private fun salvarProgresso() {
        val c = atual ?: return
        if (c.tipo == Tipo.AO_VIVO) return
        val d = player.duration
        if (d == C.TIME_UNSET || d <= 0) return
        repo.salvarPosicao(c.url, player.currentPosition, d)
    }

    private val salvarPeriodico = object : Runnable {
        override fun run() {
            if (ehVod() && player.isPlaying) salvarProgresso()
            h.postDelayed(this, 15_000)
        }
    }

    private fun tocar(c: Item, seq: List<Item>, telaCheia: Boolean = true) {
        salvarProgresso()
        val anterior = atual
        atual = c
        sequencia = seq.ifEmpty { listOf(c) }
        voltarPara = null
        repo.ultimoCanal = c.url
        if (anterior != c) { uso(c).let { (n, g) -> telemetria.abriu(c.tipo, n, g) }; inicioAtual = System.currentTimeMillis() }
        tentativas = 0
        mimeForcado = null
        iniciar(c)
        if (telaCheia) {
            fecharFicha(mostrar = false)
            esconderPainel()
            mostrarBarra()
        } else {
            posicionarVideo()
            focadoGuia = c
            h.removeCallbacks(atualizarGuia); h.post(atualizarGuia)
        }
        anterior?.let { a -> visiveis.indexOf(a).takeIf { it >= 0 }?.let { rvItens.adapter?.notifyItemChanged(it) } }
        visiveis.indexOf(c).takeIf { it >= 0 }?.let { rvItens.adapter?.notifyItemChanged(it) }
    }

    private fun tocarVod(c: Item, seq: List<Item>, inicio: Long, de: Item?) {
        salvarProgresso()
        atual = c
        sequencia = seq.ifEmpty { listOf(c) }
        voltarPara = de
        uso(c).let { (n, g) -> telemetria.abriu(c.tipo, n, g) }; inicioAtual = System.currentTimeMillis()
        tentativas = 0
        mimeForcado = null
        if (c.pai != null && c.id != null) repo.marcarSerie(c.pai, c.temporada, c.id)
        iniciar(c, inicio)
        fecharFicha(mostrar = false)
        esconderPainel()
        mostrarBarra()
        h.removeCallbacks(salvarPeriodico)
        h.postDelayed(salvarPeriodico, 15_000)
    }

    private fun mimeDe(url: String): String? {
        val u = url.substringBefore('?').lowercase()
        return when {
            u.endsWith(".m3u8") || u.endsWith(".m3u") || url.contains("m3u8", true) -> MimeTypes.APPLICATION_M3U8
            u.endsWith(".mpd") -> MimeTypes.APPLICATION_MPD
            else -> null
        }
    }

    private fun iniciar(c: Item, inicio: Long = 0, tocar: Boolean = true) {
        h.removeCallbacks(tentarDeNovo)
        val http = OkHttpDataSource.Factory(Rede.cliente.newBuilder().readTimeout(20, TimeUnit.SECONDS).build())
            .setUserAgent(c.userAgent ?: Http.USER_AGENT)
        c.referer?.let { http.setDefaultRequestProperties(mapOf("Referer" to it)) }
        val item = MediaItem.Builder().setUri(c.url).apply { (mimeForcado ?: mimeDe(c.url))?.let { setMimeType(it) } }.build()
        val fonte = DefaultMediaSourceFactory(DefaultDataSource.Factory(this, http)).createMediaSource(item)
        // 2.13: canal ao vivo sempre começa na borda ao vivo (C.TIME_UNSET), nunca no começo da janela DVR,
        // para a reconexão voltar no horário atual da transmissão e não alguns minutos atrás.
        player.setMediaSource(fonte, if (c.tipo == Tipo.AO_VIVO) C.TIME_UNSET else inicio)
        player.prepare()
        player.playWhenReady = tocar
    }

    private val tentarDeNovo = Runnable {
        atual?.let { iniciar(it, if (it.tipo == Tipo.AO_VIVO) C.TIME_UNSET else player.currentPosition.coerceAtLeast(0)) }
    }

    private val ouvinte = object : Player.Listener {
        override fun onPlaybackStateChanged(estado: Int) {
            when (estado) {
                Player.STATE_BUFFERING -> avisarVideo("Carregando…")
                Player.STATE_READY -> { avisarVideo(null); tentativas = 0 }
                Player.STATE_ENDED -> { avisarVideo(null); terminou() }
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
            if (tentativas == 0) anotar("${c.nome}: ${motivo(e)}")
            if (tentativas < 3) {
                tentativas++
                avisarVideo("Sem sinal em \"${c.nome}\"… tentando de novo ($tentativas/3)")
                h.postDelayed(tentarDeNovo, 3000)
            } else {
                avisarVideo("Não foi possível abrir \"${c.nome}\".\n${motivo(e)}\nAperte Voltar para escolher outro.")
            }
        }
    }

    private fun terminou() {
        val c = atual ?: return
        if (c.tipo == Tipo.AO_VIVO) { iniciar(c); return }  // canal ao vivo que o servidor fechou: reconecta
        val d = player.duration
        if (d != C.TIME_UNSET && d > 0) repo.salvarPosicao(c.url, d, d)
        val prox = sequencia.indexOf(c).takeIf { it >= 0 }?.let { sequencia.getOrNull(it + 1) }
        if (c.pai != null && prox != null) {
            Toast.makeText(this, "Próximo episódio: ${prox.nome}", Toast.LENGTH_SHORT).show()
            tocarVod(prox, sequencia, 0, voltarPara)
            return
        }
        player.stop()
        val de = voltarPara
        atual = null
        if (de != null) abrirItem(de) else mostrarPainel()
    }

    private fun motivo(e: PlaybackException) = when (e.errorCode) {
        PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> "O servidor recusou (assinatura vencida, limite de telas ou conteúdo fora do ar)."
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ->
            "Sem conexão com o servidor. Se nada abrir, o endereço do provedor pode ter mudado: Ajustes → Trocar lista / login."
        PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES -> "Este aparelho não consegue tocar o formato deste conteúdo."
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED -> "Formato de transmissão não suportado."
        else -> e.errorCodeName
    }

    private fun zapear(passo: Int) {
        val c = atual ?: return
        if (sequencia.size < 2) return
        val i = sequencia.indexOf(c).let { if (it < 0) 0 else it }
        tocar(sequencia[(i + passo).mod(sequencia.size)], sequencia)
    }

    private val esconderBarra = Runnable { barra.visibility = View.GONE }

    private fun mostrarBarra() {
        val c = atual ?: return
        fun desenhar(progs: List<Programa>?) {
            val sb = android.text.SpannableStringBuilder()
            fun span(t: String, vararg sp: Any) { val a = sb.length; sb.append(t); sp.forEach { sb.setSpan(it, a, sb.length, 0) } }
            if (c.tipo == Tipo.AO_VIVO) {
                val pos = sequencia.indexOf(c)
                val num = if (c.num > 0) c.num.toString() else if (pos >= 0) (pos + 1).toString() else null
                num?.let { span("$it   ", android.text.style.ForegroundColorSpan(Estilo.TEXTO_3), android.text.style.StyleSpan(Typeface.BOLD)) }
                span(c.nome, android.text.style.StyleSpan(Typeface.BOLD), android.text.style.RelativeSizeSpan(1.3f))
                span("      " + c.grupo, android.text.style.ForegroundColorSpan(Estilo.TEXTO_2), android.text.style.RelativeSizeSpan(0.85f))
                val n = System.currentTimeMillis()
                progs?.take(2)?.forEach { p ->
                    val agora = n >= p.inicio && n < p.fim
                    sb.append('\n')
                    span(hhmm.format(Date(p.inicio)) + " – " + hhmm.format(Date(p.fim)) + "   ",
                        android.text.style.ForegroundColorSpan(if (agora) Estilo.AZUL_CLARO else Estilo.TEXTO_2))
                    span(p.titulo, android.text.style.ForegroundColorSpan(if (agora) Estilo.TEXTO else Estilo.TEXTO_2))
                }
            } else {
                span(c.nome, android.text.style.StyleSpan(Typeface.BOLD), android.text.style.RelativeSizeSpan(1.3f))
                sb.append('\n')
                span(tempo(player.currentPosition) + " / " + tempo(player.duration), android.text.style.ForegroundColorSpan(Estilo.AZUL_CLARO))
                if (!player.playWhenReady) span("     ❚❚ pausado", android.text.style.StyleSpan(Typeface.BOLD))
                span("        ◀ volta 10 s   ▶ avança 30 s   Menu: áudio e legenda", android.text.style.ForegroundColorSpan(Estilo.TEXTO_3))
            }
            barra.text = sb
        }
        desenhar(null)
        barra.visibility = View.VISIBLE
        barra.bringToFront(); aviso.bringToFront()
        h.removeCallbacks(esconderBarra)
        h.postDelayed(esconderBarra, 5000)
        if (c.tipo == Tipo.AO_VIVO) guia.programas(c) { l -> if (atual == c && barra.visibility == View.VISIBLE) desenhar(l) }
    }

    // ---------------------------------------------------------------- opções (áudio, legenda, tela)

    private fun dialogo(tituloD: String, itens: List<Pair<String, () -> Unit>>) {
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle(tituloD)
            .setItems(itens.map { it.first }.toTypedArray()) { d, i -> d.dismiss(); itens[i].second() }
            .show()
    }

    private fun descrever(f: Format, n: Int): String {
        val idioma = f.language?.takeIf { it != "und" && it.isNotBlank() }?.let {
            Locale.forLanguageTag(it).getDisplayLanguage(Locale.forLanguageTag("pt-BR")).replaceFirstChar { c -> c.uppercase() }
        }
        val canais = when (f.channelCount) { 1 -> "mono"; 2 -> "estéreo"; 6 -> "5.1"; 8 -> "7.1"; else -> null }
        return listOfNotNull(idioma ?: f.label ?: "Faixa $n", f.label?.takeIf { idioma != null && !it.equals(idioma, true) }, canais)
            .joinToString(" · ")
    }

    private fun faixaAtual(tipo: Int): String? {
        player.currentTracks.groups.filter { it.type == tipo }.forEach { g ->
            for (i in 0 until g.length) if (g.isTrackSelected(i)) return descrever(g.getTrackFormat(i), i + 1)
        }
        return null
    }

    private fun escolherFaixa(tipo: Int) {
        val ops = mutableListOf<Pair<String, () -> Unit>>()
        if (tipo == C.TRACK_TYPE_TEXT) ops += "Desligada" to {
            player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                .clearOverridesOfType(C.TRACK_TYPE_TEXT).setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
            repo.idiomaLegenda = "off"
        }
        var n = 0
        player.currentTracks.groups.filter { it.type == tipo }.forEach { g ->
            for (i in 0 until g.length) if (g.isTrackSupported(i)) {
                val f = g.getTrackFormat(i)
                n++
                ops += (descrever(f, n) + if (g.isTrackSelected(i)) "   ✓" else "") to {
                    player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                        .setTrackTypeDisabled(tipo, false)
                        .setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, i))
                        .apply {
                            if (tipo == C.TRACK_TYPE_AUDIO) setPreferredAudioLanguage(f.language) else setPreferredTextLanguage(f.language)
                        }.build()
                    if (tipo == C.TRACK_TYPE_AUDIO) repo.idiomaAudio = f.language else repo.idiomaLegenda = f.language ?: "und"
                }
            }
        }
        if (n == 0) {
            toast(if (tipo == C.TRACK_TYPE_AUDIO) "Este conteúdo tem um áudio só." else "Este conteúdo não tem legenda.")
            return
        }
        dialogo(if (tipo == C.TRACK_TYPE_AUDIO) "Áudio" else "Legenda", ops)
    }

    private fun opcoes() {
        val c = atual ?: return
        val ops = mutableListOf<Pair<String, () -> Unit>>()
        ops += "Áudio: ${faixaAtual(C.TRACK_TYPE_AUDIO) ?: "padrão"}" to { escolherFaixa(C.TRACK_TYPE_AUDIO) }
        ops += "Legenda: ${faixaAtual(C.TRACK_TYPE_TEXT) ?: "desligada"}" to { escolherFaixa(C.TRACK_TYPE_TEXT) }
        ops += "Tela: ${FORMATOS[repo.formatoTela.coerceIn(0, FORMATOS.size - 1)].first}" to {
            repo.formatoTela = (repo.formatoTela + 1) % FORMATOS.size
            videoCheio.resizeMode = FORMATOS[repo.formatoTela].second; videoPrevia.resizeMode = videoCheio.resizeMode
            toast("Tela: ${FORMATOS[repo.formatoTela].first}")
        }
        if (c.tipo == Tipo.AO_VIVO) {
            ops += "Guia deste canal" to {
                guia.programas(c) { l ->
                    AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                        .setTitle(c.nome).setMessage(textoGuia(l).ifBlank { "Sem guia." }).setPositiveButton("OK", null).show()
                }
            }
            ops += "Lista de canais" to { mostrarPainel() }
        } else {
            ops += "Voltar ao começo" to { player.seekTo(0) }
        }
        ops += (if (repo.chave(c) in repo.favoritos) "Tirar dos favoritos" else "★ Favoritar") to { alternarFavorito(c) }
        dialogo(c.nome, ops)
    }

    // ---------------------------------------------------------------- controle dos pais

    private fun pedirSenha(tituloD: String, depois: (String) -> Unit) {
        val campo = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            filters = arrayOf(InputFilter.LengthFilter(8))
            hint = "Senha (números)"
        }
        val caixa = FrameLayout(this).apply { setPadding(24.dp, 8.dp, 24.dp, 0); addView(campo) }
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle(tituloD).setView(caixa)
            .setPositiveButton("OK") { _, _ -> depois(campo.text.toString()) }
            .setNegativeButton("Cancelar", null)
            .show()
        campo.requestFocus()
    }

    private fun desbloquear(depois: () -> Unit) {
        val pin = repo.pin ?: return depois()
        pedirSenha("Senha do controle dos pais") {
            if (it == pin) {
                desbloqueado = true
                val g = grupoSel
                montarEntradas()
                selecionarGrupo(g, focar = false)
                depois()
            } else toast("Senha errada.")
        }
    }

    private fun acaoPin() {
        val pin = repo.pin
        if (pin == null) {
            pedirSenha("Crie a senha do controle dos pais (4 a 8 números)") { s ->
                if (s.length < 4) { toast("A senha precisa ter pelo menos 4 números."); return@pedirSenha }
                pedirSenha("Repita a senha") { s2 ->
                    if (s2 != s) { toast("As senhas não conferem."); return@pedirSenha }
                    repo.pin = s; desbloqueado = false
                    toast("Controle dos pais ligado: os grupos adultos pedem a senha.")
                    trocarAba(Aba.AJUSTES, focar = true)
                }
            }
        } else pedirSenha("Senha atual do controle dos pais") { s ->
            if (s != pin) { toast("Senha errada."); return@pedirSenha }
            dialogo("Controle dos pais", listOf(
                "Trocar a senha" to { repo.pin = null; acaoPin() },
                "Desligar" to { repo.pin = null; desbloqueado = false; toast("Controle dos pais desligado."); trocarAba(Aba.AJUSTES, focar = true) },
            ))
        }
    }

    // ---------------------------------------------------------------- ajustes

    private fun atualizarInfoAjustes() {
        val c = catalogo
        val br = Locale.forLanguageTag("pt-BR")
        val data = SimpleDateFormat("dd/MM/yyyy HH:mm", br)
        val sb = StringBuilder()
        val x = repo.xtream
        if (x != null) {
            sb.append("Lista: login e senha (Xtream)\nServidor: ${x.endereco}   ·   Usuário: ${repo.usuario}\n")
            c?.conta?.let { k ->
                val partes = listOfNotNull(
                    k.status?.let { if (it.equals("Active", true)) "Assinatura ativa" else "Situação: $it" },
                    k.validade?.let { "vence em ${SimpleDateFormat("dd/MM/yyyy", br).format(Date(it))}" },
                    k.conexoes?.let { "telas: ${k.ativas ?: "?"} em uso de $it" },
                )
                if (partes.isNotEmpty()) sb.append(partes.joinToString("   ·   ")).append('\n')
            }
        } else if (repo.configurado()) {
            sb.append("Lista: link M3U\n${repo.urlLista?.substringBefore("?")?.take(60)}\n")
        }
        if (c != null) {
            sb.append("\n%,d canais   ·   %,d filmes   ·   %,d séries\n".format(br,
                porAba[Aba.TV]?.size ?: 0, porAba[Aba.FILMES]?.size ?: 0, porAba[Aba.SERIES]?.size ?: 0))
            sb.append("Atualizada em ${data.format(Date(c.atualizadoEm))} (atualiza sozinha a cada 24 h)\n")
        }
        sb.append("Guia de programação: ${guia.situacao}\n")
        sb.append("Controle dos pais: ${when (repo.pin) {
            null -> "desligado"
            Repositorio.PIN_PADRAO -> "ligado com a senha padrão ${Repositorio.PIN_PADRAO} (troque em Controle dos pais)"
            else -> "ligado (grupos adultos pedem senha)"
        }}\n")
        sb.append("\nNo controle, assistindo TV: ▲▼ troca de canal · OK ou ◀▶ abre a lista · Menu: áudio, legenda, tela e guia.\n")
        sb.append("Assistindo filme ou série: OK pausa · ◀ volta 10 s · ▶ avança 30 s · Menu: áudio, legenda e tela · Voltar: sai e guarda onde parou.\n")
        sb.append("Na lista: segure OK (ou aperte Menu) num item para marcar como favorito.\n")
        val ev = eventos()
        sb.append("\nProblemas no vídeo (os mais recentes primeiro): ")
        if (ev.isEmpty()) sb.append("nenhum registrado\n")
        else { sb.append("${ev.size}\n"); ev.take(12).forEach { sb.append("   ").append(it).append('\n') } }
        sb.append("\nNVPlayer ${versao()}")
        infoAjustes.text = sb
    }

    private fun versao(): String = try { packageManager.getPackageInfo(packageName, 0).versionName ?: "" } catch (_: Exception) { "" }

    private fun acao(e: Entrada, pos: Int) {
        when (e.acao) {
            "atualizar" -> { repo.limparCacheGuia(); carregarCatalogo(baixar = true, silencioso = false) }
            "trocar" -> mostrarConfig()
            "pin" -> acaoPin()
            "formato" -> {
                repo.formatoAoVivo = if (repo.formatoAoVivo == "m3u8") "ts" else "m3u8"
                toast("Canais ao vivo em ${if (repo.formatoAoVivo == "m3u8") "HLS" else "TS"}. Se um canal travar, experimente o outro formato.")
                carregarCatalogo(baixar = false, silencioso = false)
            }
            "limpar" -> { repo.limparContinuar(); toast("\"Continuar assistindo\" limpo.") }
            "versao" -> {
                avisar("Procurando atualização…")
                rede.execute {
                    repo.atualizarServidores()
                    runOnUiThread { avisar(null); procurarAtualizacao(automatico = false); montarEntradas() }
                }
            }
            "sair" -> finish()
            else -> if (e.bloqueado) desbloquear { focarItem(0) } else selecionarGrupo(pos, focar = true)
        }
    }

    // ---------------------------------------------------------------- teclas

    /** Assistindo (sem lista, ficha nem configuração na tela): as teclas do controle mandam no player. */
    private fun assistindo() = telaConfig == null && ficha == null && painel.visibility != View.VISIBLE && atual != null

    override fun onKeyUp(keyCode: Int, ev: KeyEvent): Boolean =
        if (assistindo() && keyCode in TECLAS_PLAYER) true else super.onKeyUp(keyCode, ev)

    override fun onKeyDown(keyCode: Int, ev: KeyEvent): Boolean {
        if (!assistindo()) return super.onKeyDown(keyCode, ev)
        val vod = ehVod()
        when (keyCode) {
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_DOWN -> if (vod) mostrarBarra() else zapear(-1)
            KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_UP -> if (vod) mostrarBarra() else zapear(+1)
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND ->
                if (vod) { player.seekTo((player.currentPosition - 10_000).coerceAtLeast(0)); mostrarBarra() } else mostrarPainel()
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD ->
                if (vod) { player.seekTo(player.currentPosition + 30_000); mostrarBarra() } else mostrarPainel()
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER ->
                if (vod) { player.playWhenReady = !player.playWhenReady; salvarProgresso(); mostrarBarra() } else mostrarPainel()
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> {
                player.playWhenReady = !player.playWhenReady; mostrarBarra()
            }
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS, KeyEvent.KEYCODE_CAPTIONS -> opcoes()
            KeyEvent.KEYCODE_GUIDE -> mostrarPainel()
            KeyEvent.KEYCODE_INFO -> mostrarBarra()
            else -> return super.onKeyDown(keyCode, ev)
        }
        return true
    }

    private fun voltar() {
        when {
            telaConfig != null -> if (catalogo != null) fecharConfig() else finish()
            ficha != null -> { fecharFicha(mostrar = true) }
            painel.visibility == View.VISIBLE && busca.text.isNotEmpty() -> busca.setText("")
            painel.visibility == View.VISIBLE && atual != null -> esconderPainel()
            painel.visibility == View.VISIBLE -> finish()
            ehVod() -> {
                salvarProgresso()
                player.pause()
                val de = voltarPara
                if (de != null) abrirItem(de) else mostrarPainel()
            }
            else -> mostrarPainel()
        }
    }

    // ---------------------------------------------------------------- configuração da lista

    @SuppressLint("SetTextI18n")
    private fun mostrarConfig(erro: String? = null) {
        if (telaConfig != null) fecharConfig(mostrar = false)
        fecharFicha(mostrar = false)
        painel.visibility = View.GONE
        player.pause()
        val conf = Configurador(repo.servidorPadrao) { campos -> validar(campos)?.let { return@Configurador it }; runOnUiThread { receber(campos) }; null }
        conf.iniciar()
        configurador = conf
        val ip = Configurador.ipLocal()
        val endereco = ip?.let { "http://$it:${conf.porta}" }

        val tela = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = Estilo.fundoTela()
            setPadding(64.dp, 28.dp, 64.dp, 28.dp)
            isClickable = true
            clipChildren = false; clipToPadding = false
        }
        val esq = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; clipChildren = false; clipToPadding = false }
        esq.addView(texto(15f, Estilo.AZUL_CLARO).apply { text = "NVPlayer"; typeface = Estilo.MEDIO })
        esq.addView(texto(30f).apply { text = "Configurar a lista IPTV"; typeface = Estilo.NEGRITO; letterSpacing = -0.01f })
        erro?.let { esq.addView(texto(16f, Color.rgb(255, 120, 110)).apply { text = it; setPadding(0, 10.dp, 0, 0) }) }
        esq.addView(texto(17f, Estilo.TEXTO_2).apply {
            setPadding(0, 12.dp, 0, 16.dp)
            text = if (endereco != null)
                "Pelo celular (mais fácil): na mesma rede Wi-Fi da TV, leia o QR code ou abra  $endereco  e preencha lá.\nOu preencha aqui com o controle:"
            else "Preencha com o controle:"
        })
        var xtream = repo.tipoFonte != "m3u"
        val modos = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        fun campo(dica: String, valor: String?, senha: Boolean = false) = EditText(this).apply {
            hint = dica
            setHintTextColor(Estilo.TEXTO_3); setTextColor(Color.WHITE); textSize = 16f
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or (if (senha) InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_TEXT_VARIATION_URI)
            setText(valor.orEmpty())
            Estilo.campo(this)
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = 10.dp }
        }
        val fServ = campo("Servidor com a porta — ex.: http://servidor.com:8080", repo.servidor ?: repo.servidorPadrao)
        if (repo.servidor == null) {
            // primeira vez: busca no site o endereço atual e troca o preenchido, se ninguém mexeu no campo
            val antes = fServ.text.toString()
            rede.execute {
                val novo = repo.atualizarServidores().firstOrNull()
                if (novo != null) runOnUiThread { if (fServ.text.toString() == antes && novo != antes) fServ.setText(novo) }
            }
        }
        val fUser = campo("Usuário", repo.usuario)
        val fSenha = campo("Senha", repo.senha, senha = true)
        val fLink = campo("Link M3U — http://…", repo.urlLista ?: "http://")
        val fEpg = campo("Guia XMLTV (opcional) — http://…xml ou .xml.gz", repo.epgUrl)
        val boxX = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; addView(fServ); addView(fUser); addView(fSenha) }
        val boxM = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; addView(fLink); addView(fEpg) }
        val bX = botao("Login e senha") {}
        val bM = botao("Link M3U") {}
        fun mostrarModo() {
            boxX.visibility = if (xtream) View.VISIBLE else View.GONE
            boxM.visibility = if (xtream) View.GONE else View.VISIBLE
            bX.alpha = if (xtream) 1f else 0.55f; bM.alpha = if (xtream) 0.55f else 1f
        }
        bX.setOnClickListener { xtream = true; mostrarModo() }
        bM.setOnClickListener { xtream = false; mostrarModo() }
        modos.addView(bX); modos.addView(bM)
        esq.addView(modos)
        esq.addView(boxX, LinearLayout.LayoutParams(-1, -2))
        esq.addView(boxM, LinearLayout.LayoutParams(-1, -2))
        val botoes = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, 10.dp, 0, 0) }
        val salvar = botao("Salvar e carregar") {
            val campos = if (xtream) mapOf("tipo" to "xtream", "servidor" to fServ.text.toString().trim(),
                "usuario" to fUser.text.toString().trim(), "senha" to fSenha.text.toString().trim())
            else mapOf("tipo" to "m3u", "lista" to fLink.text.toString().trim(), "epg" to fEpg.text.toString().trim())
            val e = validar(campos)
            if (e != null) toast(e) else receber(campos)
        }
        botoes.addView(salvar)
        if (catalogo != null) botoes.addView(botao("Cancelar") { fecharConfig() })
        esq.addView(botoes)
        mostrarModo()
        tela.addView(esq, LinearLayout.LayoutParams(0, -2, 1f))
        if (endereco != null) {
            tela.addView(ImageView(this).apply {
                setImageBitmap(Configurador.qr(endereco, 420))
                setPadding(32.dp, 0, 0, 0)
            }, LinearLayout.LayoutParams(250.dp, 250.dp))
        }
        raiz.addView(tela, FrameLayout.LayoutParams(-1, -1))
        aviso.bringToFront()
        telaConfig = tela
        avisar(null)
        (if (xtream) bX else bM).post { (if (xtream) bX else bM).requestFocus() }
    }

    /** Confere os campos do formulário (TV ou celular). null = certo. */
    private fun validar(c: Map<String, String>): String? {
        val http = { s: String? -> s != null && (s.startsWith("http://") || s.startsWith("https://")) && s.length > 10 }
        return when (c["tipo"]) {
            "xtream" -> when {
                c["servidor"].isNullOrBlank() -> "Informe o servidor (com a porta)."
                c["usuario"].isNullOrBlank() || c["senha"].isNullOrBlank() -> "Informe o usuário e a senha."
                else -> try { Xtream.normalizar(c["servidor"]!!); null } catch (_: Exception) { "Servidor inválido." }
            }
            "m3u" -> when {
                !http(c["lista"]) -> "O link tem de começar com http:// ou https://."
                !c["epg"].isNullOrBlank() && !http(c["epg"]) -> "O endereço do guia tem de começar com http:// ou https://."
                else -> null
            }
            else -> "Formulário inválido."
        }
    }

    private fun receber(c: Map<String, String>) {
        if (c["tipo"] == "xtream") repo.salvarXtream(c["servidor"]!!, c["usuario"]!!, c["senha"]!!)
        else {
            val link = c["lista"]!!
            val x = Xtream.deLink(link)
            if (x != null) {
                repo.salvarXtream(x.first, x.second, x.third)
                toast("O link tem usuário e senha: entrando com login (separa TV, filmes e séries).")
            } else repo.salvarM3u(link, c["epg"])
        }
        salvarProgresso()
        player.stop()
        atual = null
        catalogo = null
        primeiraCarga = true
        desbloqueado = false
        grupoDaAba.clear()
        fecharConfig(mostrar = false)
        carregarCatalogo(baixar = true, silencioso = false)
    }

    private fun fecharConfig(mostrar: Boolean = true) {
        configurador?.parar(); configurador = null
        telaConfig?.let { raiz.removeView(it) }
        telaConfig = null
        if (mostrar && catalogo != null) mostrarPainel()
    }

    // ---------------------------------------------------------------- listas (RecyclerView)

    private class VH(v: View) : RecyclerView.ViewHolder(v)

    private inner class AdGrupos : RecyclerView.Adapter<VH>() {
        override fun getItemCount() = entradas.size
        override fun onCreateViewHolder(p: ViewGroup, t: Int): VH = VH(texto(15f).apply {
            setPadding(16.dp, 6.dp, 16.dp, 6.dp)
            typeface = Estilo.MEDIO
            isFocusable = true; isClickable = true
            isSingleLine = true; ellipsize = TextUtils.TruncateAt.END
            layoutParams = RecyclerView.LayoutParams(-1, -2).apply { bottomMargin = 2.dp }
        })

        override fun onBindViewHolder(vh: VH, pos: Int) {
            val tv = vh.itemView as TextView
            val e = entradas[pos]
            tv.text = e.rotulo
            tv.setTextColor(if (e.tipo == TE.ACAO || e.bloqueado) Estilo.TEXTO_2 else Estilo.TEXTO)
            pintar(tv, tv.hasFocus(), pos == grupoSel)
            tv.setOnFocusChangeListener { v, f ->
                val p = vh.bindingAdapterPosition
                pintar(v, f, p == grupoSel)
                if (f && p >= 0 && p != grupoSel && entradas[p].tipo != TE.ACAO) {
                    h.removeCallbacksAndMessages(TROCA_GRUPO)
                    HandlerCompat.postDelayed(h, { if (v.hasFocus()) selecionarGrupo(p, focar = false) }, TROCA_GRUPO, 220)
                }
            }
            tv.setOnClickListener { vh.bindingAdapterPosition.takeIf { it >= 0 }?.let { acao(entradas[it], it) } }
        }
    }

    private inner class AdItens : RecyclerView.Adapter<VH>() {
        override fun getItemCount() = visiveis.size
        override fun getItemViewType(position: Int) = if (aba == Aba.TV) 0 else 1

        override fun onCreateViewHolder(p: ViewGroup, t: Int): VH {
            val linha = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                if (t == 0) setPadding(8.dp, 3.dp, 12.dp, 3.dp) else setPadding(12.dp, 4.dp, 16.dp, 4.dp)
                isFocusable = true; isClickable = true; isLongClickable = true
                layoutParams = RecyclerView.LayoutParams(-1, -2).apply { bottomMargin = 2.dp }
            }
            linha.addView(texto(12f, Estilo.TEXTO_3).apply { gravity = Gravity.END; typeface = Estilo.MEDIO; setPadding(0, 0, 10.dp, 0); isSingleLine = true },
                LinearLayout.LayoutParams(if (t == 0) 50.dp else 0, -2))
            // logo numa "plaquinha" arredondada
            linha.addView(ImageView(this@MainActivity).apply {
                scaleType = ImageView.ScaleType.FIT_CENTER
                background = Estilo.cartao(this@MainActivity, Color.argb(26, 255, 255, 255), 10f)
                if (t == 0) setPadding(4.dp, 2.dp, 4.dp, 2.dp)
                Estilo.arredondar(this, 8f)
            }, if (t == 0) LinearLayout.LayoutParams(44.dp, 26.dp) else LinearLayout.LayoutParams(36.dp, 52.dp))
            val col = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL; setPadding(12.dp, 0, 6.dp, 0) }
            col.addView(texto(15f).apply { typeface = Estilo.MEDIO; isSingleLine = true; ellipsize = TextUtils.TruncateAt.END })
            col.addView(texto(12f, Estilo.TEXTO_2).apply { isSingleLine = true; ellipsize = TextUtils.TruncateAt.END })
            col.addView(Barrinha(this@MainActivity), LinearLayout.LayoutParams(-1, 3.dp).apply { topMargin = 2.dp; marginEnd = 40.dp })
            linha.addView(col, LinearLayout.LayoutParams(0, -2, 1f))
            linha.addView(texto(18f, Color.rgb(0xFF, 0xCC, 0x4D)))
            return VH(linha)
        }

        override fun onBindViewHolder(vh: VH, pos: Int) {
            val linha = vh.itemView as LinearLayout
            val c = visiveis[pos]
            val tv = aba == Aba.TV
            (linha.getChildAt(0) as TextView).apply {
                // o canal que está passando ganha o ▶ no lugar do número
                text = if (!tv) "" else if (c == atual) "▶" else (if (c.num > 0) c.num else pos + 1).toString()
                setTextColor(if (c == atual) Estilo.AZUL_CLARO else Color.argb(150, 255, 255, 255))
            }
            (linha.getChildAt(1) as ImageView).let { img ->
                img.visibility = if (algumLogo) View.VISIBLE else View.GONE
                Logos.mostrar(img, c.logo, if (tv) 128 else 110)
            }
            val col = linha.getChildAt(2) as LinearLayout
            (col.getChildAt(0) as TextView).apply {
                text = c.nome
                setTextColor(Estilo.TEXTO)
            }
            val sub = when (c.tipo) {
                Tipo.AO_VIVO -> guia.agora(c)?.let { "Agora: ${it.titulo}" }
                else -> {
                    val p = if (c.url.isNotBlank()) repo.posicao(c.url) else null
                    val prog = p?.let { (a, d) -> if (d > 0 && a >= d * 95 / 100) "✓ assistido" else if (a > 60_000) "◐ parou em ${tempo(a)}" else null }
                    listOfNotNull(c.ano, c.nota?.let { "★ $it" }, prog).joinToString("   ·   ").ifBlank { null }
                }
            }
            val emBusca = busca.text.isNotEmpty() || entradas.getOrNull(grupoSel)?.tipo in setOf(TE.FAVORITOS, TE.CONTINUAR, TE.TODOS)
            (col.getChildAt(1) as TextView).apply {
                text = listOfNotNull(sub, if (emBusca) c.grupo else null).joinToString("   ·   ")
                visibility = if (text.isEmpty()) View.GONE else View.VISIBLE
            }
            (col.getChildAt(2) as Barrinha).apply {
                val ag = if (c.tipo == Tipo.AO_VIVO) guia.agora(c) else null
                val n = System.currentTimeMillis()
                visibility = if (ag != null && ag.fim > ag.inicio) View.VISIBLE else View.GONE
                if (ag != null && ag.fim > ag.inicio) fracao = (n - ag.inicio).toFloat() / (ag.fim - ag.inicio)
            }
            (linha.getChildAt(3) as TextView).text = if (repo.chave(c) in repo.favoritos) "★" else ""
            pintar(linha, linha.hasFocus(), false)
            linha.setOnFocusChangeListener { v, f ->
                pintar(v, f, false)
                if (f && aba == Aba.TV) {
                    vh.bindingAdapterPosition.takeIf { it >= 0 }?.let { focadoGuia = visiveis[it] }
                    h.removeCallbacks(atualizarGuia); h.postDelayed(atualizarGuia, 300)
                }
            }
            linha.setOnClickListener { vh.bindingAdapterPosition.takeIf { it >= 0 }?.let { abrirItem(visiveis[it]) } }
            linha.setOnLongClickListener { vh.bindingAdapterPosition.takeIf { it >= 0 }?.let { alternarFavorito(visiveis[it]) }; true }
            linha.setOnKeyListener { _, k, ev ->
                if (k == KeyEvent.KEYCODE_MENU && ev.action == KeyEvent.ACTION_UP) {
                    vh.bindingAdapterPosition.takeIf { it >= 0 }?.let { alternarFavorito(visiveis[it]) }; true
                } else k == KeyEvent.KEYCODE_MENU
            }
        }
    }

    private inner class AdEpisodios(val serie: Item) : RecyclerView.Adapter<VH>() {
        var lista: List<Item> = emptyList()
        override fun getItemCount() = lista.size
        override fun onCreateViewHolder(p: ViewGroup, t: Int): VH = VH(texto(17f).apply {
            setPadding(14.dp, 9.dp, 14.dp, 9.dp)
            isFocusable = true; isClickable = true
            isSingleLine = true; ellipsize = TextUtils.TruncateAt.END
            layoutParams = RecyclerView.LayoutParams(-1, -2)
        })

        override fun onBindViewHolder(vh: VH, pos: Int) {
            val tv = vh.itemView as TextView
            val e = lista[pos]
            val p = repo.posicao(e.url)
            val marca = p?.let { (a, d) -> if (d > 0 && a >= d * 95 / 100) "   ✓" else if (a > 60_000) "   ◐ ${tempo(a)}" else "" } ?: ""
            tv.text = "E%02d   %s%s".format(e.num, e.nome.substringAfter("  ", e.nome), marca)
            pintar(tv, tv.hasFocus(), false)
            tv.setOnFocusChangeListener { v, f -> pintar(v, f, false) }
            tv.setOnClickListener {
                val i = vh.bindingAdapterPosition.takeIf { it >= 0 } ?: return@setOnClickListener
                val ep = lista[i]
                val q = repo.posicao(ep.url)
                val inicio = q?.let { (a, d) -> if (a > 60_000 && d > 0 && a < d * 95 / 100) a else 0 } ?: 0
                tocarVod(ep, lista, inicio, serie)
            }
        }
    }

    private companion object {
        val TROCA_GRUPO = Any()
        val FORMATOS = listOf(
            "Ajustar" to AspectRatioFrameLayout.RESIZE_MODE_FIT,
            "Esticar" to AspectRatioFrameLayout.RESIZE_MODE_FILL,
            "Preencher (corta as bordas)" to AspectRatioFrameLayout.RESIZE_MODE_ZOOM,
        )
        val TECLAS_PLAYER = setOf(
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT,
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_CHANNEL_UP,
            KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_MEDIA_REWIND, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE,
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS, KeyEvent.KEYCODE_CAPTIONS, KeyEvent.KEYCODE_GUIDE, KeyEvent.KEYCODE_INFO)
    }
}
