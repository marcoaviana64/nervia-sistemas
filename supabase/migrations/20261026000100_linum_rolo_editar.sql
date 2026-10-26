-- Sistema Linum 2.2: corrigir os dados dos rolos depois do registro (pedido do Marco em 26/10/2026: os rolos
-- importados do XML vieram sem cor — a NF-e não tem campo de cor — e não havia como acrescentar).
-- Muda só a descrição do rolo: tecido, cor, fornecedor, nota, data da compra e observações; o valor pago só quem tem
-- 'producao_valores'. Quantidade e saldo continuam pelo "Ajustar o saldo" (com motivo e movimento).
-- p = {rolos: [{id, tecido?, cor?, fornecedor?, nota?, data_compra?, observacoes?, valor_pago?}]}: chave ausente = mantém.
-- Vários rolos de uma vez (o "Preencher cores pela descrição" da tela); tudo ou nada.

create or replace function public.lin_rolos_editar(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare it jsonb; v record; n record; v_val boolean := public.lin_pode('producao_valores'); v_mud jsonb; v_antes jsonb; k text; v_qtd int := 0;
begin
  if not public.lin_pode('producao') then raise exception 'Seu login não tem a permissão Produção'; end if;
  if jsonb_typeof(p -> 'rolos') is distinct from 'array' or jsonb_array_length(p -> 'rolos') = 0 then raise exception 'Nenhum rolo para alterar'; end if;
  if jsonb_array_length(p -> 'rolos') > 200 then raise exception 'No máximo 200 rolos de uma vez'; end if;
  for it in select * from jsonb_array_elements(p -> 'rolos') loop
    select * into v from public.lin_rolos where id = nullif(it ->> 'id', '')::uuid for update;
    if v.id is null then raise exception 'Rolo não encontrado'; end if;
    if it ? 'valor_pago' and not v_val then raise exception 'Só quem tem a permissão Valores da produção altera o valor pago'; end if;
    select coalesce(case when it ? 'tecido' then trim(it ->> 'tecido') end, v.tecido) as tecido,
           coalesce(case when it ? 'cor' then trim(it ->> 'cor') end, v.cor) as cor,
           coalesce(case when it ? 'fornecedor' then trim(it ->> 'fornecedor') end, v.fornecedor) as fornecedor,
           coalesce(case when it ? 'nota' then trim(it ->> 'nota') end, v.nota) as nota,
           coalesce(case when it ? 'observacoes' then trim(it ->> 'observacoes') end, v.observacoes) as observacoes,
           coalesce(case when it ? 'data_compra' then nullif(it ->> 'data_compra', '')::date end, v.data_compra) as data_compra,
           coalesce(case when it ? 'valor_pago' then round(nullif(replace(it ->> 'valor_pago', ',', '.'), '')::numeric, 2) end, v.valor_pago) as valor_pago
      into n;
    if n.tecido = '' then raise exception 'Rolo %: informe o tecido', v.codigo; end if;
    if length(n.tecido) > 200 or length(n.cor) > 100 or length(n.fornecedor) > 200 or length(n.nota) > 60 or length(n.observacoes) > 1000 then
      raise exception 'Rolo %: texto longo demais', v.codigo; end if;
    if n.data_compra > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'Rolo %: a data da compra não pode ser no futuro', v.codigo; end if;
    if n.valor_pago < 0 then raise exception 'Rolo %: valor pago inválido', v.codigo; end if;
    -- só o que mudou vai para a auditoria (antes e depois)
    v_mud := '{}'; v_antes := '{}';
    foreach k in array array['tecido', 'cor', 'fornecedor', 'nota', 'observacoes', 'data_compra', 'valor_pago'] loop
      if (to_jsonb(n) -> k) is distinct from (to_jsonb(v) -> k) then
        v_mud := v_mud || jsonb_build_object(k, to_jsonb(n) -> k); v_antes := v_antes || jsonb_build_object(k, to_jsonb(v) -> k);
      end if;
    end loop;
    if v_mud = '{}' then continue; end if;
    update public.lin_rolos set tecido = n.tecido, cor = n.cor, fornecedor = n.fornecedor, nota = n.nota, observacoes = n.observacoes,
           data_compra = n.data_compra, valor_pago = n.valor_pago where id = v.id;
    perform public._lin_auditar('linum_rolo_alterado', null, jsonb_build_object('rolo', v.codigo, 'antes', v_antes, 'depois', v_mud));
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end $$;

revoke execute on function public.lin_rolos_editar(jsonb) from public, anon;
grant execute on function public.lin_rolos_editar(jsonb) to authenticated;
