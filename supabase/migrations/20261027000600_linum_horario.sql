-- Sistema Linum 2.9: horário de trabalho (pedido do Marco em 27/10/2026: "como o sistema é web e pode ser acessado de
-- qualquer local, não queria as vendedoras acessando fora da loja. De início vamos fazer por horário: cada vendedor tem um
-- horário de trabalho e neste período pode abrir o sistema").
--   * lin_membros.horario = {"1": {"ini": "10:00", "fim": "19:00"}, ...} por dia da semana (1 = segunda … 7 = domingo,
--     isodow); dia ausente = folga (sem acesso). NULL = sem restrição (como antes) — vale até alguém definir o horário.
--   * Folga de 15 minutos antes e depois (para abrir a loja e terminar a venda em andamento).
--   * lin_membros.horario_extra_ate = liberação pontual (hora extra, inventário, evento), até o dia e hora escolhidos.
--   * A trava é no banco: lin_papel() devolve NULL fora do horário, então as policies e todas as funções do app recusam
--     (ler e gravar). O Dono (e a equipe Nervia) não tem restrição.
--   * Fuso de Brasília (America/Sao_Paulo); feriados não entram na conta.
--   * Quem define: o Dono e a equipe Nervia (lin_horario_salvar), auditoria linum_horario_alterado (antes/depois).
--     Tentativa de abrir fora do horário vai para a auditoria (linum_fora_do_horario, no máximo uma a cada 30 min por
--     login), com o IP.

alter table public.lin_membros add column if not exists horario jsonb;
alter table public.lin_membros add column if not exists horario_extra_ate timestamptz;

-- está no horário? (função pura, para testar com qualquer momento); entrada antes de 00:15 = desde a meia-noite
create or replace function public._lin_no_horario_em(p_horario jsonb, p_extra timestamptz, p_momento timestamptz) returns boolean
language sql stable as $$
  select p_horario is null
      or (p_extra is not null and p_momento <= p_extra)
      or exists (
        select 1 from (select (p_momento at time zone 'America/Sao_Paulo') as t) x,
               lateral (select p_horario -> extract(isodow from x.t)::int::text as d) dia
         where dia.d is not null
           and x.t::time - time '00:00' >= greatest((dia.d ->> 'ini')::time - time '00:00' - interval '15 minutes', interval '0')
           and x.t::time - time '00:00' <= (dia.d ->> 'fim')::time - time '00:00' + interval '15 minutes')
$$;

-- papel do login: admin Nervia = dono; senão o de lin_membros, com o app liberado e (fora o Dono) dentro do horário
create or replace function public.lin_papel() returns text
language sql stable security definer set search_path = public as $$
  select case when public.eh_admin() then 'dono'
    else (select m.papel from public.lin_membros m
          where m.user_id = auth.uid()
            and exists (select 1 from public.app_acessos a where a.user_id = m.user_id and a.app_id = 'linum')
            and (m.papel = 'dono' or public._lin_no_horario_em(m.horario, m.horario_extra_ate, now()))) end
$$;

-- a tela pergunta antes de abrir: dentro do horário? qual é o horário? (funciona mesmo fora do horário)
create or replace function public.lin_meu_horario() returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.lin_membros; v_no boolean; v_orig jsonb;
begin
  if public.eh_admin() then return jsonb_build_object('liberado', true, 'restrito', false); end if;
  select * into m from public.lin_membros where user_id = auth.uid();
  if m.user_id is null or not exists (select 1 from public.app_acessos a where a.user_id = m.user_id and a.app_id = 'linum') then
    return jsonb_build_object('liberado', false, 'restrito', false, 'sem_papel', true);
  end if;
  v_no := m.papel = 'dono' or public._lin_no_horario_em(m.horario, m.horario_extra_ate, now());
  if not v_no and not exists (select 1 from public.auditoria where user_id = auth.uid() and acao = 'linum_fora_do_horario'
                                                         and quando > now() - interval '30 minutes') then
    select jsonb_build_object('ip', coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', nullif(trim(split_part(h ->> 'x-forwarded-for', ',', 1)), '')),
                              'navegador', left(h ->> 'user-agent', 300))
      into v_orig from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb as h) x;
    insert into public.auditoria (user_id, email, nome, papel, acao, cnpj, detalhes, ip, navegador)
    select auth.uid(), p.email, p.nome, 'cliente', 'linum_fora_do_horario', null,
           jsonb_build_object('papel_linum', m.papel, 'momento', to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), 'horario', m.horario),
           v_orig ->> 'ip', v_orig ->> 'navegador'
      from public.perfis p where p.user_id = auth.uid();
  end if;
  return jsonb_build_object('liberado', v_no, 'restrito', m.papel <> 'dono' and m.horario is not null,
    'horario', case when m.papel = 'dono' then null else m.horario end,
    'extra_ate', case when m.horario_extra_ate > now() then m.horario_extra_ate end);
end $$;

-- p_horario: NULL = sem restrição; {} = nenhum dia; p_extra_ate: NULL = sem liberação extra
create or replace function public.lin_horario_salvar(p_user uuid, p_horario jsonb, p_extra_ate timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare m public.lin_membros; k text; d jsonb;
begin
  if not public.lin_eh_dono() then raise exception 'Só o Dono define o horário da equipe'; end if;
  select * into m from public.lin_membros where user_id = p_user for update;
  if m.user_id is null then raise exception 'Este login não está na equipe da Linum'; end if;
  if m.papel = 'dono' then raise exception 'O Dono não tem restrição de horário'; end if;
  if p_horario is not null then
    if jsonb_typeof(p_horario) <> 'object' then raise exception 'Horário inválido'; end if;
    for k, d in select * from jsonb_each(p_horario) loop
      if k not in ('1', '2', '3', '4', '5', '6', '7') then raise exception 'Dia da semana inválido'; end if;
      if (d ->> 'ini') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (d ->> 'fim') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'Hora inválida (use HH:MM)'; end if;
      if (d ->> 'ini')::time >= (d ->> 'fim')::time then
        raise exception '%: a entrada tem de ser antes da saída', (array['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'])[k::int]; end if;
    end loop;
    select jsonb_object_agg(key, jsonb_build_object('ini', value ->> 'ini', 'fim', value ->> 'fim')) into p_horario from jsonb_each(p_horario);
    p_horario := coalesce(p_horario, '{}');
  end if;
  if p_extra_ate is not null and p_extra_ate > now() + interval '31 days' then raise exception 'A liberação extra vai no máximo até 31 dias'; end if;
  if p_extra_ate is not null and p_extra_ate <= now() then p_extra_ate := null; end if;
  if m.horario is not distinct from p_horario and m.horario_extra_ate is not distinct from p_extra_ate then return; end if;
  update public.lin_membros set horario = p_horario, horario_extra_ate = p_extra_ate where user_id = p_user;
  perform public.auditar('linum_horario_alterado', null, jsonb_build_object(
    'login', (select email from public.perfis where user_id = p_user), 'login_id', p_user, 'papel_linum', m.papel,
    'antes', jsonb_build_object('horario', m.horario, 'extra_ate', m.horario_extra_ate),
    'depois', jsonb_build_object('horario', p_horario, 'extra_ate', p_extra_ate)));
end $$;

-- a mudança de horário tem auditoria própria: o gatilho do papel só dispara quando muda papel, loja, comissão ou permissões
drop trigger if exists lin_membros_auditoria on public.lin_membros;
create trigger lin_membros_auditoria after insert or delete or update of papel, loja_id, comissao_pct, permissoes on public.lin_membros
  for each row execute function public.lin_membros_auditoria();

-- equipe com horário, para o Dono (sem e-mail de quem não é da equipe, sem comissão nem permissões)
create or replace function public.lin_horarios() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.lin_eh_dono() then raise exception 'Só o Dono define o horário da equipe'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nome', coalesce(nullif(trim(p.nome), ''), p.email), 'papel', m.papel,
             'loja_id', m.loja_id, 'horario', m.horario, 'extra_ate', case when m.horario_extra_ate > now() then m.horario_extra_ate end,
             'agora', m.papel = 'dono' or public._lin_no_horario_em(m.horario, m.horario_extra_ate, now()))
           order by m.papel = 'dono', coalesce(nullif(trim(p.nome), ''), p.email))
      from public.lin_membros m join public.perfis p on p.user_id = m.user_id
     where exists (select 1 from public.app_acessos a where a.user_id = m.user_id and a.app_id = 'linum')), '[]');
end $$;

do $$ declare f text; begin
  foreach f in array array['lin_meu_horario()', 'lin_horario_salvar(uuid, jsonb, timestamptz)', 'lin_horarios()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke execute on function public._lin_no_horario_em(jsonb, timestamptz, timestamptz) from public, anon;
  grant execute on function public._lin_no_horario_em(jsonb, timestamptz, timestamptz) to authenticated;
end $$;
