package br.com.nervia.midia

import android.app.ActivityOptions
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.provider.Settings

/** Agenda a reabertura do app (depois de uma falha, ou se ele foi fechado/saiu da tela). */
object Relancar {
    private const val PEDIDO = 4711

    private fun pendente(ctx: Context, flags: Int): PendingIntent? {
        val i = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val opcoes = if (Build.VERSION.SDK_INT >= 35) {
            ActivityOptions.makeBasic().setPendingIntentCreatorBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED).toBundle()
        } else null
        return PendingIntent.getActivity(ctx, PEDIDO, i, flags or PendingIntent.FLAG_IMMUTABLE, opcoes)
    }

    fun agendar(ctx: Context, emMs: Long) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = pendente(ctx, PendingIntent.FLAG_UPDATE_CURRENT) ?: return
        am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + emMs, pi)
    }

    fun cancelar(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        pendente(ctx, PendingIntent.FLAG_NO_CREATE)?.let { am.cancel(it); it.cancel() }
    }

    /** Android 10+ só deixa o app abrir sozinho (boot, reinício) com "Sobrepor a outros apps" concedido. */
    fun podeAbrirSozinho(ctx: Context) = Build.VERSION.SDK_INT < 29 || Settings.canDrawOverlays(ctx)
}
