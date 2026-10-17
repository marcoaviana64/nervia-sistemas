"""Teste de ponta a ponta da fase 2 do Orçamentos de Compras: o comprador convida, o fornecedor responde pelo link
(/cotacao/#código, sem login) e a proposta aparece no mapa. Tela real + banco real (Postgres com as migrações) pelo PostgREST.
O Storage é imitado aqui: o upload grava em storage.objects como "anon", então a política do bucket vale de verdade.

Precisa de: Postgres (PGHOST/PGPORT/PGUSER), o binário do PostgREST (POSTGREST, v12+), Playwright e pyjwt.
Sem internet para o CDN: SUPABASE_JS=caminho do supabase.js (umd) da mesma versão.
Uso: PGHOST=/tmp/pgd PGPORT=5433 PGUSER=postgres POSTGREST=/caminho/postgrest python3 testes/compras/tela_fornecedor_test.py [pasta_prints]
"""
import os, sys, json, time, glob, subprocess, threading, http.server, functools, urllib.request, re
import jwt
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAIDA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, "testes")
PG = dict(host=os.environ.get("PGHOST", "localhost"), port=os.environ.get("PGPORT", "5432"), user=os.environ.get("PGUSER", "postgres"))
DB = "teste_compras_fornecedor"
SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres!!"
PORTA_API, PORTA_SITE = 3902, 8814
COMPRADOR = "00000000-0000-0000-0000-0000000000d2"

def psql(sql=None, arquivo=None, db=DB, saida=False):
    cmd = ["psql", "-h", PG["host"], "-p", PG["port"], "-U", PG["user"], "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"]
    cmd += ["-f", arquivo] if arquivo else ["-c", sql]
    r = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return r.stdout.strip() if saida else None

def preparar_banco():
    psql(f"drop database if exists {DB}", db="postgres"); psql(f"create database {DB}", db="postgres")
    psql(arquivo=os.path.join(RAIZ, "testes", "stubs_supabase.sql"))
    sql = "\n".join(l for f in sorted(glob.glob(os.path.join(RAIZ, "supabase", "migrations", "*.sql")))
                    for l in open(f, encoding="utf-8").read().splitlines() if not l.startswith("create extension"))
    caminho = os.path.join(SAIDA, "_migracoes_fornecedor.sql"); open(caminho, "w", encoding="utf-8").write(sql)
    psql(arquivo=caminho); os.remove(caminho)
    psql("""do $$ begin create role autenticador login password 'x' noinherit; exception when duplicate_object then null; end $$;
      grant anon, authenticated to autenticador;""")
    psql(f"""
      insert into auth.users (id, email, raw_user_meta_data) values
        ('00000000-0000-0000-0000-0000000000d1', 'carla@itaipu.com', '{{"nome":"Carla Solicitante"}}'),
        ('{COMPRADOR}', 'rafael@itaipu.com', '{{"nome":"Rafael Comprador"}}');
      insert into cmp_membros select '00000000-0000-0000-0000-0000000000d1', id, 'solicitante' from cmp_unidades;
      insert into cmp_membros select '{COMPRADOR}', id, 'comprador' from cmp_unidades;
      insert into cmp_fornecedores (tipo, documento, nome, grupos, telefone, email, certidoes_validade, cadastrado_nome) values
        ('PJ', '22333444000181', 'InfoMais Distribuidora', '{{Energia}}', '(21) 98888-7777', 'vendas@infomais.com', current_date + 200, 'Equipe Nervia');
      set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
      insert into cmp_requisicoes (unidade_id, grupo, titulo, quantidade, valor_estimado, descricao)
        select id, 'Energia', 'Nobreak 3 kVA senoidal', 2, 12345, 'Para o rack do CPD, com baterias.' from cmp_unidades;
    """)

def iniciar_api():
    conf = os.path.join(SAIDA, "_postgrest_forn.conf")
    open(conf, "w").write(f'db-uri = "postgres://autenticador:x@localhost:{PG["port"]}/{DB}"\ndb-schemas = "public"\ndb-anon-role = "anon"\n'
                          f'jwt-secret = "{SEGREDO}"\nserver-port = {PORTA_API}\nlog-level = "crit"\n')
    proc = subprocess.Popen([os.environ["POSTGREST"], conf], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try: urllib.request.urlopen(f"http://localhost:{PORTA_API}/"); break
        except Exception: time.sleep(0.2)
    return proc, conf

CONFIG = f'window.NERVIA_CONFIG={{SUPABASE_URL:"http://127.0.0.1:{PORTA_SITE}",SUPABASE_ANON_KEY:"anon"}};'
UPLOADS = []

def contexto(b, uid=None, largura=1300):
    ctx = b.new_context(viewport={"width": largura, "height": 900})
    if uid:
        t = jwt.encode({"sub": uid, "role": "authenticated", "aud": "authenticated", "exp": int(time.time()) + 3600}, SEGREDO, algorithm="HS256")
        sessao = {"access_token": t, "refresh_token": "x", "token_type": "bearer", "expires_in": 3600, "expires_at": int(time.time()) + 3600,
                  "user": {"id": uid, "aud": "authenticated", "role": "authenticated"}}
        ctx.add_init_script(f"localStorage.setItem('sb-127-auth-token', {json.dumps(json.dumps(sessao))});")
    # window.open guardado para conferir (WhatsApp, e-mail) sem sair para a internet
    ctx.add_init_script("window.__abertos = []; window.open = (u) => { window.__abertos.push(u); return null; };")
    pg = ctx.new_page(); erros = []
    pg.on("pageerror", lambda e: erros.append(str(e)))
    pg.route("**/config.js", lambda r: r.fulfill(body=CONFIG, content_type="text/javascript"))
    if os.environ.get("SUPABASE_JS"):
        pg.route("**/supabase-js@*/**", lambda r: r.fulfill(path=os.environ["SUPABASE_JS"], content_type="text/javascript"))
    def api(rota):
        url = rota.request.url.replace(f"http://127.0.0.1:{PORTA_SITE}/rest/v1", f"http://localhost:{PORTA_API}")
        cab = {k: v for k, v in rota.request.headers.items() if k.lower() != "authorization" or v != "Bearer anon"}
        rota.fulfill(response=rota.fetch(url=url, headers=cab))
    pg.route(f"http://127.0.0.1:{PORTA_SITE}/rest/v1/**", api)
    def storage(rota):
        caminho = rota.request.url.split("/storage/v1/object/cmp-propostas/", 1)[1].split("?")[0]
        try:
            psql(f"set role anon; insert into storage.objects (bucket_id, name) values ('cmp-propostas', '{caminho}')")
            UPLOADS.append(caminho)
            rota.fulfill(status=200, content_type="application/json", body=json.dumps({"Key": "cmp-propostas/" + caminho, "Id": "1"}))
        except subprocess.CalledProcessError as e:
            rota.fulfill(status=400, content_type="application/json", body=json.dumps({"statusCode": "403", "error": "Unauthorized", "message": e.stderr.strip()}))
    pg.route(f"http://127.0.0.1:{PORTA_SITE}/storage/v1/object/cmp-propostas/**", storage)
    pg.on("dialog", lambda d: d.accept())
    return pg, erros

def ok(cond, nome):
    if not cond: raise SystemExit("FALHOU: " + nome)
    print("ok ", nome)

def confirmar(pg): pg.click("dialog [value=ok]"); pg.wait_for_timeout(600)
def mensagem(pg): return pg.text_content("#msg") if pg.is_visible("#msg") else ""

def abrir_req(pg):
    pg.goto(f"http://127.0.0.1:{PORTA_SITE}/apps/compras/"); pg.wait_for_selector("#app:not(.oculto)")
    pg.click("[data-v=reqs]"); pg.wait_for_timeout(200); pg.click("tr[data-req='1001']"); pg.wait_for_timeout(500)

def cotacao(pg, codigo):
    pg.goto("about:blank"); pg.goto(f"http://127.0.0.1:{PORTA_SITE}/cotacao/#{codigo}"); pg.wait_for_selector("#pagina:not(.oculto), #aviso:not(.oculto)"); pg.wait_for_timeout(300)

PDF = os.path.join(SAIDA, "_proposta_teste.pdf")
open(PDF, "wb").write(b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")

preparar_banco()
api, conf = iniciar_api()
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORTA_SITE), functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(RAIZ, "site")))
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get("CHROMIUM") or None)
        # comprador convida um fornecedor da base e um contato sem cadastro
        pg, er = contexto(b, COMPRADOR); abrir_req(pg)
        ok("Nenhum convite ainda" in pg.text_content("#tela"), "requisição nova mostra a caixa de convites")
        pg.click("[data-acao=convidar]"); pg.select_option("dialog [name=f]", label="InfoMais Distribuidora"); confirmar(pg)
        ok("Convite criado" in mensagem(pg) and "ainda não abriu" in pg.text_content("#tela"), "comprador convida fornecedor da base")
        pg.click("[data-acao=whats]"); url = pg.evaluate("window.__abertos.pop()")
        ok(url.startswith("https://wa.me/5521988887777?text=") and "%2Fcotacao%2F%23" in url and "Nobreak" in urllib.request.unquote(url),
           "WhatsApp abre com o telefone do cadastro, a mensagem e o link")
        pg.click("[data-acao=emailConvite]"); url = pg.evaluate("window.__abertos.pop()")
        ok(url.startswith("mailto:vendas%40infomais.com?subject=") and "%2Fcotacao%2F%23" in url, "e-mail abre com o endereço do cadastro e o link")
        pg.click("[data-acao=convidar]"); pg.fill("dialog [name=contato]", "Energia Total (Marcos)"); pg.fill("dialog [name=email]", "marcos@energiatotal.com"); confirmar(pg)
        ok(pg.locator("[data-acao=whats]").count() == 2 and "Energia Total (Marcos) (sem cadastro)" in pg.text_content("#tela"), "convite para contato sem cadastro")
        ok(not er, "sem erros de script (comprador) " + str(er))
        cod_base = psql("select codigo from cmp_convites where fornecedor_id is not null", saida=True)
        cod_novo = psql("select codigo from cmp_convites where fornecedor_id is null", saida=True)

        # fornecedor da base, sem login
        f, erf = contexto(b)
        cotacao(f, "abc")
        ok("incompleto" in f.text_content("#aviso"), "link incompleto avisa o fornecedor")
        cotacao(f, cod_base)
        tela = f.text_content("body")
        ok("Multicenter Itaipu pede uma cotação" in tela and "Nobreak 3 kVA senoidal" in tela and "rack do CPD" in tela, "fornecedor vê a requisição pelo link")
        ok("12.345" not in tela and "12345" not in tela and "Carla" not in tela, "fornecedor não vê o valor estimado nem quem pediu")
        ok(not f.is_visible("#cxEmpresa") and "InfoMais Distribuidora" in f.text_content("#cxIdent"), "convite da base já vem identificado")
        f.fill("#preco", "3200"); f.fill("#prazoDias", "6"); f.fill("#declarante", "Ana Souza"); f.click("#enviar"); f.wait_for_timeout(300)
        ok("declaração" in f.text_content("#erro"), "sem marcar a declaração não envia")
        f.check("#aceite"); f.set_input_files("#pdf", PDF); f.click("#enviar"); f.wait_for_timeout(1200)
        ok(re.search(r"Proposta P-\d+ recebida", f.text_content("#situacao")) and "com PDF" in f.text_content("#situacao") and len(UPLOADS) == 1,
           "fornecedor envia com PDF e recebe o protocolo")
        ok(f.input_value("#preco") == "3200" and f.text_content("#enviar") == "Reenviar proposta", "proposta enviada volta preenchida para reenvio")
        f.fill("#preco", "3100"); f.check("#aceite"); f.click("#enviar"); f.wait_for_timeout(900)
        ok("R$ 3.100,00" in f.text_content("#situacao").replace("\xa0", " "), "fornecedor reenvia com preço menor")
        f.screenshot(path=os.path.join(SAIDA, "compras-cotacao-fornecedor.png"), full_page=True)
        ok(not erf, "sem erros de script (fornecedor) " + str(erf))

        # contato sem cadastro informa o CNPJ
        n, ern = contexto(b, largura=390)
        cotacao(n, cod_novo)
        ok(n.is_visible("#cxEmpresa"), "contato sem cadastro vê os campos de CNPJ")
        n.fill("#documento", "44.555.666/0001-82"); n.fill("#nome", "Energia Total Ltda"); n.fill("#preco", "2950"); n.fill("#prazoDias", "10")
        n.fill("#declarante", "Marcos Lima"); n.check("#aceite"); n.click("#enviar"); n.wait_for_timeout(800)
        ok("CNPJ inválido" in n.text_content("#erro"), "CNPJ com dígito errado é recusado")
        n.fill("#documento", "44.555.666/0001-81"); n.check("#aceite"); n.click("#enviar"); n.wait_for_timeout(900)
        ok("recebida" in n.text_content("#situacao") and not n.is_visible("#cxEmpresa") and "Energia Total Ltda" in n.text_content("#cxIdent"),
           "contato sem cadastro se identifica e envia")
        larg = n.evaluate("document.documentElement.scrollWidth")
        ok(larg <= 392, f"página do fornecedor cabe no celular ({larg}px)")
        n.screenshot(path=os.path.join(SAIDA, "compras-cotacao-celular.png"), full_page=True)
        ok(not ern, "sem erros de script (contato novo) " + str(ern))

        # comprador vê as propostas
        abrir_req(pg)
        tela = pg.text_content("#tela")
        ok(pg.locator("th .tag", has_text="enviada pelo fornecedor").count() == 2 and "Ana Souza" in tela and "ver PDF" in tela and "re-cotado" in tela, "mapa mostra as propostas do fornecedor (quem, PDF, re-cotação)")
        ok(pg.locator("[data-acao=editProp]").count() == 0, "comprador não tem 'editar' em proposta do fornecedor")
        ok(tela.count("respondeu") == 2, "convites aparecem como respondidos")
        pg.click("[data-acao=delProp] >> nth=0"); ok(pg.is_visible("dialog [name=m]"), "excluir proposta do fornecedor pede motivo"); pg.click("dialog [value=cancelar]")
        pg.click("[data-v=forn]"); pg.wait_for_timeout(300)
        ok("Energia Total Ltda" in pg.text_content("#tela") and "Rafael Comprador" in pg.text_content("#tela"), "fornecedor novo entrou na base com o comprador como responsável")
        abrir_req(pg)
        pg.click("[data-acao=cancelarConvite] >> nth=0"); confirmar(pg)
        ok("Convite cancelado" in mensagem(pg) and "cancelado" in pg.text_content("#tela"), "comprador cancela o convite")
        pg.screenshot(path=os.path.join(SAIDA, "compras-convites.png"), full_page=True)
        ok(not er, "sem erros de script (comprador, depois) " + str(er))
        cotacao(f, cod_base)
        ok("cancelado pelo comprador" in f.text_content("#situacao") and not f.is_visible("#form"), "link cancelado não aceita mais proposta")
        b.close()
    print("TODOS OS TESTES DE TELA DO FORNECEDOR OK")
finally:
    api.terminate(); srv.shutdown(); os.remove(conf); os.remove(PDF)
