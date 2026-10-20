-- Monitor de Links: link marcado como "Monitorar: Não" (ex.: link de backup que não existe no local, pedido do Marco em 20/10/2026).
-- O mon_registrar já ignora as medições de link desligado; aqui, ao desligar, a queda em aberto desse link é encerrada
-- e o status volta para "sem dados", para não ficar informação de um link que não é monitorado.
create or replace function public.mon_link_desligado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.ativo and not new.ativo then
    update public.mon_quedas set fim = now(),
      obs = case when obs = '' then 'Encerrada: o link deixou de ser monitorado.' else obs end
     where link_id = new.id and fim is null;
    new.status := 'sem_dados'; new.status_desde := now();
  end if;
  return new;
end $$;
drop trigger if exists mon_links_desligado on public.mon_links;
create trigger mon_links_desligado before update of ativo on public.mon_links
  for each row execute function public.mon_link_desligado();
