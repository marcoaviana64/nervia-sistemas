package app.iptv.player

import java.io.BufferedReader

data class ListaM3u(val itens: List<Item>, val epg: List<String>)

/**
 * Leitor de listas M3U / M3U8 "estendidas" (formato usado pelos provedores IPTV):
 * ```
 * #EXTM3U url-tvg="http://guia.xml"
 * #EXTINF:-1 tvg-id="x" tvg-logo="http://..." group-title="Esportes",Nome do canal
 * #EXTVLCOPT:http-user-agent=...
 * http://servidor/canal.ts
 * ```
 * Também aceita `#EXTGRP:` e cabeçalhos no estilo Kodi (`url|User-Agent=...&Referer=...`).
 * Filmes e séries são separados pelo endereço (/movie/, /series/ — listas "m3u_plus") ou pela extensão do arquivo.
 */
object M3u {
    private val atributo = Regex("""([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"""")
    private val RX_SERIE = Regex("""\bs\d{1,2}\s*e\d{1,3}\b|\bserie|\btemporada|\bseason""")
    private val EXT_VIDEO = setOf("mp4", "mkv", "avi", "mov", "m4v", "wmv", "flv")

    fun tipoDe(url: String, grupo: String, nome: String): Tipo {
        val u = url.substringBefore('?').lowercase()
        if ("/movie/" in u) return Tipo.FILME
        if ("/series/" in u) return Tipo.SERIE
        if (u.substringAfterLast('.', "") in EXT_VIDEO) {
            return if (RX_SERIE.containsMatchIn(semAcento("$grupo $nome"))) Tipo.SERIE else Tipo.FILME
        }
        return Tipo.AO_VIVO
    }

    fun ler(leitor: BufferedReader): ListaM3u {
        val saida = ArrayList<Item>()
        val epg = ArrayList<String>()
        var info: String? = null
        var ua: String? = null
        var ref: String? = null
        var grupoExt: String? = null
        leitor.lineSequence().forEach { bruta ->
            val l = bruta.trim().removePrefix("\uFEFF")
            when {
                l.isEmpty() -> Unit
                l.startsWith("#EXTM3U", ignoreCase = true) -> {
                    val a = atributos(l + ",")
                    listOfNotNull(a["url-tvg"], a["x-tvg-url"]).flatMap { it.split(',') }
                        .map { it.trim() }.filter { it.startsWith("http") }.forEach { if (it !in epg) epg += it }
                }
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
                        .ifBlank { url.substringAfterLast('/').substringBefore('?') }.trim()
                    val grupo = attrs["group-title"]?.trim().takeUnless { it.isNullOrEmpty() }
                        ?: grupoExt?.takeUnless { it.isEmpty() } ?: "Sem grupo"
                    if (url.contains("://")) {
                        saida += Item(
                            tipo = tipoDe(url, grupo, nome),
                            nome = nome,
                            url = url,
                            grupo = grupo,
                            logo = attrs["tvg-logo"]?.takeUnless { it.isBlank() },
                            tvgId = attrs["tvg-id"]?.takeUnless { it.isBlank() },
                            userAgent = ua ?: attrs["user-agent"]?.takeUnless { it.isBlank() },
                            referer = ref,
                            num = attrs["tvg-chno"]?.toIntOrNull() ?: 0,
                        )
                    }
                    info = null; ua = null; ref = null; grupoExt = null
                }
            }
        }
        return ListaM3u(saida, epg)
    }

    private fun atributos(info: String): Map<String, String> {
        val cabeca = info.substring(0, posVirgula(info).let { if (it < 0) info.length else it })
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
