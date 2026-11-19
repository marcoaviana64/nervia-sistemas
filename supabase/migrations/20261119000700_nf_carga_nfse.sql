-- Buscador de NF 1.10: carga inicial de NFS-e mais rápida (Itaipu, 19/11/2026: ~800 NFS-e emitidas por dia,
-- e a busca horária trazia ~550 documentos por hora; o Marco precisa de 2026 inteiro).
-- Empresa "atrasada" = a última busca de NFS-e parou no meio ("Baixado até o NSU …" ou pausa pedida pelo ADN).
-- O pg_cron "nf-carga" chama a função sincronizar a cada 10 minutos com {"modo":"carga"}; ela só busca NFS-e dessas
-- empresas. Quando a carga termina, a empresa sai sozinha da lista e fica só a busca horária de sempre.
-- A trava por empresa (nf_travar_empresa) impede duas buscas da mesma empresa ao mesmo tempo.
create or replace function public.nf_nfse_atrasadas() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(e.cnpj order by e.ultima_sinc_nfse nulls first), '{}')
  from public.nf_empresas e
  where e.ativo and e.busca_automatica and e.cert_secret_id is not null
    and (e.cert_validade is null or e.cert_validade > now())
    and (select l.mensagem from public.nf_log l where l.cnpj = e.cnpj and l.origem = 'NFSE' order by l.id desc limit 1)
        ~ '^(Baixado até o NSU|O Ambiente Nacional pediu uma pausa)'
$$;
revoke execute on function public.nf_nfse_atrasadas() from public, anon, authenticated;
grant execute on function public.nf_nfse_atrasadas() to service_role;

-- a cada 10 min, menos no minuto 7 (a busca horária roda às :07)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('nf-carga', '2,12,22,32,42,52 * * * *', $c$
      select net.http_post(
        url     := (select decrypted_secret from vault.decrypted_secrets where name = 'buscador_url') || '/functions/v1/sincronizar',
        headers := jsonb_build_object('Content-Type', 'application/json',
                     'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'buscador_cron_secret')),
        body    := '{"modo": "carga"}'::jsonb,
        timeout_milliseconds := 10000)
      where cardinality(public.nf_nfse_atrasadas()) > 0
    $c$);
  end if;
end $$;
