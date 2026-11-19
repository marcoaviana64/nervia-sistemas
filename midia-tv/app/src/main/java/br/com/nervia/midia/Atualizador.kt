package br.com.nervia.midia

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.FileProvider
import androidx.core.content.edit
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** Atualização do app pedida pelo painel (vem na playlist; null = nenhum pedido). */
data class PedidoApp(val codigo: Int, val nome: String, val sha256: String, val url: String) {
    companion object {
        fun deJson(o: JSONObject?): PedidoApp? {
            if (o == null) return null
            val codigo = o.optInt("codigo", 0)
            val sha = o.optString("sha256").lowercase()
            val url = o.optString("url")
            if (codigo <= 0 || !sha.matches(Regex("[0-9a-f]{64}")) || !url.startsWith("https://")) return null
            return PedidoApp(codigo, o.optString("nome").ifBlank { codigo.toString() }, sha, url)
        }
    }
}

/**
 * Atualização do app pedida pelo painel (Mídia Indoor 2.7, app 1.11; pedido do Marco em 19/11/2026, opção 1).
 * Baixa o APK pedido, confere o sha256 e o pacote, e abre a tela de instalação do Android: alguém no local aperta
 * "Instalar" (o Android não instala sozinho um app que veio do Downloader/ADB). Depois de instalado, o BootReceiver
 * (MY_PACKAGE_REPLACED) abre o app de novo. A situação vai ao painel pelo sinal (lista de erros, chave CHAVE).
 * Precisa de "Instalar apps desconhecidos" liberado para o Mídia Indoor (Android 8+; na instalação, por ADB:
 * appops set br.com.nervia.midia REQUEST_INSTALL_PACKAGES allow).
 */
class Atualizador(private val ctx: Context) {
    private val prefs = ctx.getSharedPreferences("atualizacao", Context.MODE_PRIVATE)

    fun versaoAtual(): Long = try {
        val i = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        if (Build.VERSION.SDK_INT >= 28) i.longVersionCode else @Suppress("DEPRECATION") i.versionCode.toLong()
    } catch (_: Exception) { BuildConfig.VERSION_CODE.toLong() }

    /**
     * Chamado fora da thread da tela a cada playlist. Devolve a situação para o painel (null = nada a informar).
     * [abrirInstalador] roda na thread da tela.
     */
    fun tratar(p: PedidoApp?, agora: Long, abrirInstalador: (Intent) -> Unit): String? {
        if (p == null || !precisa(p.codigo.toLong(), versaoAtual())) { limpar(); return null }
        // no máximo uma tentativa a cada 30 min por versão (a TV pergunta a playlist a cada 5 min)
        val chave = "tentou_${p.codigo}"
        if (agora - prefs.getLong(chave, 0) < INTERVALO_MS) return prefs.getString("situacao_${p.codigo}", null)
        prefs.edit { putLong(chave, agora) }
        val situacao = try {
            val arq = baixar(p)
            if (Build.VERSION.SDK_INT >= 26 && !ctx.packageManager.canRequestPackageInstalls()) {
                "versão ${p.nome} baixada, mas falta liberar \"Instalar apps desconhecidos\" para o Mídia Indoor " +
                    "(ADB: appops set ${ctx.packageName} REQUEST_INSTALL_PACKAGES allow)"
            } else {
                val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.arquivos", arq)
                abrirInstalador(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
                "versão ${p.nome}: tela de instalação aberta na TV, falta apertar Instalar"
            }
        } catch (e: Exception) {
            "o download da versão ${p.nome} falhou: ${e.message}"
        }
        prefs.edit { putString("situacao_${p.codigo}", situacao) }
        return situacao
    }

    private fun limpar() {
        if (prefs.all.isNotEmpty()) prefs.edit { clear() }
        File(ctx.cacheDir, "atualizacao").listFiles()?.forEach { it.delete() }
    }

    /** Baixa (ou reaproveita) o APK e confere sha256, pacote e versão. */
    private fun baixar(p: PedidoApp): File {
        val dir = File(ctx.cacheDir, "atualizacao").apply { mkdirs() }
        val arq = File(dir, "midia-${p.codigo}.apk")
        dir.listFiles()?.filter { it != arq }?.forEach { it.delete() }
        if (!arq.exists() || sha256(arq) != p.sha256) {
            val tmp = File(dir, "baixando.tmp")
            var url = URL(p.url)
            var c: HttpURLConnection
            var saltos = 0
            while (true) {
                c = (url.openConnection() as HttpURLConnection).apply { connectTimeout = 20_000; readTimeout = 60_000; instanceFollowRedirects = true }
                val cod = c.responseCode
                if (cod in 301..308 && saltos++ < 5) { url = URL(url, c.getHeaderField("Location")); c.disconnect(); continue }
                if (cod != 200) { c.disconnect(); error("o site respondeu $cod") }
                break
            }
            try { c.inputStream.use { i -> tmp.outputStream().use { o -> i.copyTo(o) } } } finally { c.disconnect() }
            if (sha256(tmp) != p.sha256) { tmp.delete(); error("o arquivo do site não é a versão pedida (o tv.apk mudou?): peça de novo no painel") }
            tmp.renameTo(arq)
        }
        @Suppress("DEPRECATION")
        val info = ctx.packageManager.getPackageArchiveInfo(arq.path, 0)
        val cod = info?.let { if (Build.VERSION.SDK_INT >= 28) it.longVersionCode else @Suppress("DEPRECATION") it.versionCode.toLong() }
        if (info == null || info.packageName != ctx.packageName || cod == null || cod <= versaoAtual()) {
            arq.delete(); error("o arquivo baixado não é uma atualização deste app")
        }
        return arq
    }

    companion object {
        const val CHAVE = "Atualização do app"
        const val INTERVALO_MS = 30 * 60_000L
        fun precisa(pedido: Long, atual: Long) = pedido > atual
        fun sha256(f: File): String = MessageDigest.getInstance("SHA-256").let { md ->
            f.inputStream().use { i -> val b = ByteArray(64 * 1024); while (true) { val n = i.read(b); if (n < 0) break; md.update(b, 0, n) } }
            md.digest().joinToString("") { "%02x".format(it) }
        }
    }
}
