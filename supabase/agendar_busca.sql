-- Rodar UMA vez no SQL Editor do Supabase, depois de publicar as funções.
-- Troque os dois valores entre <> antes de executar.
--   <URL_DO_PROJETO>  ex.: https://abcdefghijklmno.supabase.co
--   <CRON_SECRET>     o mesmo valor usado em: supabase secrets set CRON_SECRET=...

select vault.create_secret('<URL_DO_PROJETO>', 'buscador_url', 'URL do projeto (cron do Buscador de NF)');
select vault.create_secret('<CRON_SECRET>', 'buscador_cron_secret', 'Segredo do cron do Buscador de NF');

-- A cada hora, no minuto 7 (a SEFAZ exige 1h entre consultas sem novidade; a função respeita o bloqueio).
select cron.schedule(
  'buscador-nf-horaria',
  '7 * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'buscador_url')
               || '/functions/v1/sincronizar',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-region', 'sa-east-1',   -- roda a função em São Paulo (IP brasileiro para a SEFAZ)
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'buscador_cron_secret')),
    body    := '{"origem": "cron"}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);

-- Conferir:   select * from cron.job;   select * from cron.job_run_details order by start_time desc limit 10;
-- Desligar:   select cron.unschedule('buscador-nf-horaria');
