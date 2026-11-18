package br.com.nervia.midia

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** Foto deitada na TV em pé: sem faixas pretas (fundo desfocado da própria foto), foto inteira no meio.
 *  Grava app/build/moldura-em-pe.png para olhar. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34])
class MolduraTest {
    /** Foto 1200×900 de teste: céu azul em cima, chão laranja embaixo, faixa verde no meio. */
    private fun foto(w: Int = 1200, h: Int = 900): Bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also {
        val c = Canvas(it); val p = Paint()
        p.color = Color.rgb(90, 160, 230); c.drawRect(0f, 0f, w.toFloat(), h / 2f, p)
        p.color = Color.rgb(230, 140, 60); c.drawRect(0f, h / 2f, w.toFloat(), h.toFloat(), p)
        p.color = Color.rgb(40, 180, 90); c.drawRect(w * 0.4f, 0f, w * 0.6f, h.toFloat(), p)
    }

    @Test fun fotoDeitadaNaTvEmPe() {
        val f = foto()
        val m = Moldura.montar(f, 1080, 1920)
        assertEquals(1080, m.width); assertEquals(1920, m.height)
        File("build").mkdirs()
        File("build/moldura-em-pe.png").outputStream().use { m.compress(Bitmap.CompressFormat.PNG, 100, it) }
        // onde antes era faixa preta (alto e pé da tela) agora há cor, mais escura que a foto
        for (y in listOf(20, 300, 1600, 1900)) {
            val px = m.getPixel(540, y)
            assertTrue("faixa preta em y=$y", Color.red(px) + Color.green(px) + Color.blue(px) > 60)
        }
        // a foto inteira está no meio, sem corte: bordas esquerda/direita da foto (azul em cima)
        val topoFoto = (1920 - 810) / 2   // 1200×900 em 1080 de largura = 810 de altura
        val azul = m.getPixel(5, topoFoto + 100)
        assertTrue(Color.blue(azul) > 200 && Color.red(azul) < 120)
        val laranja = m.getPixel(1075, topoFoto + 700)
        assertTrue(Color.red(laranja) > 200 && Color.blue(laranja) < 100)
        assertNotEquals(m.getPixel(540, 20), Color.BLACK)
    }

    @Test fun fotoNoFormatoDaTelaNaoMuda() {
        val f = foto(1080, 1920)
        assertSame(f, Moldura.montar(f, 1080, 1920))
        val g = foto(1920, 1080)
        assertSame(g, Moldura.montar(g, 1920, 1080))
    }

    @Test fun fotoEmPeNaTvDeitada() {
        val m = Moldura.montar(foto(900, 1200), 1920, 1080)
        assertEquals(1920, m.width)
        val px = m.getPixel(30, 540)   // lateral, antes faixa preta
        assertTrue(Color.red(px) + Color.green(px) + Color.blue(px) > 60)
    }
}
