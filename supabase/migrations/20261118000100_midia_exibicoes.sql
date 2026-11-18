-- Mídia Indoor — relatório de TEMPO DE TELA (pedido do Marco em 18/11/2026: "quanto tempo cada mídia aparece em cada TV,
-- para dar um relatório mensal aos clientes"; o cliente vê o das TVs dele, a Nervia vê todos).
-- O app da TV (1.6) anota cada exibição no aparelho (mídia, início, segundos que ficou de fato na tela; continua anotando sem
-- internet) e manda em lotes pela função midia-tv (ação "exibicoes"). Aqui fica o RESUMO por TV × dia × mídia (vezes e
-- segundos), que é o que o relatório usa; a exibição uma a uma não é guardada no servidor.
-- O histórico não some quando a TV é desvinculada (mi_desvincular apaga a linha de mi_telas): por isso a tabela guarda o id
-- e o NOME da TV, sem chave estrangeira para mi_telas. Excluir a conta apaga o relatório dela (on delete cascade).
-- Só inclusão de tabelas novas: nada do que existe muda.

create table if not exists public.mi_exibicoes (
  conta_id   uuid not null references public.mi_contas on delete cascade,
  tela_id    uuid not null,                         -- id da TV (sem FK: o relatório fica depois do desvínculo)
  tela_nome  text not null default '',
  dia        date not null,                         -- dia em Brasília em que a exibição começou
  drive_id   text not null,                         -- arquivo do Drive
  nome       text not null default '',              -- nome do arquivo na última exibição
  tipo       text not null default 'outro' check (tipo in ('video', 'imagem', 'outro')),
  vezes      int not null default 0 check (vezes >= 0),
  segundos   numeric(12,1) not null default 0 check (segundos >= 0),
  atualizado_em timestamptz not null default now(),
  primary key (tela_id, dia, drive_id)
);
create index if not exists mi_exibicoes_conta_dia on public.mi_exibicoes (conta_id, dia);

-- lotes já recebidos de cada TV: o mesmo lote mandado de novo (internet caiu antes da resposta) não conta duas vezes
create table if not exists public.mi_exib_lotes (
  tela_id     uuid not null,
  lote        text not null,
  itens       int not null default 0,
  recebido_em timestamptz not null default now(),
  primary key (tela_id, lote)
);

alter table public.mi_exibicoes enable row level security;
alter table public.mi_exib_lotes enable row level security;
revoke all on public.mi_exibicoes, public.mi_exib_lotes from anon, authenticated;
grant select on public.mi_exibicoes to authenticated;   -- o lote é só do servidor
drop policy if exists mi_exibicoes_ler on public.mi_exibicoes;
create policy mi_exibicoes_ler on public.mi_exibicoes for select using ((select public.mi_pode_ver(conta_id)));

-- TV manda um lote de exibições (só pela função midia-tv, com service role).
-- p_itens = [{id, nome, tipo?, inicio (epoch em ms), segundos}]; devolve quantas entraram, ou null se o token não vale.
-- Recusa o lote inteiro se vier mal formado; exibição de menos de 1 s, com mais de 1 dia ou fora de 60 dias atrás até amanhã
-- é ignorada (relógio errado da TV).
create or replace function public.mi_tv_exibicoes(p_token text, p_lote text, p_itens jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_tela uuid := public.mi_tv_tela(p_token); t record; n int;
begin
  if v_tela is null then return null; end if;
  if coalesce(p_lote, '') !~ '^[A-Za-z0-9-]{8,64}$' then raise exception 'Lote inválido.'; end if;
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) > 5000 then raise exception 'Lote inválido.'; end if;
  select id, conta_id, nome into t from public.mi_telas where id = v_tela;
  insert into public.mi_exib_lotes (tela_id, lote, itens) values (v_tela, p_lote, jsonb_array_length(p_itens))
  on conflict do nothing;
  if not found then return 0; end if;   -- lote repetido: já contado
  with e as (
    select left(i->>'id', 200) as drive_id, left(coalesce(i->>'nome', ''), 200) as nome,
           case when i->>'tipo' in ('video', 'imagem') then i->>'tipo' end as tipo,
           to_timestamp((i->>'inicio')::numeric / 1000) as inicio, round((i->>'segundos')::numeric, 1) as seg
      from jsonb_array_elements(p_itens) i
     where coalesce(i->>'id', '') ~ '^[A-Za-z0-9_-]{1,200}$'
       and coalesce(i->>'inicio', '') ~ '^\d{10,14}(\.\d+)?$'
       and coalesce(i->>'segundos', '') ~ '^\d{1,6}(\.\d+)?$'
  ), v as (
    select * from e where seg >= 1 and seg <= 86400
       and inicio between now() - interval '60 days' and now() + interval '1 day'
  ), g as (
    select (inicio at time zone 'America/Sao_Paulo')::date as dia, drive_id,
           (array_agg(nome order by inicio desc))[1] as nome,
           coalesce((array_agg(tipo order by inicio desc) filter (where tipo is not null))[1],
                    (select m.tipo from public.mi_midias m join public.mi_playlists p on p.id = m.playlist_id
                      where p.conta_id = t.conta_id and m.drive_id = v.drive_id limit 1), 'outro') as tipo,
           count(*)::int as vezes, sum(seg) as segundos
      from v group by 1, 2
  )
  insert into public.mi_exibicoes as x (conta_id, tela_id, tela_nome, dia, drive_id, nome, tipo, vezes, segundos)
  select t.conta_id, v_tela, t.nome, g.dia, g.drive_id, g.nome, g.tipo, g.vezes, g.segundos from g
  on conflict (tela_id, dia, drive_id) do update set vezes = x.vezes + excluded.vezes, segundos = x.segundos + excluded.segundos,
    nome = excluded.nome, tipo = excluded.tipo, tela_nome = excluded.tela_nome, atualizado_em = now();
  get diagnostics n = row_count;
  delete from public.mi_exib_lotes where tela_id = v_tela and recebido_em < now() - interval '30 days';
  return n;
end $$;
revoke execute on function public.mi_tv_exibicoes(text, text, jsonb) from public, anon, authenticated;
