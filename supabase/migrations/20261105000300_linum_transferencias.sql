-- Sistema Linum 2.33 — transferência entre lojas COM ACEITE (pedido do Marco em 05/11/2026):
--   "as vendedoras podem iniciar e receber peças de transferências; deve sair de uma loja e, quando chegar na outra,
--    quem recebeu valida, entra e diz que recebeu todas as peças; só assim atualiza o estoque.
--    A dona e a estoquista podem registrar envio e recebimento."
-- Regras:
--   * Envio (qualquer pessoa da equipe com o app aberto no horário: Dono, Estoque, Vendedora): as peças SAEM da loja de
--     origem na hora (movimento transf_envio) e ficam EM TRÂNSITO; não entram em loja nenhuma.
--   * Recebimento (qualquer pessoa da equipe): confere peça por peça. "Recebi todas" = todas entram no estoque da loja de
--     destino (movimento transf_recebida). Se faltou alguma, informa quanto chegou e o motivo (obrigatório): entram só
--     as que chegaram; a falta fica registrada (situação recebida_com_falta) e o Dono resolve (ajuste ou nova contagem).
--   * Cancelar (só em trânsito; quem enviou, Dono ou Estoque; motivo obrigatório): as peças voltam para a origem
--     (movimento transf_retorno).
--   * A transferência direta antiga (lin_transferir, que punha na outra loja sem aceite) sai da tela e perde o grant.
--   * Tudo na auditoria: linum_transferencia_enviada / recebida / cancelada.
-- Só acrescenta tabelas, colunas com padrão nulo e tipos de movimento: nenhum dado existente muda.

create table if not exists public.lin_transferencias (
  id                  bigint generated always as identity primary key,
  origem_id           uuid not null references public.lin_lojas,
  destino_id          uuid not null references public.lin_lojas,
  situacao            text not null default 'em_transito'
                      check (situacao in ('em_transito', 'recebida', 'recebida_com_falta', 'cancelada')),
  observacao          text not null default '',
  enviado_por         uuid references auth.users on delete set null,
  enviado_nome        text not null default '',
  enviado_em          timestamptz not null default now(),
  recebido_por        uuid references auth.users on delete set null,
  recebido_nome       text,
  recebido_em         timestamptz,
  recebimento_obs     text,
  cancelado_por       uuid references auth.users on delete set null,
  cancelado_nome      text,
  cancelado_em        timestamptz,
  cancelamento_motivo text,
  check (origem_id <> destino_id)
);
create index if not exists lin_transferencias_situacao on public.lin_transferencias (situacao, enviado_em desc);

create table if not exists public.lin_transferencia_itens (
  id               bigint generated always as identity primary key,
  transferencia_id bigint not null references public.lin_transferencias on delete cascade,
  variante_id      uuid not null references public.lin_variantes,
  quantidade       int not null check (quantidade > 0),
  recebida         int check (recebida >= 0 and recebida <= quantidade),   -- nulo = ainda em trânsito
  -- cópia da etiqueta no momento do envio
  referencia       text not null default '',
  descricao        text not null default '',
  cor              text not null default '',
  tamanho          text not null default '',
  edicao           text not null default '',
  unique (transferencia_id, variante_id)
);
create index if not exists lin_transferencia_itens_t on public.lin_transferencia_itens (transferencia_id);

-- encerrada não muda mais; nada se apaga
create or replace function public.lin_transferencias_imutavel() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Transferências não podem ser apagadas (cancele, se ainda estiver em trânsito)'; end if;
  if tg_table_name = 'lin_transferencias' then
    if old.situacao <> 'em_transito' then raise exception 'Esta transferência já foi encerrada e não pode mudar'; end if;
  elsif old.recebida is not null then raise exception 'Este item já foi conferido e não pode mudar';
  end if;
  return new;
end $$;
drop trigger if exists lin_transferencias_imutavel on public.lin_transferencias;
create trigger lin_transferencias_imutavel before update or delete on public.lin_transferencias
  for each row execute function public.lin_transferencias_imutavel();
drop trigger if exists lin_transferencia_itens_imutavel on public.lin_transferencia_itens;
create trigger lin_transferencia_itens_imutavel before update or delete on public.lin_transferencia_itens
  for each row execute function public.lin_transferencias_imutavel();

alter table public.lin_transferencias      enable row level security;
alter table public.lin_transferencia_itens enable row level security;
-- toda a equipe vê todas as transferências (quem recebe precisa ver o que vem para a sua loja); sem preço nem custo
drop policy if exists lin_transferencias_ler on public.lin_transferencias;
create policy lin_transferencias_ler on public.lin_transferencias for select using (public.lin_papel() is not null);
drop policy if exists lin_transferencia_itens_ler on public.lin_transferencia_itens;
create policy lin_transferencia_itens_ler on public.lin_transferencia_itens for select using (public.lin_papel() is not null);
revoke all on public.lin_transferencias, public.lin_transferencia_itens from anon, authenticated;
grant select on public.lin_transferencias, public.lin_transferencia_itens to authenticated;

-- movimentos ligados à transferência
alter table public.lin_movimentos add column if not exists transferencia_id bigint references public.lin_transferencias;
alter table public.lin_movimentos drop constraint if exists lin_movimentos_tipo_check;
alter table public.lin_movimentos add constraint lin_movimentos_tipo_check
  check (tipo in ('entrada', 'saida', 'transferencia', 'ajuste', 'venda', 'devolucao', 'producao',
                  'transf_envio', 'transf_recebida', 'transf_retorno'));

create or replace function public._lin_hoje() returns date
language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- resumo das peças para a auditoria
create or replace function public._lin_transf_resumo(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('referencia', referencia, 'peca', descricao, 'cor', cor, 'tamanho', tamanho,
           'edicao', edicao, 'quantidade', quantidade, 'recebida', recebida) order by id), '[]')
    from public.lin_transferencia_itens where transferencia_id = p_id
$$;
revoke execute on function public._lin_transf_resumo(bigint) from public, anon, authenticated;

-- envio: p = {origem, destino, observacao, itens: [{variante_id, quantidade}]}; devolve o número
create or replace function public.lin_transferencia_enviar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_origem uuid := nullif(p ->> 'origem', '')::uuid;
  v_destino uuid := nullif(p ->> 'destino', '')::uuid;
  v_obs text := left(coalesce(trim(p ->> 'observacao'), ''), 300);
  v_id bigint; r record; v_disp int; v_total int := 0;
begin
  if public.lin_papel() is null then raise exception 'Seu login não tem acesso ao Sistema Linum agora'; end if;
  if v_origem is null or v_destino is null or v_origem = v_destino then raise exception 'Escolha lojas de origem e destino diferentes'; end if;
  if (select count(*) from public.lin_lojas where id in (v_origem, v_destino)) <> 2 then raise exception 'Loja não encontrada'; end if;
  if jsonb_typeof(p -> 'itens') <> 'array' or jsonb_array_length(p -> 'itens') = 0 then raise exception 'Escolha as peças da transferência'; end if;
  if jsonb_array_length(p -> 'itens') > 300 then raise exception 'No máximo 300 variações por transferência'; end if;

  insert into public.lin_transferencias (origem_id, destino_id, observacao, enviado_por, enviado_nome)
  values (v_origem, v_destino, v_obs, auth.uid(), public._lin_nome()) returning id into v_id;

  -- a mesma variação repetida soma
  for r in select (x ->> 'variante_id')::uuid as variante_id, sum((x ->> 'quantidade')::int) as q
             from jsonb_array_elements(p -> 'itens') x group by 1 order by 1 loop
    if r.variante_id is null or coalesce(r.q, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero em cada peça'; end if;
    if not exists (select 1 from public.lin_variantes where id = r.variante_id) then raise exception 'Variação não encontrada'; end if;
    select quantidade into v_disp from public.lin_estoque where variante_id = r.variante_id and loja_id = v_origem for update;
    if coalesce(v_disp, 0) < r.q then
      raise exception 'Estoque insuficiente em %: % tem % peça(s) e a transferência pede %', public._lin_loja(v_origem),
        (select p2.descricao || ' ' || concat_ws(' ', nullif(v.cor, ''), nullif(v.tamanho, ''), nullif(v.edicao, ''))
           from public.lin_variantes v join public.lin_produtos p2 on p2.id = v.produto_id where v.id = r.variante_id),
        coalesce(v_disp, 0), r.q;
    end if;
    update public.lin_estoque set quantidade = quantidade - r.q, atualizado_em = now()
      where variante_id = r.variante_id and loja_id = v_origem;
    insert into public.lin_transferencia_itens (transferencia_id, variante_id, quantidade, referencia, descricao, cor, tamanho, edicao)
    select v_id, v.id, r.q, coalesce(p2.referencia, ''), coalesce(p2.descricao, ''), coalesce(v.cor, ''), coalesce(v.tamanho, ''), coalesce(v.edicao, '')
      from public.lin_variantes v join public.lin_produtos p2 on p2.id = v.produto_id where v.id = r.variante_id;
    insert into public.lin_movimentos (variante_id, loja_id, loja_destino_id, tipo, quantidade, data, observacao, criado_por, criado_nome, transferencia_id)
    values (r.variante_id, v_origem, v_destino, 'transf_envio', r.q, public._lin_hoje(),
            format('Transferência nº %s para %s (em trânsito)', v_id, public._lin_loja(v_destino)) || case when v_obs <> '' then ' · ' || v_obs else '' end,
            auth.uid(), public._lin_nome(), v_id);
    v_total := v_total + r.q;
  end loop;

  perform public._lin_auditar('linum_transferencia_enviada', null, jsonb_build_object('transferencia', v_id,
    'loja_origem', public._lin_loja(v_origem), 'loja_destino', public._lin_loja(v_destino), 'pecas', v_total,
    'observacao', v_obs, 'itens', public._lin_transf_resumo(v_id)));
  return v_id;
end $$;

-- recebimento: p_itens nulo = "recebi todas as peças"; senão [{id (do item), recebida}] para TODOS os itens,
-- e o motivo é obrigatório quando chegou menos que o enviado
create or replace function public.lin_transferencia_receber(p_id bigint, p_itens jsonb default null, p_obs text default '')
returns text language plpgsql security definer set search_path = public as $$
declare t public.lin_transferencias; it record; v_rec int; v_falta int := 0; v_ok int := 0; v_sit text; v_obs text := left(coalesce(trim(p_obs), ''), 500);
begin
  if public.lin_papel() is null then raise exception 'Seu login não tem acesso ao Sistema Linum agora'; end if;
  select * into t from public.lin_transferencias where id = p_id for update;
  if not found then raise exception 'Transferência não encontrada'; end if;
  if t.situacao <> 'em_transito' then raise exception 'Esta transferência não está em trânsito (já foi recebida ou cancelada)'; end if;
  if p_itens is not null and jsonb_typeof(p_itens) <> 'array' then raise exception 'Lista de peças inválida'; end if;

  for it in select * from public.lin_transferencia_itens where transferencia_id = p_id order by id loop
    if p_itens is null then v_rec := it.quantidade;
    else
      v_rec := null;
      select (x ->> 'recebida')::int into v_rec from jsonb_array_elements(p_itens) x where (x ->> 'id')::bigint = it.id;
      if v_rec is null then raise exception 'Confira todas as peças da transferência (faltou %)', it.descricao || ' ' || concat_ws(' ', nullif(it.cor, ''), nullif(it.tamanho, '')); end if;
      if v_rec < 0 or v_rec > it.quantidade then
        raise exception 'Quantidade recebida de % deve ser de 0 a % (o que foi enviado)', it.descricao || ' ' || concat_ws(' ', nullif(it.cor, ''), nullif(it.tamanho, '')), it.quantidade;
      end if;
    end if;
    v_falta := v_falta + (it.quantidade - v_rec); v_ok := v_ok + v_rec;
    update public.lin_transferencia_itens set recebida = v_rec where id = it.id;
    if v_rec > 0 then
      insert into public.lin_estoque (variante_id, loja_id, quantidade) values (it.variante_id, t.destino_id, v_rec)
      on conflict (variante_id, loja_id) do update set quantidade = lin_estoque.quantidade + excluded.quantidade, atualizado_em = now();
      insert into public.lin_movimentos (variante_id, loja_id, loja_destino_id, tipo, quantidade, data, observacao, criado_por, criado_nome, transferencia_id)
      values (it.variante_id, t.destino_id, null, 'transf_recebida', v_rec, public._lin_hoje(),
              format('Transferência nº %s recebida de %s', p_id, public._lin_loja(t.origem_id)) ||
                case when v_rec < it.quantidade then format(' (chegaram %s de %s)', v_rec, it.quantidade) else '' end,
              auth.uid(), public._lin_nome(), p_id);
    end if;
  end loop;

  if v_falta > 0 and length(v_obs) < 5 then raise exception 'Faltaram % peça(s): escreva o motivo (pelo menos 5 letras)', v_falta; end if;
  v_sit := case when v_falta > 0 then 'recebida_com_falta' else 'recebida' end;
  update public.lin_transferencias set situacao = v_sit, recebido_por = auth.uid(), recebido_nome = public._lin_nome(),
         recebido_em = now(), recebimento_obs = v_obs where id = p_id;
  perform public._lin_auditar('linum_transferencia_recebida', null, jsonb_build_object('transferencia', p_id,
    'loja_origem', public._lin_loja(t.origem_id), 'loja_destino', public._lin_loja(t.destino_id), 'enviado_por', t.enviado_nome,
    'pecas_recebidas', v_ok, 'pecas_faltando', v_falta, 'situacao', v_sit, 'observacao', v_obs, 'itens', public._lin_transf_resumo(p_id)));
  return v_sit;
end $$;

-- cancelar (só em trânsito): as peças voltam para a loja de origem
create or replace function public.lin_transferencia_cancelar(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.lin_transferencias; it record; v_mot text := left(coalesce(trim(p_motivo), ''), 500); v_tot int := 0;
begin
  if public.lin_papel() is null then raise exception 'Seu login não tem acesso ao Sistema Linum agora'; end if;
  select * into t from public.lin_transferencias where id = p_id for update;
  if not found then raise exception 'Transferência não encontrada'; end if;
  if t.situacao <> 'em_transito' then raise exception 'Só dá para cancelar transferência em trânsito'; end if;
  if not (public.lin_controla_estoque() or t.enviado_por = auth.uid()) then
    raise exception 'Só quem enviou, o Dono ou o Estoque pode cancelar esta transferência';
  end if;
  if length(v_mot) < 5 then raise exception 'Escreva o motivo do cancelamento (pelo menos 5 letras)'; end if;
  for it in select * from public.lin_transferencia_itens where transferencia_id = p_id order by id loop
    insert into public.lin_estoque (variante_id, loja_id, quantidade) values (it.variante_id, t.origem_id, it.quantidade)
    on conflict (variante_id, loja_id) do update set quantidade = lin_estoque.quantidade + excluded.quantidade, atualizado_em = now();
    insert into public.lin_movimentos (variante_id, loja_id, loja_destino_id, tipo, quantidade, data, observacao, criado_por, criado_nome, transferencia_id)
    values (it.variante_id, t.origem_id, null, 'transf_retorno', it.quantidade, public._lin_hoje(),
            format('Transferência nº %s cancelada: volta para %s · %s', p_id, public._lin_loja(t.origem_id), v_mot),
            auth.uid(), public._lin_nome(), p_id);
    v_tot := v_tot + it.quantidade;
  end loop;
  update public.lin_transferencias set situacao = 'cancelada', cancelado_por = auth.uid(), cancelado_nome = public._lin_nome(),
         cancelado_em = now(), cancelamento_motivo = v_mot where id = p_id;
  perform public._lin_auditar('linum_transferencia_cancelada', null, jsonb_build_object('transferencia', p_id,
    'loja_origem', public._lin_loja(t.origem_id), 'loja_destino', public._lin_loja(t.destino_id), 'enviado_por', t.enviado_nome,
    'pecas', v_tot, 'motivo', v_mot, 'itens', public._lin_transf_resumo(p_id)));
end $$;

revoke execute on function public.lin_transferencia_enviar(jsonb) from public, anon;
revoke execute on function public.lin_transferencia_receber(bigint, jsonb, text) from public, anon;
revoke execute on function public.lin_transferencia_cancelar(bigint, text) from public, anon;
grant execute on function public.lin_transferencia_enviar(jsonb) to authenticated;
grant execute on function public.lin_transferencia_receber(bigint, jsonb, text) to authenticated;
grant execute on function public.lin_transferencia_cancelar(bigint, text) to authenticated;

-- a transferência direta (sem aceite) não é mais usada pela tela
revoke execute on function public.lin_transferir(uuid, uuid, uuid, int, date, text) from authenticated;
