package br.com.nervia.midia

import android.annotation.SuppressLint
import android.app.Application
import android.util.Log
import kotlin.system.exitProcess

/** Se o app travar (exceção não tratada), agenda a reabertura em 3 s e encerra o processo. */
class App : Application() {
    // não repassa ao tratador padrão de propósito: ele mostraria "o app parou" na TV e ninguém está lá para fechar
    @SuppressLint("DefaultUncaughtExceptionDelegation")
    override fun onCreate() {
        super.onCreate()
        Thread.setDefaultUncaughtExceptionHandler { _, e ->
            Log.e("MidiaIndoor", "falha; reabrindo", e)
            runCatching { Relancar.agendar(this, 3_000) }
            android.os.Process.killProcess(android.os.Process.myPid())
            exitProcess(10)
        }
    }
}
