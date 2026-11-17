package app.iptv.player

import android.util.Base64
import android.util.JsonReader
import android.util.JsonToken
import org.json.JSONArray
import org.json.JSONObject
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.Locale
import java.util.TreeMap

/**
 * Cliente da API "Xtream Codes" (player_api.php), o login com servidor, usuário e senha que a maioria dos provedores usa.
 * Separa TV ao vivo, filmes e séries, com capas, sinopses, temporadas e guia de programação.
 */
class Xtream(servidor: String, private val usuario: String, private val senha: String) {
    val base = normalizar(servidor)
    val endereco: String get() = base.substringAfter("://")

    fun api(acao: String? = null, extra: String = "") =
        "$base/player_api.php?username=${q(usuario)}&password=${q(senha)}" + (acao?.let { "&action=$it" } ?: "") + extra

    fun urlAoVivo(id: String, ext: String) = "$base/live/${p(usuario)}/${p(senha)}/$id.$ext"
    fun urlFilme(id: String, ext: String) = "$base/movie/${p(usuario)}/${p(senha)}/$id.$ext"
    fun urlEpisodio(id: String, ext: String) = "$base/series/${p(usuario)}/${p(senha)}/$id.$ext"

    /** Confere o login e devolve a resposta (guardada para mostrar validade e telas). */
    fun loginTexto(): String {
        val t = try { Http.texto(api()) } catch (e: Http.Status) {
            if (e.codigo in 401..403) error("Usuário ou senha recusados pelo servidor (ou assinatura vencida).") else throw e
        }
        val o = try { JSONObject(t) } catch (_: Exception) {
            error("O endereço não respondeu como um servidor IPTV com login (Xtream). Confira o servidor e a porta.")
        }
        val u = o.optJSONObject("user_info") ?: error("Usuário ou senha recusados pelo servidor.")
        if (u.optString("auth") != "1") error("Usuário ou senha recusados pelo servidor.")
        val st = u.s("status")
        if (st != null && !st.equals("Active", true)) error("A assinatura não está ativa (situação no servidor: $st).")
        return t
    }

    fun filme(id: String): FichaFilme = lerFilme(Http.texto(api("get_vod_info", "&vod_id=$id")))
    fun serie(id: String): FichaSerie = lerSerie(Http.texto(api("get_series_info", "&series_id=$id")), ::urlEpisodio)
    fun epgCurto(id: String): List<Programa> = lerEpgCurto(Http.texto(api("get_short_epg", "&stream_id=$id&limit=12")))

    companion object {
        private fun q(s: String) = URLEncoder.encode(s, "UTF-8")
        private fun p(s: String) = if (s.matches(Regex("[A-Za-z0-9._~-]+"))) s else URLEncoder.encode(s, "UTF-8").replace("+", "%20")

        /** "servidor.com:8080", "http://servidor.com:8080/" ou com caminho → "http://servidor.com:8080". */
        fun normalizar(s: String): String {
            var t = s.trim()
            if (!t.contains("://")) t = "http://$t"
            val u = URL(t)
            return "${u.protocol}://${u.host}" + (if (u.port > 0) ":${u.port}" else "")
        }

        /** Link "get.php?username=…&password=…" (ou player_api.php) → servidor, usuário e senha. */
        fun deLink(link: String): Triple<String, String, String>? = try {
            val u = URL(link.trim())
            val caminho = u.path.lowercase()
            if (!caminho.endsWith("get.php") && !caminho.endsWith("player_api.php")) null else {
                val q = u.query.orEmpty().split('&').associate {
                    it.substringBefore('=').lowercase() to URLDecoder.decode(it.substringAfter('=', ""), "UTF-8")
                }
                val us = q["username"]; val se = q["password"]
                if (us.isNullOrBlank() || se.isNullOrBlank()) null else Triple(normalizar(link), us, se)
            }
        } catch (_: Exception) { null }

        private fun JSONObject.s(k: String): String? = optString(k).takeIf { it.isNotBlank() && it != "null" }

        private fun JsonReader.texto(): String? = when (peek()) {
            JsonToken.NULL -> { nextNull(); null }
            JsonToken.STRING, JsonToken.NUMBER -> nextString()
            JsonToken.BOOLEAN -> nextBoolean().toString()
            else -> { skipValue(); null }
        }

        private val PT = Locale.forLanguageTag("pt-BR")
        private val RX_ANO = Regex("""(19|20)\d\d""")

        fun nota(v: String?): String? = v?.replace(',', '.')?.toDoubleOrNull()?.takeIf { it > 0 }?.let { String.format(PT, "%.1f", it) }

        fun lerCategorias(r: JsonReader): Map<String, String> {
            val m = HashMap<String, String>()
            if (r.peek() != JsonToken.BEGIN_ARRAY) { r.skipValue(); return m }
            r.beginArray()
            while (r.hasNext()) {
                if (r.peek() != JsonToken.BEGIN_OBJECT) { r.skipValue(); continue }
                r.beginObject()
                var id: String? = null; var nome: String? = null
                while (r.hasNext()) when (r.nextName()) {
                    "category_id" -> id = r.texto()
                    "category_name" -> nome = r.texto()
                    else -> r.skipValue()
                }
                r.endObject()
                if (id != null && nome != null) m[id] = nome.trim()
            }
            r.endArray()
            return m
        }

        /** Lista de canais, filmes ou séries (lida aos poucos: listas de dezenas de milhares de itens). */
        fun lerLista(r: JsonReader, tipo: Tipo, cats: Map<String, String>, url: (String, String?) -> String): List<Item> {
            val out = ArrayList<Item>()
            if (r.peek() != JsonToken.BEGIN_ARRAY) { r.skipValue(); return out }
            r.beginArray()
            while (r.hasNext()) {
                if (r.peek() != JsonToken.BEGIN_OBJECT) { r.skipValue(); continue }
                r.beginObject()
                var nome = ""; var id: String? = null; var logo: String? = null; var epg: String? = null; var cat: String? = null
                var adulto = false; var nota: String? = null; var ext: String? = null; var num = 0; var ano: String? = null
                while (r.hasNext()) when (r.nextName()) {
                    "name" -> nome = r.texto().orEmpty()
                    "stream_id", "series_id" -> id = r.texto()
                    "stream_icon", "cover" -> r.texto()?.takeIf { it.isNotBlank() }?.let { logo = it }
                    "epg_channel_id" -> epg = r.texto()
                    "category_id" -> r.texto()?.let { if (cat == null) cat = it }
                    "category_ids" -> if (r.peek() == JsonToken.BEGIN_ARRAY) {
                        r.beginArray(); while (r.hasNext()) { val v = r.texto(); if (cat == null) cat = v }; r.endArray()
                    } else r.skipValue()
                    "is_adult" -> adulto = r.texto().let { it == "1" || it == "true" }
                    "rating" -> nota = r.texto()
                    "container_extension" -> ext = r.texto()
                    "num" -> num = r.texto()?.toDoubleOrNull()?.toInt() ?: 0
                    "year" -> ano = r.texto()
                    "releaseDate", "release_date", "releasedate" -> r.texto()?.take(4)?.let { if (ano.isNullOrBlank()) ano = it }
                    else -> r.skipValue()
                }
                r.endObject()
                val i = id ?: continue
                out += Item(
                    tipo = tipo, nome = nome.trim(), url = url(i, ext?.takeIf { it.isNotBlank() }),
                    grupo = cats[cat] ?: "Sem categoria", logo = logo, tvgId = epg?.takeIf { it.isNotBlank() }, id = i,
                    ano = ano?.takeIf { RX_ANO.matches(it) } ?: Regex("""\(((19|20)\d\d)\)""").find(nome)?.groupValues?.get(1),
                    nota = nota(nota), adulto = adulto, num = num,
                )
            }
            r.endArray()
            return out
        }

        fun lerConta(t: String): Conta {
            val u = JSONObject(t).optJSONObject("user_info") ?: return Conta(null, null, null, null, emptyList())
            val fmts = u.optJSONArray("allowed_output_formats")
            return Conta(
                status = u.s("status"),
                validade = u.s("exp_date")?.toLongOrNull()?.takeIf { it > 0 }?.times(1000),
                conexoes = u.s("max_connections"), ativas = u.s("active_cons"),
                formatos = if (fmts == null) emptyList() else (0 until fmts.length()).map { fmts.optString(it).lowercase() },
            )
        }

        private fun info(o: JSONObject): JSONObject? = o.opt("info") as? JSONObject

        fun lerFilme(t: String): FichaFilme {
            val i = info(JSONObject(t)) ?: JSONObject()
            return FichaFilme(
                sinopse = i.s("plot") ?: i.s("description"), genero = i.s("genre"),
                ano = (i.s("releasedate") ?: i.s("release_date") ?: i.s("year"))?.take(4)?.takeIf { RX_ANO.matches(it) },
                duracao = i.s("duration"), nota = nota(i.s("rating")), capa = i.s("movie_image") ?: i.s("cover_big"),
                elenco = i.s("cast") ?: i.s("actors"), diretor = i.s("director"),
            )
        }

        fun lerSerie(t: String, url: (String, String) -> String): FichaSerie {
            val o = JSONObject(t)
            val i = info(o) ?: JSONObject()
            val mapa = TreeMap<Int, MutableList<Episodio>>()
            fun add(e: JSONObject?, chave: Int?) {
                e ?: return
                val id = e.s("id") ?: return
                val temp = e.optInt("season", chave ?: 1)
                val n = e.optInt("episode_num", 0)
                val inf = e.opt("info") as? JSONObject
                mapa.getOrPut(temp) { mutableListOf() } += Episodio(
                    id = id, temporada = temp, numero = n, titulo = e.s("title") ?: "Episódio $n",
                    url = url(id, e.s("container_extension") ?: "mp4"),
                    duracao = inf?.s("duration"), sinopse = inf?.s("plot"), imagem = inf?.s("movie_image"),
                )
            }
            when (val eps = o.opt("episodes")) {
                is JSONObject -> eps.keys().forEach { k ->
                    eps.optJSONArray(k)?.let { a -> for (j in 0 until a.length()) add(a.optJSONObject(j), k.toIntOrNull()) }
                }
                is JSONArray -> for (j in 0 until eps.length()) when (val v = eps.opt(j)) {
                    is JSONArray -> for (k in 0 until v.length()) add(v.optJSONObject(k), null)
                    is JSONObject -> add(v, null)
                }
            }
            mapa.values.forEach { l -> l.sortBy { it.numero } }
            return FichaSerie(
                sinopse = i.s("plot"), genero = i.s("genre"),
                ano = (i.s("releaseDate") ?: i.s("release_date") ?: i.s("year"))?.take(4)?.takeIf { RX_ANO.matches(it) },
                nota = nota(i.s("rating")), capa = i.s("cover"), elenco = i.s("cast"), episodios = mapa,
            )
        }

        private fun b64(s: String?): String {
            if (s.isNullOrBlank()) return ""
            return try { String(Base64.decode(s, Base64.DEFAULT), Charsets.UTF_8).trim() } catch (_: Exception) { s }
        }

        fun lerEpgCurto(t: String): List<Programa> {
            val a = JSONObject(t).optJSONArray("epg_listings") ?: return emptyList()
            return (0 until a.length()).mapNotNull { k ->
                val e = a.optJSONObject(k) ?: return@mapNotNull null
                val ini = e.s("start_timestamp")?.toLongOrNull() ?: return@mapNotNull null
                val fim = (e.s("stop_timestamp") ?: e.s("end_timestamp"))?.toLongOrNull() ?: return@mapNotNull null
                Programa(ini * 1000, fim * 1000, b64(e.s("title")), b64(e.s("description")))
            }.sortedBy { it.inicio }
        }
    }
}
