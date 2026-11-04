package br.com.nervia.midia

import org.json.JSONArray
import org.json.JSONObject

/** Um arquivo da playlist, como a função midia-tv entrega. */
data class Item(
    val id: String,              // id do arquivo no Google Drive
    val nome: String,
    val tipo: String,            // "video" | "imagem"
    val md5: String,
    val tamanho: Long,
    val tempoS: Int?,            // imagens: segundos na tela
    val url: String,             // download pela API do Drive (sem a chave)
    val chaveRecurso: String?,   // resource key de pastas antigas
) {
    /** Nome do arquivo no aparelho: muda quando o conteúdo muda (md5), então arquivo trocado é baixado de novo. */
    val arquivo: String
        get() {
            val ext = nome.substringAfterLast('.', "").lowercase().takeIf { it.matches(Regex("[a-z0-9]{2,4}")) }
                ?: if (tipo == "video") "mp4" else "img"
            val marca = md5.ifBlank { tamanho.toString() }.filter { it.isLetterOrDigit() }.take(32)
            return "${id.filter { it.isLetterOrDigit() || it == '_' || it == '-' }}_$marca.$ext"
        }
}

data class Playlist(
    val tela: String,
    val playlist: String,
    val itens: List<Item>,
    val conteudo: String,        // muda quando qualquer arquivo, ordem ou tempo muda
    val chaveApi: String,
    val intervaloPlaylistS: Int,
    val intervaloSinalS: Int,
    val rotacao: Int,            // graus no sentido horário: 0, 90, 180, 270 (posição da TV, escolhida no painel)
) {
    companion object {
        fun deJson(j: JSONObject): Playlist {
            val arr = j.optJSONArray("itens") ?: JSONArray()
            val itens = (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                Item(
                    id = o.getString("id"), nome = o.optString("nome"), tipo = o.optString("tipo"), md5 = o.optString("md5"),
                    tamanho = o.optLong("tamanho"), tempoS = if (o.isNull("tempo_s")) null else o.optInt("tempo_s"),
                    url = o.getString("url"), chaveRecurso = o.optString("chave_recurso").takeIf { it.isNotBlank() && it != "null" },
                )
            }.filter { it.tipo == "video" || it.tipo == "imagem" }
            return Playlist(
                tela = j.optString("tela"), playlist = j.optString("playlist"), itens = itens, conteudo = j.optString("conteudo"),
                chaveApi = j.optString("chave_api"),
                intervaloPlaylistS = j.optInt("intervalo_playlist_s", 300).coerceIn(20, 3600),
                intervaloSinalS = j.optInt("intervalo_sinal_s", 180).coerceIn(60, 3600),
                rotacao = j.optInt("rotacao", 0).let { if (it in listOf(0, 90, 180, 270)) it else 0 },
            )
        }
    }
}

/** A TV foi desvinculada no painel (o token deixou de valer). */
class Desvinculada : Exception("TV desvinculada")
