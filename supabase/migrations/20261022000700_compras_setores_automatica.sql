-- Orçamentos de Compras — aprovação automática limitada pelo setor (pedido do Marco em 22/10/2026).
-- No Multicenter Itaipu, Comercial e Tecnologia têm "Gerente aprova até" R$ 1.000, mas a automática da unidade vai até
-- R$ 5.000: uma compra de R$ 3.000 (menor preço, fornecedor já usado) era aprovada sozinha, sem passar pelo Gerente.
-- Agora a automática vale até o MENOR entre a automática da unidade e o limite do Gerente do setor; acima disso, a
-- compra vai ao Gerente do setor e, acima do limite dele, ao Diretor. Só muda cmp_enviar_aprovacao.

create or replace function public.cmp_enviar_aprovacao(p_req bigint)
returns text language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; u public.cmp_unidades; s public.cmp_setores; p public.cmp_propostas; f public.cmp_fornecedores; v_qtd int; v_min numeric;
  v_total numeric; v_menor boolean; v_novo boolean := false; v_comp boolean := false; v_alcada text; v_inter boolean; v_disp boolean := false; v_nome text;
  v_lim numeric; v_auto numeric;
begin
  r := public.cmp_req_para(p_req, array['comprador'], array['cotacao']);
  select * into u from public.cmp_unidades where id = r.unidade_id;
  if r.setor_id is not null then select * into s from public.cmp_setores where id = r.setor_id; end if;
  if r.setor_id is null and exists (select 1 from public.cmp_setores where unidade_id = r.unidade_id and ativo) then
    raise exception 'Informe o setor da requisição antes de enviar: é o Gerente do setor que aprova.';
  end if;
  -- limite do Gerente: o do setor, se tiver; senão o da unidade
  v_lim := coalesce(s.alcada_gerente, u.alcada_gerente);
  -- a automática nunca passa do que o Gerente do setor aprova sozinho
  v_auto := least(u.alcada_automatica, v_lim);
  if r.proposta_escolhida is null then raise exception 'Escolha o fornecedor antes de enviar.'; end if;
  select count(*), min(round(preco_unitario * r.quantidade + frete, 2)) into v_qtd, v_min from public.cmp_propostas where requisicao_id = p_req;
  if v_qtd < u.minimo_propostas and r.excecao = '' then
    raise exception 'Só % proposta(s): o mínimo é %. Registre mais propostas ou a exceção de exclusividade.', v_qtd, u.minimo_propostas;
  end if;
  select * into p from public.cmp_propostas where id = r.proposta_escolhida;
  v_inter := p.fornecedor_id is null; v_nome := public.cmp_nome_proposta(p);
  v_total := round(p.preco_unitario * r.quantidade + p.frete, 2);
  v_menor := v_total <= v_min;
  if v_inter then
    -- compra pela internet: nunca automática; o Gerente dá o aval (e o Diretor, acima da alçada do Gerente)
    v_alcada := case when v_total <= v_lim then 'gerente' else 'diretor' end;
  else
    select * into f from public.cmp_fornecedores where id = p.fornecedor_id;
    if not public.cmp_certidoes_ok(p_req, f.id) then
      raise exception 'As certidões de % estão vencidas. Atualize o cadastro ou peça ao Gerente a dispensa das certidões nesta compra.', f.nome;
    end if;
    v_disp := f.certidoes_validade is not null and f.certidoes_validade < current_date;
    -- primeira compra com o fornecedor NESTA EMPRESA (a base é de todas as empresas)
    v_novo := not exists (select 1 from public.cmp_requisicoes x join public.cmp_propostas y on y.id = x.proposta_escolhida
      where y.fornecedor_id = f.id and x.id <> p_req and x.status in ('aprovada', 'pedido', 'entregue', 'concluida')
        and x.unidade_id in (select public.cmp_unidades_da_empresa(r.unidade_id)));
    v_comp := f.cadastrado_por = auth.uid();
    v_alcada := case when v_total <= v_auto and v_menor and not v_novo then 'automatica'
                     when v_total <= v_lim then 'gerente' else 'diretor' end;
  end if;
  -- o Gerente do setor precisa existir (senão a compra ficaria parada; unidade sem setores segue como antes)
  if v_alcada <> 'automatica' and r.setor_id is not null and not exists (select 1 from public.cmp_membros m
       where m.unidade_id = r.unidade_id and m.papel = 'gerente' and (m.setor_id is null or m.setor_id = r.setor_id)) then
    raise exception 'Ninguém tem o papel de Gerente do setor % (nem de todos os setores). Peça à Nervia para dar o papel antes de enviar.', s.nome;
  end if;
  update public.cmp_requisicoes set alcada = v_alcada, valor_aprovacao = v_total, fornecedor_novo = v_novo, compra_internet = v_inter,
    cadastrado_pelo_comprador = v_comp, enviado_por = auth.uid(), enviado_em = now(),
    status = case when v_alcada = 'automatica' then 'aprovada' else 'aprovacao' end
   where id = p_req;
  perform public.cmp_registrar(p_req, p.fornecedor_id, r.unidade_id, 'enviada_aprovacao',
    format('Enviada para aprovação: %s, %s. Alçada: %s%s%s%s%s', v_nome, public.cmp_brl(v_total),
      case v_alcada when 'automatica' then 'automática' when 'gerente' then 'Gerente' else 'Gerente e Diretor' end
        || case when v_alcada <> 'automatica' and s.nome is not null then ' (Gerente do setor ' || s.nome || ')' else '' end,
      case when v_inter then '. Compra pela internet: precisa do aval do Gerente' else '' end,
      case when v_novo then '. Primeira compra com este fornecedor' else '' end,
      case when v_comp then '. Fornecedor cadastrado por quem está comprando' else '' end,
      case when v_disp then '. Certidões vencidas, dispensadas pelo Gerente nesta compra' else '' end),
    jsonb_build_object('total', v_total, 'menor', v_menor, 'fornecedor_novo', v_novo, 'cadastrado_pelo_comprador', v_comp, 'alcada', v_alcada,
      'propostas', v_qtd, 'excecao', r.excecao, 'compra_internet', v_inter, 'link', p.link, 'certidoes_dispensadas', v_disp,
      'setor', s.nome, 'alcada_gerente', v_lim, 'alcada_automatica', v_auto));
  if v_alcada = 'automatica' then
    insert into public.cmp_aprovacoes (requisicao_id, etapa, decisao, comentario, por_nome)
    values (p_req, 'sistema', 'aprovado', format('Até %s, menor preço e fornecedor com compras anteriores.', public.cmp_brl(v_auto)), 'Sistema');
    perform public.cmp_registrar(p_req, null, r.unidade_id, 'aprovacao_automatica', 'Aprovação automática (até a alçada, menor preço).');
  end if;
  return v_alcada;
end $$;

