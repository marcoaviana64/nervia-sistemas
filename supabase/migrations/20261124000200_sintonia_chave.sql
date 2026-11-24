-- NVSintonia 1.1 — entrar por CHAVE, sem e-mail (pedido do Marco em 24/11/2026: "se guardar o e-mail acaba a segurança
-- de anonimato … um código único que ele deve anotar e, se perder, vai ter que se cadastrar novamente").
--
-- A chave tem 12 caracteres do alfabeto 23456789ABCDEFGHJKLMNPQRSTUVWXYZ (32^12 ≈ 1,15 × 10^18; mostrada como XXXX-XXXX-XXXX).
-- É criada pela função sintonia-conta (service role) e vira o login do Supabase Auth:
--   e-mail = s-<40 hex do sha256(pimenta + chave)>@sintonia.nervia.com.br  (endereço que NÃO recebe e-mail; nada é enviado)
--   senha  = derivada da chave na página e na função (o Auth guarda só o bcrypt).
-- O banco nunca guarda a chave: só o resumo em sin_chaves (que nunca é apagado, então a mesma chave não volta a existir).
-- Perdeu a chave = perdeu a conta (nem a Nervia recupera). A pimenta fica em sin_config, sem acesso pela tela.

create table public.sin_config (
  id      int primary key default 1 check (id = 1),
  pimenta text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
insert into public.sin_config default values;

create table public.sin_chaves (
  hash      text primary key,
  criada_em timestamptz not null default now()
);

alter table public.sin_config enable row level security;
alter table public.sin_chaves enable row level security;
revoke all on public.sin_config from anon, authenticated;
revoke all on public.sin_chaves from anon, authenticated;

-- chave digitada → só os 12 caracteres válidos, em maiúsculas (aceita traços, espaços e minúsculas); inválida = null
create or replace function public._sin_chave_limpa(p_chave text) returns text
language sql immutable as $$
  select case when c ~ '^[2-9A-HJ-NP-Z]{12}$' then c end
  from (select upper(regexp_replace(coalesce(p_chave, ''), '[^0-9A-Za-z]', '', 'g')) as c) x
$$;

create or replace function public._sin_chave_hash(p_chave text) returns text
language sql stable security definer set search_path = public as $$
  select encode(sha256(convert_to((select pimenta from sin_config where id = 1) || public._sin_chave_limpa(p_chave), 'UTF8')), 'hex')
$$;

create or replace function public._sin_chave_email(p_hash text) returns text
language sql immutable as $$ select 's-' || left(p_hash, 40) || '@sintonia.nervia.com.br' $$;

-- chave nova (sorteio forte: bytes do gen_random_uuid, fora dos bits fixos da versão), única para sempre
create or replace function public.sin_chave_nova() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  alfa constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  pos constant int[] := array[0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14];
  b bytea; c text; h text; i int;
begin
  for tentativa in 1..20 loop
    b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    c := '';
    foreach i in array pos loop
      c := c || substr(alfa, 1 + get_byte(b, i) % 32, 1);
    end loop;
    h := public._sin_chave_hash(c);
    begin
      insert into sin_chaves (hash) values (h);
      return jsonb_build_object('chave', substr(c, 1, 4) || '-' || substr(c, 5, 4) || '-' || substr(c, 9, 4), 'email', public._sin_chave_email(h));
    exception when unique_violation then null;
    end;
  end loop;
  raise exception 'Não foi possível gerar a chave. Tente de novo.';
end $$;

-- e-mail de login de uma chave (null = formato inválido); não diz se a conta existe
create or replace function public.sin_chave_email(p_chave text) returns text
language sql stable security definer set search_path = public as $$
  select case when public._sin_chave_limpa(p_chave) is null then null else public._sin_chave_email(public._sin_chave_hash(p_chave)) end
$$;

-- limite de tentativas de entrar: 20 por hora por IP (a chave é a senha; com o limite, adivinhar é impossível)
create or replace function public.sin_entrar_limite(p_ip text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from sin_limites where tipo = 'entrar' and ip = coalesce(p_ip, '') and em > now() - interval '1 hour') >= 20 then
    return false;
  end if;
  insert into sin_limites (tipo, ip) values ('entrar', coalesce(p_ip, ''));
  return true;
end $$;

-- auditoria da conta (chamada pela função, que já sabe quem é o usuário); nunca grava a chave
create or replace function public.sin_conta_auditar(p_user uuid, p_acao text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_acao not in ('sintonia_conta_criada', 'sintonia_email_trocado_por_chave') then raise exception 'Ação inválida.'; end if;
  insert into auditoria (user_id, email, nome, papel, acao, detalhes)
  select p_user, null, p.nome, 'cliente', p_acao, '{}'::jsonb from (select coalesce((select nome from perfis where user_id = p_user), '') as nome) p;
end $$;

-- e-mail do perfil acompanha o login (o gatilho da base só copia na criação)
create or replace function public.sin_perfil_email(p_user uuid, p_email text) returns void
language sql security definer set search_path = public as $$ update perfis set email = p_email where user_id = p_user $$;

do $$ declare f text; begin
  foreach f in array array['_sin_chave_hash(text)', 'sin_chave_nova()', 'sin_chave_email(text)', 'sin_entrar_limite(text)',
                           'sin_conta_auditar(uuid,text)', 'sin_perfil_email(uuid,text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- Você na multidão (pedido do Marco em 24/11/2026:
-- "o sistema guarda informação do id e pode gerar comparações de id … ou onde você se enquadra na multidão")
-- Compara a SUA nota dos encontros com a de todas as pessoas do Sintonia que já têm nota (lote de 5 fechado).
-- Só números: nenhum nome nem código sai daqui. Aparece com pelo menos 10 pessoas com nota (antes disso, só a contagem),
-- para que a distribuição não deixe adivinhar a nota de alguém.
create or replace function public.sin_multidao() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := public._sin_eu(); eu jsonb := public._sin_nota(v); minimo constant int := 10; r jsonb;
begin
  with t as (
    select p.user_id, (x.nota ->> 'geral')::numeric as g, x.nota -> 'itens' as it
    from sin_pessoas p cross join lateral (select public._sin_nota(p.user_id) as nota) x
    where (x.nota ->> 'geral') is not null)
  select jsonb_build_object('pessoas', (select count(*) from sin_pessoas), 'com_nota', (select count(*) from t), 'minimo', minimo, 'eu', eu -> 'geral')
    || case when (select count(*) from t) < minimo or eu -> 'geral' = 'null'::jsonb then '{}'::jsonb else jsonb_build_object(
      -- "acima de X% das pessoas": entre as OUTRAS pessoas com nota, quantas têm nota menor que a sua
      'percentil', (select round(100.0 * count(*) filter (where g < (eu ->> 'geral')::numeric) / nullif(count(*), 0)) from t where user_id <> v),
      'itens', (select jsonb_agg((select round(100.0 * count(*) filter (where (t2.it ->> (i - 1))::numeric < (eu -> 'itens' ->> (i - 1))::numeric) / nullif(count(*), 0))
                                  from t t2 where t2.user_id <> v) order by i) from generate_series(1, 5) i),
      -- quantas pessoas em cada faixa de meia estrela (0–0,5 … 4,5–5)
      'faixas', (select jsonb_agg((select count(*) from t where least(floor(g * 2), 9) = f) order by f) from generate_series(0, 9) f)) end
  into r;
  return r;
end $$;
revoke execute on function public.sin_multidao() from public, anon;
grant execute on function public.sin_multidao() to authenticated;
