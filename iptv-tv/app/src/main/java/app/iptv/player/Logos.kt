package app.iptv.player

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import android.widget.ImageView
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Carrega os logos dos canais (pequenos, em memória). Logo que falha não é pedido de novo. */
object Logos {
    private val cache = LruCache<String, Bitmap>(300)
    private val falhas = HashSet<String>()
    private val fila = Executors.newFixedThreadPool(4)
    private val tela = Handler(Looper.getMainLooper())

    fun mostrar(img: ImageView, url: String?) {
        img.tag = url
        img.setImageDrawable(null)
        if (url.isNullOrBlank() || synchronized(falhas) { url in falhas }) return
        cache.get(url)?.let { img.setImageBitmap(it); return }
        fila.execute {
            val bmp = try { baixar(url) } catch (_: Exception) { null }
            if (bmp == null) synchronized(falhas) { falhas += url } else cache.put(url, bmp)
            tela.post { if (img.tag == url && bmp != null) img.setImageBitmap(bmp) }
        }
    }

    private fun baixar(endereco: String): Bitmap? {
        val c = URL(endereco).openConnection() as HttpURLConnection
        c.connectTimeout = 8_000; c.readTimeout = 10_000
        c.setRequestProperty("User-Agent", Repositorio.USER_AGENT)
        return try {
            if (c.responseCode != 200) return null
            val bytes = c.inputStream.use { it.readBytes() }
            val op = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, op)
            var amostra = 1
            while (op.outWidth / (amostra * 2) >= 128 && op.outHeight / (amostra * 2) >= 64) amostra *= 2
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = amostra })
        } finally { c.disconnect() }
    }
}
