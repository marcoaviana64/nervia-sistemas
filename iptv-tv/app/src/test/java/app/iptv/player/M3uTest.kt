package app.iptv.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class M3uTest {
    private fun ler(s: String) = M3u.ler(s.reader().buffered()).itens

    @Test fun formatoPadrao() {
        val l = ler("""
            #EXTM3U url-tvg="http://epg"
            #EXTINF:-1 tvg-id="globo.br" tvg-name="Globo HD" tvg-logo="http://x/globo.png" group-title="Abertos, HD",Globo RJ, HD
            http://srv:8080/live/u/p/1.ts

            #EXTINF:-1 group-title="Esportes",ESPN
            #EXTVLCOPT:http-user-agent=MeuAgente
            #EXTVLCOPT:http-referrer=http://ref/
            http://srv/espn.m3u8
        """.trimIndent())
        assertEquals(2, l.size)
        assertEquals("Globo RJ, HD", l[0].nome)
        assertEquals("Abertos, HD", l[0].grupo)
        assertEquals("http://x/globo.png", l[0].logo)
        assertEquals("globo.br", l[0].tvgId)
        assertNull(l[0].userAgent)
        assertEquals("ESPN", l[1].nome)
        assertEquals("MeuAgente", l[1].userAgent)
        assertEquals("http://ref/", l[1].referer)
    }

    @Test fun semGrupoEExtgrp() {
        val l = ler("#EXTM3U\n#EXTINF:-1,Canal A\n#EXTGRP:Notícias\nhttp://a\n#EXTINF:-1,Canal B\nhttp://b\nhttp://c/arquivo.mp4?x=1\n")
        assertEquals(listOf("Notícias", "Sem grupo", "Sem grupo"), l.map { it.grupo })
        assertEquals("arquivo.mp4", l[2].nome)
    }

    @Test fun cabecalhosKodi() {
        val l = ler("#EXTINF:-1,X\nhttp://a/b.m3u8|User-Agent=Mozilla%2F5.0&Referer=http://r\n")
        assertEquals("http://a/b.m3u8", l[0].url)
        assertEquals("Mozilla/5.0", l[0].userAgent)
        assertEquals("http://r", l[0].referer)
    }

    @Test fun nomeVazioUsaTvgName() {
        val l = ler("\uFEFF#EXTM3U\r\n#EXTINF:-1 tvg-name=\"SBT\",\r\nhttp://s\r\n")
        assertEquals("SBT", l[0].nome)
    }

    @Test fun separaFilmesESeries() {
        val l = M3u.ler("""
            #EXTM3U x-tvg-url="http://guia/a.xml.gz,http://guia/b.xml"
            #EXTINF:-1 group-title="Notícias",GloboNews
            http://srv:80/live/u/p/1.ts
            #EXTINF:-1 group-title="Filmes | Ação",Duro de Matar (1988)
            http://srv:80/movie/u/p/2.mkv
            #EXTINF:-1 group-title="Séries | Drama",Breaking Bad S01 E01
            http://srv:80/series/u/p/3.mp4
            #EXTINF:-1 group-title="Lançamentos",Filme Solto
            http://cdn/filme.mp4
            #EXTINF:-1 group-title="Novelas",Novela S02E10
            http://cdn/novela.mp4
        """.trimIndent().reader().buffered())
        assertEquals(listOf(Tipo.AO_VIVO, Tipo.FILME, Tipo.SERIE, Tipo.FILME, Tipo.SERIE), l.itens.map { it.tipo })
        assertEquals(listOf("http://guia/a.xml.gz", "http://guia/b.xml"), l.epg)
    }

    @Test fun buscaSemAcento() = assertEquals("noticias sao paulo", semAcento("Notícias São Paulo"))
}
