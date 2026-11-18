package app.iptv.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.net.InetAddress
import java.net.UnknownHostException

class DnsTest {
    private fun ip(s: String) = InetAddress.getByName(s)
    private val bloqueado: (String) -> List<InetAddress> = { throw UnknownHostException(it) }

    @Test fun operadoraBloqueiaPeloNome_usaODnsAlternativo() {
        val d = DnsAlternativo(sistema = bloqueado, alternativo = { listOf(ip("203.0.113.7")) })
        assertEquals(listOf(ip("203.0.113.7")), d.lookup("auth.exemplo.gy"))
    }

    @Test fun operadoraDesviaParaOutroEndereco_alternativoPrimeiro() {
        val d = DnsAlternativo(sistema = { listOf(ip("10.0.0.9")) }, alternativo = { listOf(ip("203.0.113.7")) })
        assertEquals(listOf(ip("203.0.113.7"), ip("10.0.0.9")), d.lookup("auth.exemplo.gy"))
    }

    @Test fun osDoisConcordam_ordemDoSistema() {
        val d = DnsAlternativo(sistema = { listOf(ip("198.51.100.1"), ip("203.0.113.7")) }, alternativo = { listOf(ip("203.0.113.7")) })
        assertEquals(listOf(ip("198.51.100.1"), ip("203.0.113.7")), d.lookup("cdn.exemplo.com"))
    }

    @Test fun nenhumAcha_erroClaro() {
        val d = DnsAlternativo(sistema = bloqueado, alternativo = { emptyList() })
        try { d.lookup("nao.existe.gy"); fail() } catch (e: UnknownHostException) {
            assertTrue(e.message!!.contains("DNS alternativo"))
        }
        assertTrue(Rede.explicar(UnknownHostException("x")).contains("não foi encontrado"))
    }

    @Test fun enderecoLocal_naoConsultaOAlternativo() {
        var consultas = 0
        val d = DnsAlternativo(sistema = { listOf(ip("127.0.0.1")) }, alternativo = { consultas++; emptyList() })
        d.lookup("127.0.0.1"); d.lookup("localhost")
        assertEquals(0, consultas)
    }

    @Test fun alternativoGuardadoPor10Minutos() {
        var consultas = 0; var t = 0L
        val d = DnsAlternativo(sistema = bloqueado, alternativo = { consultas++; listOf(ip("203.0.113.7")) }, agora = { t })
        d.lookup("a.exemplo.gy"); t = 300_000; d.lookup("a.exemplo.gy")
        assertEquals(1, consultas)
        t = 700_000; d.lookup("a.exemplo.gy")
        assertEquals(2, consultas)
    }
}
