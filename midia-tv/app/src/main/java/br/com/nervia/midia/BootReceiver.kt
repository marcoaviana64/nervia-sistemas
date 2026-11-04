package br.com.nervia.midia

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Abre o app quando a TV/box liga (e depois de uma atualização do app). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val acoes = setOf(Intent.ACTION_BOOT_COMPLETED, "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON", Intent.ACTION_MY_PACKAGE_REPLACED)
        if (intent.action !in acoes) return
        // abrir direto daqui funciona até o Android 9; do 10 em diante, só com "Sobrepor a outros apps" concedido
        runCatching {
            ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }.onFailure {
            // se o sistema recusar, tenta pelo alarme em alguns segundos (mesma regra)
            Relancar.agendar(ctx, 5_000)
        }
    }
}
