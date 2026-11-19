package app.iptv.player

import okhttp3.Request
import java.io.File
import java.io.InputStream
import java.util.concurrent.TimeUnit

object Http {
    /** Muitos provedores recusam o agente padrão do Android; este é aceito pela grande maioria. */
    const val USER_AGENT = "VLC/3.0.20 LibVLC/3.0.20"

    class Status(val codigo: Int) : Exception("O servidor respondeu $codigo")

    /** GET pela rede do app (DNS alternativo, redirecionamentos inclusive http ↔ https). */
    fun abrir(endereco: String, leitura: Int = 90_000, cabecalhos: Map<String, String> = emptyMap()): InputStream {
        val cli = Rede.cliente.newBuilder().readTimeout(leitura.toLong(), TimeUnit.MILLISECONDS).build()
        val req = Request.Builder().url(endereco).header("User-Agent", USER_AGENT)
        cabecalhos.forEach { (k, v) -> req.header(k, v) }
        val r = cli.newCall(req.build()).execute()
        if (r.code != 200) { r.close(); throw Status(r.code) }
        return r.body!!.byteStream()
    }

    fun texto(endereco: String, cabecalhos: Map<String, String> = emptyMap()): String =
        abrir(endereco, 30_000, cabecalhos).use { it.readBytes().toString(Charsets.UTF_8) }

    /** Baixa para um arquivo temporário e só troca o arquivo no fim (download interrompido não estraga a cópia). */
    fun salvar(endereco: String, destino: File) {
        val tmp = File(destino.parentFile, destino.name + ".tmp")
        abrir(endereco).use { e -> tmp.outputStream().use { e.copyTo(it) } }
        if (!tmp.renameTo(destino)) { destino.delete(); tmp.renameTo(destino) }
        destino.setLastModified(System.currentTimeMillis())
    }
}
