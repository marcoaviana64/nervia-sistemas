-- Mídia Indoor — créditos de dias de uso por TV (pedido do Marco em 19/11/2026: "a ideia é vender o sistema por TV
-- instalada; preciso ter um controle de que a mensalidade da TV está paga e, se não estiver, ser passível de bloqueio";
-- "a ideia é vender créditos de dias de uso").
--
-- Decisões do Marco (19/11/2026):
--   * o crédito é de DIA DE CALENDÁRIO (comprou 30 dias = vale 30 dias, com a TV ligada ou não);
--   * o saldo é de CADA TV (cada TV tem a sua assinatura); a Nervia põe os dias numa TV ou, de uma vez, em várias TVs
--     do cliente;
--   * acabaram os dias, a TV continua passando pela TOLERÂNCIA do cliente (padrão 3 dias, configurável por conta) e
--     depois pausa SOZINHA;
--   * a TV pausada mostra a tela de espera com a propaganda da Nervia e uma mensagem neutra (sem falar em pagamento:
--     a tela é vista pelo público);
--   * o pagamento é registrado no próprio Mídia Indoor (valor opcional, só a equipe Nervia vê).
--
-- Regras:
--   mi_telas.valida_ate = último dia (de Brasília) já pago; vazio = nunca recebeu dias.
--   mi_telas.isenta     = sem controle de créditos (TVs da Nervia, piloto, cortesia). As TVs que JÁ EXISTEM entram
--                         isentas (continuam como antes); TV vinculada daqui em diante começa SEM dias (pausada até a
--                         Nervia pôr os dias), para que desvincular e vincular de novo não gere dias de graça.
--   pausada = não isenta e (sem dias ou hoje > valida_ate + tolerância da conta).
--   Pôr N dias: se a TV está pausada (ou nunca teve dias), conta a partir de HOJE; senão continua do valida_ate
--   (os dias de tolerância já usados entram na conta). Tirar dias (N < 0) exige motivo.
--   mi_creditos = extrato SOMENTE INCLUSÃO (sem chave estrangeira: o extrato fica depois do desvínculo da TV).
--   "Trocar aparelho" (mi_tela_trocar_aparelho) passa a TV — nome, playlist, posição e dias — para um aparelho novo
--   pelo código da tela, sem perder os dias.
-- Colunas novas com padrão que mantém o comportamento atual das TVs existentes.

alter table public.mi_contas add column if not exists tolerancia_dias int not null default 3 check (tolerancia_dias between 0 and 60);
grant select (tolerancia_dias) on public.mi_contas to authenticated;  -- muda só pela mi_conta_tolerancia (com auditoria)

alter table public.mi_telas add column if not exists valida_ate date;
alter table public.mi_telas add column if not exists isenta boolean not null default false;
-- as TVs que já existem continuam funcionando como antes
update public.mi_telas set isenta = true where not isenta and valida_ate is null;
grant select (valida_ate, isenta) on public.mi_telas to authenticated;

create table if not exists public.mi_creditos (
  id         bigint generated always as identity primary key,
  lote       uuid not null,                    -- um registro de pagamento com várias TVs = o mesmo lote
  conta_id   uuid not null,
  conta_nome text not null default '',
  tela_id    uuid not null,
  tela_nome  text not null default '',
  tipo       text not null check (tipo in ('dias', 'isenta', 'cobrada', 'aparelho')),
  dias       int not null default 0,
  antes      date,
  depois     date,
  valor      numeric(12,2) check (valor is null or valor >= 0),   -- valor do lote inteiro (só no 1º registro do lote)
  obs        text not null default '',
  user_id    uuid,
  user_nome  text not null default '',
  criado_em  timestamptz not null default now()
);
create index if not exists mi_creditos_conta on public.mi_creditos (conta_id, criado_em desc);
create index if not exists mi_creditos_tela on public.mi_creditos (tela_id, criado_em desc);

create or replace function public.mi_creditos_imutavel() returns trigger language plpgsql as $$
begin raise exception 'O extrato de créditos não se altera nem se apaga.'; end $$;
drop trigger if exists mi_creditos_sem_alteracao on public.mi_creditos;
create trigger mi_creditos_sem_alteracao before update or delete on public.mi_creditos
  for each row execute function public.mi_creditos_imutavel();
drop trigger if exists mi_creditos_sem_truncate on public.mi_creditos;
create trigger mi_creditos_sem_truncate before truncate on public.mi_creditos
  for each statement execute function public.mi_creditos_imutavel();

alter table public.mi_creditos enable row level security;
revoke all on public.mi_creditos from anon, authenticated;   -- leitura só pela mi_creditos_extrato (valor só da equipe Nervia)

-- ---------------------------------------------------------------- situação de uma TV
create or replace function public.mi_hoje() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- último dia em que a TV pode passar (valida_ate + tolerância); null = isenta (sem limite)
create or replace function public.mi_liberada_ate(p_valida date, p_isenta boolean, p_tolerancia int) returns date
language sql immutable as $$
  select case when p_isenta then null
              when p_valida is null then date '2000-01-01'
              else p_valida + coalesce(p_tolerancia, 0) end
$$;

create or replace function public.mi_tela_pausada(p_tela uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not t.isenta and public.mi_hoje() > public.mi_liberada_ate(t.valida_ate, t.isenta, c.tolerancia_dias)
                     from public.mi_telas t join public.mi_contas c on c.id = t.conta_id where t.id = p_tela), true)
$$;
revoke execute on function public.mi_tela_pausada(uuid) from public, anon, authenticated;

-- para a TV (service role): pausada e o último dia em que pode passar sem falar com a Nervia
create or replace function public.mi_tv_liberacao(p_tela uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pausada', not t.isenta and public.mi_hoje() > public.mi_liberada_ate(t.valida_ate, t.isenta, c.tolerancia_dias),
                            'liberada_ate', public.mi_liberada_ate(t.valida_ate, t.isenta, c.tolerancia_dias))
    from public.mi_telas t join public.mi_contas c on c.id = t.conta_id where t.id = p_tela
$$;
revoke execute on function public.mi_tv_liberacao(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- equipe Nervia
-- Põe (ou tira) dias em uma ou várias TVs da MESMA conta, num lote só.
-- p = {telas:[uuid...], dias:int (−3650..3650, ≠ 0), valor?:numeric, obs?:text}
create or replace function public.mi_creditos_adicionar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_lote uuid := gen_random_uuid(); v_dias int; v_valor numeric; v_obs text := left(trim(coalesce(p->>'obs', '')), 300);
  v_ids uuid[]; v_conta uuid; t record; v_hoje date := public.mi_hoje(); v_base date; v_novo date; n int := 0; v_primeiro boolean := true;
  v_nome text; v_lista jsonb := '[]'::jsonb;
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia põe ou tira dias das TVs.'; end if;
  if coalesce(p->>'dias', '') !~ '^-?\d{1,4}$' then raise exception 'Informe o número de dias (por exemplo, 30).'; end if;
  v_dias := (p->>'dias')::int;
  if v_dias = 0 or v_dias not between -3650 and 3650 then raise exception 'O número de dias vai de 1 a 3650 (ou negativo, para tirar).'; end if;
  if v_dias < 0 and length(v_obs) < 5 then raise exception 'Para tirar dias, escreva o motivo.'; end if;
  if coalesce(p->>'valor', '') <> '' then
    if (p->>'valor') !~ '^\d{1,9}(\.\d{1,2})?$' then raise exception 'Valor inválido.'; end if;
    v_valor := (p->>'valor')::numeric;
  end if;
  select array_agg(distinct x::uuid) into v_ids from jsonb_array_elements_text(coalesce(p->'telas', '[]'::jsonb)) x;
  if v_ids is null or cardinality(v_ids) = 0 then raise exception 'Escolha pelo menos uma TV.'; end if;
  if (select count(distinct conta_id) from public.mi_telas where id = any (v_ids)) > 1 then
    raise exception 'Escolha TVs de um cliente só por vez.';
  end if;
  if (select count(*) from public.mi_telas where id = any (v_ids)) <> cardinality(v_ids) then raise exception 'TV não encontrada.'; end if;
  select nome into v_nome from public.perfis where user_id = auth.uid();
  for t in select tl.*, c.nome as conta_nome, c.tolerancia_dias from public.mi_telas tl join public.mi_contas c on c.id = tl.conta_id
            where tl.id = any (v_ids) order by tl.nome for update of tl loop
    v_conta := t.conta_id;
    if v_dias < 0 then
      if t.valida_ate is null then raise exception 'A TV "%" não tem dias para tirar.', t.nome; end if;
      v_novo := t.valida_ate + v_dias;
    else
      v_base := case when t.valida_ate is null or v_hoje > t.valida_ate + t.tolerancia_dias then v_hoje - 1 else t.valida_ate end;
      v_novo := v_base + v_dias;
    end if;
    update public.mi_telas set valida_ate = v_novo where id = t.id;
    insert into public.mi_creditos (lote, conta_id, conta_nome, tela_id, tela_nome, tipo, dias, antes, depois, valor, obs, user_id, user_nome)
    values (v_lote, t.conta_id, t.conta_nome, t.id, t.nome, 'dias', v_dias, t.valida_ate, v_novo,
            case when v_primeiro then v_valor end, v_obs, auth.uid(), coalesce(v_nome, ''));
    v_primeiro := false; n := n + 1;
    v_lista := v_lista || jsonb_build_object('tela', t.nome, 'tela_id', t.id, 'antes', t.valida_ate, 'depois', v_novo,
                                             'isenta', t.isenta);
  end loop;
  perform public.auditar(case when v_dias > 0 then 'midia_creditos_adicionados' else 'midia_creditos_retirados' end, null,
    jsonb_build_object('conta', (select nome from public.mi_contas where id = v_conta), 'conta_id', v_conta, 'lote', v_lote,
      'dias', v_dias, 'valor', v_valor, 'obs', v_obs, 'telas', v_lista));
  return jsonb_build_object('lote', v_lote, 'telas', n);
end $$;
revoke execute on function public.mi_creditos_adicionar(jsonb) from public, anon;

-- TV isenta (sem controle de créditos) ou cobrada; sempre com motivo
create or replace function public.mi_tela_isenta(p_tela uuid, p_isenta boolean, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare t record; v_nome text; m text := left(trim(coalesce(p_motivo, '')), 300);
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia muda a cobrança da TV.'; end if;
  if p_isenta is null then raise exception 'Informe se a TV fica isenta.'; end if;
  if length(m) < 5 then raise exception 'Escreva o motivo.'; end if;
  select tl.*, c.nome as conta_nome into t from public.mi_telas tl join public.mi_contas c on c.id = tl.conta_id where tl.id = p_tela for update of tl;
  if not found then raise exception 'TV não encontrada.'; end if;
  if t.isenta = p_isenta then return; end if;
  update public.mi_telas set isenta = p_isenta where id = p_tela;
  select nome into v_nome from public.perfis where user_id = auth.uid();
  insert into public.mi_creditos (lote, conta_id, conta_nome, tela_id, tela_nome, tipo, antes, depois, obs, user_id, user_nome)
  values (gen_random_uuid(), t.conta_id, t.conta_nome, t.id, t.nome, case when p_isenta then 'isenta' else 'cobrada' end,
          t.valida_ate, t.valida_ate, m, auth.uid(), coalesce(v_nome, ''));
  perform public.auditar(case when p_isenta then 'midia_tv_isenta' else 'midia_tv_cobrada' end, null,
    jsonb_build_object('conta', t.conta_nome, 'conta_id', t.conta_id, 'tela', t.nome, 'tela_id', t.id, 'motivo', m,
      'valida_ate', t.valida_ate));
end $$;
revoke execute on function public.mi_tela_isenta(uuid, boolean, text) from public, anon;

-- tolerância da conta (dias que a TV continua passando depois de acabar os créditos)
create or replace function public.mi_conta_tolerancia(p_conta uuid, p_dias int) returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia muda a tolerância.'; end if;
  if p_dias is null or p_dias not between 0 and 60 then raise exception 'A tolerância vai de 0 a 60 dias.'; end if;
  select * into c from public.mi_contas where id = p_conta for update;
  if not found then raise exception 'Conta não encontrada.'; end if;
  if c.tolerancia_dias = p_dias then return; end if;
  update public.mi_contas set tolerancia_dias = p_dias where id = p_conta;
  perform public.auditar('midia_tolerancia_alterada', null, jsonb_build_object('conta', c.nome, 'conta_id', p_conta,
    'antes', c.tolerancia_dias, 'depois', p_dias));
end $$;
revoke execute on function public.mi_conta_tolerancia(uuid, int) from public, anon;

-- extrato de créditos da conta (cliente e equipe Nervia; valor só para a equipe Nervia)
create or replace function public.mi_creditos_extrato(p_conta uuid) returns table (
  id bigint, lote uuid, tela_id uuid, tela_nome text, tipo text, dias int, antes date, depois date, valor numeric,
  obs text, user_nome text, criado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.lote, e.tela_id, e.tela_nome, e.tipo, e.dias, e.antes, e.depois,
         case when public.eh_admin() then e.valor end,
         e.obs, case when public.eh_admin() then e.user_nome else 'Nervia' end, e.criado_em
    from public.mi_creditos e
   where e.conta_id = p_conta and public.mi_pode_ver(p_conta)
   order by e.criado_em desc, e.id desc
   limit 500
$$;
revoke execute on function public.mi_creditos_extrato(uuid) from public, anon;

-- ---------------------------------------------------------------- trocar o aparelho da TV (mantém os dias)
create or replace function public.mi_tela_trocar_aparelho(p_tela uuid, p_codigo text) returns void
language plpgsql security definer set search_path = public as $$
declare t record; c record; cod text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g')); v_nome text;
begin
  select tl.*, ct.nome as conta_nome into t from public.mi_telas tl join public.mi_contas ct on ct.id = tl.conta_id where tl.id = p_tela for update of tl;
  if not found or not public.mi_pode_ver(t.conta_id) then raise exception 'TV não encontrada.'; end if;
  if cod !~ '^[A-Z0-9]{6}$' then raise exception 'O código tem 6 letras ou números. Confira o que aparece na TV nova.'; end if;
  select * into c from public.mi_codigos_vinculo where codigo = cod for update;
  if not found then raise exception 'Código não encontrado. Confira o que aparece na TV nova.'; end if;
  if c.tela_id is not null then raise exception 'Este código já foi usado. Aguarde a TV mostrar um código novo.'; end if;
  if c.expira_em < now() then raise exception 'Este código venceu (vale 10 minutos). A TV já mostra um código novo: digite o novo.'; end if;
  -- o aparelho antigo perde o token (volta para a tela do código); o novo recebe o token desta TV
  update public.mi_telas set aparelho = c.aparelho, token_hash = null, ultimo_sinal = null, versao_app = '', modelo = '', android = '',
      tocando = '', conteudo = '', espaco_livre_mb = null, baixando = 0, erros = '[]'::jsonb, tela_largura = null, tela_altura = null
   where id = p_tela;
  update public.mi_codigos_vinculo set tela_id = p_tela where codigo = cod;
  select nome into v_nome from public.perfis where user_id = auth.uid();
  insert into public.mi_creditos (lote, conta_id, conta_nome, tela_id, tela_nome, tipo, antes, depois, obs, user_id, user_nome)
  values (gen_random_uuid(), t.conta_id, t.conta_nome, t.id, t.nome, 'aparelho', t.valida_ate, t.valida_ate,
          left('aparelho trocado' || case when t.modelo <> '' then ' (antes: ' || t.modelo || ')' else '' end, 300), auth.uid(), coalesce(v_nome, ''));
  perform public.auditar('midia_aparelho_trocado', null, jsonb_build_object('conta', t.conta_nome, 'conta_id', t.conta_id,
    'tela', t.nome, 'tela_id', t.id, 'antes', t.modelo, 'valida_ate', t.valida_ate));
end $$;
revoke execute on function public.mi_tela_trocar_aparelho(uuid, text) from public, anon;
