-- NVPlayer: lista de servidores editável pelo painel (pedido do Marco em 19/11/2026: "o app pegar qual o servidor
-- válido que eu coloco no painel", sem editar o arquivo nvplayer.json à mão).
-- O app (2.15+) lê a lista por nv_servidores_publicos() (anon, GET) em vez do nvplayer.json; a VERSÃO do app continua
-- no nvplayer.json. Só a equipe Nervia (admin) edita, pela aba Servidores do painel NVPlayer.

create table public.nv_servidores (
  ordem    int primary key,
  endereco text not null check (endereco ~ '^https?://')
);

alter table public.nv_servidores enable row level security;
-- leitura só admin pela tabela; o app lê pela função abaixo (anon)
create policy nv_servidores_ler on public.nv_servidores for select using ((select public.eh_admin()));
revoke all on public.nv_servidores from anon, authenticated;
grant select on public.nv_servidores to authenticated;

-- começa com o endereço que estava no nvplayer.json, para nada quebrar
insert into public.nv_servidores (ordem, endereco) values (1, 'http://p.urldata.gy')
on conflict (ordem) do nothing;

-- ---------------------------------------------------------------- o app lê daqui (anon, GET)
-- Mesmo formato do nvplayer.json ({"servidores": [...]}), para o app reaproveitar o leitor.
create or replace function public.nv_servidores_publicos()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('servidores',
    coalesce((select jsonb_agg(endereco order by ordem) from public.nv_servidores), '[]'::jsonb));
$$;
revoke execute on function public.nv_servidores_publicos() from public;
grant execute on function public.nv_servidores_publicos() to anon, authenticated;

-- ---------------------------------------------------------------- a equipe Nervia edita (painel)
-- p_lista = endereços na ordem desejada (o 1º é o que vem preenchido no login). Substitui a lista inteira.
create or replace function public.nv_servidores_salvar(p_lista jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_enderecos text[];
  e text;
  v_limpa text[] := '{}';
  v_antes text;
begin
  if not public.eh_admin() then raise exception 'Somente a equipe Nervia.'; end if;
  if p_lista is null or jsonb_typeof(p_lista) <> 'array' then raise exception 'Lista inválida.'; end if;

  select array_agg(x) into v_enderecos from jsonb_array_elements_text(p_lista) t(x);
  foreach e in array coalesce(v_enderecos, '{}') loop
    e := trim(e);
    if e = '' then continue; end if;
    if e !~ '^https?://' then e := 'http://' || e; end if;          -- aceita digitar sem http://
    e := rtrim(e, '/');
    if e !~ '^https?://[^/]' then raise exception 'Endereço inválido: %', e; end if;
    if not (e = any(v_limpa)) then v_limpa := v_limpa || e; end if;  -- sem repetir, mantém a ordem
  end loop;
  if array_length(v_limpa, 1) is null then raise exception 'Informe ao menos um endereço de servidor.'; end if;
  if array_length(v_limpa, 1) > 20 then raise exception 'No máximo 20 endereços.'; end if;

  select string_agg(endereco, ' | ' order by ordem) into v_antes from public.nv_servidores;
  delete from public.nv_servidores;
  insert into public.nv_servidores (ordem, endereco)
    select generate_subscripts(v_limpa, 1), unnest(v_limpa);

  perform public.auditar('nvplayer_servidores', null,
    jsonb_build_object('antes', v_antes, 'depois', array_to_string(v_limpa, ' | ')));
  return to_jsonb(v_limpa);
end $$;
revoke execute on function public.nv_servidores_salvar(jsonb) from public, anon;
grant execute on function public.nv_servidores_salvar(jsonb) to authenticated;
-- o painel (admin) lê a tabela direto pelo RLS (nv_servidores_ler).
