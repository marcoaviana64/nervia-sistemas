package br.com.nervia.midia

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException
import java.nio.file.Files

/** Tempo de tela: só conta o que ficou na tela, manda só os dias anteriores (envio diário), sem internet acumula, lote
 *  repetido mantém o código e só sai do aparelho depois que o servidor confirma. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ExibicoesTest {
    private var relogio = 0L
    private var hora = 1_700_000_000_000L   // 14/11/2023 19:13 em Brasília
    private val DIA = 86_400_000L
    private val video = Item("v1", "01_promo.mp4", "video", "m", 1, null, "u", null)
    private val foto = Item("i1", "02_cardapio.jpg", "imagem", "m", 1, 10, "u", null)
    private fun nova() = Exibicoes(Files.createTempDirectory("exib").toFile(), { hora }, { relogio })
    private fun passar(ms: Long) { relogio += ms; hora += ms }

    @Test fun contaSoOQueFicouNaTela() {
        val e = nova()
        e.iniciar(video); passar(30_000)
        e.iniciar(foto); passar(10_000)      // a próxima fecha a anterior
        e.iniciar(video); passar(400)        // menos de 1 s: não conta
        e.fechar()
        e.fechar()                           // fechar duas vezes não duplica
        e.enviar { _, _ -> throw AssertionError("hoje ainda não manda") }
        hora += DIA                          // dia seguinte
        val enviados = mutableListOf<Pair<String, JSONArray>>()
        e.enviar { c, i -> enviados += c to i }
        assertEquals(1, enviados.size)
        val itens = enviados[0].second
        assertEquals(2, itens.length())
        assertEquals("v1", itens.getJSONObject(0).getString("id"))
        assertEquals(30.0, itens.getJSONObject(0).getDouble("segundos"), 0.01)
        assertEquals(1_700_000_000_000L, itens.getJSONObject(0).getLong("inicio"))
        assertEquals("imagem", itens.getJSONObject(1).getString("tipo"))
        assertEquals(10.0, itens.getJSONObject(1).getDouble("segundos"), 0.01)
        assertTrue(enviados[0].first.matches(Regex("[0-9a-f-]{36}")))
        // já foi: não manda de novo
        e.enviar { _, _ -> throw AssertionError("não devia mandar nada") }
    }

    @Test fun semInternetGuardaEMandaOMesmoLoteDepois() {
        val e = nova()
        e.iniciar(video); passar(5_000); e.fechar()
        hora += DIA
        var codigo1 = ""
        runCatching { e.enviar { c, _ -> codigo1 = c; throw IOException("sem internet") } }
        e.iniciar(foto); passar(10_000); e.fechar()   // anotada depois da falha: vai num lote novo, no dia seguinte
        hora += DIA
        val enviados = mutableListOf<Pair<String, Int>>()
        e.enviar { c, i -> enviados += c to i.length() }
        assertEquals(listOf(codigo1 to 1), enviados.take(1))   // o lote que falhou volta com o mesmo código
        assertEquals(2, enviados.size)
        assertEquals(1, enviados[1].second)
    }

    @Test fun loteGrandeEmPartes() {
        val e = nova()
        repeat(Exibicoes.POR_LOTE + 5) { e.iniciar(foto); passar(2_000) }
        e.fechar()
        hora += DIA
        val tamanhos = mutableListOf<Int>()
        e.enviar { _, i -> tamanhos += i.length() }
        assertEquals(listOf(Exibicoes.POR_LOTE, 5), tamanhos)
    }

    /** Envio diário: na virada do dia vão só as exibições de ontem; as de hoje ficam para amanhã. */
    @Test fun mandaOntemEGuardaHoje() {
        val e = nova()
        hora = 1_700_017_000_000L            // 14/11/2023 23:56 em Brasília
        e.iniciar(video); passar(30_000); e.fechar()               // ontem
        hora += 5 * 60_000L                                         // 15/11 00:01
        e.iniciar(foto); passar(10_000); e.fechar()                 // hoje
        val enviados = mutableListOf<String>()
        e.enviar { _, i -> for (k in 0 until i.length()) enviados += i.getJSONObject(k).getString("id") }
        assertEquals(listOf("v1"), enviados)
        enviados.clear()
        e.enviar { _, i -> for (k in 0 until i.length()) enviados += i.getJSONObject(k).getString("id") }
        assertEquals(emptyList<String>(), enviados)                 // a de hoje continua guardada
        hora += DIA
        e.enviar { _, i -> for (k in 0 until i.length()) enviados += i.getJSONObject(k).getString("id") }
        assertEquals(listOf("i1"), enviados)
    }
}
