package br.com.nervia.midia

import android.os.StatFs
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** Baixa os arquivos da playlist do Google Drive para o aparelho (retomando downloads interrompidos) e apaga o que saiu. */
class Baixador(private val pasta: File) {
    init { pasta.mkdirs() }

    fun arquivo(i: Item) = File(pasta, i.arquivo)
    fun pronto(i: Item) = arquivo(i).exists()
    fun espacoLivreMb(): Long = runCatching { StatFs(pasta.path).availableBytes / 1_048_576 }.getOrDefault(-1)

    /** Baixa um arquivo (se ainda não estiver no aparelho). Confere o md5 informado pelo Drive. */
    fun baixar(i: Item, chaveApi: String) {
        val destino = arquivo(i)
        if (destino.exists()) return
        val parte = File(pasta, i.arquivo + ".part")
        val jaTem = if (parte.exists()) parte.length() else 0L
        val margem = 50L * 1_048_576
        if (StatFs(pasta.path).availableBytes < (i.tamanho - jaTem) + margem) {
            throw IOException("pouco espaço no aparelho para baixar (${i.tamanho / 1_048_576} MB)")
        }
        val c = URL(i.url + "&key=" + chaveApi).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 20_000
            c.readTimeout = 60_000
            i.chaveRecurso?.let { c.setRequestProperty("X-Goog-Drive-Resource-Keys", "${i.id}/$it") }
            if (jaTem > 0) c.setRequestProperty("Range", "bytes=$jaTem-")
            val codigo = c.responseCode
            if (codigo == 416) { parte.delete(); throw IOException("download reiniciado") }
            if (codigo != 200 && codigo != 206) {
                val msg = c.errorStream?.bufferedReader()?.use { it.readText() }?.let { Regex("\"message\"\\s*:\\s*\"([^\"]+)").find(it)?.groupValues?.get(1) }
                throw IOException("Google Drive respondeu $codigo${msg?.let { ": $it" } ?: ""}")
            }
            val continuar = codigo == 206 && jaTem > 0
            val md5 = MessageDigest.getInstance("MD5")
            if (continuar) parte.inputStream().use { entrada -> copiar(entrada, null, md5) }
            FileOutputStream(parte, continuar).use { saida -> c.inputStream.use { copiar(it, saida, md5) } }
            val obtido = md5.digest().joinToString("") { "%02x".format(it) }
            if (i.md5.isNotBlank() && !obtido.equals(i.md5, ignoreCase = true)) {
                parte.delete()
                throw IOException("arquivo baixado com defeito (md5 diferente); será baixado de novo")
            }
            if (!parte.renameTo(destino)) throw IOException("não foi possível gravar o arquivo")
        } finally {
            c.disconnect()
        }
    }

    private fun copiar(entrada: java.io.InputStream, saida: java.io.OutputStream?, md5: MessageDigest) {
        val buf = ByteArray(64 * 1024)
        while (true) {
            val n = entrada.read(buf)
            if (n < 0) break
            md5.update(buf, 0, n)
            saida?.write(buf, 0, n)
        }
    }

    /** Apaga do aparelho os arquivos que não estão em nenhuma das listas (downloads parciais dos que ficam, mantém). */
    fun limpar(manter: Collection<Item>) {
        val nomes = manter.flatMap { listOf(it.arquivo, it.arquivo + ".part") }.toSet()
        pasta.listFiles()?.forEach { if (it.name !in nomes) it.delete() }
    }
}
