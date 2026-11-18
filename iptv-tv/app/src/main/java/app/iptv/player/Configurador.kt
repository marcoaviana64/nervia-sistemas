package app.iptv.player

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import kotlin.concurrent.thread

/**
 * Pequeno servidor na rede de casa, só enquanto a tela de configuração está aberta: o celular abre
 * http://<ip da TV>:<porta> e envia o login (servidor, usuário e senha) ou o link M3U (digitar no controle remoto é sofrido).
 * Não devolve a configuração atual (tem usuário e senha) para ninguém.
 * [aoReceber] recebe os campos do formulário e devolve null (aceito) ou a mensagem de erro.
 */
class Configurador(
    private val servidorPadrao: String = Repositorio.SERVIDOR_PADRAO,
    private val aoReceber: (Map<String, String>) -> String?,
) {
    private var servidor: ServerSocket? = null
    val porta: Int get() = servidor?.localPort ?: 0

    fun iniciar() {
        val s = try { ServerSocket(8080) } catch (_: Exception) { ServerSocket(0) }
        servidor = s
        thread(isDaemon = true, name = "configurador") {
            while (!s.isClosed) {
                val c = try { s.accept() } catch (_: Exception) { break }
                thread(isDaemon = true) { atender(c) }
            }
        }
    }

    fun parar() { try { servidor?.close() } catch (_: Exception) {} ; servidor = null }

    private fun atender(c: Socket) = c.use { sock ->
        sock.soTimeout = 10_000
        val ent = sock.getInputStream().buffered()
        val linha = lerLinha(ent) ?: return
        var tamanho = 0
        while (true) {
            val h = lerLinha(ent) ?: break
            if (h.isEmpty()) break
            if (h.startsWith("content-length:", true)) tamanho = h.substringAfter(':').trim().toIntOrNull() ?: 0
        }
        val (metodo, caminho) = linha.split(' ').let { (it.getOrNull(0) ?: "") to (it.getOrNull(1) ?: "/") }
        val html = if (metodo == "POST" && caminho.startsWith("/salvar")) {
            val corpo = ByteArray(tamanho.coerceAtMost(64 * 1024))
            var lidos = 0
            while (lidos < corpo.size) { val n = ent.read(corpo, lidos, corpo.size - lidos); if (n < 0) break; lidos += n }
            val campos = String(corpo, 0, lidos).split('&').associate {
                it.substringBefore('=') to URLDecoder.decode(it.substringAfter('=', ""), "UTF-8")
            }
            val erro = aoReceber(campos.mapValues { it.value.trim() })
            if (erro == null) pagina("<h2>Pronto!</h2><p>A TV está carregando a lista. Pode fechar esta página.</p>")
            else pagina("<h2>Não deu certo</h2><p>${erro.replace("<", "&lt;")}</p><p><a href='/'>Voltar</a></p>")
        } else {
            pagina("""
                <h2>NVPlayer · lista da TV</h2>
                <h3>Login e senha <small>(recomendado: separa TV, filmes e séries)</small></h3>
                <form method="post" action="/salvar">
                  <input type="hidden" name="tipo" value="xtream">
                  <label>Servidor (com a porta)</label>
                  <input name="servidor" value="${servidorPadrao.replace("\"", "&quot;")}" placeholder="http://servidor.com:8080" required autocapitalize="off" autocorrect="off">
                  <label>Usuário</label><input name="usuario" required autocapitalize="off" autocorrect="off">
                  <label>Senha</label><input name="senha" type="password" required>
                  <button type="submit">Enviar para a TV</button>
                </form>
                <h3>Ou link M3U</h3>
                <form method="post" action="/salvar">
                  <input type="hidden" name="tipo" value="m3u">
                  <label>Endereço da lista (M3U)</label>
                  <textarea name="lista" rows="3" placeholder="http://servidor:porta/get.php?username=...&password=...&type=m3u_plus" required></textarea>
                  <label>Guia de programação (XMLTV) — opcional</label>
                  <input name="epg" placeholder="http://.../xmltv.php ou .xml.gz" autocapitalize="off">
                  <button type="submit">Enviar para a TV</button>
                </form>
                <p class="obs">Se o link M3U tiver "username" e "password", a TV entra com login e senha sozinha.</p>
            """.trimIndent())
        }
        val bytes = html.toByteArray()
        val out = sock.getOutputStream()
        out.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\n" +
            "Cache-Control: no-store\r\nConnection: close\r\n\r\n").toByteArray())
        out.write(bytes)
        out.flush()
    }

    private fun lerLinha(e: java.io.InputStream): String? {
        val sb = StringBuilder()
        while (true) {
            val b = e.read()
            if (b < 0) return if (sb.isEmpty()) null else sb.toString()
            if (b == '\n'.code) return sb.toString().trimEnd('\r')
            if (sb.length < 8192) sb.append(b.toChar())
        }
    }

    private fun pagina(miolo: String) = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1"><title>NVPlayer</title><style>
        body{font-family:system-ui,sans-serif;max-width:560px;margin:24px auto;padding:0 16px;color:#222}
        label{display:block;margin:12px 0 6px;font-weight:600} textarea,input{width:100%;box-sizing:border-box;font-size:16px;padding:10px}
        h3{margin-top:28px} small{font-weight:400;color:#666}
        button{margin-top:12px;width:100%;padding:14px;font-size:17px;background:#2F9FD0;color:#fff;border:0;border-radius:8px}
        .obs{color:#666;font-size:14px}</style></head><body>$miolo</body></html>"""

    companion object {
        /** IPv4 da rede local (Wi-Fi ou cabo). */
        fun ipLocal(): String? = try {
            val ips = NetworkInterface.getNetworkInterfaces().toList()
                .filter { it.isUp && !it.isLoopback }
                .flatMap { it.inetAddresses.toList() }
                .filterIsInstance<Inet4Address>()
            (ips.firstOrNull { it.isSiteLocalAddress } ?: ips.firstOrNull())?.hostAddress
        } catch (_: Exception) { null }

        fun qr(texto: String, lado: Int): Bitmap {
            val m = QRCodeWriter().encode(texto, BarcodeFormat.QR_CODE, lado, lado, mapOf(EncodeHintType.MARGIN to 1))
            val px = IntArray(lado * lado) { i -> if (m[i % lado, i / lado]) Color.BLACK else Color.WHITE }
            return Bitmap.createBitmap(px, lado, lado, Bitmap.Config.RGB_565)
        }
    }
}
