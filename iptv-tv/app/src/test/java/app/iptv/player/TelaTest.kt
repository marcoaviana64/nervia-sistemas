package app.iptv.player

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Looper
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.LooperMode
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * Uso numa TV 1920×1080, do primeiro acesso à série: configuração → o "celular" manda o login (ou o link M3U) pela rede
 * local → o app baixa tudo de um servidor imitado → abas TV / Filmes / Séries, guia, fichas, controle dos pais.
 * Grava app/build/tela-*.png para conferir.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@LooperMode(LooperMode.Mode.PAUSED)
@Config(sdk = [34], qualifiers = "w960dp-h540dp-land-xhdpi")
class TelaTest {
    private val agora = System.currentTimeMillis() / 1000
    private fun b64(s: String) = Base64.encodeToString(s.toByteArray(), Base64.NO_WRAP)
    private val pedidos = mutableListOf<String>()

    private fun capa(n: Int): ByteArray {
        val cores = intArrayOf(Color.rgb(170, 60, 50), Color.rgb(40, 110, 160), Color.rgb(60, 140, 80), Color.rgb(150, 110, 40))
        val bmp = Bitmap.createBitmap(200, 300, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(cores[n % cores.size])
        c.drawText("CAPA $n", 40f, 150f, Paint().apply { color = Color.WHITE; textSize = 34f })
        return ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    }

    private fun xtream(acao: String?, q: Map<String, String>): String? {
        if (q["username"] != "marco" || q["password"] != "segredo") return """{"user_info":{"auth":0}}"""
        val img = "http://127.0.0.1:${servidor.localPort}/img"
        return when (acao) {
            null -> """{"user_info":{"auth":1,"status":"Active","exp_date":"1830000000","max_connections":"2","active_cons":"1","allowed_output_formats":["m3u8","ts"]},"server_info":{}}"""
            "get_live_categories" -> """[{"category_id":"1","category_name":"Abertos"},{"category_id":"2","category_name":"Esportes"},{"category_id":"9","category_name":"Adultos XXX"}]"""
            "get_live_streams" -> "[" + listOf(
                """{"num":1,"name":"TV Exemplo HD","stream_id":101,"epg_channel_id":"ex.br","category_id":"1"}""",
                """{"num":2,"name":"Canal Notícias 24h","stream_id":102,"category_id":"1"}""",
                """{"num":3,"name":"Esporte Total","stream_id":103,"epg_channel_id":"esp.br","category_id":"2"}""",
                """{"num":4,"name":"Canal Adulto","stream_id":104,"category_id":"9","is_adult":"1"}""",
            ).plus(if (!muitos) emptyList() else listOf("RecordTV FHD H265", "Globo RJ FHD", "SBT HD Rio de Janeiro", "Band SP FHD",
                "RedeTV! HD", "TV Cultura FHD", "CNN Brasil HD", "GloboNews FHD", "SporTV 2 FHD H265", "ESPN Brasil HD",
                "Premiere Clubes FHD", "Discovery Channel HD", "Warner Channel FHD", "Telecine Action FHD", "HBO Family HD",
                "Cartoon Network HD", "Multishow FHD", "Canal Brasil HD").mapIndexed { i, n ->
                """{"num":${1040 + i * 7},"name":"$n","stream_id":${500 + i},"stream_icon":"$img/${1 + i % 5}.png","category_id":"1"}""" })
            .joinToString(",") + "]"
            "get_short_epg" -> """{"epg_listings":[
                {"title":"${b64("Jornal da Noite")}","description":"${b64("As principais notícias do dia.")}","start_timestamp":"${agora - 1800}","stop_timestamp":"${agora + 1800}"},
                {"title":"${b64("Filme da Madrugada")}","description":"","start_timestamp":"${agora + 1800}","stop_timestamp":"${agora + 9000}"}]}"""
            "get_vod_categories" -> """[{"category_id":"5","category_name":"Ação"},{"category_id":"6","category_name":"Comédia"}]"""
            "get_vod_streams" -> """[
                {"num":1,"name":"Corrida Final (2023)","stream_id":201,"stream_icon":"$img/1.png","rating":"7.8","category_id":"5","container_extension":"mkv"},
                {"num":2,"name":"O Grande Assalto","stream_id":202,"stream_icon":"$img/2.png","rating":"6.4","year":"2021","category_id":"5","container_extension":"mp4"},
                {"num":3,"name":"Rindo à Toa","stream_id":203,"stream_icon":"$img/3.png","rating":"0","category_id":"6","container_extension":"mp4"}]"""
            "get_vod_info" -> """{"info":{"plot":"Um piloto aposentado volta às pistas para uma última corrida.","genre":"Ação, Aventura",
                "director":"Fulano de Tal","cast":"Atriz Um, Ator Dois","releasedate":"2023-05-10","duration":"01:52:00","rating":"7.8"}}"""
            "get_series_categories" -> """[{"category_id":"7","category_name":"Drama"}]"""
            "get_series" -> """[{"num":1,"name":"A Família","series_id":301,"cover":"$img/4.png","rating":"8.5","releaseDate":"2020-03-01","category_id":"7"},
                {"num":2,"name":"Cidade Grande","series_id":302,"cover":"$img/5.png","category_id":"7"}]"""
            "get_series_info" -> """{"info":{"plot":"Três irmãos herdam uma fazenda e precisam decidir o futuro da família.","genre":"Drama","releaseDate":"2020-03-01","rating":"8.5"},
                "episodes":{"1":[{"id":"401","episode_num":1,"title":"Chegada","container_extension":"mp4"},{"id":"402","episode_num":2,"title":"A Herança","container_extension":"mp4"}],
                            "2":[{"id":"411","episode_num":1,"title":"Nova Safra","container_extension":"mp4"}]}}"""
            else -> null
        }
    }

    /** Horário em UTC no formato do XMLTV, a partir de epoch em segundos. */
    private fun utc(s: Long): String =
        java.text.SimpleDateFormat("yyyyMMddHHmmss", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            .format(java.util.Date(s * 1000)) + " +0000"

    /** XMLTV de toda a grade (o que xmltv.php devolve), só para o canal "ex.br" (TV Exemplo HD). */
    private fun xmltvFalso() = """<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <channel id="ex.br"><display-name>TV Exemplo HD</display-name></channel>
          <channel id="esp.br"><display-name>Esporte Total</display-name></channel>
          <programme channel="ex.br" start="${utc(agora - 600)}" stop="${utc(agora + 1200)}"><title>Jornal Agora</title><desc>Notícias ao vivo</desc></programme>
          <programme channel="ex.br" start="${utc(agora + 1800)}" stop="${utc(agora + 5400)}"><title>Show Futuro</title><desc>Programa de auditório</desc></programme>
          <programme channel="ex.br" start="${utc(agora + 90000)}" stop="${utc(agora + 93600)}"><title>Amanha Cedo</title></programme>
          <programme channel="esp.br" start="${utc(agora - 600)}" stop="${utc(agora + 2400)}"><title>Jogo Agora</title><desc>Futebol ao vivo</desc></programme>
        </tv>""".trimIndent()

    private val m3u = buildString {
        append("#EXTM3U\n")
        listOf("Abertos" to 6, "Esportes" to 9, "Notícias" to 4).forEach { (g, n) ->
            repeat(n) { i -> append("#EXTINF:-1 tvg-id=\"c$i\" group-title=\"$g\",$g ${i + 1}\nhttp://127.0.0.1:1/$g/$i.ts\n") }
        }
        append("#EXTINF:-1 group-title=\"Filmes\",Filme Teste\nhttp://127.0.0.1:1/movie/u/p/9.mp4\n")
    }

    /** Servidor do provedor imitado. */
    private val servidor: ServerSocket = ServerSocket(0).also { ss ->
        Thread {
            while (!ss.isClosed) {
                val c = try { ss.accept() } catch (_: Exception) { break }
                Thread {
                    c.use {
                        val ent = it.getInputStream().bufferedReader()
                        val linha = ent.readLine().orEmpty()
                        while (ent.readLine()?.isNotEmpty() == true) Unit
                        val alvo = linha.split(' ').getOrElse(1) { "/" }
                        synchronized(pedidos) { pedidos += alvo }
                        val caminho = alvo.substringBefore('?')
                        val q = alvo.substringAfter('?', "").split('&').filter { p -> '=' in p }
                            .associate { p -> p.substringBefore('=') to URLDecoder.decode(p.substringAfter('='), "UTF-8") }
                        val corpo: ByteArray? = when {
                            caminho == "/player_api.php" -> xtream(q["action"], q)?.toByteArray()
                            caminho == "/lista.m3u" -> m3u.toByteArray()
                            caminho == "/xmltv.php" -> xmltvFalso().toByteArray()
                            caminho == "/nvplayer.json" -> publicados?.toByteArray()
                            caminho == "/rest/v1/rpc/nv_sinal" -> """{"ok":true}""".toByteArray()
                            caminho == "/rest/v1/rpc/nv_servidores_publicos" -> publicados?.toByteArray()
                            caminho.startsWith("/img/") -> capa(caminho.removePrefix("/img/").substringBefore('.').toInt())
                            else -> null
                        }
                        val out = it.getOutputStream()
                        if (corpo == null) out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                        else out.write("HTTP/1.1 200 OK\r\nContent-Length: ${corpo.size}\r\nConnection: close\r\n\r\n".toByteArray() + corpo)
                    }
                }.apply { isDaemon = true }.start()
            }
        }.apply { isDaemon = true }.start()
    }

    /** Lista grande de canais (só para a foto da tela cheia de canais). */
    @Volatile private var muitos = false

    /** Conteúdo do nvplayer.json imitado (null = 404). */
    @Volatile private var publicados: String? = null

    @org.junit.Before fun site() {
        val base = "http://127.0.0.1:${servidor.localPort}"
        Repositorio.urlServidores = "$base/rest/v1/rpc/nv_servidores_publicos"   // 2.15: lista vem do painel (Supabase)
        Repositorio.urlVersao = "$base/nvplayer.json"                            // versão nova continua no nvplayer.json
        Telemetria.destino = base                                                // nunca falar com o Supabase de verdade nos testes
    }

    @After fun parar() = servidor.close()

    private fun textos(v: View): List<String> = when {
        v.visibility != View.VISIBLE -> emptyList()
        v is TextView -> listOf(v.text.toString())
        v is ViewGroup -> (0 until v.childCount).flatMap { textos(v.getChildAt(it)) }
        else -> emptyList()
    }

    private fun acharTexto(v: View, ok: (String) -> Boolean): TextView? = when {
        v.visibility != View.VISIBLE -> null
        v is TextView && ok(v.text.toString()) -> v
        v is ViewGroup -> (0 until v.childCount).firstNotNullOfOrNull { acharTexto(v.getChildAt(it), ok) }
        else -> null
    }

    private fun acharEdit(v: View): android.widget.EditText? = when {
        v is android.widget.EditText -> v
        v is ViewGroup -> (0 until v.childCount).firstNotNullOfOrNull { acharEdit(v.getChildAt(it)) }
        else -> null
    }

    /** Clica no primeiro texto que começa com [prefixo] (sobe até o elemento clicável, como o OK do controle). */
    private fun clicar(raiz: View, prefixo: String) {
        var v: View? = acharTexto(raiz) { it.startsWith(prefixo) } ?: throw AssertionError("não achei \"$prefixo\" em ${textos(raiz)}")
        while (v != null && !v.isClickable) v = v.parent as? View
        v!!.performClick()
        ocioso()
    }

    private fun ocioso() = shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(100))

    private var ultimaRaiz: View? = null

    private fun esperar(seg: Int = 10, ok: () -> Boolean) {
        val fim = System.currentTimeMillis() + seg * 1000
        while (System.currentTimeMillis() < fim) {
            ocioso()
            if (ok()) return
            Thread.sleep(50)
        }
        throw AssertionError("tempo esgotado; na tela: ${textos(ultimaRaiz ?: return)}")
    }

    private fun foto(v: View, nome: String) {
        Thread.sleep(300); ocioso()
        val bmp = Bitmap.createBitmap(1920, 1080, Bitmap.Config.ARGB_8888)
        v.draw(Canvas(bmp))
        File("build").mkdirs()
        File("build/$nome.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun enviar(porta: Int, corpo: String): String = Socket("127.0.0.1", porta).use { s ->
        s.getOutputStream().write(("POST /salvar HTTP/1.1\r\nHost: tv\r\nContent-Type: application/x-www-form-urlencoded\r\n" +
            "Content-Length: ${corpo.toByteArray().size}\r\n\r\n$corpo").toByteArray())
        s.getInputStream().readBytes().decodeToString()
    }

    private fun porta(act: MainActivity) = (MainActivity::class.java.getDeclaredField("configurador").apply { isAccessible = true }
        .get(act) as Configurador).porta

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    /** Foto da lista de canais cheia (para conferir quantas linhas cabem sem rolar). */
    @Test fun listaCheia() {
        muitos = true
        val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
        val act = ctl.get()
        val raiz = act.window.decorView
        ultimaRaiz = raiz
        ocioso()
        val base = "http://127.0.0.1:${servidor.localPort}"
        assertTrue(enviar(porta(act), "tipo=xtream&servidor=${enc(base)}&usuario=marco&senha=segredo").contains("Pronto"))
        esperar { textos(raiz).any { it.startsWith("TV ao vivo") } }
        clicar(raiz, "Abertos")
        act.dispatchKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_DPAD_RIGHT))
        act.dispatchKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_DPAD_RIGHT))
        ocioso()
        acharTexto(raiz) { it == "Canal Notícias 24h" }!!.let { var v: View = it; while (!v.isFocusable) v = v.parent as View; v.isFocusableInTouchMode = true; v.requestFocus() }
        esperar { textos(raiz).any { it.contains("Jornal da Noite") && it.contains("Agora") } }
        foto(raiz, "tela-lista-cheia")
    }

    @Test fun loginXtream() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        ctx.getSharedPreferences("iptv", Context.MODE_PRIVATE).edit().putString("pin", "1234").apply()
        val base = "http://127.0.0.1:${servidor.localPort}"
        // filme 201 já começado: 12 min de 1h52
        ctx.getSharedPreferences("posicoes", Context.MODE_PRIVATE).edit()
            .putString("$base/movie/marco/segredo/201.mkv", "720000;6720000;${System.currentTimeMillis()}").apply()

        val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
        val act = ctl.get()
        val raiz = act.window.decorView
        ultimaRaiz = raiz
        ocioso()
        assertTrue(textos(raiz).contains("Login e senha"))
        assertTrue(textos(raiz).contains("http://p.urldata.gy"))
        foto(raiz, "tela-configurar")

        val p = porta(act)
        Socket("127.0.0.1", p).use { s ->
            s.getOutputStream().write("GET / HTTP/1.1\r\nHost: tv\r\n\r\n".toByteArray())
            val pag = s.getInputStream().readBytes().decodeToString()
            assertTrue(pag.contains("name=\"usuario\"") && pag.contains("name=\"lista\""))
            assertTrue(pag.contains("value=\"http://p.urldata.gy\""))
        }
        // senha errada: o celular vê o erro depois, na TV (o login é conferido no servidor)
        assertTrue(enviar(p, "tipo=xtream&servidor=&usuario=marco&senha=x").contains("Informe o servidor"))
        assertTrue(enviar(p, "tipo=xtream&servidor=${enc(base)}&usuario=marco&senha=segredo").contains("Pronto"))

        esperar { textos(raiz).any { it.startsWith("TV ao vivo") && it.endsWith("4") } }
        val t = textos(raiz)
        assertTrue(t.toString(), t.contains("Filmes  3") && t.contains("Séries  2"))
        assertTrue(t.contains("Abertos  (2)") && t.contains("🔒 Adultos XXX  (1)"))
        // controle dos pais: o canal adulto não aparece em "Todos"
        clicar(raiz, "Todos  (4)")
        assertTrue(textos(raiz).none { it == "Canal Adulto" })
        clicar(raiz, "Abertos  (2)")
        // guia do canal focado (pedido ao servidor)
        // tecla do controle: sai do "modo toque" (na TV não existe) para o foco funcionar
        act.dispatchKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_DPAD_RIGHT))
        act.dispatchKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_DPAD_RIGHT))
        ocioso()
        acharTexto(raiz) { it == "TV Exemplo HD" }!!.let { var v: View = it; while (!v.isFocusable) v = v.parent as View; v.isFocusableInTouchMode = true; v.requestFocus() }
        esperar { textos(raiz).any { it.contains("Jornal da Noite") && it.contains("Agora") } }
        foto(raiz, "tela-tv")

        // 2.7: OK no canal = prévia à direita (lista continua aberta); OK de novo = tela cheia; Voltar = lista
        fun campo(n: String) = MainActivity::class.java.getDeclaredField(n).apply { isAccessible = true }.get(act) as View
        val painel = campo("painel"); val previa = campo("previa")
        // 2.11: o player troca de PlayerView (prévia = TextureView, tela cheia = SurfaceView)
        fun video() = campo("video") as androidx.media3.ui.PlayerView
        clicar(raiz, "TV Exemplo HD")
        ocioso()
        assertEquals(View.VISIBLE, painel.visibility)
        assertTrue("vídeo na prévia", video().parent === previa && video().player != null && video().videoSurfaceView is android.view.TextureView)
        foto(raiz, "tela-tv-previa")
        clicar(raiz, "TV Exemplo HD")
        ocioso()
        assertEquals(View.GONE, painel.visibility)
        assertTrue("vídeo em tela cheia", video().parent !== previa && video().player != null && video().videoSurfaceView is android.view.SurfaceView)
        assertTrue("prévia sem player", (campo("videoPrevia") as androidx.media3.ui.PlayerView).player == null)
        act.onBackPressedDispatcher.onBackPressed()
        ocioso()
        assertEquals(View.VISIBLE, painel.visibility)
        assertTrue(video().parent === previa && video().player != null)

        // Filmes: continuar assistindo e ficha
        clicar(raiz, "Filmes  3")
        esperar { textos(raiz).any { it.startsWith("Ação  (2)") } }
        clicar(raiz, "▶  Continuar assistindo")
        assertTrue(textos(raiz).contains("Corrida Final (2023)"))
        clicar(raiz, "Ação  (2)")
        esperar(5) { textos(raiz).any { it.contains("★ 7,8") } }
        foto(raiz, "tela-filmes")
        clicar(raiz, "Corrida Final (2023)")
        esperar { textos(raiz).any { it.startsWith("Um piloto aposentado") } }
        val f = textos(raiz)
        assertTrue(f.toString(), f.contains("▶  Continuar de 12:00") && f.contains("Do início"))
        assertTrue(f.any { it.contains("01:52:00") && it.contains("Ação, Aventura") })
        foto(raiz, "tela-ficha-filme")
        act.onBackPressedDispatcher.onBackPressed(); ocioso()

        // Séries: temporadas e episódios
        clicar(raiz, "Séries  2")
        esperar { textos(raiz).any { it.startsWith("A Família") } }
        clicar(raiz, "A Família")
        esperar { textos(raiz).any { it.startsWith("Temporada 2") } }
        val s = textos(raiz)
        assertTrue(s.toString(), s.any { it.startsWith("E01   Chegada") } && s.any { it.startsWith("E02   A Herança") })
        assertTrue(s.any { it.contains("2 temporada(s)") })
        foto(raiz, "tela-ficha-serie")
        act.onBackPressedDispatcher.onBackPressed(); ocioso()

        // Ajustes
        clicar(raiz, "Ajustes")
        val a = textos(raiz).joinToString("\n")
        assertTrue(a, a.contains("Assinatura ativa") && a.contains("telas: 1 em uso de 2") && a.contains("4 canais"))
        assertTrue(a.contains("Controle dos pais: ligado"))
        assertTrue(a.none { false } && !a.contains("segredo"))
        foto(raiz, "tela-ajustes")

        val prefs = act.getSharedPreferences("iptv", Context.MODE_PRIVATE)
        assertEquals("xtream", prefs.getString("tipo", null))
        assertTrue(File(act.filesDir, "x_vod.json").length() > 0)
        assertTrue(synchronized(pedidos) { pedidos.any { it.contains("action=get_short_epg") && it.contains("stream_id=101") } })
        ctl.pause().stop().destroy()
    }

    @Test fun agenda() {
        val base = "http://127.0.0.1:${servidor.localPort}"
        val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
        val act = ctl.get()
        val raiz = act.window.decorView
        ultimaRaiz = raiz
        ocioso()
        assertTrue(enviar(porta(act), "tipo=xtream&servidor=${enc(base)}&usuario=marco&senha=segredo").contains("Pronto"))
        esperar { textos(raiz).any { it.startsWith("TV ao vivo") } }

        // abre a aba Agenda e espera a grade (vem do xmltv.php)
        clicar(raiz, "Agenda")
        esperar { val t = textos(raiz); t.any { it.contains("TV Exemplo HD") } && t.any { it.contains("Show Futuro") } }
        val t = textos(raiz)
        assertTrue(t.toString(), t.any { it == "Hoje" })
        assertTrue("programa de agora", t.any { it.contains("Jornal Agora") })
        assertTrue("programa futuro", t.any { it.contains("Show Futuro") })
        assertTrue(synchronized(pedidos) { pedidos.any { it.startsWith("/xmltv.php") } })
        // coluna de grupos: "Todos" + os grupos dos canais com programação
        assertTrue("grupo Todos", t.any { it.startsWith("Todos") })
        assertTrue("grupos por categoria", t.any { it.startsWith("Abertos") } && t.any { it.startsWith("Esportes") })
        foto(raiz, "tela-agenda")

        // escolhe o grupo Esportes: só o canal do grupo aparece
        clicar(raiz, "Esportes")
        esperar { textos(raiz).any { it.contains("Esporte Total") } && textos(raiz).none { it.contains("TV Exemplo HD") } }
        assertTrue("programa do canal de esportes", textos(raiz).any { it.contains("Jogo Agora") })
        clicar(raiz, "Todos")
        esperar { textos(raiz).any { it.contains("TV Exemplo HD") } }
        // escolhe o canal para ver a programação dele
        clicar(raiz, "TV Exemplo HD")
        esperar { textos(raiz).any { it.contains("Show Futuro") } }

        // marca o aviso do programa futuro pelo menu e confere que foi guardado
        acharTexto(raiz) { it.contains("Show Futuro") }!!.performClick()
        ocioso()
        val d = org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog()!!
        assertTrue(shadowOf(d).title.toString().contains("Show Futuro"))
        d.getButton(android.content.DialogInterface.BUTTON_NEUTRAL).performClick()
        ocioso()
        assertTrue("lembrete gravado", Repositorio(act).lembretes().any { it.titulo == "Show Futuro" })
        ctl.pause().stop().destroy()
    }

    @Test fun liberarBloqueados() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        ctx.getSharedPreferences("iptv", Context.MODE_PRIVATE).edit().putString("pin", "1234").apply()
        val base = "http://127.0.0.1:${servidor.localPort}"
        val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
        val act = ctl.get()
        val raiz = act.window.decorView
        ultimaRaiz = raiz
        ocioso()
        assertTrue(enviar(porta(act), "tipo=xtream&servidor=${enc(base)}&usuario=marco&senha=segredo").contains("Pronto"))
        esperar { textos(raiz).any { it.startsWith("TV ao vivo") } }

        // com o controle ligado, o canal adulto não aparece em "Todos"
        clicar(raiz, "Todos")
        assertTrue("adulto escondido", textos(raiz).none { it == "Canal Adulto" })

        // a liberação é pelos Ajustes
        clicar(raiz, "Ajustes")
        assertTrue(textos(raiz).any { it.startsWith("🔓") && it.contains("Liberar canais bloqueados") })
        clicar(raiz, "🔓")
        ocioso()
        val d = org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog()!!
        acharEdit(d.window!!.decorView)!!.setText("1234")
        d.getButton(android.content.DialogInterface.BUTTON_POSITIVE).performClick()
        ocioso()

        // agora o canal adulto aparece em "Todos"
        clicar(raiz, "TV ao vivo")
        clicar(raiz, "Todos")
        assertTrue("adulto liberado", textos(raiz).any { it == "Canal Adulto" })
        // e os Ajustes mostram que dá para esconder de novo
        clicar(raiz, "Ajustes")
        assertTrue(textos(raiz).any { it.contains("liberados") && it.contains("esconder") })
        ctl.pause().stop().destroy()
    }

    @Test fun aparencia() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        val base = "http://127.0.0.1:${servidor.localPort}"
        val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
        val act = ctl.get()
        val raiz = act.window.decorView
        ultimaRaiz = raiz
        ocioso()
        assertTrue(enviar(porta(act), "tipo=xtream&servidor=${enc(base)}&usuario=marco&senha=segredo").contains("Pronto"))
        esperar { textos(raiz).any { it.startsWith("TV ao vivo") } }

        // começa no Clássico (azul)
        assertEquals("classico", Estilo.tema)
        clicar(raiz, "Ajustes")
        assertTrue(textos(raiz).any { it.startsWith("🎨") && it.contains("Clássico (azul)") })

        // escolhe o Premium (ciano) no seletor; a escolha fica guardada no aparelho
        clicar(raiz, "🎨")
        ocioso()
        val d = org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog()!!
        org.robolectric.Shadows.shadowOf(d).clickOnItem(1)
        ocioso()
        assertEquals("premium", ctx.getSharedPreferences("iptv", Context.MODE_PRIVATE).getString("tema", null))
        try { ctl.pause().stop().destroy() } catch (_: Exception) {}
    }

    @Test fun temaPremium() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        ctx.getSharedPreferences("iptv", Context.MODE_PRIVATE).edit().putString("tema", "premium").apply()
        val base = "http://127.0.0.1:${servidor.localPort}"
        val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
        val act = ctl.get()
        val raiz = act.window.decorView
        ultimaRaiz = raiz
        ocioso()
        // o tema é aplicado na abertura: destaque em ciano
        assertEquals("premium", Estilo.tema)
        assertEquals(android.graphics.Color.rgb(0x22, 0xD3, 0xEE), Estilo.AZUL_CLARO)
        assertTrue(enviar(porta(act), "tipo=xtream&servidor=${enc(base)}&usuario=marco&senha=segredo").contains("Pronto"))
        esperar { textos(raiz).any { it.startsWith("TV ao vivo") } }
        clicar(raiz, "Abertos  (2)")
        act.dispatchKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_DPAD_RIGHT))
        act.dispatchKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_DPAD_RIGHT))
        ocioso()
        acharTexto(raiz) { it == "TV Exemplo HD" }!!.let { var v: View = it; while (!v.isFocusable) v = v.parent as View; v.isFocusableInTouchMode = true; v.requestFocus() }
        esperar { textos(raiz).any { it.contains("Jornal da Noite") && it.contains("Agora") } }
        foto(raiz, "tema-premium")
        try { ctl.pause().stop().destroy() } catch (_: Exception) {}
    }

    @Test fun linkM3u() {
        val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
        val act = ctl.get()
        val raiz = act.window.decorView
        ocioso()
        val url = "http://127.0.0.1:${servidor.localPort}/lista.m3u"
        assertTrue(enviar(porta(act), "tipo=m3u&lista=${enc(url)}&epg=").contains("Pronto"))
        esperar { textos(raiz).any { it.startsWith("Esportes  (9)") } }
        val t = textos(raiz)
        assertTrue(t.toString(), t.contains("Todos  (19)") && t.contains("Filmes  1") && t.contains("Séries  0"))
        assertEquals(url, act.getSharedPreferences("iptv", Context.MODE_PRIVATE).getString("url", null))
        foto(raiz, "tela-lista-m3u")
        ctl.pause().stop().destroy()
    }

    @Test fun linkM3uComLoginViraXtream() {
        val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
        val act = ctl.get()
        val raiz = act.window.decorView
        ocioso()
        val link = "http://127.0.0.1:${servidor.localPort}/get.php?username=marco&password=segredo&type=m3u_plus&output=ts"
        assertTrue(enviar(porta(act), "tipo=m3u&lista=${enc(link)}").contains("Pronto"))
        esperar { textos(raiz).any { it == "Filmes  3" } }
        // sem configurar nada, o controle dos pais já vem ligado com a senha 0000
        assertTrue(textos(raiz).contains("🔒 Adultos XXX  (1)"))
        clicar(raiz, "Ajustes")
        assertTrue(textos(raiz).joinToString().contains("senha padrão 0000"))
        val prefs = act.getSharedPreferences("iptv", Context.MODE_PRIVATE)
        assertEquals("xtream", prefs.getString("tipo", null))
        assertEquals("marco", prefs.getString("usuario", null))
        ctl.pause().stop().destroy()
    }

    @Test fun servidorDoSite() {
        val base = "http://127.0.0.1:${servidor.localPort}"
        // o site publica um endereço que não responde e, depois, o certo
        publicados = """{"servidores": ["http://127.0.0.1:1", "$base"]}"""
        val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
        val act = ctl.get()
        val raiz = act.window.decorView
        // primeira vez: o campo Servidor troca para o 1º endereço do site
        esperar { textos(raiz).contains("http://127.0.0.1:1") }
        // a pessoa envia com o endereço antigo (que não responde): o app procura no site e acha o que funciona
        assertTrue(enviar(porta(act), "tipo=xtream&servidor=${enc("http://127.0.0.1:2")}&usuario=marco&senha=segredo").contains("Pronto"))
        esperar(30) { textos(raiz).any { it == "Filmes  3" } }
        val prefs = act.getSharedPreferences("iptv", Context.MODE_PRIVATE)
        assertEquals(base, prefs.getString("servidor", null))
        assertEquals("http://127.0.0.1:1\n$base", prefs.getString("srv_publicados", null))
        ctl.pause().stop().destroy()
    }

    @Test fun portalMostraServidorDoSite() {
        // o painel (nvplayer.json) aponta um endereço novo; o portal do celular tem de mostrá-lo (não o embutido)
        publicados = """{"servidores": ["http://servidor-novo.gy"]}"""
        val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
        val act = ctl.get()
        val raiz = act.window.decorView
        esperar { textos(raiz).contains("http://servidor-novo.gy") }   // a lista do site já foi lida
        val pag = Socket("127.0.0.1", porta(act)).use { s ->
            s.getOutputStream().write("GET / HTTP/1.1\r\nHost: tv\r\n\r\n".toByteArray())
            s.getInputStream().readBytes().decodeToString()
        }
        assertTrue(pag, pag.contains("value=\"http://servidor-novo.gy\""))
        assertTrue("não mostra o embutido antigo", !pag.contains("http://p.urldata.gy"))
        ctl.pause().stop().destroy()
    }

    @Test fun lerArquivoDoSite() {
        assertEquals(listOf("http://a.com:8080", "http://b.net"),
            Repositorio.lerServidores("""{"servidores": ["a.com:8080/", "http://b.net", "http://b.net", ""]}"""))
        assertEquals(listOf("http://c.gy"), Repositorio.lerServidores("""{"servidor": "http://c.gy"}"""))
        assertEquals(emptyList<String>(), Repositorio.lerServidores("""{"obs": "nada"}"""))
    }

    @Test fun avisaVersaoNova() {
        publicados = """{"servidores": [], "versao": {"codigo": 999, "nome": "9.9", "apk": "https://nervia.com.br/nvplayer.apk", "novidades": "Teste de aviso."}}"""
        val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
        val act = ctl.get()
        var d: android.app.AlertDialog? = null
        esperar { d = org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog() as android.app.AlertDialog?; d?.isShowing == true }
        val sd = shadowOf(d!!)
        assertEquals("Nova versão do NVPlayer: 9.9", sd.title.toString())
        assertTrue(sd.message.toString().contains("Teste de aviso."))
        // "Depois": não pergunta de novo por um dia
        d!!.getButton(android.content.DialogInterface.BUTTON_NEGATIVE).performClick()
        ocioso()
        val prefs = act.getSharedPreferences("iptv", Context.MODE_PRIVATE)
        assertTrue(prefs.getLong("atualizacao_adiada", 0) > System.currentTimeMillis() + 23 * 3_600_000L)
        ctl.pause().stop().destroy()
    }

    @Test fun lerVersaoDoSite() {
        val v = Atualizador.lerVersao("""{"versao": {"codigo": 8, "nome": "2.6", "apk": "https://nervia.com.br/nvplayer.apk"}}""")!!
        assertEquals(8L, v.codigo); assertEquals("2.6", v.nome); assertEquals(null, v.novidades)
        assertEquals(null, Atualizador.lerVersao("""{"versao": {"codigo": 8, "apk": "http://inseguro/x.apk"}}"""))
        assertEquals(null, Atualizador.lerVersao("""{"servidores": []}"""))
    }
}
