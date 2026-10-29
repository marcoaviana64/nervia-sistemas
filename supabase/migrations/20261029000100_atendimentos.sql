-- App "Atendimentos" (prefixo atd_): a Central de atendimentos de TI da Nervia (chamados, andamentos, equipamentos e
-- empreendimentos atendidos), trazida do artifact "Nervia Atendimentos" para a Plataforma (pedido do Marco em 29/10/2026).
--
-- Decisões do Marco (29/10/2026):
--   * a equipe Nervia (admin) faz tudo; o login do cliente, liberado por empreendimento (atd_acessos), só LÊ os chamados e
--     equipamentos daquele empreendimento e baixa a ficha em PDF;
--   * andamento continua podendo ser corrigido ou excluído, como na Central, mas toda mudança vai para a auditoria com o
--     antes e o depois;
--   * a carga dos dados da Central é feita na noite do merge (fora desta migração), com conferência.
--
-- Regras trazidas da Central:
--   * o chamado só fecha quando TODOS os andamentos estão fechados; a data de fechamento é a do último andamento
--     (gatilho atd_recalcular_status — a tela não grava status nem fechamento);
--   * número do chamado sequencial (continua o da Central);
--   * código do equipamento = prefixo do tipo + código do empreendimento + 4 dígitos (NBR2P0001), gerado no servidor;
--     item (monitor, mouse, memória…) pode ficar instalado em um equipamento e usa o usuário dele;
--   * cada equipamento tem histórico (cadastro, troca de usuário, situação, setor, instalado/removido), gerado no servidor.
--
-- Carga: com "set local atd.carga = 'sim'" os gatilhos de auditoria e de histórico ficam quietos (a carga grava um
-- registro só, atendimentos_carga, e traz o histórico dos equipamentos como estava).

create table if not exists public.atd_empreendimentos (
  sigla      text primary key check (sigla ~ '^[A-Za-z0-9_-]{1,12}$'),
  nome       text not null check (length(trim(nome)) > 0),
  cod_equip  text not null unique check (cod_equip ~ '^[A-Z0-9]{2,4}$'),   -- entra no código dos equipamentos
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);
create unique index if not exists atd_empreendimentos_sigla_ci on public.atd_empreendimentos (lower(sigla));

create table if not exists public.atd_acessos (
  user_id uuid references auth.users on delete cascade,
  sigla   text references public.atd_empreendimentos on delete cascade on update cascade,
  primary key (user_id, sigla)
);

create sequence if not exists public.atd_chamados_numero_seq;
create table if not exists public.atd_chamados (
  numero        int primary key default nextval('public.atd_chamados_numero_seq'),
  sigla         text not null references public.atd_empreendimentos on update cascade,
  abertura      date not null,
  resumo        text not null default '',
  descricao     text not null check (length(trim(descricao)) > 0),
  tipo          text not null default '',
  solicitante   text not null default '',
  categoria     text not null default '',      -- veio do sistema anterior (Lovable); a tela só mostra
  origem        text not null default '',      -- idem ('lovable' = chamado do sistema anterior)
  status        text not null default 'Aberto' check (status in ('Aberto', 'Fechado')),   -- só o gatilho grava
  fechamento    date,                                                                     -- só o gatilho grava
  criado_em     timestamptz not null default now(),
  criado_por    uuid default auth.uid(),
  atualizado_em timestamptz
);
alter sequence public.atd_chamados_numero_seq owned by public.atd_chamados.numero;
create index if not exists atd_chamados_sigla on public.atd_chamados (sigla, abertura desc);

create table if not exists public.atd_andamentos (
  id          bigint generated always as identity primary key,
  numero      int not null references public.atd_chamados on delete cascade,
  data        date not null,
  fechado     boolean not null default true,
  texto       text not null check (length(trim(texto)) > 0),
  criado_em   timestamptz not null default now(),
  criado_por  uuid default auth.uid(),
  alterado_em timestamptz
);
create index if not exists atd_andamentos_numero on public.atd_andamentos (numero, data, id);

create table if not exists public.atd_equipamentos (
  codigo      text primary key,
  sigla       text not null references public.atd_empreendimentos on update cascade,
  prefixo     text not null check (prefixo in ('NB', 'DT', 'IM', 'NBK', 'RT', 'MN', 'MS', 'TC', 'HD', 'MM', 'FT', 'OU')),
  seq         int not null,
  tipo        text not null default '',          -- nome do tipo (Notebook, Monitor…), preenchido pelo gatilho
  marca       text not null default '',
  modelo      text not null default '',
  serie       text not null default '',
  setor       text not null default '',
  situacao    text not null default 'Em uso' check (situacao in ('Em uso', 'Reserva', 'Manutenção', 'Baixado')),
  usuario     text not null default '',
  vinculado_a text references public.atd_equipamentos on update cascade,   -- item instalado neste equipamento
  obs         text not null default '',
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz,
  unique (sigla, prefixo, seq),
  check (vinculado_a is distinct from codigo)
);

-- histórico de cada equipamento: SOMENTE INCLUSÃO, escrito pelos gatilhos
create table if not exists public.atd_equip_historico (
  id        bigint generated always as identity primary key,
  codigo    text not null references public.atd_equipamentos on delete cascade on update cascade,
  data      date not null,
  evento    text not null,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid()
);
create index if not exists atd_equip_historico_codigo on public.atd_equip_historico (codigo, id);

-- equipamentos ligados a cada chamado
create table if not exists public.atd_chamado_equip (
  numero int  references public.atd_chamados on delete cascade,
  codigo text references public.atd_equipamentos on update cascade,
  primary key (numero, codigo)
);

-- ---------------------------------------------------------------- ajudantes
create or replace function public._atd_hoje() returns date
language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

create or replace function public._atd_carga() returns boolean
language sql stable as $$ select coalesce(current_setting('atd.carga', true), '') = 'sim' $$;

create or replace function public._atd_tipo_nome(p text) returns text
language sql immutable as $$
  select case p when 'NB' then 'Notebook' when 'DT' then 'Desktop' when 'IM' then 'Impressora' when 'NBK' then 'Nobreak'
    when 'RT' then 'Roteador/AP' when 'MN' then 'Monitor' when 'MS' then 'Mouse' when 'TC' then 'Teclado' when 'HD' then 'HD/SSD'
    when 'MM' then 'Memória' when 'FT' then 'Fonte/carregador' else 'Outros' end
$$;

-- auditoria com só os campos que mudaram (mesma ideia do _lin_auditar); sem mudança, não registra
create or replace function public._atd_auditar(p_acao text, p_det jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a jsonb := p_det -> 'antes'; d jsonb := p_det -> 'depois'; na jsonb := '{}'; nd jsonb := '{}'; k text;
begin
  if public._atd_carga() then return; end if;
  if jsonb_typeof(a) = 'object' and jsonb_typeof(d) = 'object' then
    for k in select jsonb_object_keys(a || d) loop
      if (a -> k) is distinct from (d -> k) then
        na := na || jsonb_build_object(k, coalesce(a -> k, 'null'::jsonb));
        nd := nd || jsonb_build_object(k, coalesce(d -> k, 'null'::jsonb));
      end if;
    end loop;
    if na = '{}' then return; end if;
    p_det := p_det || jsonb_build_object('antes', na, 'depois', nd);
  end if;
  perform public.auditar(p_acao, null, coalesce(p_det, '{}'::jsonb));
end $$;
revoke execute on function public._atd_auditar(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- acesso
create or replace function public.atd_pode_ver(p_sigla text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or exists (select 1 from public.atd_acessos where sigla = p_sigla and user_id = auth.uid())
$$;
revoke execute on function public.atd_pode_ver(text) from public, anon;
grant execute on function public.atd_pode_ver(text) to authenticated;

alter table public.atd_empreendimentos enable row level security;
alter table public.atd_acessos enable row level security;
alter table public.atd_chamados enable row level security;
alter table public.atd_andamentos enable row level security;
alter table public.atd_equipamentos enable row level security;
alter table public.atd_equip_historico enable row level security;
alter table public.atd_chamado_equip enable row level security;

revoke all on public.atd_empreendimentos, public.atd_acessos, public.atd_chamados, public.atd_andamentos,
  public.atd_equipamentos, public.atd_equip_historico, public.atd_chamado_equip from anon;
revoke all on sequence public.atd_chamados_numero_seq from anon;
-- status, fechamento, autor e datas são do servidor
revoke insert, update on public.atd_chamados from authenticated;
grant insert (sigla, abertura, resumo, descricao, tipo, solicitante) on public.atd_chamados to authenticated;
grant update (sigla, abertura, resumo, descricao, tipo, solicitante) on public.atd_chamados to authenticated;
grant usage on sequence public.atd_chamados_numero_seq to authenticated;
revoke insert, update on public.atd_andamentos from authenticated;
grant insert (numero, data, fechado, texto) on public.atd_andamentos to authenticated;
grant update (data, fechado, texto) on public.atd_andamentos to authenticated;
-- código, sequência e tipo do equipamento são do servidor; o equipamento não se apaga (vira Baixado)
revoke insert, update, delete on public.atd_equipamentos from authenticated;
grant insert (sigla, prefixo, marca, modelo, serie, setor, situacao, usuario, vinculado_a, obs) on public.atd_equipamentos to authenticated;
grant update (marca, modelo, serie, setor, situacao, usuario, vinculado_a, obs) on public.atd_equipamentos to authenticated;
revoke insert, update, delete on public.atd_equip_historico from authenticated;
revoke update on public.atd_chamado_equip from authenticated;
-- empreendimento não se apaga (tem chamados); a sigla não muda
revoke update, delete on public.atd_empreendimentos from authenticated;
grant update (nome, cod_equip, ativo) on public.atd_empreendimentos to authenticated;

drop policy if exists atd_emp_ler on public.atd_empreendimentos;
create policy atd_emp_ler on public.atd_empreendimentos for select using (public.atd_pode_ver(sigla));
drop policy if exists atd_emp_admin on public.atd_empreendimentos;
create policy atd_emp_admin on public.atd_empreendimentos for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists atd_acessos_ler on public.atd_acessos;
create policy atd_acessos_ler on public.atd_acessos for select using (user_id = auth.uid() or public.eh_admin());
drop policy if exists atd_acessos_admin on public.atd_acessos;
create policy atd_acessos_admin on public.atd_acessos for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists atd_chamados_ler on public.atd_chamados;
create policy atd_chamados_ler on public.atd_chamados for select using (public.atd_pode_ver(sigla));
drop policy if exists atd_chamados_admin on public.atd_chamados;
create policy atd_chamados_admin on public.atd_chamados for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists atd_andamentos_ler on public.atd_andamentos;
create policy atd_andamentos_ler on public.atd_andamentos for select
  using (exists (select 1 from public.atd_chamados c where c.numero = atd_andamentos.numero and public.atd_pode_ver(c.sigla)));
drop policy if exists atd_andamentos_admin on public.atd_andamentos;
create policy atd_andamentos_admin on public.atd_andamentos for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists atd_equip_ler on public.atd_equipamentos;
create policy atd_equip_ler on public.atd_equipamentos for select using (public.atd_pode_ver(sigla));
drop policy if exists atd_equip_admin on public.atd_equipamentos;
create policy atd_equip_admin on public.atd_equipamentos for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists atd_equip_hist_ler on public.atd_equip_historico;
create policy atd_equip_hist_ler on public.atd_equip_historico for select
  using (exists (select 1 from public.atd_equipamentos e where e.codigo = atd_equip_historico.codigo and public.atd_pode_ver(e.sigla)));

drop policy if exists atd_ch_equip_ler on public.atd_chamado_equip;
create policy atd_ch_equip_ler on public.atd_chamado_equip for select
  using (exists (select 1 from public.atd_chamados c where c.numero = atd_chamado_equip.numero and public.atd_pode_ver(c.sigla)));
drop policy if exists atd_ch_equip_admin on public.atd_chamado_equip;
create policy atd_ch_equip_admin on public.atd_chamado_equip for all using (public.eh_admin()) with check (public.eh_admin());

-- ---------------------------------------------------------------- status do chamado (regra da Central)
create or replace function public.atd_recalcular_status(p_numero int) returns void
language plpgsql security definer set search_path = public as $$
declare v_n int; v_abertos int; v_ult date;
begin
  select count(*), count(*) filter (where not fechado), max(data) into v_n, v_abertos, v_ult
    from public.atd_andamentos where numero = p_numero;
  update public.atd_chamados
     set status = case when v_n > 0 and v_abertos = 0 then 'Fechado' else 'Aberto' end,
         fechamento = case when v_n > 0 and v_abertos = 0 then v_ult end
   where numero = p_numero;
end $$;
revoke execute on function public.atd_recalcular_status(int) from public, anon, authenticated;

create or replace function public.atd_andamentos_gatilho() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old); v_st text;
begin
  if tg_op = 'UPDATE' and new.numero <> old.numero then raise exception 'O andamento não muda de chamado.'; end if;
  perform public.atd_recalcular_status(r.numero);
  select status into v_st from public.atd_chamados where numero = r.numero;
  if tg_op = 'INSERT' then
    perform public._atd_auditar('atendimento_andamento_registrado', jsonb_build_object('chamado', r.numero, 'andamento_id', r.id,
      'data', r.data, 'fechado', r.fechado, 'texto', r.texto, 'situacao_chamado', v_st));
  elsif tg_op = 'UPDATE' then
    perform public._atd_auditar('atendimento_andamento_alterado', jsonb_build_object('chamado', r.numero, 'andamento_id', r.id,
      'situacao_chamado', v_st,
      'antes', jsonb_build_object('data', old.data, 'fechado', old.fechado, 'texto', old.texto),
      'depois', jsonb_build_object('data', new.data, 'fechado', new.fechado, 'texto', new.texto)));
  else
    perform public._atd_auditar('atendimento_andamento_excluido', jsonb_build_object('chamado', r.numero, 'andamento_id', r.id,
      'data', r.data, 'fechado', r.fechado, 'texto', r.texto, 'situacao_chamado', v_st));
  end if;
  return r;
end $$;
drop trigger if exists atd_andamentos_status on public.atd_andamentos;
create trigger atd_andamentos_status after insert or update or delete on public.atd_andamentos
  for each row execute function public.atd_andamentos_gatilho();

create or replace function public.atd_andamentos_antes() returns trigger
language plpgsql as $$
begin
  new.texto := trim(new.texto);
  if tg_op = 'UPDATE' then
    if new.data is not distinct from old.data and new.fechado = old.fechado and new.texto = old.texto then return new; end if;
    new.alterado_em := now();
  end if;
  return new;
end $$;
drop trigger if exists atd_andamentos_antes on public.atd_andamentos;
create trigger atd_andamentos_antes before insert or update on public.atd_andamentos
  for each row execute function public.atd_andamentos_antes();

-- ---------------------------------------------------------------- chamado: auditoria
create or replace function public.atd_chamados_gatilho() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public._atd_auditar('atendimento_chamado_aberto', jsonb_build_object('chamado', new.numero, 'empreendimento', new.sigla,
      'abertura', new.abertura, 'resumo', new.resumo, 'tipo', new.tipo, 'solicitante', new.solicitante));
  elsif tg_op = 'UPDATE' then
    -- status/fechamento mudam pelo andamento (já auditado lá)
    perform public._atd_auditar('atendimento_chamado_alterado', jsonb_build_object('chamado', new.numero, 'resumo', new.resumo,
      'antes', jsonb_build_object('empreendimento', old.sigla, 'abertura', old.abertura, 'resumo', old.resumo, 'descricao', old.descricao,
                                  'tipo', old.tipo, 'solicitante', old.solicitante),
      'depois', jsonb_build_object('empreendimento', new.sigla, 'abertura', new.abertura, 'resumo', new.resumo, 'descricao', new.descricao,
                                   'tipo', new.tipo, 'solicitante', new.solicitante)));
  else
    perform public._atd_auditar('atendimento_chamado_excluido', jsonb_build_object('chamado', old.numero, 'empreendimento', old.sigla,
      'abertura', old.abertura, 'resumo', old.resumo, 'descricao', old.descricao));
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists atd_chamados_auditoria on public.atd_chamados;
create trigger atd_chamados_auditoria after insert or update or delete on public.atd_chamados
  for each row execute function public.atd_chamados_gatilho();

create or replace function public.atd_chamados_antes() returns trigger
language plpgsql as $$
begin
  new.resumo := trim(new.resumo); new.descricao := trim(new.descricao); new.tipo := trim(new.tipo); new.solicitante := trim(new.solicitante);
  if tg_op = 'UPDATE' and (new.sigla, new.abertura, new.resumo, new.descricao, new.tipo, new.solicitante)
                          is distinct from (old.sigla, old.abertura, old.resumo, old.descricao, old.tipo, old.solicitante) then
    if new.sigla <> old.sigla and exists (select 1 from public.atd_chamado_equip where numero = new.numero) then
      raise exception 'Desvincule os equipamentos antes de trocar o empreendimento do chamado.';
    end if;
    new.atualizado_em := now();
  end if;
  return new;
end $$;
drop trigger if exists atd_chamados_antes on public.atd_chamados;
create trigger atd_chamados_antes before insert or update on public.atd_chamados
  for each row execute function public.atd_chamados_antes();

-- equipamento ligado ao chamado: precisa ser do mesmo empreendimento
create or replace function public.atd_chamado_equip_gatilho() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  if tg_op = 'INSERT' and (select sigla from public.atd_chamados where numero = new.numero)
                          is distinct from (select sigla from public.atd_equipamentos where codigo = new.codigo) then
    raise exception 'O equipamento % não é do empreendimento do chamado.', new.codigo;
  end if;
  perform public._atd_auditar(case when tg_op = 'INSERT' then 'atendimento_equipamento_vinculado' else 'atendimento_equipamento_desvinculado' end,
    jsonb_build_object('chamado', r.numero, 'equipamento', r.codigo));
  return r;
end $$;
drop trigger if exists atd_chamado_equip_gatilho on public.atd_chamado_equip;
create trigger atd_chamado_equip_gatilho before insert or delete on public.atd_chamado_equip
  for each row execute function public.atd_chamado_equip_gatilho();

-- ---------------------------------------------------------------- equipamentos: código, regras e histórico
create or replace function public.atd_equip_antes() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pai record; v_cod text;
begin
  new.marca := trim(new.marca); new.modelo := trim(new.modelo); new.serie := trim(new.serie); new.setor := trim(new.setor);
  new.usuario := trim(new.usuario); new.obs := trim(new.obs); new.vinculado_a := nullif(trim(coalesce(new.vinculado_a, '')), '');
  if tg_op = 'INSERT' then
    new.tipo := public._atd_tipo_nome(new.prefixo);
    if not public._atd_carga() or new.codigo is null then
      perform pg_advisory_xact_lock(hashtext('atd_equip:' || new.sigla || ':' || new.prefixo));
      select cod_equip into v_cod from public.atd_empreendimentos where sigla = new.sigla;
      if v_cod is null then raise exception 'Empreendimento % não encontrado.', new.sigla; end if;
      select coalesce(max(seq), 0) + 1 into new.seq from public.atd_equipamentos where sigla = new.sigla and prefixo = new.prefixo;
      new.codigo := new.prefixo || v_cod || lpad(new.seq::text, 4, '0');
    end if;
  else
    if new.sigla <> old.sigla or new.prefixo <> old.prefixo then raise exception 'Empreendimento e tipo do equipamento não mudam.'; end if;
    if (new.marca, new.modelo, new.serie, new.setor, new.situacao, new.usuario, new.vinculado_a, new.obs)
       is not distinct from (old.marca, old.modelo, old.serie, old.setor, old.situacao, old.usuario, old.vinculado_a, old.obs) then
      return new;
    end if;
    new.atualizado_em := now();
  end if;
  if new.vinculado_a is not null then
    select * into v_pai from public.atd_equipamentos where codigo = new.vinculado_a;
    if not found then raise exception 'Equipamento % não encontrado.', new.vinculado_a; end if;
    if v_pai.sigla <> new.sigla then raise exception 'O equipamento % é de outro empreendimento.', new.vinculado_a; end if;
    if v_pai.vinculado_a is not null then raise exception '% já está instalado em outro equipamento; escolha um equipamento principal.', new.vinculado_a; end if;
    if tg_op = 'UPDATE' and exists (select 1 from public.atd_equipamentos where vinculado_a = new.codigo) then
      raise exception 'Este equipamento tem itens instalados, por isso não pode ser instalado em outro.';
    end if;
    new.usuario := '';   -- o item usa o usuário do equipamento
  end if;
  return new;
end $$;
drop trigger if exists atd_equip_antes on public.atd_equipamentos;
create trigger atd_equip_antes before insert or update on public.atd_equipamentos
  for each row execute function public.atd_equip_antes();

-- data do histórico: hoje em Brasília, ou a "Data da alteração" informada na tela (rpc atd_equip_alterar, que a põe em
-- atd.data só durante a transação)
create or replace function public._atd_hist(p_codigo text, p_evento text) returns void
language plpgsql security definer set search_path = public as $$
declare v_data date := coalesce(nullif(current_setting('atd.data', true), '')::date, public._atd_hoje());
begin
  insert into public.atd_equip_historico (codigo, data, evento) values (p_codigo, v_data, p_evento);
end $$;
revoke execute on function public._atd_hist(text, text) from public, anon, authenticated;

create or replace function public.atd_equip_depois() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text[] := '{}';
begin
  if public._atd_carga() then return new; end if;
  if tg_op = 'INSERT' then
    ev := array['Cadastrado'];
    if new.vinculado_a is not null then ev := ev || ('instalado em ' || new.vinculado_a);
    elsif new.usuario <> '' then ev := ev || ('usuário ' || new.usuario); end if;
    perform public._atd_hist(new.codigo, array_to_string(ev, ' · '));
    if new.vinculado_a is not null then perform public._atd_hist(new.vinculado_a, format('Item %s (%s) instalado', new.codigo, new.tipo)); end if;
    perform public._atd_auditar('atendimento_equipamento_cadastrado', jsonb_build_object('equipamento', new.codigo, 'empreendimento', new.sigla,
      'tipo', new.tipo, 'marca', new.marca, 'modelo', new.modelo, 'serie', new.serie, 'usuario', new.usuario, 'instalado_em', new.vinculado_a));
    return new;
  end if;
  if new.vinculado_a is distinct from old.vinculado_a then
    ev := ev || case when new.vinculado_a is not null
                     then 'Instalado em ' || new.vinculado_a || coalesce(' (antes em ' || old.vinculado_a || ')', '')
                     else 'Removido de ' || old.vinculado_a || ' (avulso)' end;
    if old.vinculado_a is not null then perform public._atd_hist(old.vinculado_a, format('Item %s (%s) removido', new.codigo, new.tipo)); end if;
    if new.vinculado_a is not null then perform public._atd_hist(new.vinculado_a, format('Item %s (%s) instalado', new.codigo, new.tipo)); end if;
  end if;
  if new.vinculado_a is null and new.usuario <> old.usuario then
    ev := ev || format('Usuário: %s → %s', coalesce(nullif(old.usuario, ''), '—'), coalesce(nullif(new.usuario, ''), '—'));
  end if;
  if new.situacao <> old.situacao then ev := ev || format('Situação: %s → %s', old.situacao, new.situacao); end if;
  if new.setor <> old.setor then ev := ev || format('Setor: %s → %s', coalesce(nullif(old.setor, ''), '—'), coalesce(nullif(new.setor, ''), '—')); end if;
  if (new.marca, new.modelo, new.serie, new.obs) is distinct from (old.marca, old.modelo, old.serie, old.obs) then ev := ev || 'Dados atualizados'::text; end if;
  if array_length(ev, 1) > 0 then
    -- um registro por mudança, como na Central
    perform public._atd_hist(new.codigo, e) from unnest(ev) e;
    perform public._atd_auditar('atendimento_equipamento_alterado', jsonb_build_object('equipamento', new.codigo,
      'antes', jsonb_build_object('marca', old.marca, 'modelo', old.modelo, 'serie', old.serie, 'setor', old.setor, 'situacao', old.situacao,
                                  'usuario', old.usuario, 'instalado_em', old.vinculado_a, 'obs', old.obs),
      'depois', jsonb_build_object('marca', new.marca, 'modelo', new.modelo, 'serie', new.serie, 'setor', new.setor, 'situacao', new.situacao,
                                   'usuario', new.usuario, 'instalado_em', new.vinculado_a, 'obs', new.obs)));
  end if;
  return new;
end $$;
drop trigger if exists atd_equip_depois on public.atd_equipamentos;
create trigger atd_equip_depois after insert or update on public.atd_equipamentos
  for each row execute function public.atd_equip_depois();

-- alteração com a data informada na tela ("Data da alteração", como na Central); devolve o equipamento
create or replace function public.atd_equip_alterar(p_codigo text, p_dados jsonb, p_data date default null) returns public.atd_equipamentos
language plpgsql security invoker set search_path = public as $$
declare r public.atd_equipamentos;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia altera equipamentos.'; end if;
  if p_data is not null then
    if p_data > public._atd_hoje() then raise exception 'A data da alteração não pode ser no futuro.'; end if;
    perform set_config('atd.data', p_data::text, true);
  end if;
  update public.atd_equipamentos set
    marca = coalesce(p_dados ->> 'marca', marca), modelo = coalesce(p_dados ->> 'modelo', modelo), serie = coalesce(p_dados ->> 'serie', serie),
    setor = coalesce(p_dados ->> 'setor', setor), situacao = coalesce(p_dados ->> 'situacao', situacao),
    usuario = coalesce(p_dados ->> 'usuario', usuario), obs = coalesce(p_dados ->> 'obs', obs),
    vinculado_a = case when p_dados ? 'vinculado_a' then nullif(p_dados ->> 'vinculado_a', '') else vinculado_a end
   where codigo = p_codigo returning * into r;
  if not found then raise exception 'Equipamento % não encontrado.', p_codigo; end if;
  perform set_config('atd.data', '', true);
  return r;
end $$;
revoke execute on function public.atd_equip_alterar(text, jsonb, date) from public, anon;
grant execute on function public.atd_equip_alterar(text, jsonb, date) to authenticated;

-- ---------------------------------------------------------------- empreendimentos e acessos: auditoria
create or replace function public.atd_emp_gatilho() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.cod_equip <> old.cod_equip and exists (select 1 from public.atd_equipamentos where sigla = new.sigla) then
    raise exception 'Já existem equipamentos com o código %; ele não pode mudar.', old.cod_equip;
  end if;
  if tg_op = 'INSERT' then
    perform public._atd_auditar('atendimento_empreendimento_criado', jsonb_build_object('empreendimento', new.sigla, 'nome', new.nome, 'cod_equip', new.cod_equip));
  else
    perform public._atd_auditar('atendimento_empreendimento_alterado', jsonb_build_object('empreendimento', new.sigla,
      'antes', jsonb_build_object('nome', old.nome, 'cod_equip', old.cod_equip, 'ativo', old.ativo),
      'depois', jsonb_build_object('nome', new.nome, 'cod_equip', new.cod_equip, 'ativo', new.ativo)));
  end if;
  return new;
end $$;
drop trigger if exists atd_emp_gatilho on public.atd_empreendimentos;
create trigger atd_emp_gatilho before insert or update on public.atd_empreendimentos
  for each row execute function public.atd_emp_gatilho();

create or replace function public.atd_acessos_gatilho() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  perform public._atd_auditar(case when tg_op = 'INSERT' then 'atendimento_acesso_liberado' else 'atendimento_acesso_retirado' end,
    jsonb_build_object('empreendimento', r.sigla, 'login', (select email from public.perfis where user_id = r.user_id), 'login_id', r.user_id));
  return r;
end $$;
drop trigger if exists atd_acessos_gatilho on public.atd_acessos;
create trigger atd_acessos_gatilho after insert or delete on public.atd_acessos
  for each row execute function public.atd_acessos_gatilho();

-- ---------------------------------------------------------------- histórico: somente inclusão
create or replace function public.atd_somente_inclusao() returns trigger
language plpgsql as $$
begin
  -- apagar o equipamento leva o histórico junto (cascade); fora isso, histórico não muda
  if tg_op = 'DELETE' and not exists (select 1 from public.atd_equipamentos where codigo = old.codigo) then return old; end if;
  raise exception 'O histórico do equipamento não pode ser alterado nem apagado.';
end $$;
drop trigger if exists atd_equip_historico_fixo on public.atd_equip_historico;
create trigger atd_equip_historico_fixo before update or delete on public.atd_equip_historico
  for each row execute function public.atd_somente_inclusao();

-- ---------------------------------------------------------------- cadastro do app na Área do Cliente
-- Fora da vitrine por enquanto (oculto): é o serviço de TI da Nervia, não um app à venda.
insert into public.apps (id, nome, descricao, url, icone, ordem, ativo, cartao_url, manual_url, situacao)
values ('atendimentos', 'Atendimentos de TI', 'Chamados de suporte de TI da Nervia: andamentos, ficha do atendimento em PDF e equipamentos.',
        '/apps/atendimentos/', 'AT', 90, true, '/apps/atendimentos/ajuda/cartao.html', '/apps/atendimentos/ajuda/manual.html', 'oculto')
on conflict (id) do nothing;
