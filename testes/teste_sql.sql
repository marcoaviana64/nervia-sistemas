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
select pg_temp.ok((select count(*) = 6 from apps), 'admin vê todos os apps, inclusive inativos');
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
-- ---------------------------------------------------------------- auditoria
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into nf_acessos values ('00000000-0000-0000-0000-00000000000c', '22222222000122');
delete from nf_acessos where user_id = '00000000-0000-0000-0000-00000000000c' and cnpj = '22222222000122';
update nf_empresas set termo_status = 'assinado', termo_signatario = 'Sócia Linum', termo_assinado_em = '2026-10-14' where cnpj = '22222222000122';
select pg_temp.ok((select count(*) = 2 from auditoria where acao in ('acesso_empresa_liberado', 'acesso_empresa_retirado')
  and cnpj = '22222222000122' and papel = 'admin' and email = 'marco@nervia.com.br' and detalhes->>'login' = 'outro@x.com'), 'auditoria registra quem liberou/retirou acesso');
select pg_temp.ok((select count(*) >= 1 from auditoria where acao = 'termo_registrado' and detalhes->>'signatario' = 'Sócia Linum'), 'auditoria registra o termo');
select pg_temp.ok((select count(*) >= 1 from auditoria where acao in ('nfe_ligada', 'nfe_desligada') and papel = 'admin'), 'auditoria registra NF-e ligada/desligada');
do $$ begin
  begin insert into auditoria (papel, acao) values ('admin', 'forjado'); raise exception 'FALHOU: tela gravou auditoria';
  exception when insufficient_privilege then raise notice 'ok  tela não grava auditoria direto'; end;
  begin update auditoria set acao = 'x'; raise exception 'FALHOU: admin alterou auditoria';
  exception when insufficient_privilege or raise_exception then raise notice 'ok  admin não altera auditoria'; end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) > 0 and bool_and(cnpj = '22222222000122') from auditoria), 'cliente vê só a auditoria da própria empresa');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((select count(*) = 0 from auditoria where cnpj is distinct from '33333333000133'), 'login só vê auditoria das empresas que acessa (nem a geral)');
reset role;
set role service_role;
insert into auditoria (user_id, email, papel, acao, cnpj, detalhes, ip, navegador)
values ('00000000-0000-0000-0000-00000000000b', 'financeiro@linum.com.br', 'cliente', 'manifestacao_ciencia', '22222222000122', '{"protocolos":["135"]}', '1.2.3.4', 'teste');
select pg_temp.ok((select count(*) = 1 from auditoria where acao = 'manifestacao_ciencia'), 'funções gravam auditoria');
do $$ begin
  begin delete from auditoria; raise exception 'FALHOU: apagou auditoria';
  exception when raise_exception then raise notice 'ok  auditoria não pode ser apagada nem pelas funções'; end;
end $$;
reset role;
do $$ begin
  begin update auditoria set acao = 'x'; raise exception 'FALHOU: superusuário alterou';
  exception when raise_exception then raise notice 'ok  auditoria imutável até para o dono do banco (gatilho)'; end;
end $$;
-- ---------------------------------------------------------------- acessos do site
do $$ declare seg text := (select valor from site_config where chave = 'acessos_segredo'); begin
  if length(seg) < 40 then raise exception 'FALHOU: segredo gerado na migração'; end if;
  raise notice 'ok  migração gera o segredo do worker';
end $$;
set role anon;
do $$ begin
  begin perform site_registrar_acesso('errado', '1.1.1.1', 'BR', 'Rio de Janeiro', 'RJ', 'Niterói', '/', '', 'Mozilla');
    raise exception 'FALHOU: aceitou segredo errado';
  exception when insufficient_privilege then raise notice 'ok  segredo errado é recusado'; end;
  begin perform 1 from site_config; raise exception 'FALHOU: anon leu o segredo';
  exception when insufficient_privilege then raise notice 'ok  anon não lê o segredo'; end;
  begin insert into site_acessos (ip) values ('9.9.9.9'); raise exception 'FALHOU: anon gravou direto';
  exception when insufficient_privilege then raise notice 'ok  anon não grava direto em site_acessos'; end;
end $$;
reset role;
create temp table seg as select valor from site_config where chave = 'acessos_segredo';
grant select on seg to anon;
set role anon;
select site_registrar_acesso((select valor from seg), '1.1.1.1', 'BR', 'Rio de Janeiro', 'RJ', 'Niterói', '/', 'google.com', 'Mozilla/5.0 (iPhone)');
select site_registrar_acesso((select valor from seg), '1.1.1.1', 'BR', 'Rio de Janeiro', 'RJ', 'Niterói', '/', '', 'Mozilla/5.0 (iPhone)');
select site_registrar_acesso((select valor from seg), '1.1.1.1', 'BR', 'Rio de Janeiro', 'RJ', 'Niterói', '/demo/', '', 'Mozilla/5.0 (iPhone)');
select site_registrar_acesso((select valor from seg), '2.2.2.2', 'BR', 'São Paulo', 'SP', 'Campinas', '/', '', 'Googlebot/2.1');
reset role;
select pg_temp.ok((select count(*) = 2 from site_acessos), 'grava acessos; recarga em 10 s e robô não contam');
select pg_temp.ok((select dispositivo = 'Celular' and origem = 'google.com' and estado_sigla = 'RJ' from site_acessos where pagina = '/'), 'grava local, origem e aparelho');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 0 from site_acessos), 'cliente não vê acessos do site');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.ok((select count(*) = 2 from site_acessos), 'admin vê acessos do site');
reset role;
update site_acessos set quando = now() - interval '91 days' where pagina = '/demo/';
select pg_temp.ok(site_anonimizar_acessos() = 1, 'anonimiza depois de 90 dias');
select pg_temp.ok((select ip is null and navegador is null and cidade = 'Niterói' from site_acessos where pagina = '/demo/')
  and (select ip = '1.1.1.1' from site_acessos where pagina = '/'), 'some IP e navegador; contagem e local ficam');
-- ---------------------------------------------------------------- Auditoria de Telefonia Móvel (tel_)
reset role;
reset request.jwt.claim.sub;
select pg_temp.ok((select count(*) = 1 from apps where id = 'telefonia' and cartao_url like '/apps/telefonia/ajuda/%'), 'app telefonia cadastrado com cartão e manual');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into tel_relatorios (id, titulo, empresa, linhas, dados) values
  ('10000000-0000-0000-0000-000000000001', 'Cliente A', 'CLIENTE A LTDA', '[{"n":"5521900000001","dono":"Ana","fr":100}]', '{"inicio":"2026-04-01","fim":"2026-10-15"}'),
  ('10000000-0000-0000-0000-000000000002', 'Cliente B', 'CLIENTE B LTDA', '[]', '{"inicio":"2026-05-01","fim":"2026-10-15"}');
insert into tel_acessos values ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001');
select pg_temp.ok((select count(*) = 2 from tel_relatorios), 'admin vê todos os relatórios (publicados ou não)');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 0 from tel_relatorios), 'cliente não vê relatório ainda não publicado');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update tel_relatorios set publicado = true;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 1 and min(titulo) = 'Cliente A' from tel_relatorios), 'cliente vê só o relatório publicado e liberado para ele');
update tel_relatorios set titulo = 'hack';
select pg_temp.ok((select titulo from tel_relatorios) = 'Cliente A', 'cliente não altera relatório');
do $$ begin
  begin insert into tel_relatorios (titulo) values ('x'); raise exception 'FALHOU: cliente criou relatório';
  exception when insufficient_privilege then raise notice 'ok  cliente não cria relatório'; end;
  begin insert into tel_acessos values ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000002'); raise exception 'FALHOU: cliente se liberou';
  exception when insufficient_privilege then raise notice 'ok  cliente não libera acesso para si'; end;
end $$;
delete from tel_relatorios;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((select count(*) = 0 from tel_relatorios), 'login sem acesso não vê relatório publicado');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.ok((select count(*) = 2 from tel_relatorios), 'exclusão do cliente não teve efeito');
update tel_relatorios set dados = '{"inicio":"2026-04-01","fim":"2026-11-15"}' where titulo = 'Cliente A';
select pg_temp.ok((select dados_em is not null and atualizado_em is not null from tel_relatorios where titulo = 'Cliente A'), 'carimbo de dados pelo servidor');
insert into tel_arquivos (relatorio_id, nome, tipo, conteudo) values ('10000000-0000-0000-0000-000000000001', 'Relatorio-Dados-1.csv', 'dados', 'x');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 0 from tel_arquivos), 'cliente não lê os arquivos originais');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
delete from tel_acessos;
delete from tel_relatorios where titulo = 'Cliente B';
reset role;
select pg_temp.ok((select count(*) from auditoria where acao like 'telefonia_%') = 9
  and exists (select 1 from auditoria where acao = 'telefonia_dados_atualizados' and detalhes ->> 'periodo' = '2026-04-01 a 2026-11-15' and papel = 'admin')
  and exists (select 1 from auditoria where acao = 'telefonia_acesso_liberado' and detalhes ->> 'login' = 'financeiro@linum.com.br'),
  'auditoria: criar (2), liberar, publicar (2), dados, arquivo, retirar acesso, excluir');

-- ---------------------------------------------------------------- Orçamentos de Compras (cmp_)
reset role;
reset request.jwt.claim.sub;
create or replace function pg_temp.erro(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin execute cmd; exception when others then
    if sqlerrm ilike '%' || trecho || '%' then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % (erro diferente: %)', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % (não deu erro)', nome;
end $$;
create or replace function pg_temp.como(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false) $$;
select pg_temp.ok((select count(*) = 1 from apps where id = 'compras' and cartao_url = '/apps/compras/ajuda/cartao.html'), 'app compras cadastrado com cartão e manual');
select pg_temp.ok(cmp_doc_valido('PJ', '11222333000181') and cmp_doc_valido('PJ', '12ABC345000188') and cmp_doc_valido('PF', '52998224725')
  and not cmp_doc_valido('PJ', '11222333000182') and not cmp_doc_valido('PF', '11111111111') and not cmp_doc_valido('PJ', '12ABC345000189'),
  'CPF, CNPJ numérico e CNPJ alfanumérico: dígitos verificadores');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'solicitante@itaipu.com', '{"nome":"Carla"}'),
  ('00000000-0000-0000-0000-0000000000d2', 'comprador@itaipu.com', '{"nome":"Rafael"}'),
  ('00000000-0000-0000-0000-0000000000d3', 'gerente@itaipu.com', '{"nome":"Sonia"}'),
  ('00000000-0000-0000-0000-0000000000d4', 'diretor@adm.com', '{"nome":"Augusto"}'),
  ('00000000-0000-0000-0000-0000000000d5', 'comprador@parksul.com', '{"nome":"Paulo"}');
insert into cmp_unidades (id, nome) values ('20000000-0000-0000-0000-000000000002', 'Shopping Park Sul');
insert into cmp_membros select '00000000-0000-0000-0000-0000000000d1', id, 'solicitante' from cmp_unidades where nome = 'Multicenter Itaipu';
insert into cmp_membros select '00000000-0000-0000-0000-0000000000d2', id, 'comprador' from cmp_unidades where nome = 'Multicenter Itaipu';
insert into cmp_membros select '00000000-0000-0000-0000-0000000000d3', id, 'gerente' from cmp_unidades where nome = 'Multicenter Itaipu';
insert into cmp_membros select '00000000-0000-0000-0000-0000000000d4', id, 'diretor' from cmp_unidades where nome = 'Multicenter Itaipu';
insert into cmp_membros values ('00000000-0000-0000-0000-0000000000d5', '20000000-0000-0000-0000-000000000002', 'comprador');
create temp table ids (k text primary key, v text);
insert into ids select 'itaipu', id::text from cmp_unidades where nome = 'Multicenter Itaipu';
grant all on ids to authenticated;
create or replace function pg_temp.id(k text) returns text language sql as $$ select v from ids where ids.k = id.k $$;

set role authenticated;
-- solicitante cria requisição; status/autor vêm do servidor
select pg_temp.como('00000000-0000-0000-0000-0000000000d1');
insert into cmp_requisicoes (unidade_id, grupo, titulo, quantidade, valor_estimado) values (pg_temp.id('itaipu')::uuid, 'Tecnologia', 'Switch 24 portas', 2, 9000);
select pg_temp.ok((select status = 'nova' and solicitante_nome = 'Carla' and id = 1001 from cmp_requisicoes), 'solicitante cria requisição (nº 1001, nova, autor do servidor)');
select pg_temp.erro($$insert into cmp_requisicoes (unidade_id, grupo, titulo, status) values ('$$ || pg_temp.id('itaipu') || $$', 'Tecnologia', 'x', 'aprovada')$$, 'permission', 'tela não escolhe status da requisição');
select pg_temp.erro($$select cmp_salvar_fornecedor(null, 'PJ', '11.222.333/0001-81', 'Forn A', '{Tecnologia}', '', '', '', null, '', '$$ || pg_temp.id('itaipu') || $$')$$, 'comprador, gerente ou diretor', 'solicitante não cadastra fornecedor');
-- outra unidade não vê
select pg_temp.como('00000000-0000-0000-0000-0000000000d5');
select pg_temp.ok((select count(*) = 0 from cmp_requisicoes), 'comprador do Park Sul não vê requisições do Itaipu');
select pg_temp.erro($$insert into cmp_requisicoes (unidade_id, grupo, titulo) values ('$$ || pg_temp.id('itaipu') || $$', 'Tecnologia', 'x')$$, 'row-level security', 'não cria requisição em unidade alheia');
-- login sem papel nenhum não vê fornecedores
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) = 0 from cmp_fornecedores_lista()), 'login sem papel em Compras não vê fornecedores');
select pg_temp.erro('select * from cmp_fornecedores', 'permission', 'tabela de fornecedores (com CPF) não é lida direto');

-- comprador cadastra fornecedores
select pg_temp.como('00000000-0000-0000-0000-0000000000d2');
insert into ids select 'fa', cmp_salvar_fornecedor(null, 'PJ', '11.222.333/0001-81', 'Forn A', '{Tecnologia}', 'Ana', '', '', current_date + 100, '', pg_temp.id('itaipu')::uuid);
insert into ids select 'fb', cmp_salvar_fornecedor(null, 'PJ', '22333444000181', 'Forn B', '{Tecnologia}', '', '', '', current_date + 100, '', pg_temp.id('itaipu')::uuid);
insert into ids select 'fc', cmp_salvar_fornecedor(null, 'PJ', '12abc345000188', 'Forn C (alfanumérico)', '{Tecnologia}', '', '', '', current_date + 100, '', pg_temp.id('itaipu')::uuid);
insert into ids select 'fp', cmp_salvar_fornecedor(null, 'PF', '529.982.247-25', 'José Eletricista', '{Energia}', '', '', '', current_date + 100, '', pg_temp.id('itaipu')::uuid);
insert into ids select 'fv', cmp_salvar_fornecedor(null, 'PJ', '33444555000181', 'Forn Vencido', '{Tecnologia}', '', '', '', current_date - 1, '', pg_temp.id('itaipu')::uuid);
select pg_temp.erro($$select cmp_salvar_fornecedor(null, 'PJ', '11222333000181', 'Duplicado', '{}', '', '', '', null, '', '$$ || pg_temp.id('itaipu') || $$')$$, 'já está cadastrado: Forn A', 'CNPJ duplicado é recusado e mostra o existente');
select pg_temp.erro($$select cmp_salvar_fornecedor(null, 'PF', '52998224726', 'Errado', '{}', '', '', '', null, '', '$$ || pg_temp.id('itaipu') || $$')$$, 'CPF inválido', 'CPF com dígito errado é recusado');
select pg_temp.ok((select documento = '12ABC345000188' from cmp_fornecedores_lista() where nome like 'Forn C%'), 'CNPJ alfanumérico gravado normalizado (maiúsculas, sem pontuação)');
select pg_temp.ok((select documento = '52998224725' and cadastrado_nome = 'Rafael' from cmp_fornecedores_lista() where tipo = 'PF'), 'quem cadastrou vê o CPF completo e fica registrado');
select pg_temp.como('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok((select documento = '***982247**' from cmp_fornecedores_lista() where tipo = 'PF'), 'outros veem o CPF mascarado');
select pg_temp.erro($$select cmp_salvar_fornecedor('$$ || pg_temp.id('fa') || $$', 'PJ', '', 'Hack', '{}', '', '', '', null, '', null)$$, 'Só quem cadastrou', 'só quem cadastrou altera o fornecedor');
select pg_temp.como('00000000-0000-0000-0000-0000000000d5');
select pg_temp.ok((select count(*) = 5 from cmp_fornecedores_lista()), 'base de fornecedores é única (Park Sul vê os do Itaipu)');

-- cotação
select pg_temp.como('00000000-0000-0000-0000-0000000000d1');
select pg_temp.erro('select cmp_salvar_proposta(1001, ''' || pg_temp.id('fa') || ''', 4000, 100, 0, 10, ''30 dias'', 30, null, '''')', 'precisa ser: comprador', 'solicitante não registra proposta');
select pg_temp.como('00000000-0000-0000-0000-0000000000d2');
select pg_temp.erro('select cmp_salvar_proposta(1001, ''' || pg_temp.id('fv') || ''', 1, 0, 0, 1, ''x'', 0, null, '''')', 'certidões de Forn Vencido venceram', 'fornecedor com certidão vencida não entra');
select cmp_salvar_proposta(1001, pg_temp.id('fa')::uuid, 4000, 100, 0, 10, '30 dias', 30, null, '');
select cmp_salvar_proposta(1001, pg_temp.id('fb')::uuid, 4300, 0, 0, 3, 'À vista', 0, null, '');
select pg_temp.ok((select status = 'cotacao' from cmp_requisicoes where id = 1001), 'primeira proposta passa a requisição para Em cotação');
select pg_temp.ok((select id::text from cmp_propostas where fornecedor_id = pg_temp.id('fa')::uuid) is not null, 'membro lê as propostas');
insert into ids select 'pa', id::text from cmp_propostas where fornecedor_id = pg_temp.id('fa')::uuid;
insert into ids select 'pb', id::text from cmp_propostas where fornecedor_id = pg_temp.id('fb')::uuid;
select pg_temp.erro('select cmp_escolher(1001, ' || pg_temp.id('pb') || ', '''')', 'não é o menor preço', 'escolher quem não é o menor preço exige justificativa');
select cmp_escolher(1001, pg_temp.id('pb')::bigint, 'Prazo de 3 dias; o outro leva 10.');
select pg_temp.erro('select cmp_enviar_aprovacao(1001)', 'mínimo é 3', 'trava: menos de 3 propostas não vai para aprovação');
select cmp_salvar_proposta(1001, pg_temp.id('fc')::uuid, 4500, 0, 0, 5, '28 dias', 28, null, '');
select pg_temp.ok((select proposta_escolhida is null from cmp_requisicoes where id = 1001), 'mudança nas propostas desfaz a escolha');
-- re-cotação: Forn A baixa o preço
select cmp_salvar_proposta(1001, pg_temp.id('fa')::uuid, 3900, 100, 0, 10, '30 dias', 30, null, '');
select pg_temp.ok((select rodada = 2 and preco_anterior = 4000 from cmp_propostas where id = pg_temp.id('pa')::bigint), 're-cotação guarda o preço anterior e a rodada');
select cmp_escolher(1001, pg_temp.id('pb')::bigint, 'Prazo de 3 dias; o outro leva 10.');
select pg_temp.ok(cmp_enviar_aprovacao(1001) = 'gerente', '8.600 (não é o menor) vai ao Gerente');
select pg_temp.ok((select fornecedor_novo and cadastrado_pelo_comprador and status = 'aprovacao' from cmp_requisicoes where id = 1001), 'marca fornecedor novo e cadastrado pelo próprio comprador');
select pg_temp.erro('select cmp_decidir(1001, true, '''', false)', 'Esta etapa é do Gerente', 'comprador não aprova');
select pg_temp.como('00000000-0000-0000-0000-0000000000d4');
select pg_temp.erro('select cmp_decidir(1001, true, '''', false)', 'Esta etapa é do Gerente', 'Diretor não pula a etapa do Gerente');
select pg_temp.como('00000000-0000-0000-0000-0000000000d3');
select pg_temp.erro('select cmp_decidir(1001, false, '''', false)', 'motivo', 'reprovar exige motivo');
select pg_temp.ok(cmp_decidir(1001, true, 'ok', true) = 'aprovada', 'Gerente aprova (até 50 mil termina aqui)');
select pg_temp.ok((select count(*) = 1 from cmp_avais where fornecedor_id = pg_temp.id('fb')::uuid), 'Gerente deu o aval ao aprovar');
select pg_temp.erro('insert into cmp_aprovacoes (requisicao_id, etapa, decisao) values (1001, ''diretor'', ''aprovado'')', 'permission', 'aprovação não é gravada direto pela tela');
select pg_temp.como('00000000-0000-0000-0000-0000000000d2');
select cmp_emitir_pedido(1001);
select cmp_marcar_entregue(1001);
select pg_temp.erro('select cmp_avaliar(1001, 5, 5, 5, 5, '''')', 'precisa ser: gerente', 'só o Gerente avalia');
select pg_temp.como('00000000-0000-0000-0000-0000000000d3');
select cmp_avaliar(1001, 5, 4, 5, 4, 'Entregou antes do prazo');
select pg_temp.ok((select nota = 4.5 and avaliacoes = 1 and compras = 1 from cmp_fornecedores_lista() where nome = 'Forn B'), 'nota = média da avaliação; compra contada');
select pg_temp.ok((select status = 'concluida' from cmp_requisicoes where id = 1001), 'avaliação conclui a requisição');

-- segunda compra com Forn B, barata e menor preço: agora é automática (não é mais fornecedor novo)
select pg_temp.como('00000000-0000-0000-0000-0000000000d1');
insert into cmp_requisicoes (unidade_id, grupo, titulo, quantidade) values (pg_temp.id('itaipu')::uuid, 'Tecnologia', 'Cabo de rede', 1);
insert into ids select 'r2', max(id)::text from cmp_requisicoes;
select pg_temp.como('00000000-0000-0000-0000-0000000000d2');
select cmp_salvar_proposta(pg_temp.id('r2')::bigint, pg_temp.id('fb')::uuid, 300, 0, 0, 2, 'À vista', 0, null, '');
select cmp_salvar_proposta(pg_temp.id('r2')::bigint, pg_temp.id('fa')::uuid, 350, 0, 0, 2, 'À vista', 0, null, '');
select cmp_salvar_proposta(pg_temp.id('r2')::bigint, pg_temp.id('fc')::uuid, 360, 0, 0, 2, 'À vista', 0, null, '');
select cmp_escolher(pg_temp.id('r2')::bigint, (select id from cmp_propostas where requisicao_id = pg_temp.id('r2')::bigint and fornecedor_id = pg_temp.id('fb')::uuid), '');
select pg_temp.ok(cmp_enviar_aprovacao(pg_temp.id('r2')::bigint) = 'automatica', 'até 5 mil, menor preço e fornecedor já usado: aprovação automática');
select pg_temp.ok((select count(*) = 1 from cmp_aprovacoes where requisicao_id = pg_temp.id('r2')::bigint and etapa = 'sistema'), 'aprovação automática registrada');

-- terceira: barata e menor preço, mas fornecedor NOVO → Gerente; acima de 50 mil → Diretor
select pg_temp.como('00000000-0000-0000-0000-0000000000d1');
insert into cmp_requisicoes (unidade_id, grupo, titulo, quantidade) values (pg_temp.id('itaipu')::uuid, 'Tecnologia', 'Servidor', 1);
insert into ids select 'r3', max(id)::text from cmp_requisicoes;
select pg_temp.como('00000000-0000-0000-0000-0000000000d2');
select cmp_salvar_proposta(pg_temp.id('r3')::bigint, pg_temp.id('fc')::uuid, 60000, 0, 0, 20, '30/60', 45, null, '');
select cmp_excecao(pg_temp.id('r3')::bigint, 'Revenda exclusiva do fabricante no estado.');
select cmp_escolher(pg_temp.id('r3')::bigint, (select id from cmp_propostas where requisicao_id = pg_temp.id('r3')::bigint), '');
select pg_temp.ok(cmp_enviar_aprovacao(pg_temp.id('r3')::bigint) = 'diretor', 'exceção de exclusividade libera envio com 1 proposta; acima de 50 mil = Diretor');
select pg_temp.como('00000000-0000-0000-0000-0000000000d3');
select pg_temp.ok(cmp_decidir(pg_temp.id('r3')::bigint, true, '', false) = 'aprovacao', 'Gerente aprova e segue para o Diretor');
select pg_temp.ok((select count(*) = 0 from cmp_avais where fornecedor_id = pg_temp.id('fc')::uuid), 'sem marcar, não dá aval');
select pg_temp.como('00000000-0000-0000-0000-0000000000d4');
select pg_temp.ok(cmp_decidir(pg_temp.id('r3')::bigint, true, 'ok diretoria', false) = 'aprovada', 'Diretor aprova');

-- quem envia não aprova (mesmo tendo papel de gerente)
reset role;
insert into cmp_membros select '00000000-0000-0000-0000-0000000000d2', pg_temp.id('itaipu')::uuid, 'gerente';
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000d1');
insert into cmp_requisicoes (unidade_id, grupo, titulo, quantidade) values (pg_temp.id('itaipu')::uuid, 'Tecnologia', 'Mouse', 1);
insert into ids select 'r4', max(id)::text from cmp_requisicoes;
select pg_temp.como('00000000-0000-0000-0000-0000000000d2');
select cmp_salvar_proposta(pg_temp.id('r4')::bigint, pg_temp.id('fa')::uuid, 100, 0, 0, 2, 'À vista', 0, null, '');
select cmp_excecao(pg_temp.id('r4')::bigint, 'Teste de segregação de funções.');
select cmp_escolher(pg_temp.id('r4')::bigint, (select id from cmp_propostas where requisicao_id = pg_temp.id('r4')::bigint), '');
select pg_temp.ok(cmp_enviar_aprovacao(pg_temp.id('r4')::bigint) = 'gerente', 'fornecedor novo (Forn A nunca comprado) vai ao Gerente mesmo barato');
select pg_temp.erro('select cmp_decidir(' || pg_temp.id('r4') || ', true, '''', false)', 'não pode aprová-la', 'quem enviou não aprova a própria compra');
select pg_temp.como('00000000-0000-0000-0000-0000000000d3');
select cmp_decidir(pg_temp.id('r4')::bigint, false, 'Comprar no almoxarifado.', false);
select pg_temp.ok((select status = 'reprovada' from cmp_requisicoes where id = pg_temp.id('r4')::bigint), 'Gerente reprova com motivo');

-- aval por shopping: Gerente do Itaipu não dá aval pelo Park Sul
select pg_temp.erro('select cmp_aval(''' || pg_temp.id('fa') || ''', ''20000000-0000-0000-0000-000000000002'', true)', 'Só o Gerente', 'aval é por shopping');
select cmp_aval(pg_temp.id('fa')::uuid, pg_temp.id('itaipu')::uuid, true);
select pg_temp.ok((select jsonb_array_length(avais) = 1 and avais->0->>'unidade' = 'Multicenter Itaipu' from cmp_fornecedores_lista() where nome = 'Forn A'), 'aval do Itaipu aparece na lista');

-- imutabilidade e auditoria
reset role;
select pg_temp.erro('delete from cmp_historico', 'somente inclusão', 'histórico não pode ser apagado (nem pelo dono)');
select pg_temp.erro('update cmp_avaliacoes set prazo = 1', 'somente inclusão', 'avaliação não pode ser alterada');
select pg_temp.ok((select count(*) >= 25 from cmp_historico) and exists (select 1 from auditoria where acao = 'compras_aprovada_gerente')
  and exists (select 1 from auditoria where acao = 'compras_fornecedor_avaliado') and exists (select 1 from auditoria where acao = 'compras_papel_concedido'),
  'histórico do app e auditoria da plataforma gravados');
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000d5');
select pg_temp.ok((select count(*) = 0 from cmp_historico where unidade_id = pg_temp.id('itaipu')::uuid), 'histórico do Itaipu não aparece para o Park Sul');
reset role;
\echo 'TODOS OS TESTES SQL OK'
