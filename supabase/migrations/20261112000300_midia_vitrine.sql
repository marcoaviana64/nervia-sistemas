-- Mídia Indoor entra na vitrine (pedido do Marco em 12/11/2026: "já está funcional, pode aparecer").
-- Disponível para contratar, sem demonstração pública e sem preço. A descrição é pública:
-- não cita o serviço de armazenamento usado ("pasta na nuvem").
update public.apps set situacao = 'disponivel', demo_url = '',
  descricao = 'Promoções, avisos e vídeos nas TVs da empresa: você coloca os arquivos numa pasta na nuvem e as TVs atualizam sozinhas, com playlists, TV deitada ou em pé e painel mostrando quais TVs estão no ar.'
where id = 'midia';
