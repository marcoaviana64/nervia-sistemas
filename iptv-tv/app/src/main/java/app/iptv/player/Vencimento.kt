package app.iptv.player

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Aviso de vencimento da lista (2.10, pedido do Marco em 18/11/2026: "as pessoas esquecem"). A partir de 24 h antes
 * do vencimento (validade do login Xtream), um texto pequeno no canto de baixo à esquerda, por [DURACAO], a cada
 * [INTERVALO]. Depois de vencida, continua avisando no mesmo ritmo.
 */
object Vencimento {
    const val ANTES = 24 * 3_600_000L
    const val INTERVALO = 2 * 3_600_000L
    const val DURACAO = 10 * 60_000L

    /** Texto do aviso, ou null se ainda não é hora de avisar. */
    fun texto(validade: Long?, agora: Long): String? {
        if (validade == null || validade <= 0 || validade - agora > ANTES) return null
        val br = Locale.forLanguageTag("pt-BR")
        val hora = SimpleDateFormat("HH:mm", br).format(Date(validade))
        if (validade <= agora) return "⚠  Sua lista venceu em ${SimpleDateFormat("dd/MM 'às' HH:mm", br).format(Date(validade))}. Renove para continuar assistindo."
        val dia = Calendar.getInstance().apply { timeInMillis = agora }
        val v = Calendar.getInstance().apply { timeInMillis = validade }
        val quando = if (dia.get(Calendar.DAY_OF_YEAR) == v.get(Calendar.DAY_OF_YEAR) && dia.get(Calendar.YEAR) == v.get(Calendar.YEAR)) "hoje" else "amanhã"
        return "⏰  Sua lista vence $quando às $hora. Renove para não ficar sem sinal."
    }
}
