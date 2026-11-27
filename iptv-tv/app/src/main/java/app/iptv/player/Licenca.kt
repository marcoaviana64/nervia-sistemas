package app.iptv.player

import android.content.SharedPreferences
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Liberação de uso do app (2.38, pedido do Marco em 27/11/2026). A liberação é feita no painel da Nervia (o admin, depois
 * de confirmar o pagamento, libera o aparelho); o app SÓ AVISA quando vence, NÃO bloqueia (decisão do Marco). A situação
 * pega carona no resumo que o app já manda (nv_sinal), então não há chamada nova: a resposta traz `codigo` e `licenca`.
 *
 * - isento  = liberado sem prazo (amigos).
 * - emTeste = está no período de teste de quem baixou.
 * - validaAte = último dia liberado (AAAA-MM-DD, Brasília); vazio = sem data.
 * - vencida = passou de validaAte e não é isento (só gera um aviso na tela; nada trava).
 * - codigo  = código curto que o usuário informa à Nervia para liberar.
 */
object Licenca {
    @Volatile var codigo: String = ""
    @Volatile var isento: Boolean = false
    @Volatile var emTeste: Boolean = false
    @Volatile var validaAte: String = ""
    @Volatile var vencida: Boolean = false
    @Volatile var dias: Int? = null
    @Volatile var recebida: Boolean = false

    /** Atualiza a partir da resposta do nv_sinal (tem 'codigo' e 'licenca'). */
    fun atualizar(resp: JSONObject) {
        resp.optString("codigo").takeIf { it.isNotBlank() }?.let { codigo = it }
        val l = resp.optJSONObject("licenca") ?: return
        isento = l.optBoolean("isento", isento)
        emTeste = l.optBoolean("em_teste", false)
        validaAte = if (l.isNull("valida_ate")) "" else l.optString("valida_ate", "")
        vencida = l.optBoolean("vencida", false)
        dias = if (l.isNull("dias")) null else l.optInt("dias")
        recebida = true
    }

    fun carregar(p: SharedPreferences) {
        codigo = p.getString("codigo", "") ?: ""
        isento = p.getBoolean("isento", false)
        emTeste = p.getBoolean("em_teste", false)
        validaAte = p.getString("valida_ate", "") ?: ""
        vencida = p.getBoolean("vencida", false)
        dias = if (p.contains("dias")) p.getInt("dias", 0) else null
        recebida = p.getBoolean("recebida", false)
    }

    fun salvar(p: SharedPreferences) {
        p.edit().putString("codigo", codigo).putBoolean("isento", isento).putBoolean("em_teste", emTeste)
            .putString("valida_ate", validaAte).putBoolean("vencida", vencida)
            .apply { dias?.let { putInt("dias", it) } ?: remove("dias") }
            .putBoolean("recebida", recebida).apply()
    }

    private fun dataBr(iso: String): String = try {
        val d = SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(iso)
        if (d != null) SimpleDateFormat("dd/MM/yyyy", Locale.US).format(d) else iso
    } catch (_: Exception) { iso }

    /** Deve mostrar o aviso de vencido na tela? (vencida, não isento, e já soube da licença alguma vez) */
    fun avisarVencida(): Boolean = recebida && vencida && !isento

    /** Linha curta para a tela de Ajustes. */
    fun resumo(): String = when {
        !recebida && codigo.isEmpty() -> "Licença: — (o app confere ao falar com a Nervia)"
        isento -> "Licença: liberado (sem prazo)"
        vencida -> "Licença: VENCIDA" + (if (validaAte.isNotEmpty()) " desde ${dataBr(validaAte)}" else "") +
            " — código ${codigo}. Fale com a Nervia para renovar."
        emTeste -> "Licença: em teste" + (if (validaAte.isNotEmpty()) " até ${dataBr(validaAte)}" else "") +
            (dias?.let { " (faltam $it dia(s))" } ?: "") + " — código ${codigo}"
        validaAte.isNotEmpty() -> "Licença: liberado até ${dataBr(validaAte)}" +
            (dias?.let { " (faltam $it dia(s))" } ?: "") + " — código ${codigo}"
        else -> "Licença: liberado — código ${codigo}"
    }
}
