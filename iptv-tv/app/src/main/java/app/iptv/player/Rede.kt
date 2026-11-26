package app.iptv.player

import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.dnsoverhttps.DnsOverHttps
import java.io.IOException
import java.net.ConnectException
import java.net.InetAddress
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

/**
 * Rede do app (2.4). Muitas operadoras no Brasil bloqueiam endereços de IPTV pelo DNS: o nome não é encontrado
 * ou aponta para um endereço que não responde. Por isso o nome é procurado no DNS da internet do local E num DNS
 * alternativo por HTTPS (Cloudflare, depois Google); a conexão tenta os endereços de um e de outro.
 */
class DnsAlternativo(
    private val sistema: (String) -> List<InetAddress> = { Dns.SYSTEM.lookup(it) },
    private val alternativo: (String) -> List<InetAddress> = ::porHttps,
    private val agora: () -> Long = System::currentTimeMillis,
    private val espera: Long = 1_500,
) : Dns {
    private val fila = java.util.concurrent.Executors.newCachedThreadPool { r -> Thread(r, "dns-alternativo").apply { isDaemon = true } }
    private val cache = ConcurrentHashMap<String, Pair<Long, List<InetAddress>>>()

    override fun lookup(hostname: String): List<InetAddress> {
        if (local(hostname)) return sistema(hostname)
        // 2.10: os dois DNS ao mesmo tempo. Se o do local achou, o alternativo tem só [espera] ms para responder
        // (antes a conexão esperava o alternativo até o fim: com ele bloqueado, até ~24 s parada a cada minuto).
        val guardado = guardado(hostname)
        val futuro = if (guardado == null) fila.submit<List<InetAddress>> { alt(hostname) } else null
        val doSistema = try { sistema(hostname) } catch (_: UnknownHostException) { emptyList() }
        val doAlternativo = guardado ?: try {
            futuro!!.get(if (doSistema.isEmpty()) 15_000 else espera, TimeUnit.MILLISECONDS)
        } catch (_: Exception) { emptyList() }
        if (doSistema.isEmpty() && doAlternativo.isEmpty())
            throw UnknownHostException("$hostname não foi encontrado (nem pelo DNS da internet deste local, nem pelo DNS alternativo)")
        // 2.35: o endereço do DNS do LOCAL vem sempre primeiro; o alternativo fica só de reserva (usado quando o do
        // local falha, está vazio ou aponta para um endereço que não responde — os casos que o 2.4 queria resolver,
        // pois a conexão tenta os endereços em ordem e passa ao próximo quando um não responde). Antes, quando os dois
        // discordavam, o alternativo vinha na frente: num provedor atrás de CDN (Cloudflare/Google resolvem o nome por
        // um nó de OUTRO país, ex.: Los Angeles), o app conectava por fora do país e o provedor bloqueava a conta
        // por "país não permitido". O DNS do local resolve para o nó do país certo.
        return (doSistema + doAlternativo).distinct()
    }

    /** Resposta do alternativo ainda válida (10 min; a falha também fica guardada 10 min). */
    private fun guardado(host: String): List<InetAddress>? =
        cache[host]?.let { (quando, lista) -> lista.takeIf { agora() - quando < 600_000 } }

    private fun alt(host: String): List<InetAddress> {
        guardado(host)?.let { return it }
        val lista = try { alternativo(host) } catch (_: Exception) { emptyList() }
        cache[host] = agora() to lista
        return lista
    }

    companion object {
        /** Endereço IP, nome da rede local ou "localhost": não passa pelo DNS alternativo. */
        fun local(h: String) = h == "localhost" || !h.contains('.') || h.endsWith(".local") ||
            h.matches(Regex("[0-9.]+")) || h.contains(':')

        private val semDns = OkHttpClient.Builder().connectTimeout(6, TimeUnit.SECONDS).readTimeout(6, TimeUnit.SECONDS).build()
        private fun ip(s: String) = InetAddress.getByName(s) // literal: não consulta DNS
        private val resolvedores by lazy {
            listOf(
                DnsOverHttps.Builder().client(semDns).url("https://cloudflare-dns.com/dns-query".toHttpUrl())
                    .bootstrapDnsHosts(ip("1.1.1.1"), ip("1.0.0.1")).includeIPv6(false).build(),
                DnsOverHttps.Builder().client(semDns).url("https://dns.google/dns-query".toHttpUrl())
                    .bootstrapDnsHosts(ip("8.8.8.8"), ip("8.8.4.4")).includeIPv6(false).build(),
            )
        }

        fun porHttps(host: String): List<InetAddress> {
            for (r in resolvedores) try { return r.lookup(host) } catch (_: Exception) {}
            return emptyList()
        }
    }
}

object Rede {
    val cliente: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .dns(DnsAlternativo())
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .followRedirects(true).followSslRedirects(true)
            .build()
    }

    /** Explicação curta do erro de rede, para mostrar na tela. */
    fun explicar(e: Throwable): String = when (e) {
        is UnknownHostException -> "o nome do servidor não foi encontrado, nem pelo DNS alternativo"
        is SocketTimeoutException -> "o servidor não respondeu a tempo"
        is ConnectException, is NoRouteToHostException -> "a conexão foi recusada ou não chegou ao servidor"
        is SSLException -> "falha na conexão segura (https)"
        is IOException -> "a conexão caiu (${e.message ?: e.javaClass.simpleName})"
        else -> e.message ?: e.javaClass.simpleName
    }
}
