package app.iptv.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress

class VigiaTest {
    @Test fun imagemParada_reconectaDepoisDe10s() {
        val v = Vigia(); v.reiniciar(0)
        var t = 0L; var pos = 0L; var q = 0L
        repeat(10) { t += 2000; pos += 2000; q += 50; assertFalse(v.conferir(t, true, true, pos, q)) }
        // servidor parou de mandar: posição e quadros param
        val parou = t
        while (t - parou <= 10_000) { t += 2000; if (v.conferir(t, true, true, pos, q)) break }
        assertTrue("reconectou em ${t - parou} ms", t - parou in 10_001..12_000)
    }

    @Test fun somContinuaMasImagemCongela_tambemReconecta() {
        val v = Vigia(); v.reiniciar(0)
        var t = 0L; var pos = 0L; var q = 0L
        repeat(5) { t += 2000; pos += 2000; q += 50; v.conferir(t, true, true, pos, q) }
        var travou = false
        repeat(7) { t += 2000; pos += 2000; travou = travou || v.conferir(t, true, true, pos, q) }
        assertTrue(travou)
    }

    @Test fun carregandoMaisDe15s_reconecta_eRadioSemVideoNao() {
        val v = Vigia(); v.reiniciar(0)
        assertFalse(v.conferir(14_000, true, false, 0, -1))
        assertTrue(v.conferir(16_000, true, false, 0, -1))
        // rádio (sem vídeo): posição andando = tudo certo
        val r = Vigia(); r.reiniciar(0)
        var t = 0L
        repeat(20) { t += 2000; assertFalse(r.conferir(t, true, true, t, -1)) }
    }

    @Test fun pausado_naoReconecta() {
        val v = Vigia(); v.reiniciar(0)
        var t = 0L
        repeat(20) { t += 2000; assertFalse(v.conferir(t, false, true, 5000, 100)) }
    }

    @Test fun avisoDeVencimento() {
        val h = 3_600_000L
        val agora = java.util.Calendar.getInstance().apply { set(2026, 10, 18, 10, 0, 0) }.timeInMillis
        assertNull(Vencimento.texto(null, agora))
        assertNull(Vencimento.texto(agora + 25 * h, agora))
        assertTrue(Vencimento.texto(agora + 23 * h, agora)!!.contains("vence amanhã às 09:00"))
        assertTrue(Vencimento.texto(agora + 5 * h, agora)!!.contains("vence hoje às 15:00"))
        assertTrue(Vencimento.texto(agora - h, agora)!!.contains("venceu em 18/11 às 09:00"))
    }

    @Test fun dnsAlternativoLento_naoSeguraAConexao() {
        val ip = InetAddress.getByName("198.51.100.1")
        val d = DnsAlternativo(sistema = { listOf(ip) }, alternativo = { Thread.sleep(5000); emptyList() }, espera = 300)
        val ini = System.currentTimeMillis()
        assertEquals(listOf(ip), d.lookup("cdn.exemplo.com"))
        assertTrue("demorou ${System.currentTimeMillis() - ini} ms", System.currentTimeMillis() - ini < 1500)
    }
}
