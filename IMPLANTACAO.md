# Implantação — Site da Nervia, Área do Cliente e apps (projeto nervia-sistemas)

São quatro peças, todas fora do seu computador:

| Peça | Onde roda | O que faz |
|---|---|---|
| Banco (tabelas, regras de acesso, Vault) | Supabase — Postgres | notas, empresas, logins, certificados criptografados |
| XMLs | Supabase — Storage (bucket privado `nf-xml`) | um arquivo por nota/evento |
| 4 Edge Functions | Supabase — região São Paulo | falam com a SEFAZ e o ADN usando o A1 |
| Site da Nervia + Área do Cliente + apps (`site/`) | Cloudflare (mesmo serviço do sistema da Linum) | site público, login, apps abertos dentro do site |

A busca automática roda de hora em hora pelo `pg_cron` do próprio Supabase.

## Testar antes de publicar
1. **Demonstração (agora, sem nada configurado).** Dê dois cliques em `iniciar-demo.bat`. O navegador abre em `http://localhost:8090/cliente/` com dados fictícios.
   - A barra amarela embaixo troca o perfil: **Admin**, **Cliente com o app Notas** e **Cliente sem apps**.
   - Nada é gravado e nada acessa o Supabase ou a SEFAZ. Os botões respondem com mensagens simuladas.
2. **Teste real, ainda sem o domínio.** Depois dos passos 1 a 4 abaixo, publique na Cloudflare **sem** ligar o `nervia.com.br`.
   - O site fica num endereço `nervia-site.<sua-conta>.workers.dev`, que ninguém conhece.
   - Teste com o seu A1 e um login de cliente de teste.
   - Quando estiver tudo certo, ligue o domínio (passo 5).
   - Durante esse teste, deixe o segredo `SITE_ORIGEM` sem definir, ou com o endereço `workers.dev`.
3. **Teste real no seu computador.** Com o `site/config.js` preenchido, rode `npx wrangler@4 dev`. O site abre em `http://localhost:8787` usando o Supabase de verdade.

## Como o deploy funciona
O código fica no repositório `marcoaviana64/nervia-sistemas` (GitHub). Cada push na `main` dispara dois deploys:
- **Supabase**, pela integração com o GitHub: aplica as migrações novas e publica as funções listadas em `supabase/config.toml`.
- **Cloudflare**, publicando a pasta `site/` (`wrangler.jsonc`). É o mesmo serviço onde já roda o sistema da Linum.

## 1. Repositório
Crie o repositório **vazio** `marcoaviana64/nervia-sistemas`. Ele pode ser **privado**, porque a Cloudflare publica a partir de repositório privado. O `.gitignore` bloqueia `.pfx`, `dados/` e `.venv`. Depois, envie o código para ele (o Claude pode fazer o push).

## 2. Projeto Supabase + integração
1. Crie um projeto novo na org **Nervia** (plano Pro), região **South America (São Paulo)**, com o nome `nervia-sistemas`. É o projeto de todos os sistemas da Nervia: cada sistema tem tabelas com prefixo próprio (`nf_` = Buscador), e o login (`perfis`) é comum a todos.
2. Ligue a integração em *Project Settings → Integrations → GitHub*:
   - escolha o repositório;
   - *Working directory* = `.`;
   - *Production branch* = `main`;
   - ligue **Deploy to production**.
3. Faça um push (ou *re-run* do último deploy). A integração cria a base comum (`perfis`), as tabelas `nf_*`, as regras de acesso, as funções do Vault e o bucket `nf-xml`, e publica as funções.
   - Se reclamar de `pg_cron`/`pg_net`, ative as duas em *Database → Extensions* e rode de novo.

## 3. Segredos das funções
Em *Edge Functions → Secrets*, crie:
- `CRON_SECRET`: um valor aleatório longo (ex.: `openssl rand -hex 32`).
- `SITE_ORIGEM` = `https://nervia.com.br,https://www.nervia.com.br` (um ou mais endereços, separados por vírgula). Limita quais sites podem chamar as funções pelo navegador. Depois de definido, o endereço `workers.dev` deixa de conseguir usar as funções. Para voltar a usá-lo, inclua-o na lista.

## 4. Busca automática
No *SQL Editor*, abra `supabase/agendar_busca.sql`, troque `<URL_DO_PROJETO>` e `<CRON_SECRET>` e execute uma vez.

## 5. Site (Cloudflare)
1. Preencha `site/config.js` com a URL e a **anon key** (*Project Settings → API*) e faça o push. Um arquivo só serve o site, a Área do Cliente e todos os apps.
2. Na Cloudflare, abra *Workers & Pages → Create → Import a repository*:
   - escolha `nervia-sistemas`;
   - *Deploy command* = `npx wrangler deploy`;
   - sem comando de build.

   Isso publica a cada push. Também dá para publicar à mão com `npx wrangler@4 deploy` na pasta do projeto, como no sistema da Linum.
3. Ligue o domínio: no worker `nervia-site`, abra *Settings → Domains & Routes → Add → Custom domain* e informe `nervia.com.br` (e `www.nervia.com.br`). O DNS do domínio precisa estar na Cloudflare.
4. No Supabase:
   - em *Authentication → URL Configuration*, coloque `https://nervia.com.br` em *Site URL*;
   - em *Authentication → Providers → Email*, desligue *"Allow new users to sign up"*. Só o admin cria logins.
5. Em *Edge Functions → Secrets*, defina `SITE_ORIGEM` = `https://nervia.com.br`.

Endereços depois de publicado:
- `nervia.com.br`: site público, com o link "Área do Cliente" no menu.
- `nervia.com.br/cliente/`: login e os aplicativos de cada cliente.
- `nervia.com.br/apps/notas/`: o Buscador. Na Área do Cliente ele abre dentro da página, sem sair do site.

## 6. Primeiro acesso
1. Crie o seu login em *Authentication → Users → Add user* (e-mail + senha, *Auto Confirm*).
2. Promova esse login a admin no *SQL Editor*:
   ```sql
   update perfis set admin = true where email = 'SEU-EMAIL';
   ```
3. Entre em `nervia.com.br/cliente/` e abra **Notas Fiscais**. O admin vê todos os apps.
   1. Adicione a empresa.
   2. Envie o `.pfx` e a senha.
   3. Clique em **Buscar NFS-e agora** para testar.
4. Libere um cliente:
   1. Em **Administração → Logins**, crie o login e marque os apps que ele pode usar.
   2. Dentro do app Notas Fiscais, em **Quem vê cada empresa**, marque os CNPJs desse login.

## 7. Ponte SEFAZ para NF-e (Google Cloud Run)
O servidor de NF-e da SEFAZ pede o certificado por **renegociação TLS**, que as Edge Functions do Supabase não fazem. A pasta `ponte-sefaz/` é um serviço mínimo em Python/OpenSSL que só repassa a chamada. A NFS-e não precisa dela.
1. Gere um segredo longo (ex.: `openssl rand -hex 32`). Ele vai em dois lugares: no Cloud Run e no Supabase.
2. No Google Cloud (projeto com faturamento ativo), *Cloud Run → Implantar contêiner → Serviço*, opção **implantar continuamente a partir de um repositório**:
   - GitHub, repositório `marcoaviana64/nervia-sistemas` (só ele), branch `^main$`;
   - tipo de build **Dockerfile**, local `/ponte-sefaz/Dockerfile`;
   - nome `ponte-sefaz`, região **southamerica-east1 (São Paulo)**;
   - autenticação: **permitir acesso público** (a proteção é o segredo);
   - mínimo de instâncias 0, máximo 2, memória 256 MiB, tempo limite 120 s;
   - variável de ambiente `PONTE_SEGREDO` = o segredo do passo 1.
3. Abra a URL do serviço no navegador: deve mostrar `{"ok": true, "servico": "ponte-sefaz"}`.
4. No Supabase, *Edge Functions → Secrets*: `PONTE_URL` = URL do passo 3 e `PONTE_SEGREDO` = o mesmo segredo. A NF-e liga sozinha (não precisa de `NFE_HABILITADA`).
5. No Buscador, clique em **Buscar NF-e agora**. Erros com `Ponte SEFAZ:` vêm da ponte (ex.: segredo diferente nos dois lados).
- Custo: com instância mínima 0, o uso de uma chamada por hora por empresa fica dentro da cota gratuita do Cloud Run.

## 8. E-mail automático (Microsoft 365) e "Esqueci minha senha"
Os e-mails saem pela caixa compartilhada **nao-responda@nervia.com.br** (sem licença) pelo Microsoft Graph, com permissão de **aplicativo** restrita a essa caixa. Funções: `email` (situação e teste, só admin) e `email-auth` (gancho "Send Email" do Supabase Auth). Registro em *Administração → E-mails* (tabela `email_envios`; o conteúdo não é guardado). Custo: zero.

**A. App no Entra** (portal.azure.com → Microsoft Entra ID → *Registros de aplicativo* → *Novo registro*)
1. Nome `Plataforma Nervia - e-mail`, *Contas somente deste diretório*, sem URI de redirecionamento → *Registrar*.
2. Anote em *Visão geral*: **ID do aplicativo (cliente)** e **ID do diretório (locatário)**.
3. *Certificados e segredos* → *Novo segredo do cliente* → validade 24 meses → copie o **Valor** na hora (depois não aparece). Anote a data de vencimento.
4. **Não** acrescente a permissão Mail.Send em *Permissões de API*: dada ali, ela vale para TODAS as caixas do Microsoft 365. A permissão vai pelo Exchange (passo B), só para a caixa compartilhada.
5. Em *Aplicativos empresariais* (não em Registros), abra o mesmo app e anote o **ID do objeto** (é o da entidade de serviço; o ID do objeto do "Registro" é outro e não serve no passo B).

**B. Permissão só na caixa compartilhada** (PowerShell do Exchange Online, como administrador do Exchange/global)
```
Install-Module ExchangeOnlineManagement        # uma vez
Connect-ExchangeOnline -UserPrincipalName marco.viana@nervia.com.br
New-ServicePrincipal -AppId <ID do aplicativo> -ObjectId <ID do objeto do Aplicativo empresarial> -DisplayName "Plataforma Nervia - e-mail"
New-ManagementScope -Name "Plataforma Nervia - nao-responda" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'nao-responda@nervia.com.br'"
New-ManagementRoleAssignment -App <ID do aplicativo> -Role "Application Mail.Send" -CustomResourceScope "Plataforma Nervia - nao-responda"
Test-ServicePrincipalAuthorization -Identity <ID do aplicativo> -Resource nao-responda@nervia.com.br   # InScope = True
Test-ServicePrincipalAuthorization -Identity <ID do aplicativo> -Resource marco.viana@nervia.com.br    # InScope = False
```
A permissão pode levar algum tempo para valer (o Exchange guarda em cache). Se o teste do passo C der "não tem permissão", espere e tente de novo.

**C. Segredos no Supabase** (*Edge Functions → Secrets*): `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` (o Valor do passo A3) e `EMAIL_REMETENTE` = `nao-responda@nervia.com.br`. Depois, *Área do Cliente → Administração → E-mails → Enviar teste*. Confira se chegou na caixa de entrada (não no lixo) e se a cópia ficou em *Itens enviados* da caixa compartilhada.

**D. "Esqueci minha senha" automático** (só depois do teste do passo C)
1. Supabase → *Authentication → URL Configuration*: Site URL `https://nervia.com.br`; em *Redirect URLs* acrescente `https://nervia.com.br/cliente/` e `https://www.nervia.com.br/cliente/`.
2. *Authentication → Hooks → Add hook → Send Email hook* → tipo **HTTPS**, URL `https://jgokdhqwtcjxcphlwtgk.supabase.co/functions/v1/email-auth` → *Generate secret* → copie (começa com `v1,whsec_`) → salve o gancho ligado.
3. *Edge Functions → Secrets*: `SEND_EMAIL_HOOK_SECRET` = o segredo do passo 2.
4. Com o gancho ligado, TODOS os e-mails de login (senha nova, convite, link de acesso, troca de e-mail) saem pela função, em português. Para desligar: desligue o gancho (volta ao e-mail padrão do Supabase).
5. Na Área do Cliente, `ESQUECI_AUTOMATICO: true` em `site/config.js` (o botão passa a mandar o link; com `false` continua o pedido manual à Nervia). Testar: "Esqueci minha senha" com o próprio e-mail → link → criar senha nova.
- Limite de pedidos: *Authentication → Rate Limits* (e-mails por hora). Pedido de e-mail inexistente responde igual (não revela quem tem login).

**Cuidados**
- A chave secreta do app **vence** (passo A3): os e-mails param com "A chave secreta do app no Entra venceu". Antes do vencimento, gere outra e troque `MS_CLIENT_SECRET`.
- Limites do Exchange Online: 10.000 destinatários por dia por caixa (sobra para o uso previsto).

## 9. Acessos do site (contador próprio)
O site avisa o worker a cada página aberta (`site/acesso.js`), e o worker grava no Supabase com IP, estado e cidade da Cloudflare (`worker/index.js`, tabela `site_acessos`). Tela: *Área do Cliente → Administração → Acessos do site*.
1. A migração `..._site_acessos.sql` cria o segredo sozinha. Para lê-lo, no *SQL Editor* do Supabase: `select valor from site_config where chave = 'acessos_segredo';`
2. Na Cloudflare, worker `nervia-site` → *Settings → Variables and Secrets → Add* → tipo **Secret**, nome `ACESSOS_SEGREDO`, valor = o do passo 1 → *Deploy*.
3. Abra https://nervia.com.br numa janela anônima e confira em *Acessos do site*. Sem o segredo o site funciona normalmente, só não conta.
- Não contam: a equipe Nervia (o navegador fica marcado ao entrar como admin na Área do Cliente; a própria tela permite desmarcar), robôs que se identificam, páginas dentro do iframe.
- LGPD: IP e navegador apagados depois de 90 dias (pg_cron diário `site-acessos-anonimizar`); aviso em `/privacidade.html` (revisar com o advogado).
- Limite: o plano gratuito do Workers aceita 100 mil chamadas por dia; acima disso só a contagem falha (as páginas são arquivos estáticos e não passam pelo worker).
- Variáveis em `wrangler.jsonc` (`vars`) substituem as do painel a cada deploy; o segredo não é afetado.

## Sem a integração (alternativa pela linha de comando)
`supabase link --project-ref <REF>` → `supabase db push` → `supabase functions deploy <nome>` para cada função → `supabase secrets set ...`.

## Se der erro
- **"UnknownIssuer" / TLS na SEFAZ ou no ADN:** falta a cadeia ICP-Brasil.
  1. Baixe as ACs raiz e intermediárias do ITI e junte-as num arquivo PEM.
  2. Crie o segredo `CADEIA_EXTRA_PEM` com o conteúdo desse arquivo (*Edge Functions → Secrets*).
- **cStat 656:** a SEFAZ pediu para esperar 1h. O app já respeita isso.
- **Logs:**
  - *Edge Functions → sincronizar → Logs*;
  - `select * from cron.job_run_details order by start_time desc limit 10;`
  - o "Histórico de buscas" de cada empresa na tela.

## Novo app na Área do Cliente
1. Coloque o app em `site/apps/<nome>/`. Ele lê o mesmo `/config.js` e já usa o login da Área do Cliente, sem pedir senha de novo.
2. Cadastre o app em **Administração → Aplicativos** com o endereço `/apps/<nome>/`.
3. App externo (`https://…`) também abre dentro da página, mas:
   - pode pedir login próprio;
   - só funciona se o app permitir ser exibido em outro site. Se não aparecer, o botão "Abrir em nova aba" resolve.

## Testes (sem internet, sem Supabase)
```
python3 testes/gerar_fixtures.py                 # certificados de teste
pip install pyopenssl                            # para o servidor que imita a renegociação da SEFAZ
deno test -A testes/funcoes_test.ts              # lógica SEFAZ/ADN, mTLS real local, ponte (OpenSSL) com renegociação
deno test -A testes/worker_test.ts               # worker do site (contador de acessos)
deno test -A testes/email_test.ts                # e-mail pelo Microsoft Graph (imitado) e gancho Send Email do Auth
python3 testes/conferir_assinatura.py testes/saida_envEvento.xml testes/fixtures/a1_cert.pem
PGHOST=... PGPORT=... PGUSER=postgres testes/rodar_sql.sh   # esquema + RLS num Postgres local
python3 testes/tela_test.py                      # site, Área do Cliente e Buscador (Playwright) com Supabase simulado
npx wrangler@4 dev                               # roda o site no motor da Cloudflare em http://localhost:8787
```
