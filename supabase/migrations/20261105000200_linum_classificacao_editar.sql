-- Sistema Linum 2.32: a Dona edita a tabela de classificações tributárias pelo app (pedido do Marco em 05/11/2026:
-- "deixa a Gorette editar a tabela pelo app"). Antes, só a equipe Nervia mudava a tabela, pelo SQL.
--   * lin_classificacao_salvar(p): só o Dono (inclui a equipe Nervia). Nova (sem "id") ou edição; chave ausente = mantém.
--     NCM com 8 dígitos (aceita com pontos), CEST com 7 dígitos ou vazio, grupo/tipo/material obrigatórios.
--     Nova entra no fim do grupo dela. Não se apaga: desativar (ativo = false) tira da lista do Editar peça, e as peças
--     que já usam continuam com ela (a tela mostra "Classificação inativa").
--   * Auditoria linum_classificacao_criada / _alterada (só o que mudou, antes/depois).

create or replace function public.lin_classificacao_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; c public.lin_classificacoes; v_antes jsonb; v_ordem int;
        v_ncm text; v_cest text;
begin
  if not public.lin_eh_dono() then raise exception 'Somente o Dono altera a tabela de classificações'; end if;
  if v_id is not null then
    select * into c from public.lin_classificacoes where id = v_id for update;
    if not found then raise exception 'Classificação não encontrada'; end if;
    v_antes := to_jsonb(c) - 'criado_em';
  else
    c.ativo := true;
  end if;
  if v_id is null or p ? 'grupo' then c.grupo := public._lin_txt(p, 'grupo'); end if;
  if v_id is null or p ? 'tipo_peca' then c.tipo_peca := public._lin_txt(p, 'tipo_peca'); end if;
  if v_id is null or p ? 'material' then c.material := public._lin_txt(p, 'material'); end if;
  if c.grupo is null then raise exception 'Informe o grupo (ex.: Feminino (tecido plano))'; end if;
  if c.tipo_peca is null then raise exception 'Informe o tipo de peça'; end if;
  if c.material is null then raise exception 'Informe o material'; end if;
  if v_id is null or p ? 'ncm' then
    v_ncm := regexp_replace(coalesce(p ->> 'ncm', ''), '\D', '', 'g');
    if v_ncm !~ '^[0-9]{8}$' then raise exception 'O NCM tem 8 dígitos (ex.: 6204.49.00)'; end if;
    c.ncm := v_ncm;
  end if;
  if p ? 'cest' then
    v_cest := nullif(regexp_replace(coalesce(p ->> 'cest', ''), '\D', '', 'g'), '');
    if v_cest is not null and v_cest !~ '^[0-9]{7}$' then raise exception 'O CEST tem 7 dígitos (ou fica vazio)'; end if;
    c.cest := v_cest;
  end if;
  if p ? 'observacao' then c.observacao := public._lin_txt(p, 'observacao'); end if;
  if p ? 'ativo' then c.ativo := coalesce((p ->> 'ativo')::boolean, true); end if;
  if exists (select 1 from public.lin_classificacoes x where x.id is distinct from v_id and x.ativo and c.ativo
               and lower(x.tipo_peca) = lower(c.tipo_peca) and lower(x.material) = lower(c.material) and lower(x.grupo) = lower(c.grupo)) then
    raise exception 'Já existe "% — %" no grupo %', c.tipo_peca, c.material, c.grupo;
  end if;
  if v_id is null then
    perform pg_advisory_xact_lock(hashtext('lin_classificacoes_ordem'));
    v_ordem := (select max(ordem) + 1 from public.lin_classificacoes where lower(grupo) = lower(c.grupo));
    if v_ordem is null or exists (select 1 from public.lin_classificacoes where ordem = v_ordem) then
      v_ordem := coalesce((select max(ordem) from public.lin_classificacoes), 0) + 1;
    end if;
    insert into public.lin_classificacoes (grupo, tipo_peca, material, ncm, cest, observacao, ordem, ativo)
    values (c.grupo, c.tipo_peca, c.material, c.ncm, c.cest, c.observacao, v_ordem, true) returning * into c;
    perform public._lin_auditar('linum_classificacao_criada', null, jsonb_build_object('classificacao_id', c.id,
      'depois', to_jsonb(c) - 'criado_em'));
  else
    update public.lin_classificacoes set grupo = c.grupo, tipo_peca = c.tipo_peca, material = c.material, ncm = c.ncm,
           cest = c.cest, observacao = c.observacao, ativo = c.ativo
     where id = v_id returning * into c;
    perform public._lin_auditar('linum_classificacao_alterada', null, jsonb_build_object('classificacao_id', c.id,
      'tipo_peca', c.tipo_peca, 'material', c.material, 'antes', v_antes, 'depois', to_jsonb(c) - 'criado_em'));
  end if;
  return c.id;
end $$;
revoke execute on function public.lin_classificacao_salvar(jsonb) from public, anon;
grant execute on function public.lin_classificacao_salvar(jsonb) to authenticated;
