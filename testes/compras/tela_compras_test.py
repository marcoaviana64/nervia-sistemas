"""Teste de ponta a ponta do app Orçamentos de Compras: tela real + banco real (Postgres local com as migrações)
servido pelo PostgREST (o mesmo motor da API do Supabase). Cada papel entra com o próprio login (JWT).

Precisa de: Postgres (PGHOST/PGPORT/PGUSER), o binário do PostgREST (variável POSTGREST, v12+) e Playwright.
Sem internet para o CDN: SUPABASE_JS=caminho do supabase.js (umd) da mesma versão.
Uso: PGHOST=/tmp/pgd PGPORT=5433 PGUSER=postgres POSTGREST=/caminho/postgrest python3 testes/compras/tela_compras_test.py [pasta_prints]
"""
import os, sys, json, time, glob, subprocess, threading, http.server, functools, urllib.request
import jwt
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAIDA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, "testes")
PG = dict(host=os.environ.get("PGHOST", "localhost"), port=os.environ.get("PGPORT", "5432"), user=os.environ.get("PGUSER", "postgres"))
DB = "teste_compras_tela"
SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres!!"
PORTA_API, PORTA_SITE = 3901, 8813

def psql(sql=None, arquivo=None, db=DB):
    cmd = ["psql", "-h", PG["host"], "-p", PG["port"], "-U", PG["user"], "-d", db, "-v", "ON_ERROR_STOP=1", "-q"]
    cmd += ["-f", arquivo] if arquivo else ["-c", sql]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

def preparar_banco():
    psql(f"drop database if exists {DB}", db="postgres"); psql(f"create database {DB}", db="postgres")
    psql(arquivo=os.path.join(RAIZ, "testes", "stubs_supabase.sql"))
    sql = "\n".join(l for f in sorted(glob.glob(os.path.join(RAIZ, "supabase", "migrations", "*.sql")))
                    for l in open(f, encoding="utf-8").read().splitlines() if not l.startswith("create extension"))
    caminho = os.path.join(SAIDA, "_migracoes_compras.sql"); open(caminho, "w", encoding="utf-8").write(sql)
    psql(arquivo=caminho); os.remove(caminho)
    psql("""do $$ begin create role autenticador login password 'x' noinherit; exception when duplicate_object then null; end $$;
      grant anon, authenticated to autenticador;""")
    psql("""
      insert into auth.users (id, email, raw_user_meta_data) values
        ('00000000-0000-0000-0000-0000000000a1', 'marco@nervia.com.br', '{"nome":"Marco"}'),
        ('00000000-0000-0000-0000-0000000000d1', 'carla@itaipu.com', '{"nome":"Carla Solicitante"}'),
        ('00000000-0000-0000-0000-0000000000d2', 'rafael@itaipu.com', '{"nome":"Rafael Comprador"}'),
        ('00000000-0000-0000-0000-0000000000d3', 'sonia@itaipu.com', '{"nome":"Sonia Gerente"}'),
        ('00000000-0000-0000-0000-0000000000d4', 'sem@x.com', '{"nome":"Sem Papel"}');
      update perfis set admin = true where email = 'marco@nervia.com.br';
      insert into cmp_membros select '00000000-0000-0000-0000-0000000000d1', id, 'solicitante' from cmp_unidades;
      insert into cmp_membros select '00000000-0000-0000-0000-0000000000d2', id, 'comprador' from cmp_unidades;
      insert into cmp_membros select '00000000-0000-0000-0000-0000000000d3', id, 'gerente' from cmp_unidades;
      -- dois fornecedores já cadastrados por outra pessoa (base única)
      insert into cmp_fornecedores (tipo, documento, nome, grupos, certidoes_validade, cadastrado_nome) values
        ('PJ', '22333444000181', 'InfoMais Distribuidora', '{Tecnologia}', current_date + 200, 'Equipe Nervia'),
        ('PJ', '33444555000181', 'Byte Center', '{Tecnologia}', current_date + 200, 'Equipe Nervia');
    """)

def iniciar_api():
    conf = os.path.join(SAIDA, "_postgrest.conf")
    open(conf, "w").write(f'db-uri = "postgres://autenticador:x@localhost:{PG["port"]}/{DB}"\ndb-schemas = "public"\ndb-anon-role = "anon"\n'
                          f'jwt-secret = "{SEGREDO}"\nserver-port = {PORTA_API}\nlog-level = "crit"\n')
    proc = subprocess.Popen([os.environ["POSTGREST"], conf], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try: urllib.request.urlopen(f"http://localhost:{PORTA_API}/"); break
        except Exception: time.sleep(0.2)
    return proc, conf

def token(uid, email):
    return jwt.encode({"sub": uid, "email": email, "role": "authenticated", "aud": "authenticated", "exp": int(time.time()) + 3600}, SEGREDO, algorithm="HS256")

USU = {"admin": ("00000000-0000-0000-0000-0000000000a1", "marco@nervia.com.br"), "solicitante": ("00000000-0000-0000-0000-0000000000d1", "carla@itaipu.com"),
       "comprador": ("00000000-0000-0000-0000-0000000000d2", "rafael@itaipu.com"), "gerente": ("00000000-0000-0000-0000-0000000000d3", "sonia@itaipu.com"),
       "sem": ("00000000-0000-0000-0000-0000000000d4", "sem@x.com")}
CONFIG = f'window.NERVIA_CONFIG={{SUPABASE_URL:"http://127.0.0.1:{PORTA_SITE}",SUPABASE_ANON_KEY:"anon"}};'

def entrar(b, papel, largura=1300):
    uid, email = USU[papel]; t = token(uid, email)
    sessao = {"access_token": t, "refresh_token": "x", "token_type": "bearer", "expires_in": 3600, "expires_at": int(time.time()) + 3600,
              "user": {"id": uid, "email": email, "aud": "authenticated", "role": "authenticated"}}
    ctx = b.new_context(viewport={"width": largura, "height": 900})
    ctx.add_init_script(f"localStorage.setItem('sb-127-auth-token', {json.dumps(json.dumps(sessao))});")
    pg = ctx.new_page(); erros = []
    pg.on("pageerror", lambda e: erros.append(str(e)))
    pg.route("**/config.js", lambda r: r.fulfill(body=CONFIG, content_type="text/javascript"))
    if os.environ.get("SUPABASE_JS"):  # sem acesso ao CDN: usa uma cópia local do supabase-js (mesma versão)
        pg.route("**/supabase-js@*/**", lambda r: r.fulfill(path=os.environ["SUPABASE_JS"], content_type="text/javascript"))
    def api(rota):
        url = rota.request.url.replace(f"http://127.0.0.1:{PORTA_SITE}/rest/v1", f"http://localhost:{PORTA_API}")
        rota.fulfill(response=rota.fetch(url=url))
    pg.route(f"http://127.0.0.1:{PORTA_SITE}/rest/v1/**", api)
    pg.on("dialog", lambda d: d.accept())
    return pg, erros

def abrir(pg):
    pg.goto(f"http://127.0.0.1:{PORTA_SITE}/apps/compras/"); pg.wait_for_selector("#app:not(.oculto), #aviso:not(.oculto)"); pg.wait_for_timeout(300)

def confirmar(pg):
    pg.click("dialog [value=ok]"); pg.wait_for_timeout(500)

def mensagem(pg): return pg.text_content("#msg") if pg.is_visible("#msg") else ""

def ok(cond, nome):
    if not cond: raise SystemExit("FALHOU: " + nome)
    print("ok ", nome)

preparar_banco()
api, conf = iniciar_api()
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORTA_SITE), functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(RAIZ, "site")))
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        # sem papel
        pg, er = entrar(b, "sem"); abrir(pg)
        ok("não tem papel" in pg.text_content("#aviso"), "login sem papel recebe aviso claro")
        # solicitante cria a requisição
        pg, er = entrar(b, "solicitante"); abrir(pg)
        ok("Solicitante" in pg.text_content("#papeis"), "solicitante vê o próprio papel")
        pg.click("[data-acao=novaReq]"); pg.fill("[name=titulo]", "Switch 24 portas PoE"); pg.fill("[name=qtd]", "2"); pg.fill("[name=est]", "12000")
        pg.fill("[name=desc]", "Gerenciável, 4 SFP."); confirmar(pg)
        ok("#1001" in pg.text_content("#tela") and "Requisição criada" in mensagem(pg), "requisição #1001 criada e aberta")
        ok(pg.locator("[data-acao=novaProp]").count() == 0, "solicitante não vê botão de registrar proposta")
        ok(not er, "sem erros de script (solicitante) " + str(er))
        # comprador cadastra fornecedor (CNPJ inválido, duplicado, válido) e cota
        pg, er = entrar(b, "comprador"); abrir(pg)
        pg.click("[data-v=forn]"); pg.wait_for_timeout(200); pg.click("[data-acao=novoForn]")
        pg.fill("[name=doc]", "11.222.333/0001-82"); pg.fill("[name=nome]", "TecnoRede"); confirmar(pg)
        ok("CNPJ inválido" in mensagem(pg), "CNPJ com dígito errado é recusado na tela")
        pg.click("[data-acao=novoForn]"); pg.fill("[name=doc]", "22.333.444/0001-81"); pg.fill("[name=nome]", "Duplicado"); confirmar(pg)
        ok("já está cadastrado: InfoMais" in mensagem(pg), "duplicidade mostra o cadastro existente")
        pg.click("[data-acao=novoForn]"); pg.fill("[name=doc]", "11.222.333/0001-81"); pg.fill("[name=nome]", "TecnoRede Soluções")
        pg.check("[name=g][value=Tecnologia]"); pg.fill("[name=cert]", "2027-12-31"); confirmar(pg)
        ok("responsável pela homologação" in mensagem(pg) and "TecnoRede Soluções" in pg.text_content("#tela"), "comprador cadastra fornecedor e vira responsável")
        pg.click("[data-v=reqs]"); pg.wait_for_timeout(200); pg.click("tr[data-req='1001']"); pg.wait_for_timeout(400)
        for nome, preco, prazo in [("TecnoRede Soluções", "4800", "10"), ("InfoMais Distribuidora", "4500", "25"), ("Byte Center", "4900", "7")]:
            pg.click("[data-acao=novaProp]"); pg.select_option("[name=f]", label=nome); pg.fill("[name=preco]", preco); pg.fill("[name=prazo]", prazo); confirmar(pg)
            ok("Proposta registrada" in mensagem(pg), f"proposta de {nome} registrada")
        tela = pg.text_content("#tela")
        ok("3 de 3 propostas" in tela and "recomendado" in tela and "cadastrado por você" in tela and "Gerente ainda não deu o aval" in tela,
           "mapa comparativo com recomendação, selo do comprador e aviso de aval")
        pg.click("[data-acao=escolher] >> nth=0"); pg.wait_for_timeout(300)
        ok(pg.is_visible("dialog[open]") and "não é o menor preço" in pg.text_content("dialog"), "escolher quem não é o menor pede justificativa")
        pg.fill("[name=j]", "Prazo de 10 dias; o menor preço leva 25."); confirmar(pg)
        ok("justificativa" in mensagem(pg).lower(), "escolha registrada com justificativa")
        pg.click("[data-acao=enviar]"); pg.wait_for_timeout(500)
        ok("Gerente" in mensagem(pg) and "Aguardando aprovação" in pg.text_content("#tela") and "Primeira compra com este fornecedor" in pg.text_content("#tela"),
           "enviada ao Gerente (fornecedor novo, cadastrado pelo comprador)")
        ok(pg.locator("[data-acao=aprovar]").count() == 0, "comprador não vê botão de aprovar")
        pg.screenshot(path=os.path.join(SAIDA, "compras-mapa.png"), full_page=True)
        ok(not er, "sem erros de script (comprador) " + str(er))
        # gerente aprova dando o aval
        pg, er = entrar(b, "gerente"); abrir(pg)
        ok("#1001" in pg.text_content("#tela"), "requisição aparece em 'Esperando você' do Gerente")
        pg.click("tr[data-req='1001']"); pg.wait_for_timeout(400); pg.click("[data-acao=aprovar]")
        ok(pg.is_checked("[name=aval]"), "aprovar oferece dar o aval (marcado)")
        confirmar(pg)
        ok("Aprovada" in mensagem(pg) and "aval do Gerente ✓" in pg.text_content("#tela"), "Gerente aprova e o aval aparece")
        # comprador emite pedido e marca entregue
        pg, er = entrar(b, "comprador"); abrir(pg); pg.click("tr[data-req='1001']"); pg.wait_for_timeout(400)
        pg.click("[data-acao=pedido]"); pg.wait_for_timeout(400); pg.click("[data-acao=entregue]"); pg.wait_for_timeout(400)
        ok("Entregue · avaliar" in pg.text_content("#tela"), "pedido emitido e entregue")
        # gerente avalia
        pg, er = entrar(b, "gerente"); abrir(pg); pg.click("tr[data-req='1001']"); pg.wait_for_timeout(400); pg.click("[data-acao=avaliar]")
        pg.select_option("[name=qualidade]", "4"); pg.fill("dialog [name=c]", "Entregou certo."); confirmar(pg)
        ok("Concluída" in pg.text_content("#tela") and "Avaliação do fornecedor" in pg.text_content("#tela"), "avaliação conclui a compra")
        pg.click("[data-v=forn]"); pg.wait_for_timeout(300)
        ok("4,8 ★" in pg.text_content("#tela"), "nota do fornecedor atualizada (média 4,75 → 4,8)")
        pg.click("[data-v=hist]"); pg.wait_for_timeout(500)
        h = pg.text_content("#histLista")
        ok("avaliado:" in h and "Aprovada pelo Gerente" in h and "Fornecedor cadastrado" in h and "Pedido entregue" in h, "histórico da unidade mostra o caminho todo")
        ok(not er, "sem erros de script (gerente) " + str(er))
        # admin: configuração
        pg, er = entrar(b, "admin"); abrir(pg); pg.click("[data-v=config]"); pg.wait_for_timeout(600)
        ok(pg.locator("#tMembros tr").count() >= 4, "admin vê os papéis da unidade")
        pg.fill("#pPreco", "50"); pg.click("[data-acao=salvarUnidade]"); pg.wait_for_timeout(300)
        ok("somar 100" in mensagem(pg), "pesos que não somam 100 são recusados")
        pg.fill("#pPreco", "40"); pg.fill("#cGer", "30000"); pg.click("[data-acao=salvarUnidade]"); pg.wait_for_timeout(400)
        ok("Regras salvas" in mensagem(pg), "admin altera a alçada do Gerente")
        ok(not er, "sem erros de script (admin) " + str(er))
        # celular
        pg, er = entrar(b, "comprador", largura=390); abrir(pg); pg.click("[data-v=reqs]"); pg.select_option("#fSt", "todas"); pg.click("tr[data-req='1001']"); pg.wait_for_timeout(400)
        larg = pg.evaluate("document.documentElement.scrollWidth")
        ok(larg <= 392, f"celular sem rolagem lateral na página ({larg}px; o mapa rola dentro da própria caixa)")
        pg.screenshot(path=os.path.join(SAIDA, "compras-celular.png"), full_page=True)
        # ajuda
        for arq in ("cartao", "manual"):
            r = pg.goto(f"http://127.0.0.1:{PORTA_SITE}/apps/compras/ajuda/{arq}.html")
            ok(r.status == 200 and pg.evaluate("document.documentElement.scrollWidth") <= 392, f"{arq} abre e cabe no celular")
        b.close()
    print("TODOS OS TESTES DE TELA DE COMPRAS OK")
finally:
    api.terminate(); srv.shutdown(); os.remove(conf)
