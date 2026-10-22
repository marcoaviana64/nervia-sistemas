-- Orçamentos de Compras — aprovação por SETOR (pedido do Marco em 22/10/2026).
-- "O gerente do Financeiro aprova as compras do Financeiro; o Diretor aprova depois, ou em alguns casos o Gerente
-- aprovando já está aprovado." Então:
--   * cada unidade cadastra os seus setores (Financeiro, Marketing, Operações, Comercial...) em cmp_setores;
--   * a requisição diz de qual setor é (obrigatório quando a unidade tem setores ativos);
--   * o papel Gerente pode ser de UM setor (cmp_membros.setor_id) ou de todos (setor_id vazio = Gerente geral, como antes);
--   * a etapa do Gerente só é aprovada pelo Gerente daquele setor (ou um Gerente geral); o mesmo vale para o que é do
--     Gerente na requisição: dispensa de certidões, avaliação do fornecedor, cancelar, abrir/fechar Oportunidades;
--   * "em alguns casos o Gerente aprovando já está aprovado" = alçada: até "Gerente aprova até" basta o Gerente; acima
--     segue para o Diretor. O setor pode ter o próprio limite (cmp_setores.alcada_gerente; vazio = o da unidade);
--   * o Diretor continua da unidade inteira (aprova a segunda etapa de qualquer setor);
--   * o aval do Gerente ao fornecedor continua por unidade (é do fornecedor, não da compra).
-- Unidade sem setores funciona como antes. Tudo continua registrado no histórico e na `auditoria`.

-- ---------------------------------------------------------------- setores
create table if not exists public.cmp_setores (
  id             uuid primary key default gen_random_uuid(),
  unidade_id     uuid not null references public.cmp_unidades on delete cascade,
  nome           text not null check (length(trim(nome)) > 0),
  alcada_gerente numeric(14,2) check (alcada_gerente >= 0),   -- vazio = "Gerente até" da unidade
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  unique (unidade_id, nome),
  unique (id, unidade_id)                                       -- para as chaves compostas abaixo (setor da mesma unidade)
);
alter table public.cmp_setores enable row level security;
revoke all on public.cmp_setores from anon;
drop policy if exists cmp_setores_ler on public.cmp_setores;
create policy cmp_setores_ler on public.cmp_setores for select using (public.cmp_membro(unidade_id));
drop policy if exists cmp_setores_admin on public.cmp_setores;
create policy cmp_setores_admin on public.cmp_setores for all using (public.eh_admin()) with check (public.eh_admin());

-- requisição: de qual setor é (a tela escolhe ao criar; depois só pela cmp_req_setor)
alter table public.cmp_requisicoes add column if not exists setor_id uuid;
alter table public.cmp_requisicoes drop constraint if exists cmp_requisicoes_setor_fk;
alter table public.cmp_requisicoes add constraint cmp_requisicoes_setor_fk
  foreign key (setor_id, unidade_id) references public.cmp_setores (id, unidade_id);
grant insert (setor_id) on public.cmp_requisicoes to authenticated;

-- papel: o Gerente pode ser de um setor. A chave deixa de ser (login, unidade, papel): o mesmo login pode ser
-- Gerente de dois setores.
alter table public.cmp_membros add column if not exists setor_id uuid;
alter table public.cmp_membros drop constraint if exists cmp_membros_pkey;
alter table public.cmp_membros add column if not exists id bigint generated always as identity;
do $$ begin
  alter table public.cmp_membros add constraint cmp_membros_pk primary key (id);
exception when invalid_table_definition or duplicate_object then null; end $$;
create unique index if not exists cmp_membros_unico
  on public.cmp_membros (user_id, unidade_id, papel, coalesce(setor_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.cmp_membros drop constraint if exists cmp_membros_setor_fk;
alter table public.cmp_membros add constraint cmp_membros_setor_fk
  foreign key (setor_id, unidade_id) references public.cmp_setores (id, unidade_id) on delete cascade;
alter table public.cmp_membros drop constraint if exists cmp_membros_setor_so_gerente;
alter table public.cmp_membros add constraint cmp_membros_setor_so_gerente check (setor_id is null or papel = 'gerente');

-- ---------------------------------------------------------------- regras
create or replace function public.cmp_setor_nome(p_setor uuid) returns text
language sql stable security definer set search_path = public as $$
  select nome from public.cmp_setores where id = p_setor
$$;

-- tem algum destes papéis PARA ESTA REQUISIÇÃO? Igual a cmp_tem_papel, mas o Gerente de um setor só vale para as
-- requisições daquele setor (Gerente sem setor = todos; requisição sem setor = qualquer Gerente da unidade).
create or replace function public.cmp_tem_papel_req(r public.cmp_requisicoes, p_papeis text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or exists (select 1 from public.cmp_membros m
    where m.user_id = auth.uid() and m.unidade_id = r.unidade_id and m.papel = any (p_papeis)
      and (m.papel <> 'gerente' or m.setor_id is null or r.setor_id is null or m.setor_id = r.setor_id))
$$;
revoke execute on function public.cmp_tem_papel_req(public.cmp_requisicoes, text[]) from public, anon, authenticated;

-- carrega a requisição travada e confere o papel (agora com o setor do Gerente)
create or replace function public.cmp_req_para(p_req bigint, p_papeis text[], p_status text[])
returns public.cmp_requisicoes language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes;
begin
  select * into r from public.cmp_requisicoes where id = p_req for update;
  if not found or not public.cmp_membro(r.unidade_id) then raise exception 'Requisição não encontrada.'; end if;
  if not public.cmp_tem_papel_req(r, p_papeis) then
    if 'gerente' = any (p_papeis) and r.setor_id is not null and public.cmp_tem_papel(r.unidade_id, array['gerente']) then
      raise exception 'Esta requisição é do setor %: só o Gerente desse setor (ou um Gerente de todos os setores) faz esta ação.', public.cmp_setor_nome(r.setor_id);
    end if;
    raise exception 'Seu papel nesta unidade não permite esta ação (precisa ser: %).', array_to_string(p_papeis, ' ou ');
  end if;
  if not (r.status = any (p_status)) then raise exception 'A requisição #% está "%" e não permite esta ação agora.', r.id, r.status; end if;
  return r;
end $$;
revoke execute on function public.cmp_req_para(bigint, text[], text[]) from public, anon, authenticated;

-- requisição nova: setor obrigatório quando a unidade tem setores ativos
create or replace function public.cmp_req_nova() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.cmp_unidades where id = new.unidade_id and ativo) then
    raise exception 'Unidade inativa ou inexistente.';
  end if;
  if new.setor_id is null and exists (select 1 from public.cmp_setores where unidade_id = new.unidade_id and ativo) then
    raise exception 'Escolha o setor da compra: é o Gerente do setor que aprova.';
  end if;
  if new.setor_id is not null and not exists (select 1 from public.cmp_setores where id = new.setor_id and unidade_id = new.unidade_id and ativo) then
    raise exception 'Setor inativo ou de outra unidade.';
  end if;
  new.solicitante := auth.uid();
  new.solicitante_nome := coalesce(public.cmp_nome_atual(), '');
  new.status := 'nova'; new.proposta_escolhida := null; new.justificativa := ''; new.excecao := '';
  new.alcada := null; new.valor_aprovacao := null; new.enviado_por := null; new.enviado_em := null;
  new.criado_em := now(); new.atualizado_em := now();
  return new;
end $$;

create or replace function public.cmp_req_criada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.cmp_registrar(new.id, null, new.unidade_id, 'requisicao_criada',
    'Requisição criada: ' || new.titulo || coalesce(' (setor ' || public.cmp_setor_nome(new.setor_id) || ')', ''),
    jsonb_build_object('grupo', new.grupo, 'quantidade', new.quantidade, 'valor_estimado', new.valor_estimado,
      'setor', public.cmp_setor_nome(new.setor_id)));
  return new;
end $$;

-- trocar o setor (pedido no setor errado, ou requisição de antes dos setores): comprador ou Gerente, antes da aprovação
create or replace function public.cmp_req_setor(p_req bigint, p_setor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes;
begin
  r := public.cmp_req_para(p_req, array['comprador', 'gerente'], array['nova', 'cotacao', 'reprovada']);
  if p_setor is null then raise exception 'Escolha o setor.'; end if;
  if not exists (select 1 from public.cmp_setores where id = p_setor and unidade_id = r.unidade_id and ativo) then
    raise exception 'Setor inativo ou de outra unidade.';
  end if;
  if r.setor_id = p_setor then return; end if;
  update public.cmp_requisicoes set setor_id = p_setor where id = p_req;
  perform public.cmp_registrar(p_req, null, r.unidade_id, 'setor_alterado',
    format('Setor mudou de %s para %s', coalesce(public.cmp_setor_nome(r.setor_id), '(sem setor)'), public.cmp_setor_nome(p_setor)),
    jsonb_build_object('de', public.cmp_setor_nome(r.setor_id), 'para', public.cmp_setor_nome(p_setor)));
end $$;

-- ---------------------------------------------------------------- aprovação
create or replace function public.cmp_enviar_aprovacao(p_req bigint)
returns text language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; u public.cmp_unidades; s public.cmp_setores; p public.cmp_propostas; f public.cmp_fornecedores; v_qtd int; v_min numeric;
  v_total numeric; v_menor boolean; v_novo boolean := false; v_comp boolean := false; v_alcada text; v_inter boolean; v_disp boolean := false; v_nome text;
  v_lim numeric;
begin
  r := public.cmp_req_para(p_req, array['comprador'], array['cotacao']);
  select * into u from public.cmp_unidades where id = r.unidade_id;
  if r.setor_id is not null then select * into s from public.cmp_setores where id = r.setor_id; end if;
  if r.setor_id is null and exists (select 1 from public.cmp_setores where unidade_id = r.unidade_id and ativo) then
    raise exception 'Informe o setor da requisição antes de enviar: é o Gerente do setor que aprova.';
  end if;
  -- limite do Gerente: o do setor, se tiver; senão o da unidade
  v_lim := coalesce(s.alcada_gerente, u.alcada_gerente);
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
    v_alcada := case when v_total <= u.alcada_automatica and v_menor and not v_novo then 'automatica'
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
      'setor', s.nome, 'alcada_gerente', v_lim));
  if v_alcada = 'automatica' then
    insert into public.cmp_aprovacoes (requisicao_id, etapa, decisao, comentario, por_nome)
    values (p_req, 'sistema', 'aprovado', format('Até %s, menor preço e fornecedor com compras anteriores.', public.cmp_brl(u.alcada_automatica)), 'Sistema');
    perform public.cmp_registrar(p_req, null, r.unidade_id, 'aprovacao_automatica', 'Aprovação automática (até a alçada, menor preço).');
  end if;
  return v_alcada;
end $$;

create or replace function public.cmp_decidir(p_req bigint, p_aprovar boolean, p_comentario text, p_dar_aval boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes; v_ger boolean; v_etapa text; v_forn uuid; v_novo text; v_quem text; v_setor text;
begin
  select * into r from public.cmp_requisicoes where id = p_req for update;
  if not found or not public.cmp_membro(r.unidade_id) then raise exception 'Requisição não encontrada.'; end if;
  if r.status <> 'aprovacao' then raise exception 'A requisição #% não está aguardando aprovação.', p_req; end if;
  v_setor := public.cmp_setor_nome(r.setor_id);
  v_ger := exists (select 1 from public.cmp_aprovacoes where requisicao_id = p_req and etapa = 'gerente' and decisao = 'aprovado');
  v_etapa := case when not v_ger then 'gerente' else 'diretor' end;
  if not public.cmp_tem_papel_req(r, array[v_etapa]) then
    if v_etapa = 'gerente' and v_setor is not null then
      raise exception 'Esta etapa é do Gerente do setor %.', v_setor;
    end if;
    raise exception 'Esta etapa é do %.', case v_etapa when 'gerente' then 'Gerente' else 'Diretor' end;
  end if;
  if r.enviado_por = auth.uid() and not public.eh_admin() then
    raise exception 'Quem enviou a compra para aprovação não pode aprová-la.';
  end if;
  if not p_aprovar and length(trim(coalesce(p_comentario, ''))) < 5 then raise exception 'Para reprovar, escreva o motivo.'; end if;
  insert into public.cmp_aprovacoes (requisicao_id, etapa, decisao, comentario, por, por_nome)
  values (p_req, v_etapa, case when p_aprovar then 'aprovado' else 'reprovado' end, trim(coalesce(p_comentario, '')), auth.uid(), coalesce(public.cmp_nome_atual(), ''));
  v_quem := initcap(v_etapa) || case when v_etapa = 'gerente' and v_setor is not null then ' (' || v_setor || ')' else '' end;
  select fornecedor_id into v_forn from public.cmp_propostas where id = r.proposta_escolhida;
  if not p_aprovar then
    update public.cmp_requisicoes set status = 'reprovada' where id = p_req;
    perform public.cmp_registrar(p_req, v_forn, r.unidade_id, 'reprovada', format('Reprovada pelo %s: %s', v_quem, trim(p_comentario)),
      jsonb_build_object('setor', v_setor));
    return 'reprovada';
  end if;
  if p_dar_aval and v_etapa = 'gerente' and v_forn is not null then perform public.cmp_aval(v_forn, r.unidade_id, true); end if;
  v_novo := case when v_etapa = 'gerente' and r.alcada = 'diretor' then 'aprovacao' else 'aprovada' end;
  update public.cmp_requisicoes set status = v_novo where id = p_req;
  perform public.cmp_registrar(p_req, v_forn, r.unidade_id, 'aprovada_' || v_etapa,
    format('Aprovada pelo %s%s%s%s', v_quem,
      case when v_etapa = 'gerente' and coalesce(r.compra_internet, false) then ' (aval à compra pela internet)' else '' end,
      case when coalesce(trim(p_comentario), '') <> '' then ': ' || trim(p_comentario) else '' end,
      case when v_novo = 'aprovacao' then '. Segue para o Diretor.' else '' end),
    jsonb_build_object('setor', v_setor));
  return v_novo;
end $$;

create or replace function public.cmp_cancelar(p_req bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.cmp_requisicoes;
begin
  select * into r from public.cmp_requisicoes where id = p_req for update;
  if not found or not public.cmp_membro(r.unidade_id) then raise exception 'Requisição não encontrada.'; end if;
  if r.status not in ('nova', 'cotacao', 'reprovada') then raise exception 'Só dá para cancelar antes da aprovação (ou depois de reprovada).'; end if;
  if not (r.solicitante = auth.uid() or public.cmp_tem_papel_req(r, array['comprador', 'gerente', 'diretor'])) then
    raise exception 'Só quem pediu, o comprador ou o gerente% cancela.', coalesce(' do setor ' || public.cmp_setor_nome(r.setor_id), '');
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escreva o motivo do cancelamento.'; end if;
  update public.cmp_requisicoes set status = 'cancelada' where id = p_req;
  perform public.cmp_registrar(p_req, null, r.unidade_id, 'cancelada', 'Cancelada: ' || trim(p_motivo));
end $$;

-- ---------------------------------------------------------------- auditoria da configuração
create or replace function public.cmp_auditar_membros() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old); v_setor text := (select nome from public.cmp_setores where id = r.setor_id);
begin
  perform public.cmp_registrar(null, null, r.unidade_id,
    case when tg_op = 'INSERT' then 'papel_concedido' else 'papel_retirado' end,
    format('Papel %s%s %s para %s', r.papel, coalesce(' do setor ' || v_setor, ''), case when tg_op = 'INSERT' then 'concedido' else 'retirado' end,
      (select email from public.perfis where user_id = r.user_id)),
    jsonb_build_object('login_id', r.user_id, 'papel', r.papel, 'setor', v_setor));
  return r;
end $$;

create or replace function public.cmp_auditar_setores() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  if tg_op = 'UPDATE' and (new.nome, new.alcada_gerente, new.ativo) is not distinct from (old.nome, old.alcada_gerente, old.ativo) then
    return new;
  end if;
  perform public.cmp_registrar(null, null, r.unidade_id,
    case tg_op when 'INSERT' then 'setor_criado' when 'DELETE' then 'setor_excluido' else 'setor_alterado_config' end,
    format('Setor %s%s: Gerente aprova até %s%s', r.nome,
      case when tg_op = 'UPDATE' and new.nome <> old.nome then ' (antes ' || old.nome || ')' else '' end,
      coalesce(public.cmp_brl(r.alcada_gerente), 'o limite da unidade'),
      case when tg_op = 'DELETE' then ' — excluído' when not r.ativo then ' — inativo' else '' end),
    jsonb_build_object('setor', r.nome, 'alcada_gerente', r.alcada_gerente, 'ativo', r.ativo));
  return r;
end $$;
drop trigger if exists cmp_setores_auditoria on public.cmp_setores;
create trigger cmp_setores_auditoria after insert or update or delete on public.cmp_setores
  for each row execute function public.cmp_auditar_setores();

revoke execute on function public.cmp_req_setor(bigint, uuid) from public, anon;
grant execute on function public.cmp_req_setor(bigint, uuid) to authenticated;
revoke execute on function public.cmp_setor_nome(uuid) from public, anon;
