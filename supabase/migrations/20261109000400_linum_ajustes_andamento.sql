-- Sistema Linum 2.39 — andamento dos ajustes (pedido do Marco em 09/11/2026):
--   "em ajustes, quando o produto volta temos que mudar o status e no final, quando marcamos como entregue, deve dar a
--    possibilidade de colocar uma pequena observação do retorno; e também não vi uma ficha do ajuste com os status".
--   * lin_ajuste_eventos: linha do tempo de cada ajuste (enviado, voltou, entregue, voltou para a costureira, cancelado),
--     com quem, quando e a observação. SOMENTE INCLUSÃO. O "enviado" é gravado por gatilho no insert do ajuste; os
--     outros pela lin_ajuste_andamento. Os ajustes que já existem ganham os eventos a partir das colunas (pronto_em,
--     entregue_em, cancelado_em); as voltas para a costureira antigas só ficaram no texto da observação.
--   * lin_ajustes.pronto_obs / entrega_obs: observação OPCIONAL ao marcar "Voltou" (como a peça voltou) e "Entregue"
--     (o que a cliente achou, se provou…), até 300 letras; o p_motivo da lin_ajuste_andamento passa a ser essa
--     observação nessas duas ações (antes era ignorado nelas). Voltar para a costureira e cancelar continuam exigindo.
-- Só acrescenta tabela e colunas com padrão vazio: nenhum dado existente muda.

alter table public.lin_ajustes add column if not exists pronto_obs  text not null default '';
alter table public.lin_ajustes add column if not exists entrega_obs text not null default '';

create table if not exists public.lin_ajuste_eventos (
  id          bigint generated always as identity primary key,
  ajuste_id   bigint not null references public.lin_ajustes,
  evento      text not null check (evento in ('enviado', 'pronto', 'entregue', 'reaberto', 'cancelado')),
  texto       text not null default '',
  criado_em   timestamptz not null default now(),
  criado_por  uuid references auth.users on delete set null,
  criado_nome text not null default ''
);
create index if not exists lin_ajuste_eventos_a on public.lin_ajuste_eventos (ajuste_id, criado_em);

create or replace function public.lin_ajuste_eventos_imutavel() returns trigger
language plpgsql as $$
begin raise exception 'O andamento do ajuste não pode ser alterado nem apagado'; end $$;
drop trigger if exists lin_ajuste_eventos_imutavel on public.lin_ajuste_eventos;
create trigger lin_ajuste_eventos_imutavel before update or delete on public.lin_ajuste_eventos
  for each row execute function public.lin_ajuste_eventos_imutavel();

alter table public.lin_ajuste_eventos enable row level security;
revoke all on public.lin_ajuste_eventos from anon, authenticated;
grant select on public.lin_ajuste_eventos to authenticated;
drop policy if exists lin_ajuste_eventos_ler on public.lin_ajuste_eventos;
create policy lin_ajuste_eventos_ler on public.lin_ajuste_eventos for select using (public.lin_vende());

-- histórico dos ajustes que já existem (antes de criar o gatilho, para não duplicar)
insert into public.lin_ajuste_eventos (ajuste_id, evento, texto, criado_em, criado_por, criado_nome)
select a.id, 'enviado', a.servico, a.enviado_em, a.enviado_por, a.enviado_nome from public.lin_ajustes a
 where not exists (select 1 from public.lin_ajuste_eventos e where e.ajuste_id = a.id);
insert into public.lin_ajuste_eventos (ajuste_id, evento, criado_em, criado_nome)
select a.id, 'pronto', a.pronto_em, coalesce(a.pronto_nome, '') from public.lin_ajustes a
 where a.pronto_em is not null and not exists (select 1 from public.lin_ajuste_eventos e where e.ajuste_id = a.id and e.evento = 'pronto');
insert into public.lin_ajuste_eventos (ajuste_id, evento, criado_em, criado_nome)
select a.id, 'entregue', a.entregue_em, coalesce(a.entregue_nome, '') from public.lin_ajustes a
 where a.entregue_em is not null and not exists (select 1 from public.lin_ajuste_eventos e where e.ajuste_id = a.id and e.evento = 'entregue');
insert into public.lin_ajuste_eventos (ajuste_id, evento, texto, criado_em, criado_nome)
select a.id, 'cancelado', coalesce(a.motivo_cancelamento, ''), a.cancelado_em, coalesce(a.cancelado_nome, '') from public.lin_ajustes a
 where a.cancelado_em is not null and not exists (select 1 from public.lin_ajuste_eventos e where e.ajuste_id = a.id and e.evento = 'cancelado');

-- ajuste novo = evento "enviado"
create or replace function public.lin_ajustes_enviado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.lin_ajuste_eventos (ajuste_id, evento, texto, criado_em, criado_por, criado_nome)
  values (new.id, 'enviado', new.servico, new.enviado_em, new.enviado_por, new.enviado_nome);
  return new;
end $$;
drop trigger if exists lin_ajustes_enviado on public.lin_ajustes;
create trigger lin_ajustes_enviado after insert on public.lin_ajustes for each row execute function public.lin_ajustes_enviado();

-- andamento: 'pronto' (voltou da costureira; obs. opcional), 'entregue' (cliente levou; obs. opcional),
-- 'reabrir' (voltou para a costureira; o que faltou, obrigatório), 'cancelar' (motivo obrigatório)
create or replace function public.lin_ajuste_andamento(p_ajuste bigint, p_acao text, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a public.lin_ajustes; v_txt text := left(trim(coalesce(p_motivo, '')), 300);
        v_ev text := case p_acao when 'pronto' then 'pronto' when 'entregue' then 'entregue' when 'reabrir' then 'reaberto' when 'cancelar' then 'cancelado' end;
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  select * into a from public.lin_ajustes where id = p_ajuste for update;
  if a.id is null then raise exception 'Ajuste não encontrado'; end if;
  if p_acao = 'pronto' then
    if a.situacao <> 'na_costureira' then raise exception 'Este ajuste não está com a costureira'; end if;
    update public.lin_ajustes set situacao = 'pronto', pronto_em = now(), pronto_nome = public._lin_nome(), pronto_obs = v_txt where id = p_ajuste;
  elsif p_acao = 'entregue' then
    if a.situacao not in ('pronto', 'na_costureira') then raise exception 'Este ajuste já foi % ', case a.situacao when 'entregue' then 'entregue' else 'cancelado' end; end if;
    if a.situacao = 'na_costureira' then   -- entregue direto, sem marcar a volta: registra a volta junto
      insert into public.lin_ajuste_eventos (ajuste_id, evento, criado_por, criado_nome) values (p_ajuste, 'pronto', auth.uid(), public._lin_nome());
    end if;
    update public.lin_ajustes set situacao = 'entregue', pronto_em = coalesce(pronto_em, now()), pronto_nome = coalesce(pronto_nome, public._lin_nome()),
           entregue_em = now(), entregue_nome = public._lin_nome(), entrega_obs = v_txt where id = p_ajuste;
  elsif p_acao = 'reabrir' then
    if a.situacao <> 'pronto' then raise exception 'Só volta para a costureira um ajuste que está pronto na loja'; end if;
    if length(v_txt) < 3 then raise exception 'Diga o que faltou ajustar'; end if;
    update public.lin_ajustes set situacao = 'na_costureira', pronto_em = null, pronto_nome = null, pronto_obs = '',
           observacao = trim(observacao || E'\n' || 'Voltou para a costureira: ' || v_txt) where id = p_ajuste;
  elsif p_acao = 'cancelar' then
    if a.situacao in ('entregue', 'cancelado') then raise exception 'Este ajuste já foi encerrado'; end if;
    if not public.lin_eh_dono() and a.enviado_por is distinct from auth.uid() then raise exception 'Só quem registrou (ou o Dono) cancela o ajuste'; end if;
    if length(v_txt) < 3 then raise exception 'Informe o motivo do cancelamento'; end if;
    update public.lin_ajustes set situacao = 'cancelado', cancelado_em = now(), cancelado_nome = public._lin_nome(), motivo_cancelamento = v_txt where id = p_ajuste;
  else
    raise exception 'Ação inválida';
  end if;
  insert into public.lin_ajuste_eventos (ajuste_id, evento, texto, criado_por, criado_nome) values (p_ajuste, v_ev, v_txt, auth.uid(), public._lin_nome());
  perform public._lin_auditar('linum_ajuste_' || v_ev, null,
    jsonb_build_object('ajuste', p_ajuste, 'venda', a.venda_id, 'peca', a.peca, 'costureira', a.costureira,
                       case when p_acao in ('pronto', 'entregue') then 'observacao' else 'motivo' end, nullif(v_txt, '')));
end $$;
revoke execute on function public.lin_ajuste_andamento(bigint, text, text) from public, anon;
grant execute on function public.lin_ajuste_andamento(bigint, text, text) to authenticated;
