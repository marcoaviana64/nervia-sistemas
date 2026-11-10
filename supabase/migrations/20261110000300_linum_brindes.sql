-- Sistema Linum 2.44 — BRINDE / PRESENTE / DIVULGAÇÃO (pedido do Marco em 10/11/2026: "a Gorette deu uma peça de
-- presente; qual a melhor maneira de registrar isso?" → "acho melhor criar um Brinde / Presente / Divulgação").
--   * A peça sai do estoque como "brinde" (movimento próprio), NÃO como venda: não entra em vendas, comissão, ranking,
--     conversão nem no lucro das vendas. Fica separada para a Dona ver quanto vai em presentes e divulgação.
--   * Motivo: presente, divulgação (influenciadora, parceria, fotos), brinde para cliente, outro. Para quem foi (nome
--     obrigatório) e, se for cliente do cadastro, a ligação com ela (vai para o histórico do CRM, sem valor).
--   * Quem registra: Dono e Estoque (lin_controla_estoque()), como o beneficiamento; a vendedora não registra nem vê.
--   * Na hora do registro ficam copiados a etiqueta, o preço de venda e o CUSTO da peça (o do histórico de preços, como
--     no Lucro); o custo só o Dono vê (leitura só pela lin_brindes_ler, que o tira de quem não é Dono).
--   * Cancelar (registro errado): só o Dono, com motivo; as peças voltam para a loja (movimento brinde_cancelado).
--   * Nada se apaga; as peças não mudam; o cancelamento é a única mudança.
--   * Auditoria: linum_brinde_registrado / linum_brinde_cancelado.
-- Só acrescenta tabelas, uma coluna com padrão nulo e dois tipos de movimento: nenhum dado existente muda.

create table if not exists public.lin_brindes (
  id                  bigint generated always as identity primary key,
  data                date not null,
  loja_id             uuid not null references public.lin_lojas,
  motivo              text not null check (motivo in ('presente', 'divulgacao', 'brinde', 'outro')),
  destinatario        text not null check (length(trim(destinatario)) >= 2),
  cliente_id          uuid references public.lin_clientes on delete set null,
  observacao          text not null default '',
  criado_por          uuid references auth.users on delete set null,
  criado_nome         text not null default '',
  criado_em           timestamptz not null default now(),
  cancelado_em        timestamptz,
  cancelado_por       uuid references auth.users on delete set null,
  cancelado_nome      text,
  cancelamento_motivo text
);
create index if not exists lin_brindes_data on public.lin_brindes (data desc, id desc);

create table if not exists public.lin_brinde_itens (
  id             bigint generated always as identity primary key,
  brinde_id      bigint not null references public.lin_brindes,
  variante_id    uuid not null references public.lin_variantes,
  quantidade     int not null check (quantidade > 0),
  referencia     text not null default '',
  descricao      text not null default '',
  cor            text not null default '',
  tamanho        text not null default '',
  edicao         text not null default '',
  preco_venda    numeric,          -- preço de venda na hora (peça especial com preço próprio usa o dela)
  custo_unitario numeric,          -- custo na hora (vazio = peça sem custo cadastrado); só o Dono vê
  unique (brinde_id, variante_id)
);
create index if not exists lin_brinde_itens_b on public.lin_brinde_itens (brinde_id);

create or replace function public.lin_brindes_imutavel() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'lin_brinde_itens' then raise exception 'As peças de um brinde não podem ser alteradas nem apagadas'; end if;
  if tg_op = 'DELETE' then raise exception 'Brindes não podem ser apagados: cancele com o motivo'; end if;
  if old.cancelado_em is not null then raise exception 'Este brinde já foi cancelado'; end if;
  if new.data <> old.data or new.loja_id <> old.loja_id or new.motivo <> old.motivo or new.destinatario <> old.destinatario
     or new.cliente_id is distinct from old.cliente_id or new.observacao <> old.observacao or new.criado_em <> old.criado_em then
    raise exception 'Um brinde registrado não muda: cancele e registre de novo';
  end if;
  return new;
end $$;
drop trigger if exists lin_brindes_imutavel on public.lin_brindes;
create trigger lin_brindes_imutavel before update or delete on public.lin_brindes
  for each row execute function public.lin_brindes_imutavel();
drop trigger if exists lin_brinde_itens_imutavel on public.lin_brinde_itens;
create trigger lin_brinde_itens_imutavel before update or delete on public.lin_brinde_itens
  for each row execute function public.lin_brindes_imutavel();

-- sem leitura direta pela tela (o custo está nas linhas): só pela lin_brindes_ler
alter table public.lin_brindes      enable row level security;
alter table public.lin_brinde_itens enable row level security;
revoke all on public.lin_brindes, public.lin_brinde_itens from anon, authenticated;

alter table public.lin_movimentos add column if not exists brinde_id bigint references public.lin_brindes;
alter table public.lin_movimentos drop constraint if exists lin_movimentos_tipo_check;
alter table public.lin_movimentos add constraint lin_movimentos_tipo_check
  check (tipo in ('entrada', 'saida', 'transferencia', 'ajuste', 'venda', 'devolucao', 'producao',
                  'transf_envio', 'transf_recebida', 'transf_retorno', 'benef_envio', 'benef_retorno',
                  'brinde', 'brinde_cancelado'));

create or replace function public._lin_brinde_motivo(m text) returns text
language sql immutable as $$
  select case m when 'presente' then 'Presente' when 'divulgacao' then 'Divulgação' when 'brinde' then 'Brinde para cliente' else 'Outro' end
$$;

-- peças do brinde (para a auditoria e o CRM); custo só quando pedido
create or replace function public._lin_brinde_resumo(p_id bigint, p_custo boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('referencia', i.referencia, 'peca', i.descricao, 'cor', i.cor, 'tamanho', i.tamanho,
           'edicao', i.edicao, 'quantidade', i.quantidade, 'preco_venda', i.preco_venda)
           || case when p_custo then jsonb_build_object('custo_unitario', i.custo_unitario) else '{}'::jsonb end order by i.id), '[]')
    from public.lin_brinde_itens i where i.brinde_id = p_id
$$;
revoke execute on function public._lin_brinde_resumo(bigint, boolean) from public, anon, authenticated;

-- registrar: p = {loja, data, motivo, destinatario, cliente_id, observacao, itens: [{variante_id, quantidade}]}
create or replace function public.lin_brinde_registrar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_loja uuid := nullif(p ->> 'loja', '')::uuid;
  v_data date := coalesce(nullif(p ->> 'data', '')::date, public._lin_hoje());
  v_mot text := coalesce(p ->> 'motivo', '');
  v_dest text := left(coalesce(trim(p ->> 'destinatario'), ''), 120);
  v_cli uuid := nullif(p ->> 'cliente_id', '')::uuid;
  v_obs text := left(coalesce(trim(p ->> 'observacao'), ''), 300);
  v_id bigint; r record; v_disp int; v_total int := 0; v_txt text;
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque registra brindes e presentes'; end if;
  if v_loja is null or not exists (select 1 from public.lin_lojas where id = v_loja) then raise exception 'Escolha a loja de onde as peças saem'; end if;
  if v_mot not in ('presente', 'divulgacao', 'brinde', 'outro') then raise exception 'Escolha o motivo (presente, divulgação, brinde para cliente ou outro)'; end if;
  if v_data > public._lin_hoje() then raise exception 'A data não pode ser depois de hoje'; end if;
  if v_data < public._lin_hoje() - 60 then raise exception 'A data pode ser no máximo 60 dias atrás'; end if;
  if v_cli is not null then
    if not exists (select 1 from public.lin_clientes where id = v_cli) then raise exception 'Cliente não encontrada'; end if;
    if v_dest = '' then select nome into v_dest from public.lin_clientes where id = v_cli; end if;
  end if;
  if length(v_dest) < 2 then raise exception 'Informe para quem foi a peça'; end if;
  if v_mot = 'outro' and length(v_obs) < 3 then raise exception 'Com o motivo "Outro", escreva na observação o que foi'; end if;
  if jsonb_typeof(p -> 'itens') <> 'array' or jsonb_array_length(p -> 'itens') = 0 then raise exception 'Escolha as peças'; end if;
  if jsonb_array_length(p -> 'itens') > 100 then raise exception 'No máximo 100 variações por registro'; end if;

  insert into public.lin_brindes (data, loja_id, motivo, destinatario, cliente_id, observacao, criado_por, criado_nome)
  values (v_data, v_loja, v_mot, v_dest, v_cli, v_obs, auth.uid(), public._lin_nome()) returning id into v_id;

  for r in select (x ->> 'variante_id')::uuid as variante_id, sum((x ->> 'quantidade')::int) as q
             from jsonb_array_elements(p -> 'itens') x group by 1 order by 1 loop
    if r.variante_id is null or coalesce(r.q, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero em cada peça'; end if;
    if not exists (select 1 from public.lin_variantes where id = r.variante_id) then raise exception 'Variação não encontrada'; end if;
    select quantidade into v_disp from public.lin_estoque where variante_id = r.variante_id and loja_id = v_loja for update;
    if coalesce(v_disp, 0) < r.q then
      raise exception 'Estoque insuficiente em %: % tem % peça(s) e o registro pede %', public._lin_loja(v_loja),
        (select p2.descricao || ' ' || concat_ws(' ', nullif(v.cor, ''), nullif(v.tamanho, ''), nullif(v.edicao, ''))
           from public.lin_variantes v join public.lin_produtos p2 on p2.id = v.produto_id where v.id = r.variante_id),
        coalesce(v_disp, 0), r.q;
    end if;
    update public.lin_estoque set quantidade = quantidade - r.q, atualizado_em = now()
      where variante_id = r.variante_id and loja_id = v_loja;
    insert into public.lin_brinde_itens (brinde_id, variante_id, quantidade, referencia, descricao, cor, tamanho, edicao, preco_venda, custo_unitario)
    select v_id, v.id, r.q, coalesce(p2.referencia, ''), coalesce(p2.descricao, ''), coalesce(v.cor, ''), coalesce(v.tamanho, ''), coalesce(v.edicao, ''),
           coalesce(v.preco_venda, p2.preco_venda),
           coalesce(public._lin_custo_em(v.produto_id, v.id, now()), v.preco_custo, p2.preco_custo)
      from public.lin_variantes v join public.lin_produtos p2 on p2.id = v.produto_id where v.id = r.variante_id;
    insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, data, observacao, criado_por, criado_nome, brinde_id)
    values (r.variante_id, v_loja, 'brinde', r.q, v_data,
            format('%s nº %s para %s', public._lin_brinde_motivo(v_mot), v_id, v_dest) || case when v_obs <> '' then ' · ' || v_obs else '' end,
            auth.uid(), public._lin_nome(), v_id);
    v_total := v_total + r.q;
  end loop;

  -- no histórico da cliente (sem valor), para a equipe saber
  if v_cli is not null then
    select string_agg(i.quantidade || '× ' || i.descricao || coalesce(' ' || nullif(concat_ws(' ', nullif(i.cor, ''), nullif(i.tamanho, ''), nullif(i.edicao, '')), ''), ''), ', ' order by i.id)
      into v_txt from public.lin_brinde_itens i where i.brinde_id = v_id;
    insert into public.lin_contatos (cliente_id, por, por_nome, canal, resultado, texto)
    values (v_cli, auth.uid(), public._lin_nome(), 'loja', 'outro',
            format('Ganhou %s (nº %s): %s', case v_mot when 'presente' then 'um presente' when 'divulgacao' then 'peça para divulgação'
                   when 'brinde' then 'um brinde' else 'uma peça' end, v_id, v_txt) || case when v_obs <> '' then ' · ' || v_obs else '' end);
    update public.lin_clientes set ultimo_contato = now() where id = v_cli;
  end if;

  perform public._lin_auditar('linum_brinde_registrado', null, jsonb_build_object('brinde', v_id,
    'loja', public._lin_loja(v_loja), 'data', v_data, 'motivo', public._lin_brinde_motivo(v_mot), 'destinatario', v_dest,
    'cliente_id', v_cli, 'observacao', v_obs, 'pecas', v_total, 'itens', public._lin_brinde_resumo(v_id, public.lin_eh_dono())));
  return v_id;
end $$;

-- cancelar (registro errado): só o Dono; as peças voltam para a loja
create or replace function public.lin_brinde_cancelar(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.lin_brindes; v_mot text := left(trim(coalesce(p_motivo, '')), 300); it record;
begin
  if not public.lin_eh_dono() then raise exception 'Só o Dono cancela um brinde'; end if;
  select * into b from public.lin_brindes where id = p_id for update;
  if not found then raise exception 'Brinde não encontrado'; end if;
  if b.cancelado_em is not null then raise exception 'Este brinde já foi cancelado'; end if;
  if length(v_mot) < 5 then raise exception 'Escreva o motivo do cancelamento (pelo menos 5 letras)'; end if;
  for it in select * from public.lin_brinde_itens where brinde_id = p_id order by id loop
    insert into public.lin_estoque (variante_id, loja_id, quantidade) values (it.variante_id, b.loja_id, it.quantidade)
    on conflict (variante_id, loja_id) do update set quantidade = lin_estoque.quantidade + excluded.quantidade, atualizado_em = now();
    insert into public.lin_movimentos (variante_id, loja_id, tipo, quantidade, data, observacao, criado_por, criado_nome, brinde_id)
    values (it.variante_id, b.loja_id, 'brinde_cancelado', it.quantidade, public._lin_hoje(),
            format('%s nº %s cancelado (voltou ao estoque): %s', public._lin_brinde_motivo(b.motivo), p_id, v_mot), auth.uid(), public._lin_nome(), p_id);
  end loop;
  update public.lin_brindes set cancelado_em = now(), cancelado_por = auth.uid(), cancelado_nome = public._lin_nome(), cancelamento_motivo = v_mot where id = p_id;
  if b.cliente_id is not null then
    insert into public.lin_contatos (cliente_id, por, por_nome, canal, resultado, texto)
    values (b.cliente_id, auth.uid(), public._lin_nome(), 'outro', 'outro', format('Registro do brinde nº %s cancelado: %s', p_id, v_mot));
  end if;
  perform public._lin_auditar('linum_brinde_cancelado', null, jsonb_build_object('brinde', p_id, 'loja', public._lin_loja(b.loja_id),
    'motivo', public._lin_brinde_motivo(b.motivo), 'destinatario', b.destinatario, 'motivo_cancelamento', v_mot,
    'itens', public._lin_brinde_resumo(p_id, true)));
end $$;

-- leitura (Dono e Estoque): brindes do período (data), com as peças; custo só para o Dono
create or replace function public.lin_brindes_ler(p_de date, p_ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_custo boolean := public.lin_eh_dono();
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque vê os brindes'; end if;
  return coalesce((select jsonb_agg(to_jsonb(b) - 'criado_por' - 'cancelado_por' || jsonb_build_object('itens',
      (select coalesce(jsonb_agg(case when v_custo then to_jsonb(i) else to_jsonb(i) - 'custo_unitario' end order by i.id), '[]')
         from public.lin_brinde_itens i where i.brinde_id = b.id)) order by b.data desc, b.id desc)
    from public.lin_brindes b where b.data between coalesce(p_de, '2000-01-01') and coalesce(p_ate, '2999-12-31')), '[]');
end $$;

revoke execute on function public.lin_brinde_registrar(jsonb) from public, anon;
revoke execute on function public.lin_brinde_cancelar(bigint, text) from public, anon;
revoke execute on function public.lin_brindes_ler(date, date) from public, anon;
grant execute on function public.lin_brinde_registrar(jsonb) to authenticated;
grant execute on function public.lin_brinde_cancelar(bigint, text) to authenticated;
grant execute on function public.lin_brindes_ler(date, date) to authenticated;
