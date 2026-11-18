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

/** Tempo de tela: só conta o que ficou na tela, sem internet acumula, lote repetido mantém o código e só sai do aparelho
 *  depois que o servidor confirma. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ExibicoesTest {
    private var relogio = 0L
    private var hora = 1_700_000_000_000L
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
        var codigo1 = ""
        runCatching { e.enviar { c, _ -> codigo1 = c; throw IOException("sem internet") } }
        e.iniciar(foto); passar(10_000); e.fechar()   // anotada depois da falha: vai num lote novo
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
        val tamanhos = mutableListOf<Int>()
        e.enviar { _, i -> tamanhos += i.length() }
        assertEquals(listOf(Exibicoes.POR_LOTE, 5), tamanhos)
    }
}
