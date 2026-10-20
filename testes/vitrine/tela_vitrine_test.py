"""Teste de ponta a ponta da vitrine da Área do Cliente: tela real + banco real (Postgres local com as migrações)
servido pelo PostgREST (o mesmo motor da API do Supabase). Cada papel entra com o próprio login (JWT).

Precisa de: Postgres (PGHOST/PGPORT/PGUSER), o binário do PostgREST (variável POSTGREST, v12+) e Playwright.
Sem internet para o CDN: SUPABASE_JS=caminho do supabase.js (umd) da mesma versão.
Uso: PGHOST=/tmp/pgd PGPORT=5433 PGUSER=postgres POSTGREST=/caminho/postgrest python3 testes/vitrine/tela_vitrine_test.py [pasta_prints]
"""
import os, sys, json, time, glob, subprocess, threading, http.server, functools, urllib.request, urllib.parse, re
import jwt
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAIDA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, "testes")
PG = dict(host=os.environ.get("PGHOST", "localhost"), port=os.environ.get("PGPORT", "5432"), user=os.environ.get("PGUSER", "postgres"))
DB = "teste_vitrine_tela"
SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres!!"
PORTA_API, PORTA_SITE = 3903, 8815

def psql(sql=None, arquivo=None, db=DB, saida=False):
    cmd = ["psql", "-h", PG["host"], "-p", PG["port"], "-U", PG["user"], "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-At"]
    cmd += ["-f", arquivo] if arquivo else ["-c", sql]
    r = subprocess.run(cmd, check=True, stdout=subprocess.PIPE if saida else subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    return r.stdout.strip() if saida else None

def valor(sql): return psql(sql, saida=True)

def preparar_banco():
    psql(f"drop database if exists {DB}", db="postgres"); psql(f"create database {DB}", db="postgres")
    psql(arquivo=os.path.join(RAIZ, "testes", "stubs_supabase.sql"))
    sql = "\n".join(l for f in sorted(glob.glob(os.path.join(RAIZ, "supabase", "migrations", "*.sql")))
                    for l in open(f, encoding="utf-8").read().splitlines() if not l.startswith("create extension"))
    caminho = os.path.join(SAIDA, "_migracoes_vitrine.sql"); open(caminho, "w", encoding="utf-8").write(sql)
    psql(arquivo=caminho); os.remove(caminho)
    psql("""do $$ begin create role autenticador login password 'x' noinherit; exception when duplicate_object then null; end $$;
      grant anon, authenticated to autenticador;""")
    psql("""
      insert into auth.users (id, email, raw_user_meta_data) values
        ('00000000-0000-0000-0000-0000000000a1', 'marco@nervia.com.br', '{"nome":"Marco"}'),
        ('00000000-0000-0000-0000-0000000000c1', 'compras@clientea.com', '{"nome":"Ana Souza"}'),
        ('00000000-0000-0000-0000-0000000000c2', 'ti@clienteb.com', '{"nome":"Bruno"}');
      update perfis set admin = true where email = 'marco@nervia.com.br';
      insert into app_acessos values ('00000000-0000-0000-0000-0000000000c1', 'notas'), ('00000000-0000-0000-0000-0000000000c2', 'compras');
    """)

def iniciar_api():
    conf = os.path.join(SAIDA, "_postgrest_vitrine.conf")
    open(conf, "w").write(f'db-uri = "postgres://autenticador:x@localhost:{PG["port"]}/{DB}"\ndb-schemas = "public"\ndb-anon-role = "anon"\n'
                          f'jwt-secret = "{SEGREDO}"\nserver-port = {PORTA_API}\nlog-level = "crit"\n')
    proc = subprocess.Popen([os.environ["POSTGREST"], conf], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try: urllib.request.urlopen(f"http://localhost:{PORTA_API}/"); break
        except Exception: time.sleep(0.2)
    return proc, conf

def token(uid, email):
    return jwt.encode({"sub": uid, "email": email, "role": "authenticated", "aud": "authenticated", "exp": int(time.time()) + 3600}, SEGREDO, algorithm="HS256")

USU = {"admin": ("00000000-0000-0000-0000-0000000000a1", "marco@nervia.com.br"), "clienteA": ("00000000-0000-0000-0000-0000000000c1", "compras@clientea.com"),
       "clienteB": ("00000000-0000-0000-0000-0000000000c2", "ti@clienteb.com")}
CONFIG = f'window.NERVIA_CONFIG={{SUPABASE_URL:"http://127.0.0.1:{PORTA_SITE}",SUPABASE_ANON_KEY:"anon"}};'

def entrar(b, papel, largura=1300):
    uid, email = USU[papel]; t = token(uid, email)
    sessao = {"access_token": t, "refresh_token": "x", "token_type": "bearer", "expires_in": 3600, "expires_at": int(time.time()) + 3600,
              "user": {"id": uid, "email": email, "aud": "authenticated", "role": "authenticated"}}
    ctx = b.new_context(viewport={"width": largura, "height": 900})
    ctx.add_init_script(f"localStorage.setItem('sb-127-auth-token', {json.dumps(json.dumps(sessao))});")
    ctx.route("https://wa.me/**", lambda r: r.fulfill(body="whatsapp", content_type="text/plain"))
    ctx.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
    ctx.route("**/config.js", lambda r: r.fulfill(body=CONFIG, content_type="text/javascript"))
    if os.environ.get("SUPABASE_JS"):  # sem acesso ao CDN: usa uma cópia local do supabase-js (mesma versão)
        ctx.route("**/supabase-js@*/**", lambda r: r.fulfill(path=os.environ["SUPABASE_JS"], content_type="text/javascript"))
    def api(rota):
        url = rota.request.url.replace(f"http://127.0.0.1:{PORTA_SITE}/rest/v1", f"http://localhost:{PORTA_API}")
        rota.fulfill(response=rota.fetch(url=url))
    ctx.route(f"http://127.0.0.1:{PORTA_SITE}/rest/v1/**", api)
    pg = ctx.new_page(); erros = []
    pg.on("pageerror", lambda e: erros.append(str(e)))
    pg.on("dialog", lambda d: d.accept())
    return pg, erros

def abrir(pg, hash=""):
    pg.goto(f"http://127.0.0.1:{PORTA_SITE}/cliente/{hash}"); pg.wait_for_selector("#vArea:not(.oculto)"); pg.wait_for_timeout(400)

def cartao(pg, app): return pg.locator(f'.vit[data-app="{app}"]')

def ok(cond, nome):
    if not cond: raise SystemExit("FALHOU: " + nome)
    print("ok ", nome)

def api_como(papel, rota):
    uid, email = USU[papel]
    req = urllib.request.Request(f"http://localhost:{PORTA_API}/{rota}", headers={"Authorization": "Bearer " + token(uid, email)})
    return json.loads(urllib.request.urlopen(req).read())

preparar_banco()
api, conf = iniciar_api()
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORTA_SITE), functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(RAIZ, "site")))
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        # ---------------- equipe Nervia: app novo só na vitrine (sem endereço), situação "Em desenvolvimento"
        pg, er = entrar(b, "admin"); abrir(pg, "#admin")
        pg.click("#abaApps"); pg.wait_for_timeout(300)
        ok(pg.locator(".usu[data-id=compras] .fSit").input_value() == "disponivel" and pg.locator(".usu[data-id=monitor] .fSit").input_value() == "oculto",
           "Aplicativos mostra a situação de cada app")
        novo = pg.locator(".cartao:has(h2:text('Novo aplicativo')) .usu")
        novo.locator(".fId").fill("contas365"); novo.locator(".fNome").fill("Contas e Licenças Microsoft 365")
        novo.locator(".fDesc").fill("Quem usa cada licença, contas paradas e o que dá para economizar.")
        novo.locator(".fIco").fill("365"); novo.locator(".fSit").select_option("em_desenvolvimento"); novo.locator(".fDemo").fill("/demo/secreta/")
        novo.locator("button").click(); pg.wait_for_timeout(500)
        ok("Aplicativo salvo" in pg.text_content("#msgAdm"), "admin cadastra app sem endereço (só vitrine)")
        ok(valor("select ativo::text || situacao from apps where id = 'contas365'") == "falseem_desenvolvimento", "app sem endereço nasce desativado, em desenvolvimento")
        linha = pg.locator(".usu[data-id=contas365]")
        linha.locator(".fAtivo").check(); linha.locator("button").click(); pg.wait_for_timeout(400)
        ok("precisa de endereço" in pg.text_content("#msgAdm"), "app ativo sem endereço é recusado")
        pg.goto(f"http://127.0.0.1:{PORTA_SITE}/cliente/#"); pg.wait_for_timeout(600)
        ids = pg.eval_on_selector_all(".vit", "l => l.map(e => e.dataset.app)")
        ok(sorted(ids) == ["contas365", "produtos"], f"vitrine do admin só com o que não está ativo ({ids})")
        ok(not er, "sem erros de script (admin) " + str(er))

        # ---------------- cliente A: tem só o Buscador
        pc, erc = entrar(b, "clienteA"); abrir(pc)
        ok(pc.locator("#grade .app").count() == 1 and "Notas Fiscais" in pc.text_content("#grade"), "grade com o app liberado")
        ok(pc.locator("#vit-disponivel .vit").count() == 3 and pc.locator("#vit-em_breve .vit").count() == 1 and pc.locator("#vit-em_desenvolvimento .vit").count() == 1,
           "três seções: disponíveis (3), em breve (1), em desenvolvimento (1)")
        t = pc.text_content("#vitrine")
        ok("Conheça outros apps da Nervia" in t and "Disponível para contratar" in t and "Monitor" not in t and "Notas Fiscais" not in t,
           "vitrine sem o app que já tem e sem o oculto")
        ok(cartao(pc, "compras").locator("a:text('Ver demonstração')").get_attribute("href") == "/demo/compras/"
           and cartao(pc, "compras").locator("a:text('Quero conhecer')").get_attribute("href").startswith("https://wa.me/5521966869374?text="),
           "disponível: demonstração + Quero conhecer pelo WhatsApp")
        ok(cartao(pc, "produtos").locator("a").count() == 1 and cartao(pc, "produtos").locator("a").get_attribute("href") == "/demo/produtos/",
           "em breve: só a demonstração")
        ok(cartao(pc, "contas365").locator("a").count() == 0, "em desenvolvimento: sem links (o link guardado não vaza)")
        wa = urllib.parse.unquote(cartao(pc, "compras").locator("a.pri").get_attribute("href"))
        ok("Orçamentos de Compras" in wa and "Ana Souza" in wa and "compras@clientea.com" in wa, "mensagem do WhatsApp com o app e quem pede")
        pc.screenshot(path=f"{SAIDA}/vitrine_cliente.png", full_page=True)

        uidA = USU["clienteA"][0]
        reacao = lambda app: valor(f"select coalesce((select reacao || '|' || comentario from app_reacoes where user_id = '{uidA}' and app_id = '{app}'), '')")
        cartao(pc, "compras").locator("[data-reacao=curti]").click(); pc.wait_for_timeout(400)
        ok(reacao("compras") == "curti|" and "on" in cartao(pc, "compras").locator("[data-reacao=curti]").get_attribute("class"), "Curti grava e acende")
        cartao(pc, "compras").locator("[data-reacao=nao_curti]").click(); pc.wait_for_timeout(400)
        ok(reacao("compras") == "nao_curti|" and cartao(pc, "compras").locator(".faltou input").is_visible(), "troca para Não curti e abre 'O que faltou?'")
        cartao(pc, "compras").locator(".faltou input").fill("Falta integração com o ERP")
        cartao(pc, "compras").locator(".faltou button").click(); pc.wait_for_timeout(400)
        ok(reacao("compras") == "nao_curti|Falta integração com o ERP" and "comentário" in cartao(pc, "compras").text_content(), "comentário gravado")
        cartao(pc, "produtos").locator("[data-reacao=interesse]").click(); pc.wait_for_timeout(400)
        ok(reacao("produtos") == "interesse|" and "interesse" in cartao(pc, "produtos").text_content(), "Tenho interesse")
        cartao(pc, "produtos").locator("[data-reacao=interesse]").click(); pc.wait_for_timeout(400)
        ok(reacao("produtos") == "", "clicar de novo retira a reação")
        cartao(pc, "produtos").locator("[data-reacao=interesse]").click(); pc.wait_for_timeout(300)
        cartao(pc, "contas365").locator("[data-reacao=curti]").click(); pc.wait_for_timeout(300)
        ok(valor(f"select count(*) from app_reacoes where user_id = '{uidA}'") == "3", "uma reação por app")
        with pc.context.expect_page() as nova:
            cartao(pc, "compras").locator("a:text('Ver demonstração')").click()
        nova.value.close()
        with pc.context.expect_page() as nova:
            cartao(pc, "compras").locator("a.pri").click()
        nova.value.close(); pc.wait_for_timeout(600)
        ok(valor("select string_agg(acao, ',' order by acao) from app_cliques where app_id = 'compras'") == "demo,quero_conhecer", "cliques registrados")
        abrir(pc)
        ok("on" in cartao(pc, "compras").locator("[data-reacao=nao_curti]").get_attribute("class")
           and cartao(pc, "compras").locator(".faltou input").input_value() == "Falta integração com o ERP", "ao voltar, a reação e o comentário continuam")
        ok("Curti" in cartao(pc, "compras").text_content() and not re.search(r"\d+\s*(curtidas|pessoas)", pc.text_content("#vitrine")), "cliente não vê números")
        ok(not erc, "sem erros de script (cliente) " + str(erc))

        # cliente B não vê a reação dos outros nem o relatório
        ok(api_como("clienteB", "app_reacoes") == [] and api_como("clienteB", "app_cliques") == [], "outro cliente não lê reações nem cliques")
        try: api_como("clienteB", "rpc/apps_interesse"); ok(False, "cliente não chama apps_interesse")
        except urllib.error.HTTPError as e: ok(e.code >= 400, "cliente não chama apps_interesse")
        ok(sorted(a["id"] for a in api_como("clienteB", "rpc/apps_vitrine")) == ["contas365", "notas", "painel-nf", "produtos", "telefonia"],
           "vitrine do cliente B (tem Compras): Buscador aparece, Compras não")

        # celular
        pm, erm = entrar(b, "clienteA", 390); abrir(pm)
        ok(pm.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "celular sem rolagem lateral")
        pm.screenshot(path=f"{SAIDA}/vitrine_celular.png", full_page=True)
        ok(not erm, "sem erros de script (celular) " + str(erm))

        # ---------------- equipe Nervia: empresa do login e tela "Interesse nos apps"
        abrir(pg, "#admin"); pg.click("#abaUsu"); pg.wait_for_timeout(400)
        emp = pg.locator(".usu:has-text('compras@clientea.com') .fEmpresa")
        emp.fill("Comercial Alfa Ltda"); emp.press("Tab"); pg.wait_for_timeout(400)
        ok(valor(f"select empresa from perfis where user_id = '{uidA}'") == "Comercial Alfa Ltda", "admin preenche a empresa do login")
        pg.click("#abaInt"); pg.wait_for_timeout(500)
        t = pg.text_content("#admConteudo")
        linha_c = [l for l in pg.eval_on_selector_all("#admConteudo table:first-of-type tr", "l => l.map(e => e.innerText)") if l.startswith("Orçamentos de Compras")]
        ok(linha_c and re.sub(r"\s+", " ", linha_c[0]).startswith("Orçamentos de Compras Disponível para contratar 0 1 0 1"), f"totais por app ({linha_c})")
        ok("compras@clientea.com" in t and "Comercial Alfa Ltda" in t and "Quero conhecer (1×)" in t and "Tenho interesse" in t, "interessados com empresa e contato")
        ok("Falta integração com o ERP" in t, "comentários do Não curti")
        pg.screenshot(path=f"{SAIDA}/vitrine_admin_interesse.png", full_page=True)
        with pg.expect_download() as d: pg.click("text=CSV")
        csv = open(d.value.path(), encoding="utf-8-sig").read()
        ok("Comercial Alfa Ltda" in csv and "Falta integração com o ERP" in csv, "CSV do interesse")
        ok(not er, "sem erros de script (admin, interesse) " + str(er))
        b.close()
    print("TELA DA VITRINE OK")
finally:
    api.terminate(); srv.shutdown()
    for f in (conf,):
        try: os.remove(f)
        except OSError: pass
