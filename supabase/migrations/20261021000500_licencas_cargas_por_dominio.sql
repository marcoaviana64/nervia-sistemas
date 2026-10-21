-- Contas e Licenças — cada carga vale só para as unidades (domínios) que vieram no arquivo (pedido do Marco em 21/10/2026).
-- Antes, uma carga era a foto do tenant INTEIRO numa data: carregar a exportação de outra empresa (outro tenant, com outros
-- domínios) virava a "exportação mais recente" e as unidades do primeiro tenant apareciam zeradas; e na mesma data
-- acusava "já existe" e, com "substituir", apagava a carga inteira (todas as unidades).
-- Agora:
--   * lic_cargas.unidades = unidades que vieram no arquivo; pode haver várias cargas na mesma data (uma por tenant/arquivo);
--   * "já existe" só quando outra carga da MESMA data tem alguma das MESMAS unidades; "substituir" troca só essas unidades
--     (as outras unidades daquela carga ficam; a carga que fica sem unidade é apagada);
--   * a tela mostra, para cada unidade, a carga mais recente que tem aquela unidade (até a data escolhida) e compara com a
--     anterior que tem aquela unidade;
--   * lic_salvar_fatura (fatura digitada/colada) também passa a trocar só as unidades dos itens; as outras do mês ficam.

alter table public.lic_cargas drop constraint if exists lic_cargas_exportado_em_key;
alter table public.lic_cargas add column if not exists unidades uuid[] not null default '{}';
update public.lic_cargas c set unidades = coalesce((select array_agg(distinct unidade_id) from public.lic_contas where carga_id = c.id), '{}')
 where unidades = '{}';
create index if not exists lic_cargas_data on public.lic_cargas (exportado_em);

-- quem vê: a carga só aparece para quem vê alguma das unidades dela (antes, qualquer login com alguma unidade via todas)
drop policy if exists lic_cargas_ler on public.lic_cargas;
create policy lic_cargas_ler on public.lic_cargas for select
  using (public.eh_admin() or exists (select 1 from public.lic_acessos a where a.user_id = auth.uid() and a.unidade_id = any (unidades)));

create or replace function public.lic_nomes(p_unidades uuid[]) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(string_agg(nome, ', ' order by ordem, nome), '') from public.lic_unidades where id = any (p_unidades)
$$;

create or replace function public.lic_carregar(p_exportado_em date, p_arquivo text, p_linhas int, p_contas jsonb, p_substituir boolean default false)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_n int; v_por jsonb; v_un uuid[]; v_choque uuid[]; v_tirou jsonb := '[]'; k record;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia carrega exportações.'; end if;
  if p_exportado_em is null or p_exportado_em > current_date + 1 then raise exception 'Informe a data da exportação (não pode ser futura).'; end if;
  if jsonb_typeof(p_contas) <> 'array' or jsonb_array_length(p_contas) = 0 then
    raise exception 'Nenhuma conta das unidades cadastradas neste arquivo. Confira se é a exportação de usuários do Microsoft 365.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_contas) c
              where not exists (select 1 from public.lic_unidades u where u.id = (c ->> 'unidade_id')::uuid)
                 or coalesce(c ->> 'login', '') = '' or (c ->> 'login') like '%#EXT#%') then
    raise exception 'Arquivo com conta inválida (unidade desconhecida, login vazio ou convidado).';
  end if;
  select array_agg(distinct (c ->> 'unidade_id')::uuid) into v_un from jsonb_array_elements(p_contas) c;
  -- só conflita com carga da mesma data que tenha alguma das mesmas unidades
  select array_agg(distinct u) into v_choque
    from public.lic_cargas g, unnest(g.unidades) u where g.exportado_em = p_exportado_em and u = any (v_un);
  if v_choque is not null then
    if not coalesce(p_substituir, false) then
      raise exception 'Já existe uma carga de % para: %. Marque "substituir" para trocar só estas unidades (as outras ficam como estão).',
        to_char(p_exportado_em, 'DD/MM/YYYY'), public.lic_nomes(v_choque);
    end if;
    for k in select * from public.lic_cargas where exportado_em = p_exportado_em and unidades && v_un loop
      delete from public.lic_contas where carga_id = k.id and unidade_id = any (v_un);
      v_tirou := v_tirou || jsonb_build_object('carga', k.id, 'arquivo', k.arquivo, 'unidades', public.lic_nomes(array(select unnest(k.unidades) intersect select unnest(v_un))));
      update public.lic_cargas set unidades = array(select unnest(k.unidades) except select unnest(v_un)),
             contas = (select count(*) from public.lic_contas where carga_id = k.id)
       where id = k.id;
      delete from public.lic_cargas where id = k.id and unidades = '{}';
    end loop;
  end if;
  insert into public.lic_cargas (exportado_em, arquivo, linhas_arquivo, contas, unidades, carregado_por, carregado_nome)
  values (p_exportado_em, left(coalesce(p_arquivo, ''), 200), coalesce(p_linhas, 0), jsonb_array_length(p_contas), v_un, auth.uid(),
    coalesce((select coalesce(nullif(nome, ''), email) from public.perfis where user_id = auth.uid()), ''))
  returning id into v_id;
  insert into public.lic_contas (carga_id, unidade_id, login, nome, cargo, departamento, bloqueada, compartilhada, licencas, gratuitas, criada_em)
  select distinct on (lower(c.login)) v_id, c.unidade_id, lower(c.login), left(coalesce(c.nome, ''), 200), left(coalesce(c.cargo, ''), 200),
         left(coalesce(c.departamento, ''), 200), coalesce(c.bloqueada, false), coalesce(c.compartilhada, false),
         coalesce(c.licencas, '{}'), coalesce(c.gratuitas, '{}'), c.criada_em
    from jsonb_to_recordset(p_contas) as c(unidade_id uuid, login text, nome text, cargo text, departamento text, bloqueada boolean,
         compartilhada boolean, licencas text[], gratuitas text[], criada_em timestamptz)
   order by lower(c.login);
  get diagnostics v_n = row_count;
  update public.lic_cargas set contas = v_n where id = v_id;
  select jsonb_object_agg(u.nome, x.n) into v_por
    from (select unidade_id, count(*) n from public.lic_contas where carga_id = v_id group by unidade_id) x join public.lic_unidades u on u.id = x.unidade_id;
  perform public.auditar('licencas_carga', null, jsonb_build_object('exportado_em', p_exportado_em, 'arquivo', p_arquivo,
    'linhas_arquivo', p_linhas, 'contas', v_n, 'por_unidade', v_por, 'substituiu', v_choque is not null, 'substituidas', v_tirou));
  return v_id;
end $$;

create or replace function public.lic_excluir_carga(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v public.lic_cargas;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia exclui cargas.'; end if;
  delete from public.lic_cargas where id = p_id returning * into v;
  if not found then raise exception 'Carga não encontrada.'; end if;
  perform public.auditar('licencas_carga_excluida', null, jsonb_build_object('exportado_em', v.exportado_em, 'arquivo', v.arquivo, 'contas', v.contas,
    'unidades', public.lic_nomes(v.unidades)));
end $$;

-- fatura digitada/colada: troca só as unidades que aparecem nos itens
create or replace function public.lic_salvar_fatura(p_mes date, p_itens jsonb, p_substituir boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', p_mes)::date; v_n int; v_tinha int; v_un uuid[]; v_choque uuid[];
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia carrega a fatura.'; end if;
  if p_mes is null then raise exception 'Informe o mês da fatura.'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Nenhum item reconhecido na fatura.'; end if;
  select array_agg(distinct (i ->> 'unidade_id')::uuid) into v_un from jsonb_array_elements(p_itens) i;
  select count(*), array_agg(distinct unidade_id) into v_tinha, v_choque from public.lic_faturas where mes = v_mes and unidade_id = any (v_un);
  if v_tinha > 0 and not coalesce(p_substituir, false) then
    raise exception 'Já existe fatura de % para: % (% itens). Marque "substituir" para trocar só estas unidades (as outras do mês ficam como estão).',
      to_char(v_mes, 'MM/YYYY'), public.lic_nomes(v_choque), v_tinha;
  end if;
  delete from public.lic_faturas where mes = v_mes and unidade_id = any (v_un);
  insert into public.lic_faturas (unidade_id, mes, produto, quantidade, valor_unitario, carregado_por, carregado_nome)
  select i.unidade_id, v_mes, trim(i.produto), sum(i.quantidade), max(coalesce(i.valor_unitario, 0)), auth.uid(),
         coalesce((select coalesce(nullif(nome, ''), email) from public.perfis where user_id = auth.uid()), '')
    from jsonb_to_recordset(p_itens) as i(unidade_id uuid, produto text, quantidade int, valor_unitario numeric)
   group by i.unidade_id, trim(i.produto);
  get diagnostics v_n = row_count;
  perform public.auditar('licencas_fatura', null, jsonb_build_object('mes', v_mes, 'itens', v_n, 'substituiu', v_tinha > 0,
    'unidades', public.lic_nomes(v_un),
    'valor_total', (select sum(quantidade * valor_unitario) from public.lic_faturas where mes = v_mes and unidade_id = any (v_un))));
  return v_n;
end $$;

revoke execute on function public.lic_carregar(date, text, int, jsonb, boolean), public.lic_nomes(uuid[]) from public, anon;
revoke execute on function public.lic_nomes(uuid[]) from authenticated;
grant execute on function public.lic_carregar(date, text, int, jsonb, boolean) to authenticated;
