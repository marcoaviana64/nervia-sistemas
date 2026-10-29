-- Relatório semanal de chamados (skill relatorio-semanal-chamados; desde 29/10/2026 lê da Plataforma, não mais da Central antiga).
-- Uma linha com o jsonb `r`: a semana (segunda a domingo; rodando na segunda ou na terça = a semana anterior, em Brasília),
-- os números já contados e a lista de chamados que o relatório usa (os da semana + todos os em aberto), com os andamentos.
-- Para outra semana: trocar o `ini` abaixo por uma segunda-feira fixa, ex.: select date '2026-10-20' as ini.
-- Somente leitura.
with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
sem as (
  select ini, ini + 6 as fim from (
    select case when extract(isodow from d) <= 2 then date_trunc('week', d)::date - 7 else date_trunc('week', d)::date end as ini from hoje) x),
c as (
  select ch.*, e.nome as empreendimento,
         coalesce((select jsonb_agg(jsonb_build_object('data', a.data, 'fechado', a.fechado, 'texto', a.texto) order by a.data, a.id)
                     from atd_andamentos a where a.numero = ch.numero), '[]') as andamentos,
         (ch.abertura between sem.ini and sem.fim
          or exists (select 1 from atd_andamentos a where a.numero = ch.numero and a.data between sem.ini and sem.fim)) as da_semana
    from atd_chamados ch join atd_empreendimentos e on e.sigla = ch.sigla, sem)
select jsonb_build_object(
  'semana', jsonb_build_object('ini', sem.ini, 'fim', sem.fim),
  'hoje', (select d from hoje),
  'numeros', jsonb_build_object(
    'abertos_na_semana', (select count(*) from c where abertura between sem.ini and sem.fim),
    'fechados_na_semana', (select count(*) from c where status = 'Fechado' and fechamento between sem.ini and sem.fim),
    'da_semana', (select count(*) from c where da_semana),
    'da_semana_em_aberto', (select count(*) from c where da_semana and status = 'Aberto'),
    'em_aberto_na_base', (select count(*) from c where status = 'Aberto'),
    'em_aberto_mais_30_dias', (select count(*) from c, hoje where status = 'Aberto' and hoje.d - abertura > 30),
    'abertos_sem_andamento', (select count(*) from c where status = 'Aberto' and andamentos = '[]'::jsonb)),
  'base_em_aberto', (select coalesce(jsonb_object_agg(sigla, n), '{}') from (select sigla, count(*) n from c where status = 'Aberto' group by 1) x),
  'chamados', (select coalesce(jsonb_agg(jsonb_build_object(
      'numero', numero, 'empr', sigla, 'empreendimento', empreendimento, 'abertura', abertura, 'resumo', resumo,
      'descricao', descricao, 'tipo', tipo, 'solicitante', solicitante, 'status', status, 'fechamento', fechamento,
      'da_semana', da_semana, 'dias_aberto', case when status = 'Aberto' then (select d from hoje) - abertura end,
      'andamentos', andamentos) order by sigla, numero), '[]')
    from c where da_semana or status = 'Aberto')
) as r
from sem;
