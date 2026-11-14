-- Sistema Linum 2.54 — CV DO COMPROVANTE NA VENDA (pedido do Marco em 14/11/2026: "ao registrar venda quero que a
-- vendedora coloque o código de registro do comprovante, assim conseguimos ligar aos registros importados da Rede").
-- O comprovante da maquininha da Rede traz "CV: 189435334"; na exportação da Rede o mesmo número vem na coluna
-- NSU/CV (lin_ger_rede.nsu, sem zeros à esquerda). Cada pagamento em crédito ou débito guarda o seu "cv" dentro de
-- lin_vendas.pagamentos (jsonb); nada muda nas vendas antigas (ficam sem cv até alguém informar).
--   * obrigatório ao registrar a venda no cartão, salvo a boleta antiga lançada pelo Dono (data antes de hoje);
--   * o mesmo CV não pode estar em duas vendas não canceladas (nem duas vezes na mesma venda);
--   * lin_venda_comprovante: informar/corrigir depois (quem vendeu, Estoque ou Dono); corrigir um CV já informado exige
--     motivo; é a única mudança em pagamentos permitida (formas, valores e parcelas não mudam); auditoria.
-- A lin_venda_registrar NÃO é reescrita: só a linha que monta cada pagamento passa a levar o cv (troca conferida abaixo).

create or replace function public._lin_cv(p text) returns text
language sql immutable as $$
  select coalesce(nullif(ltrim(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '0'), ''), '')
$$;

-- pagamentos sem a chave cv (para conferir que só o CV mudou)
create or replace function public._lin_pag_sem_cv(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce((select jsonb_agg(e - 'cv' order by i) from jsonb_array_elements(coalesce(p, '[]')) with ordinality x(e, i)), '[]'::jsonb)
$$;

-- 1) lin_venda_registrar: cada pagamento leva o cv informado
do $$
declare d text := pg_get_functiondef('public.lin_venda_registrar(jsonb)'::regprocedure);
        velho text := $t$'valor', round((v_pg ->> 'valor')::numeric, 2), 'parcelas', v_parc);$t$;
        novo  text := $t$'valor', round((v_pg ->> 'valor')::numeric, 2), 'parcelas', v_parc, 'cv', coalesce(v_pg ->> 'cv', ''));$t$;
begin
  if (length(d) - length(replace(d, velho, ''))) / length(velho) <> 1 then
    raise exception 'lin_venda_registrar não tem exatamente uma linha de pagamento esperada: migração interrompida';
  end if;
  execute replace(d, velho, novo);
end $$;

-- 2) conferência do CV em toda gravação dos pagamentos
create or replace function public.lin_vendas_cv() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_novo jsonb := '[]'; e jsonb; v_cv text;
        v_vistos text[] := '{}'; v_registro boolean; v_outra bigint;
begin
  -- registro = a própria lin_venda_registrar gravando os pagamentos (mesma transação do insert)
  v_registro := tg_op = 'INSERT' or old.criado_em = now();
  for e in select x from jsonb_array_elements(coalesce(new.pagamentos, '[]')) x loop
    if e ->> 'forma' in ('credito', 'debito') then
      v_cv := public._lin_cv(e ->> 'cv');
      if v_cv = '' and v_registro and not (new.data < v_hoje and public.lin_eh_dono()) then
        raise exception 'Informe o CV do comprovante do cartão (o número depois de "CV:" no comprovante da maquininha)';
      end if;
      if v_cv <> '' then
        if length(v_cv) < 3 or length(v_cv) > 12 then raise exception 'CV do comprovante inválido: %', v_cv; end if;
        if v_cv = any(v_vistos) then raise exception 'O CV % está repetido nesta venda', v_cv; end if;
        v_vistos := v_vistos || v_cv;
        perform pg_advisory_xact_lock(hashtext('lin_venda_cv:' || v_cv));
        select v.id into v_outra from public.lin_vendas v, jsonb_array_elements(v.pagamentos) p
         where v.cancelada_em is null and v.id <> new.id and p ->> 'cv' = v_cv limit 1;
        if v_outra is not null then raise exception 'Esse comprovante (CV %) já está na venda nº %', v_cv, v_outra; end if;
      end if;
      v_novo := v_novo || jsonb_set(e, '{cv}', to_jsonb(v_cv));
    else
      v_novo := v_novo || (e - 'cv');
    end if;
  end loop;
  new.pagamentos := v_novo;
  return new;
end $$;
drop trigger if exists lin_vendas_cv on public.lin_vendas;
create trigger lin_vendas_cv before insert or update of pagamentos on public.lin_vendas
  for each row execute function public.lin_vendas_cv();

-- 3) imutabilidade: libera "pagamentos" só pela lin_venda_comprovante e só se nada além do CV mudou
create or replace function public.lin_vendas_imutavel() returns trigger
language plpgsql as $$
declare v_livres text[] := array['cancelada_em', 'cancelada_por', 'cancelada_nome', 'motivo_cancelamento', 'valor_nf'];
begin
  if tg_op = 'DELETE' then raise exception 'Venda ou troca não se apaga: cancele com motivo'; end if;
  if tg_table_name in ('lin_venda_itens', 'lin_troca_itens') then raise exception 'Os itens não podem ser alterados'; end if;
  if old.criado_em = now() then return new; end if;   -- a própria função de registro fecha os totais na mesma transação
  if tg_table_name = 'lin_vendas' and current_setting('lin.corrigir_data', true) = 'sim' then
    v_livres := v_livres || 'data'::text;                   -- só pela lin_venda_corrigir_data
  end if;
  if tg_table_name = 'lin_vendas' and current_setting('lin.corrigir_cliente', true) = 'sim' then
    v_livres := v_livres || 'cliente_id'::text;             -- só pela lin_venda_cliente
  end if;
  if tg_table_name = 'lin_vendas' and current_setting('lin.corrigir_cv', true) = 'sim'
     and public._lin_pag_sem_cv(to_jsonb(new) -> 'pagamentos') = public._lin_pag_sem_cv(to_jsonb(old) -> 'pagamentos') then
    v_livres := v_livres || 'pagamentos'::text;             -- só pela lin_venda_comprovante, e só o CV
  end if;
  if (to_jsonb(new) - v_livres) is distinct from (to_jsonb(old) - v_livres) then
    raise exception 'Não pode ser alterada: cancele com motivo e registre de novo';
  end if;
  return new;
end $$;

-- 4) informar ou corrigir o CV depois. p_cvs = lista na ordem dos pagamentos (vazio = mantém o que está)
create or replace function public.lin_venda_comprovante(p_venda bigint, p_cvs jsonb, p_motivo text default '') returns void
language plpgsql security definer set search_path = public as $$
declare v public.lin_vendas; v_motivo text := btrim(coalesce(p_motivo, '')); v_novo jsonb := '[]'; e jsonb; i int := 0;
        v_cv text; v_ant text; v_trocou boolean := false; v_mudou boolean := false; v_antes jsonb := '[]'; v_depois jsonb := '[]';
begin
  select * into v from public.lin_vendas where id = p_venda for update;
  if not found then raise exception 'Venda não encontrada'; end if;
  if not (public.lin_controla_estoque() or (public.lin_vende() and v.vendedora_id = auth.uid())) then
    raise exception 'Somente o Dono, o Estoque ou quem fez a venda informa o comprovante';
  end if;
  if v.cancelada_em is not null then raise exception 'A venda nº % está cancelada', v.id; end if;
  if jsonb_typeof(coalesce(p_cvs, '[]')) <> 'array' then raise exception 'Lista de comprovantes inválida'; end if;
  for e in select x from jsonb_array_elements(coalesce(v.pagamentos, '[]')) x loop
    if e ->> 'forma' in ('credito', 'debito') then
      v_ant := public._lin_cv(e ->> 'cv');
      v_cv := public._lin_cv(p_cvs ->> i);
      if v_cv = '' then v_cv := v_ant; end if;              -- vazio = mantém
      if v_cv <> v_ant then
        v_mudou := true;
        if v_ant <> '' then v_trocou := true; end if;
      end if;
      v_antes := v_antes || to_jsonb(v_ant); v_depois := v_depois || to_jsonb(v_cv);
      v_novo := v_novo || jsonb_set(e, '{cv}', to_jsonb(v_cv));
    else
      v_novo := v_novo || e;
    end if;
    i := i + 1;
  end loop;
  if jsonb_array_length(v_antes) = 0 then raise exception 'A venda nº % não tem pagamento no cartão', v.id; end if;
  if not v_mudou then raise exception 'Nenhum comprovante novo informado'; end if;
  if v_trocou and length(v_motivo) < 5 then raise exception 'O comprovante já estava informado: escreva o motivo da correção'; end if;
  perform set_config('lin.corrigir_cv', 'sim', true);
  update public.lin_vendas set pagamentos = v_novo where id = v.id;
  perform set_config('lin.corrigir_cv', '', true);
  perform public._lin_auditar('linum_venda_comprovante', null, jsonb_build_object('venda_id', v.id, 'loja', public._lin_loja(v.loja_id),
    'vendedora', v.vendedora_nome, 'antes', jsonb_build_object('cv', v_antes), 'depois', jsonb_build_object('cv', v_depois),
    'motivo', nullif(v_motivo, '')));
end $$;
revoke execute on function public.lin_venda_comprovante(bigint, jsonb, text) from public, anon;
grant execute on function public.lin_venda_comprovante(bigint, jsonb, text) to authenticated;
revoke execute on function public.lin_vendas_cv() from public, anon, authenticated;
