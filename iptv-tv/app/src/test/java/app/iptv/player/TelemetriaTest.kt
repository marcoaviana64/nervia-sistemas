package app.iptv.player

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.net.ServerSocket

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TelemetriaTest {
    private val ctx = ApplicationProvider.getApplicationContext<Context>()

    /** Servidor imitado: guarda o corpo recebido e responde [codigo]. */
    private fun servidor(codigo: Int, recebido: MutableList<String>): ServerSocket = ServerSocket(0).also { ss ->
        Thread {
            while (!ss.isClosed) {
                val c = try { ss.accept() } catch (_: Exception) { break }
                c.use {
                    // lê em bytes (o corpo tem acentos: Content-Length conta bytes, não caracteres)
                    val ent = it.getInputStream()
                    fun linha(): String { val b = java.io.ByteArrayOutputStream(); while (true) { val c = ent.read(); if (c < 0 || c == '\n'.code) break; if (c != '\r'.code) b.write(c) }; return b.toString("UTF-8") }
                    var tam = 0
                    while (true) { val l = linha(); if (l.isEmpty()) break
                        if (l.startsWith("Content-Length:", true)) tam = l.substringAfter(':').trim().toInt() }
                    val buf = ByteArray(tam); var n = 0
                    while (n < tam) { val r = ent.read(buf, n, tam - n); if (r < 0) break; n += r }
                    synchronized(recebido) { recebido += String(buf, 0, n, Charsets.UTF_8) }
                    it.getOutputStream().write("HTTP/1.1 $codigo X\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".toByteArray())
                }
            }
        }.apply { isDaemon = true }.start()
    }

    @Test fun somaNoAparelhoEMandaUmResumoPequeno() {
        val rec = mutableListOf<String>()
        val ss = servidor(200, rec)
        val t = Telemetria(ctx, "http://127.0.0.1:${ss.localPort}", "chave")
        t.abriu(Tipo.AO_VIVO, "Globo RJ", "Abertos")
        repeat(900) { t.tocando(Tipo.AO_VIVO, "Globo RJ", "Abertos", 2) }   // 30 min em tiques de 2 s
        t.abriu(Tipo.SERIE, "A Família", "Drama")
        assertEquals(2, t.pendentes())
        val info = JSONObject().put("lista", JSONObject().put("usuario", "marco").put("servidor", "p.exemplo.gy"))
        assertTrue(t.enviar(info))
        val corpo = JSONObject(rec.single()).getJSONObject("p")
        assertEquals(t.id, corpo.getString("id"))
        val s = corpo.getJSONArray("sessoes")
        assertEquals(2, s.length())
        val g = (0 until s.length()).map { s.getJSONObject(it) }.first { it.getString("nome") == "Globo RJ" }
        assertEquals(1800, g.getInt("s")); assertEquals(1, g.getInt("vezes")); assertEquals("vivo", g.getString("tipo"))
        assertFalse("nunca manda senha", rec.single().contains("senha"))
        assertTrue("resumo pequeno: ${rec.single().length} bytes", rec.single().length < 2000)
        assertEquals(0, t.pendentes())
        assertFalse("o próximo só daqui a 30 min", t.hora(forcar = false))
        ss.close()
    }

    @Test fun falhouGuardaParaOProximo() {
        val rec = mutableListOf<String>()
        val ss = servidor(500, rec)
        val t = Telemetria(ctx, "http://127.0.0.1:${ss.localPort}", "chave")
        t.tocando(Tipo.FILME, "Filme X", "Ação", 60)
        assertFalse(t.enviar(JSONObject()))
        assertEquals(1, t.pendentes())
        // o app fechou e abriu de novo: o acumulado continua lá, com o mesmo aparelho
        val t2 = Telemetria(ctx, "http://127.0.0.1:${ss.localPort}", "chave")
        assertEquals(1, t2.pendentes()); assertEquals(t.id, t2.id)
        ss.close()
    }
}
