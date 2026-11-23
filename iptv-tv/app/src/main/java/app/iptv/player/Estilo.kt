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
import android.graphics.drawable.LayerDrawable
import android.graphics.drawable.StateListDrawable
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.TextView

/**
 * Visual do NVPlayer (2.8, pedido do Marco em 18/11/2026: "design moderno, estilo Apple"). Fundo escuro em degradê,
 * cartões arredondados, item focado em azul com leve aumento (como na Apple TV) e textos em pesos diferentes.
 */
object Estilo {
    // Cores do destaque: mudam com o tema (2.23, pedido do Marco: escolher o visual em Ajustes → Aparência).
    var AZUL = Color.rgb(0x2F, 0x7C, 0xF6)
    var AZUL_CLARO = Color.rgb(0x6F, 0xB1, 0xFF)
    var FOCO_A = Color.rgb(0x3D, 0x8B, 0xFF)
    var FOCO_B = Color.rgb(0x25, 0x63, 0xEB)
    var VERMELHO = Color.rgb(0xFF, 0x45, 0x3A)
    val TEXTO = Color.rgb(0xF5, 0xF6, 0xF8)
    val TEXTO_2 = Color.rgb(0xA3, 0xAD, 0xBD)
    val TEXTO_3 = Color.rgb(0x6B, 0x75, 0x86)
    val CARTAO = Color.argb(20, 255, 255, 255)
    val MARCADO = Color.argb(34, 255, 255, 255)

    /** Tema atual ("classico" = azul; "premium" = ciano). */
    var tema = "classico"
        private set

    /**
     * Aplica o tema escolhido (chamado no início de cada abertura da tela, antes de montar as views).
     * Só troca as cores do destaque — o resto do visual é o mesmo. Barato: nenhuma biblioteca ou imagem nova.
     */
    fun aplicar(nome: String) {
        tema = if (nome == "premium") "premium" else "classico"
        if (tema == "premium") {
            AZUL = Color.rgb(0x0E, 0xA5, 0xE9)       // azul-ciano (pílulas, acentos)
            AZUL_CLARO = Color.rgb(0x34, 0xE0, 0xF2) // ciano forte (marca, "AGORA", barrinha, relógio)
            FOCO_A = Color.rgb(0x0E, 0xA5, 0xE9)     // foco: degradê azul-ciano → ciano (bem diferente do azul do Clássico)
            FOCO_B = Color.rgb(0x22, 0xD3, 0xEE)
            VERMELHO = Color.rgb(0xF4, 0x3F, 0x6B)   // "AO VIVO" em magenta
        } else {
            AZUL = Color.rgb(0x2F, 0x7C, 0xF6)
            AZUL_CLARO = Color.rgb(0x6F, 0xB1, 0xFF)
            FOCO_A = Color.rgb(0x3D, 0x8B, 0xFF)
            FOCO_B = Color.rgb(0x25, 0x63, 0xEB)
            VERMELHO = Color.rgb(0xFF, 0x45, 0x3A)
        }
    }

    val MEDIO: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    val NEGRITO: Typeface = Typeface.create("sans-serif", Typeface.BOLD)
    val LEVE: Typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)

    private fun dp(c: Context, v: Float) = v * c.resources.displayMetrics.density

    /** Brilho radial (clareia um canto da tela); usado no fundo para o ar "premium" do conceito. */
    private fun brilho(cor: Int, cx: Float, cy: Float, raio: Float, alfaBase: Int, alfaTela: Int): GradientDrawable =
        GradientDrawable().apply {
            gradientType = GradientDrawable.RADIAL_GRADIENT
            gradientRadius = raio
            setGradientCenter(cx, cy)
            val a = alfaBase * alfaTela / 255
            colors = intArrayOf(Color.argb(a, Color.red(cor), Color.green(cor), Color.blue(cor)), Color.TRANSPARENT)
        }

    /**
     * Fundo da tela: base escura em degradê + brilhos radiais (ciano em cima à direita, azul embaixo à esquerda,
     * um toque de magenta no canto) — dá a profundidade do conceito premium. As cores seguem o tema (no Clássico
     * os brilhos ficam azuis; no Premium, cianos).
     */
    fun fundoTela(alfa: Int = 255): Drawable {
        val base = GradientDrawable(GradientDrawable.Orientation.TL_BR,
            intArrayOf(Color.argb(alfa, 0x0A, 0x0F, 0x1E), Color.argb(alfa, 0x0B, 0x10, 0x1E), Color.argb(alfa, 0x05, 0x07, 0x0E)))
        return LayerDrawable(arrayOf(
            base,
            brilho(AZUL_CLARO, 0.82f, -0.06f, 1500f, 42, alfa),
            brilho(AZUL, 0.05f, 1.06f, 1500f, 52, alfa),
            brilho(VERMELHO, 1.04f, 1.04f, 1100f, 20, alfa),
        ))
    }

    fun cartao(c: Context, cor: Int = CARTAO, raio: Float = 16f): GradientDrawable =
        GradientDrawable().apply { setColor(cor); cornerRadius = dp(c, raio) }

    /**
     * Cartão "de vidro fosco" (2.27): degradê vertical do branco translúcido um pouco mais claro em cima para mais
     * escuro embaixo + borda clara fininha. Dá o ar de vidro do conceito premium, sem precisar de desfoque (que o
     * Android só faz no 12+). [base] = quanto de branco translúcido no meio (alfa 0–255).
     */
    fun vidro(c: Context, raio: Float = 16f, base: Int = 22): GradientDrawable =
        GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(Color.argb((base + 16).coerceAtMost(255), 255, 255, 255), Color.argb((base - 8).coerceAtLeast(0), 255, 255, 255)))
            .apply { cornerRadius = dp(c, raio); setStroke(dp(c, 1f).toInt(), Color.argb(38, 255, 255, 255)) }

    fun foco(c: Context, raio: Float = 14f): GradientDrawable =
        GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(FOCO_A, FOCO_B))
            .apply { cornerRadius = dp(c, raio) }

    /** Cartão de Filme/Série: vidro fosco em repouso, degradê azul→ciano quando focado (com o "levantar"). */
    fun pintarCartao(v: View, focado: Boolean, raio: Float = 16f) {
        v.background = if (focado) foco(v.context, raio) else vidro(v.context, raio, 10)
        val e = if (focado) 1.05f else 1f
        if (v.scaleX != e) v.animate().scaleX(e).scaleY(e).setDuration(140).start()
        v.translationZ = if (focado) dp(v.context, 6f) else 0f
    }

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

    /**
     * Aba do topo: a ATIVA (e a focada) ganham o degradê azul→ciano com letra escura, como as pílulas do conceito
     * premium; as demais ficam só com o texto apagado. Assim a aba onde você está salta aos olhos.
     */
    fun pintarAba(v: TextView, focado: Boolean, ativo: Boolean) {
        v.background = if (focado || ativo) foco(v.context, 22f) else null
        v.setTextColor(when {
            !(focado || ativo) -> TEXTO_2
            tema == "premium" -> Color.rgb(0x05, 0x12, 0x20)  // letra escura sobre o ciano claro
            else -> Color.WHITE                                // no Clássico o azul é mais escuro: letra branca
        })
        val e = if (focado) 1.06f else 1f
        if (v.scaleX != e) v.animate().scaleX(e).scaleY(e).setDuration(140).start()
        v.translationZ = if (focado) dp(v.context, 7f) else if (ativo) dp(v.context, 2f) else 0f
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
