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
select pg_temp.ok((select count(*) = 10 from apps), 'admin vê todos os apps, inclusive inativos');
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
select pg_temp.ok((select count(*) = 22 and bool_and(descricao <> '') from cmp_grupos) and not exists (select 1 from cmp_grupos where nome in ('Tecnologia', 'Refrigeração', 'Jardinagem'))
  and (select string_agg(nome, '|' order by ordem) from (select nome, ordem from cmp_grupos order by ordem limit 3) x) = 'Informática e tecnologia|Papelaria e material de escritório|Material de limpeza e higiene',
  'grupos de compra da lista do Marco, com descrição e na ordem');
select pg_temp.ok((select count(*) = 1 from apps where id = 'compras' and cartao_url = '/apps/compras/ajuda/cartao.html' and mapa_url = '/apps/compras/ajuda/mapa.html'), 'app compras cadastrado com cartão, manual e mapa mental');
select pg_temp.ok(cmp_doc_valido('PJ', '11222333000181') and cmp_doc_valido('PJ', '12ABC345000188') and cmp_doc_valido('PF', '52998224725')
  and not cmp_doc_valido('PJ', '11222333000182') and not cmp_doc_valido('PF', '11111111111') and not cmp_doc_valido('PJ', '12ABC345000189'),
  'CPF, CNPJ numérico e CNPJ alfanumérico: dígitos verificadores');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'solicitante@itaipu.com', '{"nome":"Carla"}'),
  ('00000000-0000-0000-0000-0000000000d2', 'comprador@itaipu.com', '{"nome":"Rafael"}'),
  ('00000000-0000-0000-0000-0000000000d3', 'gerente@itaipu.com', '{"nome":"Sonia"}'),
  ('00000000-0000-0000-0000-0000000000d4', 'diretor@adm.com', '{"nome":"Augusto"}'),
  ('00000000-0000-0000-0000-0000000000d5', 'comprador@parksul.com', '{"nome":"Paulo"}');
insert into cmp_unidades (id, nome) values ('20000000-0000-0000-0000-000000000002', 'Filial Park Sul');
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
insert into cmp_requisicoes (unidade_id, grupo, titulo, quantidade, valor_estimado) values (pg_temp.id('itaipu')::uuid, 'Informática e tecnologia', 'Switch 24 portas', 2, 9000);
select pg_temp.ok((select status = 'nova' and solicitante_nome = 'Carla' and id = 1001 from cmp_requisicoes), 'solicitante cria requisição (nº 1001, nova, autor do servidor)');
select pg_temp.erro($$insert into cmp_requisicoes (unidade_id, grupo, titulo, status) values ('$$ || pg_temp.id('itaipu') || $$', 'Informática e tecnologia', 'x', 'aprovada')$$, 'permission', 'tela não escolhe status da requisição');
select pg_temp.erro($$select cmp_salvar_fornecedor(null, 'PJ', '11.222.333/0001-81', 'Forn A', '{"Informática e tecnologia"}', '', '', '', null, '', '$$ || pg_temp.id('itaipu') || $$')$$, 'comprador, gerente ou diretor', 'solicitante não cadastra fornecedor');
-- outra unidade não vê
select pg_temp.como('00000000-0000-0000-0000-0000000000d5');
select pg_temp.ok((select count(*) = 0 from cmp_requisicoes), 'comprador do Park Sul não vê requisições do Itaipu');
select pg_temp.erro($$insert into cmp_requisicoes (unidade_id, grupo, titulo) values ('$$ || pg_temp.id('itaipu') || $$', 'Informática e tecnologia', 'x')$$, 'row-level security', 'não cria requisição em unidade alheia');
-- login sem papel nenhum não vê fornecedores
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) = 0 from cmp_fornecedores_lista()), 'login sem papel em Compras não vê fornecedores');
select pg_temp.erro('select * from cmp_fornecedores', 'permission', 'tabela de fornecedores (com CPF) não é lida direto');

-- comprador cadastra fornecedores
select pg_temp.como('00000000-0000-0000-0000-0000000000d2');
insert into ids select 'fa', cmp_salvar_fornecedor(null, 'PJ', '11.222.333/0001-81', 'Forn A', '{"Informática e tecnologia"}', 'Ana', '', '', current_date + 100, '', pg_temp.id('itaipu')::uuid);
insert into ids select 'fb', cmp_salvar_fornecedor(null, 'PJ', '22333444000181', 'Forn B', '{"Informática e tecnologia"}', '', '', '', current_date + 100, '', pg_temp.id('itaipu')::uuid);
insert into ids select 'fc', cmp_salvar_fornecedor(null, 'PJ', '12abc345000188', 'Forn C (alfanumérico)', '{"Informática e tecnologia"}', '', '', '', current_date + 100, '', pg_temp.id('itaipu')::uuid);
insert into ids select 'fp', cmp_salvar_fornecedor(null, 'PF', '529.982.247-25', 'José Eletricista', '{"Água e energia"}', '', '', '', current_date + 100, '', pg_temp.id('itaipu')::uuid);
insert into ids select 'fv', cmp_salvar_fornecedor(null, 'PJ', '33444555000181', 'Forn Vencido', '{"Informática e tecnologia"}', '', '', '', current_date - 1, '', pg_temp.id('itaipu')::uuid);
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
insert into cmp_requisicoes (unidade_id, grupo, titulo, quantidade) values (pg_temp.id('itaipu')::uuid, 'Informática e tecnologia', 'Cabo de rede', 1);
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
insert into cmp_requisicoes (unidade_id, grupo, titulo, quantidade) values (pg_temp.id('itaipu')::uuid, 'Informática e tecnologia', 'Servidor', 1);
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
insert into cmp_requisicoes (unidade_id, grupo, titulo, quantidade) values (pg_temp.id('itaipu')::uuid, 'Informática e tecnologia', 'Mouse', 1);
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

-- aval por unidade: Gerente do Itaipu não dá aval pelo Park Sul
select pg_temp.erro('select cmp_aval(''' || pg_temp.id('fa') || ''', ''20000000-0000-0000-0000-000000000002'', true)', 'Só o Gerente', 'aval é por unidade');
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
-- ---------------------------------------------------------------- Compras fase 2: proposta enviada pelo fornecedor (link)
grant all on ids to anon;
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000d1');
insert into cmp_requisicoes (unidade_id, grupo, titulo, quantidade, valor_estimado, descricao) values (pg_temp.id('itaipu')::uuid, 'Informática e tecnologia', 'Nobreak 3 kVA', 2, 7000, 'Senoidal, rack');
insert into ids select 'r5', max(id)::text from cmp_requisicoes;
select pg_temp.erro('select cmp_convidar(' || pg_temp.id('r5') || ', ''' || pg_temp.id('fa') || ''', '''', '''', '''', current_date + 5)', 'precisa ser: comprador', 'solicitante não convida fornecedor');
select pg_temp.como('00000000-0000-0000-0000-0000000000d2');
select pg_temp.erro('select cmp_convidar(' || pg_temp.id('r5') || ', ''' || pg_temp.id('fa') || ''', '''', '''', '''', cmp_hoje() - 1)', 'hoje ou depois', 'prazo no passado é recusado');
insert into ids select 'ca', cmp_convidar(pg_temp.id('r5')::bigint, pg_temp.id('fa')::uuid, '', '21999990000', '', current_date + 5) ->> 'codigo';
select pg_temp.ok(pg_temp.id('ca') ~ '^[0-9a-f]{64}$', 'convite gera código de 64 caracteres');
select pg_temp.ok((select status = 'cotacao' from cmp_requisicoes where id = pg_temp.id('r5')::bigint), 'convidar passa a requisição para Em cotação');
select pg_temp.erro('select cmp_convidar(' || pg_temp.id('r5') || ', ''' || pg_temp.id('fa') || ''', '''', '''', '''', current_date + 5)', 'já tem convite', 'um convite ativo por fornecedor na requisição');
select pg_temp.erro('select cmp_convidar(' || pg_temp.id('r5') || ', null, '''', '''', '''', current_date + 5)', 'sem cadastro', 'convite sem cadastro exige o nome do contato');
insert into ids select 'cn', cmp_convidar(pg_temp.id('r5')::bigint, null, 'Energia Total (Marcos)', '', 'marcos@energiatotal.com', current_date + 5) ->> 'codigo';
insert into ids select 'cx', cmp_convidar(pg_temp.id('r5')::bigint, null, 'Contato que tenta usar CNPJ alheio', '', '', current_date + 5) ->> 'codigo';
select pg_temp.como('00000000-0000-0000-0000-0000000000d5');
select pg_temp.ok((select count(*) = 0 from cmp_convites), 'Park Sul não vê convites do Itaipu');

-- fornecedor, sem login
reset request.jwt.claim.sub;
set role anon;
set request.headers = '{"x-forwarded-for":"200.10.20.30, 10.0.0.1","user-agent":"NavegadorTeste/1.0"}';
select pg_temp.erro('select cmp_cotacao_ler(''abc'')', 'inválido', 'código malformado é recusado');
select pg_temp.erro('select cmp_cotacao_ler(''' || repeat('0', 64) || ''')', 'inválido', 'código inexistente é recusado');
select pg_temp.erro('select * from cmp_convites', 'permission', 'anônimo não lê convites');
select pg_temp.erro('select * from cmp_propostas', 'permission', 'anônimo não lê propostas');
select pg_temp.ok((select x->>'situacao' = 'aberto' and x->'requisicao'->>'titulo' = 'Nobreak 3 kVA' and x->'fornecedor'->>'nome' = 'Forn A'
  and not (x->'requisicao') ? 'valor_estimado' and x->'proposta' = 'null'::jsonb from cmp_cotacao_ler(pg_temp.id('ca')) x),
  'fornecedor lê a requisição pelo código (sem valor estimado)');
select pg_temp.erro($$select cmp_cotacao_enviar('$$ || pg_temp.id('ca') || $$', '{"preco_unitario":"3000","prazo_dias":"7","declarante":"Ana Souza"}')$$, 'declaração', 'sem marcar a declaração não envia');
select pg_temp.erro($$select cmp_cotacao_enviar('$$ || pg_temp.id('ca') || $$', '{"preco_unitario":"3000","prazo_dias":"7","aceite":true}')$$, 'seu nome', 'sem o nome de quem envia não envia');
select pg_temp.erro($$select cmp_cotacao_enviar('$$ || pg_temp.id('ca') || $$', '{"preco_unitario":"abc","prazo_dias":"7","declarante":"Ana","aceite":true}')$$, 'Confira os números', 'número inválido é recusado');
select pg_temp.erro($$select cmp_cotacao_enviar('$$ || pg_temp.id('ca') || $$', '{"preco_unitario":"3000","prazo_dias":"7","declarante":"Ana Souza","aceite":true,"anexo":"$$ || pg_temp.id('ca') || $$/nao-existe.pdf"}')$$, 'PDF não foi recebido', 'anexo que não está no Storage é recusado');
select pg_temp.erro($$insert into storage.objects (bucket_id, name) values ('cmp-propostas', '$$ || repeat('0', 64) || $$/x.pdf')$$, 'row-level security', 'Storage: PDF só entra na pasta de convite aberto');
insert into storage.objects (bucket_id, name) values ('cmp-propostas', pg_temp.id('ca') || '/1.pdf');
select pg_temp.ok((cmp_cotacao_enviar(pg_temp.id('ca'), jsonb_build_object('preco_unitario', '3000', 'frete', '50', 'prazo_dias', '7', 'pagamento', '30 dias',
  'pagamento_dias', '30', 'declarante', 'Ana Souza', 'aceite', true, 'anexo', pg_temp.id('ca') || '/1.pdf')) ->> 'protocolo') like 'P-%', 'fornecedor envia a proposta com PDF e recebe protocolo');
select pg_temp.ok((select x->'proposta'->>'preco_unitario' = '3000.00' and (x->'proposta'->>'tem_anexo')::boolean from cmp_cotacao_ler(pg_temp.id('ca')) x), 'fornecedor vê a própria proposta pelo link');
select cmp_cotacao_enviar(pg_temp.id('ca'), '{"preco_unitario":"2900","frete":"50","prazo_dias":"7","pagamento":"30 dias","pagamento_dias":"30","declarante":"Ana Souza","aceite":true}');
-- contato sem cadastro: CNPJ errado, CNPJ de quem já foi convidado, CNPJ novo
select pg_temp.erro($$select cmp_cotacao_enviar('$$ || pg_temp.id('cn') || $$', '{"tipo":"PJ","documento":"44555666000182","nome":"Energia Total","preco_unitario":"3100","prazo_dias":"5","declarante":"Marcos","aceite":true}')$$, 'CNPJ inválido', 'fornecedor sem cadastro: CNPJ com dígito errado é recusado');
select pg_temp.erro($$select cmp_cotacao_enviar('$$ || pg_temp.id('cx') || $$', '{"tipo":"PJ","documento":"11.222.333/0001-81","nome":"x","preco_unitario":"1","prazo_dias":"5","declarante":"Fulano","aceite":true}')$$, 'outro convite', 'CNPJ já convidado nesta cotação não entra por outro link');
select cmp_cotacao_enviar(pg_temp.id('cn'), '{"tipo":"PJ","documento":"44.555.666/0001-81","nome":"Energia Total Ltda","telefone":"2133334444","preco_unitario":"3100","prazo_dias":"5","pagamento":"À vista","declarante":"Marcos Lima","aceite":true}');
reset request.headers;

set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000d2');
select pg_temp.ok((select rodada = 2 and preco_anterior = 3000 and origem = 'fornecedor' and declarante = 'Ana Souza' and anexo like '%/1.pdf' and enviada_ip = '200.10.20.30'
  from cmp_propostas where requisicao_id = pg_temp.id('r5')::bigint and fornecedor_id = pg_temp.id('fa')::uuid), 'reenvio vira nova rodada; guarda declarante, PDF e IP');
select pg_temp.ok((select cadastrado_por = '00000000-0000-0000-0000-0000000000d2' and cadastrado_nome = 'Rafael' and grupos = '{"Informática e tecnologia"}' and documento = '44555666000181'
  from cmp_fornecedores_lista() where nome = 'Energia Total Ltda'), 'fornecedor novo entra na base com quem convidou como responsável');
select pg_temp.ok((select count(*) = 1 from cmp_convites where codigo = pg_temp.id('cn') and fornecedor_id is not null and respondido_em is not null and aberto_em is not null), 'convite ligado ao fornecedor, aberto e respondido');
select pg_temp.erro('select cmp_salvar_proposta(' || pg_temp.id('r5') || ', ''' || pg_temp.id('fa') || ''', 1, 0, 0, 1, ''x'', 0, null, '''')', 'só ele altera', 'comprador não altera proposta enviada pelo fornecedor');
select pg_temp.ok((select count(*) = 1 from storage.objects where bucket_id = 'cmp-propostas'), 'comprador da unidade vê o PDF');
select pg_temp.como('00000000-0000-0000-0000-0000000000d5');
select pg_temp.ok((select count(*) = 0 from storage.objects where bucket_id = 'cmp-propostas'), 'outra unidade não vê o PDF');
select pg_temp.como('00000000-0000-0000-0000-0000000000d2');
select pg_temp.erro('select cmp_excluir_proposta((select id from cmp_propostas where requisicao_id = ' || pg_temp.id('r5') || ' and origem = ''fornecedor'' limit 1))', 'motivo', 'excluir proposta do fornecedor exige motivo');
-- cancelar o convite fecha o link; prazo vencido também
select cmp_convite_cancelar((select id from cmp_convites where codigo = pg_temp.id('cx')));
select cmp_convite_prazo((select id from cmp_convites where codigo = pg_temp.id('ca')), current_date + 10);
reset role;
update cmp_convites set prazo = cmp_hoje() - 1 where codigo = pg_temp.id('cn');
set role anon; reset request.jwt.claim.sub;
select pg_temp.ok((select cmp_cotacao_ler(pg_temp.id('cx')) ->> 'situacao') = 'cancelado', 'convite cancelado aparece como cancelado');
select pg_temp.erro($$select cmp_cotacao_enviar('$$ || pg_temp.id('cx') || $$', '{"tipo":"PJ","documento":"55666777000181","nome":"y","preco_unitario":"1","prazo_dias":"5","declarante":"Fulano","aceite":true}')$$, 'cancelado', 'convite cancelado não recebe proposta');
select pg_temp.erro($$select cmp_cotacao_enviar('$$ || pg_temp.id('cn') || $$', '{"preco_unitario":"1","prazo_dias":"5","declarante":"Marcos","aceite":true}')$$, 'prazo para enviar', 'depois do prazo não recebe proposta');
select pg_temp.erro($$insert into storage.objects (bucket_id, name) values ('cmp-propostas', '$$ || pg_temp.id('cn') || $$/2.pdf')$$, 'row-level security', 'Storage: prazo vencido não recebe PDF');
reset role;
select pg_temp.ok(exists (select 1 from auditoria where acao = 'compras_proposta_enviada_fornecedor' and nome like '%(pelo link)' and ip = '200.10.20.30' and navegador = 'NavegadorTeste/1.0')
  and exists (select 1 from auditoria where acao = 'compras_fornecedor_cadastrado_link') and exists (select 1 from auditoria where acao = 'compras_convite_criado')
  and exists (select 1 from auditoria where acao = 'compras_convite_cancelado') and exists (select 1 from cmp_historico where acao = 'convite_aberto'),
  'ações do link vão para o histórico e a auditoria (com IP e navegador)');

-- ---------------------------------------------------------------- Monitor de Links (mon_)
reset role;
reset request.jwt.claim.sub;
create or replace function pg_temp.erro2(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin execute cmd; exception when others then
    if sqlerrm ilike '%' || trecho || '%' then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % (erro diferente: %)', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % (não deu erro)', nome;
end $$;
select pg_temp.ok((select count(*) = 1 from apps where id = 'monitor' and cartao_url = '/apps/monitor/ajuda/cartao.html'), 'app monitor cadastrado com cartão e manual');
select pg_temp.ok(mon_rtt_ms('12') = 12 and mon_rtt_ms('12ms') = 12 and mon_rtt_ms('1.5ms') = 1.5 and mon_rtt_ms('00:00:00.012') = 12
  and mon_rtt_ms('800us') = 0.8 and mon_rtt_ms('1ms500us') = 1.5 and mon_rtt_ms('lixo') is null, 'rtt do RouterOS em todos os formatos');
create temp table mids (k text primary key, v text);
grant all on mids to anon, authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into mon_locais (id, nome, cliente) values ('30000000-0000-0000-0000-000000000001', 'Matriz', 'Cliente A'), ('30000000-0000-0000-0000-000000000002', 'Filial', 'Cliente B');
insert into mon_equipamentos (id, local_id, nome, modelo) values ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'RB Matriz', 'hEX'),
  ('31000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'RB Filial', 'hEX');
insert into mids select 'tok', mon_gerar_token('31000000-0000-0000-0000-000000000001');
insert into mids select 'tok2', mon_gerar_token('31000000-0000-0000-0000-000000000002');
insert into mon_acessos values ('00000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-000000000001');
select pg_temp.ok((select length(v) = 64 from mids where k = 'tok'), 'token de 64 caracteres gerado pelo admin');
reset role;
select pg_temp.ok((select token_hash <> (select v from mids where k = 'tok') and token_fim = right((select v from mids where k = 'tok'), 4)
  from mon_equipamentos where id = '31000000-0000-0000-0000-000000000001'), 'banco guarda só o hash do token (e os 4 últimos)');
select pg_temp.ok(exists (select 1 from auditoria where acao = 'monitor_token_gerado'), 'geração de token auditada');

-- o roteador (anon) manda as medições
set role anon;
reset request.jwt.claim.sub;
select pg_temp.erro2('select mon_registrar(''' || repeat('x', 64) || ''', ''{"links":[]}'')', 'token inválido', 'token errado é recusado');
select pg_temp.erro2('select * from mon_amostras', 'permission', 'anon não lê medições');
select pg_temp.ok((mon_registrar((select v from mids where k = 'tok'),
  '{"v":1,"ros":"6.49.22 (long-term)","uptime":"3w2d","cpu":"7","links":[{"k":"principal","env":5,"ok":5,"rtt":"9ms"},{"k":"backup","env":5,"ok":5,"rtt":"22"}]}') ->> 'links')::int = 2,
  'roteador registra 2 links');
select pg_temp.ok((mon_registrar((select v from mids where k = 'tok'), '{"links":[{"k":"principal","env":5,"ok":0}]}') ->> 'motivo') = 'cedo', 'limite de 1 envio a cada 20 s');
reset role;
select pg_temp.ok((select count(*) = 2 and bool_and(status = 'ok') from mon_links where equipamento_id = '31000000-0000-0000-0000-000000000001'), 'links criados sozinhos com status ok');
select pg_temp.ok((select ros_versao = '6.49.22 (long-term)' and cpu = 7 from mon_equipamentos where id = '31000000-0000-0000-0000-000000000001'), 'versão e CPU do roteador gravadas');
-- link principal cai
update mon_equipamentos set ultimo_contato = now() - interval '1 minute';
set role anon;
select mon_registrar((select v from mids where k = 'tok'), '{"links":[{"k":"principal","env":5,"ok":0},{"k":"backup","env":5,"ok":4,"rtt":"300ms"}]}');
reset role;
select pg_temp.ok((select status from mon_links where chave = 'principal') = 'caido' and (select status from mon_links where chave = 'backup') = 'instavel'
  and (select count(*) = 1 from mon_quedas where tipo = 'link' and fim is null), 'link caído abre queda; perda/latência alta = instável');
-- volta
update mon_quedas set inicio = now() - interval '30 minutes' where tipo = 'link';
update mon_equipamentos set ultimo_contato = now() - interval '1 minute';
set role anon;
select mon_registrar((select v from mids where k = 'tok'), '{"links":[{"k":"principal","env":5,"ok":5,"rtt":"10"},{"k":"backup","env":5,"ok":5,"rtt":"20"}]}');
reset role;
select pg_temp.ok((select count(*) = 1 from mon_quedas where tipo = 'link' and fim is not null) and (select status from mon_links where chave = 'principal') = 'ok', 'link voltou fecha a queda');
select pg_temp.ok((select sum(amostras) = 6 and sum(no_ar) = 5 from mon_horas), 'resumo por hora acumula as amostras');
-- equipamento some
update mon_equipamentos set ultimo_contato = now() - interval '10 minutes' where id = '31000000-0000-0000-0000-000000000001';
select pg_temp.ok(mon_verificar() = 1, 'vigia acha 1 equipamento calado');
select pg_temp.ok((select sem_contato_desde is not null from mon_equipamentos where id = '31000000-0000-0000-0000-000000000001')
  and (select count(*) = 1 from mon_quedas where tipo = 'sem_contato' and fim is null), 'vigia marca "sem contato" e abre registro');
select pg_temp.ok(mon_verificar() = 0, 'vigia não duplica');
set role anon;
select mon_registrar((select v from mids where k = 'tok'), '{"links":[{"k":"principal","env":5,"ok":5,"rtt":"10"}]}');
reset role;
select pg_temp.ok((select sem_contato_desde is null from mon_equipamentos where id = '31000000-0000-0000-0000-000000000001')
  and (select count(*) = 0 from mon_quedas where fim is null), 'roteador voltou fecha o "sem contato"');
-- link que não existe (ex.: backup): "Monitorar: Não" encerra a queda em aberto, volta a "sem dados" e o roteador passa a ser ignorado nele
update mon_equipamentos set ultimo_contato = now() - interval '1 minute';
set role anon;
select mon_registrar((select v from mids where k = 'tok'), '{"links":[{"k":"principal","env":5,"ok":5,"rtt":"10"},{"k":"backup","env":5,"ok":0}]}');
reset role;
select pg_temp.ok((select count(*) = 1 from mon_quedas q join mon_links l on l.id = q.link_id where l.chave = 'backup' and q.fim is null), 'backup caído abre queda');
update mon_links set ativo = false where chave = 'backup';
select pg_temp.ok((select count(*) = 0 from mon_quedas q join mon_links l on l.id = q.link_id where l.chave = 'backup' and q.fim is null)
  and (select status = 'sem_dados' from mon_links where chave = 'backup'), 'link desligado: queda encerrada e status sem dados');
update mon_equipamentos set ultimo_contato = now() - interval '1 minute';
set role anon;
select mon_registrar((select v from mids where k = 'tok'), '{"links":[{"k":"principal","env":5,"ok":5,"rtt":"10"},{"k":"backup","env":5,"ok":0}]}');
reset role;
select pg_temp.ok((select count(*) = 0 from mon_quedas q join mon_links l on l.id = q.link_id where l.chave = 'backup' and q.fim is null)
  and (select status = 'sem_dados' from mon_links where chave = 'backup'), 'medição de link desligado é ignorada');
update mon_links set ativo = true where chave = 'backup';

-- cliente
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 1 from mon_locais) and (select count(*) = 1 from mon_equipamentos) and (select count(*) = 2 from mon_links), 'cliente vê só o local liberado');
select pg_temp.erro2('select token_hash from mon_equipamentos', 'permission', 'cliente não lê o hash do token');
select pg_temp.erro2('select mon_gerar_token(''31000000-0000-0000-0000-000000000001'')', 'Só a equipe Nervia', 'cliente não gera token');
select pg_temp.erro2('update mon_links set status = ''ok''', 'permission', 'cliente não altera status');
select pg_temp.erro2('insert into mon_amostras (link_id, no_ar, perda) select id, true, 0 from mon_links limit 1', 'permission', 'cliente não inventa medição');
select pg_temp.ok((select count(*) = 2 and min(quedas) >= 0 and bool_and(disponibilidade between 0 and 100)
  from mon_relatorio('30000000-0000-0000-0000-000000000001', now() - interval '30 days', now())), 'relatório do local liberado');
select pg_temp.ok((select count(*) = 0 from mon_relatorio('30000000-0000-0000-0000-000000000002', now() - interval '30 days', now())), 'relatório de local não liberado vem vazio');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((select count(*) = 0 from mon_locais) and (select count(*) = 0 from mon_quedas), 'login sem acesso não vê nada');
reset role;
reset request.jwt.claim.sub;
-- ---------------------------------------------------------------- Compras: melhorias de 20/10/2026
-- base única do SISTEMA: outra empresa usa o fornecedor e vê a nota, sem quem cadastrou, sem observações e sem os avais
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000d5');
select pg_temp.ok((select cadastrado_nome = '' and cadastrado_por is null and cadastrado_unidade is null and not mesma_empresa
  and nota = 4.5 and avaliacoes = 1 and unidades_avaliacao = '{}' and avais = '[]'::jsonb from cmp_fornecedores_lista() where nome = 'Forn B'),
  'outra empresa vê o fornecedor e a nota, sem quem cadastrou e sem os avais');
select pg_temp.ok((select count(*) = 0 from cmp_avaliacoes) and (select count(*) = 0 from cmp_avais), 'outra empresa não lê avaliações (com avaliador) nem avais');
select pg_temp.ok((select count(*) = 1 and min(media) = 4.5 and min(comentario) = 'Entregou antes do prazo' from cmp_avaliacoes_fornecedor(pg_temp.id('fb')::uuid)),
  'avaliações anônimas (nota e comentário, sem quem avaliou)');
select pg_temp.erro($$select cmp_salvar_fornecedor(null, 'PJ', '11222333000181', 'Dup', '{}', '', '', '', null, '', '20000000-0000-0000-0000-000000000002')$$,
  'já está na base de fornecedores: Forn A. Use', 'CNPJ repetido de outra empresa: não diz quem cadastrou');
-- primeira compra conta por empresa: Forn B já foi comprado pelo Itaipu, mas é novo para o Park Sul
insert into cmp_requisicoes (unidade_id, grupo, titulo, quantidade) values ('20000000-0000-0000-0000-000000000002', 'Informática e tecnologia', 'Cabo Park Sul', 1);
insert into ids select 'ps1', max(id)::text from cmp_requisicoes;
select cmp_salvar_proposta(pg_temp.id('ps1')::bigint, pg_temp.id('fb')::uuid, 300, 0, 0, 2, 'À vista', 0, null, '');
select cmp_salvar_proposta(pg_temp.id('ps1')::bigint, pg_temp.id('fa')::uuid, 350, 0, 0, 2, 'À vista', 0, null, '');
select cmp_salvar_proposta(pg_temp.id('ps1')::bigint, pg_temp.id('fc')::uuid, 360, 0, 0, 2, 'À vista', 0, null, '');
select cmp_escolher(pg_temp.id('ps1')::bigint, (select id from cmp_propostas where requisicao_id = pg_temp.id('ps1')::bigint and fornecedor_id = pg_temp.id('fb')::uuid), '');
insert into ids values ('al_ps1', cmp_enviar_aprovacao(pg_temp.id('ps1')::bigint));
select pg_temp.ok(pg_temp.id('al_ps1') = 'gerente' and (select fornecedor_novo from cmp_requisicoes where id = pg_temp.id('ps1')::bigint),
  'primeira compra por empresa: fornecedor usado por outra empresa ainda é novo (vai ao Gerente)');
-- mesma empresa (duas unidades com o mesmo nome de empresa): vê quem cadastrou e os avais; avaliação continua anônima
reset role;
update cmp_unidades set empresa = 'Grupo Teste' where nome in ('Multicenter Itaipu', 'Filial Park Sul');
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000d5');
select pg_temp.ok((select cadastrado_nome = 'Rafael' and mesma_empresa and jsonb_array_length(avais) = 1 and unidades_avaliacao = '{}' and compras_empresa = 2
  from cmp_fornecedores_lista() where nome = 'Forn B'), 'outra unidade da mesma empresa vê quem cadastrou e os avais; avaliação anônima');
reset role;
update cmp_unidades set empresa = '' where nome in ('Multicenter Itaipu', 'Filial Park Sul');
select pg_temp.ok((select count(*) = 2 from cmp_historico where acao = 'regras_alteradas' and texto like '%empresa Grupo Teste%'), 'mudança de empresa da unidade fica no histórico');
set role authenticated;

-- dispensa de certidões pelo Gerente, por compra
select pg_temp.como('00000000-0000-0000-0000-0000000000d1');
insert into cmp_requisicoes (unidade_id, grupo, titulo, quantidade) values (pg_temp.id('itaipu')::uuid, 'Informática e tecnologia', 'Teclado', 1);
insert into ids select 'r6', max(id)::text from cmp_requisicoes;
insert into cmp_requisicoes (unidade_id, grupo, titulo, quantidade) values (pg_temp.id('itaipu')::uuid, 'Informática e tecnologia', 'Monitor', 1);
insert into ids select 'r7', max(id)::text from cmp_requisicoes;
select pg_temp.erro('select cmp_dispensar_certidoes(' || pg_temp.id('r7') || ', ''' || pg_temp.id('fv') || ''', ''Compra pequena e única.'')', 'precisa ser: gerente', 'só o Gerente dispensa certidões');
select pg_temp.como('00000000-0000-0000-0000-0000000000d2');
select pg_temp.erro('select cmp_salvar_proposta(' || pg_temp.id('r7') || ', ''' || pg_temp.id('fv') || ''', 1, 0, 0, 1, ''x'', 0, null, '''')', 'peça ao Gerente a dispensa', 'certidão vencida: mensagem indica a dispensa');
select pg_temp.como('00000000-0000-0000-0000-0000000000d3');
select pg_temp.erro('select cmp_dispensar_certidoes(' || pg_temp.id('r7') || ', ''' || pg_temp.id('fv') || ''', ''curto'')', 'motivo', 'dispensa exige motivo');
select pg_temp.erro('select cmp_dispensar_certidoes(' || pg_temp.id('r7') || ', ''' || pg_temp.id('fa') || ''', ''Compra pequena e única.'')', 'estão em dia', 'não dispensa certidão em dia');
select cmp_dispensar_certidoes(pg_temp.id('r7')::bigint, pg_temp.id('fv')::uuid, 'Compra pequena e única, entrega imediata.');
select pg_temp.erro('select cmp_dispensar_certidoes(' || pg_temp.id('r7') || ', ''' || pg_temp.id('fv') || ''', ''Compra pequena e única.'')', 'já foram dispensadas', 'dispensa não se repete');
select pg_temp.ok((select count(*) = 1 and min(por_nome) = 'Sonia' from cmp_dispensas where requisicao_id = pg_temp.id('r7')::bigint)
  and (select count(*) = 1 from cmp_historico where acao = 'certidoes_dispensadas' and texto like 'Gerente dispensou as certidões de Forn Vencido%'), 'dispensa registrada (quem, motivo) e no histórico');
select pg_temp.erro('insert into cmp_dispensas (requisicao_id, fornecedor_id, motivo) values (' || pg_temp.id('r6') || ', ''' || pg_temp.id('fv') || ''', ''x'')', 'permission', 'dispensa não é gravada direto pela tela');
select pg_temp.como('00000000-0000-0000-0000-0000000000d2');
select pg_temp.erro('select cmp_salvar_proposta(' || pg_temp.id('r6') || ', ''' || pg_temp.id('fv') || ''', 1, 0, 0, 1, ''x'', 0, null, '''')', 'venceram', 'a dispensa vale só para a compra em que foi dada');
select cmp_salvar_proposta(pg_temp.id('r7')::bigint, pg_temp.id('fv')::uuid, 900, 0, 0, 2, 'À vista', 0, null, '');
select cmp_excecao(pg_temp.id('r7')::bigint, 'Único fornecedor com o modelo em estoque.');
select cmp_escolher(pg_temp.id('r7')::bigint, (select id from cmp_propostas where requisicao_id = pg_temp.id('r7')::bigint), '');
insert into ids values ('al_r7', cmp_enviar_aprovacao(pg_temp.id('r7')::bigint));
select pg_temp.ok(pg_temp.id('al_r7') = 'gerente'
  and (select count(*) = 1 from cmp_historico where requisicao_id = pg_temp.id('r7')::bigint and acao = 'enviada_aprovacao' and texto like '%dispensadas pelo Gerente%'),
  'com a dispensa, a proposta entra e a compra segue para aprovação (aviso no histórico)');
select pg_temp.como('00000000-0000-0000-0000-0000000000d5');
select pg_temp.ok((select count(*) = 0 from cmp_dispensas), 'outra unidade não lê as dispensas');

-- compra pela internet
select pg_temp.como('00000000-0000-0000-0000-0000000000d2');
select pg_temp.erro('select cmp_salvar_proposta_internet(' || pg_temp.id('r6') || ', null, ''Mercado Livre'', ''mercadolivre.com.br/x'', '''', 80, 0, 0, 5, ''À vista'', 0, null, '''')', 'link do produto', 'internet: link precisa ser endereço completo');
select pg_temp.erro('select cmp_salvar_proposta_internet(' || pg_temp.id('r6') || ', null, '''', ''https://www.mercadolivre.com.br/x'', '''', 80, 0, 0, 5, ''À vista'', 0, null, '''')', 'Informe o site', 'internet: site obrigatório');
insert into ids select 'pi', cmp_salvar_proposta_internet(pg_temp.id('r6')::bigint, null, 'Mercado Livre', 'https://www.mercadolivre.com.br/teclado-abnt2', 'Loja Tech', 85, 0, 0, 5, 'À vista', 0, null, '')::text;
select cmp_salvar_proposta_internet(pg_temp.id('r6')::bigint, pg_temp.id('pi')::bigint, 'Mercado Livre', 'https://www.mercadolivre.com.br/teclado-abnt2', 'Loja Tech', 80, 0, 0, 5, 'À vista', 0, null, '');
select pg_temp.ok((select fornecedor_id is null and origem = 'internet' and rodada = 2 and preco_anterior = 85 and vendedor = 'Loja Tech' from cmp_propostas where id = pg_temp.id('pi')::bigint),
  'proposta da internet sem fornecedor, com site, link e vendedor; re-cotação guarda o preço anterior');
insert into ids select 'pi2', cmp_salvar_proposta_internet(pg_temp.id('r6')::bigint, null, 'Amazon', 'https://www.amazon.com.br/dp/B000', '', 95, 0, 0, 3, 'À vista', 0, null, '')::text;
select cmp_excluir_proposta(pg_temp.id('pi2')::bigint, null);
select pg_temp.ok((select count(*) = 1 from cmp_historico where acao = 'proposta_excluida' and texto = 'Proposta de Internet — Amazon excluída.'), 'exclui proposta da internet');
select cmp_salvar_proposta(pg_temp.id('r6')::bigint, pg_temp.id('fa')::uuid, 100, 0, 0, 2, 'À vista', 0, null, '');
select cmp_salvar_proposta(pg_temp.id('r6')::bigint, pg_temp.id('fb')::uuid, 110, 0, 0, 2, 'À vista', 0, null, '');
select cmp_escolher(pg_temp.id('r6')::bigint, pg_temp.id('pi')::bigint, '');
insert into ids values ('al_r6', cmp_enviar_aprovacao(pg_temp.id('r6')::bigint));
select pg_temp.ok(pg_temp.id('al_r6') = 'gerente'
  and (select compra_internet and not fornecedor_novo and status = 'aprovacao' from cmp_requisicoes where id = pg_temp.id('r6')::bigint),
  'internet: menor preço e barata, mesmo assim vai ao Gerente (nunca automática)');
select pg_temp.como('00000000-0000-0000-0000-0000000000d3');
insert into ids values ('de_r6', cmp_decidir(pg_temp.id('r6')::bigint, true, '', true));
select pg_temp.ok(pg_temp.id('de_r6') = 'aprovada'
  and (select count(*) = 1 from cmp_historico where requisicao_id = pg_temp.id('r6')::bigint and texto like 'Aprovada pelo Gerente (aval à compra pela internet)%'),
  'Gerente dá o aval à compra pela internet ao aprovar');
select pg_temp.como('00000000-0000-0000-0000-0000000000d2');
select cmp_emitir_pedido(pg_temp.id('r6')::bigint);
select cmp_marcar_entregue(pg_temp.id('r6')::bigint);
select pg_temp.como('00000000-0000-0000-0000-0000000000d3');
select cmp_avaliar(pg_temp.id('r6')::bigint, 4, 4, 5, 3, 'Chegou rápido');
select pg_temp.ok((select status = 'concluida' from cmp_requisicoes where id = pg_temp.id('r6')::bigint)
  and (select fornecedor_id is null from cmp_avaliacoes where requisicao_id = pg_temp.id('r6')::bigint), 'compra pela internet avaliada e concluída');
reset role;
select pg_temp.erro('insert into cmp_propostas (requisicao_id, origem, site, link, preco_unitario, prazo_dias) values (' || pg_temp.id('r6') || ', ''internet'', ''ML'', ''javascript:alert(1)'', 1, 1)',
  'cmp_propostas_internet', 'banco recusa link que não é http(s)');
reset request.jwt.claim.sub;
-- ---------------------------------------------------------------- Compras: Oportunidades para fornecedores (22/10/2026)
grant all on ids to anon;
set role anon;
set request.headers = '{"x-forwarded-for":"200.50.60.70","user-agent":"NavegadorForn/2.0"}';
select pg_temp.ok((select jsonb_array_length(x -> 'grupos') = 22 and x -> 'empresas' = 'null'::jsonb and jsonb_array_length(x -> 'lista_ufs') = 27
  from cmp_vitrine_fornecedores() x), 'página pública: grupos e estados; número de empresas só a partir de 3 (não identifica)');
select pg_temp.erro($$select cmp_solicitar_cadastro('{"tipo":"PJ","documento":"77888999000182","nome":"Tec Sul","email":"a@b.com","telefone":"21999990000","grupos":["Informática e tecnologia"],"aceite":true}')$$,
  'CNPJ inválido', 'cadastro: CNPJ com dígito errado recusado');
select pg_temp.erro($$select cmp_solicitar_cadastro('{"tipo":"PJ","documento":"77888999000181","nome":"Tec Sul","email":"a@b.com","telefone":"21999990000","grupos":["Informática e tecnologia"]}')$$,
  'aceita as condições', 'cadastro: exige o aceite das condições');
select pg_temp.erro($$select cmp_solicitar_cadastro('{"tipo":"PJ","documento":"77888999000181","nome":"Tec Sul","email":"a@b.com","telefone":"21999990000","grupos":[],"aceite":true}')$$,
  'pelo menos um grupo', 'cadastro: exige um grupo');
select pg_temp.erro($$select cmp_solicitar_cadastro('{"tipo":"PJ","documento":"77888999000181","nome":"Tec Sul","email":"a@b.com","telefone":"21999990000","grupos":["Informática e tecnologia"],"regioes":["XX"],"aceite":true}')$$,
  'Estado desconhecido', 'cadastro: estado fora da lista recusado');
insert into ids select 'sol', cmp_solicitar_cadastro('{"tipo":"PJ","documento":"77.888.999/0001-81","nome":"Tec Sul Informática","contato":"Bruna","email":"Bruna@TecSul.com","telefone":"(21) 99999-0000","grupos":["Informática e tecnologia"],"regioes":["RJ","ES"],"aceite":true}') ->> 'protocolo';
select pg_temp.erro($$select cmp_solicitar_cadastro('{"tipo":"PJ","documento":"77888999000181","nome":"Tec Sul","email":"a@b.com","telefone":"21999990000","grupos":["Informática e tecnologia"],"aceite":true}')$$,
  'Já recebemos um pedido', 'cadastro: o mesmo CNPJ com pedido pendente não repete');
select cmp_solicitar_cadastro('{"tipo":"PF","documento":"52998224725","nome":"João Reparos","email":"joao@x.com","telefone":"21988887777","grupos":["Informática e tecnologia"],"aceite":true}');
select pg_temp.erro('select * from cmp_solicitacoes', 'permission', 'anônimo não lê os pedidos de cadastro');
select pg_temp.erro('select * from cmp_assinaturas', 'permission', 'anônimo não lê os acessos');
reset request.headers;
-- comprador abre a requisição para as Oportunidades
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000d1');
insert into cmp_requisicoes (unidade_id, grupo, titulo, quantidade, valor_estimado, descricao) values (pg_temp.id('itaipu')::uuid, 'Informática e tecnologia', 'Monitor 24 polegadas', 4, 3600, 'Full HD, HDMI');
insert into ids select 'r8', max(id)::text from cmp_requisicoes;
select pg_temp.erro('select cmp_abrir_oportunidade(' || pg_temp.id('r8') || ', current_date + 7)', 'precisa ser: comprador ou gerente', 'solicitante não abre para os fornecedores');
select pg_temp.como('00000000-0000-0000-0000-0000000000d2');
select pg_temp.erro('select cmp_abrir_oportunidade(' || pg_temp.id('r8') || ', current_date + 7)', 'cidade e o estado', 'só abre com cidade e estado da unidade cadastrados');
reset role;
update cmp_unidades set cidade = 'Niterói', uf = 'RJ' where id = pg_temp.id('itaipu')::uuid;
set role authenticated;
select pg_temp.erro('select cmp_abrir_oportunidade(' || pg_temp.id('r8') || ', current_date + 70)', 'no máximo 60', 'prazo de no máximo 60 dias');
select cmp_abrir_oportunidade(pg_temp.id('r8')::bigint, cmp_hoje() + 7);
select pg_temp.ok((select aberta_fornecedores and status = 'cotacao' and aberta_nome = 'Rafael' from cmp_requisicoes where id = pg_temp.id('r8')::bigint), 'comprador abre a requisição (vai para Em cotação)');
select pg_temp.erro('select cmp_oportunidades_admin()', 'Só a equipe Nervia', 'comprador não vê os pedidos de cadastro');
select pg_temp.ok((select count(*) = 0 from cmp_assinaturas) and (select count(*) = 0 from cmp_solicitacoes), 'comprador não lê acessos nem pedidos');
-- equipe Nervia libera o acesso (pedido da página e fornecedor que já estava na base)
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select jsonb_array_length(cmp_oportunidades_admin() -> 'solicitacoes') = 2), 'Nervia vê os pedidos de cadastro');
select pg_temp.erro('select cmp_acesso_liberar(' || substr(pg_temp.id('sol'), 3) || ', null, cmp_hoje() - 1, null, null, null, null)', 'hoje ou depois', 'validade no passado recusada');
insert into ids select 'ac', cmp_acesso_liberar(substr(pg_temp.id('sol'), 3)::bigint, null, cmp_hoje() + 30, null, null, 150, 'Pix 22/10') ->> 'codigo';
select pg_temp.ok((select grupos = '{"Informática e tecnologia"}' and email = 'bruna@tecsul.com' and cadastrado_nome <> ''
  from cmp_fornecedores_lista() where documento = '77888999000181'), 'pedido aprovado: fornecedor entra na base com os grupos do pedido');
select pg_temp.erro('select cmp_acesso_liberar(' || substr(pg_temp.id('sol'), 3) || ', null, cmp_hoje() + 30, null, null, null, null)', 'já foi aprovada', 'pedido não é aprovado duas vezes');
insert into ids select 'ac2', cmp_acesso_liberar(null, (select id from cmp_fornecedores_lista() where documento = '77888999000181'), cmp_hoje() + 60, null, '{RJ,ES}', 150, '') ->> 'codigo';
select pg_temp.ok(pg_temp.id('ac2') = pg_temp.id('ac') and (select valido_ate = cmp_hoje() + 60 and renovado_em is not null from cmp_assinaturas where codigo = pg_temp.id('ac')),
  'renovar mantém o mesmo link e muda a validade');
insert into ids select 'acfa', cmp_acesso_liberar(null, pg_temp.id('fa')::uuid, cmp_hoje() + 30, null, '{SP}', null, 'cortesia') ->> 'codigo';
select pg_temp.erro($$select cmp_solicitacao_recusar((select max(id) from cmp_solicitacoes), 'x')$$, 'motivo', 'recusar exige motivo');
select cmp_solicitacao_recusar((select max(id) from cmp_solicitacoes), 'Fora dos grupos atendidos');
-- fornecedor na área de Oportunidades (sem login)
reset request.jwt.claim.sub;
set role anon;
set request.headers = '{"x-forwarded-for":"200.50.60.71","user-agent":"NavegadorForn/2.0"}';
select pg_temp.erro('select cmp_portal_ler(''' || repeat('0', 64) || ''')', 'inválido', 'área de Oportunidades: código errado recusado');
select pg_temp.ok((select x ->> 'situacao' = 'ativo' and jsonb_array_length(x -> 'oportunidades') = 1 and x -> 'oportunidades' -> 0 ->> 'cidade' = 'Niterói'
  and x -> 'oportunidades' -> 0 ->> 'titulo' = 'Monitor 24 polegadas' and not (x -> 'oportunidades' -> 0) ? 'valor_estimado'
  and x::text not like '%Multicenter%' and x::text not like '%Carla%' from cmp_portal_ler(pg_temp.id('ac')) x),
  'fornecedor vê a oportunidade do seu grupo e estado, sem o nome da empresa, quem pediu ou valor estimado');
select pg_temp.ok((select jsonb_array_length(cmp_portal_ler(pg_temp.id('acfa')) -> 'oportunidades') = 0), 'fornecedor que só entrega em SP não vê a oportunidade do RJ');
insert into ids select 'cp', cmp_portal_participar(pg_temp.id('ac'), pg_temp.id('r8')::bigint) ->> 'codigo';
select pg_temp.ok((cmp_portal_participar(pg_temp.id('ac'), pg_temp.id('r8')::bigint) ->> 'codigo') = pg_temp.id('cp'), 'participar de novo devolve o mesmo convite');
select pg_temp.erro('select cmp_portal_participar(''' || pg_temp.id('acfa') || ''', ' || pg_temp.id('r8') || ')', 'não está mais aberta', 'não participa de oportunidade fora dos seus estados');
select pg_temp.ok((select x ->> 'unidade' = 'Empresa compradora em Niterói/RJ' and x ->> 'origem' = 'portal' and x::text not like '%Multicenter%'
  from cmp_cotacao_ler(pg_temp.id('cp')) x), 'página de cotação de quem veio pelas Oportunidades não mostra o nome da empresa');
select pg_temp.ok((cmp_cotacao_enviar(pg_temp.id('cp'), '{"preco_unitario":"890","prazo_dias":"5","pagamento":"À vista","declarante":"Bruna","aceite":true}') ->> 'protocolo') like 'P-%',
  'fornecedor das Oportunidades envia a proposta pela mesma página de cotação');
reset request.headers;
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000d2');
select pg_temp.ok((select c.origem = 'portal' and c.prazo = r.aberta_ate and c.respondido_em is not null from cmp_convites c join cmp_requisicoes r on r.id = c.requisicao_id where c.codigo = pg_temp.id('cp'))
  and (select count(*) = 1 from cmp_propostas where requisicao_id = pg_temp.id('r8')::bigint and origem = 'fornecedor'),
  'comprador vê o convite das Oportunidades e a proposta no mapa');
select cmp_abrir_oportunidade(pg_temp.id('r8')::bigint, cmp_hoje() + 10);
select pg_temp.ok((select prazo = cmp_hoje() + 10 from cmp_convites where codigo = pg_temp.id('cp')), 'mudar o prazo leva junto o convite de quem entrou pelas Oportunidades');
select cmp_fechar_oportunidade(pg_temp.id('r8')::bigint);
reset role;
set role anon;
select pg_temp.ok((select jsonb_array_length(cmp_portal_ler(pg_temp.id('ac')) -> 'oportunidades') = 0), 'requisição fechada some das Oportunidades');
reset role;
update cmp_requisicoes set aberta_fornecedores = true where id = pg_temp.id('r8')::bigint;
update cmp_assinaturas set valido_ate = cmp_hoje() - 1 where codigo = pg_temp.id('ac');
set role anon;
select pg_temp.ok((select x ->> 'situacao' = 'vencido' and jsonb_array_length(x -> 'oportunidades') = 0 from cmp_portal_ler(pg_temp.id('ac')) x), 'acesso vencido não mostra oportunidades');
select pg_temp.erro('select cmp_portal_participar(''' || pg_temp.id('ac') || ''', ' || pg_temp.id('r8') || ')', 'venceu', 'acesso vencido não participa');
reset role;
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select cmp_acesso_revogar((select id from cmp_assinaturas where codigo = pg_temp.id('acfa')), 'Pediu para sair');
reset role;
set role anon;
select pg_temp.ok((cmp_portal_ler(pg_temp.id('acfa')) ->> 'situacao') = 'cancelado', 'acesso cancelado pela Nervia');
reset role;
select pg_temp.ok((select regioes = '{ES,RJ}' from cmp_fornecedores where documento = '77888999000181') and (select regioes = '{SP}' from cmp_fornecedores where id = pg_temp.id('fa')::uuid),
  'estados do fornecedor gravados (pedido e liberação)');
select pg_temp.ok(exists (select 1 from auditoria where acao = 'compras_cadastro_solicitado' and ip = '200.50.60.70' and navegador = 'NavegadorForn/2.0')
  and exists (select 1 from auditoria where acao = 'compras_acesso_liberado') and exists (select 1 from auditoria where acao = 'compras_acesso_renovado')
  and exists (select 1 from auditoria where acao = 'compras_acesso_cancelado') and exists (select 1 from auditoria where acao = 'compras_cadastro_recusado')
  and exists (select 1 from auditoria where acao = 'compras_oportunidade_aberta') and exists (select 1 from auditoria where acao = 'compras_oportunidade_fechada')
  and exists (select 1 from auditoria where acao = 'compras_oportunidade_participacao' and ip = '200.50.60.71'),
  'Oportunidades: pedido, liberação, renovação, cancelamento, recusa, abrir, fechar e participação na auditoria');
reset request.jwt.claim.sub;
-- ---------------------------------------------------------------- Contas e Licenças Microsoft 365 (lic_)
select pg_temp.ok((select count(*) = 7 from lic_unidades) and (select count(*) = 1 from apps where id = 'licencas' and manual_url like '/apps/licencas/ajuda/%'),
  'licenças: 7 unidades iniciais e app cadastrado com cartão e manual');
insert into lic_acessos select '00000000-0000-0000-0000-00000000000b', id from lic_unidades where dominio = 'vogue';
create temp table lic_ids (k text primary key, v text); grant all on lic_ids to authenticated;
insert into lic_ids select dominio, id::text from lic_unidades where dominio in ('vogue', 'parksul');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.erro2($$select lic_carregar(current_date, 'x.csv', 1, '[{"unidade_id":"$$ || (select v from lic_ids where k = 'vogue') || $$","login":"a@vogue.com.br"}]')$$,
  'Só a equipe Nervia', 'cliente não carrega exportação');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select lic_carregar('2026-09-01', 'users_01_09_2026.csv', 50, jsonb_build_array(
  jsonb_build_object('unidade_id', (select v from lic_ids where k = 'vogue'), 'login', 'Ana@vogue.com.br', 'nome', 'Ana', 'licencas', '{"Microsoft 365 Business Standard"}'),
  jsonb_build_object('unidade_id', (select v from lic_ids where k = 'vogue'), 'login', 'bia@vogue.com.br', 'nome', 'Bia', 'bloqueada', true, 'licencas', '{"Exchange Online (Plan 1)"}'),
  jsonb_build_object('unidade_id', (select v from lic_ids where k = 'parksul'), 'login', 'caio@parksul.com.br', 'nome', 'Caio', 'licencas', '{}')));
select pg_temp.ok((select contas = 3 and linhas_arquivo = 50 and carregado_nome <> '' from lic_cargas where exportado_em = '2026-09-01')
  and (select login = 'ana@vogue.com.br' from lic_contas where nome = 'Ana'), 'admin carrega a exportação (login em minúsculas)');
select pg_temp.erro2($$select lic_carregar('2026-09-01', 'x.csv', 1, '[{"unidade_id":"$$ || (select v from lic_ids where k = 'vogue') || $$","login":"z@vogue.com.br"}]')$$,
  'Já existe uma carga de 01/09/2026', 'mesma data não substitui sem marcar');
select pg_temp.erro2($$select lic_carregar('2026-09-02', 'x.csv', 1, '[{"unidade_id":"$$ || (select v from lic_ids where k = 'vogue') || $$","login":"x#EXT#@vogue.com.br"}]')$$,
  'convidado', 'conta de convidado recusada');
select pg_temp.erro2($$select lic_carregar('2026-09-02', 'x.csv', 1, '[]')$$, 'Nenhuma conta', 'arquivo sem contas das unidades recusado');
-- outro tenant (outros domínios) na mesma data: não conflita nem apaga as unidades do primeiro arquivo
insert into lic_unidades (nome, dominio, ordem) values ('Outra Empresa', 'outraempresa', 90);
insert into lic_ids select 'outra', id::text from lic_unidades where dominio = 'outraempresa';
select lic_carregar('2026-09-01', 'outro_tenant.csv', 9, jsonb_build_array(
  jsonb_build_object('unidade_id', (select v from lic_ids where k = 'outra'), 'login', 'gil@outraempresa.com.br', 'nome', 'Gil', 'licencas', '{"Power BI Pro"}')));
select pg_temp.ok((select count(*) = 2 from lic_cargas where exportado_em = '2026-09-01') and (select count(*) = 4 from lic_contas)
  and (select unidades = array[(select v from lic_ids where k = 'outra')::uuid] from lic_cargas where arquivo = 'outro_tenant.csv'),
  'arquivo de outro tenant na mesma data entra sem "já existe" e sem apagar as outras unidades');
select pg_temp.erro2($$select lic_carregar('2026-09-01', 'x.csv', 1, '[{"unidade_id":"$$ || (select v from lic_ids where k = 'parksul') || $$","login":"z@parksul.com.br"}]')$$,
  'Já existe uma carga de 01/09/2026 para: Shopping Park Sul.', '"já existe" cita só a unidade repetida');
select lic_carregar('2026-09-01', 'so_parksul.csv', 1, jsonb_build_array(
  jsonb_build_object('unidade_id', (select v from lic_ids where k = 'parksul'), 'login', 'davi@parksul.com.br', 'nome', 'Davi')), true);
select pg_temp.ok((select count(*) = 2 from lic_contas c join lic_cargas k on k.id = c.carga_id where k.arquivo = 'users_01_09_2026.csv')
  and (select contas = 2 and unidades = array[(select v from lic_ids where k = 'vogue')::uuid] from lic_cargas where arquivo = 'users_01_09_2026.csv')
  and (select count(*) = 0 from lic_contas where login = 'caio@parksul.com.br') and (select count(*) = 1 from lic_contas where login = 'davi@parksul.com.br')
  and (select count(*) = 1 from lic_contas where login = 'gil@outraempresa.com.br'),
  'substituir troca só a unidade do arquivo novo (Vogue e a outra empresa ficam)');
select lic_carregar('2026-09-01', 'so_outra.csv', 1, jsonb_build_array(
  jsonb_build_object('unidade_id', (select v from lic_ids where k = 'outra'), 'login', 'gil@outraempresa.com.br', 'nome', 'Gil')), true);
select pg_temp.ok((select count(*) = 0 from lic_cargas where arquivo = 'outro_tenant.csv') and (select count(*) = 3 from lic_cargas),
  'carga que fica sem nenhuma unidade é apagada');
select lic_salvar_fatura('2026-09-01', jsonb_build_array(
  jsonb_build_object('unidade_id', (select v from lic_ids where k = 'outra'), 'produto', 'Power BI Pro', 'quantidade', 1, 'valor_unitario', 96.4)));
select lic_salvar_fatura('2026-09-15', jsonb_build_array(
  jsonb_build_object('unidade_id', (select v from lic_ids where k = 'vogue'), 'produto', 'Microsoft 365 Business Standard', 'quantidade', 3, 'valor_unitario', 70.5),
  jsonb_build_object('unidade_id', (select v from lic_ids where k = 'vogue'), 'produto', 'Microsoft 365 Business Standard', 'quantidade', 1, 'valor_unitario', 70.5)));
select pg_temp.ok((select quantidade = 4 and mes = '2026-09-01' from lic_faturas where unidade_id = (select v from lic_ids where k = 'vogue')::uuid) and (select count(*) = 2 from lic_faturas), 'fatura do mês: linhas do mesmo produto somadas, mês normalizado');
select pg_temp.erro2($$select lic_salvar_fatura('2026-09-01', '[{"unidade_id":"$$ || (select v from lic_ids where k = 'vogue') || $$","produto":"x","quantidade":1}]')$$,
  'Já existe fatura de 09/2026 para: Vogue (1 itens)', 'fatura do mesmo mês não substitui sem marcar (cita só a unidade repetida)');
select pg_temp.ok((select count(*) >= 3 from auditoria where acao in ('licencas_carga', 'licencas_fatura', 'licencas_acesso_liberado')), 'carga, fatura e acesso auditados');
-- cliente vê só a unidade liberada
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 2 from lic_contas) and (select count(*) = 1 from lic_unidades) and (select count(*) = 1 from lic_faturas)
  and (select count(*) = 1 from lic_cargas), 'cliente vê só as contas, a unidade e a fatura liberadas');
select pg_temp.erro2('insert into lic_contas (carga_id, unidade_id, login) select id, (select v from lic_ids where k = ''vogue'')::uuid, ''hack@vogue.com.br'' from lic_cargas',
  'permission', 'cliente não grava conta direto');
select pg_temp.erro2('select lic_excluir_carga((select id from lic_cargas))', 'Só a equipe Nervia', 'cliente não exclui carga');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((select count(*) = 0 from lic_contas) and (select count(*) = 0 from lic_cargas), 'login sem acesso não vê nada');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select lic_excluir_carga((select id from lic_cargas where arquivo = 'so_parksul.csv'));
select pg_temp.ok((select count(*) = 0 from lic_contas where unidade_id = (select v from lic_ids where k = 'parksul')::uuid) and (select count(*) = 3 from lic_contas), 'excluir a carga apaga só as contas dela');
select lic_excluir_carga(id) from lic_cargas;
select pg_temp.ok((select count(*) = 0 from lic_contas), 'excluir as cargas apaga as contas');
reset role;
reset request.jwt.claim.sub;
-- formulário da fatura pelo link
grant all on lic_ids to anon;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.erro2($$select lic_pedido_criar(current_date, current_date + 5, array['$$ || (select v from lic_ids where k = 'vogue') || $$']::uuid[], 'x', '', '')$$, 'Só a equipe Nervia', 'cliente não gera link');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select lic_salvar_fatura('2026-09-01', jsonb_build_array(jsonb_build_object('unidade_id', (select v from lic_ids where k = 'vogue'), 'produto', 'Power BI Pro', 'quantidade', 2, 'valor_unitario', 96.4)), true);
insert into lic_ids select 'cod', lic_pedido_criar('2026-10-20', current_date + 5, array[(select v from lic_ids where k = 'vogue')::uuid], 'Fulana', '21999990000', '') ->> 'codigo';
reset role;
set role anon;
select pg_temp.erro2('select * from lic_pedidos', 'permission', 'anônimo não lê os pedidos');
select pg_temp.erro2($$select lic_formulario_ler('$$ || repeat('0', 64) || $$')$$, 'Link inválido', 'código errado recusado');
select pg_temp.ok((select (d ->> 'situacao') = 'aberto' and (d ->> 'mes') = '2026-10-01' and jsonb_array_length(d -> 'unidades') = 1
  and (d -> 'anterior' -> 0 ->> 'produto') = 'Power BI Pro' and d -> 'resposta' = 'null'::jsonb
  from (select lic_formulario_ler((select v from lic_ids where k = 'cod')) d) x), 'link mostra mês, unidade e a fatura anterior para conferir');
select pg_temp.erro2($$select lic_formulario_enviar('$$ || (select v from lic_ids where k = 'cod') || $$', '{"declarante":"Fulana","aceite":true,"itens":[{"unidade_id":"$$ || (select v from lic_ids where k = 'parksul') || $$","produto":"Power BI Pro","quantidade":1,"valor_unitario":1}]}')$$,
  'Unidade fora deste formulário', 'não envia para unidade fora do link');
select pg_temp.erro2($$select lic_formulario_enviar('$$ || (select v from lic_ids where k = 'cod') || $$', '{"declarante":"Fulana","itens":[]}')$$, 'declaração', 'exige a declaração');
select lic_formulario_enviar((select v from lic_ids where k = 'cod'), jsonb_build_object('declarante', 'Fulana de Tal', 'aceite', true, 'itens', jsonb_build_array(
  jsonb_build_object('unidade_id', (select v from lic_ids where k = 'vogue'), 'produto', 'Power BI Pro', 'quantidade', '3', 'valor_unitario', '96.40'))));
select lic_formulario_enviar((select v from lic_ids where k = 'cod'), jsonb_build_object('declarante', 'Fulana de Tal', 'aceite', true, 'itens', jsonb_build_array(
  jsonb_build_object('unidade_id', (select v from lic_ids where k = 'vogue'), 'produto', 'Power BI Pro', 'quantidade', 4, 'valor_unitario', 96.4),
  jsonb_build_object('unidade_id', (select v from lic_ids where k = 'vogue'), 'produto', 'Copilot', 'quantidade', 1, 'valor_unitario', 150))));
reset role;
select pg_temp.ok((select string_agg(status, ',' order by id) = 'substituida,pendente' from lic_respostas)
  and (select (itens -> 1 ->> 'fora_da_lista')::boolean from lic_respostas where status = 'pendente')
  and (select count(*) = 2 from auditoria where acao = 'licencas_link_respondido' and papel = 'sistema' and nome = 'Fulana de Tal (pelo link)')
  and (select count(*) = 1 from auditoria where acao = 'licencas_link_aberto'),
  'reenvio substitui a pendente; licença fora da lista marcada; abertura e envio auditados');
select pg_temp.ok((select count(*) = 0 from lic_faturas where mes = '2026-10-01'), 'resposta pendente ainda não é fatura');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 0 from lic_respostas), 'cliente com login não vê as respostas');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
-- fatura de outubro já carregada para Vogue (link) e Park Sul (fora do link)
select lic_salvar_fatura('2026-10-01', jsonb_build_array(
  jsonb_build_object('unidade_id', (select v from lic_ids where k = 'vogue'), 'produto', 'Power BI Pro', 'quantidade', 9, 'valor_unitario', 1),
  jsonb_build_object('unidade_id', (select v from lic_ids where k = 'parksul'), 'produto', 'Microsoft 365 Business Basic', 'quantidade', 7, 'valor_unitario', 30.78)));
select pg_temp.erro2($$select lic_resposta_aprovar((select id from lic_respostas where status = 'pendente'))$$,
  'Já existe fatura de 10/2026 para estas unidades (1 itens)', 'aprovar não substitui sem marcar');
select lic_resposta_aprovar((select id from lic_respostas where status = 'pendente'), true);
select pg_temp.ok((select count(*) = 2 and sum(quantidade) = 5 from lic_faturas where mes = '2026-10-01' and unidade_id = (select v from lic_ids where k = 'vogue')::uuid)
  and (select status = 'aprovada' and decidido_nome <> '' from lic_respostas order by id desc limit 1), 'Nervia aprova e a resposta vira a fatura do mês');
select pg_temp.ok((select count(*) = 1 and sum(quantidade) = 7 from lic_faturas where mes = '2026-10-01' and unidade_id = (select v from lic_ids where k = 'parksul')::uuid)
  and exists (select 1 from auditoria where acao = 'licencas_fatura' and detalhes ->> 'origem' like 'formulário F-%'),
  'substituir pelo formulário troca só as unidades do link (Park Sul fica)');
select pg_temp.erro2('select lic_resposta_aprovar((select max(id) from lic_respostas))', 'já foi aprovada', 'não aprova duas vezes');
select lic_pedido_cancelar((select max(id) from lic_pedidos));
reset role;
set role anon;
select pg_temp.erro2($$select lic_formulario_enviar('$$ || (select v from lic_ids where k = 'cod') || $$', '{"declarante":"Fulana","aceite":true,"itens":[{"unidade_id":"x","produto":"Power BI Pro","quantidade":1,"valor_unitario":1}]}')$$,
  'cancelado', 'link cancelado não recebe mais');
reset role;
reset request.jwt.claim.sub;
-- ---------------------------------------------------------------- vitrine da Área do Cliente
select pg_temp.ok((select string_agg(id || '=' || situacao, ',' order by id) from apps where id in ('compras', 'monitor', 'notas', 'produtos', 'telefonia'))
  = 'compras=disponivel,monitor=oculto,notas=disponivel,produtos=em_breve,telefonia=disponivel', 'situação inicial dos apps');
select pg_temp.ok((select not ativo and demo_url = '/demo/produtos/' from apps where id = 'produtos'), 'Controle de Produtos em breve, inativo, com demo');
update apps set situacao = 'em_desenvolvimento', demo_url = '/segredo/' where id = 'velho';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select string_agg(id, ',' order by id) from apps_vitrine()) = 'compras,painel-nf,produtos,telefonia,velho',
  'vitrine: apps fora da grade do login, sem oculto');
select pg_temp.ok((select demo_url = '' from apps_vitrine() where id = 'velho') and (select demo_url = '/demo/compras/' from apps_vitrine() where id = 'compras'),
  'em desenvolvimento não mostra link de demonstração');
select pg_temp.ok((select count(*) = 0 from apps where id = 'produtos'), 'cliente não lê o app da vitrine pela tabela');
select app_reagir('compras', 'curti');
select app_reagir('compras', 'nao_curti', '  faltou integração com o ERP  ');
select pg_temp.ok((select count(*) = 1 and min(reacao) = 'nao_curti' and min(comentario) = 'faltou integração com o ERP' from app_reacoes), 'uma reação por app; trocar mantém uma linha');
select pg_temp.ok((select reacao = 'nao_curti' and comentario <> '' from apps_vitrine() where id = 'compras'), 'vitrine devolve a minha reação');
select app_reagir('compras', 'interesse', 'ignorado');
select pg_temp.ok((select reacao = 'interesse' and comentario = '' from app_reacoes where app_id = 'compras'), 'comentário só no "não curti"');
select app_reagir('produtos', 'curti');
select app_reagir('velho', 'curti');
select app_reagir('velho', '');
select pg_temp.ok((select count(*) = 0 from app_reacoes where app_id = 'velho'), 'reação retirada');
select pg_temp.erro2('select app_reagir(''notas'', ''curti'')', 'não está na vitrine', 'não reage a app que já tem');
select pg_temp.erro2('select app_reagir(''monitor'', ''curti'')', 'não está na vitrine', 'não reage a app oculto');
select pg_temp.erro2('select app_reagir(''compras'', ''amei'')', 'Reação inválida', 'reação fora da lista');
select pg_temp.erro2('insert into app_reacoes (user_id, app_id, reacao) values (''00000000-0000-0000-0000-00000000000b'', ''telefonia'', ''curti'')', 'permission', 'cliente não grava reação direto');
select app_registrar_clique('compras', 'demo');
select app_registrar_clique('compras', 'demo');
select app_registrar_clique('compras', 'quero_conhecer');
select pg_temp.erro2('select app_registrar_clique(''monitor'', ''demo'')', 'não está na vitrine', 'clique em app oculto recusado');
select pg_temp.ok((select count(*) = 0 from app_cliques), 'cliente não lê os cliques');
select pg_temp.erro2('select * from apps_interesse()', 'Só a equipe Nervia', 'cliente não vê o interesse');
update perfis set empresa = 'Eu mesmo' where user_id = '00000000-0000-0000-0000-00000000000b';
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((select count(*) = 0 from app_reacoes), 'outro login não vê a reação dos outros');
select pg_temp.ok((select reacao is null from apps_vitrine() where id = 'compras'), 'vitrine do outro login sem reação');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.ok((select string_agg(id, ',' order by id) from apps_vitrine()) = 'produtos,velho', 'admin: vitrine só com o que não está ativo');
select pg_temp.ok((select count(*) = 2 from app_reacoes) and (select count(*) = 2 from app_cliques), 'admin lê reações e cliques (clique repetido em 1 min conta uma vez)');
select pg_temp.ok((select empresa <> 'Eu mesmo' and empresa <> '' and cliques_demo = 1 and cliques_conhecer = 1 and reacao = 'interesse'
  from apps_interesse() where app_id = 'compras'), 'interesse: empresa pelos acessos do login, cliques e reação');
update perfis set empresa = 'Linum Comércio' where user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select empresa = 'Linum Comércio' from apps_interesse() where app_id = 'compras'), 'admin preenche a empresa do login');
-- ---------------------------------------------------------------- Sistema Linum: Estoque (lin_)
reset role;
select pg_temp.ok((select count(*) = 2 from lin_lojas) and (select situacao = 'oculto' and manual_url like '/apps/linum/ajuda/%' from apps where id = 'linum'),
  'linum: lojas Gávea e Ipanema e app cadastrado fora da vitrine');
insert into lin_produtos (id, referencia, descricao, categoria, preco_custo, preco_venda) values
  ('10000000-0000-0000-0000-000000000001', 'VES01', 'Vestido Mar', 'Vestido', 150, 489),
  ('10000000-0000-0000-0000-000000000002', 'CAL01', 'Calça Areia', 'Calça', 90, 359);
insert into lin_produtos (id, referencia, descricao, ativo) values ('10000000-0000-0000-0000-000000000003', 'OLD01', 'Peça antiga', false);
insert into lin_variantes (id, produto_id, cor, tamanho, preco_custo) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Azul', 'P', 150),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Azul', 'M', 150),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Cru', 'G', 90),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 'Preto', 'U', 10);
insert into lin_variantes (id, produto_id, cor, tamanho, ativo) values ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'Cru', 'P', false);
create temp table lin_ids (k text primary key, v uuid); grant all on lin_ids to authenticated, anon;
insert into lin_ids select case nome when 'Gávea' then 'gav' else 'ipa' end, id from lin_lojas;
-- b = dono da Linum, c = vendedora; o papel só vale com o app liberado
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.erro2('select lin_estoque_ler()', 'não tem acesso ao Sistema Linum', 'linum: login sem papel não lê o estoque');
select pg_temp.erro2($$select lin_membro_salvar('00000000-0000-0000-0000-00000000000b', 'dono')$$, 'Somente a equipe Nervia', 'linum: cliente não define papel');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.erro2($$select lin_membro_salvar('00000000-0000-0000-0000-00000000000b', 'dono')$$, 'Libere o app', 'linum: papel exige o app liberado');
reset role;
insert into app_acessos values ('00000000-0000-0000-0000-00000000000b', 'linum'), ('00000000-0000-0000-0000-00000000000c', 'linum');
set role authenticated;
select lin_membro_salvar('00000000-0000-0000-0000-00000000000b', 'dono');
select lin_membro_salvar('00000000-0000-0000-0000-00000000000c', 'vendedora', (select v from lin_ids where k = 'ipa'));
select pg_temp.ok((select count(*) = 2 from jsonb_array_elements(lin_equipe()) e where e->>'papel' is not null), 'linum: equipe lista os logins com papel');
select pg_temp.ok((select count(*) = 2 from auditoria where acao = 'linum_papel_definido'), 'linum: papel definido vai para a auditoria');
-- dono movimenta
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok(lin_movimentar('20000000-0000-0000-0000-000000000001', (select v from lin_ids where k = 'gav'), 'entrada', 5, '2026-10-20', 'chegada') = 5, 'linum: entrada soma');
select lin_movimentar('20000000-0000-0000-0000-000000000003', (select v from lin_ids where k = 'gav'), 'entrada', 2);
select pg_temp.ok(lin_movimentar('20000000-0000-0000-0000-000000000001', (select v from lin_ids where k = 'gav'), 'saida', 1, null, 'perda') = 4, 'linum: saída baixa');
select pg_temp.erro2($$select lin_movimentar('20000000-0000-0000-0000-000000000001', (select v from lin_ids where k = 'gav'), 'saida', 9)$$,
  'Estoque insuficiente: a loja tem 4', 'linum: saída maior que o estoque recusada');
select pg_temp.erro2($$select lin_movimentar('20000000-0000-0000-0000-000000000001', (select v from lin_ids where k = 'gav'), 'entrada', 0)$$,
  'maior que zero', 'linum: quantidade zero recusada');
select pg_temp.erro2($$select lin_movimentar('20000000-0000-0000-0000-000000000001', (select v from lin_ids where k = 'gav'), 'venda', 1)$$,
  'Tipo inválido', 'linum: venda não entra pela movimentação manual');
select lin_transferir('20000000-0000-0000-0000-000000000001', (select v from lin_ids where k = 'gav'), (select v from lin_ids where k = 'ipa'), 3, '2026-10-21', 'vitrine');
select pg_temp.ok((select quantidade = 1 from lin_estoque where variante_id = '20000000-0000-0000-0000-000000000001' and loja_id = (select v from lin_ids where k = 'gav'))
  and (select quantidade = 3 from lin_estoque where variante_id = '20000000-0000-0000-0000-000000000001' and loja_id = (select v from lin_ids where k = 'ipa')),
  'linum: transferência tira da origem e põe no destino');
select pg_temp.erro2($$select lin_transferir('20000000-0000-0000-0000-000000000001', (select v from lin_ids where k = 'gav'), (select v from lin_ids where k = 'ipa'), 2)$$,
  'insuficiente na loja de origem', 'linum: transferência maior que a origem recusada');
select pg_temp.erro2($$select lin_transferir('20000000-0000-0000-0000-000000000001', (select v from lin_ids where k = 'gav'), (select v from lin_ids where k = 'gav'), 1)$$,
  'diferentes', 'linum: transferência para a mesma loja recusada');
select lin_ajustar('20000000-0000-0000-0000-000000000002', (select v from lin_ids where k = 'ipa'), 7);
select lin_ajustar('20000000-0000-0000-0000-000000000002', (select v from lin_ids where k = 'ipa'), 0, null, 'contagem');
select pg_temp.erro2($$select lin_ajustar('20000000-0000-0000-0000-000000000002', (select v from lin_ids where k = 'ipa'), 0)$$, 'nada a ajustar', 'linum: ajuste para a mesma quantidade recusado');
select pg_temp.erro2($$select lin_ajustar('20000000-0000-0000-0000-000000000002', (select v from lin_ids where k = 'ipa'), -1)$$, 'negativa', 'linum: ajuste negativo recusado');
select pg_temp.ok((select antes = 0 and depois = 7 and quantidade = 7 and observacao = 'Ajuste de 0 para 7' from lin_movimentos where tipo = 'ajuste' order by id limit 1)
  and (select antes = 7 and depois = 0 and observacao = 'contagem' from lin_movimentos where tipo = 'ajuste' order by id desc limit 1),
  'linum: ajuste guarda antes/depois e observação automática');
select pg_temp.ok((select count(*) = 6 from lin_movimentos) and (select bool_and(criado_por = '00000000-0000-0000-0000-00000000000b' and criado_nome <> '') from lin_movimentos)
  and (select data = '2026-10-21' and loja_destino_id is not null from lin_movimentos where tipo = 'transferencia'),
  'linum: cada movimentação no histórico com quem e quando');
reset role;   -- pela tela o RLS já não deixa; o gatilho segura até o dono do banco
select pg_temp.erro2('update lin_movimentos set quantidade = 99', 'não pode ser alterado', 'linum: histórico não se altera (nem fora da tela)');
set role authenticated;
select pg_temp.erro2($$insert into lin_estoque values ('20000000-0000-0000-0000-000000000003', (select v from lin_ids where k = 'ipa'), 50)$$, 'row-level security', 'linum: estoque não se grava direto');
select pg_temp.ok((select count(*) = 3 from lin_produtos) and (select sum(preco_custo) = 240 from lin_produtos), 'linum: dono lê o catálogo com custo');
select pg_temp.ok((select e->>'papel' = 'dono' and jsonb_array_length(e->'lojas') = 2 and jsonb_array_length(e->'produtos') = 2
    and (select jsonb_array_length(p->'variantes') from jsonb_array_elements(e->'produtos') p where p->>'referencia' = 'CAL01') = 1
    and jsonb_array_length(e->'estoque') = 3 from (select lin_estoque_ler() e) x),
  'linum: leitura traz só produtos e variações ativos e as quantidades diferentes de zero');
-- vendedora: só consulta, sem custo
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((select e->>'papel' = 'vendedora' and jsonb_array_length(e->'produtos') = 2 and position('custo' in e::text) = 0 from (select lin_estoque_ler() e) x),
  'linum: vendedora consulta o estoque sem preço de custo');
select pg_temp.ok((select count(*) = 0 from lin_produtos) and (select count(*) = 0 from lin_variantes) and (select count(*) = 0 from lin_movimentos)
  and (select count(*) = 0 from lin_estoque) and (select count(*) = 2 from lin_lojas), 'linum: vendedora não lê tabelas com custo nem o histórico');
select pg_temp.erro2($$select lin_movimentar('20000000-0000-0000-0000-000000000001', (select v from lin_ids where k = 'gav'), 'entrada', 1)$$, 'Somente o Dono', 'linum: vendedora não movimenta');
select pg_temp.erro2($$select lin_ajustar('20000000-0000-0000-0000-000000000001', (select v from lin_ids where k = 'gav'), 1)$$, 'Somente o Dono', 'linum: vendedora não ajusta');
select pg_temp.erro2($$select lin_transferir('20000000-0000-0000-0000-000000000001', (select v from lin_ids where k = 'ipa'), (select v from lin_ids where k = 'gav'), 1)$$, 'Somente o Dono', 'linum: vendedora não transfere');
-- app retirado na Área do Cliente: o papel deixa de valer
reset role;
delete from app_acessos where user_id = '00000000-0000-0000-0000-00000000000c' and app_id = 'linum';
set role authenticated;
select pg_temp.erro2('select lin_estoque_ler()', 'não tem acesso', 'linum: sem o app liberado o papel não vale');
set role anon;
select pg_temp.erro2('select lin_estoque_ler()', 'permission', 'linum: anônimo não lê o estoque');
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select lin_membro_salvar('00000000-0000-0000-0000-00000000000b', '');
select pg_temp.ok((select count(*) = 1 from auditoria where acao = 'linum_papel_retirado'), 'linum: papel retirado auditado');
-- Sistema Linum: Produtos
reset role;
insert into lin_codigos values (extract(year from now() at time zone 'America/Sao_Paulo')::int, 235)
  on conflict (ano) do update set ultimo = 235;   -- continua a numeração do sistema antigo
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select lin_membro_salvar('00000000-0000-0000-0000-00000000000b', 'dono');
reset role; insert into app_acessos values ('00000000-0000-0000-0000-00000000000c', 'linum'); set role authenticated;
select lin_membro_salvar('00000000-0000-0000-0000-00000000000c', 'vendedora', (select v from lin_ids where k = 'gav'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
create temp table lin_p (k text primary key, v uuid); reset role; grant all on lin_p to authenticated; set role authenticated;
insert into lin_p values ('saia', lin_produto_salvar('{"referencia":"SAI01","descricao":"Saia Duna","categoria":"Saia","fornecedor":"Ateliê X","preco_custo":"80.5","preco_venda":"299.9"}'));
select pg_temp.ok((select codigo_barras = extract(year from now() at time zone 'America/Sao_Paulo')::int || '0000236' and preco_venda = 299.9 and ativo
  from lin_produtos where id = (select v from lin_p where k = 'saia')), 'linum produtos: código de barras automático continua a numeração (ano + 7 dígitos)');
select pg_temp.erro2($$select lin_produto_salvar('{"referencia":"sai01","descricao":"Outra"}')$$, 'Já existe um produto com a referência', 'linum produtos: referência repetida recusada (maiúsculas/minúsculas)');
select pg_temp.erro2($$select lin_produto_salvar('{"referencia":"X1","descricao":" "}')$$, 'Informe a descrição', 'linum produtos: descrição obrigatória');
select pg_temp.erro2($$select lin_produto_salvar('{"referencia":"X1","descricao":"X","preco_venda":"-1"}')$$, 'não pode ser negativo', 'linum produtos: preço negativo recusado');
select lin_produto_salvar(jsonb_build_object('id', (select v from lin_p where k = 'saia'), 'referencia', 'SAI01', 'descricao', 'Saia Duna Longa', 'preco_venda', '319', 'ativo', true));
select pg_temp.ok((select descricao = 'Saia Duna Longa' and preco_venda = 319 and preco_custo is null and codigo_barras like '%0000236' from lin_produtos where id = (select v from lin_p where k = 'saia')),
  'linum produtos: edição salva e o código de barras não muda');
reset role;
update lin_produtos set codigo_barras = 'X' where referencia = 'SAI01';
select pg_temp.ok((select codigo_barras like '%0000236' from lin_produtos where referencia = 'SAI01'), 'linum produtos: código de barras não muda nem por fora da tela');
set role authenticated;
select pg_temp.ok(lin_variantes_criar((select v from lin_p where k = 'saia'), '{Areia, Preto,Areia}', '{P,M}') = 4
  and lin_variantes_criar((select v from lin_p where k = 'saia'), '{Areia,Verde}', '{M}') = 1, 'linum produtos: cores × tamanhos criam só as variações que faltam');
select pg_temp.ok((select count(*) = 5 and bool_and(codigo_barras is null) from lin_variantes where produto_id = (select v from lin_p where k = 'saia')),
  'linum produtos: variação comum usa o código do produto');
select pg_temp.erro2($$select lin_variantes_criar((select v from lin_p where k = 'saia'), '{}', '{P}')$$, 'ao menos uma cor', 'linum produtos: sem cor recusado');
insert into lin_p values ('esp', lin_variante_salvar(jsonb_build_object('produto_id', (select v from lin_p where k = 'saia'), 'cor', 'Areia', 'tamanho', 'M', 'edicao', 'Bordada', 'preco_venda', '450')));
select pg_temp.ok((select edicao = 'Bordada' and preco_venda = 450 and codigo_barras like '%0000237' from lin_variantes where id = (select v from lin_p where k = 'esp')),
  'linum produtos: peça especial com preço e código de barras próprios');
select pg_temp.erro2($$select lin_variante_salvar(jsonb_build_object('produto_id', (select v from lin_p where k = 'saia'), 'cor', 'Areia', 'tamanho', 'M', 'edicao', 'Bordada'))$$,
  'Já existe Areia M Bordada', 'linum produtos: peça especial repetida recusada');
select pg_temp.erro2($$select lin_variante_salvar(jsonb_build_object('produto_id', (select v from lin_p where k = 'saia'), 'cor', 'Areia', 'tamanho', 'M'))$$,
  'Informe a edição', 'linum produtos: peça especial nova exige edição');
select lin_variante_salvar(jsonb_build_object('id', (select id from lin_variantes where produto_id = (select v from lin_p where k = 'saia') and cor = 'Preto' and tamanho = 'P'),
  'edicao', 'Pintada', 'preco_venda', '', 'preco_custo', '95'));
select pg_temp.ok((select edicao = 'Pintada' and preco_venda is null and preco_custo = 95 and codigo_barras like '%0000238' from lin_variantes where cor = 'Preto' and tamanho = 'P'),
  'linum produtos: variação que vira peça especial ganha código próprio');
-- excluir / desativar
select lin_movimentar((select v from lin_p where k = 'esp'), (select v from lin_ids where k = 'gav'), 'entrada', 1);
select pg_temp.erro2($$select lin_variante_excluir((select v from lin_p where k = 'esp'))$$, 'Desative em vez de excluir', 'linum produtos: variação com movimentação não se exclui');
select pg_temp.erro2($$select lin_produto_excluir((select v from lin_p where k = 'saia'))$$, 'não pode ser excluída', 'linum produtos: produto com movimentação não se exclui');
select lin_variante_ativar((select v from lin_p where k = 'esp'), false);
select pg_temp.ok((select count(*) = 0 from jsonb_array_elements(lin_estoque_ler()->'produtos') p, jsonb_array_elements(p->'variantes') x where x->>'id' = (select v::text from lin_p where k = 'esp')),
  'linum produtos: variação desativada some do estoque');
select lin_variante_excluir((select id from lin_variantes where cor = 'Verde'));
reset role;   -- a auditoria só a equipe Nervia lê
select pg_temp.ok((select count(*) = 0 from lin_variantes where cor = 'Verde') and (select count(*) = 1 from auditoria where acao = 'linum_variante_excluida'),
  'linum produtos: variação sem histórico se exclui (com auditoria)');
set role authenticated;
insert into lin_p values ('vazio', lin_produto_salvar('{"referencia":"VAZ01","descricao":"Sem uso"}'));
select lin_variantes_criar((select v from lin_p where k = 'vazio'), '{Cru}', '{U}');
select lin_produto_excluir((select v from lin_p where k = 'vazio'));
reset role;
select pg_temp.ok((select count(*) = 0 from lin_produtos where referencia = 'VAZ01')
  and (select count(*) = 1 from auditoria where acao = 'linum_produto_excluido') and (select count(*) >= 3 from auditoria where acao in ('linum_produto_criado', 'linum_produto_alterado')),
  'linum produtos: produto sem histórico se exclui; criar, alterar e excluir auditados');
set role authenticated;
-- vendedora não cadastra
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.erro2($$select lin_produto_salvar('{"referencia":"V1","descricao":"V"}')$$, 'Somente o Dono', 'linum produtos: vendedora não cadastra produto');
select pg_temp.erro2($$select lin_variantes_criar((select v from lin_p where k = 'saia'), '{Azul}', '{G}')$$, 'Somente o Dono', 'linum produtos: vendedora não cria variação');
select pg_temp.erro2($$select lin_produto_excluir((select v from lin_p where k = 'saia'))$$, 'Somente o Dono', 'linum produtos: vendedora não exclui');
select pg_temp.erro2($$select lin_proximo_codigo()$$, 'permission', 'linum produtos: numeração só pelas funções');
reset role;
-- Sistema Linum: papel Estoque (cadastra, altera preço de venda e movimenta; nunca vê nem altera custo) e auditoria de tudo
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000d', 'estoque@linum.com.br');
insert into app_acessos values ('00000000-0000-0000-0000-00000000000d', 'linum');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select lin_membro_salvar('00000000-0000-0000-0000-00000000000d', 'estoque');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.ok((select lin_estoque_ler()->>'papel') = 'estoque', 'linum estoque: papel Estoque entra no app');
select pg_temp.ok((select count(*) = 0 from lin_produtos) and (select count(*) = 0 from lin_variantes), 'linum estoque: não lê as tabelas com custo');
select pg_temp.ok((select position('custo' in lin_catalogo()::text) = 0 and jsonb_array_length(lin_catalogo()->'produtos') >= 3
  and exists (select 1 from jsonb_array_elements(lin_catalogo()->'produtos') x where x->>'ativo' = 'false')),
  'linum estoque: catálogo completo (com inativos) sem custo');
select pg_temp.ok((select count(*) > 0 from lin_movimentos), 'linum estoque: vê o histórico de movimentações');
select lin_produto_salvar(jsonb_build_object('id', (select v from lin_p where k = 'saia'), 'referencia', 'SAI01', 'descricao', 'Saia Duna Longa',
  'preco_venda', '349', 'preco_custo', '1', 'ativo', true));
reset role;
update lin_produtos set preco_custo = 77 where referencia = 'SAI01';
set role authenticated;
select lin_produto_salvar(jsonb_build_object('id', (select v from lin_p where k = 'saia'), 'referencia', 'SAI01', 'descricao', 'Saia Duna Longa',
  'preco_venda', '359', 'preco_custo', '', 'ativo', true));
reset role;
select pg_temp.ok((select preco_venda = 359 and preco_custo = 77 from lin_produtos where referencia = 'SAI01'),
  'linum estoque: altera o preço de venda e o custo gravado pelo Dono fica como está');
set role authenticated;
insert into lin_p values ('novo', lin_produto_salvar('{"referencia":"EST01","descricao":"Peça do Estoque","preco_venda":"199","preco_custo":"50"}'));
select lin_variantes_criar((select v from lin_p where k = 'novo'), '{Cru}', '{P,M}');
insert into lin_p values ('esp2', lin_variante_salvar(jsonb_build_object('produto_id', (select v from lin_p where k = 'novo'), 'cor', 'Cru', 'tamanho', 'M', 'edicao', 'Pintada', 'preco_venda', '259', 'preco_custo', '90')));
reset role;
select pg_temp.ok((select preco_custo is null from lin_produtos where referencia = 'EST01') and (select preco_custo is null and preco_venda = 259 from lin_variantes where id = (select v from lin_p where k = 'esp2')),
  'linum estoque: cadastra peça e peça especial, mas o custo que ele manda é ignorado');
set role authenticated;
select lin_movimentar((select v from lin_p where k = 'esp2'), (select v from lin_ids where k = 'ipa'), 'entrada', 3, '2026-10-22', 'chegada');
select lin_transferir((select v from lin_p where k = 'esp2'), (select v from lin_ids where k = 'ipa'), (select v from lin_ids where k = 'gav'), 1, null, 'vitrine');
select lin_ajustar((select v from lin_p where k = 'esp2'), (select v from lin_ids where k = 'ipa'), 1, null, 'contagem');
reset role; insert into lin_p select 'estP', id from lin_variantes where produto_id = (select v from lin_p where k = 'novo') and tamanho = 'P'; set role authenticated;
select lin_variante_ativar((select v from lin_p where k = 'estP'), false);
select pg_temp.erro2($$select lin_membro_salvar('00000000-0000-0000-0000-00000000000d', 'dono')$$, 'Somente a equipe Nervia', 'linum estoque: não muda o próprio papel');
reset role;
select pg_temp.ok((select count(*) = 1 from auditoria where acao = 'linum_estoque_entrada' and user_id = '00000000-0000-0000-0000-00000000000d'
    and detalhes->>'papel_linum' = 'estoque' and detalhes->>'loja' = 'Ipanema' and detalhes->>'edicao' = 'Pintada' and (detalhes->>'saldo_depois')::int = 3)
  and (select count(*) = 1 from auditoria where acao = 'linum_estoque_transferencia' and detalhes->>'loja_destino' = 'Gávea')
  and (select count(*) = 1 from auditoria where acao = 'linum_estoque_ajuste' and user_id = '00000000-0000-0000-0000-00000000000d' and (detalhes->>'antes')::int = 2 and (detalhes->>'depois')::int = 1),
  'linum auditoria: entrada, transferência e ajuste no log com peça, loja, quem e papel');
select pg_temp.ok((select count(*) >= 1 from auditoria where acao = 'linum_variantes_criadas' and detalhes->>'referencia' = 'EST01')
  and (select count(*) = 1 from auditoria where acao = 'linum_peca_especial_criada' and detalhes->>'edicao' = 'Pintada' and not detalhes ? 'preco_custo')
  and (select count(*) = 1 from auditoria where acao = 'linum_variante_desativada' and detalhes->>'papel_linum' = 'estoque' and detalhes->>'referencia' = 'EST01')
  and (select count(*) >= 2 from auditoria where acao = 'linum_produto_alterado' and detalhes->>'papel_linum' = 'estoque' and position('preco_custo' in detalhes::text) = 0),
  'linum auditoria: cadastro de variações, peça especial, desativar e alterações no log (sem custo quando é o Estoque)');
select pg_temp.ok((select count(*) >= 1 from auditoria where acao = 'linum_produto_alterado' and detalhes->>'papel_linum' = 'dono' and position('preco_custo' in detalhes::text) > 0),
  'linum auditoria: alteração do Dono guarda o custo antes/depois');
select pg_temp.ok((select count(*) >= 3 from auditoria where acao like 'linum_estoque_%' and detalhes->>'papel_linum' = 'dono'), 'linum auditoria: movimentações do Dono também no log');
-- vendedora continua só consultando
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.erro2('select lin_catalogo()', 'Somente o Dono ou o Estoque', 'linum estoque: vendedora não abre o cadastro');
select pg_temp.ok((select count(*) = 0 from lin_movimentos), 'linum estoque: vendedora não vê o histórico');
reset role;
-- Sistema Linum: Vendas e Clientes (boleta de venda)
reset role;
insert into lin_estoque values ('20000000-0000-0000-0000-000000000002', (select v from lin_ids where k = 'gav'), 5)
  on conflict (variante_id, loja_id) do update set quantidade = 5;
create temp table lin_vd (k text primary key, v text); grant all on lin_vd to authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';   -- vendedora da Gávea
insert into lin_vd values ('cli', lin_cliente_salvar('{"nome":"Eglacy Rocha","telefone":"(21) 97902-3553","aniversario_dia":"21","aniversario_mes":"7","cpf":"123.456.789-01"}')::text);
select pg_temp.ok((select telefone = '21979023553' and cpf = '12345678901' and aniversario_dia = 21 and aniversario_mes = 7 and loja_id = (select v from lin_ids where k = 'gav')
  from lin_clientes where id = (select v from lin_vd where k = 'cli')::uuid), 'linum vendas: cliente com telefone e CPF só dígitos, aniversário e loja da vendedora');
select pg_temp.erro2($$select lin_cliente_salvar('{"nome":"Outra","cpf":"12345678901"}')$$, 'Este CPF já é do cliente Eglacy Rocha', 'linum vendas: CPF repetido recusado');
select pg_temp.erro2($$select lin_cliente_salvar('{"nome":"Outra","aniversario_dia":"31","aniversario_mes":"2"}')$$, 'aniversário inválida', 'linum vendas: aniversário inválido recusado');
select pg_temp.erro2($$select lin_cliente_salvar('{"nome":"Outra","telefone":"9999"}')$$, 'Telefone com DDD', 'linum vendas: telefone curto recusado');
-- venda da vendedora: 2 peças com 10% e desconto geral de 20 centavos, crédito em 6x
insert into lin_vd values ('v1', lin_venda_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'gav'), 'cliente_id', (select v from lin_vd where k = 'cli'),
  'itens', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000002', 'quantidade', 2, 'valor_unitario', 440.10, 'desconto_pct', 10)),
  'desconto', 0.2, 'observacao', 'Niver 21/07', 'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'credito', 'valor', 880, 'parcelas', 6))))::text);
reset role;
select pg_temp.ok((select valor_bruto = 978 and valor_itens = 880.20 and desconto = 0.20 and valor_total = 880 and pagamentos -> 0 ->> 'parcelas' = '6'
    and vendedora_id = '00000000-0000-0000-0000-00000000000c' and data = current_date from lin_vendas where id = (select v from lin_vd where k = 'v1')::bigint)
  and (select referencia = 'VES01' and cor = 'Azul' and tamanho = 'M' and preco_tabela = 489 and desconto_pct = 10 and valor_total = 880.20 from lin_venda_itens where venda_id = (select v from lin_vd where k = 'v1')::bigint)
  and (select quantidade = 3 from lin_estoque where variante_id = '20000000-0000-0000-0000-000000000002' and loja_id = (select v from lin_ids where k = 'gav'))
  and (select count(*) = 1 from lin_movimentos where tipo = 'venda' and observacao = 'Venda nº ' || (select v from lin_vd where k = 'v1')),
  'linum vendas: venda baixa o estoque, guarda a etiqueta, preço de tabela, desconto, total e parcelas');
set role authenticated;
select pg_temp.erro2($$select lin_venda_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'gav'),
  'itens', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000002', 'quantidade', 1, 'valor_unitario', 489)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 400))))$$, 'é diferente do total da venda (R$ 489,00)', 'linum vendas: pagamento diferente do total recusado');
select pg_temp.erro2($$select lin_venda_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'gav'),
  'itens', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000002', 'quantidade', 9, 'valor_unitario', 1)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 9))))$$, 'Estoque insuficiente: Vestido Mar Azul M tem 3', 'linum vendas: estoque insuficiente recusa a venda');
select pg_temp.erro2($$select lin_venda_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'gav'), 'data', current_date - 10,
  'itens', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000002', 'quantidade', 1, 'valor_unitario', 1)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 1))))$$, 'mais de 7 dias', 'linum vendas: vendedora não lança venda antiga');
select pg_temp.erro2($$select lin_venda_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'gav'), 'vendedora_id', '00000000-0000-0000-0000-00000000000b',
  'itens', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000002', 'quantidade', 1, 'valor_unitario', 1)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 1))))$$, 'só registra as próprias vendas', 'linum vendas: vendedora não lança venda em nome de outra');
reset role;
select pg_temp.ok((select quantidade = 3 from lin_estoque where variante_id = '20000000-0000-0000-0000-000000000002' and loja_id = (select v from lin_ids where k = 'gav')),
  'linum vendas: venda recusada não mexe no estoque');
set role authenticated;
-- Dono lança a boleta antiga da vendedora (data passada, dinheiro + pix) e uma venda própria
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into lin_vd values ('v2', lin_venda_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'gav'), 'vendedora_id', '00000000-0000-0000-0000-00000000000c',
  'data', current_date - 17, 'itens', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000002', 'quantidade', 1, 'valor_unitario', '489')),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 89), jsonb_build_object('forma', 'pix', 'valor', 400))))::text);
insert into lin_vd values ('v3', lin_venda_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'gav'),
  'itens', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000002', 'quantidade', 1, 'valor_unitario', '0')), 'pagamentos', '[]'::jsonb))::text);
select pg_temp.ok((select vendedora_nome <> '' and data = current_date - 17 and jsonb_array_length(pagamentos) = 2 from lin_vendas where id = (select v from lin_vd where k = 'v2')::bigint)
  and (select count(*) = 3 from lin_vendas), 'linum vendas: Dono lança boleta antiga em nome da vendedora, com duas formas de pagamento');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((select count(*) = 2 from lin_vendas) and (select count(*) = 2 from lin_venda_itens), 'linum vendas: vendedora vê só as vendas dela');
select pg_temp.erro2($$select lin_venda_cancelar((select v from lin_vd where k = 'v1')::bigint, 'cliente desistiu')$$, 'Somente o Dono', 'linum vendas: vendedora não cancela');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';   -- papel Estoque
select pg_temp.ok((select count(*) = 0 from lin_vendas) and (select count(*) = 1 from lin_clientes), 'linum vendas: Estoque não vê as vendas dos outros, mas vê os clientes');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.erro2($$select lin_venda_cancelar((select v from lin_vd where k = 'v1')::bigint, 'x')$$, 'Informe o motivo', 'linum vendas: cancelar exige motivo');
select lin_venda_cancelar((select v from lin_vd where k = 'v1')::bigint, 'Cliente devolveu no mesmo dia');
select pg_temp.erro2($$select lin_venda_cancelar((select v from lin_vd where k = 'v1')::bigint, 'de novo, de novo')$$, 'já foi cancelada', 'linum vendas: não cancela duas vezes');
reset role;
select pg_temp.ok((select quantidade = 3 from lin_estoque where variante_id = '20000000-0000-0000-0000-000000000002' and loja_id = (select v from lin_ids where k = 'gav'))
  and (select cancelada_em is not null and motivo_cancelamento = 'Cliente devolveu no mesmo dia' from lin_vendas where id = (select v from lin_vd where k = 'v1')::bigint)
  and (select count(*) = 1 from lin_movimentos where tipo = 'devolucao' and quantidade = 2),
  'linum vendas: cancelamento devolve as peças e a venda fica no histórico como cancelada');
select pg_temp.erro2($$update lin_vendas set valor_total = 1 where id = (select v from lin_vd where k = 'v2')::bigint$$, 'não pode ser alterada', 'linum vendas: venda não se altera');
select pg_temp.erro2($$delete from lin_vendas where id = (select v from lin_vd where k = 'v2')::bigint$$, 'não se apaga', 'linum vendas: venda não se apaga');
select pg_temp.ok((select count(*) = 3 from auditoria where acao = 'linum_venda_registrada') and (select count(*) = 1 from auditoria where acao = 'linum_venda_cancelada')
  and (select count(*) = 1 from auditoria where acao = 'linum_cliente_criado')
  and (select detalhes -> 'itens' -> 0 ->> 'referencia' = 'VES01' from auditoria where acao = 'linum_venda_registrada' order by id limit 1),
  'linum vendas: venda, cancelamento e cliente na auditoria');
-- Sistema Linum: todos vendem em qualquer loja; comissão em % por pessoa (0 = sem comissão)
reset role;
insert into lin_estoque values ('20000000-0000-0000-0000-000000000003', (select v from lin_ids where k = 'ipa'), 4)
  on conflict (variante_id, loja_id) do update set quantidade = 4;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.erro2($$select lin_membro_salvar('00000000-0000-0000-0000-00000000000c', 'vendedora', null, 120)$$, 'de 0 a 100', 'linum comissão: % acima de 100 recusado');
select lin_membro_salvar('00000000-0000-0000-0000-00000000000c', 'vendedora', (select v from lin_ids where k = 'gav'), 3.5);
select lin_membro_salvar('00000000-0000-0000-0000-00000000000c', 'vendedora', null);   -- sem informar a comissão: mantém 3,5%
select pg_temp.ok((select (e->>'comissao_pct')::numeric = 3.5 from jsonb_array_elements(lin_equipe()) e where e->>'user_id' = '00000000-0000-0000-0000-00000000000c')
  and (select count(*) = 3 from jsonb_array_elements(lin_vendedoras())), 'linum comissão: % salvo na equipe; todos os membros aparecem entre quem vende');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';   -- vendedora, sem loja principal
insert into lin_vd values ('v4', lin_venda_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'ipa'),
  'itens', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000003', 'quantidade', 1, 'valor_unitario', 359)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 359))))::text);
reset role;
select pg_temp.ok((select loja_id = (select v from lin_ids where k = 'ipa') and comissao_pct = 3.5 and comissao_valor = 12.57 from lin_vendas where id = (select v from lin_vd where k = 'v4')::bigint),
  'linum comissão: vendedora vende em qualquer loja e a venda guarda 3,5% = R$ 12,57');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';   -- Estoque também vende, com 0% de comissão
insert into lin_vd values ('v5', lin_venda_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'ipa'), 'cliente_id', (select v from lin_vd where k = 'cli'),
  'itens', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000003', 'quantidade', 1, 'valor_unitario', 359)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'debito', 'valor', 359))))::text);
select pg_temp.ok((select count(*) = 1 from lin_vendas) and (select comissao_pct = 0 and comissao_valor = 0 from lin_vendas where id = (select v from lin_vd where k = 'v5')::bigint),
  'linum comissão: Estoque vende sem comissão (0%) e vê só a venda dele');
select pg_temp.ok((select count(*) = 0 from lin_produtos), 'linum comissão: quem é do Estoque continua sem ler o custo');
select pg_temp.erro2($$select lin_venda_cancelar((select v from lin_vd where k = 'v5')::bigint, 'teste de cancelamento')$$, 'Somente o Dono', 'linum comissão: Estoque não cancela venda');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((select count(*) = 3 from lin_vendas) and (select count(*) = 0 from lin_vendas where vendedora_id <> '00000000-0000-0000-0000-00000000000c'),
  'linum comissão: vendedora vê só as vendas dela, de todas as lojas');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 5 from lin_vendas), 'linum comissão: Dono vê as vendas de todos');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select lin_membro_salvar('00000000-0000-0000-0000-00000000000c', 'vendedora', null, 5);
reset role;
select pg_temp.ok((select comissao_pct = 3.5 from lin_vendas where id = (select v from lin_vd where k = 'v4')::bigint),
  'linum comissão: mudar o % não altera as vendas já feitas');
select pg_temp.ok((select count(*) >= 1 from auditoria where acao = 'linum_papel_definido' and (detalhes->>'comissao_pct')::numeric = 5 and (detalhes->>'comissao_pct_antes')::numeric = 3.5)
  and (select (detalhes->>'comissao_valor')::numeric = 12.57 from auditoria where acao = 'linum_venda_registrada' and (detalhes->>'venda')::bigint = (select v from lin_vd where k = 'v4')::bigint),
  'linum comissão: troca do % e comissão da venda na auditoria');
-- Sistema Linum: Troca (a opção "Troca" da boleta)
reset role;
create temp table lin_tr (k text primary key, v text); grant all on lin_tr to authenticated;
create or replace function pg_temp.est(v uuid, l text) returns int language sql as $$
  select coalesce((select quantidade from lin_estoque where variante_id = v and loja_id = (select x.v from lin_ids x where x.k = l)), 0) $$;
insert into lin_tr values ('ini_g3', pg_temp.est('20000000-0000-0000-0000-000000000003', 'gav')::text), ('ini_g2', pg_temp.est('20000000-0000-0000-0000-000000000002', 'gav')::text);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';   -- vendedora, troca na Gávea a calça comprada na Ipanema (venda v4)
select pg_temp.ok((select (e->>'trocavel')::int = 1 and (e->>'valor_unitario')::numeric = 359 from jsonb_array_elements(lin_venda_trocavel((select v from lin_vd where k = 'v4')::bigint)->'itens') e),
  'linum troca: venda mostra o que ainda pode ser trocado e o valor pago');
select pg_temp.erro2($$select lin_troca_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'gav'), 'venda_id', (select v from lin_vd where k = 'v4'),
  'devolvidas', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000003', 'quantidade', 1)),
  'novas', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000002', 'quantidade', 1, 'valor_unitario', 489)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 100))))$$, 'diferença de R$ 130,00', 'linum troca: diferença a pagar tem de fechar');
insert into lin_tr values ('t1', lin_troca_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'gav'), 'venda_id', (select v from lin_vd where k = 'v4'),
  'devolvidas', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000003', 'quantidade', 1, 'valor_unitario', 1)),
  'novas', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000002', 'quantidade', 1, 'valor_unitario', 489)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'credito', 'valor', 130, 'parcelas', 2))))::text);
reset role;
select pg_temp.ok((select valor_devolvido = 359 and valor_novas = 489 and diferenca = 130 and devolucao_forma is null and venda_id = (select v from lin_vd where k = 'v4')::bigint
    from lin_trocas where id = (select v from lin_tr where k = 't1')::bigint)
  and pg_temp.est('20000000-0000-0000-0000-000000000003', 'gav') = (select v from lin_tr where k = 'ini_g3')::int + 1
  and pg_temp.est('20000000-0000-0000-0000-000000000002', 'gav') = (select v from lin_tr where k = 'ini_g2')::int - 1
  and (select count(*) = 2 from lin_movimentos where observacao like 'Troca nº ' || (select v from lin_tr where k = 't1') || ' %'),
  'linum troca: devolvida volta e nova sai na loja da troca; valor da devolvida é o pago na venda; cliente paga a diferença');
select pg_temp.ok((select comissao_valor = 12.57 from lin_vendas where id = (select v from lin_vd where k = 'v4')::bigint), 'linum troca: comissão da venda original não muda');
set role authenticated;
select pg_temp.erro2($$select lin_troca_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'gav'), 'venda_id', (select v from lin_vd where k = 'v4'),
  'devolvidas', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000003', 'quantidade', 1)),
  'novas', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000002', 'quantidade', 1, 'valor_unitario', 359)), 'pagamentos', '[]'::jsonb))$$,
  'só restam 0 peça', 'linum troca: não troca de novo a mesma peça da venda');
select pg_temp.erro2($$select lin_troca_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'gav'), 'venda_id', (select v from lin_vd where k = 'v4'),
  'devolvidas', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000001', 'quantidade', 1)),
  'novas', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000002', 'quantidade', 1)), 'pagamentos', '[]'::jsonb))$$,
  'não está na venda', 'linum troca: peça que não é da venda recusada');
select pg_temp.erro2($$select lin_troca_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'gav'), 'venda_id', (select v from lin_vd where k = 'v1'),
  'devolvidas', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000002', 'quantidade', 1)),
  'novas', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000002', 'quantidade', 1)), 'pagamentos', '[]'::jsonb))$$,
  'foi cancelada', 'linum troca: venda cancelada não tem troca');
-- compra antiga (sem venda no sistema): peça nova mais barata, a loja devolve a diferença
select pg_temp.erro2($$select lin_troca_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'gav'),
  'devolvidas', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000001', 'quantidade', 1, 'valor_unitario', 400)),
  'novas', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000003', 'quantidade', 1, 'valor_unitario', 359)), 'pagamentos', '[]'::jsonb))$$,
  'Informe como a diferença de R$ 41,00 volta', 'linum troca: diferença a devolver exige a forma');
insert into lin_tr values ('t2', lin_troca_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'gav'), 'cliente_id', (select v from lin_vd where k = 'cli'),
  'devolvidas', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000001', 'quantidade', 1, 'valor_unitario', 400)),
  'novas', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000003', 'quantidade', 1, 'valor_unitario', 359)),
  'devolucao_forma', 'vale', 'observacao', 'compra de antes do sistema'))::text);
reset role;
select pg_temp.ok((select diferenca = -41 and devolucao_forma = 'vale' and venda_id is null and cliente_id is not null from lin_trocas where id = (select v from lin_tr where k = 't2')::bigint),
  'linum troca: compra antiga, diferença de R$ 41 volta em vale-troca');
set role authenticated;
select pg_temp.erro2($$select lin_troca_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'gav'),
  'devolvidas', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000001', 'quantidade', 1, 'valor_unitario', 1)),
  'novas', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000003', 'quantidade', 99, 'valor_unitario', 0)), 'pagamentos', '[]'::jsonb))$$,
  'Estoque insuficiente', 'linum troca: sem estoque da peça nova a troca é recusada');
select pg_temp.ok((select count(*) = 2 from lin_trocas), 'linum troca: vendedora vê as trocas dela');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.ok((select count(*) = 0 from lin_trocas) and (select count(*) = 0 from lin_troca_itens), 'linum troca: os outros não veem as trocas dela');
select pg_temp.erro2($$select lin_troca_cancelar((select v from lin_tr where k = 't1')::bigint, 'motivo qualquer')$$, 'Somente o Dono', 'linum troca: só o Dono cancela');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 2 from lin_trocas), 'linum troca: Dono vê todas');
select lin_troca_cancelar((select v from lin_tr where k = 't1')::bigint, 'Lançada na venda errada');
reset role;
select pg_temp.ok(pg_temp.est('20000000-0000-0000-0000-000000000003', 'gav') = (select v from lin_tr where k = 'ini_g3')::int - 1   -- +1 e −1 da 1ª troca (cancelada) e −1 da 2ª
  and pg_temp.est('20000000-0000-0000-0000-000000000002', 'gav') = (select v from lin_tr where k = 'ini_g2')::int
  and (select (e->>'trocavel')::int = 1 from jsonb_array_elements(lin_venda_trocavel((select v from lin_vd where k = 'v4')::bigint)->'itens') e),
  'linum troca: cancelar desfaz o estoque e a peça da venda volta a poder ser trocada');
select pg_temp.erro2($$update lin_trocas set diferenca = 0 where id = (select v from lin_tr where k = 't2')::bigint$$, 'Não pode ser alterada', 'linum troca: troca não se altera');
select pg_temp.erro2($$delete from lin_troca_itens$$, 'não se apaga', 'linum troca: itens não se apagam');
select pg_temp.ok((select count(*) = 2 from auditoria where acao = 'linum_troca_registrada') and (select count(*) = 1 from auditoria where acao = 'linum_troca_cancelada'),
  'linum troca: registro e cancelamento na auditoria');
reset role;
set role anon;
select pg_temp.erro2('select * from apps_vitrine()', 'permission', 'anônimo não vê a vitrine');
reset role;
reset request.jwt.claim.sub;
-- ---------------------------------------------------------------- Compras: aprovação por setor
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'sol@setores.com', '{"nome":"Sol Setores"}'),
  ('00000000-0000-0000-0000-0000000000e2', 'comp@setores.com', '{"nome":"Comp Setores"}'),
  ('00000000-0000-0000-0000-0000000000e3', 'gfin@setores.com', '{"nome":"Gerente Fin"}'),
  ('00000000-0000-0000-0000-0000000000e4', 'gmkt@setores.com', '{"nome":"Gerente Mkt"}'),
  ('00000000-0000-0000-0000-0000000000e5', 'dir@setores.com', '{"nome":"Diretor Setores"}'),
  ('00000000-0000-0000-0000-0000000000e6', 'ggeral@setores.com', '{"nome":"Gerente Geral"}');
insert into cmp_unidades (id, nome) values ('30000000-0000-0000-0000-000000000003', 'Unidade com setores');
insert into cmp_setores (id, unidade_id, nome, alcada_gerente) values
  ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Financeiro', 20000),
  ('31000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', 'Marketing', null),
  ('31000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'Comercial', null);
insert into cmp_membros (user_id, unidade_id, papel, setor_id) values
  ('00000000-0000-0000-0000-0000000000e1', '30000000-0000-0000-0000-000000000003', 'solicitante', null),
  ('00000000-0000-0000-0000-0000000000e2', '30000000-0000-0000-0000-000000000003', 'comprador', null),
  ('00000000-0000-0000-0000-0000000000e3', '30000000-0000-0000-0000-000000000003', 'gerente', '31000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000e4', '30000000-0000-0000-0000-000000000003', 'gerente', '31000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-0000000000e4', '30000000-0000-0000-0000-000000000003', 'gerente', '31000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-0000000000e5', '30000000-0000-0000-0000-000000000003', 'diretor', null),
  ('00000000-0000-0000-0000-0000000000e6', '30000000-0000-0000-0000-000000000003', 'gerente', null);
select pg_temp.ok((select count(*) = 2 from cmp_membros where user_id = '00000000-0000-0000-0000-0000000000e4'), 'setores: o mesmo login pode ser Gerente de dois setores');
select pg_temp.erro($$insert into cmp_membros (user_id, unidade_id, papel, setor_id) values ('00000000-0000-0000-0000-0000000000e2', '30000000-0000-0000-0000-000000000003', 'comprador', '31000000-0000-0000-0000-000000000001')$$,
  'cmp_membros_setor_so_gerente', 'setores: só o papel Gerente tem setor');
select pg_temp.erro($$insert into cmp_membros (user_id, unidade_id, papel, setor_id) values ('00000000-0000-0000-0000-0000000000e3', '30000000-0000-0000-0000-000000000003', 'gerente', '31000000-0000-0000-0000-000000000001')$$,
  'duplicate', 'setores: o mesmo papel no mesmo setor não repete');
select pg_temp.erro($$insert into cmp_membros (user_id, unidade_id, papel, setor_id) values ('00000000-0000-0000-0000-0000000000e3', pg_temp.id('itaipu')::uuid, 'gerente', '31000000-0000-0000-0000-000000000001')$$,
  'cmp_membros_setor_fk', 'setores: Gerente não recebe setor de outra unidade');
select pg_temp.ok((select count(*) = 3 from auditoria where acao = 'compras_setor_criado')
  and exists (select 1 from auditoria where acao = 'compras_papel_concedido' and detalhes->>'setor' = 'Marketing'), 'setores: criação e papel do setor na auditoria');

set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000e1');
select pg_temp.ok((select count(*) = 3 from cmp_setores), 'setores: membro da unidade lê os setores dela');
select pg_temp.erro($$insert into cmp_requisicoes (unidade_id, grupo, titulo) values ('30000000-0000-0000-0000-000000000003', 'Outros', 'Sem setor')$$, 'Escolha o setor', 'setores: requisição sem setor é recusada quando a unidade tem setores');
select pg_temp.erro($$insert into cmp_requisicoes (unidade_id, grupo, titulo, setor_id) values ('30000000-0000-0000-0000-000000000003', 'Outros', 'x', gen_random_uuid())$$, 'Setor inativo ou de outra unidade', 'setores: setor desconhecido é recusado');
insert into cmp_requisicoes (unidade_id, grupo, titulo, setor_id) values ('30000000-0000-0000-0000-000000000003', 'Informática e tecnologia', 'Notebook do Financeiro', '31000000-0000-0000-0000-000000000001');
insert into ids select 's1', max(id)::text from cmp_requisicoes;
insert into cmp_requisicoes (unidade_id, grupo, titulo, setor_id) values ('30000000-0000-0000-0000-000000000003', 'Informática e tecnologia', 'Telão do Marketing', '31000000-0000-0000-0000-000000000002');
insert into ids select 's2', max(id)::text from cmp_requisicoes;
insert into cmp_requisicoes (unidade_id, grupo, titulo, setor_id) values ('30000000-0000-0000-0000-000000000003', 'Informática e tecnologia', 'Pedido no setor errado', '31000000-0000-0000-0000-000000000002');
insert into ids select 's3', max(id)::text from cmp_requisicoes;
select pg_temp.ok((select texto like '%(setor Financeiro)%' from cmp_historico where requisicao_id = pg_temp.id('s1')::bigint and acao = 'requisicao_criada'), 'setores: histórico da requisição mostra o setor');

-- três propostas em cada (30 mil)
select pg_temp.como('00000000-0000-0000-0000-0000000000e2');
select cmp_salvar_proposta(pg_temp.id(k)::bigint, pg_temp.id(f)::uuid, v, 0, 0, 5, 'À vista', 0, null, '')
  from (values ('s1', 'fa', 30000), ('s1', 'fb', 31000), ('s1', 'fc', 32000), ('s2', 'fa', 30000), ('s2', 'fb', 31000), ('s2', 'fc', 32000),
               ('s3', 'fa', 30000), ('s3', 'fb', 31000), ('s3', 'fc', 32000)) x(k, f, v);
select cmp_escolher(pg_temp.id(k)::bigint, (select id from cmp_propostas where requisicao_id = pg_temp.id(k)::bigint and fornecedor_id = pg_temp.id('fa')::uuid), '')
  from (values ('s1'), ('s2'), ('s3')) x(k);
select pg_temp.ok(cmp_enviar_aprovacao(pg_temp.id('s1')::bigint) = 'diretor', 'setores: Financeiro com limite próprio de 20 mil: 30 mil vai ao Gerente do setor e ao Diretor');
select pg_temp.ok(cmp_enviar_aprovacao(pg_temp.id('s2')::bigint) = 'gerente', 'setores: Marketing sem limite próprio usa o da unidade (50 mil): só o Gerente');
select pg_temp.ok((select texto like '%Gerente do setor Financeiro%' from cmp_historico where requisicao_id = pg_temp.id('s1')::bigint and acao = 'enviada_aprovacao'), 'setores: envio registra o Gerente do setor');

-- só o Gerente do setor (ou o geral) aprova
select pg_temp.como('00000000-0000-0000-0000-0000000000e4');
select pg_temp.erro('select cmp_decidir(' || pg_temp.id('s1') || ', true, '''', false)', 'Gerente do setor Financeiro', 'setores: Gerente do Marketing não aprova compra do Financeiro');
select pg_temp.como('00000000-0000-0000-0000-0000000000e5');
select pg_temp.erro('select cmp_decidir(' || pg_temp.id('s1') || ', true, '''', false)', 'Gerente do setor Financeiro', 'setores: Diretor não pula o Gerente do setor');
select pg_temp.como('00000000-0000-0000-0000-0000000000e3');
select pg_temp.erro('select cmp_decidir(' || pg_temp.id('s2') || ', true, '''', false)', 'Gerente do setor Marketing', 'setores: Gerente do Financeiro não aprova compra do Marketing');
select pg_temp.ok(cmp_decidir(pg_temp.id('s1')::bigint, true, 'ok', false) = 'aprovacao', 'setores: Gerente do Financeiro aprova e segue para o Diretor');
select pg_temp.ok((select texto like 'Aprovada pelo Gerente (Financeiro)%' from cmp_historico where requisicao_id = pg_temp.id('s1')::bigint and acao = 'aprovada_gerente'), 'setores: aprovação registra o setor do Gerente');
select pg_temp.como('00000000-0000-0000-0000-0000000000e5');
select pg_temp.ok(cmp_decidir(pg_temp.id('s1')::bigint, true, '', false) = 'aprovada', 'setores: Diretor aprova a segunda etapa');
select pg_temp.como('00000000-0000-0000-0000-0000000000e6');
select pg_temp.ok(cmp_decidir(pg_temp.id('s2')::bigint, true, '', false) = 'aprovada', 'setores: Gerente de todos os setores aprova qualquer setor (até a alçada, termina nele)');

-- setor errado: o comprador corrige antes da aprovação
select pg_temp.como('00000000-0000-0000-0000-0000000000e1');
select pg_temp.erro('select cmp_req_setor(' || pg_temp.id('s3') || ', ''31000000-0000-0000-0000-000000000001'')', 'precisa ser: comprador ou gerente', 'setores: solicitante não troca o setor');
select pg_temp.como('00000000-0000-0000-0000-0000000000e2');
select cmp_req_setor(pg_temp.id('s3')::bigint, '31000000-0000-0000-0000-000000000001');
select pg_temp.ok((select setor_id = '31000000-0000-0000-0000-000000000001' from cmp_requisicoes where id = pg_temp.id('s3')::bigint)
  and exists (select 1 from cmp_historico where requisicao_id = pg_temp.id('s3')::bigint and texto = 'Setor mudou de Marketing para Financeiro'), 'setores: comprador troca o setor e fica no histórico');
select pg_temp.como('00000000-0000-0000-0000-0000000000e4');
select pg_temp.erro('select cmp_cancelar(' || pg_temp.id('s3') || ', ''não precisa'')', 'gerente do setor Financeiro', 'setores: Gerente de outro setor não cancela');
select pg_temp.erro('select cmp_req_setor(' || pg_temp.id('s3') || ', ''31000000-0000-0000-0000-000000000002'')', 'só o Gerente desse setor', 'setores: Gerente de outro setor não puxa a requisição');

-- sem Gerente para o setor, não envia (a compra ficaria parada)
reset role;
delete from cmp_membros where user_id = '00000000-0000-0000-0000-0000000000e6';
update cmp_membros set setor_id = '31000000-0000-0000-0000-000000000002' where user_id = '00000000-0000-0000-0000-0000000000e3';
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000e2');
select pg_temp.erro('select cmp_enviar_aprovacao(' || pg_temp.id('s3') || ')', 'Ninguém tem o papel de Gerente do setor Financeiro', 'setores: sem Gerente do setor (nem geral) não envia');
-- a automática nunca passa do limite do Gerente do setor (Comercial: Gerente até 1.000; automática da unidade: 5.000)
reset role;
update cmp_setores set alcada_gerente = 1000 where id = '31000000-0000-0000-0000-000000000003';
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000e1');
insert into cmp_requisicoes (unidade_id, grupo, titulo, setor_id) values ('30000000-0000-0000-0000-000000000003', 'Informática e tecnologia', 'Monitor do Comercial', '31000000-0000-0000-0000-000000000003');
insert into ids select 's4', max(id)::text from cmp_requisicoes;
insert into cmp_requisicoes (unidade_id, grupo, titulo, setor_id) values ('30000000-0000-0000-0000-000000000003', 'Informática e tecnologia', 'Mouse do Comercial', '31000000-0000-0000-0000-000000000003');
insert into ids select 's5', max(id)::text from cmp_requisicoes;
select pg_temp.como('00000000-0000-0000-0000-0000000000e2');
select cmp_salvar_proposta(pg_temp.id(k)::bigint, pg_temp.id('fa')::uuid, v, 0, 0, 5, 'À vista', 0, null, ''), cmp_excecao(pg_temp.id(k)::bigint, 'Teste do limite da automática por setor.')
  from (values ('s4', 3000), ('s5', 800)) x(k, v);
select cmp_escolher(pg_temp.id(k)::bigint, (select id from cmp_propostas where requisicao_id = pg_temp.id(k)::bigint), '') from (values ('s4'), ('s5')) x(k);
select pg_temp.ok(cmp_enviar_aprovacao(pg_temp.id('s4')::bigint) = 'diretor', 'setores: 3 mil no Comercial (Gerente até 1 mil) não é automática mesmo com a automática da unidade em 5 mil');
select pg_temp.ok(cmp_enviar_aprovacao(pg_temp.id('s5')::bigint) = 'automatica', 'setores: até o limite do Gerente do setor a automática continua valendo');
reset role;
reset request.jwt.claim.sub;
-- ---------------------------------------------------------------- e-mails (registro dos envios)
reset role;
insert into email_envios (tipo, para, assunto, ok) values ('teste', 'a@b.com', 'Teste', true);
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select count(*) = 1 from email_envios), 'e-mails: equipe Nervia lê o registro de envios');
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) = 0 from email_envios), 'e-mails: cliente não lê o registro de envios');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.erro($$insert into email_envios (tipo, para, ok) values ('x', 'y@z.com', true)$$, 'permission', 'e-mails: nem a equipe grava pela tela (só as funções)');
reset role;
set role anon;
select pg_temp.erro('select * from email_envios', 'permission', 'e-mails: anônimo não lê');
reset role;
reset request.jwt.claim.sub;
-- ---------------------------------------------------------------- Sistema Linum: CRM (clientes e possíveis clientes, histórico de contatos)
reset role;
insert into lin_estoque values ('20000000-0000-0000-0000-000000000003', (select v from lin_ids where k = 'ipa'), 5)
  on conflict (variante_id, loja_id) do update set quantidade = 5;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';   -- vendedora
insert into lin_vd values ('pos', lin_cliente_salvar('{"nome":"Paula Possível","telefone":"21988887777","situacao":"possivel","origem":"Instagram","interesses":"vestidos de linho"}')::text);
select pg_temp.ok((select situacao = 'possivel' and origem = 'Instagram' and responsavel_id = '00000000-0000-0000-0000-00000000000c' and proximo_contato is null
  from lin_clientes where id = (select v from lin_vd where k = 'pos')::uuid), 'linum crm: vendedora cadastra possível cliente e fica como responsável');
select pg_temp.erro2($$select lin_contato_registrar(jsonb_build_object('cliente_id', (select v from lin_vd where k = 'pos'), 'canal', 'whatsapp', 'resultado', 'vai_a_loja', 'texto', 'oi'))$$,
  'Escreva o que foi conversado', 'linum crm: contato sem texto recusado');
select pg_temp.erro2($$select lin_contato_registrar(jsonb_build_object('cliente_id', (select v from lin_vd where k = 'pos'), 'canal', 'pombo', 'resultado', 'vai_a_loja', 'texto', 'chamei para a loja'))$$,
  'como foi o contato', 'linum crm: canal desconhecido recusado');
select pg_temp.erro2($$select lin_contato_registrar(jsonb_build_object('cliente_id', (select v from lin_vd where k = 'pos'), 'canal', 'whatsapp', 'resultado', 'vai_a_loja', 'texto', 'chamei para a loja', 'proximo_contato', current_date - 2))$$,
  'hoje ou depois', 'linum crm: próximo contato no passado recusado');
insert into lin_vd values ('ct1', lin_contato_registrar(jsonb_build_object('cliente_id', (select v from lin_vd where k = 'pos'), 'canal', 'whatsapp', 'resultado', 'vai_a_loja',
  'texto', 'Mandei fotos da coleção nova; disse que passa sábado na Gávea.', 'proximo_contato', current_date + 3))::text);
select pg_temp.ok((select proximo_contato = current_date + 3 and ultimo_contato is not null from lin_clientes where id = (select v from lin_vd where k = 'pos')::uuid)
  and (select por_nome <> '' and canal = 'whatsapp' from lin_contatos where id = (select v from lin_vd where k = 'ct1')::bigint),
  'linum crm: contato registrado com quem fez e atualiza o próximo contato do cadastro');
select pg_temp.erro2($$update lin_contatos set texto = 'outra coisa' where id = (select v from lin_vd where k = 'ct1')::bigint$$, 'permission', 'linum crm: contato não se altera pela tela');
select pg_temp.erro2($$insert into lin_contatos (cliente_id, canal, resultado, texto) values ((select v from lin_vd where k = 'pos')::uuid, 'loja', 'outro', 'direto')$$, 'permission', 'linum crm: contato só pela função');
-- edição pela venda (sem campos do CRM) não apaga o acompanhamento
select lin_cliente_salvar(jsonb_build_object('id', (select v from lin_vd where k = 'pos'), 'nome', 'Paula Possível', 'telefone', '21988887777'));
select pg_temp.ok((select situacao = 'possivel' and origem = 'Instagram' and proximo_contato = current_date + 3 from lin_clientes where id = (select v from lin_vd where k = 'pos')::uuid),
  'linum crm: cadastro rápido da venda não mexe nos campos do acompanhamento');
select pg_temp.erro2($$select lin_cliente_salvar(jsonb_build_object('id', (select v from lin_vd where k = 'pos'), 'nome', 'Paula Possível', 'situacao', 'possivel', 'responsavel_id', '00000000-0000-0000-0000-0000000000ff'))$$,
  'alguém da equipe', 'linum crm: responsável de fora da equipe recusado');
-- quem compra vira cliente
insert into lin_vd values ('vpos', lin_venda_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'ipa'), 'cliente_id', (select v from lin_vd where k = 'pos'),
  'itens', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000003', 'quantidade', 1, 'valor_unitario', 359)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 359))))::text);
select pg_temp.ok((select situacao = 'cliente' from lin_clientes where id = (select v from lin_vd where k = 'pos')::uuid), 'linum crm: possível cliente que compra vira cliente');
select pg_temp.ok((select resultado = 'comprou' and canal = 'loja' and por = '00000000-0000-0000-0000-00000000000c' and texto = 'Comprou na Ipanema — venda nº ' || (select v from lin_vd where k = 'vpos') || ': CAL01 Calça Areia Cru G'
   and proximo_contato is null from lin_contatos where venda_id = (select v from lin_vd where k = 'vpos')::bigint),
  'linum crm: a venda entra sozinha no histórico, com loja, nº e peças, sem o valor (pós-venda não marcado: já havia contato antes)');
select pg_temp.ok((select proximo_contato = current_date + 3 from lin_clientes where id = (select v from lin_vd where k = 'pos')::uuid),
  'linum crm: contato já marcado antes do pós-venda continua');
-- cliente sem nada marcado: a venda marca o pós-venda em 7 dias
insert into lin_vd values ('cli7', lin_cliente_salvar('{"nome":"Sônia Sete"}')::text);
insert into lin_vd values ('v7', lin_venda_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'ipa'), 'cliente_id', (select v from lin_vd where k = 'cli7'),
  'itens', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000003', 'quantidade', 1, 'valor_unitario', 1234.5)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 1234.5))))::text);
select pg_temp.ok((select proximo_contato = (select data from lin_vendas where id = (select v from lin_vd where k = 'v7')::bigint) + 7 and ultimo_contato is not null
   from lin_clientes where id = (select v from lin_vd where k = 'cli7')::uuid)
  and (select texto like '%Pós-venda marcado para%' and texto not like '%R$%' and proximo_contato is not null from lin_contatos where venda_id = (select v from lin_vd where k = 'v7')::bigint),
  'linum crm: venda marca o pós-venda em 7 dias (sem valor no texto)');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';   -- Dono cancela
select lin_venda_cancelar((select v from lin_vd where k = 'v7')::bigint, 'Lançada por engano');
select pg_temp.ok((select count(*) = 1 from lin_contatos where venda_id = (select v from lin_vd where k = 'v7')::bigint and resultado = 'outro' and texto like 'Venda nº % cancelada. Motivo: Lançada por engano'),
  'linum crm: cancelamento da venda entra no histórico com o motivo');
select pg_temp.ok((select proximo_contato is null from lin_clientes where id = (select v from lin_vd where k = 'cli7')::uuid), 'linum crm: venda cancelada tira o pós-venda que tinha marcado');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
-- a equipe toda vê o histórico; quem não é da Linum não vê
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';   -- Estoque
select pg_temp.ok((select count(*) = 2 from lin_contatos where cliente_id = (select v from lin_vd where k = 'pos')::uuid), 'linum crm: outra pessoa da equipe vê o histórico (contato + venda)');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.ok((select count(*) = 0 from lin_contatos), 'linum crm: login fora da Linum não vê contatos');
reset role;
select pg_temp.erro2($$delete from lin_contatos where id = (select v from lin_vd where k = 'ct1')::bigint$$, 'não pode ser alterado nem apagado', 'linum crm: histórico é somente inclusão (nem o dono do banco apaga)');
select pg_temp.ok((select count(*) = 1 from auditoria where acao = 'linum_contato_registrado' and detalhes->>'resultado' = 'vai_a_loja' and not (detalhes ? 'texto')),
  'linum crm: contato na auditoria (sem o texto da conversa)');
-- visita sem contato
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';   -- vendedora
select pg_temp.erro2($$select lin_visita_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'ipa'), 'motivos', jsonb_build_array()))$$, 'por que não levou', 'linum visita: motivo obrigatório');
select pg_temp.erro2($$select lin_visita_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'ipa'), 'motivos', jsonb_build_array('sei_la')))$$, 'por que não levou', 'linum visita: motivo desconhecido recusado');
select pg_temp.erro2($$select lin_visita_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'ipa'), 'motivos', jsonb_build_array('preco', 'outro')))$$, 'outro motivo', 'linum visita: Outro exige o motivo escrito');
select pg_temp.erro2($$select lin_visita_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'ipa'), 'motivos', jsonb_build_array('preco'), 'pessoas', 30))$$, 'de 1 a 20', 'linum visita: pessoas de 1 a 20');
select pg_temp.erro2($$select lin_visita_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'ipa'), 'motivos', jsonb_build_array('preco'), 'pecas', jsonb_build_array('20000000-0000-0000-0000-0000000000ff')))$$, 'não encontrada', 'linum visita: peça inexistente recusada');
insert into lin_vd values ('vis1', lin_visita_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'ipa'), 'motivos', jsonb_build_array('tamanho', 'outro', 'tamanho'), 'motivo_outro', 'Procurava linho mais grosso', 'faltou', 'M', 'pessoas', 2,
  'pecas', jsonb_build_array('20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003')))::text);
select pg_temp.ok((select pessoas = 2 and faltou = 'M' and motivos = array['outro', 'tamanho'] and motivo_outro = 'Procurava linho mais grosso' and jsonb_array_length(pecas) = 1 and pecas->0->>'tamanho' is not null and por_nome <> ''
  and data = (now() at time zone 'America/Sao_Paulo')::date from lin_visitas where id = (select v from lin_vd where k = 'vis1')::bigint),
  'linum visita: vários motivos (sem repetir), Outro escrito, cópia da peça e data de Brasília');
select pg_temp.erro2($$insert into lin_visitas (loja_id, motivos) values ((select v from lin_ids where k = 'ipa'), array['preco'])$$, 'permission', 'linum visita: só pela função');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';   -- Estoque: não vê a visita da vendedora
select pg_temp.ok((select count(*) = 0 from lin_visitas), 'linum visita: cada um vê só as próprias visitas');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';   -- Dono vê todas
select pg_temp.ok((select count(*) = 1 from lin_visitas), 'linum visita: o Dono vê todas');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.erro2($$select lin_visita_registrar(jsonb_build_object('loja_id', (select v from lin_ids where k = 'ipa'), 'motivos', jsonb_build_array('preco')))$$, 'não tem acesso', 'linum visita: login fora da Linum não registra');
reset role;
select pg_temp.erro2($$delete from lin_visitas$$, 'não pode ser alterada', 'linum visita: somente inclusão');
select pg_temp.ok((select count(*) = 1 from auditoria where acao = 'linum_visita_registrada' and detalhes->'motivos' ? 'tamanho' and detalhes->>'motivo_outro' <> ''), 'linum visita: na auditoria');
-- ranking das vendedoras
set role authenticated;
create temp table if not exists lin_mes as select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date as de;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';   -- vendedora não dá nota
select pg_temp.erro2($$select lin_nota_vendedora_salvar('00000000-0000-0000-0000-00000000000c', (select de from lin_mes), 5, '')$$, 'Só o Dono', 'linum ranking: vendedora não dá nota');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';   -- Dono
select pg_temp.erro2($$select lin_nota_vendedora_salvar('00000000-0000-0000-0000-00000000000c', (select de from lin_mes), 6, '')$$, 'de 1 a 5', 'linum ranking: nota de 1 a 5');
select pg_temp.erro2($$select lin_nota_vendedora_salvar('00000000-0000-0000-0000-00000000000b', (select de from lin_mes), 4, '')$$, 'não o Dono', 'linum ranking: Dono não recebe nota');
select pg_temp.erro2($$select lin_nota_vendedora_salvar('00000000-0000-0000-0000-00000000000c', ((select de from lin_mes) + interval '2 months')::date, 4, '')$$, 'ainda não começou', 'linum ranking: mês futuro recusado');
select lin_nota_vendedora_salvar('00000000-0000-0000-0000-00000000000c', (select de from lin_mes) + 10, 3, 'primeira');
select lin_nota_vendedora_salvar('00000000-0000-0000-0000-00000000000c', (select de from lin_mes), 5, 'Atendimento excelente');
select pg_temp.ok((select count(*) = 1 and max(nota) = 5 from lin_notas_vendedora where user_id = '00000000-0000-0000-0000-00000000000c'),
  'linum ranking: uma nota por mês (a segunda troca a primeira)');
create temp table lin_rk as select lin_ranking((select de from lin_mes), ((select de from lin_mes) + interval '1 month - 1 day')::date) as r;
select pg_temp.ok((select (r->>'dono')::boolean and jsonb_array_length(r->'participantes') = 2 from lin_rk)
  and (select (p->>'posicao')::int >= 1 and (p->>'dona')::numeric = 5 and (p->>'valor') is not null and (p->>'final')::numeric between 1 and 5
         from lin_rk, jsonb_array_elements(r->'participantes') p where p->>'user_id' = '00000000-0000-0000-0000-00000000000c'),
  'linum ranking: Dono vê todas, com nota da Dona, valor e nota final de 1 a 5');
select pg_temp.ok((select bool_and((p->>'vendas')::numeric between 1 and 5) and max((p->>'vendas')::numeric) = 5
   from lin_rk, jsonb_array_elements(r->'participantes') p where p->>'vendas' is not null),
  'linum ranking: quem mais vendeu tira 5 em vendas');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((select (p->>'valor') is not null and p->>'comentario' = 'Atendimento excelente' from jsonb_array_elements(lin_ranking((select de from lin_mes), ((select de from lin_mes) + interval '1 month - 1 day')::date)->'participantes') p where (p->>'eu')::boolean)
  and (select bool_and(p->>'valor' is null and p->>'comentario' is null and p->>'final' is not null) from jsonb_array_elements(lin_ranking((select de from lin_mes), ((select de from lin_mes) + interval '1 month - 1 day')::date)->'participantes') p where not (p->>'eu')::boolean),
  'linum ranking: vendedora vê a posição e as notas de todas, mas valores e comentário só os dela');
select pg_temp.ok((select count(*) = 0 from lin_notas_vendedora where user_id <> '00000000-0000-0000-0000-00000000000c'), 'linum ranking: vendedora só lê a própria nota');
select pg_temp.ok((select jsonb_array_length(lin_ranking(date_trunc('year', (select de from lin_mes))::date, (date_trunc('year', (select de from lin_mes)) + interval '1 year - 1 day')::date)->'participantes') = 2),
  'linum ranking: ranking do ano');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.erro2($$select lin_ranking(current_date, current_date)$$, 'não tem acesso', 'linum ranking: login fora da Linum não vê o ranking');
reset role;
select pg_temp.ok((select count(*) = 1 from auditoria where acao = 'linum_nota_vendedora_dada') and (select count(*) = 1 from auditoria where acao = 'linum_nota_vendedora_alterada' and (detalhes->>'antes')::int = 3),
  'linum ranking: nota dada e alterada na auditoria (com o antes)');
-- produção: permissões, rolos, ficha, etapas, estoque e valores escondidos
create temp table lin_pd (k text primary key, v text); grant all on lin_pd to authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';   -- Estoque, ainda sem a permissão Produção
select pg_temp.erro2($$select lin_producao_ler()$$, 'permissão Produção', 'linum produção: papel Estoque sozinho não vê a produção');
select pg_temp.erro2($$select lin_membro_permissoes('00000000-0000-0000-0000-00000000000d', array['producao'])$$, 'Somente a equipe Nervia', 'linum produção: só a Nervia dá permissão');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';   -- equipe Nervia
select pg_temp.erro2($$select lin_membro_permissoes('00000000-0000-0000-0000-00000000000d', array['caixa'])$$, 'Permissão inválida', 'linum produção: permissão desconhecida recusada');
select pg_temp.erro2($$select lin_membro_permissoes('00000000-0000-0000-0000-00000000000b', array['producao'])$$, 'já tem todas', 'linum produção: Dono já tem tudo');
select lin_membro_permissoes('00000000-0000-0000-0000-00000000000d', array['producao']);
select lin_membro_permissoes('00000000-0000-0000-0000-00000000000c', array['producao_valores']);
select pg_temp.ok((select permissoes = array['producao', 'producao_valores'] from lin_membros where user_id = '00000000-0000-0000-0000-00000000000c')
  and (select e->'permissoes' = '["producao"]' from jsonb_array_elements(lin_equipe()) e where e->>'user_id' = '00000000-0000-0000-0000-00000000000d'),
  'linum produção: valores vêm junto com produção; a equipe mostra as permissões');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';   -- Dono cadastra parceiros, metragem e rolos
insert into lin_pd values ('cort', lin_parceiro_salvar('{"nome":"Carlos Cortador","tipo":"cortador","telefone":"21977776666","preco_peca":"8"}')::text);
insert into lin_pd values ('cost', lin_parceiro_salvar('{"nome":"Maria Costureira","tipo":"costureira","preco_peca":"25"}')::text);
insert into lin_pd values ('lav',  lin_parceiro_salvar('{"nome":"Lavanderia Azul","tipo":"lavanderia","preco_peca":"5"}')::text);
insert into lin_pd values ('pass', lin_parceiro_salvar('{"nome":"Passadeira Rosa","tipo":"passadoria","preco_peca":"3"}')::text);
select lin_consumo_salvar(jsonb_build_object('produto_id', '10000000-0000-0000-0000-000000000002', 'consumo_metros', 2.0,
  'variantes', jsonb_build_object('20000000-0000-0000-0000-000000000003', 2.5)));
select pg_temp.ok((select consumo_metros = 2.5 from lin_variantes where id = '20000000-0000-0000-0000-000000000003') and (select consumo_metros = 2 from lin_produtos where id = '10000000-0000-0000-0000-000000000002'), 'linum produção: metragem do produto e do tamanho gravadas');
select pg_temp.erro2($$select lin_rolo_comprar('{"tecido":"Linho puro","metros":"0"}')$$, 'metros', 'linum produção: rolo sem metros recusado');
insert into lin_pd select 'rolos', lin_rolo_comprar('{"tecido":"Linho puro","cor":"Cru","metros":"30","quantidade":"2","valor_pago":"1200","fornecedor":"Tecelagem Exemplo"}')::text;
reset role;
select pg_temp.ok((select count(*) = 2 and min(codigo) like 'R-____-001' and sum(saldo) = 60 and sum(valor_pago) = 1200 from lin_rolos),
  'linum produção: compra de 2 rolos de 30 m (códigos R-ano-001/002, valor dividido)');
set role authenticated;
reset role;
insert into lin_pd select 'r1', id::text from lin_rolos where codigo like '%-001';
set role authenticated;
-- ficha: 4 Calça Cru G (2,5 m cada = 10 m)
select pg_temp.erro2($$select lin_ordem_criar(jsonb_build_object('itens', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000001', 'quantidade', 2))))$$,
  'Falta a metragem', 'linum produção: peça sem metragem não entra na ficha');
insert into lin_pd select 'f', lin_ordem_criar(jsonb_build_object('molde', 'Molde calça reta', 'loja_destino_id', (select v from lin_ids where k = 'gav'),
  'itens', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000003', 'quantidade', 4))))::text;
reset role;
insert into lin_pd select 'it', id::text from lin_ordem_itens where ordem_id = (select v from lin_pd where k = 'f')::bigint;
set role authenticated;
select pg_temp.erro2($$select lin_envio_criar(jsonb_build_object('ordem_id', (select v from lin_pd where k = 'f'), 'etapa', 'corte', 'parceiro_id', (select v from lin_pd where k = 'cost'),
  'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'it'), 'quantidade', 4)), 'rolos', jsonb_build_array(jsonb_build_object('rolo_id', (select v from lin_pd where k = 'r1'), 'metros', 10))))$$,
  'não é de corte', 'linum produção: costureira não recebe corte');
select pg_temp.erro2($$select lin_envio_criar(jsonb_build_object('ordem_id', (select v from lin_pd where k = 'f'), 'etapa', 'costura', 'parceiro_id', (select v from lin_pd where k = 'cost'),
  'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'it'), 'quantidade', 1))))$$,
  'disponíveis para costura', 'linum produção: não vai para a costura antes do corte');
select pg_temp.erro2($$select lin_envio_criar(jsonb_build_object('ordem_id', (select v from lin_pd where k = 'f'), 'etapa', 'corte', 'parceiro_id', (select v from lin_pd where k = 'cort'),
  'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'it'), 'quantidade', 4)), 'rolos', jsonb_build_array(jsonb_build_object('rolo_id', (select v from lin_pd where k = 'r1'), 'metros', 31))))$$,
  'metragem suficiente', 'linum produção: rolo sem saldo recusado');
insert into lin_pd select 'ec', lin_envio_criar(jsonb_build_object('ordem_id', (select v from lin_pd where k = 'f'), 'etapa', 'corte', 'parceiro_id', (select v from lin_pd where k = 'cort'),
  'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'it'), 'quantidade', 4)),
  'rolos', jsonb_build_array(jsonb_build_object('rolo_id', (select v from lin_pd where k = 'r1'), 'metros', 10))))::text;
reset role;
select pg_temp.ok((select saldo = 20 from lin_rolos where id = (select v from lin_pd where k = 'r1')::uuid), 'linum produção: o linho sai do rolo no envio ao corte');
set role authenticated;
select pg_temp.erro2($$select lin_envio_receber(jsonb_build_object('envio_id', (select v from lin_pd where k = 'ec'), 'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'it'), 'recebidas', 3, 'perdas', 1))))$$,
  'motivo', 'linum produção: perda exige motivo');
select lin_envio_receber(jsonb_build_object('envio_id', (select v from lin_pd where k = 'ec'), 'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'it'), 'recebidas', 3, 'perdas', 1, 'motivo', 'corte errado')),
  'sobra', jsonb_build_array(jsonb_build_object('rolo_id', (select v from lin_pd where k = 'r1'), 'metros', 1.5))));
reset role;
select pg_temp.ok((select status = 'recebido' from lin_envios where id = (select v from lin_pd where k = 'ec')::bigint)
  and (select saldo = 21.5 from lin_rolos where id = (select v from lin_pd where k = 'r1')::uuid)
  and _lin_disponivel((select v from lin_pd where k = 'it')::bigint, 'costura') = 3,
  'linum produção: conferência do corte (3 boas, 1 perdida, sobra volta ao rolo)');
set role authenticated;
-- costura dividida em duas remessas; recebimento parcial
insert into lin_pd select 'es', lin_envio_criar(jsonb_build_object('ordem_id', (select v from lin_pd where k = 'f'), 'etapa', 'costura', 'parceiro_id', (select v from lin_pd where k = 'cost'),
  'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'it'), 'quantidade', 3))))::text;
select lin_envio_receber(jsonb_build_object('envio_id', (select v from lin_pd where k = 'es'), 'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'it'), 'recebidas', 2))));
reset role;
select pg_temp.ok((select status = 'aberto' from lin_envios where id = (select v from lin_pd where k = 'es')::bigint), 'linum produção: recebimento parcial deixa a remessa aberta');
set role authenticated;
select pg_temp.erro2($$select lin_envio_receber(jsonb_build_object('envio_id', (select v from lin_pd where k = 'es'), 'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'it'), 'recebidas', 2))))$$,
  'já voltaram', 'linum produção: não recebe mais do que foi');
select lin_envio_receber(jsonb_build_object('envio_id', (select v from lin_pd where k = 'es'), 'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'it'), 'recebidas', 1))));
insert into lin_pd select 'el', lin_envio_criar(jsonb_build_object('ordem_id', (select v from lin_pd where k = 'f'), 'etapa', 'lavagem', 'parceiro_id', (select v from lin_pd where k = 'lav'),
  'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'it'), 'quantidade', 3))))::text;
select lin_envio_receber(jsonb_build_object('envio_id', (select v from lin_pd where k = 'el'), 'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'it'), 'recebidas', 3))));
insert into lin_pd select 'ep', lin_envio_criar(jsonb_build_object('ordem_id', (select v from lin_pd where k = 'f'), 'etapa', 'passadoria', 'parceiro_id', (select v from lin_pd where k = 'pass'),
  'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'it'), 'quantidade', 3))))::text;
select lin_envio_receber(jsonb_build_object('envio_id', (select v from lin_pd where k = 'ep'), 'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'it'), 'recebidas', 3))));
reset role;
create temp table lin_pd_est as select coalesce((select quantidade from lin_estoque where variante_id = '20000000-0000-0000-0000-000000000003' and loja_id = (select v from lin_ids where k = 'gav')), 0) q;
set role authenticated;
select pg_temp.erro2($$select lin_ordem_entrada(jsonb_build_object('ordem_id', (select v from lin_pd where k = 'f'), 'loja_id', (select v from lin_ids where k = 'gav'),
  'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'it'), 'quantidade', 4))))$$, 'Só há 3', 'linum produção: só entra no estoque o que ficou pronto');
select lin_ordem_entrada(jsonb_build_object('ordem_id', (select v from lin_pd where k = 'f'), 'loja_id', (select v from lin_ids where k = 'gav'),
  'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'it'), 'quantidade', 3))));
-- custo: linho 600/30 = 20 por metro × 2,5 = 50 + corte 8 + costura 25 + lavagem 5 + passadoria 3 = 91
reset role;
select pg_temp.ok((select quantidade from lin_estoque where variante_id = '20000000-0000-0000-0000-000000000003' and loja_id = (select v from lin_ids where k = 'gav')) = (select q from lin_pd_est) + 3
  and (select count(*) = 1 from lin_movimentos where tipo = 'producao' and quantidade = 3)
  and (select custo_unitario = 91 from lin_ordem_entradas)
  and (select status = 'concluida' from lin_ordens where id = (select v from lin_pd where k = 'f')::bigint),
  'linum produção: 3 peças entram no estoque da Gávea com custo de R$ 91 e a ficha fica concluída (1 perdida no corte)');
set role authenticated;
-- valores escondidos de quem só tem Produção
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.ok((select not (r->>'valores')::boolean and not (r->'parceiros'->0 ? 'preco_peca') and not (r->'rolos'->0 ? 'valor_pago')
    and (r->'ordens'->0->'itens'->0->>'custo') is null and not (r->'ordens'->0->'envios'->0 ? 'preco_peca') and not (r->'ordens'->0->'entradas'->0 ? 'custo_unitario')
    and jsonb_array_length(r->'ordens') = 1 from (select lin_producao_ler() r) x),
  'linum produção: quem só tem Produção opera sem ver valor do linho, preço por peça nem custo');
select pg_temp.erro2('select * from lin_rolos', 'permission', 'linum produção: tabelas não são lidas direto pela tela');
-- importar NF-e e tecido por quilo (o Estoque com Produção, sem valores: o valor da nota não é gravado)
select pg_temp.erro2($$select lin_rolos_importar_nfe('{"chave":"123","itens":[]}')$$, '44 dígitos', 'linum nfe: chave inválida recusada');
insert into lin_pd select 'nfe', lin_rolos_importar_nfe(jsonb_build_object('chave', '33261012345678000190550010000012341000012345', 'numero', '1234', 'fornecedor', 'Malharia Exemplo',
  'data', (now() at time zone 'America/Sao_Paulo')::date, 'itens', jsonb_build_array(
    jsonb_build_object('item', 1, 'tecido', 'Linho misto', 'cor', 'Areia', 'unidade', 'm', 'rolos', 2, 'total', 61, 'valor', 900),
    jsonb_build_object('item', 2, 'tecido', 'Malha de linho', 'cor', 'Cru', 'unidade', 'kg', 'rolos', 1, 'total', 12.5, 'valor', 500))))::text;
reset role;
select pg_temp.ok((select count(*) = 3 and sum(saldo) filter (where unidade = 'm') = 61 and sum(saldo) filter (where unidade = 'kg') = 12.5
    and bool_and(nota = '1234' and fornecedor = 'Malharia Exemplo' and nfe_chave like '3326%' and valor_pago = 0) from lin_rolos where nfe_chave is not null),
  'linum nfe: 2 itens viram 3 rolos (2 × 30,5 m e 1 de 12,5 kg); sem a permissão de valores o valor não é gravado');
set role authenticated;
select pg_temp.erro2($$select lin_rolos_importar_nfe(jsonb_build_object('chave', '33261012345678000190550010000012341000012345', 'numero', '1234',
  'itens', jsonb_build_array(jsonb_build_object('item', 2, 'tecido', 'Malha de linho', 'unidade', 'kg', 'rolos', 1, 'total', 12.5))))$$,
  'já foi registrado', 'linum nfe: o mesmo item da mesma nota não entra duas vezes');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';   -- Dono: a peça é em metros; o rolo de malha foi comprado por quilo
select lin_consumo_salvar(jsonb_build_object('produto_id', '10000000-0000-0000-0000-000000000001', 'consumo_metros', 0.4));
insert into lin_pd select 'fk', lin_ordem_criar(jsonb_build_object('itens', jsonb_build_array(jsonb_build_object('variante_id', '20000000-0000-0000-0000-000000000001', 'quantidade', 5))))::text;
reset role;
insert into lin_pd select 'itk', id::text from lin_ordem_itens where ordem_id = (select v from lin_pd where k = 'fk')::bigint;
insert into lin_pd select 'rkg', id::text from lin_rolos where unidade = 'kg';
insert into lin_pd select 'rm', id::text from lin_rolos where nfe_item = 1 order by codigo limit 1;
set role authenticated;
select pg_temp.erro2($$select lin_envio_criar(jsonb_build_object('ordem_id', (select v from lin_pd where k = 'fk'), 'etapa', 'corte', 'parceiro_id', (select v from lin_pd where k = 'cort'),
  'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'itk'), 'quantidade', 5)),
  'rolos', jsonb_build_array(jsonb_build_object('rolo_id', (select v from lin_pd where k = 'rkg'), 'metros', 2))))$$,
  'rende 1 kg', 'linum kg: rolo comprado por quilo sem rendimento não vai para o corte');
select pg_temp.erro2($$select lin_rolo_rendimento((select v from lin_pd where k = 'rm')::uuid, 4)$$, 'só vale para rolo comprado por quilo', 'linum kg: rendimento só em rolo por quilo');
select lin_rolo_rendimento((select v from lin_pd where k = 'rkg')::uuid, 4);
select lin_envio_criar(jsonb_build_object('ordem_id', (select v from lin_pd where k = 'fk'), 'etapa', 'corte', 'parceiro_id', (select v from lin_pd where k = 'cort'),
  'itens', jsonb_build_array(jsonb_build_object('ordem_item_id', (select v from lin_pd where k = 'itk'), 'quantidade', 5)),
  'rolos', jsonb_build_array(jsonb_build_object('rolo_id', (select v from lin_pd where k = 'rkg'), 'metros', 2))));
reset role;
select pg_temp.ok((select saldo = 12 from lin_rolos where id = (select v from lin_pd where k = 'rkg')::uuid)
  and (select metros = 2 from lin_envio_rolos where rolo_id = (select v from lin_pd where k = 'rkg')::uuid)
  and (select count(*) = 1 from auditoria where acao = 'linum_rolo_rendimento'),
  'linum kg: 5 peças × 0,4 m = 2 m ÷ 4 m/kg = 0,5 kg saem do rolo de malha (rendimento na auditoria)');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
insert into lin_pd values ('ps', lin_parceiro_salvar(jsonb_build_object('id', (select v from lin_pd where k = 'cost'), 'nome', 'Maria Costureira', 'tipo', 'costureira', 'preco_peca', 999))::text);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';   -- vendedora com valores
select pg_temp.ok((select (r->>'valores')::boolean and (select (oo->'itens'->0->>'custo')::numeric from jsonb_array_elements(r->'ordens') oo where (oo->>'id') = (select v from lin_pd where k = 'f')) = 91
    and (select (p->>'preco_peca')::numeric = 25 from jsonb_array_elements(r->'parceiros') p where p->>'nome' = 'Maria Costureira') from (select lin_producao_ler() r) x),
  'linum produção: com Valores vê o custo; quem não tem valores não muda o preço por peça');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.erro2($$select lin_producao_ler()$$, 'permissão Produção', 'linum produção: login fora da Linum não vê');
reset role;
-- 2.2: editar os dados dos rolos (cor que a nota não traz), vários de uma vez; valor só com Valores
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';   -- Estoque com Produção, sem valores
select pg_temp.erro2($$select lin_rolos_editar(jsonb_build_object('rolos', jsonb_build_array(jsonb_build_object('id', (select v from lin_pd where k = 'rm'), 'valor_pago', 10))))$$,
  'Valores da produção', 'linum rolo: sem Valores não altera o valor pago');
select pg_temp.erro2($$select lin_rolos_editar(jsonb_build_object('rolos', jsonb_build_array(jsonb_build_object('id', (select v from lin_pd where k = 'rm'), 'tecido', ' '))))$$,
  'informe o tecido', 'linum rolo: tecido vazio recusado');
select pg_temp.erro2($$select lin_rolos_editar(jsonb_build_object('rolos', jsonb_build_array(jsonb_build_object('id', (select v from lin_pd where k = 'rm'), 'data_compra', current_date + 5))))$$,
  'futuro', 'linum rolo: data da compra no futuro recusada');
select pg_temp.ok(lin_rolos_editar(jsonb_build_object('rolos', jsonb_build_array(
    jsonb_build_object('id', (select v from lin_pd where k = 'rm'), 'cor', 'Natural', 'tecido', 'Linho misto'),
    jsonb_build_object('id', (select v from lin_pd where k = 'rkg'), 'cor', 'Cru')))) = 1,
  'linum rolo: só conta o rolo que mudou (o de malha já era Cru)');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.erro2($$select lin_rolos_editar(jsonb_build_object('rolos', jsonb_build_array(jsonb_build_object('id', (select v from lin_pd where k = 'rm'), 'cor', 'X'))))$$,
  'permissão Produção', 'linum rolo: login fora da Linum não edita');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';   -- Dono altera o valor
select lin_rolos_editar(jsonb_build_object('rolos', jsonb_build_array(jsonb_build_object('id', (select v from lin_pd where k = 'rm'), 'valor_pago', '450,50', 'observacoes', 'conferido'))));
reset role;
select pg_temp.ok((select cor = 'Natural' and tecido = 'Linho misto' and valor_pago = 450.50 and observacoes = 'conferido' and saldo = 30.5 from lin_rolos where id = (select v from lin_pd where k = 'rm')::uuid)
  and (select count(*) = 2 from auditoria where acao = 'linum_rolo_alterado')
  and (select detalhes->'antes'->>'cor' = 'Areia' and detalhes->'depois'->>'cor' = 'Natural' and not (detalhes->'depois' ? 'tecido') from auditoria where acao = 'linum_rolo_alterado' order by id limit 1),
  'linum rolo: cor, valor e observação gravados sem mexer no saldo; auditoria só com o que mudou (antes e depois)');
select pg_temp.erro2($$delete from lin_rolo_movs$$, 'não pode ser alterado', 'linum produção: histórico do rolo é somente inclusão');
select pg_temp.ok((select count(distinct acao) >= 6 from auditoria where acao in ('linum_rolo_comprado', 'linum_parceiro_criado', 'linum_consumo_alterado', 'linum_producao_ficha_criada',
  'linum_producao_enviada', 'linum_producao_recebida', 'linum_producao_estoque')) and (select count(*) >= 2 from auditoria where acao = 'linum_papel_definido' and detalhes ? 'permissoes'),
  'linum produção: tudo na auditoria (inclusive as permissões)');

reset request.jwt.claim.sub;
\echo 'TODOS OS TESTES SQL OK'
