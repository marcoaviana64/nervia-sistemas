-- Sistema Linum — a venda entra sozinha no CRM (pedido do Marco em 25/10/2026; versão 1.10 do app).
--   * Venda com cliente → contato automático no histórico ("Comprou", canal Na loja, por quem vendeu, com loja, nº e peças).
--     SEM o valor no texto (pedido do Marco: vendedora não vê o valor das vendas das outras); o Dono vê o total na tela,
--     que busca a venda pelo venda_id (o RLS de lin_vendas só mostra a venda a quem a fez e ao Dono).
--     e o último contato da cliente passa a ser a venda.
--   * Pós-venda: o próximo contato da cliente vira a data da venda + 7 dias (para perguntar se gostou da peça), a não ser
--     que já exista um contato marcado antes disso; boleta antiga cujo pós-venda já passou não marca nada.
--   * Venda cancelada → contato automático "Venda nº … cancelada" com o motivo, e o pós-venda que ela marcou sai.
--   * As vendas com cliente que já existiam entram no histórico (sem mexer no próximo contato).
alter table public.lin_contatos add column if not exists venda_id bigint references public.lin_vendas on delete set null;
create unique index if not exists lin_contatos_venda on public.lin_contatos (venda_id, resultado) where venda_id is not null;

create or replace function public._lin_venda_resumo(p_venda bigint) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(string_agg((case when i.quantidade > 1 then i.quantidade || '× ' else '' end)
           || concat_ws(' ', nullif(i.referencia, ''), nullif(i.descricao, ''), nullif(i.cor, ''), nullif(i.tamanho, ''), nullif(i.edicao, '')), '; ' order by i.id), '')
    from public.lin_venda_itens i where i.venda_id = p_venda
$$;

-- roda no fim da transação (constraint trigger adiada), quando os itens da venda já foram gravados
create or replace function public.lin_venda_no_crm() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_pos date; v_prox date; v public.lin_vendas;
begin
  -- relê a venda: o NEW é a linha do momento do insert, antes de a função gravar os totais
  select * into v from public.lin_vendas where id = new.id;
  if v.cliente_id is null then return null; end if;
  v_pos := v.data + 7;
  if tg_op = 'INSERT' then
    select proximo_contato into v_prox from public.lin_clientes where id = v.cliente_id;
    -- pós-venda só se ainda vai acontecer e se não houver contato marcado antes dele
    if v_pos < v_hoje or (v_prox is not null and v_prox >= v_hoje and v_prox <= v_pos) then v_pos := null; end if;
    insert into public.lin_contatos (cliente_id, em, por, por_nome, canal, resultado, texto, proximo_contato, venda_id)
    values (v.cliente_id, now(), v.vendedora_id, v.vendedora_nome, 'loja', 'comprou',
            format('Comprou na %s — venda nº %s: %s', public._lin_loja(v.loja_id), v.id, public._lin_venda_resumo(v.id))
              || case when v_pos is not null then '. Pós-venda marcado para ' || to_char(v_pos, 'DD/MM') || '.' else '' end,
            v_pos, v.id)
    on conflict do nothing;
    update public.lin_clientes set ultimo_contato = now(), proximo_contato = coalesce(v_pos, proximo_contato), atualizado_em = now()
    where id = v.cliente_id;
  elsif v.cancelada_em is not null and old.cancelada_em is null then
    insert into public.lin_contatos (cliente_id, em, por, por_nome, canal, resultado, texto, venda_id)
    values (v.cliente_id, now(), v.cancelada_por, coalesce(v.cancelada_nome, ''), 'loja', 'outro',
            format('Venda nº %s cancelada. Motivo: %s', v.id, coalesce(v.motivo_cancelamento, '—')), v.id)
    on conflict do nothing;
    -- o pós-venda marcado por esta venda deixa de valer (se ninguém marcou outro contato depois)
    update public.lin_clientes c set proximo_contato = null, atualizado_em = now()
     where c.id = v.cliente_id and c.proximo_contato = (select proximo_contato from public.lin_contatos where venda_id = v.id and resultado = 'comprou')
       and not exists (select 1 from public.lin_contatos x where x.cliente_id = v.cliente_id and x.venda_id is null
                         and x.em > (select em from public.lin_contatos where venda_id = v.id and resultado = 'comprou'));
  end if;
  return null;
end $$;
revoke execute on function public.lin_venda_no_crm() from public, anon, authenticated;
revoke execute on function public._lin_venda_resumo(bigint) from public, anon, authenticated;

drop trigger if exists lin_vendas_crm on public.lin_vendas;
create constraint trigger lin_vendas_crm after insert or update of cancelada_em on public.lin_vendas
  deferrable initially deferred for each row execute function public.lin_venda_no_crm();

-- vendas que já existiam: entram no histórico com a data em que foram registradas
insert into public.lin_contatos (cliente_id, em, por, por_nome, canal, resultado, texto, venda_id)
select v.cliente_id, v.criado_em, v.vendedora_id, v.vendedora_nome, 'loja', 'comprou',
       format('Comprou na %s — venda nº %s: %s', public._lin_loja(v.loja_id), v.id, public._lin_venda_resumo(v.id)),
       v.id
  from public.lin_vendas v where v.cliente_id is not null
on conflict do nothing;
insert into public.lin_contatos (cliente_id, em, por, por_nome, canal, resultado, texto, venda_id)
select v.cliente_id, v.cancelada_em, v.cancelada_por, coalesce(v.cancelada_nome, ''), 'loja', 'outro',
       format('Venda nº %s cancelada. Motivo: %s', v.id, coalesce(v.motivo_cancelamento, '—')), v.id
  from public.lin_vendas v where v.cliente_id is not null and v.cancelada_em is not null
on conflict do nothing;
update public.lin_clientes c set ultimo_contato = x.em
  from (select cliente_id, max(em) em from public.lin_contatos group by cliente_id) x
 where x.cliente_id = c.id and (c.ultimo_contato is null or c.ultimo_contato < x.em);
