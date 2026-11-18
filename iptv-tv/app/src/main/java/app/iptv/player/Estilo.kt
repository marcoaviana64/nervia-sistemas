package app.iptv.player

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.TextView

/**
 * Visual do NVPlayer (2.8, pedido do Marco em 18/11/2026: "design moderno, estilo Apple"). Fundo escuro em degradê,
 * cartões arredondados, item focado em azul com leve aumento (como na Apple TV) e textos em pesos diferentes.
 */
object Estilo {
    val AZUL = Color.rgb(0x2F, 0x7C, 0xF6)
    val AZUL_CLARO = Color.rgb(0x6F, 0xB1, 0xFF)
    val TEXTO = Color.rgb(0xF5, 0xF6, 0xF8)
    val TEXTO_2 = Color.rgb(0xA3, 0xAD, 0xBD)
    val TEXTO_3 = Color.rgb(0x6B, 0x75, 0x86)
    val CARTAO = Color.argb(20, 255, 255, 255)
    val MARCADO = Color.argb(34, 255, 255, 255)
    val VERMELHO = Color.rgb(0xFF, 0x45, 0x3A)

    val MEDIO: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    val NEGRITO: Typeface = Typeface.create("sans-serif", Typeface.BOLD)
    val LEVE: Typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)

    private fun dp(c: Context, v: Float) = v * c.resources.displayMetrics.density

    fun fundoTela(alfa: Int = 255): Drawable = GradientDrawable(GradientDrawable.Orientation.TL_BR,
        intArrayOf(Color.argb(alfa, 0x0B, 0x10, 0x1C), Color.argb(alfa, 0x10, 0x17, 0x2A), Color.argb(alfa, 0x07, 0x0A, 0x12)))

    fun cartao(c: Context, cor: Int = CARTAO, raio: Float = 16f): GradientDrawable =
        GradientDrawable().apply { setColor(cor); cornerRadius = dp(c, raio) }

    fun foco(c: Context, raio: Float = 14f): GradientDrawable =
        GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(Color.rgb(0x3D, 0x8B, 0xFF), Color.rgb(0x25, 0x63, 0xEB)))
            .apply { cornerRadius = dp(c, raio) }

    /** Fundo de linha/aba: azul quando focado, claro quando marcado, transparente no resto; com o "levantar" da Apple TV. */
    fun pintar(v: View, focado: Boolean, marcado: Boolean, raio: Float = 14f) {
        v.background = when {
            focado -> foco(v.context, raio)
            marcado -> cartao(v.context, MARCADO, raio)
            else -> null
        }
        val e = if (focado) 1.035f else 1f
        if (v.scaleX != e) v.animate().scaleX(e).scaleY(e).setDuration(140).start()
        v.translationZ = if (focado) dp(v.context, 6f) else 0f
    }

    /** Botão em forma de pílula: claro normal, branco com letra escura quando focado. */
    fun botao(b: TextView) {
        val c = b.context
        b.background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), cartao(c, Color.WHITE, 24f))
            addState(intArrayOf(android.R.attr.state_pressed), cartao(c, Color.argb(200, 255, 255, 255), 24f))
            addState(intArrayOf(), cartao(c, Color.argb(36, 255, 255, 255), 24f))
        }
        b.setTextColor(ColorStateList(arrayOf(intArrayOf(android.R.attr.state_focused), intArrayOf()),
            intArrayOf(Color.rgb(0x10, 0x14, 0x1C), TEXTO)))
        b.typeface = MEDIO
        b.stateListAnimator = null
        val p = dp(c, 22f).toInt(); val v = dp(c, 11f).toInt()
        b.setPadding(p, v, p, v)
        b.setOnFocusChangeListener { x, f -> val e = if (f) 1.06f else 1f; x.animate().scaleX(e).scaleY(e).setDuration(140).start() }
    }

    /** Campo de texto arredondado. */
    fun campo(t: TextView) {
        val c = t.context
        t.background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), GradientDrawable().apply {
                setColor(Color.argb(30, 255, 255, 255)); cornerRadius = dp(c, 12f); setStroke(dp(c, 2f).toInt(), AZUL_CLARO)
            })
            addState(intArrayOf(), cartao(c, Color.argb(22, 255, 255, 255), 12f))
        }
        val p = dp(c, 16f).toInt(); val v = dp(c, 12f).toInt()
        t.setPadding(p, v, p, v)
    }

    /** Corta a view (vídeo, capa) com cantos arredondados. */
    fun arredondar(v: View, raio: Float) {
        val r = dp(v.context, raio)
        v.outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, o: Outline) { o.setRoundRect(0, 0, view.width, view.height, r) }
        }
        v.clipToOutline = true
    }
}

/** Barrinha de andamento do programa (fração 0..1). */
class Barrinha(c: Context) : View(c) {
    var fracao = 0f
        set(v) { field = v.coerceIn(0f, 1f); invalidate() }
    private val fundo = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(46, 255, 255, 255) }
    private val cheio = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Estilo.AZUL_CLARO }
    private val r = RectF()
    override fun onDraw(cv: Canvas) {
        val h = height.toFloat(); val raio = h / 2
        r.set(0f, 0f, width.toFloat(), h); cv.drawRoundRect(r, raio, raio, fundo)
        if (fracao > 0f) { r.set(0f, 0f, width * fracao, h); cv.drawRoundRect(r, raio, raio, cheio) }
    }
}
