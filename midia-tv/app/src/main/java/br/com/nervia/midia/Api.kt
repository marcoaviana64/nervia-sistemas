package br.com.nervia.midia

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Fala com a Edge Function midia-tv (POST JSON). A chave publicável vai no cabeçalho apikey. */
object Api {
    private val URL_FUNCAO = "${BuildConfig.SUPABASE_URL}/functions/v1/midia-tv"

    fun chamar(corpo: JSONObject): Pair<Int, JSONObject> {
        val c = URL(URL_FUNCAO).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.connectTimeout = 20_000
            c.readTimeout = 60_000
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.setRequestProperty("apikey", BuildConfig.SUPABASE_CHAVE)
            c.outputStream.use { it.write(corpo.toString().toByteArray()) }
            val codigo = c.responseCode
            val texto = (if (codigo < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
            return codigo to (runCatching { JSONObject(texto) }.getOrElse { JSONObject().put("mensagem", texto.take(200)) })
        } finally {
            c.disconnect()
        }
    }

    /** Chamada com token; 401 = TV desvinculada. */
    fun comToken(acao: String, token: String, extra: JSONObject = JSONObject()): JSONObject {
        val (codigo, j) = chamar(extra.put("acao", acao).put("token", token))
        if (codigo == 401) throw Desvinculada()
        if (codigo >= 400 || !j.optBoolean("ok")) throw RuntimeException(j.optString("mensagem", "erro $codigo"))
        return j
    }
}
