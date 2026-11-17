package app.iptv.player

import android.content.Context
import android.util.JsonReader
import java.io.File

/** Configuração da lista, cópia local, favoritos, posição dos filmes e preferências (tudo só no aparelho). */
class Repositorio(ctx: Context) {
    val dir: File = ctx.filesDir
    private val prefs = ctx.getSharedPreferences("iptv", Context.MODE_PRIVATE)
    private val pos = ctx.getSharedPreferences("posicoes", Context.MODE_PRIVATE)
    private val series = ctx.getSharedPreferences("series", Context.MODE_PRIVATE)

    private fun str(k: String) = prefs.getString(k, null)
    private fun put(k: String, v: String?) = prefs.edit().putString(k, v).apply()

    /** "xtream" (login e senha) ou "m3u" (link). A 1.0 só guardava o link. */
    val tipoFonte: String? get() = str("tipo") ?: if (str("url") != null) "m3u" else null
    val urlLista get() = str("url")
    val epgUrl get() = str("epg")
    val servidor get() = str("servidor")
    val usuario get() = str("usuario")
    val senha get() = str("senha")

    fun configurado() = when (tipoFonte) {
        "xtream" -> !servidor.isNullOrBlank() && !usuario.isNullOrBlank() && !senha.isNullOrBlank()
        "m3u" -> !urlLista.isNullOrBlank()
        else -> false
    }

    val xtream: Xtream? get() = if (tipoFonte == "xtream" && configurado()) Xtream(servidor!!, usuario!!, senha!!) else null

    fun salvarXtream(s: String, u: String, p: String) {
        prefs.edit().putString("tipo", "xtream").putString("servidor", Xtream.normalizar(s))
            .putString("usuario", u.trim()).putString("senha", p.trim()).remove("ultimo").apply()
        limparCache()
    }

    fun salvarM3u(url: String, epg: String?) {
        prefs.edit().putString("tipo", "m3u").putString("url", url.trim()).putString("epg", epg?.trim()?.ifBlank { null })
            .remove("ultimo").apply()
        limparCache()
    }

    private val CACHE = listOf("lista.m3u", "x_conta.json", "x_cat_live.json", "x_cat_vod.json", "x_cat_series.json",
        "x_live.json", "x_vod.json", "x_series.json", "guia.dat")

    fun limparCache() = CACHE.forEach { File(dir, it).delete() }
    fun limparCacheGuia() { File(dir, "guia.dat").delete() }

    private fun marcador() = File(dir, if (tipoFonte == "xtream") "x_live.json" else "lista.m3u")
    fun temCopia() = marcador().let { it.exists() && it.length() > 0 }
    fun copiaVelha(horas: Int = 24) = !temCopia() || System.currentTimeMillis() - marcador().lastModified() > horas * 3_600_000L

    var ultimoCanal: String?
        get() = str("ultimo")
        set(v) = put("ultimo", v)

    /** Formato dos canais ao vivo no login Xtream: "ts" (padrão) ou "m3u8" (HLS). */
    var formatoAoVivo: String
        get() = str("formato") ?: "ts"
        set(v) = put("formato", v)

    var pin: String?
        get() = str("pin")
        set(v) = put("pin", v)

    var idiomaAudio: String?
        get() = str("idioma_audio")
        set(v) = put("idioma_audio", v)

    /** Idioma da legenda preferida; "off" = desligada. */
    var idiomaLegenda: String?
        get() = str("idioma_legenda")
        set(v) = put("idioma_legenda", v)

    var formatoTela: Int
        get() = prefs.getInt("formato_tela", 0)
        set(v) = prefs.edit().putInt("formato_tela", v).apply()

    fun chave(i: Item) = i.url.ifBlank { "serie:${i.id}" }

    var favoritos: Set<String>
        get() = prefs.getStringSet("favoritos", emptySet())!!.toSet()
        set(v) = prefs.edit().putStringSet("favoritos", v).apply()

    fun alternarFavorito(i: Item): Boolean {
        val k = chave(i)
        val f = favoritos.toMutableSet()
        val agora = if (k in f) { f.remove(k); false } else { f.add(k); true }
        favoritos = f
        return agora
    }

    // ---------------------------------------------------------------- continuar assistindo

    /** Posição salva (ms) e duração (ms) de um filme ou episódio. */
    fun posicao(url: String): Pair<Long, Long>? = pos.getString(url, null)?.split(';')?.let {
        val p = it.getOrNull(0)?.toLongOrNull(); val d = it.getOrNull(1)?.toLongOrNull()
        if (p == null || d == null) null else p to d
    }

    fun salvarPosicao(url: String, p: Long, d: Long) {
        pos.edit().putString(url, "$p;$d;${System.currentTimeMillis()}").apply()
        val todos = pos.all
        if (todos.size > 400) {
            val velhos = todos.entries.sortedBy { (it.value as? String)?.split(';')?.getOrNull(2)?.toLongOrNull() ?: 0 }.take(80)
            pos.edit().apply { velhos.forEach { remove(it.key) } }.apply()
        }
    }

    /** Começado (mais de 1 min) e não terminado (menos de 95%), do mais recente para o mais antigo. */
    fun recentes(): List<String> = pos.all.mapNotNull { (k, v) ->
        val c = (v as? String)?.split(';') ?: return@mapNotNull null
        val p = c.getOrNull(0)?.toLongOrNull() ?: 0; val d = c.getOrNull(1)?.toLongOrNull() ?: 0
        val q = c.getOrNull(2)?.toLongOrNull() ?: 0
        if (p > 60_000 && d > 0 && p < d * 95 / 100) k to q else null
    }.sortedByDescending { it.second }.map { it.first }

    fun marcarSerie(id: String, temporada: Int, ep: String) =
        series.edit().putString(id, "$temporada;$ep;${System.currentTimeMillis()}").apply()

    fun serieUltimo(id: String): Pair<Int, String>? = series.getString(id, null)?.split(';')?.let {
        val t = it.getOrNull(0)?.toIntOrNull(); val e = it.getOrNull(1)
        if (t == null || e == null) null else t to e
    }

    fun seriesRecentes(): List<String> = series.all.mapNotNull { (k, v) ->
        (v as? String)?.split(';')?.getOrNull(2)?.toLongOrNull()?.let { k to it }
    }.sortedByDescending { it.second }.map { it.first }

    fun limparContinuar() { pos.edit().clear().apply(); series.edit().clear().apply() }

    // ---------------------------------------------------------------- carregar a lista

    /** Bloqueante (chamar fora da thread da tela). [baixar] = buscar no servidor; senão usa a cópia do aparelho. */
    fun carregar(baixar: Boolean, progresso: (String) -> Unit): Catalogo {
        val x = xtream
        val b = baixar || !temCopia()
        return if (x != null) carregarXtream(x, b, progresso) else carregarM3u(b, progresso)
    }

    private fun carregarM3u(baixar: Boolean, progresso: (String) -> Unit): Catalogo {
        val arq = File(dir, "lista.m3u")
        if (baixar) {
            progresso("Baixando a lista…")
            val novo = File(dir, "lista.novo")
            Http.salvar(urlLista ?: error("Nenhuma lista configurada"), novo)
            val ok = novo.bufferedReader().use { M3u.ler(it) }.itens.isNotEmpty()
            if (!ok) { novo.delete(); error("A lista veio vazia ou não está no formato M3U") }
            arq.delete(); novo.renameTo(arq)
            arq.setLastModified(System.currentTimeMillis())
        }
        progresso("Abrindo a lista…")
        val l = arq.bufferedReader(Charsets.UTF_8).use { M3u.ler(it) }
        return Catalogo(l.itens, listOfNotNull(epgUrl) + l.epg, null, arq.lastModified())
    }

    private fun carregarXtream(x: Xtream, baixar: Boolean, progresso: (String) -> Unit): Catalogo {
        if (baixar) {
            progresso("Conferindo o login…")
            File(dir, "x_conta.json").writeText(x.loginTexto())
            progresso("Baixando as categorias…")
            listOf("get_live_categories" to "x_cat_live.json", "get_vod_categories" to "x_cat_vod.json",
                "get_series_categories" to "x_cat_series.json").forEach { (a, n) ->
                try { Http.salvar(x.api(a), File(dir, n)) } catch (_: Exception) {}
            }
            // filmes e séries são opcionais: se falharem, fica a cópia anterior
            progresso("Baixando os filmes…")
            try { Http.salvar(x.api("get_vod_streams"), File(dir, "x_vod.json")) } catch (_: Exception) {}
            progresso("Baixando as séries…")
            try { Http.salvar(x.api("get_series"), File(dir, "x_series.json")) } catch (_: Exception) {}
            progresso("Baixando os canais…")
            Http.salvar(x.api("get_live_streams"), File(dir, "x_live.json"))
        }
        progresso("Abrindo a lista…")
        val conta = File(dir, "x_conta.json").takeIf { it.exists() }?.let { Xtream.lerConta(it.readText()) }
        var ext = formatoAoVivo
        val fmts = conta?.formatos.orEmpty()
        if (fmts.isNotEmpty() && ext !in fmts) ext = if ("ts" in fmts) "ts" else "m3u8"
        fun cats(n: String) = File(dir, n).takeIf { it.exists() }?.let { f ->
            try { f.bufferedReader().use { Xtream.lerCategorias(JsonReader(it)) } } catch (_: Exception) { emptyMap() }
        } ?: emptyMap()
        fun lista(n: String, tipo: Tipo, c: Map<String, String>, url: (String, String?) -> String): List<Item> =
            File(dir, n).takeIf { it.exists() }?.let { f ->
                try { f.bufferedReader().use { Xtream.lerLista(JsonReader(it), tipo, c, url) } }
                catch (e: Exception) { if (tipo == Tipo.AO_VIVO) throw e else emptyList() }
            } ?: emptyList()
        val itens = ArrayList<Item>()
        itens += lista("x_live.json", Tipo.AO_VIVO, cats("x_cat_live.json")) { id, _ -> x.urlAoVivo(id, ext) }
        itens += lista("x_vod.json", Tipo.FILME, cats("x_cat_vod.json")) { id, e -> x.urlFilme(id, e ?: "mp4") }
        itens += lista("x_series.json", Tipo.SERIE, cats("x_cat_series.json")) { _, _ -> "" }
        if (itens.isEmpty()) error("O servidor não devolveu nenhum canal, filme ou série")
        return Catalogo(itens, emptyList(), conta, File(dir, "x_live.json").lastModified())
    }
}
