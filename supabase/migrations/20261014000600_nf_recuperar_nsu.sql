-- Recuperação de NF-e anteriores por número (consNSU), quando a sequência do CNPJ já foi consumida por outro
-- sistema (NT 2014.002: distNSU não volta atrás; consNSU serve para preencher faltantes, máx. 20/hora).
-- A função `sincronizar` desce do NSU informado até 0 (ou até 10 respostas "nenhum documento" seguidas),
-- no máximo 15 consultas por rodada horária. Só as funções alteram estes campos.
alter table public.nf_empresas
  add column if not exists nfe_recuperar_nsu   bigint,
  add column if not exists nfe_recuperar_vazios integer not null default 0,
  add column if not exists nfe_recuperar_total integer not null default 0,
  add column if not exists nfe_recuperar_em    timestamptz;  -- início da última rodada (no máximo 1 rodada a cada 61 min)
