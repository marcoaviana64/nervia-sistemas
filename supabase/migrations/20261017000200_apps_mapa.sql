-- Mapa mental do app (opcional): terceiro botão de ajuda no visor da Área do Cliente, ao lado de
-- "Cartão rápido" e "Manual". O primeiro é o do Orçamentos de Compras (pedido do Marco em 17/10/2026).
alter table public.apps add column if not exists mapa_url text not null default '';

update public.apps set mapa_url = '/apps/compras/ajuda/mapa.html' where id = 'compras';
