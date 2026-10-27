-- Status do estoque do Sistema Linum (pedido do Marco em 27/10/2026: "quando eu pedir status estoque, compare com o
-- último status informado e diga percentualmente o que cresceu").
--   * copias.lin_status guarda cada status informado ao Marco (um jsonb com os números), para a próxima comparação.
--   * Fica no esquema `copias` (fora da API, sem acesso para anon/authenticated); quem grava é a equipe Nervia (Claude)
--     pelo SQL do painel, com a consulta registrada no CLAUDE.md. Não mexe em nenhum dado do Linum.

create table if not exists copias.lin_status (
  id     bigint generated always as identity primary key,
  em     timestamptz not null default now(),
  dados  jsonb not null
);
revoke all on copias.lin_status from public, anon, authenticated;

-- os dois status já informados em 27/10/2026 (o primeiro só com os números que foram passados ao Marco)
insert into copias.lin_status (em, dados) values
  ('2026-10-27 15:30-03', '{"produtos":226,"variacoes":292,"pecas_por_loja":{"Ipanema":149},"valor_venda":102696.90,"obs":"primeiro status (só os números informados)"}'),
  ('2026-10-27 20:47-03', '{"produtos":228,"produtos_com_variacao":25,"produtos_com_estoque":20,"variacoes":377,"especiais":31,"refs_provisorias":0,"pecas_por_loja":{"Gávea":14,"Ipanema":168},"pecas_total":182,"valor_venda":123425.10}');
