"""Teste de ponta a ponta do app Monitor de Links: tela real + banco real (Postgres local com as migrações)
servido pelo PostgREST (o mesmo motor da API do Supabase). Cada papel entra com o próprio login (JWT).

Precisa de: Postgres (PGHOST/PGPORT/PGUSER), o binário do PostgREST (variável POSTGREST, v12+) e Playwright.
Sem internet para o CDN: SUPABASE_JS=caminho do supabase.js (umd) da mesma versão.
Uso: PGHOST=/tmp/pgd PGPORT=5433 PGUSER=postgres POSTGREST=/caminho/postgrest python3 testes/monitor/tela_monitor_test.py [pasta_prints]
"""
import os, sys, json, time, glob, subprocess, threading, http.server, functools, urllib.request
import jwt
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAIDA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, "testes")
PG = dict(host=os.environ.get("PGHOST", "localhost"), port=os.environ.get("PGPORT", "5432"), user=os.environ.get("PGUSER", "postgres"))
DB = "teste_monitor_tela"
SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres!!"
PORTA_API, PORTA_SITE = 3902, 8814

def psql(sql=None, arquivo=None, db=DB):
    cmd = ["psql", "-h", PG["host"], "-p", PG["port"], "-U", PG["user"], "-d", db, "-v", "ON_ERROR_STOP=1", "-q"]
    cmd += ["-f", arquivo] if arquivo else ["-c", sql]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

def preparar_banco():
    psql(f"drop database if exists {DB}", db="postgres"); psql(f"create database {DB}", db="postgres")
    psql(arquivo=os.path.join(RAIZ, "testes", "stubs_supabase.sql"))
    sql = "\n".join(l for f in sorted(glob.glob(os.path.join(RAIZ, "supabase", "migrations", "*.sql")))
                    for l in open(f, encoding="utf-8").read().splitlines() if not l.startswith("create extension"))
    caminho = os.path.join(SAIDA, "_migracoes_monitor.sql"); open(caminho, "w", encoding="utf-8").write(sql)
    psql(arquivo=caminho); os.remove(caminho)
    psql("""do $$ begin create role autenticador login password 'x' noinherit; exception when duplicate_object then null; end $$;
      grant anon, authenticated to autenticador;""")
    psql("""
      insert into auth.users (id, email, raw_user_meta_data) values
        ('00000000-0000-0000-0000-0000000000a1', 'marco@nervia.com.br', '{"nome":"Marco"}'),
        ('00000000-0000-0000-0000-0000000000c1', 'ti@clientea.com', '{"nome":"TI Cliente A"}'),
        ('00000000-0000-0000-0000-0000000000c2', 'ti@clienteb.com', '{"nome":"TI Cliente B"}');
      update perfis set admin = true where email = 'marco@nervia.com.br';
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

USU = {"admin": ("00000000-0000-0000-0000-0000000000a1", "marco@nervia.com.br"), "clienteA": ("00000000-0000-0000-0000-0000000000c1", "ti@clientea.com"),
       "clienteB": ("00000000-0000-0000-0000-0000000000c2", "ti@clienteb.com")}
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
    pg.goto(f"http://127.0.0.1:{PORTA_SITE}/apps/monitor/"); pg.wait_for_selector("#app:not(.oculto), #aviso:not(.oculto)"); pg.wait_for_timeout(300)

def confirmar(pg):
    pg.click("dialog [value=ok]"); pg.wait_for_timeout(500)

def mensagem(pg): return pg.text_content("#msg") if pg.is_visible("#msg") else ""

def ok(cond, nome):
    if not cond: raise SystemExit("FALHOU: " + nome)
    print("ok ", nome)

import re

def roteador(tok, links):
    """Imita o script do MikroTik: POST na rpc, como anon (sem login)."""
    corpo = json.dumps({"p_token": tok, "p_dados": {"v": 1, "ros": "7.16.2 (stable)", "uptime": "3d04:05:06", "cpu": "4", "links": links}}).encode()
    req = urllib.request.Request(f"http://localhost:{PORTA_API}/rpc/mon_registrar", data=corpo, headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req).read())

def passar_tempo(minutos=1):
    psql(f"update mon_equipamentos set ultimo_contato = ultimo_contato - interval '{minutos} minutes'")

preparar_banco()
api, conf = iniciar_api()
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORTA_SITE), functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(RAIZ, "site")))
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        # equipe Nervia cadastra local, equipamento e gera o script
        pg, er = entrar(b, "admin"); abrir(pg)
        ok("Nenhum equipamento cadastrado" in pg.text_content("#tela"), "painel vazio orienta a cadastrar")
        pg.click("[data-v=admin]"); pg.wait_for_timeout(300)
        pg.click("[data-acao=novoLocal]"); pg.fill("[name=nome]", "Matriz"); pg.fill("[name=cliente]", "Cliente A Ltda"); confirmar(pg)
        pg.click("[data-acao=novoLocal]"); pg.fill("[name=nome]", "Filial Norte"); pg.fill("[name=cliente]", "Cliente B Ltda"); confirmar(pg)
        pg.click("[data-acao=novoEquip]"); pg.fill("[name=nome]", "RB Matriz"); pg.fill("[name=modelo]", "hEX RB750Gr3"); pg.select_option("[name=local]", label="Matriz"); confirmar(pg)
        ok("gere o script" in mensagem(pg) and "sem token" in pg.text_content("#tela"), "equipamento cadastrado, ainda sem token")
        pg.click("[data-acao=script]"); pg.fill("[name=links]", "principal=8.8.8.8\nbackup=8.8.8.8"); confirmar(pg)
        ok("host de teste diferente" in mensagem(pg), "recusa o mesmo host de teste em dois links")
        pg.click("[data-acao=script]"); pg.fill("[name=links]", "principal=8.8.8.8\nbackup=1.1.1.1"); pg.select_option("[name=ver]", "6"); confirmar(pg)
        txt = pg.text_content("#scriptTxt")
        tok = re.search(r':local token "([0-9a-f]{64})"', txt).group(1)
        ok('"principal"="8.8.8.8";"backup"="1.1.1.1"' in txt and "type=blackhole" in txt and "/rest/v1/rpc/mon_registrar" in txt and "interval=1m" in txt,
           "script do RouterOS 6 com token, links, rota de bloqueio e agendamento de 1 min")
        ok('\\"k\\":\\"' in txt and "http-method=post" in txt, "JSON montado com aspas escapadas e POST")
        pg.click("dialog [value=cancelar]"); pg.wait_for_timeout(200)
        ok(not er, "sem erros de script (admin) " + str(er))

        # o roteador manda as medições
        r = roteador(tok, [{"k": "principal", "env": 5, "ok": 5, "rtt": "9ms"}, {"k": "backup", "env": 5, "ok": 5, "rtt": "1ms500us"}])
        ok(r.get("ok") and r.get("links") == 2, "rpc aceita o envio do roteador (anon)")
        try: roteador("0" * 64, []); ok(False, "token errado recusado")
        except urllib.error.HTTPError as e: ok(e.code >= 400, "token errado recusado pela API")
        abrir(pg)
        t = pg.text_content("#tela")
        ok("Normais1/1" in re.sub(r"\s", "", t) and "No ar" in t and "9 ms" in t and "1,5 ms" in t, "painel mostra o equipamento normal com latência")
        # link principal cai; backup assume
        for _ in range(3):
            passar_tempo(); roteador(tok, [{"k": "principal", "env": 5, "ok": 0}, {"k": "backup", "env": 5, "ok": 5, "rtt": "20"}])
        abrir(pg); t = pg.text_content("#tela")
        ok("Em backup" in t and "Caído" in t and "Quedasemaberto1" in re.sub(r"\s", "", t), "queda do principal: 'Em backup' e queda em aberto")
        psql("update mon_quedas set inicio = now() - interval '45 minutes'")
        passar_tempo(); roteador(tok, [{"k": "principal", "env": 5, "ok": 5, "rtt": "10"}, {"k": "backup", "env": 5, "ok": 2, "rtt": "400"}])
        abrir(pg); t = pg.text_content("#tela")
        ok("Instável" in t and "Normais0/1" in re.sub(r"\s", "", t), "volta do principal; backup com perda fica instável")
        pg.click("[data-equip]"); pg.wait_for_timeout(500)
        t = pg.text_content("#tela")
        ok("Latência — últimas 24 h" in t and pg.locator("svg.graf").count() == 2 and "45 min" in t, "detalhe com gráfico de 24 h e a queda de 45 min")
        pg.click("[data-acao=obsQueda]"); pg.fill("dialog [name=o]", "Protocolo 123 na operadora"); confirmar(pg)
        ok("Protocolo 123" in pg.text_content("#tela"), "equipe anota a queda")
        # some (vigia)
        psql("update mon_equipamentos set ultimo_contato = now() - interval '10 minutes'; select mon_verificar();")
        abrir(pg)
        ok("Sem contato" in pg.text_content("#tela"), "roteador calado vira 'Sem contato'")
        passar_tempo(); roteador(tok, [{"k": "principal", "env": 5, "ok": 5, "rtt": "10"}, {"k": "backup", "env": 5, "ok": 5, "rtt": "12"}])
        # links: dar nome e meta
        pg.click("[data-v=admin]"); pg.wait_for_timeout(400)
        pg.click("[data-acao=editLink] >> text=principal"); pg.fill("[name=nome]", "Principal"); pg.fill("[name=op]", "Operadora X"); pg.fill("[name=ct]", "Fibra 500 Mb"); pg.fill("[name=sla]", "99.9"); confirmar(pg)
        ok("Link salvo" in mensagem(pg), "equipe dá nome, operadora e meta ao link")
        # acesso do cliente A só à Matriz
        pg.click("[data-acao=acessos] >> nth=0"); pg.wait_for_timeout(300)
        nome_local = pg.text_content("dialog h3")
        pg.check("dialog input[value='00000000-0000-0000-0000-0000000000c1']"); confirmar(pg)
        ok("Acessos atualizados" in mensagem(pg) and "Filial" in nome_local, "acesso liberado (primeiro local da lista = Filial Norte)")
        # corrige: cliente A deve ver a Matriz
        pg.click("[data-acao=acessos] >> nth=0"); pg.wait_for_timeout(300); pg.uncheck("dialog input[value='00000000-0000-0000-0000-0000000000c1']"); confirmar(pg)
        pg.click("[data-acao=acessos] >> nth=1"); pg.wait_for_timeout(300); pg.check("dialog input[value='00000000-0000-0000-0000-0000000000c1']"); confirmar(pg)
        pg.wait_for_timeout(400)
        ok("ti@clientea.com" in pg.text_content("#tela"), "cliente A liberado na Matriz")
        # relatório
        psql("update mon_equipamentos set criado_em = now() - interval '2 days'")  # monitorando há 2 dias: 45 min fora = 98,4%
        pg.click("[data-v=relatorio]"); pg.wait_for_timeout(300); pg.select_option("#rLocal", label="Matriz"); pg.wait_for_timeout(800)
        t = pg.text_content("#tela")
        ok("Disponibilidade" in t and "Principal" in t and "Operadora X" in t and "meta do contrato 99,90%" in t and "Abaixo da meta" in t and "45 min" in t, "relatório mensal com disponibilidade abaixo da meta (queda de 45 min)")
        pg.screenshot(path=os.path.join(SAIDA, "monitor-relatorio.png"), full_page=True)
        ok(not er, "sem erros de script (admin) " + str(er))

        # cliente A vê só a Matriz; cliente B nada
        pg, er = entrar(b, "clienteA"); abrir(pg); t = pg.text_content("body")
        ok("RB Matriz" in t and "Filial" not in t and pg.locator("#abaAdmin.oculto").count() == 1, "cliente A vê só o seu local e não vê Equipamentos")
        pg.screenshot(path=os.path.join(SAIDA, "monitor-painel.png"), full_page=True)
        pg.click("[data-v=quedas]"); pg.wait_for_timeout(300)
        ok("Protocolo 123" in pg.text_content("#tela") and pg.locator("[data-acao=obsQueda]").count() == 0, "cliente vê as quedas e a anotação, sem editar")
        ok(not er, "sem erros de script (cliente) " + str(er))
        pg, er = entrar(b, "clienteB"); abrir(pg)
        ok("Nenhum local liberado" in pg.text_content("#aviso"), "cliente sem local recebe aviso claro")
        # celular
        pg, er = entrar(b, "clienteA", largura=390); abrir(pg); pg.click("[data-equip]"); pg.wait_for_timeout(500)
        larg = pg.evaluate("document.documentElement.scrollWidth")
        ok(larg <= 392, f"celular sem rolagem lateral ({larg}px)")
        pg.screenshot(path=os.path.join(SAIDA, "monitor-celular.png"), full_page=True)
        for arq in ("cartao", "manual"):
            r = pg.goto(f"http://127.0.0.1:{PORTA_SITE}/apps/monitor/ajuda/{arq}.html")
            ok(r.status == 200 and pg.evaluate("document.documentElement.scrollWidth") <= 392, f"{arq} abre e cabe no celular")
        b.close()
    print("TODOS OS TESTES DE TELA DO MONITOR OK")
finally:
    api.terminate(); srv.shutdown(); os.remove(conf)
