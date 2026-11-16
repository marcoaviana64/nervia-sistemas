# Player IPTV — app para TV Android (uso pessoal do Marco)

Player de listas IPTV no formato **M3U / M3U8** para Android TV / Google TV, TV box e Fire TV (Android 7.0+), também roda em
celular e tablet. Mesma base técnica do app da TV do Mídia Indoor (`midia-tv/`: Kotlin + Media3/ExoPlayer), mas **não tem
ligação com a Plataforma Nervia**: não usa o Supabase, não aparece na Área do Cliente e o APK NÃO vai para `site/`.

## O que faz
- **Primeira abertura**: tela "Configurar a lista IPTV" com QR code. O celular (mesma rede Wi-Fi) lê o QR, abre uma página
  servida pela própria TV (`http://<ip da TV>:8080`), cola o endereço M3U do provedor e envia. Também dá para digitar com o
  controle. O servidor só fica ligado enquanto essa tela está aberta e nunca devolve o endereço salvo.
- Baixa a lista, guarda uma cópia no aparelho (abre na hora da próxima vez) e atualiza sozinha em segundo plano quando a cópia
  tem mais de 24 h. "↻ Atualizar lista" baixa na hora; "⚙ Trocar lista" volta à configuração.
- **Lista**: grupos à esquerda (★ Favoritos, Todos, e os grupos do `group-title`), canais à direita com número, logo e ★.
  Busca sem acento por todas as palavras. **Segurar OK** (ou apertar Menu) num canal marca/desmarca favorito.
- **Assistindo**: ▲/▼ e CH+/CH− trocam de canal dentro do grupo; OK, ◀, ▶, Menu ou Voltar abrem a lista; Info mostra o nome.
  Em filme/episódio (conteúdo com duração): OK pausa, ◀ volta 10 s, ▶ avança 30 s.
- Abre direto no **último canal** assistido. Reconecta sozinho (3 tentativas) quando o canal cai; canal ao vivo que o servidor
  encerra é reaberto. Endereço sem extensão que na verdade é HLS é reaberto como HLS.
- Formatos: HLS (`.m3u8`), MPEG-TS (`.ts`, o comum do Xtream), MP4/MKV e DASH. `#EXTVLCOPT:http-user-agent` / `http-referrer`
  e o estilo Kodi `url|User-Agent=…&Referer=…` são respeitados; sem eles o app se apresenta como VLC (muitos provedores
  recusam o agente padrão do Android).
- O endereço da lista (que leva usuário e senha) fica só no aparelho, sem backup na nuvem.

## Ainda não tem (ideias)
Guia de programação (EPG/XMLTV), login Xtream Codes com abas de Filmes/Séries, controle dos pais, troca de áudio/legenda.

## Compilar
JDK 17+ e Android SDK (platform 36, build-tools 36), `local.properties` com `sdk.dir=...`.
```
./gradlew testReleaseUnitTest lintRelease assembleRelease
```
APK: `app/build/outputs/apk/release/app-release.apk`. O `TelaTest` (Robolectric) faz o primeiro uso inteiro numa tela 1920×1080
(configuração → envio pelo "celular" → lista baixada de um servidor imitado) e grava `app/build/tela-configurar.png` e
`tela-lista.png`. Se o Maven Central for bloqueado: pôr temporariamente
`maven("https://maven-central.storage-download.googleapis.com/maven2")` antes do `mavenCentral()` em `settings.gradle.kts`,
baixar os `android-all-instrumented` 14 e 15 desse espelho numa pasta e rodar com `-Probolectric.dir=<pasta>`.

## Instalar
Sem Play Store: pelo ADB (`adb install -r app-release.apk`), por um app de enviar arquivos para a TV, ou pelo Downloader com um
link direto para o APK. Na TV, permitir "Fontes desconhecidas" / "Instalar apps desconhecidos" para o app usado.

## Assinatura
`assinatura.properties` (fora do git: `arquivo`, `senha`, `apelido`, `senha_chave`). Sem ele sai com a chave de depuração da
máquina que compilou: uma atualização só instala por cima se for assinada com a mesma chave (senão, desinstalar e instalar).
Ao mudar o app, subir `versionCode` e `versionName` em `app/build.gradle.kts`.
