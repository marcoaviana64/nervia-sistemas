package app.iptv.player

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import android.widget.ImageView
import okhttp3.Request
import java.util.concurrent.TimeUnit
import java.util.concurrent.Executors

/** Carrega logos e capas (reduzidos ao tamanho de uso, em memória). Imagem que falha não é pedida de novo. */
object Logos {
    private val cache = object : LruCache<String, Bitmap>((Runtime.getRuntime().maxMemory() / 1024 / 10).toInt()) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount / 1024
    }
    private val falhas = HashSet<String>()
    private val fila = Executors.newFixedThreadPool(4)
    private val tela = Handler(Looper.getMainLooper())

    /** [largura] = largura de uso em pixels (a imagem é reduzida até perto dela). */
    fun mostrar(img: ImageView, url: String?, largura: Int = 128) {
        val chave = "$url@$largura"
        img.tag = chave
        img.setImageDrawable(null)
        if (url.isNullOrBlank() || !url.startsWith("http") || synchronized(falhas) { url in falhas }) return
        cache.get(chave)?.let { img.setImageBitmap(it); return }
        fila.execute {
            val bmp = try { baixar(url, largura) } catch (_: Exception) { null } catch (_: OutOfMemoryError) { null }
            if (bmp == null) synchronized(falhas) { falhas += url } else cache.put(chave, bmp)
            tela.post { if (img.tag == chave && bmp != null) img.setImageBitmap(bmp) }
        }
    }

    private fun baixar(endereco: String, largura: Int): Bitmap? {
        val cli = Rede.cliente.newBuilder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(12, TimeUnit.SECONDS).build()
        cli.newCall(Request.Builder().url(endereco).header("User-Agent", Http.USER_AGENT).build()).execute().use { r ->
            if (r.code != 200) return null
            val bytes = r.body!!.bytes()
            val op = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, op)
            var amostra = 1
            while (op.outWidth / (amostra * 2) >= largura) amostra *= 2
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply {
                inSampleSize = amostra
                if (largura > 150) inPreferredConfig = Bitmap.Config.RGB_565
            })
        }
    }
}
