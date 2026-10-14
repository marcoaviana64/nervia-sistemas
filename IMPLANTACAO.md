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

## 8. Senhas esquecidas
Hoje não há envio automático de e-mail (decisão: sem contratar serviço de envio por enquanto). Na tela de entrada, "Esqueci minha senha" abre um e-mail pronto do próprio usuário para atendimento@nervia.com.br. A Nervia confere se veio do e-mail do login e define uma senha provisória em *Área do Cliente → Administração → Logins → Definir nova senha*.
Se um dia quiser o link automático: o e-mail padrão do Supabase só envia para a equipe da organização (2 por hora). Seria preciso um SMTP próprio (ex.: Resend), Site URL/Redirect URLs de `nervia.com.br/cliente/` e voltar o fluxo `resetPasswordForEmail` na Área do Cliente.

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
python3 testes/conferir_assinatura.py testes/saida_envEvento.xml testes/fixtures/a1_cert.pem
PGHOST=... PGPORT=... PGUSER=postgres testes/rodar_sql.sh   # esquema + RLS num Postgres local
python3 testes/tela_test.py                      # site, Área do Cliente e Buscador (Playwright) com Supabase simulado
npx wrangler@4 dev                               # roda o site no motor da Cloudflare em http://localhost:8787
```
