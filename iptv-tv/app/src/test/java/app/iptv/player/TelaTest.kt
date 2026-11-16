package app.iptv.player

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
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
import java.io.File
import java.net.ServerSocket
import java.net.Socket

/**
 * Caminho do primeiro uso numa TV 1920×1080: tela de configuração → o "celular" manda o endereço pela rede local →
 * o app baixa a lista (servidor M3U imitado) → lista de grupos e canais. Grava app/build/tela-*.png para conferir.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@LooperMode(LooperMode.Mode.PAUSED)
@Config(sdk = [34], qualifiers = "w960dp-h540dp-land-xhdpi")
class TelaTest {
    private val m3u = buildString {
        append("#EXTM3U\n")
        listOf("Abertos" to 6, "Esportes" to 9, "Notícias" to 4, "Filmes | Ação" to 30).forEach { (g, n) ->
            repeat(n) { i -> append("#EXTINF:-1 tvg-id=\"c$i\" group-title=\"$g\",$g ${i + 1}\nhttp://127.0.0.1:1/$g/$i.ts\n") }
        }
    }
    /** Servidor do provedor imitado: devolve a lista para qualquer pedido. */
    private val servidor = ServerSocket(0).also { ss ->
        Thread {
            while (!ss.isClosed) {
                val c = try { ss.accept() } catch (_: Exception) { break }
                c.use {
                    val ent = it.getInputStream().bufferedReader()
                    while (ent.readLine()?.isNotEmpty() == true) Unit
                    val b = m3u.toByteArray()
                    it.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: ${b.size}\r\nConnection: close\r\n\r\n".toByteArray() + b)
                }
            }
        }.apply { isDaemon = true }.start()
    }

    @After fun parar() = servidor.close()

    private fun textos(v: View): List<String> = when (v) {
        is TextView -> listOf(v.text.toString())
        is ViewGroup -> (0 until v.childCount).flatMap { textos(v.getChildAt(it)) }
        else -> emptyList()
    }

    private fun esperar(seg: Int = 10, ok: () -> Boolean) {
        val fim = System.currentTimeMillis() + seg * 1000
        while (System.currentTimeMillis() < fim) {
            shadowOf(Looper.getMainLooper()).idle()
            if (ok()) return
            Thread.sleep(50)
        }
        throw AssertionError("tempo esgotado")
    }

    private fun foto(v: View, nome: String) {
        val bmp = Bitmap.createBitmap(1920, 1080, Bitmap.Config.ARGB_8888)
        v.draw(Canvas(bmp))
        File("build").mkdirs()
        File("build/$nome.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun primeiroUso() {
        val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
        val act = ctl.get()
        val raiz = act.window.decorView
        shadowOf(Looper.getMainLooper()).idle()
        val t = textos(raiz)
        assertTrue(t.any { it.contains("Configurar a lista IPTV") })
        foto(raiz, "tela-configurar")

        // o "celular" abre a página e envia o endereço
        val porta = (MainActivity::class.java.getDeclaredField("configurador").apply { isAccessible = true }
            .get(act) as Configurador).porta
        Socket("127.0.0.1", porta).use { s ->
            s.getOutputStream().write("GET / HTTP/1.1\r\nHost: tv\r\n\r\n".toByteArray())
            val pag = s.getInputStream().readBytes().decodeToString()
            assertTrue(pag.contains("Enviar para a TV"))
        }
        val url = "http://127.0.0.1:${servidor.localPort}/lista.m3u"
        val corpo = "lista=" + java.net.URLEncoder.encode(url, "UTF-8")
        Socket("127.0.0.1", porta).use { s ->
            s.getOutputStream().write("POST /salvar HTTP/1.1\r\nHost: tv\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: ${corpo.length}\r\n\r\n$corpo".toByteArray())
            assertTrue(s.getInputStream().readBytes().decodeToString().contains("Pronto"))
        }

        esperar { textos(raiz).any { it.startsWith("Esportes  (9)") } }
        val t2 = textos(raiz)
        assertTrue(t2.contains("Todos  (49)"))
        assertTrue(t2.contains("Notícias  (4)"))
        assertTrue(t2.none { it.contains("Configurar a lista IPTV") })
        assertEquals(url, act.getSharedPreferences("iptv", Context.MODE_PRIVATE).getString("url", null))
        assertTrue(File(act.filesDir, "lista.m3u").length() > 0)
        foto(raiz, "tela-lista")
        ctl.pause().stop().destroy()
    }
}
