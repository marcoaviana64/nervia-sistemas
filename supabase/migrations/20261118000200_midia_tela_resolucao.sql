-- Mídia Indoor — resolução da tela de cada TV (pedido do Marco em 18/11/2026: "pelos dados da televisão, informar o tamanho
-- da foto ou do vídeo para cada TV instalada", para passar ao cliente depois de cadastrar a TV).
-- O app da TV (1.9) manda no sinal a resolução física da tela (pixels do painel, como a TV sai de fábrica, deitada: o maior
-- modo que o aparelho informa); o painel junta com a "Posição da TV" (rotacao) e mostra o formato ideal das mídias.
-- Colunas novas com valor vazio (TV com app antigo continua igual); a função do sinal é a mesma da migração midia, mais as
-- duas colunas.

alter table public.mi_telas add column if not exists tela_largura int check (tela_largura between 100 and 20000);
alter table public.mi_telas add column if not exists tela_altura  int check (tela_altura between 100 and 20000);
grant select (tela_largura, tela_altura) on public.mi_telas to authenticated;

create or replace function public.mi_tv_sinal(p_token text, p_dados jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_id uuid := public.mi_tv_tela(p_token); d jsonb := coalesce(p_dados, '{}'::jsonb);
begin
  if v_id is null then return false; end if;
  update public.mi_telas set ultimo_sinal = now(),
      versao_app = left(coalesce(d->>'versao_app', versao_app), 30),
      modelo = left(coalesce(d->>'modelo', modelo), 80),
      android = left(coalesce(d->>'android', android), 30),
      tocando = left(coalesce(d->>'tocando', ''), 200),
      conteudo = left(coalesce(d->>'conteudo', conteudo), 64),
      espaco_livre_mb = case when (d->>'espaco_livre_mb') ~ '^\d{1,9}$' then (d->>'espaco_livre_mb')::int else espaco_livre_mb end,
      baixando = case when (d->>'baixando') ~ '^\d{1,6}$' then (d->>'baixando')::int else 0 end,
      erros = case when jsonb_typeof(d->'erros') = 'array' then
                (select coalesce(jsonb_agg(jsonb_build_object('nome', left(e->>'nome', 200), 'erro', left(e->>'erro', 300))), '[]'::jsonb)
                   from (select e from jsonb_array_elements(d->'erros') e limit 20) x)
              else '[]'::jsonb end,
      tela_largura = case when (d->>'tela_largura') ~ '^\d{3,5}$' and (d->>'tela_largura')::int between 100 and 20000
                          then (d->>'tela_largura')::int else tela_largura end,
      tela_altura = case when (d->>'tela_altura') ~ '^\d{3,5}$' and (d->>'tela_altura')::int between 100 and 20000
                         then (d->>'tela_altura')::int else tela_altura end
   where id = v_id and (ultimo_sinal is null or ultimo_sinal < now() - interval '20 seconds');
  return true;
end $$;
revoke execute on function public.mi_tv_sinal(text, jsonb) from public, anon, authenticated;
