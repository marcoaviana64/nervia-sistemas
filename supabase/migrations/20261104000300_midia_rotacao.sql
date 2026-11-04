-- Mídia Indoor: posição da TV (pedido do Marco em 04/11/2026: "geralmente a TV é virada; em algum local deve ter
-- a informação de como o app deve exibir a mídia, horizontal ou vertical, sem pedir ao cliente o vídeo rotacionado").
-- rotacao = quantos graus o app gira a imagem no sentido horário: 0 = TV deitada (normal), 90 = TV em pé (girada
-- para a direita), 270 = TV em pé (girada para a esquerda), 180 = de cabeça para baixo (suporte no teto).
-- Coluna nova com padrão 0 = comportamento de antes.

alter table public.mi_telas add column if not exists rotacao int not null default 0 check (rotacao in (0, 90, 180, 270));
grant select (rotacao) on public.mi_telas to authenticated;

create or replace function public.mi_tela_girar(p_tela uuid, p_rotacao int) returns void
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select * into t from public.mi_telas where id = p_tela;
  if not found or not public.mi_pode_ver(t.conta_id) then raise exception 'TV não encontrada.'; end if;
  if p_rotacao is null or p_rotacao not in (0, 90, 180, 270) then raise exception 'Posição inválida.'; end if;
  if p_rotacao = t.rotacao then return; end if;
  update public.mi_telas set rotacao = p_rotacao where id = p_tela;
  perform public.auditar('midia_rotacao_alterada', null, jsonb_build_object('conta', (select nome from public.mi_contas where id = t.conta_id),
    'conta_id', t.conta_id, 'tela', t.nome, 'tela_id', p_tela, 'antes', t.rotacao, 'depois', p_rotacao));
end $$;
revoke execute on function public.mi_tela_girar(uuid, int) from public, anon;
