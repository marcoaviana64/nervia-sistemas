# Mídia Indoor Nervia — app da TV (Android)

App nativo (Kotlin + Media3/ExoPlayer) para Android TV / Google TV e TV box Android (Android 7.0+, minSdk 24).
Instalado fora da Play Store, pela Nervia (ver `IMPLANTACAO.md` §10).

## O que faz
- Na primeira abertura gera um identificador do aparelho e mostra um **código de 6 caracteres** (função `midia-tv`, ação `codigo`).
  Consulta a cada 4 s se o código foi vinculado no painel (`aguardar`); ao vincular, recebe o **token** (uma vez só).
- Pede a **playlist** a cada 5 min (`playlist`): lista de arquivos do Google Drive com md5, tempo das imagens e a chave de download.
- **Baixa** cada arquivo direto do Drive (retoma download interrompido, confere o md5), guarda em `filesDir/midia` e **toca do aparelho**
  em loop: continua sem internet. Arquivo com conteúdo novo (md5 diferente) ganha outro nome e é baixado de novo.
- A playlist nova entra **no fim do item que está passando**. Arquivos que saíram da playlist são **apagados**.
- **Sinal de vida** a cada 3 min (`sinal`): modelo, Android, versão do app, o que está tocando, espaço livre, downloads pendentes e
  arquivos que o aparelho não conseguiu tocar.
- Tela sempre ligada, tela cheia. **Abre sozinho** quando a TV liga (`BootReceiver`), **volta sozinho** 3 s depois de travar
  (`App`) e 3 min depois de sair da tela (`MainActivity.onStop`). No Android 10+ as duas coisas só funcionam com a permissão
  "Sobrepor a outros apps" concedida (regra do Android para abrir tela vinda do segundo plano) — a Nervia concede por ADB.
- Token inválido (TV desvinculada no painel) → volta para a tela do código e apaga as mídias.

## Compilar
Precisa de JDK 17+ e do Android SDK (platform 36, build-tools 36). `local.properties` com `sdk.dir=...`.
```
./gradlew testReleaseUnitTest lintRelease assembleRelease
```
O APK sai em `app/build/outputs/apk/release/app-release.apk`. A URL do Supabase e a chave publicável vêm de `../site/config.js`.

## Publicar para as instalações
Copiar `app/build/outputs/apk/release/app-release.apk` para `site/tv.apk` (https://nervia.com.br/tv.apk, o endereço que se digita no Downloader da TV). O APK sobe a cada versão nova (subir `versionCode` antes).

## Assinatura
`assinatura.properties` (fora do git) com `arquivo`, `senha`, `apelido` (e `senha_chave`, se diferente). Sem ele o APK sai com a
chave de depuração, só para piloto. **Guardar a chave de produção com cuidado**: sem ela não dá para atualizar o app nas TVs.

## Versão
Ao mudar o app, subir `versionCode` e `versionName` em `app/build.gradle.kts`. O painel mostra a versão de cada TV.
