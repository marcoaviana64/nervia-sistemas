-- Mídia Indoor 2.7: atualização do app da TV pedida pelo painel (pedido do Marco em 19/11/2026, opção 1: "a atualização
-- começa pelo painel"). A equipe Nervia pede a atualização de uma TV (ou de várias); na próxima consulta da playlist a
-- função midia-tv manda a versão pedida, a TV (app 1.11 ou mais novo) baixa nervia.com.br/tv.apk, confere o sha256 e
-- abre a tela de instalação do Android. Alguém no local aperta "Instalar" (o Android não deixa instalar sem confirmação
-- num app instalado pelo Downloader/ADB). Depois de instalada, o app abre sozinho (MY_PACKAGE_REPLACED).
-- A versão publicada fica em site/tv.json ({codigo, nome, sha256}), atualizado junto com o site/tv.apk.
-- O pedido some sozinho quando a TV manda o sinal com a versão nova (feito pela função midia-tv).
-- Coluna nova vazia = nada muda para as TVs atuais.

alter table public.mi_telas add column if not exists atualizar jsonb;           -- {codigo, nome, sha256, pedido_em, pedido_por}
grant select (atualizar) on public.mi_telas to authenticated;

-- p_versao vazio = cancela o pedido
create or replace function public.mi_tela_atualizar(p_telas uuid[], p_versao jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare t record; n int := 0; v jsonb; v_nome text;
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia pede a atualização do app da TV.'; end if;
  if p_telas is null or cardinality(p_telas) = 0 then raise exception 'Escolha pelo menos uma TV.'; end if;
  if p_versao is not null then
    if coalesce(p_versao->>'codigo', '') !~ '^\d{1,6}$' or coalesce(p_versao->>'nome', '') !~ '^[0-9][0-9.]{0,15}$'
       or coalesce(p_versao->>'sha256', '') !~ '^[0-9a-f]{64}$' then
      raise exception 'Versão do app inválida (confira o tv.json do site).';
    end if;
    select nome into v_nome from public.perfis where user_id = auth.uid();
    v := jsonb_build_object('codigo', (p_versao->>'codigo')::int, 'nome', p_versao->>'nome', 'sha256', p_versao->>'sha256',
                            'pedido_em', now(), 'pedido_por', coalesce(v_nome, ''));
  end if;
  for t in select tl.id, tl.nome, tl.conta_id, tl.versao_app, tl.atualizar, c.nome as conta
             from public.mi_telas tl join public.mi_contas c on c.id = tl.conta_id where tl.id = any (p_telas) loop
    if v is not null and t.versao_app = v->>'nome' then continue; end if;       -- já está na versão
    update public.mi_telas set atualizar = v where id = t.id;
    perform public.auditar(case when v is null then 'midia_app_atualizacao_cancelada' else 'midia_app_atualizacao_pedida' end, null,
      jsonb_build_object('conta', t.conta, 'conta_id', t.conta_id, 'tela', t.nome, 'tela_id', t.id,
        'versao_atual', t.versao_app, 'versao_pedida', v->>'nome'));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.mi_tela_atualizar(uuid[], jsonb) from public, anon;
