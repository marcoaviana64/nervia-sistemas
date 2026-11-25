-- NVAura 1.6 (pedido do Marco em 25/11/2026: "o cartão serve para que eu veja minha avaliação, quantas avaliações… pode ser
-- solicitação avaliação/avaliação"): o cartão mostra sempre quantas avaliações chegaram (total, inclusive as que ainda
-- esperam o lote) e, só para o dono, quantos PEDIDOS de avaliação houve = leituras do QR (cada aparelho conta 1 vez por dia).
-- A nota e as estrelas continuam mudando de 5 em 5 (lote): saber que alguém avaliou não revela a nota dele.
create table public.aur_leituras (
  chave text primary key,                       -- sha256(marca do aparelho : cartão : dia), como o "já avaliou"
  alvo  uuid not null references public.aur_cartoes on delete cascade,
  dia   date not null default public._aur_hoje()
);
create index on public.aur_leituras (alvo);
alter table public.aur_leituras enable row level security;
revoke all on public.aur_leituras from anon, authenticated;

-- nota: n = avaliações na nota (lotes fechados), media, total = todas as recebidas
create or replace function public._aur_nota(p_alvo uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('n', count(*) filter (where liberada),
    'media', round((avg(nota) filter (where liberada))::numeric, 1), 'total', count(*))
  from aur_notas where alvo = p_alvo
$$;
revoke execute on function public._aur_nota(uuid) from public, anon, authenticated;

-- meu cartão: igual à 1.0 + pedidos (só o dono vê)
create or replace function public.aur_meu_cartao() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := auth.uid(); c aur_cartoes;
begin
  if v is null then return null; end if;
  select * into c from aur_cartoes where user_id = v;
  if c.user_id is null then return jsonb_build_object('existe', false, 'nome', (select nome from perfis where user_id = v)); end if;
  return jsonb_build_object('existe', true, 'nome', c.nome, 'foto', c.foto, 'codigo', c.codigo, 'mapa_visivel', c.mapa_visivel,
    'id_dia', public._aur_id_dia(v), 'nota', public._aur_nota(v),
    'pedidos', (select count(*) from aur_leituras where alvo = v));
end $$;

-- ler o cartão pelo QR: agora recebe a marca do aparelho para contar o pedido (1 por aparelho por dia; o dono não conta)
drop function public.aur_cartao_ler(text);
create or replace function public.aur_cartao_ler(p_codigo text, p_marca text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c aur_cartoes; d date := public._aur_hoje();
begin
  perform public._aur_limite('ler', 120);
  select * into c from aur_cartoes where codigo = upper(trim(coalesce(p_codigo, '')));
  if c.user_id is null then return null; end if;
  if c.user_id is distinct from auth.uid() and length(coalesce(p_marca, '')) between 16 and 100 then
    delete from aur_leituras where dia < d - 400;
    insert into aur_leituras (chave, alvo, dia)
    values (encode(sha256(convert_to(p_marca || ':' || c.user_id || ':' || d, 'UTF8')), 'hex'), c.user_id, d)
    on conflict (chave) do nothing;
  end if;
  return jsonb_build_object('nome', c.nome, 'foto', c.foto, 'nota', public._aur_nota(c.user_id), 'meu', c.user_id = auth.uid());
end $$;
revoke execute on function public.aur_cartao_ler(text, text) from public;
grant execute on function public.aur_cartao_ler(text, text) to anon, authenticated;
