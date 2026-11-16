package app.iptv.player

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Endereço da lista, cópia local, favoritos e último canal (tudo só no aparelho). */
class Repositorio(private val ctx: Context) {
    private val prefs = ctx.getSharedPreferences("iptv", Context.MODE_PRIVATE)
    private val arquivo = File(ctx.filesDir, "lista.m3u")

    var urlLista: String?
        get() = prefs.getString("url", null)
        set(v) = prefs.edit().putString("url", v).apply()

    var ultimoCanal: String?
        get() = prefs.getString("ultimo", null)
        set(v) = prefs.edit().putString("ultimo", v).apply()

    var favoritos: Set<String>
        get() = prefs.getStringSet("favoritos", emptySet())!!.toSet()
        set(v) = prefs.edit().putStringSet("favoritos", v).apply()

    fun alternarFavorito(url: String): Boolean {
        val f = favoritos.toMutableSet()
        val agora = if (url in f) { f.remove(url); false } else { f.add(url); true }
        favoritos = f
        return agora
    }

    fun temCopia() = arquivo.exists() && arquivo.length() > 0

    /** A cópia local tem mais de [horas] horas? */
    fun copiaVelha(horas: Int = 24) = !temCopia() || System.currentTimeMillis() - arquivo.lastModified() > horas * 3_600_000L

    fun lerCopia(): List<Canal> = arquivo.bufferedReader(Charsets.UTF_8).use { M3u.ler(it) }

    /** Baixa a lista (bloqueante; chamar fora da thread da tela). Só troca a cópia se vier pelo menos um canal. */
    fun baixar(endereco: String = urlLista ?: error("Nenhuma lista configurada")): List<Canal> {
        val tmp = File(ctx.filesDir, "lista.tmp")
        abrir(endereco).use { entrada -> tmp.outputStream().use { entrada.copyTo(it) } }
        val canais = tmp.bufferedReader(Charsets.UTF_8).use { M3u.ler(it) }
        if (canais.isEmpty()) {
            tmp.delete()
            error("A lista veio vazia ou não está no formato M3U")
        }
        tmp.renameTo(arquivo)
        arquivo.setLastModified(System.currentTimeMillis())
        return canais
    }

    /** GET seguindo redirecionamentos (inclusive http ↔ https, que o HttpURLConnection não segue sozinho). */
    private fun abrir(endereco: String): java.io.InputStream {
        var url = URL(endereco)
        repeat(6) {
            val c = url.openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 15_000
            c.readTimeout = 60_000
            c.setRequestProperty("User-Agent", USER_AGENT)
            val st = c.responseCode
            if (st in 300..399) {
                val destino = c.getHeaderField("Location") ?: error("Redirecionamento sem destino")
                c.disconnect()
                url = URL(url, destino)
                return@repeat
            }
            if (st != 200) { c.disconnect(); error("O servidor da lista respondeu $st") }
            return c.inputStream
        }
        error("Redirecionamentos demais")
    }

    companion object {
        /** Muitos provedores recusam o agente padrão do Android; este é aceito pela grande maioria. */
        const val USER_AGENT = "VLC/3.0.20 LibVLC/3.0.20"
    }
}
