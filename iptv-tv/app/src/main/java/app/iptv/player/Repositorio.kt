package app.iptv.player

import android.content.Context
import android.util.JsonReader
import org.json.JSONArray
import org.json.JSONObject
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

    // ---------------------------------------------------------------- endereço do servidor publicado pela Nervia

    /**
     * Lista de servidores mantida no site (pedido do Marco em 18/11/2026: o provedor troca o endereço de tempos em
     * tempos; ele atualiza o arquivo e os aparelhos pegam sozinhos). A última lista lida fica guardada no aparelho.
     */
    val servidoresPublicados: List<String>
        get() = str("srv_publicados")?.split('\n')?.filter { it.isNotBlank() }.orEmpty()

    /** Servidor que vem preenchido no login: o 1º da lista do site, ou o embutido no app. */
    val servidorPadrao: String get() = servidoresPublicados.firstOrNull() ?: SERVIDOR_PADRAO

    /**
     * Bloqueante. Lê a lista de servidores que o Marco mantém no painel (Supabase), para o app pegar o endereço
     * válido sem editar arquivo (2.15). Sem internet ou resposta inválida, devolve a última guardada.
     */
    fun atualizarServidores(endereco: String = urlServidores): List<String> {
        val texto = try { Http.texto(endereco, mapOf("apikey" to chaveServidores)) } catch (_: Exception) { null }
        val lista = texto?.let { try { lerServidores(it) } catch (_: Exception) { null } }.orEmpty()
        if (lista.isNotEmpty()) put("srv_publicados", lista.joinToString("\n"))
        return lista.ifEmpty { servidoresPublicados }
    }

    /** 2.6: a versão nova do app continua no nvplayer.json (bloco "versao"), que a Nervia publica a cada APK. */
    fun atualizarVersao() {
        val texto = try { Http.texto(urlVersao) } catch (_: Exception) { return }
        try { put("site_versao", org.json.JSONObject(texto).optJSONObject("versao")?.toString()) } catch (_: Exception) {}
    }

    /** Lista de servidores (Supabase) e versão (nvplayer.json) numa chamada só; devolve a lista. */
    fun atualizarDoSite(): List<String> { val l = atualizarServidores(); atualizarVersao(); return l }

    /** Versão do app publicada no site (última lida). */
    val versaoPublicada: Versao?
        get() = str("site_versao")?.let { try { Atualizador.lerVersao("{\"versao\":$it}") } catch (_: Exception) { null } }

    /** "Depois" na atualização: não pergunta de novo até esta hora. */
    var atualizacaoAdiadaAte: Long
        get() = prefs.getLong("atualizacao_adiada", 0)
        set(v) = prefs.edit().putLong("atualizacao_adiada", v).apply()

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

    /**
     * Senha do controle dos pais. Padrão "0000" (pedido do Marco em 17/11/2026: grupos adultos já começam bloqueados).
     * Desligado = "" guardado (assim o padrão não volta sozinho).
     */
    var pin: String?
        get() = if (prefs.contains("pin")) str("pin")?.ifBlank { null } else PIN_PADRAO
        set(v) = put("pin", v ?: "")

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

    // ---------------------------------------------------------------- lembretes da Agenda (2.17)

    private fun chaveLembrete(canal: String, inicio: Long) = "$canal|$inicio"

    /** Lembretes guardados (ordenados por horário de início). */
    fun lembretes(): List<Lembrete> {
        val txt = str("lembretes") ?: return emptyList()
        return try {
            val a = JSONArray(txt)
            (0 until a.length()).map { a.getJSONObject(it) }.map {
                Lembrete(it.optString("canal"), it.optString("nome"), it.optString("url"),
                    it.optString("titulo"), it.optLong("inicio"), it.optLong("fim"))
            }.sortedBy { it.inicio }
        } catch (_: Exception) { emptyList() }
    }

    private fun salvarLembretes(l: List<Lembrete>) {
        val a = JSONArray()
        l.forEach { a.put(JSONObject().put("canal", it.canal).put("nome", it.canalNome).put("url", it.url)
            .put("titulo", it.titulo).put("inicio", it.inicio).put("fim", it.fim)) }
        put("lembretes", a.toString())
    }

    fun temLembrete(canal: String, inicio: Long) = lembretes().any { it.canal == canal && it.inicio == inicio }

    /** Marca/desmarca; devolve true se ficou marcado. */
    fun alternarLembrete(l: Lembrete): Boolean {
        val atuais = lembretes().toMutableList()
        val i = atuais.indexOfFirst { it.canal == l.canal && it.inicio == l.inicio }
        return if (i >= 0) { atuais.removeAt(i); salvarLembretes(atuais); false }
        else { atuais.add(l); salvarLembretes(atuais); true }
    }

    fun removerLembrete(canal: String, inicio: Long) {
        salvarLembretes(lembretes().filterNot { it.canal == canal && it.inicio == inicio })
    }

    /** Tira os lembretes já vencidos (fim passou há mais de 1 h). */
    fun limparLembretesVelhos(agora: Long) {
        val vivos = lembretes().filter { it.fim > agora - 3_600_000L }
        if (vivos.size != lembretes().size) salvarLembretes(vivos)
    }

    fun lembreteAvisado(canal: String, inicio: Long) =
        prefs.getStringSet("lembretes_avisados", emptySet())!!.contains(chaveLembrete(canal, inicio))

    fun marcarLembreteAvisado(canal: String, inicio: Long) {
        val s = prefs.getStringSet("lembretes_avisados", emptySet())!!.toMutableSet()
        s.add(chaveLembrete(canal, inicio))
        // não deixa crescer sem limite
        val limpo = if (s.size > 200) s.toList().takeLast(150).toMutableSet() else s
        prefs.edit().putStringSet("lembretes_avisados", limpo).apply()
    }

    /** Ao remarcar um lembrete, esquece que já avisou (para poder avisar de novo). */
    fun limparAvisado(canal: String, inicio: Long) {
        val s = prefs.getStringSet("lembretes_avisados", emptySet())!!.toMutableSet()
        if (s.remove(chaveLembrete(canal, inicio))) prefs.edit().putStringSet("lembretes_avisados", s).apply()
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

    private fun carregarXtream(x0: Xtream, baixar: Boolean, progresso: (String) -> Unit): Catalogo {
        var x = x0
        if (baixar) {
            progresso("Conferindo o login…")
            val conta = try { x.loginTexto() } catch (e: java.io.IOException) {
                // Servidor não respondeu: tenta os endereços publicados pela Nervia (o provedor pode ter trocado).
                progresso("Procurando o endereço atual do servidor…")
                var achou: Pair<Xtream, String>? = null
                for (s in atualizarServidores()) {
                    val alt = try { Xtream(s, usuario!!, senha!!) } catch (_: Exception) { continue }
                    if (alt.base == x.base) continue
                    try { achou = alt to alt.loginTexto(); break } catch (_: Exception) {}
                }
                val (nx, t) = achou ?: error("Não foi possível conectar ao servidor ${x.endereco}: ${Rede.explicar(e)}. " +
                    "Os outros endereços publicados também não responderam. A internet deste local pode estar bloqueando " +
                    "o servidor, ou o provedor trocou o endereço: confira com o seu provedor e troque no campo Servidor.")
                put("servidor", nx.base)
                x = nx
                t
            }
            File(dir, "x_conta.json").writeText(conta)
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

    companion object {
        const val PIN_PADRAO = "0000"
        /** Servidor que já vem preenchido no login (pedido do Marco em 17/11/2026; o provedor troca de tempos em tempos). */
        const val SERVIDOR_PADRAO = "http://p.urldata.gy"
        /** 2.15: a lista de servidores vem do painel (Supabase), que o Marco edita sem mexer em arquivo. */
        @JvmStatic var urlServidores = "${BuildConfig.SUPABASE_URL}/rest/v1/rpc/nv_servidores_publicos"
        @JvmStatic var chaveServidores = BuildConfig.SUPABASE_CHAVE
        /** A versão nova do app continua no nvplayer.json (a Nervia publica a cada APK). Só os testes trocam. */
        @JvmStatic var urlVersao = "https://nervia.com.br/nvplayer.json"

        /** {"servidores": [...]} ou {"servidor": "..."}; só endereços válidos, sem repetir. */
        fun lerServidores(json: String): List<String> {
            val o = org.json.JSONObject(json)
            val brutos = o.optJSONArray("servidores")?.let { a -> (0 until a.length()).map { a.optString(it) } }
                ?: listOfNotNull(o.optString("servidor").ifBlank { null })
            return brutos.filter { it.isNotBlank() }
                .mapNotNull { try { Xtream.normalizar(it).takeIf { u -> u.startsWith("http") && u.substringAfter("://").isNotBlank() } } catch (_: Exception) { null } }
                .distinct()
        }
    }
}
