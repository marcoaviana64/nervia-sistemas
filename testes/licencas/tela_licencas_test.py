"""Teste de ponta a ponta do app Contas e Licenças Microsoft 365: tela real + banco real (Postgres local com as migrações)
servido pelo PostgREST (o mesmo motor da API do Supabase). Dados FICTÍCIOS (exportação montada aqui).

Precisa de: Postgres (PGHOST/PGPORT/PGUSER), o binário do PostgREST (variável POSTGREST, v12+) e Playwright.
Sem internet para o CDN: SUPABASE_JS=caminho do supabase.js (umd) da mesma versão.
Uso: PGHOST=/tmp/pgd PGPORT=5433 PGUSER=postgres POSTGREST=/caminho/postgrest python3 testes/licencas/tela_licencas_test.py [pasta_prints]
"""
import os, sys, json, time, glob, subprocess, threading, http.server, functools, urllib.request, urllib.parse, re
import jwt
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAIDA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, "testes")
PG = dict(host=os.environ.get("PGHOST", "localhost"), port=os.environ.get("PGPORT", "5432"), user=os.environ.get("PGUSER", "postgres"))
DB = "teste_licencas_tela"
SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres!!"
PORTA_API, PORTA_SITE = 3904, 8816

def psql(sql=None, arquivo=None, db=DB, saida=False):
    cmd = ["psql", "-h", PG["host"], "-p", PG["port"], "-U", PG["user"], "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-At"]
    cmd += ["-f", arquivo] if arquivo else ["-c", sql]
    r = subprocess.run(cmd, check=True, stdout=subprocess.PIPE if saida else subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    return r.stdout.strip() if saida else None

def preparar_banco():
    psql(f"drop database if exists {DB}", db="postgres"); psql(f"create database {DB}", db="postgres")
    psql(arquivo=os.path.join(RAIZ, "testes", "stubs_supabase.sql"))
    sql = "\n".join(l for f in sorted(glob.glob(os.path.join(RAIZ, "supabase", "migrations", "*.sql")))
                    for l in open(f, encoding="utf-8").read().splitlines() if not l.startswith("create extension"))
    caminho = os.path.join(SAIDA, "_migracoes_licencas.sql"); open(caminho, "w", encoding="utf-8").write(sql)
    psql(arquivo=caminho); os.remove(caminho)
    psql("""do $$ begin create role autenticador login password 'x' noinherit; exception when duplicate_object then null; end $$;
      grant anon, authenticated to autenticador;""")
    psql("""
      insert into auth.users (id, email, raw_user_meta_data) values
        ('00000000-0000-0000-0000-0000000000a1', 'marco@nervia.com.br', '{"nome":"Marco"}'),
        ('00000000-0000-0000-0000-0000000000c1', 'ti@vogue.exemplo', '{"nome":"TI Vogue"}'),
        ('00000000-0000-0000-0000-0000000000c2', 'outro@x.exemplo', '{"nome":"Outro"}');
      update perfis set admin = true where email = 'marco@nervia.com.br';
    """)

def iniciar_api():
    conf = os.path.join(SAIDA, "_postgrest_licencas.conf")
    open(conf, "w").write(f'db-uri = "postgres://autenticador:x@localhost:{PG["port"]}/{DB}"\ndb-schemas = "public"\ndb-anon-role = "anon"\n'
                          f'jwt-secret = "{SEGREDO}"\nserver-port = {PORTA_API}\nlog-level = "crit"\n')
    proc = subprocess.Popen([os.environ["POSTGREST"], conf], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try: urllib.request.urlopen(f"http://localhost:{PORTA_API}/"); break
        except Exception: time.sleep(0.2)
    return proc, conf

def token(uid, email):
    return jwt.encode({"sub": uid, "email": email, "role": "authenticated", "aud": "authenticated", "exp": int(time.time()) + 3600}, SEGREDO, algorithm="HS256")

USU = {"admin": ("00000000-0000-0000-0000-0000000000a1", "marco@nervia.com.br"), "clienteA": ("00000000-0000-0000-0000-0000000000c1", "ti@vogue.exemplo"),
       "clienteB": ("00000000-0000-0000-0000-0000000000c2", "outro@x.exemplo")}
CONFIG = f'window.NERVIA_CONFIG={{SUPABASE_URL:"http://127.0.0.1:{PORTA_SITE}",SUPABASE_ANON_KEY:"anon"}};'

def entrar(b, papel, largura=1300):
    uid, email = USU[papel]; t = token(uid, email)
    sessao = {"access_token": t, "refresh_token": "x", "token_type": "bearer", "expires_in": 3600, "expires_at": int(time.time()) + 3600,
              "user": {"id": uid, "email": email, "aud": "authenticated", "role": "authenticated"}}
    ctx = b.new_context(viewport={"width": largura, "height": 900}, accept_downloads=True)
    ctx.add_init_script(f"localStorage.setItem('sb-127-auth-token', {json.dumps(json.dumps(sessao))});")
    ctx.route("**/config.js", lambda r: r.fulfill(body=CONFIG, content_type="text/javascript"))
    if os.environ.get("SUPABASE_JS"):
        ctx.route("**/supabase-js@*/**", lambda r: r.fulfill(path=os.environ["SUPABASE_JS"], content_type="text/javascript"))
    def api(rota):
        url = rota.request.url.replace(f"http://127.0.0.1:{PORTA_SITE}/rest/v1", f"http://localhost:{PORTA_API}")
        rota.fulfill(response=rota.fetch(url=url))
    ctx.route(f"http://127.0.0.1:{PORTA_SITE}/rest/v1/**", api)
    pg = ctx.new_page(); erros = []
    pg.on("pageerror", lambda e: erros.append(str(e)))
    return pg, erros

def anonimo(b, largura=1100):
    """Quem recebe o link: sem login (a chave anon não é um JWT; o PostgREST usa o papel anon sem o cabeçalho)."""
    ctx = b.new_context(viewport={"width": largura, "height": 900})
    ctx.route("**/config.js", lambda r: r.fulfill(body=CONFIG, content_type="text/javascript"))
    if os.environ.get("SUPABASE_JS"):
        ctx.route("**/supabase-js@*/**", lambda r: r.fulfill(path=os.environ["SUPABASE_JS"], content_type="text/javascript"))
    def api(rota):
        url = rota.request.url.replace(f"http://127.0.0.1:{PORTA_SITE}/rest/v1", f"http://localhost:{PORTA_API}")
        cab = {k: v for k, v in rota.request.headers.items() if k.lower() != "authorization" or v != "Bearer anon"}
        rota.fulfill(response=rota.fetch(url=url, headers=cab))
    ctx.route(f"http://127.0.0.1:{PORTA_SITE}/rest/v1/**", api)
    pg = ctx.new_page(); erros = []
    pg.on("pageerror", lambda e: erros.append(str(e)))
    return pg, erros

def abrir(pg):
    pg.goto(f"http://127.0.0.1:{PORTA_SITE}/apps/licencas/"); pg.wait_for_selector("#app:not(.oculto), #aviso:not(.oculto)"); pg.wait_for_timeout(400)

def confirmar(pg):
    pg.click("dialog [value=ok]"); pg.wait_for_timeout(500)

def mensagem(pg): return pg.text_content("#msg") if pg.is_visible("#msg") else ""

def ok(cond, nome):
    if not cond: raise SystemExit("FALHOU: " + nome)
    print("ok ", nome)

# ---------------------------------------------------------------- exportação fictícia (mesmo cabeçalho do Microsoft 365 Admin Center)
CAB = "Display name,DirSyncEnabled,User principal name,Object Id,First name,Last name,When created,Soft deletion time stamp,AgeGroup,Title,Department,Preferred data location,City,CountryOrRegion,Office,StateOrProvince,Usage location,Last dirsync time,Block credential,Licenses,Password never expires,Last password change time stamp,Mobile Phone,Phone number,Postal code,Preferred language,Street address,Fax,Proxy addresses,MemberType"
def linha(nome, upn, lic, bloq=False, cargo="", proxy="", depto=""):
    c = [nome, "False", upn, "id", "", "", "2025-03-10 12:00:00Z", "", "", cargo, depto, "", "", "", "", "", "BR", "", str(bloq), lic, "False", "", "", "(21) 99999-0000", "", "", "Rua Fictícia, 10", "", proxy, ""]
    return ",".join(f'"{x}"' if ("," in x or '"' in x) else x for x in c)
def export(contas): return "﻿" + CAB + "\n" + "\n".join(linha(*c) for c in contas) + "\n"
SET = [
    ("Ana Lima", "ana@vogue.exemplo.com.br", "Microsoft 365 Business Standard", False, "Gerente, Operações"),
    ("Bruno Reis", "bruno@vogue.exemplo.com.br", "Microsoft 365 Business Standard+Microsoft Fabric (Free)", False),
    ("Caixa Compartilhada (shared)", "contato@vogue.exemplo.com.br", "Exchange Online (Plan 1)", False),
    ("Diego Souza", "diego@empresa-mae.exemplo", "Unlicensed", False, "", "SMTP:diego@vogue.exemplo.com.br"),
    ("Eva Prado", "eva@parksul.exemplo.com.br", "Microsoft 365 Business Basic+Microsoft 365 Apps for business", False),
    ("Fábio Cruz", "fabio@parksul.exemplo.com.br", "Power BI Pro", True),
    ("Gil Outra", "gil@outraempresa.exemplo", "Microsoft 365 Business Standard", False),
    ("Convidado", "conv_x.com#EXT#@tenant.onmicrosoft.com", "Unlicensed", False),
]
OUT = [
    ("Ana Lima", "ana@vogue.exemplo.com.br", "Microsoft 365 Business Standard", False, "Gerente, Operações"),
    ("Bruno Reis", "bruno@vogue.exemplo.com.br", "Microsoft 365 Business Standard", True),           # bloqueado e continua com licença
    ("Caixa Compartilhada (shared)", "contato@vogue.exemplo.com.br", "Exchange Online (Plan 1)+Power BI Pro", False),   # ganhou Power BI
    ("Hugo Nunes", "hugo@vogue.exemplo.com.br", "Microsoft 365 Business Standard", False),            # novo
    ("Eva Prado", "eva@parksul.exemplo.com.br", "Microsoft 365 Business Basic+Microsoft 365 Apps for business", False),
    ("Fábio Cruz", "fabio@parksul.exemplo.com.br", "Power BI Pro", True),
    ("Gil Outra", "gil@outraempresa.exemplo", "Microsoft 365 Business Standard", False),
]   # Diego saiu
FATURA = "local,quantidade,licença,valor unitario\nvogue,4,microsoft 365 bussiness standard, 70,50\nvogue,1,Exchange OnLine (Plan1), 24,65\nsul,1,power bi, 96,40\nxyz,1,power bi, 10,00\n"

def carregar_csv(pg, nome, conteudo):
    pg.set_input_files("#arqCsv", files=[{"name": nome, "mimeType": "text/csv", "buffer": conteudo.encode("utf-8")}]); pg.wait_for_timeout(500)

preparar_banco()
api, conf = iniciar_api()
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORTA_SITE), functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(RAIZ, "site")))
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg, er = entrar(b, "admin"); abrir(pg)
        ok("Carregar exportação do Microsoft 365" in pg.text_content("#tela"), "sem dados, o admin cai direto em Cargas e fatura")
        carregar_csv(pg, "nada.csv", "a,b\n1,2\n")
        ok("faltam as colunas" in mensagem(pg), "arquivo que não é a exportação de usuários é recusado com explicação")
        carregar_csv(pg, "users_01_09_2026.csv", export(SET))
        t = pg.text_content("#previa")
        ok("8 contas no arquivo" in t and "6 das unidades" in t and "1 de outras empresas" in t and "1 convidados" in t and pg.input_value("#cDataCsv") == "2026-09-01",
           "prévia: separa as unidades no navegador (inclusive pelo proxy), ignora outra empresa e convidado, pega a data do nome")
        pg.click("[data-acao=gravarCarga]"); pg.wait_for_timeout(800)
        ok("01/09/2026 carregada: 6 contas" in mensagem(pg), "carga de 01/09 gravada")
        ok(psql("select count(*) from lic_contas where login like '%outraempresa%' or nome = 'Convidado'", saida=True) == "0"
           and psql("select count(*) from lic_contas where login = 'diego@empresa-mae.exemplo'", saida=True) == "1",
           "no banco só as contas das unidades (outra empresa e convidado não saem do computador)")
        ok(psql("select cargo || '|' || array_to_string(gratuitas, ',') from lic_contas where nome = 'Ana Lima'", saida=True) == "Gerente, Operações|"
           and psql("select array_to_string(licencas, ',') || '|' || array_to_string(gratuitas, ',') from lic_contas where nome = 'Bruno Reis'", saida=True) == "Microsoft 365 Business Standard|Microsoft Fabric (Free)",
           "campo com vírgula entre aspas e licença gratuita separada")
        carregar_csv(pg, "users_01_10_2026.csv", export(OUT))
        pg.click("[data-acao=gravarCarga]"); pg.wait_for_timeout(800)
        carregar_csv(pg, "users_01_10_2026.csv", export(OUT))
        ok("Já existe uma carga de 01/10/2026" in pg.text_content("#previa"), "mesma data avisa que já existe")
        pg.click("[data-acao=cancelarPrevia]")
        # fatura
        pg.fill("#fatMes", "2026-10"); pg.fill("#fatTxt", FATURA); pg.click("[data-acao=conferirFatura]"); pg.wait_for_timeout(300)
        t = pg.text_content("#previaFat").replace("\xa0", " ")
        ok('unidade "xyz" não reconhecida' in t and "Microsoft 365 Business Standard" in t and "R$ 282,00" in t and "Shopping Park Sul" in t,
           "fatura: lê o formato antigo (valor com vírgula, erro de digitação, apelido) e avisa linha não reconhecida")
        pg.click("[data-acao=gravarFatura]"); pg.wait_for_timeout(700)
        ok("Fatura de out/2026 gravada: 3" in mensagem(pg), "fatura gravada")
        ok(not er, "sem erros de script (admin, cargas) " + str(er))

        # ---- formulário da fatura pelo link (sem login)
        pg.evaluate("window.__abertos = []; window.open = (u) => { window.__abertos.push(u); return null; }")
        pg.fill("#pMes", "2026-11"); pg.fill("#pContato", "Fulana Financeiro"); pg.fill("#pTel", "(21) 98888-7777")
        for c in pg.locator(".pUn").all():
            if c.get_attribute("value") != psql("select id from lic_unidades where dominio = 'vogue'", saida=True): c.uncheck()
        pg.click("[data-acao=criarLink]"); pg.wait_for_timeout(600)
        ok("Link gerado" in mensagem(pg) and "ainda não abriu" in pg.text_content("#tela"), "Nervia gera o link da fatura de nov/2026 só para a Vogue")
        pg.evaluate("window.__abertos = []; window.open = (u) => { window.__abertos.push(u); return null; }")
        pg.click("[data-acao=whatsLink]"); pg.wait_for_timeout(300); wa = pg.evaluate("window.__abertos.filter(Boolean).pop()")
        codigo = psql("select codigo from lic_pedidos", saida=True)
        ok(wa.startswith("https://wa.me/5521988887777?text=") and codigo in urllib.parse.unquote(wa) and "/licencas/fatura/#" in urllib.parse.unquote(wa), "WhatsApp com a mensagem e o link")
        fa, erf = anonimo(b)
        fa.goto(f"http://127.0.0.1:{PORTA_SITE}/licencas/fatura/#{codigo}"); fa.wait_for_selector("#pagina:not(.oculto), #aviso:not(.oculto)"); fa.wait_for_timeout(400)
        t = fa.inner_text("body").replace("\xa0", " ")
        ok("novembro de 2026" in t and "Vogue" in t and "vieram da fatura anterior" in t and fa.locator(".item").count() == 2 and fa.locator(".fU").count() == 0,
           "link sem login: mês, unidade e as linhas da fatura anterior para conferir")
        ok("R$ 403,05" not in t and "Eva Prado" not in t and "Park Sul" not in t, "link não mostra nada de outra unidade nem das contas")
        item_std = fa.locator(".item", has=fa.locator(".fP option:checked", has_text="Microsoft 365 Business Standard"))
        item_std.locator(".fQ").fill("5")
        fa.click("#mais"); nova = fa.locator(".item").last
        nova.locator(".fP").select_option("__outra__"); nova.locator(".fOutro").fill("Microsoft 365 Copilot"); nova.locator(".fQ").fill("1"); nova.locator(".fV").fill("150")
        fa.click("#enviar"); fa.wait_for_timeout(300)
        ok("Informe o seu nome" in fa.text_content("#erro"), "exige o nome de quem envia")
        fa.fill("#declarante", "Fulana Financeiro"); fa.click("#enviar"); fa.wait_for_timeout(300)
        ok("Marque a declaração" in fa.text_content("#erro"), "exige a declaração")
        ok("R$ 527,15" in fa.text_content("#valTotal").replace("\xa0", " "), "total mensal calculado na hora (5 × 70,50 + 1 × 24,65 + 1 × 150,00)")
        fa.check("#aceite"); fa.click("#enviar"); fa.wait_for_timeout(800)
        ok("Recebido em" in fa.text_content("#situacao") and "protocolo F-1" in fa.text_content("#situacao") and fa.locator(".item").count() == 3, "enviado; a página mostra o protocolo e permite corrigir")
        fa.screenshot(path=os.path.join(SAIDA, "licencas-formulario.png"), full_page=True)
        ok(not erf, "sem erros de script (formulário) " + str(erf))
        fm, erm2 = anonimo(b, 390); fm.goto(f"http://127.0.0.1:{PORTA_SITE}/licencas/fatura/#{codigo}"); fm.wait_for_selector("#pagina:not(.oculto)"); fm.wait_for_timeout(300)
        ok(fm.evaluate("document.documentElement.scrollWidth") <= 392, "formulário cabe no celular")
        fm.screenshot(path=os.path.join(SAIDA, "licencas-formulario-celular.png"), full_page=True)
        ok(psql("select count(*) from lic_faturas where mes = '2026-11-01'", saida=True) == "0", "resposta ainda não é fatura")
        abrir(pg); pg.click("[data-v=admin]"); pg.wait_for_timeout(500)
        ok("1 resposta(s) para conferir" in pg.text_content("#tela"), "Nervia vê a resposta pendente")
        pg.click("[data-acao=conferir]"); pg.wait_for_timeout(300)
        d = pg.inner_text("dialog").replace("\xa0", " ")
        ok("Fulana Financeiro" in d and "qtd 4 → 5" in d and "fora da lista" in d and "igual a out/2026" in d, "conferência compara com a fatura anterior e marca licença fora da lista")
        confirmar(pg)
        ok("Fatura de nov/2026 registrada" in mensagem(pg) and psql("select sum(quantidade) from lic_faturas where mes = '2026-11-01'", saida=True) == "7",
           "Nervia aprova e vira a fatura de nov/2026")
        ok("aprovada" in pg.text_content("#tela"), "resposta aparece como aprovada")
        ok(not er, "sem erros de script (admin, formulário) " + str(er))

        # painel
        pg.click("[data-v=painel]"); pg.wait_for_timeout(400)
        t = re.sub(r"\s+", " ", pg.inner_text("#tela").replace("\xa0", " "))
        ok(pg.locator(".un").count() == 2 and "01/10/2026" in t and "comparada com a de 01/09/2026" in t, "painel com as 2 unidades com dados, comparando as exportações")
        ok("Bloqueadas com licença 2" in t, "alerta: contas bloqueadas que continuam com licença paga")
        vogue = re.sub(r"\s+", " ", pg.locator(".un", has_text="Vogue").inner_text())
        ok("1 alerta" in vogue and "+1 −1" in vogue and "Compradas sem uso" in vogue, "cartão da unidade com alerta, mudanças e licenças sem uso")
        pg.screenshot(path=os.path.join(SAIDA, "licencas-painel.png"), full_page=True)
        pg.click(".un >> text=Vogue"); pg.wait_for_timeout(400)
        t = re.sub(r"\s+", " ", pg.inner_text("#tela").replace("\xa0", " "))
        ok("1 conta(s) bloqueada(s) com licença paga" in t and "Bruno Reis — Microsoft 365 Business Standard" in t, "detalhe: quem está bloqueado com licença")
        ok("Power BI Pro" in t and "1 em uso sem compra na fatura" in t and "sem folga" in t, "compradas x em uso: Standard 4 de 4, Power BI em uso sem compra")
        ok("1 conta(s) nova(s), 1 removida(s), 1 mudaram de situação, 1 trocaram de licença" in t, "resumo das mudanças da unidade")
        pg.select_option("#fSt", "alerta"); pg.wait_for_timeout(200)
        ok(pg.locator("#listaContas tr").count() == 2, "filtro 'bloqueadas com licença'")
        pg.select_option("#fSt", ""); pg.fill("#fQ", "hugo"); pg.wait_for_timeout(200)
        ok(pg.locator("#listaContas tr").count() == 2 and "Hugo Nunes" in pg.text_content("#listaContas"), "busca por nome")
        with pg.expect_download() as d: pg.click("[data-acao=csv]")
        ok("Hugo Nunes" in open(d.value.path(), encoding="utf-8-sig").read(), "CSV das contas")
        pg.screenshot(path=os.path.join(SAIDA, "licencas-unidade.png"), full_page=True)
        pg.click("[data-acao=verMud]"); pg.wait_for_timeout(300)
        t = re.sub(r"\s+", " ", pg.inner_text("#tela").replace("\xa0", " "))
        ok("Contas novas (1)" in t and "Hugo Nunes" in t and "Contas removidas (1)" in t and "Diego Souza" in t and "Ativa → Bloqueada" in t and "+ Power BI Pro" in t,
           "mudanças: nova, removida, bloqueada e licença acrescentada")
        pg.select_option("#selCarga", label="01/09/2026"); pg.wait_for_timeout(500)
        ok("é a primeira" in pg.text_content("#tela"), "na primeira exportação não há mudanças")
        pg.select_option("#selCarga", label="01/10/2026"); pg.wait_for_timeout(500)
        # quem vê
        pg.click("[data-v=admin]"); pg.wait_for_timeout(500)
        pg.locator("tr", has_text="Vogue").locator("[data-acao=acessos]").click(); pg.wait_for_timeout(400)
        pg.check("dialog input[value='00000000-0000-0000-0000-0000000000c1']"); confirmar(pg)
        ok("Acessos atualizados" in mensagem(pg), "admin libera a Vogue para o cliente")
        ok(not er, "sem erros de script (admin) " + str(er))

        # cliente: só a Vogue, direto no detalhe
        pc, erc = entrar(b, "clienteA"); abrir(pc)
        t = pc.text_content("#tela")
        ok("Vogue" in t and "Eva Prado" not in pc.text_content("body") and pc.locator("#abaAdmin.oculto").count() == 1 and "Compradas" in t,
           "cliente vê só a unidade liberada (com a fatura) e não vê Cargas e fatura")
        ok(psql("select count(*) from auditoria where acao in ('licencas_carga', 'licencas_fatura', 'licencas_acesso_liberado')", saida=True) == "5", "cargas, as 2 faturas e o acesso na auditoria")
        pc.click("[data-v=contas]"); pc.wait_for_timeout(300)
        ok(pc.locator("#fU").count() == 0 and pc.locator("#listaContas tr").count() == 5, "aba Contas do cliente: 4 contas da Vogue")
        ok(not erc, "sem erros de script (cliente) " + str(erc))
        pb, erb = entrar(b, "clienteB"); abrir(pb)
        ok("Nenhuma unidade liberada" in pb.text_content("#aviso"), "login sem unidade recebe aviso claro")
        # ---- outro tenant (outra empresa, outro painel do Microsoft 365): respeita os domínios, não zera as outras unidades
        abrir(pg); pg.click("[data-v=admin]"); pg.wait_for_timeout(500)
        pg.click("[data-acao=novaUnidade]"); pg.fill("dialog [name=nome]", "Outra Empresa"); pg.fill("dialog [name=dom]", "outraempresa"); confirmar(pg)
        ok("Unidade salva" in mensagem(pg), "admin cadastra a unidade do outro tenant")
        OUTRO = [("Gil Outra", "gil@outraempresa.exemplo", "Microsoft 365 Business Standard", False), ("Ivo Outra", "ivo@outraempresa.exemplo", "Unlicensed", False),
                 ("Zé Terceiro", "ze@terceiro.exemplo", "Unlicensed", False)]
        carregar_csv(pg, "users_15_10_2026.csv", export(OUTRO))
        ok("2 das unidades" in pg.text_content("#previa") and "Já existe" not in pg.text_content("#previa"), "prévia do outro tenant: só as contas do domínio dele")
        pg.click("[data-acao=gravarCarga]"); pg.wait_for_timeout(800)
        ok("15/10/2026 carregada: 2 contas" in mensagem(pg), "carga do outro tenant gravada")
        pg.click("[data-v=painel]"); pg.wait_for_timeout(500)
        t = re.sub(r"\s+", " ", pg.inner_text("#tela").replace("\xa0", " "))
        vogue = re.sub(r"\s+", " ", pg.locator(".un", has_text="Vogue").inner_text())
        ok(pg.locator(".un").count() == 3 and "Cada unidade mostra a exportação mais recente do seu domínio" in t and "Contas 4" in vogue
           and "+1 −1" in vogue and "Exportação 01/10/2026" in vogue, "carga mais nova de outro tenant NÃO zera as unidades do primeiro (cada uma usa a sua exportação)")
        pg.click("[data-v=admin]"); pg.wait_for_timeout(500)
        carregar_csv(pg, "users_01_10_2026.csv", export(OUTRO))
        ok("Já existe" not in pg.text_content("#previa"), "outro tenant na mesma data de outra carga: não acusa \"já existe\"")
        pg.click("[data-acao=gravarCarga]"); pg.wait_for_timeout(800)
        ok("01/10/2026 carregada: 2 contas" in mensagem(pg) and psql("select count(*) from lic_contas c join lic_cargas k on k.id = c.carga_id where k.exportado_em = '2026-10-01'", saida=True) == "8",
           "grava sem apagar as contas da Vogue e do Park Sul daquela data")
        carregar_csv(pg, "users_01_10_2026.csv", export([c for c in OUT if "outraempresa" not in c[1]]))
        t = pg.text_content("#previa")
        ok("Já existe uma carga de 01/10/2026 para: Shopping Park Sul, Vogue." in t and "Outra Empresa" not in t.split("Já existe")[1], "\"já existe\" cita só as unidades do arquivo")
        pg.click("[data-acao=cancelarPrevia]")
        ok(not er, "sem erros de script (outro tenant) " + str(er))
        abrir(pc); pc.wait_for_timeout(300)
        ok(pc.locator("#selCarga option").count() == 2 and "Outra Empresa" not in pc.text_content("body"), "cliente da Vogue não vê as datas nem os dados do outro tenant")
        pm, erm = entrar(b, "clienteA", 390); abrir(pm)
        ok(pm.evaluate("document.documentElement.scrollWidth") <= 392, "celular sem rolagem lateral")
        pm.screenshot(path=os.path.join(SAIDA, "licencas-celular.png"), full_page=True)
        for arq in ("cartao", "manual"):
            r = pm.goto(f"http://127.0.0.1:{PORTA_SITE}/apps/licencas/ajuda/{arq}.html")
            ok(r.status == 200 and pm.evaluate("document.documentElement.scrollWidth") <= 392, f"{arq} abre e cabe no celular")
        b.close()
    print("TODOS OS TESTES DE TELA DE LICENÇAS OK")
finally:
    api.terminate(); srv.shutdown()
    try: os.remove(conf)
    except OSError: pass
