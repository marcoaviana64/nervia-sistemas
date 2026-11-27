-- NVPlayer: liberação de uso (pedido do Marco em 27/11/2026: "uma forma de liberação de uso do app; o admin, depois de
-- confirmar o pagamento, libera no painel; o app verifica se está válido; no futuro cobrar por uso mensal/trimestral/
-- semanal/diário; deixar liberado sem pagamento para amigos; dias de teste para quem baixa").
--
-- Decisões do Marco (27/11/2026): liberação PELO PAINEL (sem digitar chave na TV — cada aparelho mostra um código curto
-- e a pessoa manda esse código para a Nervia); o app SÓ AVISA quando vence, NÃO bloqueia (gate de confiança); checagem
-- leve (a licença pega carona no resumo que o app já manda em nv_sinal, sem chamada nova). Campo "dias de teste" no
-- painel; teste automático para quem baixa; "liberado de graça" (isento) para amigos.
--
-- Nada bloqueia o uso: estas colunas só informam a situação. Aparelhos que já existiam entram ISENTOS (nada muda para
-- o Marco). Aparelho novo começa EM TESTE por nv_config.trial_dias dias. Tudo só a equipe Nervia (admin).

create table public.nv_config (
  id         int primary key default 1 check (id = 1),
  trial_dias int not null default 7 check (trial_dias between 0 and 365)   -- dias de teste de quem baixa o app
);
insert into public.nv_config (id) values (1) on conflict do nothing;
alter table public.nv_config enable row level security;
create policy nv_config_ler on public.nv_config for select using ((select public.eh_admin()));
revoke all on public.nv_config from anon, authenticated;
grant select on public.nv_config to authenticated;

alter table public.nv_aparelhos
  add column codigo     text,                               -- código curto que o app mostra (a pessoa manda à Nervia)
  add column valida_ate date,                               -- último dia liberado (Brasília); teste ou pago
  add column isento     boolean not null default false,     -- liberado sem pagamento (amigos): nunca vence
  add column em_teste   boolean not null default false;     -- está no período de teste

-- Aparelhos que já existem: liberados (isentos), para nada mudar para o Marco.
update public.nv_aparelhos set isento = true;

-- Código curto, alfabeto sem 0/O/1/I (como o vínculo do Mídia Indoor), único.
create or replace function public._nv_codigo()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_cod text;
  i int;
begin
  loop
    v_cod := '';
    for i in 1..5 loop v_cod := v_cod || substr(v_abc, 1 + floor(random() * length(v_abc))::int, 1); end loop;
    exit when not exists (select 1 from public.nv_aparelhos where codigo = v_cod);
  end loop;
  return v_cod;
end $$;

-- Extrato das liberações (SOMENTE INCLUSÃO; só a equipe Nervia lê). valor = quanto a pessoa pagou (opcional).
create table public.nv_licenca_hist (
  id          bigint generated always as identity primary key,
  aparelho_id uuid not null,
  em          timestamptz not null default now(),
  acao        text not null,                                 -- liberado | isento | cobrado
  dias        int,
  valida_ate  date,
  valor       numeric(10,2),
  obs         text,
  por_email   text
);
alter table public.nv_licenca_hist enable row level security;
create policy nv_licenca_hist_ler on public.nv_licenca_hist for select using ((select public.eh_admin()));
revoke all on public.nv_licenca_hist from anon, authenticated;
grant select on public.nv_licenca_hist to authenticated;
create or replace function public._nv_hist_imutavel() returns trigger language plpgsql as $$
begin raise exception 'nv_licenca_hist é somente inclusão.'; end $$;
create trigger nv_licenca_hist_imutavel before update or delete on public.nv_licenca_hist
  for each row execute function public._nv_hist_imutavel();

-- nv_sinal recriada igual à da migração 20261127000100 + cria o código/teste no 1º contato e devolve codigo + licenca.
-- p = {..., rede:{...}, ...}  →  resposta ganha 'codigo' e 'licenca':{isento, em_teste, valida_ate, vencida, dias}
create or replace function public.nv_sinal(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_ap public.nv_aparelhos;
  v_h jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  l jsonb := coalesce(p -> 'lista', '{}'::jsonb);
  a jsonb := p -> 'assistindo';
  r jsonb := coalesce(p -> 'rede', '{}'::jsonb);
  s jsonb;
  v_s int; v_dia date; v_tipo text; v_nome text;
  n int := 0;
  f_txt text;
  v_trial int;
begin
  if p is null or jsonb_typeof(p) <> 'object' or length(p::text) > 60000 then return jsonb_build_object('ok', false); end if;
  begin v_id := (p ->> 'id')::uuid; exception when others then return jsonb_build_object('ok', false); end;
  if v_id is null then return jsonb_build_object('ok', false); end if;

  select * into v_ap from public.nv_aparelhos where id = v_id for update;
  if found then
    -- no máximo 1 resumo a cada 20 s por aparelho; mesmo cedo, devolve a licença (o app só avisa, não bloqueia)
    if v_ap.ultimo_sinal > now() - interval '20 seconds' then
      return jsonb_build_object('ok', false, 'cedo', true, 'codigo', v_ap.codigo,
        'licenca', jsonb_build_object('isento', v_ap.isento, 'em_teste', v_ap.em_teste,
          'valida_ate', v_ap.valida_ate, 'vencida', (not v_ap.isento and (v_ap.valida_ate is null or v_hoje > v_ap.valida_ate)),
          'dias', case when v_ap.valida_ate is not null then v_ap.valida_ate - v_hoje end));
    end if;
  else
    -- trava contra lixo: no máximo 300 aparelhos
    if (select count(*) from public.nv_aparelhos) >= 300 then return jsonb_build_object('ok', false); end if;
    v_trial := coalesce((select trial_dias from public.nv_config where id = 1), 7);
    insert into public.nv_aparelhos (id, codigo, em_teste, valida_ate)
      values (v_id, public._nv_codigo(), v_trial > 0, case when v_trial > 0 then v_hoje - 1 + v_trial else v_hoje - 1 end);
  end if;

  update public.nv_aparelhos set
    modelo = left(p ->> 'modelo', 80),
    android = left(p ->> 'android', 20),
    versao_app = left(p ->> 'versao', 20),
    versao_codigo = case when (p ->> 'codigo') ~ '^\d{1,6}$' then (p ->> 'codigo')::int end,
    ip = left(coalesce(v_h ->> 'cf-connecting-ip', v_h ->> 'x-real-ip', nullif(trim(split_part(v_h ->> 'x-forwarded-for', ',', 1)), '')), 60),
    pais = left(v_h ->> 'cf-ipcountry', 4),
    lista_tipo = left(l ->> 'tipo', 10),
    lista_servidor = left(l ->> 'servidor', 120),
    lista_usuario = left(l ->> 'usuario', 60),
    lista_status = left(l ->> 'status', 30),
    lista_validade = case when (l ->> 'validade') ~ '^\d{10,14}$' then to_timestamp((l ->> 'validade')::bigint / 1000.0) end,
    lista_telas = left(l ->> 'telas', 10),
    lista_telas_uso = left(l ->> 'telas_uso', 10),
    canais = case when (l ->> 'canais') ~ '^\d{1,7}$' then (l ->> 'canais')::int end,
    filmes = case when (l ->> 'filmes') ~ '^\d{1,7}$' then (l ->> 'filmes')::int end,
    series = case when (l ->> 'series') ~ '^\d{1,7}$' then (l ->> 'series')::int end,
    assistindo = case when jsonb_typeof(a) = 'object' then left(a ->> 'nome', 120) end,
    assistindo_tipo = case when jsonb_typeof(a) = 'object' then left(a ->> 'tipo', 10) end,
    assistindo_grupo = case when jsonb_typeof(a) = 'object' then left(a ->> 'grupo', 80) end,
    assistindo_desde = case when jsonb_typeof(a) = 'object' and (a ->> 'desde') ~ '^\d{10,14}$'
                            then to_timestamp((a ->> 'desde')::bigint / 1000.0) end,
    rede_dns = left(r ->> 'dns', 30),
    rede_bloqueio = case when jsonb_typeof(r -> 'bloqueio') = 'boolean' then (r ->> 'bloqueio')::boolean end,
    rede_servidor_ip = left(r ->> 'ip', 60),
    problemas = coalesce((select jsonb_agg(left(x, 160)) from (
                   select jsonb_array_elements_text(p -> 'problemas') x limit 12) t
                 where jsonb_typeof(p -> 'problemas') = 'array'), problemas),
    ultimo_sinal = now(),
    sinais = sinais + 1
  where id = v_id
  returning * into v_ap;

  if jsonb_typeof(p -> 'sessoes') = 'array' then
    for s in select * from jsonb_array_elements(p -> 'sessoes') limit 300 loop
      begin
        v_dia := (s ->> 'dia')::date;
        v_s := (s ->> 's')::int;
      exception when others then continue;
      end;
      v_tipo := s ->> 'tipo';
      v_nome := left(trim(coalesce(s ->> 'nome', '')), 120);
      if v_tipo not in ('vivo', 'filme', 'serie') or v_nome = '' or v_s is null or v_s < 1 or v_s > 86400
         or v_dia is null or v_dia > v_hoje or v_dia < v_hoje - 7 then continue; end if;
      insert into public.nv_assistido as x (aparelho_id, dia, tipo, nome, grupo, segundos, vezes)
      values (v_id, v_dia, v_tipo, v_nome, left(coalesce(s ->> 'grupo', ''), 80), v_s,
              greatest(1, least(coalesce(case when (s ->> 'vezes') ~ '^\d{1,4}$' then (s ->> 'vezes')::int end, 1), 500)))
      on conflict (aparelho_id, dia, tipo, nome) do update
        set segundos = least(x.segundos + excluded.segundos, 86400), vezes = x.vezes + excluded.vezes, grupo = excluded.grupo;
      n := n + 1;
    end loop;
  end if;

  -- limpeza de vez em quando: histórico de mais de 1 ano
  if random() < 0.02 then delete from public.nv_assistido where dia < v_hoje - 366; end if;
  return jsonb_build_object('ok', true, 'gravados', n, 'codigo', v_ap.codigo,
    'licenca', jsonb_build_object('isento', v_ap.isento, 'em_teste', v_ap.em_teste,
      'valida_ate', v_ap.valida_ate, 'vencida', (not v_ap.isento and (v_ap.valida_ate is null or v_hoje > v_ap.valida_ate)),
      'dias', case when v_ap.valida_ate is not null then v_ap.valida_ate - v_hoje end));
end $$;
revoke execute on function public.nv_sinal(jsonb) from public;
grant execute on function public.nv_sinal(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- equipe Nervia
-- Libera o uso de 1 ou mais aparelhos. Depois de confirmar o pagamento: dias (1=diário, 7=semanal, 30=mensal,
-- 90=trimestral) OU uma data. Em teste/vencido conta de hoje; em dia continua do valida_ate. valor = opcional.
create or replace function public.nv_licenca_liberar(p_ids uuid[], p_dias int default null, p_ate date default null,
                                                     p_valor numeric default null, p_obs text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ap public.nv_aparelhos;
  v_base date; v_nova date;
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia.'; end if;
  if (p_dias is null) = (p_ate is null) then raise exception 'Informe os dias OU a data (um dos dois).'; end if;
  if p_dias is not null and (p_dias < 1 or p_dias > 3660) then raise exception 'Dias inválidos.'; end if;
  if p_ate is not null and p_ate < v_hoje then raise exception 'A data tem de ser de hoje em diante.'; end if;
  for v_ap in select * from public.nv_aparelhos where id = any(p_ids) for update loop
    if p_ate is not null then
      v_nova := p_ate;
    else
      -- em dia (não vencido e com validade futura) continua do valida_ate; senão conta de hoje
      v_base := case when v_ap.valida_ate is not null and v_ap.valida_ate >= v_hoje then v_ap.valida_ate else v_hoje - 1 end;
      v_nova := v_base + p_dias;
    end if;
    update public.nv_aparelhos set valida_ate = v_nova, em_teste = false, isento = false where id = v_ap.id;
    insert into public.nv_licenca_hist (aparelho_id, acao, dias, valida_ate, valor, obs, por_email)
      values (v_ap.id, 'liberado', p_dias, v_nova, p_valor, left(trim(coalesce(p_obs, '')), 300), nullif(current_setting('request.jwt.claim.email', true), ''));
    perform public.auditar('nvplayer_licenca_liberada', null, jsonb_build_object(
      'aparelho', v_ap.id, 'codigo', v_ap.codigo, 'dias', p_dias, 'ate', v_nova, 'valor', p_valor, 'obs', left(trim(coalesce(p_obs, '')), 300)));
  end loop;
end $$;

-- Liberado sem pagamento (amigos) ou volta a cobrar.
create or replace function public.nv_licenca_isento(p_id uuid, p_isento boolean, p_motivo text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_ap public.nv_aparelhos;
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia.'; end if;
  select * into v_ap from public.nv_aparelhos where id = p_id for update;
  if not found then raise exception 'Aparelho não encontrado.'; end if;
  update public.nv_aparelhos set isento = coalesce(p_isento, false), em_teste = case when p_isento then false else em_teste end where id = p_id;
  insert into public.nv_licenca_hist (aparelho_id, acao, obs, por_email)
    values (p_id, case when p_isento then 'isento' else 'cobrado' end, left(trim(coalesce(p_motivo, '')), 300), nullif(current_setting('request.jwt.claim.email', true), ''));
  perform public.auditar(case when p_isento then 'nvplayer_licenca_isento' else 'nvplayer_licenca_cobrado' end, null,
    jsonb_build_object('aparelho', p_id, 'codigo', v_ap.codigo, 'motivo', left(trim(coalesce(p_motivo, '')), 300)));
end $$;

create or replace function public.nv_config_salvar(p_trial int)
returns void language plpgsql security definer set search_path = public as $$
declare v_antes int;
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia.'; end if;
  if p_trial is null or p_trial < 0 or p_trial > 365 then raise exception 'Dias de teste inválidos (0 a 365).'; end if;
  select trial_dias into v_antes from public.nv_config where id = 1;
  update public.nv_config set trial_dias = p_trial where id = 1;
  perform public.auditar('nvplayer_config_alterada', null, jsonb_build_object('trial_dias_antes', v_antes, 'trial_dias', p_trial));
end $$;

revoke execute on function public.nv_licenca_liberar(uuid[], int, date, numeric, text),
  public.nv_licenca_isento(uuid, boolean, text), public.nv_config_salvar(int) from public, anon;
grant execute on function public.nv_licenca_liberar(uuid[], int, date, numeric, text),
  public.nv_licenca_isento(uuid, boolean, text), public.nv_config_salvar(int) to authenticated;
