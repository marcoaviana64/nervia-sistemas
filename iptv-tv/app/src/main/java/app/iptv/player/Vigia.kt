package app.iptv.player

/**
 * Vigia do canal ao vivo (2.10, o Marco: "trava, eu mudo de canal, volto e retorna o sinal"). O servidor da lista às
 * vezes para de mandar o vídeo sem fechar a conexão: o player fica esperando para sempre, com a imagem parada.
 * A cada conferência recebe a posição do vídeo e o total de quadros mostrados; se nenhum dos dois anda por
 * [parado] ms (ou o "Carregando…" passa de [carregando] ms), avisa que travou — e a tela reconecta o canal, como
 * a pessoa faria trocando de canal e voltando.
 */
class Vigia(private val parado: Long = 10_000, private val carregando: Long = 15_000) {
    private var pos = Long.MIN_VALUE
    private var quadros = Long.MIN_VALUE
    private var desdePos = 0L
    private var desdeQuadros = 0L
    private var temVideo = false

    fun reiniciar(agora: Long) {
        pos = Long.MIN_VALUE; quadros = Long.MIN_VALUE; temVideo = false
        desdePos = agora; desdeQuadros = agora
    }

    /**
     * [tocando] = deve estar tocando (não pausado); [pronto] = player em READY; [quadrosMostrados] = -1 se não há
     * vídeo (rádio). Devolve true quando travou (e já recomeça a contagem).
     */
    fun conferir(agora: Long, tocando: Boolean, pronto: Boolean, posicao: Long, quadrosMostrados: Long): Boolean {
        if (!tocando) { reiniciar(agora); return false }
        // a primeira leitura não conta como "andou" (a contagem vale desde o reiniciar, quando o canal abriu)
        if (posicao != pos) { if (pos != Long.MIN_VALUE) desdePos = agora; pos = posicao }
        if (quadrosMostrados >= 0) {
            if (quadrosMostrados != quadros) {
                if (quadros != Long.MIN_VALUE) temVideo = true
                quadros = quadrosMostrados; desdeQuadros = agora
            }
        }
        val travou = if (!pronto) agora - desdePos > carregando
            else agora - desdePos > parado || (temVideo && agora - desdeQuadros > parado)
        if (travou) reiniciar(agora)
        return travou
    }
}
