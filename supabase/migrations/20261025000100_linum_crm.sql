-- Sistema Linum — CRM: acompanhamento de clientes e possíveis clientes (pedido do Marco em 25/10/2026).
-- "As vendedoras podem criar clientes e escrever dados e informações do contato com os clientes chamando para a loja;
--  isto vai servir para acompanhar."
--   * lin_clientes ganha: situação (cliente | possivel = ainda não comprou), como conheceu a Linum, interesses,
--     quem acompanha (responsável) e a data do próximo contato. Quem compra vira cliente sozinho (gatilho na venda).
--   * lin_contatos: o histórico de cada contato (WhatsApp, ligação, Instagram, na loja, e-mail), com o resultado e o
--     próximo contato. SOMENTE INCLUSÃO (ninguém altera nem apaga), só pela rpc lin_contato_registrar.
--   * Toda a equipe da Linum vê todos os clientes e todo o histórico (quem pega o atendimento continua de onde parou).
--   * Auditoria: linum_contato_registrado (sem o texto), e o cadastro continua em linum_cliente_criado/alterado.

alter table public.lin_clientes add column if not exists situacao text not null default 'cliente';
alter table public.lin_clientes drop constraint if exists lin_clientes_situacao;
alter table public.lin_clientes add constraint lin_clientes_situacao check (situacao in ('cliente', 'possivel'));
alter table public.lin_clientes add column if not exists origem text not null default '';
alter table public.lin_clientes add column if not exists interesses text not null default '';
alter table public.lin_clientes add column if not exists responsavel_id uuid references auth.users on delete set null;
alter table public.lin_clientes add column if not exists responsavel_nome text not null default '';
alter table public.lin_clientes add column if not exists proximo_contato date;
alter table public.lin_clientes add column if not exists ultimo_contato timestamptz;
create index if not exists lin_clientes_proximo on public.lin_clientes (proximo_contato) where proximo_contato is not null;

-- quem já tinha cadastro continua cliente; o responsável inicial é quem cadastrou
update public.lin_clientes set responsavel_id = criado_por, responsavel_nome = criado_nome
 where responsavel_id is null and criado_por is not null;

-- ---------------------------------------------------------------- histórico de contatos
create table if not exists public.lin_contatos (
  id              bigint generated always as identity primary key,
  cliente_id      uuid not null references public.lin_clientes on delete cascade,
  em              timestamptz not null default now(),
  por             uuid references auth.users on delete set null,
  por_nome        text not null default '',
  canal           text not null check (canal in ('whatsapp', 'ligacao', 'instagram', 'loja', 'email', 'outro')),
  resultado       text not null check (resultado in ('sem_resposta', 'conversou', 'vai_a_loja', 'veio_a_loja', 'comprou', 'sem_interesse', 'outro')),
  texto           text not null check (length(trim(texto)) >= 3),
  proximo_contato date
);
create index if not exists lin_contatos_cliente on public.lin_contatos (cliente_id, em desc);

create or replace function public.lin_contatos_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'O histórico de contatos não pode ser alterado nem apagado: registre um contato novo.';
end $$;
drop trigger if exists lin_contatos_imutavel on public.lin_contatos;
create trigger lin_contatos_imutavel before update or delete on public.lin_contatos
  for each row when (pg_trigger_depth() = 0) execute function public.lin_contatos_imutavel();
-- (a exclusão de um cliente sem compras apaga o histórico dele junto, pelo cascade)

alter table public.lin_contatos enable row level security;
revoke all on public.lin_contatos from anon;
revoke insert, update, delete on public.lin_contatos from authenticated;
drop policy if exists lin_contatos_ler on public.lin_contatos;
create policy lin_contatos_ler on public.lin_contatos for select using (public.lin_vende());

-- ---------------------------------------------------------------- registrar um contato
create or replace function public.lin_contato_registrar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_cli uuid := nullif(p ->> 'cliente_id', '')::uuid; v_canal text := coalesce(p ->> 'canal', '');
        v_res text := coalesce(p ->> 'resultado', ''); v_txt text := public._lin_txt(p, 'texto');
        v_prox date := nullif(p ->> 'proximo_contato', '')::date; v_id bigint; v_nome text;
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  select nome into v_nome from public.lin_clientes where id = v_cli for update;
  if v_nome is null then raise exception 'Cliente não encontrado'; end if;
  if v_canal not in ('whatsapp', 'ligacao', 'instagram', 'loja', 'email', 'outro') then raise exception 'Escolha como foi o contato'; end if;
  if v_res not in ('sem_resposta', 'conversou', 'vai_a_loja', 'veio_a_loja', 'comprou', 'sem_interesse', 'outro') then raise exception 'Escolha o resultado do contato'; end if;
  if v_txt is null or length(v_txt) < 3 then raise exception 'Escreva o que foi conversado'; end if;
  -- "hoje" no horário de Brasília (o servidor do Supabase roda em UTC)
  if v_prox is not null and v_prox < (now() at time zone 'America/Sao_Paulo')::date then raise exception 'O próximo contato precisa ser hoje ou depois'; end if;
  insert into public.lin_contatos (cliente_id, por, por_nome, canal, resultado, texto, proximo_contato)
  values (v_cli, auth.uid(), public._lin_nome(), v_canal, v_res, v_txt, v_prox) returning id into v_id;
  -- o próximo contato do cadastro passa a ser o deste registro (vazio = nada agendado)
  update public.lin_clientes set proximo_contato = v_prox, ultimo_contato = now(), atualizado_em = now() where id = v_cli;
  perform public._lin_auditar('linum_contato_registrado', null, jsonb_build_object('cliente_id', v_cli, 'cliente', v_nome,
    'contato_id', v_id, 'canal', v_canal, 'resultado', v_res, 'proximo_contato', v_prox));
  return v_id;
end $$;

-- ---------------------------------------------------------------- cadastro com os campos do CRM
create or replace function public.lin_cliente_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_nome text := public._lin_txt(p, 'nome');
        v_tel text := regexp_replace(coalesce(p ->> 'telefone', ''), '\D', '', 'g');
        v_cpf text := nullif(regexp_replace(coalesce(p ->> 'cpf', ''), '\D', '', 'g'), '');
        v_dia int := nullif(p ->> 'aniversario_dia', '')::int; v_mes int := nullif(p ->> 'aniversario_mes', '')::int;
        v_sit text := coalesce(nullif(p ->> 'situacao', ''), 'cliente');
        v_resp uuid := nullif(p ->> 'responsavel_id', '')::uuid; v_resp_nome text;
        v_prox date := nullif(p ->> 'proximo_contato', '')::date;
        v_antes jsonb; v_outro text; v_crm boolean := p ? 'situacao';
begin
  if not public.lin_vende() then raise exception 'Seu login não tem acesso ao Sistema Linum. Fale com a Nervia.'; end if;
  if v_nome is null or length(v_nome) < 2 then raise exception 'Informe o nome do cliente'; end if;
  if v_tel <> '' and length(v_tel) not between 10 and 13 then raise exception 'Telefone com DDD: 10 ou 11 dígitos'; end if;
  if v_cpf is not null and length(v_cpf) <> 11 then raise exception 'CPF deve ter 11 dígitos'; end if;
  if (v_dia is null) <> (v_mes is null) then raise exception 'Aniversário: informe dia e mês'; end if;
  if v_dia is not null and (v_mes not between 1 and 12 or v_dia < 1 or v_dia > extract(day from (make_date(2024, v_mes, 1) + interval '1 month - 1 day'))) then
    raise exception 'Data de aniversário inválida';
  end if;
  if v_sit not in ('cliente', 'possivel') then raise exception 'Situação inválida'; end if;
  if v_resp is not null then
    select coalesce(nullif(trim(pf.nome), ''), pf.email) into v_resp_nome from public.lin_membros m join public.perfis pf on pf.user_id = m.user_id where m.user_id = v_resp;
    if v_resp_nome is null then raise exception 'Responsável precisa ser alguém da equipe da Linum'; end if;
  end if;
  select nome into v_outro from public.lin_clientes where cpf = v_cpf and id is distinct from v_id;
  if v_outro is not null then raise exception 'Este CPF já é do cliente %', v_outro; end if;
  if v_id is null then
    insert into public.lin_clientes (nome, telefone, cpf, email, endereco, aniversario_dia, aniversario_mes, observacoes, loja_id, criado_por, criado_nome,
                                     situacao, origem, interesses, responsavel_id, responsavel_nome, proximo_contato)
    values (v_nome, v_tel, v_cpf, coalesce(public._lin_txt(p, 'email'), ''), coalesce(public._lin_txt(p, 'endereco'), ''), v_dia, v_mes,
            coalesce(public._lin_txt(p, 'observacoes'), ''), coalesce(nullif(p ->> 'loja_id', '')::uuid, public.lin_minha_loja()), auth.uid(), public._lin_nome(),
            v_sit, coalesce(public._lin_txt(p, 'origem'), ''), coalesce(public._lin_txt(p, 'interesses'), ''),
            coalesce(v_resp, auth.uid()), coalesce(v_resp_nome, public._lin_nome()), v_prox)
    returning id into v_id;
    perform public._lin_auditar('linum_cliente_criado', null, jsonb_build_object('cliente_id', v_id, 'cliente', v_nome, 'situacao', v_sit));
  else
    select to_jsonb(c) - 'atualizado_em' - 'ultimo_contato' into v_antes from public.lin_clientes c where id = v_id for update;
    if v_antes is null then raise exception 'Cliente não encontrado'; end if;
    update public.lin_clientes set nome = v_nome, telefone = v_tel, cpf = v_cpf, email = coalesce(public._lin_txt(p, 'email'), ''),
      endereco = coalesce(public._lin_txt(p, 'endereco'), ''), aniversario_dia = v_dia, aniversario_mes = v_mes,
      observacoes = coalesce(public._lin_txt(p, 'observacoes'), ''), atualizado_em = now()
    where id = v_id;
    -- campos do CRM só mudam quando a tela os manda (o cadastro rápido da venda não mexe neles)
    if v_crm then
      update public.lin_clientes set situacao = v_sit, origem = coalesce(public._lin_txt(p, 'origem'), ''),
        interesses = coalesce(public._lin_txt(p, 'interesses'), ''), proximo_contato = v_prox,
        responsavel_id = coalesce(v_resp, responsavel_id), responsavel_nome = coalesce(v_resp_nome, responsavel_nome)
      where id = v_id;
    end if;
    perform public._lin_auditar('linum_cliente_alterado', null, jsonb_build_object('cliente_id', v_id, 'cliente', v_nome, 'antes', v_antes,
      'depois', (select to_jsonb(c) - 'atualizado_em' - 'ultimo_contato' from public.lin_clientes c where id = v_id)));
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- quem compra vira cliente
create or replace function public.lin_cliente_comprou() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cliente_id is not null then
    update public.lin_clientes set situacao = 'cliente' where id = new.cliente_id and situacao <> 'cliente';
  end if;
  return new;
end $$;
drop trigger if exists lin_vendas_cliente_comprou on public.lin_vendas;
create trigger lin_vendas_cliente_comprou after insert on public.lin_vendas for each row execute function public.lin_cliente_comprou();

do $$ declare f text; begin
  foreach f in array array['lin_contato_registrar(jsonb)', 'lin_cliente_salvar(jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke execute on function public.lin_cliente_comprou() from public, anon, authenticated;
