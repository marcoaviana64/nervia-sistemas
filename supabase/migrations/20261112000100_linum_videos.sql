-- Sistema Linum 2.49 — VÍDEOS DO PRODUTO PARA MOSTRAR À CLIENTE (pedido do Marco em 12/11/2026):
--   "quando a vendedora está mostrando roupa, mostra só na arara; temos vários vídeos da modelo com as roupas. No produto,
--    um botão que abra uma fichinha só para a cliente ver (nome, valor, cor) e uma janela com os vídeos daquele produto;
--    os vídeos ficam numa pasta do Google Drive, uma pasta por produto." No começo no celular ou no computador da loja;
--   depois num tablet. Sugestões aprovadas com "pode fazer": uma pasta por produto (o nome do arquivo com a cor faz o
--   vídeo aparecer quando se escolhe a cor), Dono e Estoque colam o link, fotos da pasta também aparecem.
--   * lin_produtos.video_pasta = link da pasta (vazio = sem vídeos). A pasta tem de estar compartilhada com "qualquer
--     pessoa com o link", como no Mídia Indoor (mesma leitura do link: mi_pasta_do_link).
--   * lin_produto_video_salvar(produto, link): Dono e Estoque; auditoria linum_produto_video (antes/depois).
--   * lin_videos_produtos(): {produto: link} dos produtos com pasta, para toda a equipe (o ▶ no Estoque e o campo no
--     cadastro; o Estoque lê o catálogo pela lin_catalogo, que não traz a coluna).
--   * _lin_video_pasta(usuário, produto): só para a função linum-videos (service role): confere que o login tem papel no
--     Linum agora (horário incluído) e devolve o id da pasta; a lista dos arquivos vem do Google Drive pela função, com a
--     chave da API guardada nos segredos (nunca vai para o navegador). O vídeo toca no player do próprio Google Drive.
-- Só acrescenta uma coluna com padrão vazio: nenhum dado existente muda.

alter table public.lin_produtos add column if not exists video_pasta text not null default '';

create or replace function public.lin_produto_video_salvar(p_produto uuid, p_url text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.lin_produtos; u text := trim(coalesce(p_url, '')); pz record;
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque cadastra a pasta de vídeos'; end if;
  select * into v from public.lin_produtos where id = p_produto for update;
  if v.id is null then raise exception 'Produto não encontrado'; end if;
  select * into pz from public.mi_pasta_do_link(u);
  if u <> '' and pz.pasta_id = '' then
    raise exception 'Link de pasta do Google Drive não reconhecido. No Drive, clique com o botão direito na pasta → Compartilhar → Copiar link.';
  end if;
  if u = v.video_pasta then return; end if;
  update public.lin_produtos set video_pasta = u where id = p_produto;
  perform public._lin_auditar('linum_produto_video', null, jsonb_build_object('produto', v.id, 'referencia', v.referencia, 'peca', v.descricao,
    'antes', jsonb_build_object('video_pasta', v.video_pasta), 'depois', jsonb_build_object('video_pasta', u)));
end $$;
revoke execute on function public.lin_produto_video_salvar(uuid, text) from public, anon;
grant execute on function public.lin_produto_video_salvar(uuid, text) to authenticated;

create or replace function public.lin_videos_produtos() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.lin_papel() is null then raise exception 'Seu login não tem acesso ao Sistema Linum agora'; end if;
  return coalesce((select jsonb_object_agg(id, video_pasta) from public.lin_produtos where video_pasta <> ''), '{}');
end $$;
revoke execute on function public.lin_videos_produtos() from public, anon;
grant execute on function public.lin_videos_produtos() to authenticated;

-- só a função linum-videos (service role) chama: confere o papel do login (como se fosse ele) e devolve a pasta
create or replace function public._lin_video_pasta(p_user uuid, p_produto uuid, out pasta_id text, out chave text, out descricao text)
language plpgsql security definer set search_path = public as $$
declare v public.lin_produtos; pz record;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  if p_user is null or public.lin_papel() is null then raise exception 'Seu login não tem acesso ao Sistema Linum agora'; end if;
  select * into v from public.lin_produtos where id = p_produto;
  if v.id is null then raise exception 'Produto não encontrado'; end if;
  if v.video_pasta = '' then raise exception 'Este produto ainda não tem pasta de vídeos'; end if;
  select * into pz from public.mi_pasta_do_link(v.video_pasta);
  pasta_id := pz.pasta_id; chave := pz.chave; descricao := v.descricao;
end $$;
revoke execute on function public._lin_video_pasta(uuid, uuid) from public, anon, authenticated;
grant execute on function public._lin_video_pasta(uuid, uuid) to service_role;
