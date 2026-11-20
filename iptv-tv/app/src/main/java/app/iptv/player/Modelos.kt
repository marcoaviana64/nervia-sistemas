package app.iptv.player

import java.text.Normalizer

/** Em que aba o conteúdo aparece. */
enum class Tipo { AO_VIVO, FILME, SERIE }

/**
 * Um canal, filme, série ou episódio.
 * Série do Xtream não tem [url] (abre a ficha com as temporadas); episódio tem [pai] = id da série.
 */
data class Item(
    val tipo: Tipo,
    val nome: String,
    val url: String,
    val grupo: String,
    val logo: String? = null,
    val tvgId: String? = null,
    val userAgent: String? = null,
    val referer: String? = null,
    val id: String? = null,
    val ano: String? = null,
    val nota: String? = null,
    val adulto: Boolean = false,
    val num: Int = 0,
    val pai: String? = null,
    val temporada: Int = 0,
) {
    /** Nome sem acento e em minúsculas, para a busca. */
    val chave: String by lazy { semAcento(nome) }
}

data class Programa(val inicio: Long, val fim: Long, val titulo: String, val descricao: String)

/** Lembrete marcado na Agenda: avisa na tela quando o programa vai começar e abre o canal ao clicar. */
data class Lembrete(
    val canal: String,      // chave da EPG do canal (Guia.chaveEpg)
    val canalNome: String,
    val url: String,        // Item.url do canal (para abrir)
    val titulo: String,
    val inicio: Long,
    val fim: Long,
)

data class Episodio(
    val id: String, val temporada: Int, val numero: Int, val titulo: String, val url: String,
    val duracao: String?, val sinopse: String?, val imagem: String?,
)

data class FichaSerie(
    val sinopse: String?, val genero: String?, val ano: String?, val nota: String?, val capa: String?,
    val elenco: String?, val episodios: Map<Int, List<Episodio>>,
)

data class FichaFilme(
    val sinopse: String?, val genero: String?, val ano: String?, val duracao: String?, val nota: String?,
    val capa: String?, val elenco: String?, val diretor: String?,
)

/** Dados da assinatura (só no login Xtream). */
data class Conta(val status: String?, val validade: Long?, val conexoes: String?, val ativas: String?, val formatos: List<String>)

data class Catalogo(val itens: List<Item>, val epgUrls: List<String>, val conta: Conta?, val atualizadoEm: Long)

fun semAcento(s: String): String =
    Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").lowercase()

/** Grupos adultos (para o controle dos pais). */
val RX_ADULTO = Regex("""adult|xxx|porn|er[oó]tic|\+ ?18|18 ?\+""", RegexOption.IGNORE_CASE)
