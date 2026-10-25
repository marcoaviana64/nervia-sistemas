-- Sistema Linum — visita sem contato (pedido do Marco em 25/10/2026; versão 1.9).
-- "Se um cliente entra na loja, vê as peças e não deixa contato": registro rápido SEM dado pessoal — loja, quantas pessoas,
-- peças que olhou/provou, por que não levou (pode ser mais de um motivo; "Outro" com o motivo escrito)
-- e o que faltou (tamanho/cor). Serve para conversão (visitas × vendas),
-- peças mais provadas sem venda e venda perdida por falta de tamanho/cor. SOMENTE INCLUSÃO.
create table if not exists public.lin_visitas (
  id          bigint generated always as identity primary key,
  em          timestamptz not null default now(),
  data        date not null default (now() at time zone 'America/Sao_Paulo')::date,
  loja_id     uuid not null references public.lin_lojas,
  por         uuid references auth.users on delete set null,
  por_nome    text not null default '',
  pessoas     int not null default 1 check (pessoas between 1 and 20),
  motivos     text[] not null check (cardinality(motivos) >= 1 and motivos <@ array['tamanho', 'cor', 'preco', 'so_olhando', 'vai_voltar', 'outro']),
  motivo_outro text not null default '',
  faltou      text not null default '',
  pecas       jsonb not null default '[]',
  observacao  text not null default ''
);
create index if not exists lin_visitas_data on public.lin_visitas (data desc, loja_id);

create or replace function public.lin_visitas_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'Visita registrada não pode ser alterada nem apagada.';
end $$;
drop trigger if exists lin_visitas_imutavel on public.lin_visitas;
create trigger lin_visitas_imutavel before update or delete on public.lin_visitas
  for each row when (pg_trigger_depth() = 0) execute function public.lin_visitas_imutavel();

alter table public.lin_visitas enable row level security;
revoke all on public.lin_visitas from anon;
revoke insert, update, delete on public.lin_visitas from authenticated;
-- como nas vendas: cada um vê as próprias visitas; o Dono vê todas
drop policy if exists lin_visitas_ler on public.lin_visitas;
create policy lin_visitas_ler on public.lin_visitas for select using (public.lin_eh_dono() or (public.lin_vende() and por = auth.uid()));

create or replace function public.lin_visita_registrar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_loja uuid := nullif(p ->> 'loja_id', '')::uuid; v_pes int := coalesce(nullif(p ->> 'pessoas', '')::int, 1);
        v_mot text[]; v_outro text := coalesce(public._lin_txt(p, 'motivo_outro'), ''); v_ids uuid[]; v_pecas jsonb; v_id bigint;
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  if v_loja is null or not exists (select 1 from public.lin_lojas where id = v_loja) then raise exception 'Escolha a loja'; end if;
  if v_pes not between 1 and 20 then raise exception 'Quantidade de pessoas: de 1 a 20'; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_mot from jsonb_array_elements_text(coalesce(p -> 'motivos', '[]')) x;
  if cardinality(v_mot) = 0 or not v_mot <@ array['tamanho', 'cor', 'preco', 'so_olhando', 'vai_voltar', 'outro'] then
    raise exception 'Escolha por que não levou (pode marcar mais de um)';
  end if;
  if 'outro' = any(v_mot) and length(v_outro) < 3 then raise exception 'Escreva qual foi o outro motivo'; end if;
  if not 'outro' = any(v_mot) then v_outro := ''; end if;
  select coalesce(array_agg(distinct x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(p -> 'pecas', '[]')) x;
  if cardinality(v_ids) > 20 then raise exception 'No máximo 20 peças por visita'; end if;
  -- cópia da etiqueta, como na venda (se a peça mudar depois, a visita continua mostrando o que era)
  select coalesce(jsonb_agg(jsonb_build_object('variante_id', v.id, 'referencia', pr.referencia, 'descricao', pr.descricao,
           'cor', v.cor, 'tamanho', v.tamanho, 'edicao', v.edicao) order by pr.descricao, v.cor, v.tamanho), '[]')
    into v_pecas from public.lin_variantes v join public.lin_produtos pr on pr.id = v.produto_id where v.id = any(v_ids);
  if jsonb_array_length(v_pecas) <> cardinality(v_ids) then raise exception 'Peça não encontrada'; end if;
  insert into public.lin_visitas (loja_id, por, por_nome, pessoas, motivos, motivo_outro, faltou, pecas, observacao)
  values (v_loja, auth.uid(), public._lin_nome(), v_pes, v_mot, v_outro, coalesce(public._lin_txt(p, 'faltou'), ''), v_pecas,
          coalesce(public._lin_txt(p, 'observacao'), ''))
  returning id into v_id;
  perform public._lin_auditar('linum_visita_registrada', null, jsonb_build_object('visita_id', v_id, 'loja', public._lin_loja(v_loja),
    'pessoas', v_pes, 'motivos', to_jsonb(v_mot), 'motivo_outro', v_outro, 'pecas', jsonb_array_length(v_pecas)));
  return v_id;
end $$;
revoke execute on function public.lin_visita_registrar(jsonb) from public, anon;
grant execute on function public.lin_visita_registrar(jsonb) to authenticated;
