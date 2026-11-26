-- Sistema Linum 2.71: Contas a pagar → ficha do fornecedor (pedido do Marco em 26/11/2026: "lá no dashboard eu conseguia ver a
-- ficha do fornecedor… isso serve para eu saber o que tenho de NF para pagar no mês e nos próximos, para saber se posso comprar
-- mais insumos sem comprometer a receita"). Só acrescenta a data de emissão da NF em cada parcela (vazia = não informada; as
-- parcelas que já existem ficam vazias, a tela usa a emissão da NF-e do Buscador quando acha) e recria a lin_ger_pagar_importar
-- IGUAL à da 2.70 com uma única mudança: grava `emissao` (chave opcional de cada parcela). Não mexe em nenhum dado.
alter table public.lin_ger_pagar add column if not exists emissao date;

create or replace function public.lin_ger_pagar_importar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_origem text := coalesce(p ->> 'origem', ''); c jsonb; v_novos int := 0; v_rep int := 0; v_total numeric := 0;
        v_venc date; v_valor numeric; v_chave text; v_forn text; v_doc text; v_docnf text; v_parc text; v_sit text;
        v_pago date; v_vpago numeric; v_notas text[] := '{}'; v_emi date;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono vê e altera o Gerencial'; end if;
  if v_origem not in ('nfe', 'carga') then raise exception 'Origem inválida'; end if;
  if jsonb_typeof(p -> 'contas') <> 'array' or jsonb_array_length(p -> 'contas') = 0 then
    raise exception 'Nenhuma parcela para importar';
  end if;
  for c in select * from jsonb_array_elements(p -> 'contas') loop
    v_chave := public._lin_txt(c, 'chave');
    v_forn := public._lin_txt(c, 'fornecedor');
    if v_forn is null then raise exception 'Parcela sem fornecedor'; end if;
    begin v_venc := (c ->> 'vencimento')::date; exception when others then raise exception 'Vencimento inválido: %', c ->> 'vencimento'; end;
    if v_venc is null then raise exception 'Informe o vencimento da parcela de %', v_forn; end if;
    begin v_valor := round((c ->> 'valor')::numeric, 2); exception when others then raise exception 'Valor inválido: %', c ->> 'valor'; end;
    if coalesce(v_valor, 0) <= 0 then raise exception 'Valor da parcela de % precisa ser maior que zero', v_forn; end if;
    v_doc := public._lin_ger_doc(c ->> 'fornecedor_doc');
    v_docnf := coalesce(public._lin_txt(c, 'documento'), '');
    v_parc := coalesce(public._lin_txt(c, 'parcela'), '');
    if (v_chave is not null and exists (select 1 from public.lin_ger_pagar where chave = v_chave))
       or (v_docnf <> '' and exists (select 1 from public.lin_ger_pagar g where g.situacao <> 'cancelada'
             and ltrim(g.documento, '0') = ltrim(v_docnf, '0') and ltrim(g.parcela, '0') = ltrim(v_parc, '0')
             and ((v_doc <> '' and g.fornecedor_doc = v_doc) or public._lin_ger_forn1(g.fornecedor) = public._lin_ger_forn1(v_forn)))) then
      v_rep := v_rep + 1; continue;
    end if;
    begin v_emi := nullif(c ->> 'emissao', '')::date; exception when others then v_emi := null; end;
    v_sit := 'aberta'; v_pago := null; v_vpago := null;
    if v_origem = 'carga' and c ->> 'situacao' = 'paga' then
      v_sit := 'paga'; v_pago := (c ->> 'pago_em')::date; v_vpago := coalesce(round(nullif(c ->> 'valor_pago', '')::numeric, 2), v_valor);
    end if;
    insert into public.lin_ger_pagar (origem, fornecedor, fornecedor_doc, documento, nfe_chave, parcela, vencimento, valor, categoria,
                                      historico, situacao, pago_em, valor_pago, pago_obs, chave, emissao, criado_nome)
    values (v_origem, left(v_forn, 200), v_doc, left(v_docnf, 60), coalesce(public._lin_txt(c, 'nfe_chave'), ''), left(v_parc, 20),
            v_venc, v_valor, left(coalesce(public._lin_txt(c, 'categoria'), ''), 80), left(coalesce(public._lin_txt(c, 'historico'), ''), 500),
            v_sit, v_pago, v_vpago, left(coalesce(public._lin_txt(c, 'pago_obs'), ''), 300), v_chave, v_emi, public._lin_nome());
    v_novos := v_novos + 1; v_total := v_total + v_valor;
    if v_docnf <> '' and not (v_docnf = any(v_notas)) then v_notas := v_notas || v_docnf; end if;
  end loop;
  if v_novos > 0 then
    perform public._lin_auditar('linum_gerencial_pagar_importadas', null, jsonb_build_object('origem', v_origem,
      'arquivo', left(coalesce(p ->> 'arquivo', ''), 200), 'parcelas', v_novos, 'repetidas', v_rep, 'valor', v_total, 'notas', to_jsonb(v_notas)));
  end if;
  return jsonb_build_object('novos', v_novos, 'repetidos', v_rep, 'valor', v_total);
end $$;

revoke execute on function public.lin_ger_pagar_importar(jsonb) from public, anon;
grant execute on function public.lin_ger_pagar_importar(jsonb) to authenticated;
