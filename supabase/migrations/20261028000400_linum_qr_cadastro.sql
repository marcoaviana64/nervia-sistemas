-- Cadastro pela página dos QR codes da LINUM (pedido do Marco em 28/10/2026: "acho até que já entra como CRM").
-- Quem lê o QR (vitrine, sacola, cartão…) abre nervia.com.br/linum/?o=<origem> e pode deixar nome, WhatsApp e
-- aniversário, com a autorização para receber novidades (LGPD). Sem login (anon), só por esta função:
--   * telefone novo → lin_clientes como "possível cliente", origem "QR code – <onde>", loja pela origem (ipanema/gavea;
--     as outras origens ficam sem loja), próximo contato = amanhã (Brasília), criado por "Pelo QR code";
--   * telefone que já existe → não duplica: grava a autorização, completa o aniversário se faltava e põe o próximo
--     contato para amanhã se não houver um antes; a resposta é a mesma (não revela quem já é cliente);
--   * nos dois casos, uma linha no histórico (lin_contatos, por "Pelo QR code") e em lin_qr_cadastros (de qual QR, IP).
--   * Proteções: aceite obrigatório, campo escondido contra robôs, até 5 envios por hora por IP e 3 por dia por telefone,
--     auditoria linum_qr_cadastro com IP e navegador (papel 'sistema').
-- Colunas novas com padrão que não muda nada do que existe: lin_clientes.novidades_aceite_em (nula = não autorizou).

alter table public.lin_clientes add column if not exists novidades_aceite_em timestamptz;
alter table public.lin_clientes add column if not exists novidades_origem text not null default '';

create table if not exists public.lin_qr_cadastros (
  id          bigint generated always as identity primary key,
  em          timestamptz not null default now(),
  origem      text not null,
  cliente_id  uuid references public.lin_clientes on delete set null,
  novo        boolean not null,
  ip          text,
  navegador   text
);
create index if not exists lin_qr_cadastros_em on public.lin_qr_cadastros (em);
create index if not exists lin_qr_cadastros_ip on public.lin_qr_cadastros (ip, em);

create or replace function public.lin_qr_cadastros_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'O registro de cadastros pelo QR code não pode ser alterado nem apagado.';
end $$;
drop trigger if exists lin_qr_cadastros_imutavel on public.lin_qr_cadastros;
create trigger lin_qr_cadastros_imutavel before update or delete on public.lin_qr_cadastros
  for each row when (pg_trigger_depth() = 0) execute function public.lin_qr_cadastros_imutavel();

alter table public.lin_qr_cadastros enable row level security;
revoke all on public.lin_qr_cadastros from anon;
revoke insert, update, delete on public.lin_qr_cadastros from authenticated;
drop policy if exists lin_qr_cadastros_ler on public.lin_qr_cadastros;
create policy lin_qr_cadastros_ler on public.lin_qr_cadastros for select using (public.lin_eh_dono());

-- nome de cada origem (o mesmo do gerador divulgacao/linum-qr/gerar.py)
create or replace function public._lin_qr_origem_nome(p text) returns text
language sql immutable as $$
  select case p when 'ipanema' then 'vitrine de Ipanema' when 'gavea' then 'vitrine da Gávea' when 'sacola' then 'sacola'
                when 'cartao' then 'cartão de visita' when 'etiqueta' then 'etiqueta da peça' when 'trakto' then 'QR antigo'
                else coalesce(nullif(p, ''), 'página') end
$$;

-- p = {nome, telefone, aniversario_dia?, aniversario_mes?, origem?, aceite: true, site: '' (campo escondido; robô preenche)}
create or replace function public.lin_qr_cadastrar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_nome text := left(regexp_replace(trim(coalesce(p ->> 'nome', '')), '\s+', ' ', 'g'), 80);
        v_tel text := regexp_replace(coalesce(p ->> 'telefone', ''), '\D', '', 'g');
        v_dia int; v_mes int;
        v_origem text := lower(coalesce(p ->> 'origem', ''));
        v_h jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
        v_ip text; v_nav text; v_cli uuid; v_novo boolean := false; v_loja uuid; v_amanha date; v_onde text;
begin
  if coalesce(p ->> 'site', '') <> '' then return jsonb_build_object('ok', true); end if;   -- robô: finge que deu certo
  if coalesce((p ->> 'aceite')::boolean, false) is not true then
    raise exception 'Para se cadastrar, marque a autorização para a LINUM entrar em contato.';
  end if;
  if length(v_nome) < 2 or v_nome !~ '[[:alpha:]]' then raise exception 'Informe o seu nome.'; end if;
  if v_tel ~ '^55[0-9]{10,11}$' then v_tel := substr(v_tel, 3); end if;
  if v_tel !~ '^[1-9][0-9][0-9]{8,9}$' then raise exception 'Informe o WhatsApp com DDD (ex.: 21 99999-9999).'; end if;
  begin
    v_dia := nullif(p ->> 'aniversario_dia', '')::int; v_mes := nullif(p ->> 'aniversario_mes', '')::int;
  exception when others then raise exception 'Aniversário inválido.';
  end;
  if (v_dia is null) <> (v_mes is null) or (v_dia is not null and (v_mes not between 1 and 12 or v_dia not between 1 and
      extract(day from (make_date(2024, v_mes, 1) + interval '1 month - 1 day'))::int)) then
    raise exception 'Aniversário inválido: informe o dia e o mês.';
  end if;
  if v_origem !~ '^[a-z0-9-]{1,30}$' then v_origem := 'pagina'; end if;
  v_ip := coalesce(v_h ->> 'cf-connecting-ip', v_h ->> 'x-real-ip', nullif(trim(split_part(v_h ->> 'x-forwarded-for', ',', 1)), ''));
  v_nav := left(v_h ->> 'user-agent', 300);
  if v_ip is not null and (select count(*) from public.lin_qr_cadastros where ip = v_ip and em > now() - interval '1 hour') >= 5 then
    raise exception 'Muitos envios seguidos. Tente de novo mais tarde ou fale com a gente pelo WhatsApp.';
  end if;
  if (select count(*) from public.lin_qr_cadastros q join public.lin_clientes c on c.id = q.cliente_id
       where c.telefone = v_tel and q.em > now() - interval '1 day') >= 3 then
    return jsonb_build_object('ok', true);   -- já recebido hoje: não repete
  end if;

  v_amanha := (now() at time zone 'America/Sao_Paulo')::date + 1;
  v_onde := public._lin_qr_origem_nome(v_origem);
  select id into v_loja from public.lin_lojas
   where lower(translate(nome, 'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc')) = v_origem limit 1;

  select id into v_cli from public.lin_clientes where telefone = v_tel order by criado_em limit 1 for update;
  if v_cli is null then
    v_novo := true;
    insert into public.lin_clientes (nome, telefone, aniversario_dia, aniversario_mes, loja_id, criado_nome, situacao, origem,
                                     proximo_contato, novidades_aceite_em, novidades_origem)
    values (v_nome, v_tel, v_dia, v_mes, v_loja, 'Pelo QR code', 'possivel', 'QR code – ' || v_onde,
            v_amanha, now(), v_origem)
    returning id into v_cli;
  else
    update public.lin_clientes set
      novidades_aceite_em = now(), novidades_origem = v_origem,
      aniversario_dia = coalesce(aniversario_dia, v_dia),
      aniversario_mes = case when aniversario_dia is null then v_mes else aniversario_mes end,
      proximo_contato = case when proximo_contato is not null and proximo_contato <= v_amanha then proximo_contato else v_amanha end,
      atualizado_em = now()
    where id = v_cli;
  end if;

  insert into public.lin_contatos (cliente_id, por, por_nome, canal, resultado, texto, proximo_contato)
  values (v_cli, null, 'Pelo QR code', 'outro', 'outro',
          case when v_novo then 'Cadastrou-se pelo QR code (' || v_onde || ') e autorizou receber novidades pelo WhatsApp.'
               else 'Leu o QR code (' || v_onde || ') e autorizou receber novidades pelo WhatsApp' ||
                    case when (select nome from public.lin_clientes where id = v_cli) is distinct from v_nome then ' (nome informado: ' || v_nome || ')' else '' end || '.' end,
          v_amanha);
  insert into public.lin_qr_cadastros (origem, cliente_id, novo, ip, navegador) values (v_origem, v_cli, v_novo, v_ip, v_nav);
  insert into public.auditoria (user_id, email, nome, papel, acao, cnpj, detalhes, ip, navegador)
  values (null, null, 'Pelo QR code (página da LINUM)', 'sistema', 'linum_qr_cadastro', null,
          jsonb_build_object('cliente_id', v_cli, 'novo', v_novo, 'origem', v_origem, 'onde', v_onde,
                             'loja', (select nome from public.lin_lojas where id = v_loja)),
          v_ip, v_nav);
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.lin_qr_cadastrar(jsonb) from public;
grant execute on function public.lin_qr_cadastrar(jsonb) to anon, authenticated;
