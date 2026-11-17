package app.iptv.player

import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

object Http {
    /** Muitos provedores recusam o agente padrão do Android; este é aceito pela grande maioria. */
    const val USER_AGENT = "VLC/3.0.20 LibVLC/3.0.20"

    class Status(val codigo: Int) : Exception("O servidor respondeu $codigo")

    /** GET seguindo redirecionamentos (inclusive http ↔ https, que o HttpURLConnection não segue sozinho). */
    fun abrir(endereco: String, leitura: Int = 90_000): InputStream {
        var url = URL(endereco)
        repeat(6) {
            val c = url.openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 15_000
            c.readTimeout = leitura
            c.setRequestProperty("User-Agent", USER_AGENT)
            val st = c.responseCode
            if (st in 300..399) {
                val destino = c.getHeaderField("Location") ?: error("Redirecionamento sem destino")
                c.disconnect()
                url = URL(url, destino)
                return@repeat
            }
            if (st != 200) { c.disconnect(); throw Status(st) }
            return c.inputStream
        }
        error("Redirecionamentos demais")
    }

    fun texto(endereco: String): String = abrir(endereco, 30_000).use { it.readBytes().toString(Charsets.UTF_8) }

    /** Baixa para um arquivo temporário e só troca o arquivo no fim (download interrompido não estraga a cópia). */
    fun salvar(endereco: String, destino: File) {
        val tmp = File(destino.parentFile, destino.name + ".tmp")
        abrir(endereco).use { e -> tmp.outputStream().use { e.copyTo(it) } }
        if (!tmp.renameTo(destino)) { destino.delete(); tmp.renameTo(destino) }
        destino.setLastModified(System.currentTimeMillis())
    }
}
