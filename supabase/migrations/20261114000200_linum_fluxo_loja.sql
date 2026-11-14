-- Sistema Linum 2.53 — FLUXO DA LOJA (pedido do Marco em 14/11/2026: "criar registro de fluxo da loja nas visitas";
-- hoje a loja anota no papel: "Gostou da Camisa Catela, ficou grande, viaja amanhã e volta outro dia",
-- "Entrou pela bolsa da vitrine, quis saber opção de cores, estava almoçando no Origami",
-- "Recebemos visita das 3 amigas do panfleto, gostaram muito, ficaram de voltar").
-- A "Visita sem contato" (1.9, lin_visitas) vira o registro do fluxo, tão rápido quanto o papel:
--   * a anotação livre (observacao) passa a ser o campo principal; "por que não levou" deixa de ser obrigatório
--     (basta escrever a anotação OU marcar alguma informação);
--   * como_chegou (vitrine, panfleto, estava por perto, Instagram, indicação, já é cliente, passando na rua, outro);
--   * gostou (muito, gostou, so_olhou);
--   * volta (sim, talvez, nao) + volta_quando (texto livre, "depois da viagem");
--   * contato OPCIONAL, só com a autorização da pessoa: a tela cadastra (ou acha) a possível cliente pelo CRM de sempre
--     (lin_cliente_salvar) e manda o cliente_id; a visita fica ligada a ela, entra uma anotação no histórico da cliente
--     (lin_contatos, canal loja, sem valores) e, com proximo_contato, o retorno fica marcado no CRM.
-- O que já foi registrado NÃO muda: colunas novas com padrão vazio; lin_visitas continua SOMENTE INCLUSÃO.
-- Leitura igual: cada um vê as próprias visitas, o Dono vê todas (policy da 2.51, com select).

alter table public.lin_visitas add column if not exists como_chegou  text not null default '';
alter table public.lin_visitas add column if not exists como_outro   text not null default '';
alter table public.lin_visitas add column if not exists gostou       text not null default '';
alter table public.lin_visitas add column if not exists volta        text not null default '';
alter table public.lin_visitas add column if not exists volta_quando text not null default '';
alter table public.lin_visitas add column if not exists cliente_id   uuid references public.lin_clientes on delete set null;

alter table public.lin_visitas drop constraint if exists lin_visitas_como_chegou;
alter table public.lin_visitas add constraint lin_visitas_como_chegou
  check (como_chegou in ('', 'vitrine', 'panfleto', 'por_perto', 'instagram', 'indicacao', 'ja_cliente', 'passando', 'outro'));
alter table public.lin_visitas drop constraint if exists lin_visitas_gostou;
alter table public.lin_visitas add constraint lin_visitas_gostou check (gostou in ('', 'muito', 'gostou', 'so_olhou'));
alter table public.lin_visitas drop constraint if exists lin_visitas_volta;
alter table public.lin_visitas add constraint lin_visitas_volta check (volta in ('', 'sim', 'talvez', 'nao'));

-- "por que não levou" passa a ser opcional (a lista de valores continua a mesma)
alter table public.lin_visitas drop constraint if exists lin_visitas_motivos_check;
alter table public.lin_visitas drop constraint if exists lin_visitas_motivos;
alter table public.lin_visitas add constraint lin_visitas_motivos
  check (motivos <@ array['tamanho', 'cor', 'preco', 'so_olhando', 'vai_voltar', 'outro']);

create index if not exists lin_visitas_cliente on public.lin_visitas (cliente_id) where cliente_id is not null;

create or replace function public.lin_visita_registrar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_loja uuid := nullif(p ->> 'loja_id', '')::uuid; v_pes int := coalesce(nullif(p ->> 'pessoas', '')::int, 1);
        v_mot text[]; v_outro text := coalesce(public._lin_txt(p, 'motivo_outro'), ''); v_ids uuid[]; v_pecas jsonb; v_id bigint;
        v_obs text := coalesce(public._lin_txt(p, 'observacao'), ''); v_falt text := coalesce(public._lin_txt(p, 'faltou'), '');
        v_como text := coalesce(p ->> 'como_chegou', ''); v_como_outro text := coalesce(public._lin_txt(p, 'como_outro'), '');
        v_gostou text := coalesce(p ->> 'gostou', ''); v_volta text := coalesce(p ->> 'volta', '');
        v_quando text := coalesce(public._lin_txt(p, 'volta_quando'), '');
        v_cli uuid := nullif(p ->> 'cliente_id', '')::uuid; v_prox date := nullif(p ->> 'proximo_contato', '')::date;
        v_cli_nome text; v_texto text;
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  if v_loja is null or not exists (select 1 from public.lin_lojas where id = v_loja) then raise exception 'Escolha a loja'; end if;
  if v_pes not between 1 and 20 then raise exception 'Quantidade de pessoas: de 1 a 20'; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_mot from jsonb_array_elements_text(coalesce(p -> 'motivos', '[]')) x;
  if not v_mot <@ array['tamanho', 'cor', 'preco', 'so_olhando', 'vai_voltar', 'outro'] then
    raise exception 'Motivo desconhecido em "por que não levou"';
  end if;
  if 'outro' = any(v_mot) and length(v_outro) < 3 then raise exception 'Escreva qual foi o outro motivo'; end if;
  if not 'outro' = any(v_mot) then v_outro := ''; end if;
  if v_como not in ('', 'vitrine', 'panfleto', 'por_perto', 'instagram', 'indicacao', 'ja_cliente', 'passando', 'outro') then
    raise exception 'Como chegou: opção desconhecida';
  end if;
  if v_como = 'outro' and length(v_como_outro) < 3 then raise exception 'Escreva como a pessoa chegou'; end if;
  if v_como <> 'outro' then v_como_outro := ''; end if;
  if v_gostou not in ('', 'muito', 'gostou', 'so_olhou') then raise exception 'Gostou: opção desconhecida'; end if;
  if v_volta not in ('', 'sim', 'talvez', 'nao') then raise exception 'Vai voltar: opção desconhecida'; end if;
  if v_volta not in ('sim', 'talvez') then v_quando := ''; end if;
  if length(v_obs) > 500 or length(v_quando) > 100 or length(v_falt) > 100 or length(v_como_outro) > 100 then
    raise exception 'Texto muito longo';
  end if;
  select coalesce(array_agg(distinct x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(p -> 'pecas', '[]')) x;
  if cardinality(v_ids) > 20 then raise exception 'No máximo 20 peças por visita'; end if;
  if v_obs = '' and cardinality(v_ids) = 0 and cardinality(v_mot) = 0 and v_como = '' and v_gostou = '' and v_volta = '' then
    raise exception 'Escreva o que aconteceu ou marque alguma informação da visita';
  end if;
  if v_cli is not null then
    select nome into v_cli_nome from public.lin_clientes where id = v_cli for update;
    if v_cli_nome is null then raise exception 'Cliente não encontrado'; end if;
  elsif v_prox is not null then
    raise exception 'O retorno só pode ser marcado com o contato da pessoa';
  end if;
  if v_prox is not null and v_prox < (now() at time zone 'America/Sao_Paulo')::date then raise exception 'O retorno precisa ser hoje ou depois'; end if;
  -- cópia da etiqueta, como na venda (se a peça mudar depois, a visita continua mostrando o que era)
  select coalesce(jsonb_agg(jsonb_build_object('variante_id', v.id, 'referencia', pr.referencia, 'descricao', pr.descricao,
           'cor', v.cor, 'tamanho', v.tamanho, 'edicao', v.edicao) order by pr.descricao, v.cor, v.tamanho), '[]')
    into v_pecas from public.lin_variantes v join public.lin_produtos pr on pr.id = v.produto_id where v.id = any(v_ids);
  if jsonb_array_length(v_pecas) <> cardinality(v_ids) then raise exception 'Peça não encontrada'; end if;
  insert into public.lin_visitas (loja_id, por, por_nome, pessoas, motivos, motivo_outro, faltou, pecas, observacao,
                                  como_chegou, como_outro, gostou, volta, volta_quando, cliente_id)
  values (v_loja, auth.uid(), public._lin_nome(), v_pes, v_mot, v_outro, v_falt, v_pecas, v_obs,
          v_como, v_como_outro, v_gostou, v_volta, v_quando, v_cli)
  returning id into v_id;
  -- com contato: anotação no histórico da cliente (sem valores) e o retorno no CRM
  if v_cli is not null then
    v_texto := 'Visitou a loja ' || public._lin_loja(v_loja) || ' (fluxo nº ' || v_id || ')'
      || case when jsonb_array_length(v_pecas) > 0 then '. Peças: ' || (select string_agg(concat_ws(' ', x ->> 'descricao', nullif(x ->> 'cor', ''), nullif(x ->> 'tamanho', '')), ', ')
                                                                         from jsonb_array_elements(v_pecas) x) else '' end
      || case when v_obs <> '' then '. ' || v_obs else '' end
      || case v_volta when 'sim' then '. Vai voltar' when 'talvez' then '. Talvez volte' else '' end
      || case when v_quando <> '' then ' (' || v_quando || ')' else '' end;
    insert into public.lin_contatos (cliente_id, por, por_nome, canal, resultado, texto, proximo_contato)
    values (v_cli, auth.uid(), public._lin_nome(), 'loja', 'veio_a_loja', left(v_texto, 1000), v_prox);
    update public.lin_clientes set ultimo_contato = now(), atualizado_em = now(),
      proximo_contato = coalesce(v_prox, proximo_contato),
      novidades_aceite_em = case when coalesce((p ->> 'aceite')::boolean, false) and novidades_aceite_em is null then now() else novidades_aceite_em end,
      novidades_origem = case when coalesce((p ->> 'aceite')::boolean, false) and novidades_aceite_em is null then 'Fluxo da loja – ' || public._lin_loja(v_loja) else novidades_origem end
    where id = v_cli;
  end if;
  perform public._lin_auditar('linum_visita_registrada', null, jsonb_build_object('visita_id', v_id, 'loja', public._lin_loja(v_loja),
    'pessoas', v_pes, 'motivos', to_jsonb(v_mot), 'motivo_outro', v_outro, 'pecas', jsonb_array_length(v_pecas),
    'como_chegou', v_como, 'gostou', v_gostou, 'volta', v_volta, 'cliente_id', v_cli, 'cliente', v_cli_nome, 'proximo_contato', v_prox));
  return v_id;
end $$;
revoke execute on function public.lin_visita_registrar(jsonb) from public, anon;
grant execute on function public.lin_visita_registrar(jsonb) to authenticated;
