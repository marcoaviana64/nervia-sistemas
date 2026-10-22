"""Teste de ponta a ponta das Oportunidades do Orçamentos de Compras: o fornecedor pede o cadastro na página pública
(/fornecedores/), a equipe Nervia libera o acesso e manda o link, o comprador abre a requisição, o fornecedor vê a
oportunidade sem o nome da empresa (/fornecedores/oportunidades/#código), envia a proposta pela página de cotação e o
comprador vê tudo no mapa. Tela real + banco real (Postgres com as migrações) pelo PostgREST.

Uso: PGHOST=/tmp/pgd PGPORT=5433 PGUSER=postgres POSTGREST=/caminho/postgrest python3 testes/compras/tela_oportunidades_test.py [pasta_prints]
Sem internet para o CDN: SUPABASE_JS=caminho do supabase.js (umd) da mesma versão.
"""
import os, sys, json, time, glob, subprocess, threading, http.server, functools, urllib.request, urllib.parse, re
import jwt
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAIDA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, "testes")
PG = dict(host=os.environ.get("PGHOST", "localhost"), port=os.environ.get("PGPORT", "5432"), user=os.environ.get("PGUSER", "postgres"))
DB = "teste_compras_oportunidades"
SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres!!"
PORTA_API, PORTA_SITE = 3903, 8815
SOLIC, COMPRADOR, ADMIN = "00000000-0000-0000-0000-0000000000d1", "00000000-0000-0000-0000-0000000000d2", "00000000-0000-0000-0000-00000000000a"

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
    caminho = os.path.join(SAIDA, "_migracoes_oportunidades.sql"); open(caminho, "w", encoding="utf-8").write(sql)
    psql(arquivo=caminho); os.remove(caminho)
    psql("""do $$ begin create role autenticador login password 'x' noinherit; exception when duplicate_object then null; end $$;
      grant anon, authenticated to autenticador;""")
    psql(f"""
      insert into auth.users (id, email, raw_user_meta_data) values
        ('{SOLIC}', 'carla@valeverde.exemplo', '{{"nome":"Carla Solicitante"}}'),
        ('{COMPRADOR}', 'rafael@valeverde.exemplo', '{{"nome":"Rafael Comprador"}}'),
        ('{ADMIN}', 'equipe@nervia.exemplo', '{{"nome":"Equipe Nervia"}}');
      update perfis set admin = true where user_id = '{ADMIN}';
      insert into cmp_membros select '{SOLIC}', id, 'solicitante' from cmp_unidades;
      insert into cmp_membros select '{COMPRADOR}', id, 'comprador' from cmp_unidades;
      set request.jwt.claim.sub = '{SOLIC}';
      insert into cmp_requisicoes (unidade_id, grupo, titulo, quantidade, valor_estimado, descricao)
        select id, 'Informática e tecnologia', 'Monitor 24 polegadas', 4, 12345, 'Full HD, entrada HDMI, com cabo.' from cmp_unidades;
    """)

def iniciar_api():
    conf = os.path.join(SAIDA, "_postgrest_oport.conf")
    open(conf, "w").write(f'db-uri = "postgres://autenticador:x@localhost:{PG["port"]}/{DB}"\ndb-schemas = "public"\ndb-anon-role = "anon"\n'
                          f'jwt-secret = "{SEGREDO}"\nserver-port = {PORTA_API}\nlog-level = "crit"\n')
    proc = subprocess.Popen([os.environ["POSTGREST"], conf], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try: urllib.request.urlopen(f"http://localhost:{PORTA_API}/"); break
        except Exception: time.sleep(0.2)
    return proc, conf

CONFIG = f'window.NERVIA_CONFIG={{SUPABASE_URL:"http://127.0.0.1:{PORTA_SITE}",SUPABASE_ANON_KEY:"anon"}};'

def contexto(b, uid=None, largura=1300):
    ctx = b.new_context(viewport={"width": largura, "height": 900})
    if uid:
        t = jwt.encode({"sub": uid, "role": "authenticated", "aud": "authenticated", "exp": int(time.time()) + 3600}, SEGREDO, algorithm="HS256")
        sessao = {"access_token": t, "refresh_token": "x", "token_type": "bearer", "expires_in": 3600, "expires_at": int(time.time()) + 3600,
                  "user": {"id": uid, "aud": "authenticated", "role": "authenticated"}}
        ctx.add_init_script(f"localStorage.setItem('sb-127-auth-token', {json.dumps(json.dumps(sessao))});")
    ctx.add_init_script("window.__abertos = []; window.open = (u) => { window.__abertos.push(u); return null; };")
    pg = ctx.new_page(); erros = []
    pg.on("pageerror", lambda e: erros.append(str(e)))
    pg.route("**/config.js", lambda r: r.fulfill(body=CONFIG, content_type="text/javascript"))
    pg.route("**/acesso.js", lambda r: r.fulfill(body="", content_type="text/javascript"))
    if os.environ.get("SUPABASE_JS"):
        pg.route("**/supabase-js@*/**", lambda r: r.fulfill(path=os.environ["SUPABASE_JS"], content_type="text/javascript"))
    def api(rota):
        url = rota.request.url.replace(f"http://127.0.0.1:{PORTA_SITE}/rest/v1", f"http://localhost:{PORTA_API}")
        cab = {k: v for k, v in rota.request.headers.items() if k.lower() != "authorization" or v != "Bearer anon"}
        rota.fulfill(response=rota.fetch(url=url, headers=cab))
    pg.route(f"http://127.0.0.1:{PORTA_SITE}/rest/v1/**", api)
    pg.on("dialog", lambda d: d.accept())
    return pg, erros

def ok(cond, nome):
    if not cond: raise SystemExit("FALHOU: " + nome)
    print("ok ", nome)

def confirmar(pg): pg.click("dialog [value=ok]"); pg.wait_for_timeout(700)
def mensagem(pg): return pg.text_content("#msg") if pg.is_visible("#msg") else ""
def texto(pg, sel="body"): return re.sub(r"\s+", " ", pg.inner_text(sel).replace("\xa0", " "))
def cabe(pg): return pg.evaluate("document.documentElement.scrollWidth") <= pg.viewport_size["width"] + 2
URL = f"http://127.0.0.1:{PORTA_SITE}"

preparar_banco()
api, conf = iniciar_api()
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORTA_SITE), functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(RAIZ, "site")))
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get("CHROMIUM") or None)

        # ---- 1. fornecedor pede o cadastro na página pública
        fp, erf = contexto(b)
        fp.goto(URL + "/fornecedores/"); fp.wait_for_selector(".g"); fp.wait_for_timeout(300)
        t = texto(fp)
        ok(fp.locator(".g").count() == 22 and fp.locator(".u").count() == 27 and "shopping" not in t.lower() and "empresas compradoras" in t
           and "Não há garantia de cotações nem de vendas" in t and "Pagar não dá vantagem na escolha" in t and "R$" not in t,
           "página pública: grupos, estados, condições claras, fala em empresas compradoras e não mostra preço")
        fp.fill("#documento", "77.888.999/0001-81"); fp.fill("#nome", "Tec Sul Informática"); fp.fill("#contato", "Bruna")
        fp.fill("#telefone", "(21) 97777-6666"); fp.fill("#email", "bruna@tecsul.exemplo")
        fp.click("#enviar"); fp.wait_for_timeout(200)
        ok("pelo menos um grupo" in fp.text_content("#erro"), "cadastro: exige um grupo")
        fp.check(".g[value='Informática e tecnologia']"); fp.check(".u[value='RJ']"); fp.check(".u[value='ES']")
        fp.click("#enviar"); fp.wait_for_timeout(200)
        ok("aceita as condições" in fp.text_content("#erro"), "cadastro: exige o aceite")
        fp.check("#aceite"); fp.click("#enviar"); fp.wait_for_timeout(800)
        wa = urllib.parse.unquote(fp.get_attribute("#prontoWa", "href"))
        ok("protocolo S-1" in fp.text_content("#prontoTxt") and wa.startswith("https://wa.me/5521966869374") and "S-1" in wa, "pedido recebido com protocolo e aviso pronto para o WhatsApp da Nervia")
        fp.screenshot(path=os.path.join(SAIDA, "oportunidades-cadastro.png"), full_page=True)
        fm, erm = contexto(b, largura=390); fm.goto(URL + "/fornecedores/"); fm.wait_for_selector(".g"); fm.wait_for_timeout(200)
        ok(cabe(fm), "página pública cabe no celular")
        ok(not erf and not erm, "sem erros de script (página pública) " + str(erf + erm))

        # ---- 2. equipe Nervia: cidade/UF da unidade e libera o acesso
        ad, era = contexto(b, ADMIN)
        ad.goto(URL + "/apps/compras/"); ad.wait_for_selector("#app:not(.oculto)"); ad.click("[data-v=config]"); ad.wait_for_selector("#opAdmin table"); ad.wait_for_timeout(300)
        ad.fill("#cCidade", "Niterói"); ad.select_option("#cUf", "RJ"); ad.click("[data-acao=salvarUnidade]"); ad.wait_for_timeout(600)
        ok("Regras salvas" in mensagem(ad) and psql("select cidade || '/' || uf from cmp_unidades", saida=True) == "Niterói/RJ", "Nervia cadastra a cidade e o estado da unidade")
        ad.wait_for_selector("[data-acao=aprovarSol]")
        ok("Tec Sul Informática" in ad.text_content("#opAdmin") and "1 para conferir" in ad.text_content("#opAdmin"), "Nervia vê o pedido de cadastro")
        ad.click("[data-acao=aprovarSol]"); ad.wait_for_timeout(200)
        ok(ad.input_value("dialog [name=ufs]") == "ES, RJ", "liberar: estados vêm do pedido")
        ad.fill("dialog [name=valor]", "150"); ad.fill("dialog [name=obs]", "Pix 22/10, 1 mês"); confirmar(ad)
        ok("Acesso liberado" in mensagem(ad) and "ativo" in ad.text_content("#opAdmin"), "Nervia libera o acesso")
        ad.click("[data-acao=whatsAcesso]"); ad.wait_for_timeout(200)
        wa = urllib.parse.unquote(ad.evaluate("window.__abertos.filter(Boolean).pop()"))
        codigo = psql("select codigo from cmp_assinaturas", saida=True)
        ok(wa.startswith("https://wa.me/5521977776666?text=") and f"/fornecedores/oportunidades/#{codigo}" in wa, "link pessoal pronto para o WhatsApp do fornecedor")
        ad.screenshot(path=os.path.join(SAIDA, "oportunidades-admin.png"), full_page=True)
        ok(not era, "sem erros de script (Nervia) " + str(era))

        # ---- 3. comprador abre a requisição
        cp, erc = contexto(b, COMPRADOR)
        cp.goto(URL + "/apps/compras/"); cp.wait_for_selector("#app:not(.oculto)"); cp.click("[data-v=reqs]"); cp.wait_for_timeout(200)
        cp.click("tr[data-req='1001']"); cp.wait_for_timeout(500)
        ok("Abrir para fornecedores cadastrados" in cp.text_content("#tela"), "requisição mostra o cartão das Oportunidades")
        cp.click("[data-acao=abrirOp]"); cp.wait_for_timeout(200)
        d = texto(cp, "dialog")
        ok("Não vê: o nome da empresa e da unidade, quem pediu, o valor estimado" in d and "Niterói/RJ" in d, "abrir: diz o que o fornecedor vê e o que não vê")
        confirmar(cp)
        ok("aberta para os fornecedores" in mensagem(cp) and "Nenhum fornecedor entrou ainda" in cp.text_content("#tela"), "comprador abre a requisição para as Oportunidades")

        # ---- 4. fornecedor vê e participa
        fp.goto("about:blank"); fp.goto(f"{URL}/fornecedores/oportunidades/#{codigo}"); fp.wait_for_selector("#pagina:not(.oculto), #aviso:not(.oculto)"); fp.wait_for_timeout(400)
        t = texto(fp)
        ok("Monitor 24 polegadas" in t and "Niterói/RJ" in t and "Full HD" in t and "Multicenter" not in t and "12.345" not in t and "Carla" not in t,
           "área de Oportunidades: vê a requisição sem o nome da empresa, quem pediu ou valor estimado")
        fp.screenshot(path=os.path.join(SAIDA, "oportunidades-fornecedor.png"), full_page=True)
        fp.click("[data-req]"); fp.wait_for_url("**/cotacao/**"); fp.wait_for_selector("#pagina:not(.oculto)"); fp.wait_for_timeout(300)
        ok(fp.text_content("#titulo") == "Empresa compradora em Niterói/RJ pede uma cotação" and fp.is_visible("#voltarOp") and "Multicenter" not in texto(fp),
           "página de cotação sem o nome da empresa e com volta às Oportunidades")
        fp.fill("#preco", "890"); fp.fill("#prazoDias", "5"); fp.fill("#declarante", "Bruna"); fp.check("#aceite"); fp.click("#enviar"); fp.wait_for_timeout(900)
        ok("recebida" in fp.text_content("#situacao"), "fornecedor envia a proposta")
        fp.click("#voltarOpLink"); fp.wait_for_selector("#pagina:not(.oculto)"); fp.wait_for_timeout(300)
        ok("proposta enviada" in fp.text_content("#lista") and "Ver ou alterar minha proposta" in fp.text_content("#lista"), "de volta às Oportunidades, mostra a proposta enviada")
        fm.goto(f"{URL}/fornecedores/oportunidades/#{codigo}"); fm.wait_for_selector("#pagina:not(.oculto)"); fm.wait_for_timeout(300)
        ok(cabe(fm), "área de Oportunidades cabe no celular")
        fm.screenshot(path=os.path.join(SAIDA, "oportunidades-celular.png"), full_page=True)
        ok(not erf and not erm, "sem erros de script (fornecedor) " + str(erf + erm))

        # ---- 5. comprador vê no mapa e fecha
        cp.reload(); cp.wait_for_selector("#app:not(.oculto)"); cp.click("[data-v=reqs]"); cp.wait_for_timeout(200); cp.click("tr[data-req='1001']"); cp.wait_for_timeout(500)
        t = texto(cp, "#tela")
        ok("1 fornecedor(es) entraram, 1 enviaram proposta" in t and "Tec Sul Informática" in t and "Oportunidades" in t and "enviada pelo fornecedor" in t,
           "comprador vê quem entrou pelas Oportunidades e a proposta no mapa")
        cp.screenshot(path=os.path.join(SAIDA, "oportunidades-comprador.png"), full_page=True)
        cp.click("[data-acao=fecharOp]"); confirmar(cp)
        ok("Fechada para novos fornecedores" in mensagem(cp), "comprador fecha para novos fornecedores")
        fp.reload(); fp.wait_for_selector("#pagina:not(.oculto)"); fp.wait_for_timeout(300)
        ok("Nenhuma oportunidade aberta agora" in fp.text_content("#lista"), "requisição fechada some das Oportunidades")
        ok(not erc, "sem erros de script (comprador) " + str(erc))
        ok(psql("select count(*) from auditoria where acao in ('compras_cadastro_solicitado','compras_acesso_liberado','compras_oportunidade_aberta','compras_oportunidade_participacao','compras_proposta_enviada_fornecedor','compras_oportunidade_fechada')", saida=True) == "6",
           "pedido, liberação, abrir, participar, proposta e fechar na auditoria")
        b.close()
    print("TODOS OS TESTES DAS OPORTUNIDADES OK")
finally:
    api.terminate(); srv.shutdown()
    try: os.remove(conf)
    except OSError: pass
