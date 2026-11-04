package br.com.nervia.midia

import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** Monta a tela de espera em 1920×1080 (TV deitada) e 1080×1920 (em pé), confere o conteúdo e grava a imagem
 *  em app/build/vitrine-*.png (para olhar antes de instalar). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "xhdpi")
class VitrineTest {
    private fun textos(v: View): List<String> = when (v) {
        is TextView -> listOf(v.text.toString())
        is android.view.ViewGroup -> (0 until v.childCount).flatMap { textos(v.getChildAt(it)) }
        else -> emptyList()
    }

    private fun desenhar(emPe: Boolean, w: Int, h: Int, nome: String): Vitrine {
        val vit = Vitrine(ApplicationProvider.getApplicationContext(), Handler(Looper.getMainLooper()))
        vit.arrumar(emPe)
        vit.mostrar("TV Recepção · nenhuma playlist escolhida para esta TV")
        vit.view.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        vit.view.layout(0, 0, w, h)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        vit.view.draw(Canvas(bmp))
        File("build").mkdirs()
        File("build/$nome.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return vit
    }

    @Test fun deitada() {
        val v = desenhar(false, 1920, 1080, "vitrine-deitada")
        val t = textos(v.view)
        assertEquals(View.VISIBLE, v.view.visibility)
        assertTrue(t.contains(Vitrine.FRASES[0]))
        assertTrue(t.contains(Vitrine.CONTATO))
        assertTrue(t.any { it.contains("nenhuma playlist") })
        // nada passa da tela
        assertTrue(v.view.getChildAt(0).bottom <= 1080)
    }

    @Test fun emPe() {
        val v = desenhar(true, 1080, 1920, "vitrine-em-pe")
        assertTrue(v.view.getChildAt(0).bottom <= 1920)
        v.esconder()
        assertEquals(View.GONE, v.view.visibility)
    }
}
