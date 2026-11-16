package app.iptv.player

import java.io.BufferedReader
import java.text.Normalizer

/** Um canal (ou filme/série) da lista. */
data class Canal(
    val nome: String,
    val url: String,
    val grupo: String,
    val logo: String? = null,
    val tvgId: String? = null,
    val userAgent: String? = null,
    val referer: String? = null,
) {
    /** Nome sem acento e em minúsculas, para a busca. */
    val chave: String by lazy { semAcento(nome) }
}

fun semAcento(s: String): String =
    Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").lowercase()

/**
 * Leitor de listas M3U / M3U8 "estendidas" (formato usado pelos provedores IPTV):
 * ```
 * #EXTM3U
 * #EXTINF:-1 tvg-id="x" tvg-logo="http://..." group-title="Esportes",Nome do canal
 * #EXTVLCOPT:http-user-agent=...
 * http://servidor/canal.ts
 * ```
 * Também aceita `#EXTGRP:` e cabeçalhos no estilo Kodi (`url|User-Agent=...&Referer=...`).
 */
object M3u {
    private val atributo = Regex("""([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"""")

    fun ler(leitor: BufferedReader): List<Canal> {
        val saida = ArrayList<Canal>()
        var info: String? = null
        var ua: String? = null
        var ref: String? = null
        var grupoExt: String? = null
        leitor.lineSequence().forEach { bruta ->
            val l = bruta.trim().removePrefix("\uFEFF")
            when {
                l.isEmpty() -> Unit
                l.startsWith("#EXTINF", ignoreCase = true) -> info = l
                l.startsWith("#EXTVLCOPT:", ignoreCase = true) -> {
                    val op = l.substringAfter(':')
                    val nome = op.substringBefore('=').trim().lowercase()
                    val valor = op.substringAfter('=', "").trim()
                    when (nome) {
                        "http-user-agent" -> ua = valor
                        "http-referrer", "http-referer" -> ref = valor
                    }
                }
                l.startsWith("#EXTGRP:", ignoreCase = true) -> grupoExt = l.substringAfter(':').trim()
                l.startsWith("#") -> Unit
                else -> {
                    var url = l
                    if ('|' in url) {
                        // url|User-Agent=x&Referer=y (Kodi)
                        val extras = url.substringAfter('|')
                        url = url.substringBefore('|')
                        extras.split('&').forEach { par ->
                            val k = par.substringBefore('=').trim().lowercase()
                            val v = java.net.URLDecoder.decode(par.substringAfter('=', ""), "UTF-8")
                            when (k) {
                                "user-agent" -> ua = v
                                "referer", "referrer" -> ref = v
                            }
                        }
                    }
                    val i = info
                    val attrs = if (i != null) atributos(i) else emptyMap()
                    val nome = (if (i != null) nomeDe(i) else "").ifBlank { attrs["tvg-name"].orEmpty() }
                        .ifBlank { url.substringAfterLast('/').substringBefore('?') }
                    val grupo = attrs["group-title"]?.trim().takeUnless { it.isNullOrEmpty() }
                        ?: grupoExt?.takeUnless { it.isEmpty() } ?: "Sem grupo"
                    if (url.contains("://")) {
                        saida += Canal(
                            nome = nome.trim(),
                            url = url,
                            grupo = grupo,
                            logo = attrs["tvg-logo"]?.takeUnless { it.isBlank() },
                            tvgId = attrs["tvg-id"]?.takeUnless { it.isBlank() },
                            userAgent = ua ?: attrs["user-agent"]?.takeUnless { it.isBlank() },
                            referer = ref,
                        )
                    }
                    info = null; ua = null; ref = null; grupoExt = null
                }
            }
        }
        return saida
    }

    private fun atributos(info: String): Map<String, String> {
        val cabeca = info.substring(0, posVirgula(info).coerceAtLeast(0))
        return atributo.findAll(cabeca).associate { it.groupValues[1].lowercase() to it.groupValues[2] }
    }

    /** O nome vem depois da primeira vírgula fora de aspas. */
    private fun nomeDe(info: String): String {
        val p = posVirgula(info)
        return if (p < 0) "" else info.substring(p + 1)
    }

    private fun posVirgula(info: String): Int {
        var aspas = false
        for (i in info.indices) {
            when (info[i]) {
                '"' -> aspas = !aspas
                ',' -> if (!aspas) return i
            }
        }
        return -1
    }
}
