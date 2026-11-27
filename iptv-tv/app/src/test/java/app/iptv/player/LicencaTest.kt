package app.iptv.player

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LicencaTest {
    private fun resp(codigo: String, licenca: String) =
        JSONObject("""{"ok":true,"codigo":"$codigo","licenca":$licenca}""")

    @Test fun emTeste() {
        Licenca.atualizar(resp("AB2CD", """{"isento":false,"em_teste":true,"valida_ate":"2026-12-10","vencida":false,"dias":9}"""))
        assertTrue(Licenca.emTeste); assertFalse(Licenca.vencida); assertFalse(Licenca.avisarVencida())
        assertEquals("AB2CD", Licenca.codigo)
        assertTrue(Licenca.resumo().contains("em teste") && Licenca.resumo().contains("10/12/2026") && Licenca.resumo().contains("AB2CD"))
    }

    @Test fun liberadoPago() {
        Licenca.atualizar(resp("XY7ZK", """{"isento":false,"em_teste":false,"valida_ate":"2027-01-15","vencida":false,"dias":40}"""))
        assertFalse(Licenca.avisarVencida())
        assertTrue(Licenca.resumo().contains("liberado até 15/01/2027"))
    }

    @Test fun vencida() {
        Licenca.atualizar(resp("QQ9WW", """{"isento":false,"em_teste":false,"valida_ate":"2026-11-01","vencida":true,"dias":-26}"""))
        assertTrue(Licenca.avisarVencida())
        assertTrue(Licenca.resumo().contains("VENCIDA") && Licenca.resumo().contains("01/11/2026"))
    }

    @Test fun isentoAmigo() {
        Licenca.atualizar(resp("FF3GG", """{"isento":true,"em_teste":false,"valida_ate":null,"vencida":false,"dias":null}"""))
        assertFalse(Licenca.avisarVencida())
        assertTrue(Licenca.resumo().contains("sem prazo"))
    }
}
