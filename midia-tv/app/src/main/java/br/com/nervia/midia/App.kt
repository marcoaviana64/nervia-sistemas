package br.com.nervia.midia

import android.annotation.SuppressLint
import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.util.Log
import kotlin.system.exitProcess

/** Se o app travar (exceção não tratada), agenda a reabertura em 3 s e encerra o processo.
 *  E, quando a tela da TV acende (TV ligada pelo controle, saindo do modo de espera — isso NÃO é um boot, então o BootReceiver
 *  não roda e o Google TV mostra a tela inicial), reabre o app em 3 s (pedido do Marco em 18/11/2026: a TCL da Linum Gávea
 *  ligava na tela inicial e caía no modo ambiente). Precisa de "Sobrepor a outros apps", como o resto da reabertura.
 *  SCREEN_ON só pode ser recebido por registro em código, com o processo vivo: depois de sair da tela o app já agenda a
 *  própria reabertura (Relancar, 3 min), o que mantém o processo de pé durante a espera. */
class App : Application() {
    // não repassa ao tratador padrão de propósito: ele mostraria "o app parou" na TV e ninguém está lá para fechar
    @SuppressLint("DefaultUncaughtExceptionDelegation")
    override fun onCreate() {
        super.onCreate()
        val telaAcesa = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                if (intent.action == Intent.ACTION_SCREEN_ON && Relancar.podeAbrirSozinho(ctx)) runCatching { Relancar.agendar(ctx, 3_000) }
            }
        }
        runCatching { registerReceiver(telaAcesa, IntentFilter(Intent.ACTION_SCREEN_ON)) }
        Thread.setDefaultUncaughtExceptionHandler { _, e ->
            Log.e("MidiaIndoor", "falha; reabrindo", e)
            runCatching { Relancar.agendar(this, 3_000) }
            android.os.Process.killProcess(android.os.Process.myPid())
            exitProcess(10)
        }
    }
}
