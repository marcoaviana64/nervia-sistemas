-- Cópia noturna do Sistema Linum (pedido do Marco em 27/10/2026, dia em que a Linum começou a usar o sistema de verdade:
-- "o sistema agora está em produção, precisamos ter um backup").
--   * O backup diário do Supabase (plano Pro, 7 dias) restaura o projeto INTEIRO; esta cópia serve para recuperar só o
--     que se perdeu no Linum (um produto, o estoque de uma loja, uma tabela) sem mexer no resto nem tirar o sistema do ar.
--   * Todo dia às 23h de Brasília (02:00 UTC, pg_cron 'linum-copia-noturna') e antes de cada mudança feita à noite
--     (select public.lin_copia_fazer('antes da migração …')): cada tabela public.lin_* vira um jsonb com todas as linhas.
--   * Fica no esquema `copias`, que a API (PostgREST) não expõe e que anon/authenticated não leem: só o banco e a
--     equipe Nervia pelo painel do Supabase. Guarda 30 dias (a de antes de migração também).
--   * Restaurar é manual, conferindo antes (ver CLAUDE.md): jsonb_populate_recordset(null::public.lin_x, linhas).

create schema if not exists copias;
revoke all on schema copias from public, anon, authenticated;

create table if not exists copias.lin_copias (
  id         bigint generated always as identity primary key,
  criada_em  timestamptz not null default now(),
  motivo     text not null default 'noturna',
  resumo     jsonb not null default '{}'   -- {tabela: nº de linhas}
);
create table if not exists copias.lin_dados (
  copia_id   bigint not null references copias.lin_copias on delete cascade,
  tabela     text not null,
  linhas     jsonb not null,
  primary key (copia_id, tabela)
);
revoke all on all tables in schema copias from public, anon, authenticated;

create or replace function public.lin_copia_fazer(p_motivo text default 'noturna') returns bigint
language plpgsql security definer set search_path = public, copias as $$
declare v_id bigint; t text; v_linhas jsonb; v_resumo jsonb := '{}';
begin
  insert into copias.lin_copias (motivo) values (coalesce(nullif(trim(p_motivo), ''), 'noturna')) returning id into v_id;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'lin\_%' order by c.relname loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x', t) into v_linhas;
    insert into copias.lin_dados (copia_id, tabela, linhas) values (v_id, t, v_linhas);
    v_resumo := v_resumo || jsonb_build_object(t, jsonb_array_length(v_linhas));
  end loop;
  update copias.lin_copias set resumo = v_resumo where id = v_id;
  delete from copias.lin_copias where criada_em < now() - interval '30 days';
  return v_id;
end $$;
revoke execute on function public.lin_copia_fazer(text) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('linum-copia-noturna', '0 2 * * *', $c$select public.lin_copia_fazer('noturna')$c$);
  end if;
end $$;

-- a primeira cópia já na migração
select public.lin_copia_fazer('primeira cópia (migração)');
