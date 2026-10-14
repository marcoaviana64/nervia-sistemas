-- Testes do esquema: gravar_nota, RLS por CNPJ, Vault, travas, colunas protegidas.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.ok(cond boolean, nome text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FALHOU: %', nome; end if; raise notice 'ok  %', nome; end $$;

-- usuários: admin, cliente Linum, cliente sem acesso
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'marco@nervia.com.br'),
  ('00000000-0000-0000-0000-00000000000b', 'financeiro@linum.com.br'),
  ('00000000-0000-0000-0000-00000000000c', 'outro@x.com');
update perfis set admin = true where email = 'marco@nervia.com.br';
select pg_temp.ok((select count(*) = 3 from perfis), 'trigger cria perfil para cada usuário');

insert into nf_empresas (cnpj, nome) values ('11111111000111', 'Nervia'), ('22222222000122', 'Linum');
insert into nf_acessos values ('00000000-0000-0000-0000-00000000000b', '22222222000122');

-- gravar_nota (como service_role)
set role service_role;
select pg_temp.ok(nf_gravar_nota('22222222000122', 'NFE', '{"chave":"K1","emit_cnpj":"999","emit_nome":"FORN","data_emissao":"2026-10-01T10:00:00-03:00","valor":10.5,"completo":false,"numero":"12"}', 1, 'p1') = 'nova', 'resumo novo');
select pg_temp.ok(nf_gravar_nota('22222222000122', 'NFE', '{"chave":"K1","emit_cnpj":"999","emit_nome":"FORN","valor":10.5,"completo":true,"numero":"12","dest_cnpj":"22222222000122"}', 2, 'p2') = 'atualizada', 'completo atualiza resumo');
select pg_temp.ok(nf_gravar_nota('22222222000122', 'NFE', '{"chave":"K1","emit_cnpj":"999","emit_nome":"FORN","completo":false}', 3, 'p3') = 'ignorada', 'resumo não sobrescreve completo');
select pg_temp.ok((select completo and xml_path = 'p2' and data_emissao is not null and valor = 10.50 from nf_notas where chave = 'K1'), 'campos preservados');
update nf_notas set situacao = 'Cancelada' where chave = 'K1';
select nf_gravar_nota('22222222000122', 'NFE', '{"chave":"K1","emit_cnpj":"999","emit_nome":"FORN","completo":true}', 4, null);
select pg_temp.ok((select situacao = 'Cancelada' and xml_path = 'p2' from nf_notas where chave = 'K1'), 'cancelada continua cancelada; xml_path mantido');
select pg_temp.ok(nf_gravar_nota('22222222000122', 'NFSE', '{"chave":"S1","emit_cnpj":"22222222000122","emit_nome":"LINUM","completo":true}', 9, 'p') = 'nova', 'NFS-e nova');
select pg_temp.ok((select papel from nf_notas where chave = 'S1') = 'emitida', 'papel emitida');
select nf_gravar_nota('11111111000111', 'NFE', '{"chave":"N1","emit_cnpj":"8","emit_nome":"X","completo":true}', 1, null);

-- vault
select nf_salvar_certificado('22222222000122', '{"cert_pem":"A","key_pem":"B"}', 'LINUM:22222222000122', '22222222000122', now() + interval '1 year');
select nf_salvar_certificado('22222222000122', '{"cert_pem":"A2","key_pem":"B2"}', 'LINUM:22222222000122', '22222222000122', now() + interval '1 year');
select pg_temp.ok(nf_ler_certificado('22222222000122') like '%A2%', 'service_role lê o certificado atualizado');
reset role;
select pg_temp.ok((select count(*) = 1 from vault.secrets), 'atualização reaproveita o mesmo segredo');
set role service_role;

-- travas
select pg_temp.ok(nf_travar_empresa('22222222000122'), 'trava livre');
select pg_temp.ok(not nf_travar_empresa('22222222000122'), 'segunda trava recusada');
select nf_liberar_empresa('22222222000122');
select pg_temp.ok(nf_travar_empresa('22222222000122'), 'trava após liberar');
reset role;

-- ---------------------------------------------------------------- RLS: cliente Linum
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 2 from nf_notas), 'cliente vê só as notas do CNPJ dele');
select pg_temp.ok((select bool_and(cnpj_consulta = '22222222000122') from nf_notas), 'nenhuma nota de outro CNPJ');
select pg_temp.ok((select count(*) = 1 from nf_empresas), 'cliente vê só a própria empresa');
do $$ begin
  begin perform nf_ler_certificado('22222222000122'); raise exception 'FALHOU: cliente leu certificado';
  exception when insufficient_privilege then raise notice 'ok  cliente não lê certificado'; end;
  begin perform nf_gravar_nota('22222222000122','NFE','{"chave":"Z"}',1,null); raise exception 'FALHOU: cliente gravou nota';
  exception when insufficient_privilege then raise notice 'ok  cliente não grava nota'; end;
  begin insert into nf_empresas (cnpj, nome) values ('33333333000133', 'Hack'); raise exception 'FALHOU: cliente criou empresa';
  exception when insufficient_privilege then raise notice 'ok  cliente não cria empresa'; end;
  begin insert into nf_acessos values ('00000000-0000-0000-0000-00000000000b', '11111111000111'); raise exception 'FALHOU: cliente se deu acesso';
  exception when insufficient_privilege then raise notice 'ok  cliente não se dá acesso'; end;
  begin update perfis set admin = true where user_id = auth.uid();
    if (select admin from perfis where user_id = auth.uid()) then raise exception 'FALHOU: cliente virou admin'; end if;
    raise notice 'ok  cliente não vira admin';
  end;
end $$;
-- cliente sem acesso
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((select count(*) = 0 from nf_notas) and (select count(*) = 0 from nf_empresas), 'usuário sem acesso não vê nada');
-- storage
reset role;
insert into storage.objects (bucket_id, name) values ('nf-xml', '22222222000122/nfe/K1.xml'), ('nf-xml', '11111111000111/nfe/N1.xml');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 1 from storage.objects), 'cliente só baixa XML do próprio CNPJ');
do $$ begin
  update nf_empresas set termo_status = 'dispensado' where cnpj = '22222222000122';
  if (select termo_status from nf_empresas where cnpj = '22222222000122') = 'dispensado' then raise exception 'FALHOU: cliente mexeu no termo'; end if;
  raise notice 'ok  cliente não altera o termo';
exception when insufficient_privilege then raise notice 'ok  cliente não altera o termo';
end $$;

-- ---------------------------------------------------------------- RLS: admin
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.ok((select count(*) = 3 from nf_notas) and (select count(*) = 2 from storage.objects), 'admin vê tudo');
insert into nf_empresas (cnpj, nome) values ('33333333000133', 'iGuardei');
update nf_empresas set nome = 'Linum Ipanema' where cnpj = '22222222000122';
select pg_temp.ok((select termo_status = 'pendente' from nf_empresas where cnpj = '33333333000133'), 'empresa nova nasce com termo pendente');
update nf_empresas set termo_status = 'assinado', termo_assinado_em = '2026-10-14', termo_signatario = 'Sócia' where cnpj = '33333333000133';
select pg_temp.ok((select termo_status = 'assinado' from nf_empresas where cnpj = '33333333000133'), 'admin registra o termo');
do $$ begin
  begin update nf_empresas set termo_status = 'qualquer' where cnpj = '33333333000133'; raise exception 'FALHOU: situação inválida aceita';
  exception when check_violation then raise notice 'ok  situação do termo só aceita pendente/assinado/dispensado'; end;
end $$;
do $$ begin
  begin update nf_empresas set ult_nsu_nfe = 999 where cnpj = '22222222000122'; raise exception 'FALHOU: admin mexeu no NSU pela tela';
  exception when insufficient_privilege then raise notice 'ok  NSU protegido até do admin (só as funções mexem)'; end;
end $$;
-- NF-e liga/desliga e trava 656
select pg_temp.ok((select nfe_ativa from nf_empresas where cnpj = '22222222000122'), 'NF-e nasce ligada');
reset role;
update nf_empresas set nfe_ativa = false, nfe_656_seguidas = 2, nfe_pausa_motivo = 'Pausada: 656' where cnpj = '22222222000122';
select pg_temp.ok((select nfe_pausa_motivo = 'Pausada: 656' from nf_empresas where cnpj = '22222222000122'), 'trava grava o motivo');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update nf_empresas set nfe_ativa = true where cnpj = '22222222000122';
select pg_temp.ok((select nfe_ativa and nfe_656_seguidas = 0 and nfe_pausa_motivo is null from nf_empresas where cnpj = '22222222000122'),
  'admin religa a NF-e e a contagem/motivo zeram');
update nf_empresas set nfe_ativa = false where cnpj = '22222222000122';
select pg_temp.ok((select not nfe_ativa and nfe_pausa_motivo is null from nf_empresas where cnpj = '22222222000122'), 'admin desliga a NF-e à mão');
update nf_empresas set nfe_ativa = true where cnpj = '22222222000122';
do $$ begin
  begin update nf_empresas set nfe_656_seguidas = 0 where cnpj = '22222222000122'; raise exception 'FALHOU: admin mexeu na contagem 656';
  exception when insufficient_privilege then raise notice 'ok  contagem 656 só pelas funções'; end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  update nf_empresas set nfe_ativa = false where cnpj = '22222222000122';
  if not (select nfe_ativa from nf_empresas where cnpj = '22222222000122') then raise exception 'FALHOU: cliente desligou a NF-e'; end if;
  raise notice 'ok  cliente não liga/desliga a NF-e';
exception when insufficient_privilege then raise notice 'ok  cliente não liga/desliga a NF-e';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into nf_acessos values ('00000000-0000-0000-0000-00000000000c', '33333333000133');
select pg_temp.ok((select count(*) = 3 from nf_empresas), 'admin cadastra empresa e libera acesso');
reset role;

-- ---------------------------------------------------------------- Área do Cliente: apps
insert into apps (id, nome, url, ativo) values ('chamados', 'Chamados', '/apps/chamados/', true), ('velho', 'Velho', '/v/', false);
insert into app_acessos values ('00000000-0000-0000-0000-00000000000b', 'notas'), ('00000000-0000-0000-0000-00000000000b', 'velho');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select array_agg(id order by id) = array['notas'] from apps), 'cliente vê só app liberado e ativo');
do $$ begin
  begin insert into app_acessos values ('00000000-0000-0000-0000-00000000000b', 'chamados'); raise exception 'FALHOU: cliente se liberou app';
  exception when insufficient_privilege then raise notice 'ok  cliente não se libera app'; end;
  begin insert into apps (id, nome, url) values ('hack', 'Hack', '/h/'); raise exception 'FALHOU: cliente criou app';
  exception when insufficient_privilege then raise notice 'ok  cliente não cria app'; end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((select count(*) = 0 from apps), 'login sem app liberado não vê apps');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.ok((select count(*) = 4 from apps), 'admin vê todos os apps, inclusive inativos');
insert into app_acessos values ('00000000-0000-0000-0000-00000000000c', 'chamados');
update apps set ativo = false where id = 'chamados';
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((select count(*) = 0 from apps), 'app desativado some para o cliente');
reset role;
select pg_temp.ok((select cartao_url = '/apps/notas/ajuda/cartao.html' and manual_url = '/apps/notas/ajuda/manual.html' from apps where id = 'notas'),
  'app Notas tem cartão de referência e manual');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select manual_url <> '' from apps where id = 'notas'), 'cliente lê o endereço do manual');
reset role;
\echo 'TODOS OS TESTES SQL OK'
