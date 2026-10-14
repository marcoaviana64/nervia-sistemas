# nervia-sistemas — notas do projeto

Nome do conjunto: **Plataforma Nervia** (site + Área do Cliente + apps + backend). Documentação para o Marco, com diagramas: "Plataforma Nervia — Documentação" (https://claude.ai/code/artifact/c9432c68-f6c1-43f5-84da-f23853a624e1). Ao mudar serviços, segredos ou estrutura, atualizar também esse documento.

Repositório `marcoaviana64/nervia-sistemas`, com três partes:
- o **site da Nervia** (`site/index.html`);
- a **Área do Cliente** (`site/cliente/`): login único; cada cliente vê os apps liberados para ele, e o app abre num iframe dentro do site, sem sair da página;
- os **apps** que a Nervia vende (`site/apps/<nome>/`).

O primeiro app é o **Buscador de NF** (`site/apps/notas/`): busca NF-e (SEFAZ) e NFS-e (ADN nacional) emitidas contra os CNPJs dos clientes, com o A1 de cada empresa, de hora em hora.

Backend: Supabase (projeto `nervia-sistemas`, org Nervia, plano Pro, região São Paulo). Site: Cloudflare Workers com arquivos estáticos (`wrangler.jsonc`), o mesmo serviço da Linum. Domínio previsto: nervia.com.br.

## Estrutura
- `supabase/migrations/`
  - `..._nervia_base.sql` — comum a todos os sistemas Nervia do projeto: `perfis` (um login por pessoa; `admin` = equipe Nervia), `eh_admin()`, trigger que cria o perfil; `apps` (cadastro dos apps da Área do Cliente) e `app_acessos` (login×app), com RLS — cliente vê só app ativo e liberado.
  - `..._buscador_nf.sql` — tudo do Buscador com prefixo `nf_`: `nf_empresas`, `nf_acessos` (cliente×CNPJ), `nf_notas`, `nf_log`; RLS por CNPJ (`nf_pode_ver`); `nf_gravar_nota()`, `nf_salvar_certificado()` / `nf_ler_certificado()` (Vault), `nf_travar_empresa()`; bucket privado `nf-xml` com policy por CNPJ (pasta = CNPJ).
  - Próximos sistemas (ex.: atendimentos) entram no mesmo projeto com prefixo próprio, reaproveitando `perfis`.
- `supabase/functions/`
  - `sincronizar` — admin: `{cnpj, tipo:"nfe"|"nfse"}`; cron: header `x-cron-secret` → 202 e roda todas em `EdgeRuntime.waitUntil` (~120 s).
  - `ciencia` — evento 210210 nas NF-e selecionadas.
  - `certificado` — recebe .pfx+senha, valida com node-forge e guarda `{cert_pem,key_pem}` no Vault (senha e .pfx não são guardados).
  - `usuarios` — cria login (com apps, CNPJs e flag admin), exclui e troca senha (auth.admin). Usado pela Administração da Área do Cliente.
  - `_shared/` — `sefaz.ts`, `adn.ts`, `xml.ts`, `certificado.ts` (mTLS via `Deno.createHttpClient({cert,key})`, usado no ADN), `ponte.ts` (NF-e via ponte), `banco.ts` (interface `Banco` para testes), `http.ts` (`VERSAO` vai nas mensagens de erro).
- `ponte-sefaz/` — ponte Python/OpenSSL (só biblioteca padrão) no **Google Cloud Run** (southamerica-east1, deploy contínuo do GitHub pelo `ponte-sefaz/Dockerfile`). Recebe `{url,headers,body,cert_pem,key_pem}` com cabeçalho `x-ponte-segredo`, faz o POST com mTLS e devolve `{status,body}`. Só fala com hosts `*.nfe.fazenda.gov.br`; não guarda nem registra certificado. Segredos nas funções: `PONTE_URL`, `PONTE_SEGREDO` (com `PONTE_URL` definido a NF-e liga sozinha; sem ele, 409).
- `supabase/agendar_busca.sql` — pg_cron horário (rodar uma vez, manualmente).
- `site/` (publicado inteiro na Cloudflare)
  - `index.html` — site público da Nervia (origem: `Projects/Nervia/nervia-site.html`, com logo extraído para `img/` e o link "Área do Cliente" no menu). Editar aqui daqui em diante.
  - `cliente/index.html` — Área do Cliente: login (com "Esqueci minha senha" por e-mail e contato WhatsApp/e-mail), grade de apps, visor (`#app/<id>`, iframe, com botões "Cartão rápido" e "Manual" que abrem a ajuda num painel ao lado), administração (`#admin`: logins, apps).
  - `ajuda/ajuda.css` — estilo comum de cartões e manuais. Cada app: `apps/<nome>/ajuda/cartao.html` e `manual.html`; endereços nas colunas `apps.cartao_url` / `apps.manual_url`.
  - `apps/notas/index.html` — Buscador. Detecta o iframe (`EMBUTIDO`) e esconde o próprio topo. Logins são criados só na Área do Cliente; aqui só se marcam os CNPJs ("Quem vê cada empresa").
  - `config.js` — URL + anon key, comum a tudo (`window.NERVIA_CONFIG`).
  - `_headers` — `X-Frame-Options: SAMEORIGIN`: só o próprio site pode embutir as páginas.
  - `404.html`, `img/`.
- `wrangler.jsonc` — Cloudflare (worker `nervia-site`, arquivos de `site/`).
- `testes/` — Deno (lógica + mTLS real local + ponte contra `servidor_renegociacao.py`, que imita o IIS da SEFAZ; precisa de `pip install pyopenssl`), SQL (RLS num Postgres local com stubs), Playwright (tela com Supabase falso), conferência independente da assinatura.
- A primeira versão (Flask, local) ficou em `Projects/BuscadorCNPJ/versao-local/`, só como referência.
- `IMPLANTACAO.md` — passo a passo de deploy.

## Regras que não podem quebrar
- **Todo app publicado tem cartão de referência + manual de utilização** (decisão do Marco, 2026-10-14). Cartão: cada campo/botão em uma linha, rápido, imprimível. Manual: passo a passo das tarefas, mensagens de erro e o que fazer. Ficam em `site/apps/<nome>/ajuda/`, usam `/ajuda/ajuda.css`, e são cadastrados em Administração → Aplicativos. Ao mudar um campo do app, atualizar os dois.
- Apps internos ficam no mesmo domínio (`/apps/...`): mesma sessão do Supabase, um login só, iframe sem bloqueio. App em outro domínio pode pedir login próprio.
- Tabelas de cada app com prefixo próprio; `perfis`, `apps` e `app_acessos` são comuns.
- SEFAZ: continuar sempre do ultNSU; após cStat 137 (ou ultNSU == maxNSU) ou 656, esperar 1h (`bloqueio_nfe`). Parar por tempo NÃO bloqueia.
- NF-e só fica disponível ~90 dias no Ambiente Nacional.
- Resumo nunca sobrescreve XML completo; nota cancelada continua cancelada (regra no SQL `gravar_nota`).
- Ciência é evento fiscal oficial: só por clique do admin, nunca automático.
- Assinatura XMLDSig: C14N inclusiva montada à mão em `sefaz.ts`. NÃO usar o C14N do lxml/libxml2 2.14 para conferir: ele gera `xmlns=""` indevido em sub-árvores. Conferir com `testes/conferir_assinatura.py` (C14N da stdlib).
- Clientes só leem (RLS). NSU, bloqueio e certificado só são alterados pelas funções (service_role); o admin, pela tela, só altera nome/UF/ativo/busca_automatica.
- Funções chamadas com região `sa-east-1` (IP brasileiro para a SEFAZ).

## Status
- 2026-10-13: versão local rodou de verdade com o A1 da Nervia: SEFAZ conectou (NF-e: 0 notas nos últimos 90 dias) e o ADN trouxe 153 NFS-e + 15 eventos.
- 2026-10-13: v2 web (Supabase) escrita e testada: Deno 9/9 (com mTLS real contra servidor local), SQL 26/26 (RLS), tela OK, assinatura conferida, e leitor de XML idêntico à versão local nas 153 NFS-e reais (`testes/comparar_reais.ts`). Ainda não implantada no Supabase.
- 2026-10-13: Área do Cliente + site da Nervia no mesmo repositório; testes de tela (portal, app no iframe, admin, cliente, celular) e SQL (32 verificações) OK; `wrangler dev` conferido (rotas e cabeçalhos).
- 2026-10-13: IMPLANTADO. Supabase `nervia-sistemas` (ref jgokdhqwtcjxcphlwtgk) com integração GitHub (migrações + funções), cron horário ativo, admin = marcoa.viana@gmail.com. Site na Cloudflare (worker `nervia-site`, importado do GitHub, app da Cloudflare liberado só para este repositório): https://nervia-site.nervia-linum.workers.dev — domínio nervia.com.br ainda NÃO ligado (DNS está no Microsoft 365, com o e-mail; migrar com cuidado).
- 2026-10-13: primeiro teste real OK para NFS-e: 153 notas + 15 eventos (idêntico à versão local). Cron horário chamando a função (202).
- NF-e: Marco decidiu que é essencial (só NFS-e não é comercial). Diagnóstico: o servidor de NF-e da SEFAZ (IIS, www1.nfe.fazenda.gov.br) pede o certificado por renegociação TLS; em HTTP/2 responde "endpoint requires HTTP/1.1" e em HTTP/1.1 dá "Connection reset by peer". O runtime das Edge Functions (rustls) não suporta renegociação. A versão local (Python/OpenSSL) conecta normalmente. O evento de Ciência (www.nfe.fazenda.gov.br) deve ter o mesmo problema.
  - Solução: `ponte-sefaz/` no Google Cloud Run (escolha do Marco). Reproduzido em teste: `servidor_renegociacao.py` derruba o Deno direto e funciona pela ponte (10/10).
  - 2026-10-13: NF-e FUNCIONANDO pela ponte. Cloud Run `ponte-sefaz` no projeto GCP **NerviaOrcamentos**, southamerica-east1, URL https://ponte-sefaz-916060726487.southamerica-east1.run.app (deploy contínuo do GitHub, conta de serviço padrão do Compute). Segredos `PONTE_URL`/`PONTE_SEGREDO` no Supabase. Teste real: SEFAZ respondeu (Nervia: 0 NF-e nos últimos 90 dias, bloqueio de 1h aplicado). Ciência ainda não testada de verdade (sem NF-e em resumo).
  - ATENÇÃO: a conta do Google Cloud estava em teste gratuito (fim ~15/10/2026). Sem upgrade para conta paga, a ponte para e a NF-e volta a falhar ("Ponte SEFAZ fora do ar").
- 2026-10-14: DOMÍNIO LIGADO. DNS do nervia.com.br migrado para a Cloudflare pelo Marco (NS cloudflare; registros do M365 conferidos: MX, SPF, MS=/mscid, autodiscover, SRV/lync do Teams). https://nervia.com.br e https://www.nervia.com.br servem o worker `nervia-site`; Área do Cliente OK.
- `SITE_ORIGEM` aceita lista separada por vírgula (função `origemPermitida`, v5-origens). Valor previsto: `https://nervia.com.br,https://www.nervia.com.br`.

- 2026-10-14: "Esqueci minha senha" (resetPasswordForEmail → /cliente/ com #type=recovery, fluxo implicit), contato WhatsApp/e-mail na entrada, ajuda dos apps (migração `..._apps_ajuda.sql`), cartão e manual do Buscador. Tela e SQL OK. FALTA no Supabase: Auth → URL Configuration (Site URL `https://nervia.com.br/cliente/` + Redirect URLs `https://nervia.com.br/cliente/**` e `https://www.nervia.com.br/cliente/**`) e SMTP próprio (o e-mail padrão do Supabase só envia para a equipe da org, 2/hora) — sugestão: Resend com domínio nervia.com.br; modelo de e-mail em português.

## Ideias (comercialização)
- Termo de autorização/custódia do certificado A1 com cada cliente (LGPD + responsabilidade pelo uso do certificado).
- Cobrança por CNPJ/mês; página do cliente com a marca Nervia.

## Ideias
- Aviso por e-mail/WhatsApp de nota nova ou certificado perto de vencer.
- Manifestação conclusiva (confirmação/desconhecimento).
- DANFE em PDF.
- NFS-e de prefeituras fora do padrão nacional.
