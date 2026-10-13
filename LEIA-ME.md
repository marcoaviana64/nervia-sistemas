# nervia-sistemas

Site da Nervia, Área do Cliente e os aplicativos que a Nervia oferece aos clientes.

- **Site** (`nervia.com.br`): página pública da Nervia, com o link "Área do Cliente" no menu.
- **Área do Cliente** (`/cliente/`): o cliente entra com e-mail e senha e vê os aplicativos liberados para ele. Ao clicar, o app abre **dentro da página da Nervia**, com o topo da Nervia, e um "← Meus aplicativos" para voltar. O login vale para todos os apps.
- **Administração** (só equipe Nervia):
  - criar logins e escolher quais apps cada cliente usa;
  - cadastrar novos apps;
  - trocar senhas e excluir logins.

## Apps
- **Notas Fiscais** (`/apps/notas/`): busca as NF-e (SEFAZ) e NFS-e (padrão nacional) emitidas contra os CNPJs do cliente, com o certificado A1 de cada empresa, de hora em hora.
  - **Certificado:** fica criptografado no Vault do Supabase. A senha e o `.pfx` não são guardados.
  - **NF-e:** só dos últimos ~90 dias. A SEFAZ exige 1h entre consultas sem novidade. Notas que chegam só como resumo precisam de "ciência" para baixar o XML.
  - **NFS-e:** só de municípios no padrão nacional.

Para ver funcionando sem publicar nada, dê dois cliques em **iniciar-demo.bat** (dados fictícios). Para colocar no ar, veja **IMPLANTACAO.md**.
