package app.iptv.player

import android.os.Handler
import android.os.Looper
import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.BufferedInputStream
import java.io.File
import java.io.InputStream
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.zip.GZIPInputStream

/** Leitor de guia XMLTV (o formato de guia das listas M3U). Guarda só os canais da lista e só a janela pedida. */
object Xmltv {
    fun abrir(arq: File): InputStream {
        val e = BufferedInputStream(arq.inputStream())
        e.mark(2)
        val a = e.read(); val b = e.read()
        e.reset()
        return if (a == 0x1f && b == 0x8b) GZIPInputStream(e) else e
    }

    fun ler(ent: InputStream, ids: Set<String>?, de: Long, ate: Long): Map<String, List<Programa>> {
        val comFuso = SimpleDateFormat("yyyyMMddHHmmssZ", Locale.US)
        val utc = SimpleDateFormat("yyyyMMddHHmmss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        fun data(s: String?): Long? {
            val t = s?.trim() ?: return null
            if (t.length < 14) return null
            val fuso = t.substring(14).trim()
            return try {
                if (Regex("[+-]\\d{4}").matches(fuso)) comFuso.parse(t.take(14) + fuso)?.time else utc.parse(t.take(14))?.time
            } catch (_: Exception) { null }
        }
        val p = Xml.newPullParser()
        p.setInput(ent, null)
        val out = HashMap<String, MutableList<Programa>>()
        var canal: String? = null; var ini = 0L; var fim = 0L
        var titulo: String? = null; var desc: String? = null; var dentro = false
        var ev = p.eventType
        while (ev != XmlPullParser.END_DOCUMENT) {
            if (ev == XmlPullParser.START_TAG) when (p.name) {
                "programme" -> {
                    canal = p.getAttributeValue(null, "channel")?.trim()?.lowercase()
                    ini = data(p.getAttributeValue(null, "start")) ?: 0
                    fim = data(p.getAttributeValue(null, "stop")) ?: 0
                    titulo = null; desc = null
                    dentro = canal != null && (ids == null || canal in ids) && fim > de && ini < ate && fim > ini
                }
                "title" -> if (dentro && titulo == null) titulo = p.nextText()
                "desc" -> if (dentro && desc == null) desc = p.nextText()
            } else if (ev == XmlPullParser.END_TAG && p.name == "programme" && dentro) {
                out.getOrPut(canal!!) { mutableListOf() } += Programa(ini, fim, titulo.orEmpty().trim(), desc.orEmpty().trim())
                dentro = false
            }
            ev = p.next()
        }
        out.values.forEach { l -> l.sortBy { it.inicio } }
        return out
    }
}

/**
 * Guia de programação. Login Xtream: pergunta ao servidor canal a canal (rápido e sempre certo).
 * Lista M3U: baixa o XMLTV indicado na lista (ou o informado na configuração) a cada 12 h.
 */
class Guia(private val repo: Repositorio) {
    private val rede = Executors.newFixedThreadPool(2)
    private val tela = Handler(Looper.getMainLooper())
    @Volatile private var xmltv: Map<String, List<Programa>> = emptyMap()
    private val curto = ConcurrentHashMap<String, Pair<Long, List<Programa>>>()
    private var xtream: Xtream? = null
    @Volatile var situacao = "sem guia"; private set
    var aoAtualizar: (() -> Unit)? = null

    fun chaveEpg(i: Item) = (i.tvgId ?: i.nome).trim().lowercase()
    private fun agoraMs() = System.currentTimeMillis()

    fun preparar(c: Catalogo) {
        xtream = repo.xtream
        curto.clear()
        if (xtream != null) { situacao = "pelo servidor da lista (canal a canal)"; return }
        val urls = c.epgUrls
        if (urls.isEmpty()) { xmltv = emptyMap(); situacao = "a lista não informa guia (dá para informar em Trocar lista)"; return }
        val ids = c.itens.filter { it.tipo == Tipo.AO_VIVO }.mapTo(HashSet()) { chaveEpg(it) }
        situacao = "carregando…"
        rede.execute {
            try {
                val arq = File(repo.dir, "guia.dat")
                if (!arq.exists() || agoraMs() - arq.lastModified() > 12 * 3_600_000L) {
                    var erro: Exception? = null
                    val ok = urls.any { u -> try { Http.salvar(u, arq); true } catch (e: Exception) { erro = e; false } }
                    if (!ok && !arq.exists()) throw erro ?: IllegalStateException("guia indisponível")
                }
                val m = Xmltv.abrir(arq).use { Xmltv.ler(it, ids, agoraMs() - 3 * 3_600_000L, agoraMs() + 48 * 3_600_000L) }
                xmltv = m
                situacao = "carregado (${m.size} canais com programação)"
            } catch (e: Exception) {
                situacao = "não carregou (${e.message ?: e.javaClass.simpleName})"
            }
            tela.post { aoAtualizar?.invoke() }
        }
    }

    private fun futuros(l: List<Programa>): List<Programa> { val n = agoraMs(); return l.filter { it.fim > n } }

    /** Só o que já está na memória (para as linhas da lista). */
    fun agora(i: Item): Programa? {
        if (i.tipo != Tipo.AO_VIVO) return null
        val l = if (xtream != null) i.id?.let { curto[it]?.second } else xmltv[chaveEpg(i)]
        val n = agoraMs()
        return l?.firstOrNull { n >= it.inicio && n < it.fim }
    }

    fun programas(i: Item, cb: (List<Programa>) -> Unit) {
        if (i.tipo != Tipo.AO_VIVO) return cb(emptyList())
        val x = xtream ?: return cb(futuros(xmltv[chaveEpg(i)].orEmpty()))
        val id = i.id ?: return cb(emptyList())
        curto[id]?.let { (t, l) -> if (agoraMs() - t < 10 * 60_000L) return cb(futuros(l)) }
        rede.execute {
            val l = try { x.epgCurto(id) } catch (_: Exception) { emptyList() }
            curto[id] = agoraMs() to l
            tela.post { cb(futuros(l)) }
        }
    }

    // ---------------------------------------------------------------- Agenda (2.17): guia completo de vários dias

    /** Grade completa por canal (chaveEpg → programas), vários dias. Só depois de [agenda]. */
    @Volatile var cheia: Map<String, List<Programa>> = emptyMap(); private set
    @Volatile var agendaSituacao = ""; private set

    /** Programas (em andamento e futuros) de um canal, da grade completa. */
    fun daAgenda(i: Item): List<Programa> = if (i.tipo == Tipo.AO_VIVO) cheia[chaveEpg(i)].orEmpty() else emptyList()

    /**
     * Carrega a grade completa para a aba Agenda. Login Xtream: baixa o XMLTV de toda a grade (xmltv.php,
     * uma vez a cada 6 h; nem todo provedor fornece). Lista M3U: usa o mesmo XMLTV da lista, janela mais larga.
     * Devolve cb(null) quando deu certo, ou cb(texto do problema) quando não há grade.
     */
    fun agenda(c: Catalogo, forcar: Boolean, cb: (String?) -> Unit) {
        xtream = repo.xtream
        val ids = c.itens.filter { it.tipo == Tipo.AO_VIVO }.mapTo(HashSet()) { chaveEpg(it) }
        agendaSituacao = "carregando…"
        rede.execute {
            try {
                val x = xtream
                val arq = if (x != null) File(repo.dir, "agenda.xml") else File(repo.dir, "guia.dat")
                val precisa = forcar || !arq.exists() || agoraMs() - arq.lastModified() > 6 * 3_600_000L
                if (x != null) {
                    if (precisa) Http.salvar(x.urlXmltv(), arq)
                } else if (!arq.exists()) {
                    val urls = c.epgUrls
                    if (urls.isEmpty()) { cheia = emptyMap(); agendaSituacao = "a lista não informa guia"; tela.post { cb(agendaSituacao) }; return@execute }
                    if (!urls.any { u -> try { Http.salvar(u, arq); true } catch (_: Exception) { false } })
                        throw IllegalStateException("guia indisponível")
                }
                val m = Xmltv.abrir(arq).use { Xmltv.ler(it, ids, agoraMs() - 6 * 3_600_000L, agoraMs() + 9 * 24 * 3_600_000L) }
                cheia = m
                val vazio = m.values.all { it.isEmpty() }
                agendaSituacao = if (vazio) "o seu provedor não forneceu a grade de programação" else "ok"
                tela.post { cb(if (vazio) agendaSituacao else null) }
            } catch (e: Exception) {
                agendaSituacao = "não carregou (${e.message ?: e.javaClass.simpleName})"
                tela.post { cb(agendaSituacao) }
            }
        }
    }
}
