-- Contas e Licenças — aprovar a resposta do formulário troca só as unidades do link (pedido do Marco em 21/10/2026).
-- Antes, "substituir" chamava lic_salvar_fatura, que apaga a fatura do mês INTEIRO (todas as unidades): um link que cobria
-- só algumas unidades apagava as linhas das outras. Agora a aprovação só confere, apaga e grava as unidades do link
-- (lic_pedidos.unidades); as outras unidades do mês ficam como estão. lic_salvar_fatura (carga pelo arquivo) continua igual.

create or replace function public.lic_resposta_aprovar(p_id bigint, p_substituir boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare r public.lic_respostas; p public.lic_pedidos; v_n int; v_tinha int; v_quem text;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia aprova.'; end if;
  select * into r from public.lic_respostas where id = p_id for update;
  if not found then raise exception 'Resposta não encontrada.'; end if;
  if r.status <> 'pendente' then raise exception 'Esta resposta já foi %.', r.status; end if;
  select * into p from public.lic_pedidos where id = r.pedido_id;
  if jsonb_typeof(r.itens) <> 'array' or jsonb_array_length(r.itens) = 0 then raise exception 'Nenhum item na resposta.'; end if;
  if exists (select 1 from jsonb_array_elements(r.itens) i where not ((i ->> 'unidade_id')::uuid = any (p.unidades))) then
    raise exception 'A resposta tem unidade fora do link.';
  end if;
  select count(*) into v_tinha from public.lic_faturas where mes = p.mes and unidade_id = any (p.unidades);
  if v_tinha > 0 and not coalesce(p_substituir, false) then
    raise exception 'Já existe fatura de % para estas unidades (% itens). Marque "substituir" para trocar (as outras unidades do mês ficam como estão).',
      to_char(p.mes, 'MM/YYYY'), v_tinha;
  end if;
  v_quem := coalesce((select coalesce(nullif(nome, ''), email) from public.perfis where user_id = auth.uid()), '');
  delete from public.lic_faturas where mes = p.mes and unidade_id = any (p.unidades);
  insert into public.lic_faturas (unidade_id, mes, produto, quantidade, valor_unitario, carregado_por, carregado_nome)
  select i.unidade_id, p.mes, trim(i.produto), sum(i.quantidade), max(coalesce(i.valor_unitario, 0)), auth.uid(), v_quem
    from jsonb_to_recordset(r.itens) as i(unidade_id uuid, produto text, quantidade int, valor_unitario numeric)
   group by i.unidade_id, trim(i.produto);
  get diagnostics v_n = row_count;
  update public.lic_respostas set status = 'aprovada', decidido_por = auth.uid(), decidido_em = now(), decidido_nome = v_quem where id = p_id;
  perform public.auditar('licencas_fatura', null, jsonb_build_object('mes', p.mes, 'itens', v_n, 'substituiu', v_tinha > 0, 'origem', 'formulário F-' || p_id,
    'unidades', (select jsonb_agg(nome) from public.lic_unidades where id = any (p.unidades)),
    'valor_total', (select sum(quantidade * valor_unitario) from public.lic_faturas where mes = p.mes and unidade_id = any (p.unidades))));
  perform public.auditar('licencas_resposta_aprovada', null, jsonb_build_object('pedido', p.id, 'resposta', p_id, 'mes', p.mes, 'itens', v_n, 'declarante', r.declarante));
  return v_n;
end $$;

revoke execute on function public.lic_resposta_aprovar(bigint, boolean) from public, anon;
grant execute on function public.lic_resposta_aprovar(bigint, boolean) to authenticated;
