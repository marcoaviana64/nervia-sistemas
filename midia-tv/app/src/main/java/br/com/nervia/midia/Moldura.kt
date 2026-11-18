package br.com.nervia.midia

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Foto com formato diferente da tela (ex.: foto deitada na TV em pé): em vez de faixas pretas, a foto aparece INTEIRA
 * sobre ela mesma ampliada, desfocada e escurecida (pedido do Marco em 18/11/2026, Linum Gávea). O desfoque é feito
 * reduzindo a foto a poucos pixels e ampliando com filtro (funciona em qualquer Android 7+, sem RenderEffect).
 */
object Moldura {
    /** Diferença de proporção abaixo da qual a foto já preenche a tela (não vale a moldura). */
    private const val TOLERANCIA = 0.03f

    /** Devolve a imagem pronta para a tela larga × alta; a mesma imagem quando já tem o formato da tela. */
    fun montar(foto: Bitmap, larga: Int, alta: Int): Bitmap {
        if (larga <= 0 || alta <= 0 || foto.width <= 0 || foto.height <= 0) return foto
        val pf = foto.width.toFloat() / foto.height
        val pt = larga.toFloat() / alta
        if (abs(pf - pt) / pt < TOLERANCIA) return foto
        val tela = Bitmap.createBitmap(larga, alta, Bitmap.Config.ARGB_8888)
        val c = Canvas(tela)
        val filtro = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
        // fundo: a foto cortada para cobrir a tela, reduzida a ~1/120 e ampliada em dois passos (fica bem desfocada)
        val escalaCobrir = max(larga.toFloat() / foto.width, alta.toFloat() / foto.height)
        val cw = (larga / escalaCobrir).roundToInt().coerceIn(1, foto.width)
        val ch = (alta / escalaCobrir).roundToInt().coerceIn(1, foto.height)
        val recorte = Rect((foto.width - cw) / 2, (foto.height - ch) / 2, (foto.width - cw) / 2 + cw, (foto.height - ch) / 2 + ch)
        val pw = max(2, larga / 120)
        val ph = max(2, alta / 120)
        val mini = Bitmap.createBitmap(pw, ph, Bitmap.Config.ARGB_8888)
        Canvas(mini).drawBitmap(foto, recorte, Rect(0, 0, pw, ph), filtro)
        val meio = Bitmap.createBitmap(max(2, larga / 30), max(2, alta / 30), Bitmap.Config.ARGB_8888)
        Canvas(meio).drawBitmap(mini, null, Rect(0, 0, meio.width, meio.height), filtro)
        c.drawBitmap(meio, null, Rect(0, 0, larga, alta), filtro)
        mini.recycle(); meio.recycle()
        c.drawColor(Color.argb(90, 0, 0, 0))   // escurece o fundo para a foto se destacar
        // a foto inteira, centralizada
        val e = min(larga.toFloat() / foto.width, alta.toFloat() / foto.height)
        val w = foto.width * e
        val h = foto.height * e
        c.drawBitmap(foto, null, RectF((larga - w) / 2, (alta - h) / 2, (larga + w) / 2, (alta + h) / 2), filtro)
        return tela
    }
}
