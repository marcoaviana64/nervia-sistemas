-- Auditoria do Linum: "antes" e "depois" só com o que mudou (pedido do Marco em 26/10/2026, comprovante nº 126:
-- ao acrescentar cor/tamanho numa peça, a tela salva também a peça e a auditoria gravava a linha inteira duas vezes,
-- igual antes e depois, como se a peça tivesse sido alterada).
-- Vale para todas as ações do Linum que passam por _lin_auditar com "antes" e "depois" objetos (peça, cliente, parceiro,
-- variação, rolo…): ficam só os campos diferentes; se nada mudou, a alteração não é registrada (não houve alteração).
-- Nome, referência, descrição e código continuam no registro para identificar o que foi alterado.
create or replace function public._lin_auditar(p_acao text, p_variante uuid, p_det jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a jsonb := p_det -> 'antes'; d jsonb := p_det -> 'depois'; na jsonb := '{}'; nd jsonb := '{}'; k text;
begin
  if jsonb_typeof(a) = 'object' and jsonb_typeof(d) = 'object' then
    for k in select jsonb_object_keys(a || d) loop
      if (a -> k) is distinct from (d -> k) then
        na := na || jsonb_build_object(k, coalesce(a -> k, 'null'::jsonb));
        nd := nd || jsonb_build_object(k, coalesce(d -> k, 'null'::jsonb));
      end if;
    end loop;
    if na = '{}' then return; end if;
    foreach k in array array['nome', 'referencia', 'descricao', 'codigo'] loop
      if not p_det ? k and coalesce(d -> k, a -> k) is not null then p_det := p_det || jsonb_build_object(k, coalesce(d -> k, a -> k)); end if;
    end loop;
    p_det := p_det || jsonb_build_object('antes', na, 'depois', nd);
  end if;
  perform public.auditar(p_acao, null, coalesce(p_det, '{}'::jsonb) || jsonb_build_object('papel_linum', public.lin_papel()) ||
    coalesce((select jsonb_build_object('variante_id', v.id, 'produto_id', p.id, 'referencia', p.referencia, 'peca', p.descricao,
                       'cor', v.cor, 'tamanho', v.tamanho, 'edicao', v.edicao)
              from public.lin_variantes v join public.lin_produtos p on p.id = v.produto_id where v.id = p_variante), '{}'::jsonb));
end $$;
revoke execute on function public._lin_auditar(text, uuid, jsonb) from public, anon, authenticated;
