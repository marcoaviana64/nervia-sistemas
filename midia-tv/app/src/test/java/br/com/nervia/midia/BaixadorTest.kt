package br.com.nervia.midia

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowStatFs
import java.io.IOException
import java.net.ServerSocket
import kotlin.concurrent.thread
import java.nio.file.Files
import java.security.MessageDigest

/** Download direto (servidor imitado): conteúdo e md5, e a mensagem de erro dizendo QUEM recusou (403 do Google em JSON
 *  ou página de bloqueio da rede), que a TV mostra e manda ao painel. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BaixadorTest {
    private lateinit var srv: ServerSocket
    private val conteudo = "vídeo de teste".toByteArray()
    private val md5 = MessageDigest.getInstance("MD5").digest(conteudo).joinToString("") { "%02x".format(it) }
    private val rotas = mapOf(
        "/ok" to Triple(200, "video/mp4", conteudo),
        "/google403" to Triple(403, "application/json", """{"error":{"code":403,"message":"The download quota for this file has been exceeded."}}""".toByteArray()),
        "/rede403" to Triple(403, "text/html", "<html><head><title>Acesso bloqueado</title></head><body>x</body></html>".toByteArray()),
    )

    /** Servidor HTTP mínimo (uma conexão por vez, Connection: close). */
    @Before fun subir() {
        srv = ServerSocket(0)
        thread(isDaemon = true) {
            while (!srv.isClosed) {
                val s = runCatching { srv.accept() }.getOrNull() ?: break
                s.use {
                    val linha = it.getInputStream().bufferedReader().readLine().orEmpty()
                    val caminho = linha.split(" ").getOrElse(1) { "/" }.substringBefore("?")
                    val (st, tipo, corpo) = rotas[caminho] ?: Triple(404, "text/plain", ByteArray(0))
                    val o = it.getOutputStream()
                    o.write("HTTP/1.1 $st X\r\nContent-Type: $tipo\r\nContent-Length: ${corpo.size}\r\nConnection: close\r\n\r\n".toByteArray())
                    o.write(corpo); o.flush()
                }
            }
        }
    }

    @After fun descer() = srv.close()

    private fun item(caminho: String) = Item("arq_$caminho".replace("/", ""), "video01.mp4", "video", md5, conteudo.size.toLong(), null,
        "http://127.0.0.1:${srv.localPort}$caminho?alt=media", null)

    /** Pasta do aparelho imitada com 400 MB livres (no Robolectric o StatFs começa zerado). */
    private fun baixador(): Baixador {
        val d = Files.createTempDirectory("midia").toFile()
        ShadowStatFs.registerStats(d, 100_000, 100_000, 100_000)
        return Baixador(d)
    }

    private fun erro(caminho: String): String {
        val b = baixador()
        try { b.baixar(item(caminho), "CHAVE"); fail("devia falhar") } catch (e: IOException) { return e.message.orEmpty() }
        return ""
    }

    @Test fun baixaEConfere() {
        val b = baixador()
        val i = item("/ok")
        b.baixar(i, "CHAVE")
        assertTrue(b.pronto(i))
        assertEquals("vídeo de teste", b.arquivo(i).readText())
    }

    @Test fun recusaDoGoogle() =
        assertEquals("Google Drive respondeu 403: The download quota for this file has been exceeded.", erro("/google403"))

    @Test fun bloqueioDaRede() = assertEquals("Google Drive respondeu 403: página \"Acesso bloqueado\"", erro("/rede403"))
}
