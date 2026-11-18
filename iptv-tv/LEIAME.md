# NVPlayer — app para TV Android (uso pessoal do Marco)

Antes chamado "Player IPTV"; nome NVPlayer desde a 2.3 (17/11/2026). O pacote continua `app.iptv.player`.

Player de listas IPTV no formato **M3U / M3U8** para Android TV / Google TV, TV box e Fire TV (Android 7.0+), também roda em
celular e tablet. Mesma base técnica do app da TV do Mídia Indoor (`midia-tv/`: Kotlin + Media3/ExoPlayer), mas **não tem
ligação com a Plataforma Nervia**: não usa o Supabase, não aparece na Área do Cliente e o APK NÃO vai para `site/`.

## O que faz (versão 2.0)
- **Dois formatos de lista**:
  - **Login e senha (Xtream Codes)** — servidor com a porta, usuário e senha (`Xtream.kt`, `player_api.php`). Separa
    **TV ao vivo, Filmes e Séries**, com capas, sinopse, ano, nota, temporadas e episódios, e mostra a validade e as telas
    da assinatura em Ajustes. Canais ao vivo em TS (padrão) ou HLS (Ajustes → Canais ao vivo em).
  - **Link M3U** — filmes e séries separados pelo endereço (`/movie/`, `/series/`, listas `m3u_plus`) ou pela extensão
    do arquivo; o resto é TV ao vivo. Link M3U que tem `username` e `password` vira login Xtream sozinho.
- **Servidor já preenchido** (2.2, pedido do Marco em 17/11/2026): `http://p.urldata.gy` (`Repositorio.SERVIDOR_PADRAO`; na 2.2 era `auth.urltech.gy`, endereço errado) no login da TV e na página do celular; editável, porque o provedor troca o endereço de tempos em tempos. Falha de conexão no login avisa que o endereço pode ter mudado.
- **Configuração pelo celular**: a TV mostra um QR code; o celular (mesma rede Wi-Fi) abre uma página servida pela própria
  TV (`http://<ip da TV>:8080`) com os dois formulários. Também dá para digitar com o controle. O servidor só fica ligado
  com a tela aberta e nunca devolve o login salvo.
- **Guia de programação (EPG)**: Xtream = `get_short_epg` canal a canal (cache de 10 min); M3U = XMLTV do cabeçalho
  (`url-tvg` / `x-tvg-url`) ou o informado na configuração, baixado a cada 12 h (aceita `.gz`), guardando só os canais da
  lista e de 3 h atrás até 48 h à frente. Aparece no quadro embaixo da lista, como "Agora:" na linha do canal e na barra ao
  trocar de canal; Menu → Guia deste canal.
- **Abas**: TV ao vivo · Filmes · Séries · Ajustes. Em cada uma: ★ Favoritos, ▶ Continuar assistindo (filmes e séries),
  Todos e as categorias; busca sem acento por todas as palavras.
- **Fichas**: filme (capa, ano, duração, gênero, nota, sinopse, direção, elenco; Assistir / Continuar de mm:ss / Do início /
  Favoritar) e série (temporadas, episódios com ◐ parou em / ✓ assistido, "Continuar T2 E3").
- **Continuar de onde parou**: posição guardada a cada 15 s e ao sair; termina sozinho o episódio e passa ao próximo.
- **Áudio e legenda**: Menu assistindo → Áudio (dublado/original, 5.1…), Legenda (ou desligada), Tela (ajustar, esticar,
  preencher). A escolha de idioma vale para os próximos (padrão: áudio em português).
- **Controle dos pais**: já vem LIGADO com a senha padrão **0000** (2.1, pedido do Marco em 17/11/2026); trocar ou desligar em Ajustes (4 a 8 números; desligado fica guardado e o padrão não volta). Grupos adultos (nome com adult/xxx/+18… ou marcados pelo
  servidor) ficam com 🔒, somem de Todos, Favoritos e da busca e pedem a senha uma vez por uso do app.
- **Controle remoto**: TV — ▲▼/CH± troca canal, OK ou ◀▶ abre a lista, Menu = opções, Voltar = lista. Filme/série — OK
  pausa, ◀ −10 s, ▶ +30 s, Menu = opções, Voltar = sai e guarda onde parou. Na lista, segurar OK (ou Menu) = favorito.
- Abre direto no último canal assistido; reconecta sozinho (3 tentativas); endereço sem extensão que é HLS é reaberto como HLS;
  `#EXTVLCOPT` e `url|User-Agent=…` respeitados; sem eles o app se apresenta como VLC.
- Tudo (login, posições, favoritos, senha dos pais) fica só no aparelho, sem backup na nuvem.

- **DNS alternativo** (2.4, 18/11/2026: em outro local o login dava "Não foi possível conectar ao servidor auth.urltech.gy",
  provavelmente bloqueio por DNS da operadora): toda a rede do app (login, listas, capas e o vídeo, via
  `media3-datasource-okhttp`) passa pelo OkHttp com `DnsAlternativo` (`Rede.kt`): procura o nome no DNS do local E por
  DNS-over-HTTPS (Cloudflare 1.1.1.1, depois Google 8.8.8.8, guardado 10 min) e tenta os endereços dos dois (se não
  concordam, o do DNS alternativo primeiro). Não resolve bloqueio por IP. A mensagem de erro agora diz a causa
  (nome não encontrado, sem resposta, conexão recusada, https). Teste: `DnsTest`.

- **Endereço do servidor pelo site** (2.5, pedido do Marco em 18/11/2026: "um local com o link; eu sempre atualizo e o
  aplicativo pega deste local"): `site/nvplayer.json` = `{"servidores": ["http://…", "http://…"]}`, publicado em
  https://nervia.com.br/nvplayer.json (sem cache). O 1º vem preenchido no login (`Repositorio.servidorPadrao`, TV e
  página do celular; na primeira vez a TV busca o arquivo e troca o campo se ninguém mexeu). Se o servidor salvo não
  responder, o app lê o arquivo, tenta os outros endereços com o mesmo usuário e senha e grava o que funcionar
  (`carregarXtream`). A última lista lida fica no aparelho (`srv_publicados`). Para trocar: editar o arquivo no GitHub
  (ou pedir ao Claude) e fazer o merge na main; não precisa de APK novo. Teste: `TelaTest.servidorDoSite`.

- **Atualização pelo próprio app** (2.6, pedido do Marco em 18/11/2026): o mesmo `site/nvplayer.json` tem o bloco
  `"versao": {"codigo": 8, "nome": "2.6", "apk": "https://nervia.com.br/nvplayer.apk", "novidades": "…"}`. Ao abrir, o app
  lê o arquivo; com `codigo` maior que o `versionCode` instalado, pergunta "Nova versão do NVPlayer" (Atualizar agora /
  Depois = não pergunta de novo por 1 dia; Ajustes → "Atualizar o app" / "Procurar atualização do app" pergunta na hora).
  Baixa o APK para `cache/atualizacao`, confere pacote e versão (`getPackageArchiveInfo`) e abre o instalador do Android
  pelo FileProvider (`Atualizador.kt`, permissão `REQUEST_INSTALL_PACKAGES`). Na primeira vez o Android pede para
  liberar "instalar apps" para o NVPlayer (abre a configuração; no Fire TV: Opções do desenvolvedor → Instalar apps
  desconhecidos). **Ao publicar APK novo: subir `versionCode`, copiar para `site/nvplayer.apk` e pôr o MESMO número em
  `codigo` (e o nome/novidades) no `nvplayer.json`, no mesmo merge.** A mesma chave de assinatura é obrigatória.

- **TV ao vivo em três colunas** (2.7, pedido do Marco em 18/11/2026, com a foto de outro app): grupos · canais · prévia.
  O mesmo `PlayerView` muda de lugar (`posicionarVideo`): com a lista aberta na aba TV fica na caixa 16:9 da direita
  (`previa`), com a programação do canal embaixo (`guiaBox`, nome em negrito); em tela cheia volta para a tela toda.
  OK num canal = toca na prévia; OK de novo no mesmo canal = tela cheia; Voltar = volta à lista com a prévia. Recados
  do player (carregando, sem sinal) aparecem dentro da prévia (`avisarVideo`). Filmes, Séries e Ajustes continuam em 2 colunas.

- **Visual novo** (2.8, pedido do Marco em 18/11/2026: "design moderno, estilo Apple"): `Estilo.kt` (degradê escuro,
  cartões arredondados, item focado em azul com leve aumento, botões em pílula, campos arredondados, `Barrinha` com o
  andamento do programa em cada canal), topo com a marca, abas em pílulas e relógio, programação com o "AGORA"
  (`guiaRica`), barra da tela cheia em cartão. O vídeo usa TextureView (`res/layout/video.xml`) para a prévia ter
  cantos arredondados.
- **Atualização da lista sem "travar"** (2.8; o Marco viu a TV parar e em Ajustes estava atualizando a lista): a
  atualização em segundo plano mostra "⟳ Atualizando a lista…" no canto (`mostrarStatus`, com a etapa) e "✓ Lista
  atualizada" no fim; roda com prioridade baixa (`THREAD_PRIORITY_BACKGROUND`) e, se a pessoa estiver em tela cheia,
  a lista nova só entra quando ela abrir a lista (`catalogoPendente`), para o vídeo não engasgar.

## Ainda não tem (ideias)
Grade de programação de todos os canais ao mesmo tempo, assistir programa que já passou (catch-up), gravação.

## Compilar
JDK 17+ e Android SDK (platform 36, build-tools 36), `local.properties` com `sdk.dir=...`.
```
./gradlew testReleaseUnitTest lintRelease assembleRelease
```
APK: `app/build/outputs/apk/release/app-release.apk`. Testes: `M3uTest`, `XtreamTest` (API Xtream, séries nos dois formatos de resposta, guia curto, XMLTV com fuso e gzip) e
`TelaTest` (Robolectric, tela 1920×1080, servidor imitado: login pelo "celular", abas, guia, controle dos pais, continuar
assistindo, fichas de filme e série, Ajustes; link M3U; link M3U com login virando Xtream), que grava `app/build/tela-*.png`.
No Robolectric o relógio fica parado: o teste avança com `idleFor`. Se o Maven Central for bloqueado: pôr temporariamente
`maven("https://maven-central.storage-download.googleapis.com/maven2")` antes do `mavenCentral()` em `settings.gradle.kts`,
baixar os `android-all-instrumented` 14 e 15 desse espelho numa pasta e rodar com `-Probolectric.dir=<pasta>`.

## Instalar
Link para a TV: **https://nervia.com.br/nvplayer.apk** (o antigo nervia.com.br/player.apk leva ao novo, por `site/_redirects`) (digitar no app Downloader ou no navegador da TV). Ao gerar APK novo, copiar
`app/build/outputs/apk/release/app-release.apk` para `site/nvplayer.apk` (subir `versionCode` antes).

Sem Play Store: pelo ADB (`adb install -r app-release.apk`), por um app de enviar arquivos para a TV, ou pelo Downloader com um
link direto para o APK. Na TV, permitir "Fontes desconhecidas" / "Instalar apps desconhecidos" para o app usado.

## Assinatura
`assinatura.properties` (fora do git: `arquivo`, `senha`, `apelido`, `senha_chave`). Sem ele sai com a chave de depuração da
máquina que compilou: uma atualização só instala por cima se for assinada com a mesma chave (senão, desinstalar e instalar).
Ao mudar o app, subir `versionCode` e `versionName` em `app/build.gradle.kts`.
