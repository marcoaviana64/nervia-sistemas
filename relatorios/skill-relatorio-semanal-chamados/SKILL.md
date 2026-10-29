---
name: "relatorio-semanal-chamados"
description: "Gera o relatório semanal de chamados da Nervia a partir do app Atendimentos de TI da Plataforma Nervia (Supabase) e envia por e-mail. Use quando o Marco pedir relatório da semana, resumo dos chamados ou como foi a semana."
---

# Relatório semanal de chamados — Nervia

## Fonte
- App **Atendimentos de TI** da Plataforma Nervia (desde 29/10/2026). A Central antiga (artifact "Nervia Atendimentos") ficou só para consulta e NÃO é mais atualizada: não ler dela.
- Banco: Supabase, projeto `nervia-sistemas` (project_id `jgokdhqwtcjxcphlwtgk`), ferramenta `execute_sql` do conector Supabase.
- Consulta pronta: `consulta.sql`, nesta mesma pasta da skill (cópia de `relatorios/atendimentos_semana.sql` do repositório `marcoaviana64/nervia-sistemas`). Rodar o arquivo inteiro, sem mudar nada (a semana já vem calculada).
- A consulta devolve uma linha com o jsonb `r`:
  - `semana` {ini, fim} (segunda a domingo; rodando na segunda ou na terça = a semana anterior, em Brasília) e `hoje`;
  - `numeros`: abertos_na_semana, fechados_na_semana, da_semana, da_semana_em_aberto, em_aberto_na_base, em_aberto_mais_30_dias, abertos_sem_andamento;
  - `base_em_aberto`: {sigla: quantidade};
  - `chamados`: os da semana + TODOS os em aberto, cada um com numero, empr (sigla), empreendimento (nome), abertura, resumo, descricao, tipo, solicitante, status (Aberto/Fechado), fechamento, da_semana (true/false), dias_aberto e andamentos[{data, fechado, texto}] em ordem de data.
- Para outra semana (pedido do Marco), trocar na consulta a linha do `ini` por uma segunda-feira fixa: `select date 'AAAA-MM-DD' as ini`.
- Somente LEITURA. Nunca alterar, criar ou apagar nada no banco.

## Passos
1. Rodar `consulta.sql` no Supabase e salvar o `r` num arquivo JSON no scratchpad.
2. Chamado "da semana" = `da_semana = true` (aberto na semana OU com algum andamento datado na semana).
3. Conferir com script Python os números de `numeros` contra a lista `chamados` (abertos na semana, fechados na semana, da semana ainda em aberto, em aberto na base, +30 dias). Se algo não bater, dizer no chat.
4. Agrupar os chamados da semana por empreendimento (maior volume primeiro).
5. Procurar recorrências: mesmo assunto em 2+ empreendimentos, ou o mesmo problema repetido (incluindo chamados antigos ainda abertos).
6. Mostrar o relatório no chat.
7. Enviar por e-mail (ver seção Envio por e-mail).

## Formato (sempre este, nesta ordem)
**Relatório de Chamados — Semana DD/MM a DD/MM/AAAA**
1. **Números:** uma linha — abertos · fechados · da semana ainda em aberto · em aberto na base (+30 dias ⚠)
2. **Por empreendimento** — tabela | Sigla | Nº | Resumo | Situação | (Situação = "Fechado DD/MM" ou "Aberto. Próximo passo do último andamento")
3. **Recorrências** — bullets curtos, com siglas e números dos chamados
4. **Atenção** — 5 mais antigos em aberto (com dias) e problemas de cadastro (abertos sem andamento, em toda a base)
5. **Base em aberto:** uma linha por sigla, maior para menor

## Envio por e-mail
- Ferramenta: Gmail `send_message` (conta Gmail conectada do Marco).
- Para: marcoa.viana@gmail.com. Sem cópia.
- Assunto: "Relatório de Chamados — Semana DD/MM a DD/MM/AAAA".
- Enviar direto, sem pedir confirmação.
- Corpo em `htmlBody`, com o mesmo conteúdo e ordem do relatório do chat: título, subtítulo "Nervia TI · Atendimentos de TI", tabela HTML com estilos inline (cabeçalho com borda inferior #0C7F74, linhas com borda #D8E1E0; situação "Aberto" em #0C7F74 com "Aberto." em negrito, "Fechado" em cinza #6A7A7F), listas para Recorrências e Atenção, rodapé "Gerado a partir do app Atendimentos de TI da Plataforma Nervia (nervia.com.br/cliente)."
- Preencher também `body` (texto puro, sem Markdown) com título, linha de números e base em aberto.
- Depois de enviar, avisar no chat em uma linha que foi enviado. Se o envio falhar, dizer claramente e manter o relatório no chat.

## Regras
- Cabe em uma página. Resumo de cada chamado em até 8 palavras.
- Aberto há mais de 30 dias → ⚠ e número de dias (`dias_aberto`).
- Chamado aberto sem nenhum andamento → listar em "problemas de cadastro".
- Não inventar causa nem solução; usar só o que está escrito nos andamentos.
- Siglas sempre iguais às do app (SVS, SIP, Rio2Pom, SPS, STQ, IMC, SPL, ARGO, IGU…).
- Português do Brasil, frases curtas.
