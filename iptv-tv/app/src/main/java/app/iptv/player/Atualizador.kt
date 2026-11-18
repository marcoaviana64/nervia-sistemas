package app.iptv.player

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File

/** Versão publicada no site (bloco "versao" do nvplayer.json). */
data class Versao(val codigo: Long, val nome: String, val apk: String, val novidades: String?)

/**
 * Atualização pelo próprio app (2.6, pedido do Marco em 18/11/2026: "o app informa que existe nova versão e pede para
 * clicar"). Lê o bloco "versao" do arquivo do site; se o código for maior que o instalado, oferece, baixa o APK e
 * abre o instalador do Android. Na primeira vez o Android pede para liberar "instalar apps" para o NVPlayer.
 */
class Atualizador(private val act: Activity, private val avisar: (String?) -> Unit, private val toast: (String) -> Unit) {
    /** APK baixado esperando a pessoa liberar a instalação nas configurações. */
    private var pendente: File? = null

    fun versaoAtual(): Long = try {
        val i = act.packageManager.getPackageInfo(act.packageName, 0)
        if (Build.VERSION.SDK_INT >= 28) i.longVersionCode else @Suppress("DEPRECATION") i.versionCode.toLong()
    } catch (_: Exception) { 0 }

    private fun nomeAtual(): String = try { act.packageManager.getPackageInfo(act.packageName, 0).versionName ?: "" } catch (_: Exception) { "" }

    /** [automatico] = na abertura do app: respeita o "Depois" (1 dia) e não diz nada quando já está atualizado. */
    fun oferecer(v: Versao?, automatico: Boolean, adiadaAte: Long, adiar: (Long) -> Unit, baixar: (Versao) -> Unit) {
        if (v == null || v.codigo <= versaoAtual()) {
            if (!automatico) toast("Você já está na versão mais nova (NVPlayer ${nomeAtual()}).")
            return
        }
        if (automatico && System.currentTimeMillis() < adiadaAte) return
        val msg = buildString {
            append("Versão instalada: ${nomeAtual()}\n")
            v.novidades?.let { append("\nO que mudou: $it\n") }
            append("\nA atualização instala por cima: a lista, os favoritos e onde você parou continuam.")
        }
        AlertDialog.Builder(act, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Nova versão do NVPlayer: ${v.nome}")
            .setMessage(msg)
            .setPositiveButton("Atualizar agora") { _, _ -> baixar(v) }
            .setNegativeButton("Depois") { _, _ -> adiar(System.currentTimeMillis() + 24 * 3_600_000L) }
            .show()
    }

    /** Bloqueante (fora da thread da tela): baixa e confere o APK. Devolve o arquivo ou lança erro com a explicação. */
    fun baixar(v: Versao): File {
        val dir = File(act.cacheDir, "atualizacao").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val arq = File(dir, "nvplayer.apk")
        Http.salvar(v.apk, arq)
        @Suppress("DEPRECATION")
        val info = act.packageManager.getPackageArchiveInfo(arq.path, 0)
        val cod = info?.let { if (Build.VERSION.SDK_INT >= 28) it.longVersionCode else @Suppress("DEPRECATION") it.versionCode.toLong() }
        if (info == null || info.packageName != act.packageName || cod == null || cod <= versaoAtual()) {
            arq.delete()
            error("O arquivo baixado não é uma atualização do NVPlayer (talvez o download tenha sido interrompido). Tente de novo.")
        }
        return arq
    }

    /** Na tela: abre o instalador, ou antes a configuração que libera instalar apps pelo NVPlayer. */
    fun instalar(arq: File) {
        if (Build.VERSION.SDK_INT >= 26 && !act.packageManager.canRequestPackageInstalls()) {
            pendente = arq
            AlertDialog.Builder(act, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Liberar a atualização")
                .setMessage("Só na primeira vez: o aparelho precisa permitir que o NVPlayer instale a atualização.\n\n" +
                    "Na tela que vai abrir, ligue \"Permitir desta fonte\" e depois aperte Voltar.\n\n" +
                    "No Fire TV: Configurações → Minha Fire TV → Opções do desenvolvedor → Instalar apps desconhecidos → NVPlayer: Ligado.")
                .setPositiveButton("Abrir a configuração") { _, _ ->
                    try {
                        act.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${act.packageName}")))
                    } catch (_: ActivityNotFoundException) {
                        toast("Abra pelo menu do aparelho: Configurações → Minha Fire TV → Opções do desenvolvedor → " +
                            "Instalar apps desconhecidos → NVPlayer. Depois volte ao NVPlayer.")
                    }
                }
                .setNegativeButton("Agora não") { _, _ -> pendente = null }
                .show()
            return
        }
        pendente = null
        val uri = FileProvider.getUriForFile(act, "${act.packageName}.arquivos", arq)
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try { act.startActivity(i) } catch (_: ActivityNotFoundException) {
            toast("O aparelho não abriu o instalador. Baixe pelo Downloader: nervia.com.br/nvplayer.apk")
        }
    }

    /** Chamar no onResume: se a pessoa acabou de liberar a permissão, segue com a instalação. */
    fun voltou() {
        val p = pendente ?: return
        if (Build.VERSION.SDK_INT < 26 || act.packageManager.canRequestPackageInstalls()) instalar(p)
    }

    companion object {
        fun lerVersao(json: String): Versao? {
            val o = JSONObject(json).optJSONObject("versao") ?: return null
            val c = o.optLong("codigo", 0)
            val apk = o.optString("apk")
            if (c <= 0 || !apk.startsWith("https://")) return null
            return Versao(c, o.optString("nome").ifBlank { c.toString() }, apk, o.optString("novidades").ifBlank { null })
        }
    }
}
