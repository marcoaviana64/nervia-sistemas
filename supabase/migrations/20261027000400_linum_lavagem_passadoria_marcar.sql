-- Sistema Linum 2.7 (pedido do Marco em 27/10/2026): "não é obrigatório registrar os passos de passadoria e lavagem,
-- somente corte e costura e o envio para a loja registrando a entrada no estoque; deixe só uma caixa de marcação na
-- lavagem e na passadoria".
--   * A entrada no estoque passa a depender só da COSTURA: disponível = boas que voltaram da costura − já entraram no
--     estoque − as que ainda estão (ou se perderam) numa remessa antiga de lavagem/passadoria (as remessas já feitas ficam
--     no histórico e continuam valendo; a tela não cria novas).
--   * Lavagem e passadoria = caixa de marcação por ficha (feita / quem / quando), opcional, que não trava nada;
--     lin_ordem_marcar(ordem, etapa, feito), permissão Produção, auditoria linum_producao_marcada.
alter table public.lin_ordens add column if not exists lavagem_em timestamptz;
alter table public.lin_ordens add column if not exists lavagem_nome text;
alter table public.lin_ordens add column if not exists passadoria_em timestamptz;
alter table public.lin_ordens add column if not exists passadoria_nome text;

create or replace function public._lin_disponivel(p_item bigint, p_etapa text) returns int
language sql stable security definer set search_path = public as $$
  with env as (
    select e.etapa, sum(ei.enviadas) as env, sum(ei.recebidas) as rec
      from public.lin_envio_itens ei join public.lin_envios e on e.id = ei.envio_id where ei.ordem_item_id = p_item group by e.etapa)
  select (case p_etapa
    when 'corte' then (select quantidade from public.lin_ordem_itens where id = p_item) - coalesce((select env from env where etapa = 'corte'), 0)
    when 'costura' then coalesce((select rec from env where etapa = 'corte'), 0) - coalesce((select env from env where etapa = 'costura'), 0)
    -- lavagem e passadoria não têm mais remessa: nada disponível para elas
    when 'estoque' then coalesce((select rec from env where etapa = 'costura'), 0)
                        - coalesce((select sum(quantidade) from public.lin_ordem_entradas where ordem_item_id = p_item), 0)
                        - coalesce((select sum(env - rec) from env where etapa in ('lavagem', 'passadoria')), 0)
    else 0 end)::int
$$;
revoke execute on function public._lin_disponivel(bigint, text) from public, anon, authenticated;

create or replace function public.lin_ordem_marcar(p_ordem bigint, p_etapa text, p_feito boolean) returns void
language plpgsql security definer set search_path = public as $$
declare o public.lin_ordens;
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  if p_etapa not in ('lavagem', 'passadoria') then raise exception 'Só lavagem e passadoria são marcadas'; end if;
  select * into o from public.lin_ordens where id = p_ordem for update;
  if o.id is null then raise exception 'Ficha não encontrada'; end if;
  if o.status <> 'aberta' then raise exception 'A ficha nº % não está aberta', p_ordem; end if;
  if p_etapa = 'lavagem' then
    update public.lin_ordens set lavagem_em = case when p_feito then now() end, lavagem_nome = case when p_feito then public._lin_nome() end where id = p_ordem;
  else
    update public.lin_ordens set passadoria_em = case when p_feito then now() end, passadoria_nome = case when p_feito then public._lin_nome() end where id = p_ordem;
  end if;
  perform public._lin_auditar('linum_producao_marcada', null, jsonb_build_object('ficha', p_ordem, 'etapa', p_etapa, 'feita', coalesce(p_feito, false)));
end $$;
revoke execute on function public.lin_ordem_marcar(bigint, text, boolean) from public, anon;
grant execute on function public.lin_ordem_marcar(bigint, text, boolean) to authenticated;
