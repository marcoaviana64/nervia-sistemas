-- Regra da Plataforma Nervia: todo app publicado na Área do Cliente tem
--   * um CARTÃO DE REFERÊNCIA (cada campo e botão em uma linha, para consulta rápida) e
--   * um MANUAL DE UTILIZAÇÃO (passo a passo das tarefas).
-- Os dois abrem num painel lateral do visor, sem sair do app.
alter table public.apps
  add column if not exists cartao_url text not null default '',
  add column if not exists manual_url text not null default '';

update public.apps
   set cartao_url = '/apps/notas/ajuda/cartao.html',
       manual_url = '/apps/notas/ajuda/manual.html'
 where id = 'notas';
