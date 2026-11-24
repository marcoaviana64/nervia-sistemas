-- NVSintonia 1.3 — 360° profissional com as 5 competências propostas pelo Marco em 24/11/2026 (no lugar dos 10
-- comportamentos do Project Oxygen): Liderança e capacidade de decisão, Comunicação e relacionamento interpessoal,
-- Comprometimento e responsabilidade, Iniciativa e resolução de problemas, Trabalho em equipe e desenvolvimento de pessoas.
-- Escala de 0 a 5 (0 = não demonstra … 5 = é uma referência), a mesma do pessoal, com "Não tenho condições de avaliar"
-- (nota vazia, não conta). Os grupos (Gestor, Pares, Liderados, Clientes internos) e os mínimos (3; gestor 1) não mudam.
-- As respostas e autoavaliações do 360° antigo (10 itens) não cabem no modelo novo e são apagadas; o pessoal fica intacto.

create or replace function public._sin_notas_ok(p_modelo text, p_notas smallint[]) returns boolean
language sql immutable as $$
  select p_modelo in ('p', 'r') and array_length(p_notas, 1) = 5
    and not exists (select 1 from unnest(p_notas) n where n < 0 or n > 5)
    and exists (select 1 from unnest(p_notas) n where n is not null)
$$;

-- igual à 1.0, com 5 itens nos dois modelos
create or replace function public.sin_espelho(p_modelo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e sin_espelhos := public._sin_espelho(p_modelo); v_n constant int := 5;
begin
  return jsonb_build_object(
    'modelo', e.modelo, 'rodada', e.rodada, 'rodada_em', e.rodada_em, 'auto', to_jsonb(e.auto), 'auto_em', e.auto_em,
    'nova_rodada_em', case when exists (select 1 from sin_respostas r join sin_circulos c on c.id = r.circulo_id where c.espelho_id = e.id and r.rodada = e.rodada)
                           then (e.rodada_em + interval '90 days')::date end,
    'circulos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'nome', c.nome, 'gestor', c.gestor, 'codigo', c.codigo, 'minimo', public._sin_min(e.modelo, c.gestor),
        'liberadas', lib.n,
        'medias', case when e.auto is null or lib.n < public._sin_min(e.modelo, c.gestor) then null else lib.medias end)
        order by c.gestor desc, c.id)
      from sin_circulos c
      cross join lateral (
        select count(*)::int as n,
          (select jsonb_agg((select round(avg(r2.notas[i])::numeric, 2) from sin_respostas r2
                             where r2.circulo_id = c.id and r2.rodada = e.rodada and r2.liberada) order by i)
           from generate_series(1, v_n) i) as medias
        from sin_respostas r where r.circulo_id = c.id and r.rodada = e.rodada and r.liberada) lib
      where c.espelho_id = e.id), '[]'::jsonb));
end $$;

-- zerar o 360° antigo (respostas, "já respondeu" dos grupos do 360° e autoavaliações); pessoal e encontros ficam
do $$
declare r jsonb;
begin
  r := jsonb_build_object(
    'respostas', (select count(*) from public.sin_respostas s join public.sin_circulos c on c.id = s.circulo_id
                  join public.sin_espelhos e on e.id = c.espelho_id where e.modelo = 'r'),
    'autoavaliacoes', (select count(*) from public.sin_espelhos where modelo = 'r' and auto is not null));
  delete from public.sin_respostas s using public.sin_circulos c, public.sin_espelhos e
   where c.id = s.circulo_id and e.id = c.espelho_id and e.modelo = 'r';
  delete from public.sin_respondidos d using public.sin_circulos c, public.sin_espelhos e
   where c.id = d.circulo_id and e.id = c.espelho_id and e.modelo = 'r';
  update public.sin_espelhos set rodada = 1, rodada_em = now(), auto = null, auto_em = null where modelo = 'r';
  perform public.auditar('sintonia_avaliacoes_zeradas', null, r || '{"motivo": "360° com as 5 competências novas (1.3)"}'::jsonb);
end $$;
