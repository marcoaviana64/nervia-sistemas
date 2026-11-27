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
- **Listas compactas** (2.9, pedido do Marco em 18/11/2026 com a foto da 2.8 numa LG: "mais listas aparecendo na tela
  sem rolar"): linhas, grupos, abas e busca mais baixos (nome 15sp, programação 12sp, logo 44×26dp), número do canal
  numa linha só (50dp) e colunas da TV ao vivo 0,22 / 0,38 / 0,40 → cerca de 11 canais na tela em vez de 6. Foto:
  teste `TelaTest.listaCheia` (22 canais, `app/build/tela-lista-cheia.png`).
- **Reconexão sozinha quando o canal trava** (2.10, o Marco: "trava, eu mudo de canal, volto e retorna o sinal"): o
  servidor para de mandar o vídeo sem fechar a conexão. `Vigia.kt` confere a cada 2 s a posição e os quadros mostrados
  (`videoDecoderCounters`); parados por 10 s (ou "Carregando…" por 15 s) = reconecta o canal e mostra "⟳ O sinal
  parou · reconectando…". Problemas ficam registrados (últimos 30, preferências `diario`) e aparecem em Ajustes.
- **DNS sem espera longa** (2.10): o DNS do local e o alternativo consultam ao mesmo tempo; com o do local respondendo,
  o alternativo tem 1,5 s (antes a conexão esperava o alternativo até o fim; bloqueado, até ~24 s a cada minuto).
- **Aviso de vencimento da lista** (2.10, pedido do Marco): a partir de 24 h antes da validade do login Xtream, texto
  pequeno no canto de baixo à esquerda por 10 min a cada 2 h (`Vencimento.kt`); vencida, continua avisando.
- **Tela cheia em SurfaceView** (2.11, o Marco: travava em tela cheia): dois PlayerView — `videoCheio`
  (`res/layout/video_cheio.xml`, SurfaceView: o vídeo vai direto para a tela, mais leve e sem depender da tela do app)
  e `videoPrevia` (TextureView, só na caixa da prévia, por causa dos cantos arredondados); `posicionarVideo` troca o
  player de um para o outro com `PlayerView.switchTargetView`.
- **Resumo de uso para o painel da Nervia** (2.12, pedido do Marco em 19/11/2026; painel em `site/apps/nvplayer/`,
  tabelas `nv_`, migração `..._nvplayer.sql`): `Telemetria.kt` soma no aparelho o tempo de cada canal/filme/série por dia
  (tique de 2 s do vigia, só com o vídeo tocando; episódio conta pela série) e manda UM POST pequeno para a rpc
  `nv_sinal` (chave publicável de `site/config.js`, lida na compilação como no `midia-tv/`) ao fechar e a cada 30 min
  com o app aberto (o 1º depois de a lista carregar). Vai: id do aparelho (uuid guardado), modelo, Android, versão,
  servidor e usuário da lista (NUNCA a senha), situação/validade/telas, quantidades, o que está passando e os últimos
  problemas de vídeo. Falhou = fica guardado (preferências `telemetria`) e vai no próximo. Nos
  testes, `Telemetria.destino` aponta para o servidor imitado (nunca o Supabase de verdade).
- **Reconexão volta ao vivo** (2.13, pergunta do Marco: "a transmissão volta no tempo normal?"): o canal ao vivo
  começa sempre na borda ao vivo (`C.TIME_UNSET` em `iniciar`), nunca no começo da janela DVR; assim a reconexão
  automática (`Vigia`) e a nova tentativa após erro voltam no horário atual da transmissão, não minutos atrás.
- **Servidor escolhido no painel** (2.15, pedido do Marco: "tenho uma área para alterar ou tenho que editar o
  nvplayer.json?"): a lista de servidores saiu do `nvplayer.json` e passou para o Supabase (`nv_servidores`), editável
  na aba **Servidores** do painel NVPlayer; o app lê por `nv_servidores_publicos()` (anon, GET com `apikey`, de
  `Repositorio.urlServidores`). A VERSÃO nova do app continua no `nvplayer.json` (`Repositorio.urlVersao`), que a
  Nervia publica a cada APK. `atualizarServidores()` = servidores (Supabase); `atualizarVersao()` = versão
  (nvplayer.json); `atualizarDoSite()` = os dois (chamado ao abrir e em Ajustes → Procurar atualização). Nos testes,
  o servidor imitado serve os dois caminhos e `Repositorio.urlServidores`/`urlVersao` apontam para ele.
- **Portal pega o servidor do painel** (2.14, pedido do Marco: "o app pegar qual o servidor válido que eu coloco no
  painel"): o endereço preenchido na página do celular (Configurador) é lido a CADA abertura da página, e a tela de
  configuração sempre relê o `nvplayer.json` ao abrir — então o portal mostra o endereço atual se o provedor trocou
  (antes ficava fixo no embutido). A TV já ligada continua trocando sozinha pelo failover (2.5): quando o servidor
  salvo não responde, relê o `nvplayer.json` e passa para o 1º que faz login. Teste `TelaTest.portalMostraServidorDoSite`.
- **Diagnóstico de rede (app + portal)** (2.37, 27/11/2026, o Marco: "informar em algum local, no app ou no portal, por
  onde o equipamento está saindo e se está acontecendo este bloqueio e o link está sendo desviado"): o objeto
  `Diagnostico` (em `Rede.kt`) guarda, por nome de servidor, QUAL DNS resolveu (o da internet do local, o Google ou o
  Cloudflare) e se o DNS do local FALHOU — sinal de possível bloqueio de IPTV naquela internet. **Ajustes → "Diagnóstico
  de rede"**: mostra se o DNS do local respondeu, por qual DNS o servidor foi resolvido (com o IP) e, quando o local
  falhou, o aviso "⚠ Possível bloqueio de IPTV nesta internet" com a saída (liberar o país no painel do provedor ou
  trocar o DNS do roteador). O mesmo resumo (`rede: {dns, bloqueio, ip}`) vai no `nv_sinal` (Telemetria) para o painel
  **NVPlayer — uso** (aba Aparelhos: KPI "com possível bloqueio de IPTV" e, em cada aparelho, "saída: DNS do local" ou
  "⚠ possível bloqueio… saindo pelo Google/Cloudflare"). Sem geolocalização (decisão do Marco: só a rota, zero tráfego
  extra). Migração `20261127000100_nvplayer_rede.sql` (colunas `rede_*` em `nv_aparelhos`; `nv_sinal` lê `p->'rede'`).
  Testes `DnsTest.diagnostico_registraARota`, SQL e a tela do portal.
- **DNS alternativo com a região (Google primeiro)** (2.36, 27/11/2026, o Marco: "continuou não aparecendo os canais; o
  provedor disse que o login é dos EUA; acho que a internet do local tem bloqueio de IPTV"): quando a internet do local
  bloqueia o nome do IPTV, o DNS do local falha e o app é obrigado a usar o alternativo (DoH). O `resolvedores` passou a
  tentar o **Google (`dns.google`) primeiro**, que informa ao servidor de IPTV a região de quem pediu (EDNS Client
  Subnet) e tende a devolver um nó do **Brasil**; o Cloudflare (`cloudflare-dns.com`, que não informa a região e pode
  cair nos EUA) ficou de reserva. Complementa a 2.35: lá o local vem primeiro; aqui, quando só sobra o alternativo, ele
  busca um servidor brasileiro. Nos locais com bloqueio de IPTV, a garantia continua sendo liberar o país/acesso no
  painel do provedor. Testes `DnsTest` seguem válidos (injetam o alternativo direto; a ordem dos DoH não os afeta).
- **DNS do local primeiro** (2.35, 26/11/2026, o Marco com foto do painel do provedor (bitpanel.vip): a conta foi
  bloqueada por "país não permitido", acesso visto de **Los Angeles, EUA**, aparelho **Android TV**, tentando canal ao
  vivo; as violações começaram em 19/11, logo depois do DNS alternativo da 2.4): `DnsAlternativo.lookup` passou a pôr o
  endereço do **DNS do local SEMPRE primeiro**; o alternativo (Cloudflare/Google por HTTPS) fica só de reserva (a
  conexão tenta os endereços em ordem e passa ao próximo quando um não responde — cobre os casos do 2.4: nome não
  encontrado ou endereço que não responde). Antes, quando os dois discordavam, o alternativo vinha na frente; num
  provedor atrás de CDN, o Cloudflare/Google resolviam o nome por um nó de **outro país**, o app conectava por fora do
  Brasil e o provedor bloqueava a conta por país. Teste `DnsTest.dnsLocalPrimeiro_alternativoDeReserva`.
- **Trilho das abas recortado + "TV"** (2.34, 23/11/2026, o Marco: a 2.33 mostrou a data, mas o menu (grande pelos
  números) passava POR CIMA da data e, ao navegar, por cima do logo): o `HorizontalScrollView` das abas estava com
  `clipChildren=false` e as abas transbordavam sobre o relógio/logo; agora `clipChildren=true` (com `clipToPadding=false`
  + 8dp vertical para o "levantar" do foco não cortar), então as abas ficam DENTRO do trilho. E a aba "TV ao vivo"
  virou só **"TV"** (pedido do Marco; `Aba.TV.curto="TV"`, e o rótulo com número passou a usar `a.curto`), economizando
  espaço. Testes esperam/clicam `"TV  "` (duas casas) no lugar de "TV ao vivo".
- **Relógio blindado no topo** (2.33, 23/11/2026, o Marco: com a 2.32 a data piorou — só dia/mês, e vão grande à
  esquerda): a 2.32 aumentou o padding dos DOIS lados, mas com os números grandes das abas do Marco (TV ao vivo 3.298,
  Filmes 17.780, Séries 5.779) a linha estourou e empurrou o relógio para fora, e os 60dp à esquerda viraram vão. Agora:
  as abas entram num `HorizontalScrollView` que ocupa o meio com `weight 1` e ENCOLHE sozinho (se não couberem, rolam
  dentro do trilho; o foco traz a aba à vista), então **nunca empurram o relógio**; padding assimétrico `32dp` à
  esquerda (sem vão) e `56dp` à direita (folga para o overscan da data). Vale para todas as telas.
- **Margem de segurança de TV (overscan)** (2.32, 23/11/2026, o Marco com foto da TV LG: a data/hora no topo ainda
  saía pela borda direita mesmo com a casinha da 2.30): o padding lateral do `painel` passou de 36dp para **60dp** (e o
  topo de 18 para 24dp). Muitas TVs cortam ~5% da borda; 60dp deixam a data (na borda direita) e as abas dentro da área
  visível. Vale para todas as telas.
- **Agenda em LINHA DO TEMPO** (2.31, 23/11/2026, conceito aprovado pelo Marco; antes era 3 colunas): a aba Agenda
  virou uma grade de horários. Topo: pílulas de **DIA** (Hoje, Amanhã, … até onde a EPG tiver), pílulas de **GRUPO**
  (Todos + cada grupo com o nº de canais) e **Buscar canal**. Grade: nome do canal fixo à esquerda, **régua de horas**
  no topo (uma célula por hora) e, para cada canal, os programas como **blocos** com largura proporcional à duração;
  **linha "AGORA"** vermelha no horário atual; o programa ao vivo vem com ● e em negrito; 🔔 nos programas com aviso.
  Começa rolada perto de agora. **OK** num bloco abre o canal; **segurar OK** (ou Menu) liga/desliga o aviso "vai
  começar" (mesmos lembretes `Repositorio.lembretes`/`conferirLembretes`). A rolagem horizontal é compartilhada:
  a régua rola por `scrollTo` (é medida cedo) e as faixas dos canais por **translação** da camada de blocos
  (`aplicarScroll`; `scrollTo` nas linhas de RecyclerView não "pegava" antes do layout). Ao focar um bloco,
  `garantirVisivel` reposiciona a grade inteira para ele caber. Grade do XMLTV já existente (`guia.cheia`,
  `Xtream.urlXmltv`), fuso de Brasília. Teste `TelaTest.agenda` atualizado (grade + aviso por segurar OK).
- **Ícone do app e data no topo** (2.30, 23/11/2026, o Marco com foto: o ícone do app aparecia quebrado na tela inicial
  da TV ao atualizar, e a data saía da tela depois que a aba Início alargou o topo): (1) ícone do app refeito — havia só
  um PNG 96×96 em uma densidade (sem ícone adaptável do Android 8+ nem redondo), e launchers modernos (Google TV/Fire TV,
  celular) mostravam o quadrado quebrado; agora ícone completo (fundo navy + triângulo de play ciano, no visual do app) em
  5 densidades, com **ícone adaptável** (`mipmap-anydpi-v26/ic_launcher.xml`, fundo `drawable/ic_launcher_bg.xml` degradê +
  `ic_launcher_foreground`) e **redondo** (`android:roundIcon`), gerado por `ferramentas/nvplayer_icone.py`; (2) a aba
  **Início** passou a mostrar só um ícone de casa (🏠) em vez da palavra ("curto" no enum `Aba`), economizando espaço no
  topo para a data voltar a caber. Teste `TelaTest.telaInicio` clica na casinha.
- **Coluna de grupos mais larga** (2.29, 23/11/2026, o Marco com foto: os nomes dos grupos "Canais | …" ficavam
  cortados): na TV ao vivo, peso da coluna de grupos 0.18 → 0.24, prévia 0.52 → 0.44, canais 0.32 (em `trocarAba` e no
  `addView(lado)`); cabe mais texto do nome do grupo.
- **Tela de Início (hero) e foco na Agenda** (2.28, 23/11/2026, pedidos do Marco): (1) nova aba **Início** (1ª aba;
  `Aba.INICIO`): hero com pôster grande em destaque (véu escuro, título, ano/★nota, botão ▶ Abrir que abre a ficha) +
  prateleiras horizontais de capinhas (Continuar assistindo, Filmes, Séries, Canais favoritos). `montarInicio`/
  `mostrarInicio`/`popularInicio`/`prateleira`/`cartaoMini`, no mesmo padrão da Agenda (ScrollView próprio no corpo,
  alternado em `trocarAba`). A abertura do app **continua retomando o último canal** — o Início é só a 1ª aba.
  (2) **foco na Agenda**: a lista de canais da Agenda (`AdAgCanais`) tinha o mesmo defeito da TV — no último canal o ▼
  escapava para os grupos; agora volta ao 1º canal. Teste `TelaTest.telaInicio` (grava `tela-inicio.png`). PENDENTE
  (pedido do Marco, aprovado o conceito): **Agenda em linha do tempo** (grade de horários com seletor de dia + grupo em
  pílulas; mockup em `scratchpad/mockup/agenda-timeline.html`) — implementar depois.
- **Vidro, capas menores, foco no fim da lista** (2.27, 23/11/2026, pedidos do Marco): (1) **efeito de vidro fosco**
  `Estilo.vidro()` (degradê vertical do branco translúcido + borda clara 1px; sem desfuso real, que o Android só faz no
  12+) na barra de abas, no guia, na caixa de Ajustes e nos cartões de Filmes/Séries (`Estilo.pintarCartao`: vidro em
  repouso, degradê azul→ciano com foco); (2) **cartões menores** = `GridLayoutManager(6)` (5 → 6 colunas, ~14 filmes por
  tela); (3) **foco no fim da lista de canais**: no último canal, `DPAD_DOWN` volta ao 1º canal (`focarItem(0)`) em vez
  de escapar para a coluna de grupos — os grupos só pela seta ◀.
- **Capas em Filmes/Séries, prévia maior, foco na lista** (2.26, 22/11/2026): (1) **Filmes e Séries em grade de
  cartões** (pedido do Marco: "cartões com a imagem do filme e um texto com os dados, dá para analisar melhor") —
  `rvItens` usa `GridLayoutManager(5)` nessas abas (o Marco escolheu 5 colunas: capa média, ~10 filmes por tela);
  cartão = pôster 2:3 (`criarCartao`/`bindCartao`, `ImageView` com `onMeasure` h = w×3/2, `CENTER_CROP`, cantos
  arredondados, `Logos.mostrar(c.logo)`), nome (2 linhas) e dados (ano · ★nota · ✓assistido/◐parou), ★ no canto do
  favorito; `getItemViewType` 1 = cartão, 0 = linha da TV. (2) **Prévia maior** na TV ao vivo (coluna da direita 0.42 →
  0.52; grupos/canais 0.18/0.34). (3) **Foco não pula ao descer a lista**: o EPG atualizava em segundo plano e
  `guia.aoAtualizar` chamava `notifyDataSetChanged` com o foco na lista; agora, se a lista está com o foco, o redesenho
  fica pendente (`guiaPendente`) e só é aplicado quando o foco sai (`OnGlobalFocusChangeListener` + `ehDescendente`),
  como a 2.18 na Agenda.
- **Visual premium: fundo e abas** (2.25, 22/11/2026: o Marco mostrou fotos do app real e disse que o conceito que ele
  tinha aprovado "não está assim" — a 2.23/2.24 só trocava cores. Primeiro passo do visual de verdade, aprovado por
  print): `Estilo.fundoTela` agora é um `LayerDrawable` com brilhos radiais (`brilho()`: ciano em cima à direita, azul
  embaixo à esquerda, um toque de magenta no canto; cores pelo tema) em cima da base escura; e a **aba ativa do topo**
  usa o degradê azul→ciano com letra escura (`Estilo.pintarAba`, no lugar do `pintar` genérico), em `trocarAba` e no
  `onFocusChange`. Muda o visual COMUM, então vale para todas as telas. Próximos passos possíveis (quando o Marco pedir):
  prévia maior, cartões com mais "vidro", tela de Início tipo hero.
- **Escolha de aparência** (2.23, pedido do Marco em 22/11/2026, depois de aprovar os conceitos de visual premium;
  **2.24** no mesmo dia: o Marco trocou o tema e "nada mudou" — as cores do Premium estavam sutis demais, quase iguais
  ao Clássico; o ciano foi reforçado, principalmente no **foco** (degradê azul-ciano → ciano, bem diferente do azul do
  Clássico, e visível em toda tela), além de marca/"AGORA"/barrinha): Ajustes → "🎨 Aparência" abre um seletor com
  **Clássico (azul)** (padrão) e **Premium (ciano)**. O tema só muda as cores do destaque em `Estilo` (var `AZUL`,
  `AZUL_CLARO`, `FOCO_A`/`FOCO_B` do foco e `VERMELHO` do "AO VIVO"): `Estilo.aplicar(nome)` roda no início de cada
  `onCreate`, a escolha fica em `Repositorio.tema`, e trocar chama `recreate()`. Sem biblioteca nem imagem nova — o APK
  praticamente não muda de tamanho. Testes `TelaTest.aparencia` (o seletor guarda a escolha) e `TelaTest.temaPremium`
  (abre em ciano; grava `tema-premium.png`).
- **Relógio do topo curto** (2.21, o Marco em 20/11/2026, com foto: a data saía da tela): o relógio (`atualizarRelogio`)
  passou de "EEE, d 'de' MMM HH:mm" para só números e deixou de cortar na borda. **2.22** (o Marco: "pode ser data em
  cima, hora embaixo se economizar espaço"): `dd/MM/yyyy\nHH:mm` em duas linhas, alinhado à direita (`Gravity.END`).
- **Agenda com coluna de grupos** (2.20, o Marco em 19/11/2026: "na agenda não mostra os grupos e depois os canais
  do grupo, fica difícil achar o canal certo"): a aba Agenda passou a 3 colunas (grupos · canais do grupo ·
  programação), como a TV ao vivo — dias em cima, "Todos" no topo dos grupos (`AdAgGrupos`, `montarGrupos`,
  `selecionarGrupoAgenda` com repintura só das 2 linhas). A busca procura em todos os canais do dia; sem busca,
  mostra só o grupo escolhido. Teste `TelaTest.agenda` reforçado (grupos Abertos/Esportes, troca de grupo).
- **Liberar bloqueados pelos Ajustes** (2.19, o Marco em 19/11/2026: "a lista só deve mostrar os bloqueados depois
  que o usuário digitar a senha numa liberação nos Ajustes"): nova opção em Ajustes **"🔓 Liberar canais bloqueados
  (digitar senha)"** (acao `liberar`/`bloquear`) que pede a senha e marca `desbloqueado` na sessão; enquanto não
  liberar, os canais adultos ficam escondidos em todas as listas (TV, Todos, busca, Agenda — `semTravados`). O grupo
  bloqueado não pede mais a senha ali: só avisa para liberar nos Ajustes. Teste `TelaTest.liberarBloqueados`.
- **Correção do foco na Agenda** (2.18, o Marco em 19/11/2026: "quando desço para escolher o canal ele volta para o
  menu"): ao focar um canal, `selecionarCanal` repinta SÓ as duas linhas que mudaram (`notifyItemChanged`), em vez
  de `notifyDataSetChanged` na lista inteira — redesenhar a lista com o foco nela fazia o foco escapar para o menu
  de cima. Mesmo padrão da lista de grupos da aba TV.
- **Aba Agenda com aviso de "vai começar"** (2.17, pedido do Marco em 19/11/2026: "um local onde mostra a agenda
  do dia/semana da programação e que eu possa marcar uma programação para o app avisar que vai começar e, se eu
  clicar, já me leva para o canal"): nova 4ª orelha **Agenda** (`Aba.AGENDA`) com pílulas por dia (Hoje, Amanhã,
  data), lista de canais com EPG à esquerda (busca) e a grade do canal escolhido à direita (horário de início +
  "AGORA" + título). Num programa futuro, "Avisar quando começar" grava um lembrete (`Repositorio.lembretes`,
  `Lembrete`); a cada 20 s o app confere (`conferirLembretes`) e, 1 min antes, mostra na tela "📺 Vai começar
  agora" com **Assistir agora** que abre o canal (`avisarLembrete` → `abrirCanalAgenda`). A grade completa vem do
  XMLTV: login Xtream pelo `xmltv.php` (`Xtream.urlXmltv`, baixado 1×/6 h; nem todo provedor fornece); lista M3U
  pelo mesmo XMLTV da lista, janela mais larga (`Guia.agenda`/`Guia.cheia`). Só tem os dias que o provedor manda
  (em geral 1 a 7; mês não existe no dado). Teste `TelaTest.agenda` (xmltv.php imitado, marca o aviso pelo menu).
- **Guia do canal mais compacto** (2.16, pedido do Marco em 19/11/2026: "na lista de programação abaixo da janela só
  aparece um horário; reduzir para aparecer o máximo possível de programação"): o guia embaixo da prévia (`guiaRica`)
  passou a mostrar uma linha por programa (só o horário de início + título, sem o fim nem a sinopse comprida) e o
  cabeçalho do canal numa linha só (nome + grupo lado a lado); fonte 14sp, menos espaçamento e até 12 programas
  (`guiaBox` 18 linhas). Antes mostrava só ~1 programa porque o nome grande e a descrição de 180 caracteres enchiam a caixa.

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
