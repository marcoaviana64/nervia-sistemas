package br.com.nervia.midia

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Tela de espera da TV vinculada sem nada para passar (sem playlist, playlist vazia, baixando os primeiros
 * arquivos, sem internet antes do primeiro download): propaganda do Mídia Indoor para quem olha a TV, com QR code
 * do WhatsApp da Nervia (pedido do Marco em 04/11/2026). A linha de baixo, discreta, diz à equipe o que está acontecendo.
 * Deitada = texto e QR lado a lado; em pé = empilhados.
 */
@SuppressLint("SetTextI18n")
class Vitrine(private val ctx: Context, private val handler: Handler) {
    private fun sp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, ctx.resources.displayMetrics)
    private fun texto(tam: Float, cor: Int, negrito: Boolean = false, centro: Boolean = false) = TextView(ctx).apply {
        setTextColor(cor); setTextSize(TypedValue.COMPLEX_UNIT_PX, sp(tam))
        gravity = if (centro) Gravity.CENTER else Gravity.START
        if (negrito) typeface = Typeface.DEFAULT_BOLD
    }

    private val m = sp(12f).toInt()
    private val frase = texto(40f, Color.WHITE, negrito = true).apply { text = FRASES[0] }
    private val situacao = texto(13f, Color.rgb(111, 125, 129), centro = true)
    private val blocoTexto: LinearLayout
    private val blocoQr: LinearLayout
    private val miolo: LinearLayout
    val view: LinearLayout
    private var n = 0

    private val trocarFrase = object : Runnable {
        override fun run() {
            n = (n + 1) % FRASES.size
            frase.animate().alpha(0f).setDuration(500).withEndAction {
                frase.text = FRASES[n]
                frase.animate().alpha(1f).setDuration(500).start()
            }.start()
            handler.postDelayed(this, 7_000)
        }
    }

    init {
        val logo = ImageView(ctx).apply { setImageResource(R.drawable.vitrine_logo); adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_START }
        blocoTexto = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL
            addView(logo, LinearLayout.LayoutParams(sp(220f).toInt(), LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = m * 2 })
            addView(texto(16f, Color.rgb(154, 170, 176)).apply { text = "MÍDIA INDOOR"; letterSpacing = 0.25f }, LinearLayout.LayoutParams(-1, -2))
            addView(frase, LinearLayout.LayoutParams(-1, -2).apply { topMargin = m / 2; bottomMargin = m })
            addView(texto(20f, Color.rgb(207, 216, 218)).apply {
                text = "Vídeos e ofertas na TV do seu negócio, atualizados de qualquer lugar pela pasta do Google Drive."
            }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = m * 2 })
            addView(texto(18f, Color.rgb(95, 211, 211)).apply {
                text = VANTAGENS.joinToString("\n") { "✓  $it" }; setLineSpacing(sp(6f), 1f)
            }, LinearLayout.LayoutParams(-1, -2))
        }
        val qr = ImageView(ctx).apply {
            setImageResource(R.drawable.vitrine_qr); adjustViewBounds = true
            background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = sp(14f) }
            val pd = sp(8f).toInt(); setPadding(pd, pd, pd, pd)
        }
        blocoQr = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            addView(qr, LinearLayout.LayoutParams(sp(210f).toInt(), sp(210f).toInt()).apply { bottomMargin = m })
            addView(texto(18f, Color.WHITE, negrito = true, centro = true).apply { text = "Quer isso no seu negócio?" }, LinearLayout.LayoutParams(-2, -2))
            addView(texto(15f, Color.rgb(207, 216, 218), centro = true).apply { text = "Aponte a câmera do celular\ne fale com a Nervia no WhatsApp" },
                LinearLayout.LayoutParams(-2, -2).apply { topMargin = m / 3 })
            addView(texto(15f, Color.rgb(95, 211, 211), centro = true).apply { text = CONTATO }, LinearLayout.LayoutParams(-2, -2).apply { topMargin = m })
        }
        miolo = LinearLayout(ctx).apply { gravity = Gravity.CENTER; addView(blocoTexto); addView(blocoQr) }
        view = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; visibility = View.GONE
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(Color.rgb(8, 34, 41), Color.rgb(12, 17, 19), Color.rgb(16, 60, 72)))
            setPadding(m * 4, m * 3, m * 4, m * 2)
            addView(miolo, LinearLayout.LayoutParams(-1, 0, 1f))
            addView(situacao, LinearLayout.LayoutParams(-1, -2))
        }
        arrumar(emPe = false)
    }

    /** TV em pé: texto em cima, QR embaixo; deitada: lado a lado. */
    fun arrumar(emPe: Boolean) {
        miolo.orientation = if (emPe) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
        blocoTexto.layoutParams = if (emPe) LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = m * 3 }
            else LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = m * 4 }
        blocoQr.layoutParams = LinearLayout.LayoutParams(-2, -2)
        miolo.requestLayout()
    }

    fun mostrar(linhaDaEquipe: String) {
        situacao.text = linhaDaEquipe
        if (view.visibility != View.VISIBLE) {
            view.visibility = View.VISIBLE
            handler.removeCallbacks(trocarFrase)
            handler.postDelayed(trocarFrase, 7_000)
        }
    }

    fun esconder() {
        handler.removeCallbacks(trocarFrase)
        view.visibility = View.GONE
    }

    companion object {
        const val CONTATO = "(21) 96686-9374 · nervia.com.br"   // o QR (res/drawable-nodpi/vitrine_qr.png) sai de midia-tv/gerar_qr.py
        val FRASES = listOf(
            "Sua marca em todas as telas",
            "Ofertas novas na TV em minutos",
            "Troque o vídeo sem sair do lugar",
            "Chame a atenção de quem passa",
        )
        val VANTAGENS = listOf(
            "Atualize pelo Google Drive, de qualquer lugar",
            "Continua passando mesmo sem internet",
            "Várias TVs, cada uma com a sua playlist",
        )
    }
}
