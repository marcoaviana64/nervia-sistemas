package app.iptv.player

import android.util.Base64
import android.util.JsonReader
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class XtreamTest {
    private val x = Xtream("srv.tv:8080/", "joao", "s3nh@")

    @Test fun enderecos() {
        assertEquals("http://srv.tv:8080", x.base)
        assertEquals("http://srv.tv:8080/live/joao/s3nh%40/10.ts", x.urlAoVivo("10", "ts"))
        assertEquals("http://srv.tv:8080/movie/joao/s3nh%40/20.mkv", x.urlFilme("20", "mkv"))
        assertTrue(x.api("get_vod_streams").endsWith("username=joao&password=s3nh%40&action=get_vod_streams"))
        assertEquals("https://a.b", Xtream.normalizar("https://a.b/player_api.php?x=1"))
        assertEquals(Triple("http://srv.tv:8080", "joao", "123"),
            Xtream.deLink("http://srv.tv:8080/get.php?username=joao&password=123&type=m3u_plus&output=ts"))
        assertNull(Xtream.deLink("http://srv.tv/lista.m3u"))
    }

    @Test fun listas() {
        val cats = Xtream.lerCategorias(JsonReader("""[{"category_id":"1","category_name":"Ação "},{"category_id":2,"category_name":"Drama"}]""".reader()))
        assertEquals(mapOf("1" to "Ação", "2" to "Drama"), cats)
        val l = Xtream.lerLista(JsonReader("""[
            {"num":1,"name":"Filme A (2019)","stream_id":20,"stream_icon":"http://i/a.jpg","rating":"7.25","category_id":"1","container_extension":"mkv","is_adult":"0","extra":{"a":[1,2]}},
            {"num":"2","name":"Filme B","stream_id":"21","stream_icon":"","rating":0,"category_ids":[2],"container_extension":null,"year":"2021","is_adult":1},
            {"name":"sem id"}
        ]""".reader()), Tipo.FILME, cats) { id, e -> x.urlFilme(id, e ?: "mp4") }
        assertEquals(2, l.size)
        assertEquals(Item(Tipo.FILME, "Filme A (2019)", "http://srv.tv:8080/movie/joao/s3nh%40/20.mkv", "Ação", "http://i/a.jpg",
            id = "20", ano = "2019", nota = "7,3", num = 1), l[0])
        assertEquals("Drama", l[1].grupo); assertEquals("2021", l[1].ano); assertNull(l[1].nota); assertNull(l[1].logo)
        assertTrue(l[1].adulto); assertTrue(l[1].url.endsWith("/21.mp4"))
        // resposta que não é lista (servidor sem filmes) não quebra
        assertTrue(Xtream.lerLista(JsonReader("{}".reader()), Tipo.FILME, cats) { _, _ -> "" }.isEmpty())
    }

    @Test fun serieComTemporadasEmObjetoOuLista() {
        val obj = """{"info":{"plot":"Sinopse","genre":"Drama","releaseDate":"2008-01-20","rating":"9","cover":"http://c"},
            "episodes":{"2":[{"id":"7","episode_num":1,"title":"Volta","container_extension":"mkv","info":{"duration":"00:47:00"}}],
                        "1":[{"id":"6","episode_num":2,"title":"Dois","season":1},{"id":"5","episode_num":1,"title":"Piloto","season":"1"}]}}"""
        val s = Xtream.lerSerie(obj, x::urlEpisodio)
        assertEquals(listOf(1, 2), s.episodios.keys.toList())
        assertEquals(listOf("Piloto", "Dois"), s.episodios[1]!!.map { it.titulo })
        assertEquals("http://srv.tv:8080/series/joao/s3nh%40/7.mkv", s.episodios[2]!![0].url)
        assertEquals("00:47:00", s.episodios[2]!![0].duracao)
        assertEquals("2008", s.ano); assertEquals("9,0", s.nota)
        val lista = """{"info":[],"episodes":[[{"id":"9","season":3,"episode_num":1,"title":"X"}]]}"""
        assertEquals(listOf(3), Xtream.lerSerie(lista, x::urlEpisodio).episodios.keys.toList())
    }

    @Test fun guiaCurtoEConta() {
        fun b(s: String) = Base64.encodeToString(s.toByteArray(), Base64.NO_WRAP)
        val l = Xtream.lerEpgCurto("""{"epg_listings":[
            {"title":"${b("Jornal")}","description":"${b("Notícias do dia")}","start_timestamp":"2000","stop_timestamp":"3000"},
            {"title":"${b("Novela")}","description":"","start_timestamp":"1000","stop_timestamp":"2000"}]}""")
        assertEquals(listOf("Novela", "Jornal"), l.map { it.titulo })
        assertEquals(Programa(2_000_000, 3_000_000, "Jornal", "Notícias do dia"), l[1])
        val c = Xtream.lerConta("""{"user_info":{"auth":1,"status":"Active","exp_date":"1800000000","max_connections":"2","active_cons":0,"allowed_output_formats":["m3u8","ts"]}}""")
        assertEquals(1_800_000_000_000, c.validade); assertEquals("2", c.conexoes); assertEquals(listOf("m3u8", "ts"), c.formatos)
    }

    @Test fun xmltvComFusoEGzip() {
        val xml = """<?xml version="1.0" encoding="UTF-8"?><tv>
            <channel id="Globo.br"><display-name>Globo</display-name></channel>
            <programme start="20261117200000 -0300" stop="20261117210000 -0300" channel="Globo.br"><title lang="pt">Jornal</title><desc>Resumo</desc></programme>
            <programme start="20261117210000 -0300" stop="20261117220000 -0300" channel="globo.br"><title>Novela</title></programme>
            <programme start="20261117200000 +0000" stop="20261117210000 +0000" channel="outro"><title>Fora</title></programme>
            <programme start="20200101000000 +0000" stop="20200101010000 +0000" channel="globo.br"><title>Velho</title></programme>
        </tv>"""
        val gz = ByteArrayOutputStream().also { o -> GZIPOutputStream(o).use { it.write(xml.toByteArray()) } }.toByteArray()
        val f = java.io.File.createTempFile("guia", ".dat").apply { writeBytes(gz); deleteOnExit() }
        val de = java.time.Instant.parse("2026-11-17T00:00:00Z").toEpochMilli()
        val m = Xmltv.abrir(f).use { Xmltv.ler(it, setOf("globo.br"), de, de + 3L * 86_400_000) }
        assertEquals(setOf("globo.br"), m.keys)
        assertEquals(listOf("Jornal", "Novela"), m["globo.br"]!!.map { it.titulo })
        // 20h em Brasília = 23h UTC
        assertEquals(java.time.Instant.parse("2026-11-17T23:00:00Z").toEpochMilli(), m["globo.br"]!![0].inicio)
        assertEquals("Resumo", m["globo.br"]!![0].descricao)
    }
}
