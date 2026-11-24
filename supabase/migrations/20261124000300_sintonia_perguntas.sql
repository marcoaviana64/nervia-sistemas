-- NVSintonia 1.2 — perguntas novas do modelo pessoal (questionário escolhido pelo Marco em 24/11/2026:
-- Respeito e consideração, Confiança e credibilidade, Empatia e relacionamento, Comunicação e convivência,
-- Influência e contribuição) + a opção "Não tenho condições de avaliar" (nota vazia, não conta na média).
-- Decisão do Marco (24/11/2026): "não guarda nada que existe, pode zerar" — todas as avaliações feitas até aqui são
-- apagadas (pessoal, 360° e encontros). Contas, perfis, círculos e links dos convites continuam.

-- pessoal: 5 notas de 0 a 5, cada uma pode ficar vazia (não tenho condições de avaliar), mas pelo menos uma preenchida
create or replace function public._sin_notas_ok(p_modelo text, p_notas smallint[]) returns boolean
language sql immutable as $$
  select case p_modelo
    when 'p' then array_length(p_notas, 1) = 5 and not exists (select 1 from unnest(p_notas) n where n < 0 or n > 5)
                  and exists (select 1 from unnest(p_notas) n where n is not null)
    when 'r' then array_length(p_notas, 1) = 10 and not exists (select 1 from unnest(p_notas) n where n < 1 or n > 5)
                  and exists (select 1 from unnest(p_notas) n where n is not null)
    else false end
$$;

-- nota dos encontros: em cada item, só quem avaliou entra na conta (peso da dúvida m = 10 sobre a média de todos)
create or replace function public._sin_nota(p_alvo uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare n int; itens jsonb;
begin
  select count(*) into n from sin_enc_notas where alvo = p_alvo and liberada;
  if n < 5 then return jsonb_build_object('n', n, 'itens', null, 'geral', null); end if;
  select jsonb_agg(round(((10 * g.mu + s.soma) / (10 + s.qt))::numeric, 2) order by i) into itens
  from generate_series(1, 5) i
  cross join lateral (select coalesce(sum(notas[i]), 0) as soma, count(notas[i]) as qt from sin_enc_notas where alvo = p_alvo and liberada) s
  cross join lateral (select case when count(notas[i]) >= 20 then avg(notas[i]) else 3.5 end as mu from sin_enc_notas where liberada) g;
  return jsonb_build_object('n', n, 'itens', itens,
    'geral', (select round(avg(x::numeric), 2) from jsonb_array_elements_text(itens) x));
end $$;
revoke execute on function public._sin_nota(uuid) from public, anon, authenticated;

-- zerar tudo o que foi avaliado com as perguntas antigas
do $$
declare r jsonb;
begin
  r := jsonb_build_object(
    'respostas', (select count(*) from public.sin_respostas),
    'avaliacoes_encontros', (select count(*) from public.sin_enc_notas),
    'autoavaliacoes', (select count(*) from public.sin_espelhos where auto is not null));
  delete from public.sin_respostas;
  delete from public.sin_respondidos;
  delete from public.sin_enc_notas;
  delete from public.sin_fichas;
  delete from public.sin_pares;
  delete from public.sin_qr;
  update public.sin_espelhos set rodada = 1, rodada_em = now(), auto = null, auto_em = null;
  perform public.auditar('sintonia_avaliacoes_zeradas', null, r || '{"motivo": "perguntas novas do modelo pessoal (1.2)"}'::jsonb);
end $$;
