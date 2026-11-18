package br.com.nervia.midia

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import java.util.TimeZone
import java.util.UUID

/**
 * Tempo de tela (pedido do Marco em 18/11/2026: relatório mensal ao cliente de quanto tempo cada mídia apareceu em cada TV).
 * Cada exibição (mídia, início, segundos que ficou DE FATO na tela, com o app à vista) é anotada numa linha do arquivo
 * `pendentes.jsonl`, também sem internet. **Envio diário** (decisão do Marco em 18/11/2026, para não gerar uma chamada à função
 * a cada sinal): só vão as exibições que começaram ANTES de hoje (dia de Brasília); as de hoje ficam no aparelho até o dia
 * seguinte. Assim a TV chama o servidor uma vez por dia, no primeiro sinal depois da meia-noite (ou quando a internet voltar).
 * Para mandar, as linhas dos dias anteriores viram arquivos de lote (`lote-<uuid>.jsonl`, até
 * [POR_LOTE] linhas): o mesmo lote é reenviado com o mesmo código até o servidor confirmar, e o servidor não conta um lote
 * duas vezes (mi_tv_exibicoes). Exibição com menos de 1 s não conta. Se a TV ficar muito tempo sem internet, os lotes
 * mais antigos saem quando passam de [LIMITE_BYTES] (o servidor também ignora o que tem mais de 60 dias).
 */
class Exibicoes(private val pasta: File, private val agora: () -> Long = System::currentTimeMillis,
                private val relogio: () -> Long = { android.os.SystemClock.elapsedRealtime() }) {
    private val pendentes = File(pasta, "pendentes.jsonl")
    private val trava = Any()
    private var item: Item? = null
    private var inicio = 0L      // hora do início (ms desde 1970), vai para o relatório
    private var marco = 0L       // relógio que não volta atrás (elapsedRealtime), para medir a duração

    init { pasta.mkdirs() }

    /** A mídia apareceu na tela (fecha a anterior, se houver). */
    fun iniciar(i: Item) {
        fechar()
        synchronized(trava) { item = i; inicio = agora(); marco = relogio() }
    }

    /** A mídia saiu da tela (próxima, tela de espera, app escondido). */
    fun fechar() = synchronized(trava) {
        val i = item ?: return@synchronized
        item = null
        val seg = (relogio() - marco) / 1000.0
        if (seg < 1 || seg > 86_400) return@synchronized
        val linha = JSONObject().put("id", i.id).put("nome", i.nome).put("tipo", i.tipo).put("inicio", inicio)
            .put("segundos", Math.round(seg * 10) / 10.0)
        runCatching { pendentes.appendText(linha.toString() + "\n") }
    }

    /** Lotes prontos para mandar (as exibições de dias anteriores viram lotes aqui), do mais antigo para o mais novo. */
    fun lotes(): List<File> = synchronized(trava) {
        if (pendentes.exists() && pendentes.length() > 0) {
            val linhas = runCatching { pendentes.readLines().filter { it.isNotBlank() } }.getOrDefault(emptyList())
            val corte = inicioDeHoje()
            // linha que não dá para ler vai junto (o servidor descarta): não fica presa no aparelho
            val (antigas, deHoje) = linhas.partition { runCatching { JSONObject(it).getLong("inicio") < corte }.getOrDefault(true) }
            antigas.chunked(POR_LOTE).forEachIndexed { n, parte ->
                // nome com a hora e a ordem: a lista sai em ordem; o uuid é o código do lote no servidor
                File(pasta, "lote-%013d-%03d-%s.jsonl".format(agora(), n, UUID.randomUUID())).writeText(parte.joinToString("\n") + "\n")
            }
            if (antigas.isNotEmpty()) {
                if (deHoje.isEmpty()) pendentes.delete() else pendentes.writeText(deHoje.joinToString("\n") + "\n")
            }
        }
        val todos = (pasta.listFiles { f -> f.name.startsWith("lote-") } ?: emptyArray()).sortedBy { it.name }.toMutableList()
        while (todos.sumOf { it.length() } > LIMITE_BYTES && todos.size > 1) todos.removeAt(0).delete()
        todos
    }

    /** Código do lote (vai para o servidor) e as exibições dele. */
    fun ler(lote: File): Pair<String, JSONArray> {
        // lote-<hora>-<ordem>-<uuid>.jsonl: o código é o uuid
        val codigo = lote.name.removePrefix("lote-").removeSuffix(".jsonl").split('-', limit = 3).getOrElse(2) { lote.name }
        val arr = JSONArray()
        lote.readLines().filter { it.isNotBlank() }.forEach { runCatching { arr.put(JSONObject(it)) } }
        return codigo to arr
    }

    /** Manda os lotes um a um; para no primeiro que falhar (tenta de novo no próximo sinal). */
    fun enviar(mandar: (codigo: String, itens: JSONArray) -> Unit) {
        for (l in lotes()) {
            val (codigo, itens) = ler(l)
            if (itens.length() > 0) mandar(codigo, itens)
            synchronized(trava) { l.delete() }
        }
    }

    /** Meia-noite de hoje em Brasília (ms desde 1970), pelo relógio da TV. */
    private fun inicioDeHoje(): Long = Calendar.getInstance(TimeZone.getTimeZone("America/Sao_Paulo")).apply {
        timeInMillis = agora(); set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis

    companion object {
        const val POR_LOTE = 2000
        const val LIMITE_BYTES = 20L * 1_048_576
    }
}
