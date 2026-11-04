package br.com.nervia.midia

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ModelosTest {
    private val json = """{"ok":true,"situacao":"ok","tela":"Hall","playlist":"Promo","conteudo":"abc","chave_api":"K",
      "intervalo_playlist_s":300,"intervalo_sinal_s":10,"itens":[
        {"id":"F1","nome":"01_promo.MP4","tipo":"video","md5":"d41d8cd98f00b204e9800998ecf8427e","tamanho":1000,"tempo_s":null,"url":"https://x/F1?alt=media","chave_recurso":null},
        {"id":"F2","nome":"02 cardápio.jpeg","tipo":"imagem","md5":"aa","tamanho":10,"tempo_s":12,"url":"https://x/F2?alt=media","chave_recurso":"0-rk"},
        {"id":"F3","nome":"x","tipo":"outro","md5":"","tamanho":1,"tempo_s":null,"url":"u"}]}"""

    @Test fun lePlaylistDaFuncao() {
        val p = Playlist.deJson(JSONObject(json))
        assertEquals("Hall", p.tela)
        assertEquals(listOf("F1", "F2"), p.itens.map { it.id })        // tipo desconhecido fica fora
        assertNull(p.itens[0].tempoS)
        assertEquals(12, p.itens[1].tempoS)
        assertEquals("0-rk", p.itens[1].chaveRecurso)
        assertNull(p.itens[0].chaveRecurso)
        assertEquals(60, p.intervaloSinalS)                              // mínimo de 60 s
    }

    @Test fun nomeNoAparelhoMudaComOConteudo() {
        val i = Playlist.deJson(JSONObject(json)).itens[0]
        assertEquals("F1_d41d8cd98f00b204e9800998ecf8427e.mp4", i.arquivo)
        assertNotEquals(i.arquivo, i.copy(md5 = "outro").arquivo)
        assertEquals("F2_aa.jpeg", Playlist.deJson(JSONObject(json)).itens[1].arquivo)
    }
}
