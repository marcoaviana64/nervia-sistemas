# Ponte SEFAZ (NF-e)

Serviço mínimo (Python, só biblioteca padrão) que faz as chamadas de NF-e à SEFAZ com o certificado A1 do cliente.

**Por que existe.** O servidor de NF-e da SEFAZ (IIS) só pede o certificado depois que a conexão já abriu, por *renegociação TLS*. O runtime das Edge Functions do Supabase (rustls) não suporta renegociação, por isso a conexão cai ("Connection reset by peer"). O OpenSSL suporta. A NFS-e (ADN) não tem esse problema e continua direto.

**Como funciona.** A função do Supabase envia `POST /` com o cabeçalho `x-ponte-segredo` e o corpo JSON `{url, headers, body, cert_pem, key_pem}`. A ponte faz o POST com mTLS e devolve `{status, body}`.

**Segurança**
- Exige o segredo (`PONTE_SEGREDO`). Sem ele, responde 401.
- Só fala com `www1/www/hom1/hom.nfe.fazenda.gov.br`. Qualquer outro servidor recebe 403.
- O certificado fica em arquivo temporário (permissão 600) só pelo tempo de carregar no TLS e é apagado em seguida.
- Os logs registram só o método, o caminho e o status. Nunca o corpo.

**Variáveis**
- `PONTE_SEGREDO`: obrigatória.
- `CADEIA_EXTRA_PEM`: opcional, ACs extras.
- `PORT`: o Cloud Run define sozinho.
- `PONTE_HOSTS_EXTRA`: só para teste local. Não usar em produção.

**Deploy**: veja o IMPLANTACAO.md, seção 7. O gatilho do Cloud Build só dispara quando um push altera `ponte-sefaz/**` (mudanças no site ou nas funções não refazem a ponte). O Artifact Registry guarda as 2 imagens mais novas e apaga as outras depois de 7 dias.
**Teste**: `deno test -A testes/funcoes_test.ts` (teste "Ponte SEFAZ").
