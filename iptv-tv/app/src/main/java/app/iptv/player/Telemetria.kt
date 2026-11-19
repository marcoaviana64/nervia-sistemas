package app.iptv.player

import android.content.Context
import android.os.Build
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Resumo de uso para o painel da Nervia (2.12, pedido do Marco em 19/11/2026: quem usa, o que assiste, mais
 * assistidos, aparelho, lista e validade — "cuidado para não sobrecarregar o tráfego").
 *
 * O que foi assistido é SOMADO aqui no aparelho (item × dia, em segundos) e vai num POST pequeno só ao abrir, a cada
 * [INTERVALO] com o app aberto e ao sair, para a rpc `nv_sinal` do Supabase (chave publicável, como o Monitor de
 * Links). Nunca manda a senha da lista. Se o envio falhar, o resumo fica guardado e vai no próximo.
 */
class Telemetria(ctx: Context, private val url: String, private val chave: String, private val agora: () -> Long = System::currentTimeMillis) {
    companion object {
        const val INTERVALO = 30 * 60_000L
        /** Nos testes: servidor imitado no lugar do Supabase. */
        @JvmStatic var destino: String? = null
        private val JSON = "application/json".toMediaType()
    }

    private val prefs = ctx.getSharedPreferences("telemetria", Context.MODE_PRIVATE)
    val id: String = prefs.getString("id", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("id", it).apply() }
    private val dia = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("America/Sao_Paulo") }

    /** chave "dia|tipo|nome" → [grupo, segundos, vezes] */
    private val soma = LinkedHashMap<String, Triple<String, Long, Int>>()
    private var ultimoEnvio = 0L

    init { carregar() }

    private fun tipo(t: Tipo) = when (t) { Tipo.AO_VIVO -> "vivo"; Tipo.FILME -> "filme"; Tipo.SERIE -> "serie" }

    @Synchronized private fun somar(t: Tipo, nome: String, grupo: String, seg: Long, vezes: Int) {
        if (nome.isBlank()) return
        val k = "${dia.format(Date(agora()))}|${tipo(t)}|${nome.take(120)}"
        val (_, s, v) = soma[k] ?: Triple(grupo, 0L, 0)
        soma[k] = Triple(grupo.take(80), s + seg, v + vezes)
    }

    /** Abriu um canal, filme ou episódio (conta "vezes"). */
    fun abriu(t: Tipo, nome: String, grupo: String) = somar(t, nome, grupo, 0, 1)

    /** Passaram [seg] segundos com o vídeo tocando. */
    fun tocando(t: Tipo, nome: String, grupo: String, seg: Long) = somar(t, nome, grupo, seg, 0)

    @Synchronized fun pendentes(): Int = soma.size

    /** Monta o resumo (só o que tem tempo ou abertura). */
    @Synchronized fun montar(info: JSONObject): JSONObject {
        val sessoes = JSONArray()
        soma.entries.take(300).forEach { (k, v) ->
            val p = k.split('|', limit = 3)
            if (v.second > 0 || v.third > 0) sessoes.put(JSONObject().put("dia", p[0]).put("tipo", p[1]).put("nome", p[2])
                .put("grupo", v.first).put("s", v.second.coerceAtMost(86_400)).put("vezes", v.third))
        }
        return JSONObject(info.toString()).put("id", id)
            .put("modelo", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
            .put("android", Build.VERSION.RELEASE ?: "")
            .put("sessoes", sessoes)
    }

    /** Hora de mandar? (no máximo 1 a cada [INTERVALO], salvo [forcar]). */
    fun hora(forcar: Boolean) = forcar || agora() - ultimoEnvio >= INTERVALO

    /**
     * Manda (chamar FORA da thread da tela). Em caso de sucesso, tira do acumulado só o que foi enviado (o que somou
     * durante o envio fica para o próximo).
     */
    fun enviar(info: JSONObject): Boolean {
        val corpo: JSONObject
        val enviado: Map<String, Triple<String, Long, Int>>
        synchronized(this) { corpo = montar(info); enviado = HashMap(soma) }
        ultimoEnvio = agora()
        val ok = try {
            cliente.newCall(Request.Builder().url("$url/rest/v1/rpc/nv_sinal")
                .header("apikey", chave).header("Content-Type", "application/json")
                .post(JSONObject().put("p", corpo).toString().toRequestBody(JSON)).build()).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
        synchronized(this) {
            if (ok) enviado.forEach { (k, v) ->
                val atual = soma[k] ?: return@forEach
                val s = atual.second - v.second; val n = atual.third - v.third
                if (s <= 0 && n <= 0) soma.remove(k) else soma[k] = Triple(atual.first, s.coerceAtLeast(0), n.coerceAtLeast(0))
            }
            guardar()
        }
        return ok
    }

    /** Guarda o acumulado (para não perder se o app for fechado antes de mandar). */
    @Synchronized fun guardar() {
        val a = JSONArray()
        soma.forEach { (k, v) -> a.put(JSONArray().put(k).put(v.first).put(v.second).put(v.third)) }
        prefs.edit().putString("soma", a.toString()).apply()
    }

    private fun carregar() {
        try {
            val a = JSONArray(prefs.getString("soma", "[]"))
            for (i in 0 until a.length()) a.getJSONArray(i).let { soma[it.getString(0)] = Triple(it.getString(1), it.getLong(2), it.getInt(3)) }
        } catch (_: Exception) {}
    }

    private val cliente by lazy {
        OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
    }
}
