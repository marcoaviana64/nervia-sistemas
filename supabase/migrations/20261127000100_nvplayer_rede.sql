-- NVPlayer 2.37: diagnóstico de rede no painel (pedido do Marco em 27/11/2026: "informar em algum local, no app ou no
-- portal, por onde o equipamento está saindo e se está acontecendo este bloqueio e o link está sendo desviado").
--
-- O app já manda um resumo (rpc nv_sinal). Agora leva também um bloco "rede" pequeno com a rota do servidor da lista:
-- qual DNS resolveu (o da internet do local, o Google ou o Cloudflare) e se o DNS do local FALHOU — sinal de possível
-- bloqueio de IPTV naquela internet (o app foi obrigado a usar o DNS alternativo, que pode cair em outro país e o
-- provedor bloquear por "país não permitido"). Sem geolocalização (decisão do Marco: só a rota, zero tráfego extra).
-- Colunas novas entram vazias (aparelho antigo ou app < 2.37 não manda "rede" e fica sem diagnóstico, como hoje).

alter table public.nv_aparelhos
  add column rede_dns         text,     -- DNS que resolveu o servidor: "DNS do local" | "Google" | "Cloudflare" | "—"
  add column rede_bloqueio    boolean,  -- true = DNS do local não achou o servidor (possível bloqueio de IPTV)
  add column rede_servidor_ip text;     -- 1º IP a que o app se conecta

-- nv_sinal recriada igual à da migração 20261119000100 + o bloco "rede" (3 campos novos no update).
-- p = {..., rede:{dns, bloqueio(bool), ip}, ...}
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
begin
  if p is null or jsonb_typeof(p) <> 'object' or length(p::text) > 60000 then return jsonb_build_object('ok', false); end if;
  begin v_id := (p ->> 'id')::uuid; exception when others then return jsonb_build_object('ok', false); end;
  if v_id is null then return jsonb_build_object('ok', false); end if;

  select * into v_ap from public.nv_aparelhos where id = v_id for update;
  if found then
    -- no máximo 1 resumo a cada 20 s por aparelho
    if v_ap.ultimo_sinal > now() - interval '20 seconds' then return jsonb_build_object('ok', false, 'cedo', true); end if;
  else
    -- trava contra lixo: no máximo 300 aparelhos
    if (select count(*) from public.nv_aparelhos) >= 300 then return jsonb_build_object('ok', false); end if;
    insert into public.nv_aparelhos (id) values (v_id);
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
  where id = v_id;

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
  return jsonb_build_object('ok', true, 'gravados', n);
end $$;
revoke execute on function public.nv_sinal(jsonb) from public;
grant execute on function public.nv_sinal(jsonb) to anon, authenticated;
