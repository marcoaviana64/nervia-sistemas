"""Teste de ponta a ponta do Sistema Linum (Estoque): tela real + banco real (Postgres local com as migrações) servido pelo
PostgREST (o mesmo motor da API do Supabase). Produtos FICTÍCIOS (catálogo montado aqui, não os dados da Linum).

Precisa de: Postgres (PGHOST/PGPORT/PGUSER), o binário do PostgREST (variável POSTGREST, v12+) e Playwright.
Sem internet para o CDN: SUPABASE_JS=caminho do supabase.js (umd) da mesma versão.
Uso: PGHOST=/tmp/pgd PGPORT=5433 PGUSER=postgres POSTGREST=/caminho/postgrest python3 testes/linum/tela_linum_test.py [pasta_prints]
"""
import os, sys, json, time, glob, subprocess, threading, http.server, functools, urllib.request
import jwt
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAIDA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, "testes")
PG = dict(host=os.environ.get("PGHOST", "localhost"), port=os.environ.get("PGPORT", "5432"), user=os.environ.get("PGUSER", "postgres"))
DB = "teste_linum_tela"
SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres!!"
PORTA_API, PORTA_SITE = 3905, 8817

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
    caminho = os.path.join(SAIDA, "_migracoes_linum.sql"); open(caminho, "w", encoding="utf-8").write(sql)
    psql(arquivo=caminho); os.remove(caminho)
    psql("""do $$ begin create role autenticador login password 'x' noinherit; exception when duplicate_object then null; end $$;
      grant anon, authenticated to autenticador;""")
    psql("""
      insert into auth.users (id, email, raw_user_meta_data) values
        ('00000000-0000-0000-0000-0000000000a1', 'marco@nervia.com.br', '{"nome":"Marco"}'),
        ('00000000-0000-0000-0000-0000000000d1', 'dona@linum.exemplo', '{"nome":"Dona Linum"}'),
        ('00000000-0000-0000-0000-0000000000b1', 'vendedora@linum.exemplo', '{"nome":"Vera Vendedora"}'),
        ('00000000-0000-0000-0000-0000000000c2', 'outro@x.exemplo', '{"nome":"Outro"}'),
        ('00000000-0000-0000-0000-0000000000e1', 'estoque@linum.exemplo', '{"nome":"Edu Estoque"}');
      update perfis set admin = true where email = 'marco@nervia.com.br';
      insert into app_acessos values ('00000000-0000-0000-0000-0000000000d1', 'linum'), ('00000000-0000-0000-0000-0000000000b1', 'linum'), ('00000000-0000-0000-0000-0000000000e1', 'linum');
      insert into lin_produtos (id, referencia, descricao, categoria, preco_custo, preco_venda) values
        ('10000000-0000-0000-0000-000000000001', 'VES-MAR', 'Vestido Mar', 'Vestido', 151.23, 489),
        ('10000000-0000-0000-0000-000000000002', 'CAL-ARE', 'Calça Areia', 'Calça', 92.11, 359),
        ('10000000-0000-0000-0000-000000000003', 'CAM-BRI', 'Camisa Brisa', 'Camisa', 70, 299);
      insert into lin_variantes (id, produto_id, cor, tamanho) values
        ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Azul', 'P'),
        ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Azul', 'M'),
        ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Off White', 'M'),
        ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Azul', 'G'),
        ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'Cru', '38'),
        ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002', 'Cru', '40'),
        ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000003', 'Branco', 'U');
      insert into lin_variantes (id, produto_id, cor, tamanho, edicao, preco_venda) values
        ('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000002', 'Cru', '40', 'Bordada', 590);
      insert into lin_estoque select '20000000-0000-0000-0000-000000000008', id, 1 from lin_lojas where nome = 'Gávea';
      insert into lin_estoque select v, (select id from lin_lojas where nome = 'Gávea'), q from (values
        ('20000000-0000-0000-0000-000000000001'::uuid, 3), ('20000000-0000-0000-0000-000000000002'::uuid, 1),
        ('20000000-0000-0000-0000-000000000004'::uuid, 2), ('20000000-0000-0000-0000-000000000005'::uuid, 4)) x(v, q);
      insert into lin_estoque select '20000000-0000-0000-0000-000000000003', id, 2 from lin_lojas where nome = 'Ipanema';
    """)

def iniciar_api():
    conf = os.path.join(SAIDA, "_postgrest_linum.conf")
    open(conf, "w").write(f'db-uri = "postgres://autenticador:x@localhost:{PG["port"]}/{DB}"\ndb-schemas = "public"\ndb-anon-role = "anon"\n'
                          f'jwt-secret = "{SEGREDO}"\nserver-port = {PORTA_API}\nlog-level = "crit"\n')
    proc = subprocess.Popen([os.environ["POSTGREST"], conf], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try: urllib.request.urlopen(f"http://localhost:{PORTA_API}/"); break
        except Exception: time.sleep(0.2)
    return proc, conf

def token(uid, email):
    return jwt.encode({"sub": uid, "email": email, "role": "authenticated", "aud": "authenticated", "exp": int(time.time()) + 3600}, SEGREDO, algorithm="HS256")

USU = {"admin": ("00000000-0000-0000-0000-0000000000a1", "marco@nervia.com.br"), "dono": ("00000000-0000-0000-0000-0000000000d1", "dona@linum.exemplo"),
       "vendedora": ("00000000-0000-0000-0000-0000000000b1", "vendedora@linum.exemplo"), "outro": ("00000000-0000-0000-0000-0000000000c2", "outro@x.exemplo"),
       "estoque": ("00000000-0000-0000-0000-0000000000e1", "estoque@linum.exemplo")}
CONFIG = f'window.NERVIA_CONFIG={{SUPABASE_URL:"http://127.0.0.1:{PORTA_SITE}",SUPABASE_ANON_KEY:"anon"}};'

def entrar(b, papel, largura=1300):
    uid, email = USU[papel]; t = token(uid, email)
    sessao = {"access_token": t, "refresh_token": "x", "token_type": "bearer", "expires_in": 3600, "expires_at": int(time.time()) + 3600,
              "user": {"id": uid, "email": email, "aud": "authenticated", "role": "authenticated"}}
    ctx = b.new_context(viewport={"width": largura, "height": 900})
    ctx.add_init_script(f"localStorage.setItem('sb-127-auth-token', {json.dumps(json.dumps(sessao))});")
    ctx.route("**/config.js", lambda r: r.fulfill(body=CONFIG, content_type="text/javascript"))
    if os.environ.get("SUPABASE_JS"):
        ctx.route("**/supabase-js@*/**", lambda r: r.fulfill(path=os.environ["SUPABASE_JS"], content_type="text/javascript"))
    respostas = []
    def api(rota):
        url = rota.request.url.replace(f"http://127.0.0.1:{PORTA_SITE}/rest/v1", f"http://localhost:{PORTA_API}")
        r = rota.fetch(url=url); respostas.append(r.text()); rota.fulfill(response=r)
    ctx.route(f"http://127.0.0.1:{PORTA_SITE}/rest/v1/**", api)
    pg = ctx.new_page(); erros = []
    pg.on("pageerror", lambda e: erros.append(str(e)))
    pg.respostas = respostas
    return pg, erros

def abrir(pg, rota="/apps/linum/"):
    pg.goto(f"http://127.0.0.1:{PORTA_SITE}{rota}"); pg.wait_for_selector("#app:not(.oculto), #aviso:not(.oculto)"); pg.wait_for_timeout(400)

def ok(cond, nome):
    if not cond: raise SystemExit("FALHOU: " + nome)
    print("ok ", nome)

def chips(pg): return pg.eval_on_selector_all(".prod .loja", "cs => cs.map(c => c.closest('.prod').querySelector('h2').textContent + ' @ ' + c.querySelector('.selo').textContent + ': ' + [...c.querySelectorAll('.chip')].map(x => x.querySelector('b').textContent + ' ' + x.querySelector('small').textContent + '=' + x.querySelector('strong').textContent).join(', '))")
def qtd_banco(var, loja): return int(psql(f"select coalesce((select quantidade from lin_estoque where variante_id = '{var}' and loja_id = (select id from lin_lojas where nome = '{loja}')), 0)", saida=True))
V_AZUL_P, V_AZUL_M, V_OFF_M, V_CRU_38 = "20000000-0000-0000-0000-000000000001", "20000000-0000-0000-0000-000000000002", "20000000-0000-0000-0000-000000000003", "20000000-0000-0000-0000-000000000005"

def loja_id(nome): return psql(f"select id from lin_lojas where nome = '{nome}'", saida=True)
def chip(pg, var, loja): return pg.locator(f'button.chip[data-v="{var}"][data-l="{loja_id(loja)}"]')

def salvar_mov(pg, tipo, qtd, obs="", destino=None):
    pg.click(f'#dlgf [data-g="tipo"][data-x="{tipo}"]')
    if destino: pg.click(f'#dlgf [data-g="destino"]:has-text("{destino}")')
    pg.fill("#mq", str(qtd)); pg.fill("#mo", obs); pg.click("#ms"); pg.wait_for_timeout(700)

preparar_banco()
api, conf = iniciar_api()
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORTA_SITE), functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(RAIZ, "site")))
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        b = p.chromium.launch()

        # ---------------------------------------------------------------- login sem papel ainda (dono antes da equipe)
        pg, erros = entrar(b, "dono"); abrir(pg)
        ok("não tem acesso ao Sistema Linum" in pg.text_content("#aviso"), "login com o app mas sem papel: mensagem clara")

        # ---------------------------------------------------------------- equipe Nervia define os papéis
        pg, erros = entrar(b, "admin"); abrir(pg)
        ok(pg.is_visible("#abaEquipe") and "Equipe Nervia" in pg.text_content("#quem"), "admin vê a aba Equipe")
        pg.click("#abaEquipe"); pg.wait_for_selector(".eq-salvar")
        linhas = pg.eval_on_selector_all("table tbody tr", "ts => ts.map(t => t.textContent)")
        ok(len(linhas) == 3 and not any("outro@x" in l for l in linhas), "equipe lista só os logins com o app liberado")
        i_dono = next(i for i, l in enumerate(linhas) if "dona@linum" in l); i_vend = next(i for i, l in enumerate(linhas) if "vendedora@linum" in l)
        i_est = next(i for i, l in enumerate(linhas) if "estoque@linum" in l)
        pg.select_option(f'.eq-papel[data-i="{i_dono}"]', "dono"); pg.click(f'.eq-salvar[data-i="{i_dono}"]'); pg.wait_for_timeout(600)
        pg.select_option(f'.eq-papel[data-i="{i_vend}"]', "vendedora"); pg.click(f'.eq-salvar[data-i="{i_vend}"]'); pg.wait_for_timeout(600)
        ok("salvo" in pg.text_content("#msg") and psql("select comissao_pct from lin_membros where papel = 'vendedora'", saida=True) == "0.00",
           "vendedora sem loja principal é aceita (vende em qualquer loja), comissão 0% até definir")
        pg.select_option(f'.eq-papel[data-i="{i_vend}"]', "vendedora"); pg.select_option(f'.eq-loja[data-i="{i_vend}"]', label="Ipanema")
        pg.fill(f'.eq-comissao[data-i="{i_vend}"]', "3,5")
        pg.click(f'.eq-salvar[data-i="{i_vend}"]'); pg.wait_for_timeout(600)
        pg.select_option(f'.eq-papel[data-i="{i_est}"]', "estoque"); pg.click(f'.eq-salvar[data-i="{i_est}"]'); pg.wait_for_timeout(600)
        ok(psql("select string_agg(papel || ':' || coalesce((select nome from lin_lojas where id = loja_id), '-'), ',' order by papel) from lin_membros", saida=True) == "dono:-,estoque:-,vendedora:Ipanema",
           "papéis gravados (dono; estoque; vendedora da Ipanema)")
        ok(int(psql("select count(*) from auditoria where acao = 'linum_papel_definido'", saida=True)) == 4, "papéis na auditoria")
        ok(psql("select string_agg(papel || ':' || comissao_pct, ',' order by papel) from lin_membros", saida=True) == "dono:0.00,estoque:0.00,vendedora:3.50",
           "comissão em % gravada pela Equipe (vendedora 3,5%; os outros 0%)")
        pg.screenshot(path=os.path.join(SAIDA, "linum_equipe.png"), full_page=True)
        ok(not erros, "sem erros de JavaScript (admin)")

        # ---------------------------------------------------------------- dono: consulta
        pg, erros = entrar(b, "dono"); abrir(pg)
        ok(not pg.is_visible("#abaEquipe") and pg.text_content("#quem") == "Dono", "dono não vê a aba Equipe")
        c = chips(pg)
        ok(c == ["Calça Areia @ Gávea: Cru 38=4 un., Cru 40 · Bordada=1 un.", "Vestido Mar @ Gávea: Azul P=3 un., Azul M=1 un., Azul G=2 un.", "Vestido Mar @ Ipanema: Off White M=2 un."],
           "uma faixa por loja, tamanhos na ordem P M G, zerados ocultos")
        ok(pg.locator(".prod").count() == 2 and pg.locator('.prod:has-text("Vestido Mar") .loja').count() == 2
           and pg.evaluate("getComputedStyle(document.querySelectorAll('.prod')[1].querySelectorAll('.loja')[1]).borderTopStyle") == "dashed",
           "a mesma peça num cartão só, lojas separadas por linha tracejada")
        ok(pg.text_content("#resumo").startswith("2 produto(s) · 13 peça(s)"), "resumo de produtos e peças")
        ok("R$ 590,00" in pg.text_content(".prod >> nth=0").replace("\xa0", " "), "peça especial (edição) com preço próprio no quadrado")
        ok(pg.locator(".chip.esp").count() == 1 and "Bordada" in pg.get_attribute(".chip.esp", "title")
           and pg.evaluate("getComputedStyle(document.querySelector('.chip.esp b'), '::before').content") == '"★"'
           and pg.locator("h2.temesp").count() == 1 and "Calça Areia" in pg.text_content("h2.temesp"),
           "estrela dourada só na peça especial e no nome do produto que tem especial")
        ok(pg.locator(".prod").nth(1).locator(".sep").count() == 2, "traço entre tamanhos diferentes")
        ok("R$ 489,00" in pg.text_content(".prod >> nth=1").replace("\xa0", " "), "preço de venda no cartão")
        pg.click("#fzero"); pg.wait_for_timeout(200)
        ok(pg.locator(".chip.zero").count() > 0 and any("Camisa Brisa" in x for x in chips(pg)), "ocultar zerados inativo: zerados em vermelho e produto sem peça aparece")
        pg.click("#fzero"); pg.fill("#fq", "cal"); pg.wait_for_timeout(200)
        ok(len(chips(pg)) == 1 and chips(pg)[0].startswith("Calça Areia @ Gávea"), "busca por nome")
        pg.fill("#fq", "ves-m"); pg.wait_for_timeout(200)
        ok(len(chips(pg)) == 2, "busca por referência")
        pg.fill("#fq", ""); pg.select_option("#floja", label="Ipanema"); pg.wait_for_timeout(200)
        ok(chips(pg) == ["Vestido Mar @ Ipanema: Off White M=2 un."] and "em Ipanema" in pg.text_content("#resumo"), "filtro por loja")
        pg.select_option("#floja", ""); pg.select_option("#ftam", "M"); pg.wait_for_timeout(200)
        ok(chips(pg) == ["Vestido Mar @ Gávea: Azul M=1 un.", "Vestido Mar @ Ipanema: Off White M=2 un."], "filtro por tamanho")
        pg.select_option("#ftam", ""); pg.select_option("#fcor", "Cru"); pg.wait_for_timeout(200)
        ok(len(chips(pg)) == 1 and chips(pg)[0].startswith("Calça Areia @ Gávea"), "filtro por cor")
        pg.select_option("#fcor", ""); pg.select_option("#fcat", "Vestido"); pg.wait_for_timeout(200)
        ok(len(chips(pg)) == 2, "filtro por categoria"); pg.select_option("#fcat", "")
        pg.screenshot(path=os.path.join(SAIDA, "linum_estoque_dono.png"), full_page=True)

        # ---------------------------------------------------------------- dono: movimentar
        chip(pg, V_AZUL_P, "Gávea").click(); pg.wait_for_selector("#dlg[open]"); pg.wait_for_timeout(500)
        ok("Vestido Mar — Azul P" in pg.text_content("#dlgf h3") and "Gávea (3)" in pg.text_content("#dlgf") and "Nenhuma movimentação" in pg.text_content(".hist"),
           "movimentação abre com a variação, a quantidade por loja e o histórico vazio")
        salvar_mov(pg, "entrada", 5, "chegada da fábrica")
        ok(not pg.is_visible("#dlg") and "Estoque atualizado" in pg.text_content("#msg") and qtd_banco(V_AZUL_P, "Gávea") == 8, "entrada soma na loja")
        ok("Azul P=8 un." in " ".join(chips(pg)), "tela atualizada depois da entrada")
        chip(pg, V_AZUL_P, "Gávea").click(); pg.wait_for_selector("#dlg[open]"); pg.wait_for_timeout(500)
        salvar_mov(pg, "saida", 20, "perda")
        ok(pg.is_visible("#dlg") and "Estoque insuficiente: a loja tem 8" in pg.text_content("#dlgf .msg.err"), "saída maior que o estoque: erro dentro do formulário")
        salvar_mov(pg, "saida", 0)
        ok("maior que zero" in pg.text_content("#dlgf .msg.err"), "quantidade zero barrada na tela")
        salvar_mov(pg, "transferencia", 3, "para a vitrine", destino="Ipanema")
        ok(qtd_banco(V_AZUL_P, "Gávea") == 5 and qtd_banco(V_AZUL_P, "Ipanema") == 3, "transferência entre lojas")
        ok("Vestido Mar @ Ipanema: Azul P=3 un., Off White M=2 un." in chips(pg), "cartão da loja de destino atualizado")
        chip(pg, V_OFF_M, "Ipanema").click(); pg.wait_for_selector("#dlg[open]"); pg.wait_for_timeout(500)
        pg.click('#dlgf [data-g="tipo"][data-x="ajuste"]')
        ok(pg.input_value("#mq") == "2" and "Nova quantidade" in pg.text_content("#dlgf"), "ajuste começa com a quantidade atual")
        salvar_mov(pg, "ajuste", 0, "contagem de outubro")
        ok(qtd_banco(V_OFF_M, "Ipanema") == 0 and not any("Off White" in x for x in chips(pg)), "ajuste para zero some da lista (ocultar zerados)")
        ok(psql("select antes || '>' || depois || ' ' || observacao || ' ' || criado_nome from lin_movimentos where tipo = 'ajuste'", saida=True) == "2>0 contagem de outubro Dona Linum",
           "ajuste no histórico com antes, depois, motivo e quem fez")
        chip(pg, V_AZUL_P, "Gávea").click(); pg.wait_for_selector("#dlg[open]"); pg.wait_for_timeout(700)
        h = pg.text_content(".hist")
        ok("Transferência 3 · Gávea → Ipanema · para a vitrine · Dona Linum" in h and "Entrada 5 · Gávea · chegada da fábrica" in h, "últimas movimentações da variação")
        pg.screenshot(path=os.path.join(SAIDA, "linum_movimentar.png"))
        pg.click("#mx")
        ok(int(psql("select count(*) from lin_movimentos", saida=True)) == 3, "só as movimentações válidas foram gravadas")
        ok(not erros, "sem erros de JavaScript (dono)")

        # ---------------------------------------------------------------- dono: produtos
        psql("insert into lin_codigos values (extract(year from now() at time zone 'America/Sao_Paulo')::int, 235) on conflict (ano) do update set ultimo = 235")
        pg.on("dialog", lambda d: d.accept())
        pg.click("#abaProdutos"); pg.wait_for_selector("#plista")
        ok("3 peças cadastradas" in pg.text_content("#ptotal") and "custo R$" in pg.text_content("#plista").replace("\xa0", " "), "aba Produtos lista o catálogo com custo (Dono)")
        pg.fill("#pq", "ves-mar"); pg.wait_for_timeout(150)
        ok(pg.locator("#plista .prod").count() == 1, "busca de produtos por referência"); pg.fill("#pq", "")
        pg.click("#pnovo"); pg.wait_for_selector("#dlg[open]")
        for k, v in {"referencia": "SAI-DUN", "descricao": "Saia Duna", "categoria": "Saia", "fornecedor": "Ateliê Fictício", "preco_custo": "80,50", "preco_venda": "1.299,90"}.items():
            pg.fill(f"#pf_{k}", v)
        ok(pg.input_value("#nv_t") == "PP, P, M, G, GG, G1, G2", "cadastro já vem com a grade de tamanhos da Linum")
        pg.fill("#nv_c", "Areia, Preto"); pg.fill("#nv_t", "P, M"); pg.click("#pfs"); pg.wait_for_timeout(900)
        ok("Produto cadastrado; 4 variação(ões) nova(s)." in pg.text_content("#dlgf .msg.ok"), "novo produto com cores × tamanhos")
        ok(psql("select preco_venda || ' ' || preco_custo || ' ' || codigo_barras from lin_produtos where referencia = 'SAI-DUN'", saida=True).endswith("0000236")
           and psql("select preco_venda || ' ' || preco_custo from lin_produtos where referencia = 'SAI-DUN'", saida=True) == "1299.90 80.50",
           "preços com vírgula gravados certo e código de barras automático")
        pg.fill('#dlgf [data-e="cor"]', "Areia"); pg.fill('#dlgf [data-e="tamanho"]', "M"); pg.fill('#dlgf [data-e="edicao"]', "Bordada"); pg.fill('#dlgf [data-e="preco_venda"]', "1.590,00")
        pg.click("#espadd"); pg.wait_for_timeout(800)
        ok("Peça especial acrescentada" in pg.text_content("#dlgf") and psql("select preco_venda || ' ' || (codigo_barras like '%0000237') from lin_variantes where edicao = 'Bordada' and cor = 'Areia'", saida=True) == "1590.00 true",
           "peça especial com preço e código próprios")
        # várias cores e tamanhos de uma vez (pedido do Marco: a A34 virou um registro só com "PP, P, M, G, GG")
        pg.fill('#dlgf [data-e="cor"]', "Natural Bordado"); pg.fill('#dlgf [data-e="tamanho"]', "PP, P, M"); pg.fill('#dlgf [data-e="edicao"]', "Bordada a mão"); pg.fill('#dlgf [data-e="preco_venda"]', "999,00")
        pg.click("#espadd"); pg.wait_for_timeout(1500)   # o confirm é aceito pelo pg.on("dialog") do teste
        ok("3 peças especiais acrescentadas" in pg.text_content("#dlgf")
           and psql("select string_agg(tamanho || '=' || preco_venda, ',' order by tamanho) || ' ' || count(distinct codigo_barras) from lin_variantes where edicao = 'Bordada a mão'", saida=True) == "M=999.00,P=999.00,PP=999.00 3",
           "peça especial com vários tamanhos: uma por tamanho, mesmo preço, códigos próprios")
        # 2.11: corrigir a cor digitada errado (pedido do Marco: "Natural Bordado" → "Natural")
        vpp = psql("select id from lin_variantes where edicao = 'Bordada a mão' and tamanho = 'PP'", saida=True)
        pg.click(f'[data-veditar="{vpp}"]'); pg.wait_for_selector('#dlgf [data-x="cor"]')
        pg.fill('#dlgf [data-x="cor"]', "Natural"); pg.click(f'[data-vsalvar="{vpp}"]'); pg.wait_for_timeout(900)
        ok("Variação atualizada" in pg.text_content("#dlgf") and psql(f"select cor || ' ' || tamanho || ' ' || preco_venda from lin_variantes where id = '{vpp}'", saida=True) == "Natural PP 999.00",
           "Editar corrige a cor da variação")
        pg.click(f'[data-veditar="{vpp}"]'); pg.wait_for_selector('#dlgf [data-x="tamanho"]')
        pg.fill('#dlgf [data-x="tamanho"]', "PP, P"); pg.click(f'[data-vsalvar="{vpp}"]'); pg.wait_for_timeout(900)
        ok("sem vírgula" in pg.text_content("#dlgf .msg.err"), "Editar recusa dois tamanhos numa variação")
        pg.click('#dlgf [data-vcancel]'); pg.wait_for_timeout(300)
        vid = psql("select id from lin_variantes v where cor = 'Preto' and tamanho = 'P' and produto_id = (select id from lin_produtos where referencia = 'SAI-DUN')", saida=True)
        pg.click(f'[data-vativo="{vid}"]'); pg.wait_for_timeout(700)
        ok(psql(f"select ativo from lin_variantes where id = '{vid}'", saida=True) == "f" and "inativa" in pg.text_content("#dlgf"), "desativar variação")
        pg.click(f'[data-vexcluir="{vid}"]'); pg.wait_for_timeout(700)
        ok(psql(f"select count(*) from lin_variantes where id = '{vid}'", saida=True) == "0", "excluir variação sem histórico")
        pg.screenshot(path=os.path.join(SAIDA, "linum_produto.png"), full_page=True)
        pg.fill("#pf_referencia", "ves-mar"); pg.click("#pfs"); pg.wait_for_timeout(600)
        ok("Já existe um produto com a referência" in pg.text_content("#dlgf .msg.err"), "referência repetida: erro no formulário")
        pg.click("#pfx"); pg.wait_for_timeout(300)
        ok(pg.locator("#plista .prod").count() == 4 and "Saia Duna" in pg.text_content("#plista"), "lista atualizada ao fechar")
        pg.click('[data-ex="10000000-0000-0000-0000-000000000001"]'); pg.wait_for_timeout(600)
        ok("não pode ser excluída" in pg.text_content("#msg"), "peça com movimentação não se exclui")
        pg.click('.barra [data-v="estoque"]'); pg.click("#fzero"); pg.fill("#fq", "duna"); pg.wait_for_timeout(300)
        ok(any("Saia Duna @ Gávea" in x and "Areia M · Bordada=0 un." in x for x in chips(pg)), "produto novo aparece no estoque para lançar as quantidades")
        # 2.15: produto sem referência = provisória NOVA-…, com filtro no Estoque e em Produtos
        pg.click("#abaProdutos"); pg.wait_for_selector("#plista"); pg.click("#pnovo"); pg.wait_for_selector("#dlg[open]")
        ok("provisória" in (pg.get_attribute("#pf_referencia", "placeholder") or ""), "referência vazia explicada no campo")
        pg.fill("#pf_descricao", "Blusa Sem Ref"); pg.fill("#nv_c", "Cru"); pg.fill("#nv_t", "M"); pg.click("#pfs"); pg.wait_for_timeout(900)
        ok("Referência provisória NOVA-" in pg.text_content("#dlgf .msg.ok"), "produto sem referência recebe a provisória")
        ok(pg.input_value("#pf_referencia").startswith("NOVA-"), "a referência provisória aparece no campo depois de salvar")
        pg.fill("#nv_c", "Azul"); pg.fill("#nv_t", "M"); pg.click("#pfs"); pg.wait_for_timeout(900)
        ok("Produto atualizado; 1 variação(ões) nova(s)." in pg.text_content("#dlgf .msg.ok"), "salvar de novo (mais cores) não reclama da referência")
        pg.click("#pfx"); pg.wait_for_timeout(300); pg.click("#pprov"); pg.wait_for_timeout(200)
        ok(pg.locator("#plista .prod").count() == 1 and "ref. provisória" in pg.text_content("#plista"), "filtro Referência provisória em Produtos")
        pg.click("#pprov"); pg.click('.barra [data-v="estoque"]'); pg.fill("#fq", ""); pg.click("#fprov"); pg.wait_for_timeout(300)
        ok(pg.locator("#lista .prod").count() == 1 and "Blusa Sem Ref" in pg.text_content("#lista") and "provisória" in pg.text_content("#lista"), "filtro Referência provisória no Estoque")
        pg.click("#fprov"); pg.wait_for_timeout(200)
        psql("delete from lin_estoque where variante_id in (select v.id from lin_variantes v join lin_produtos p on p.id = v.produto_id where p.descricao = 'Blusa Sem Ref'); "
             "delete from lin_variantes where produto_id in (select id from lin_produtos where descricao = 'Blusa Sem Ref'); delete from lin_produtos where descricao = 'Blusa Sem Ref'")
        ok(not erros, "sem erros de JavaScript (produtos)")

        # ---------------------------------------------------------------- papel Estoque: cadastra e movimenta, sem custo
        pg, erros = entrar(b, "estoque"); abrir(pg)
        ok(pg.text_content("#quem") == "Estoque · sem custos" and pg.is_visible("#abaProdutos") and pg.is_visible("#abaVendas") and not pg.is_visible("#abaEquipe"), "Estoque vê Produtos, Estoque e Vendas, sem Equipe")
        ok(chip(pg, V_AZUL_P, "Gávea").count() == 1, "Estoque clica no quadrado para movimentar")
        chip(pg, V_AZUL_P, "Gávea").click(); pg.wait_for_selector("#dlg[open]"); pg.wait_for_timeout(600)
        ok("Dona Linum" in pg.text_content(".hist"), "Estoque vê o histórico da variação")
        salvar_mov(pg, "entrada", 2, "reposição")
        ok(qtd_banco(V_AZUL_P, "Gávea") == 7, "Estoque faz entrada")
        pg.click("#abaProdutos"); pg.wait_for_selector("#plista")
        ok("custo" not in pg.text_content("#plista").lower() and pg.locator(".prod").count() == 4, "lista de produtos sem custo")
        pg.click('[data-ed="10000000-0000-0000-0000-000000000001"]'); pg.wait_for_selector("#dlg[open]")
        ok(pg.locator("#pf_preco_custo").count() == 0 and "custo" not in pg.text_content("#dlgf").lower().replace("custódia", ""), "cadastro aberto pelo Estoque sem campo de custo")
        pg.fill("#pf_preco_venda", "499,00"); pg.click("#pfs"); pg.wait_for_timeout(800)
        ok(psql("select preco_venda || ' ' || preco_custo from lin_produtos where id = '10000000-0000-0000-0000-000000000001'", saida=True) == "499.00 151.23",
           "Estoque altera o preço de venda e o custo continua o do Dono")
        pg.click("#pfx")
        ok(not any("151.23" in r or "preco_custo" in r for r in pg.respostas), "Estoque não recebe custo do servidor")
        ok(psql("select count(*) from auditoria where acao in ('linum_estoque_entrada', 'linum_produto_alterado') and detalhes->>'papel_linum' = 'estoque'", saida=True) == "2",
           "ações do Estoque na auditoria")
        ok(not erros, "sem erros de JavaScript (estoque)")

        # ---------------------------------------------------------------- vendedora: só consulta, sem custo
        pg, erros = entrar(b, "vendedora"); abrir(pg)
        ok(not pg.is_visible("#abaProdutos"), "vendedora não vê a aba Produtos")
        ok(pg.text_content("#quem") == "Vendedora · Ipanema" and pg.locator("button.chip").count() == 0 and pg.locator("div.chip").count() > 0, "vendedora: quadrados sem clique")
        ok(not any("custo" in r or "151.23" in r for r in pg.respostas), "vendedora não recebe preço de custo")
        r = pg.evaluate("""async () => { const c = window.NERVIA_CONFIG; const s = supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
            const a = await s.from('lin_produtos').select('preco_custo'); const m = await s.rpc('lin_movimentar', {p_variante: '%s', p_loja: '%s', p_tipo: 'entrada', p_quantidade: 1});
            return [a.data ? a.data.length : -1, m.error ? m.error.message : 'sem erro']; }""" % (V_CRU_38, loja_id("Gávea")))
        ok(r[0] == 0 and "Somente o Dono" in r[1], "vendedora não lê o custo nem movimenta pela API")
        ok(not erros, "sem erros de JavaScript (vendedora)")

        # ---------------------------------------------------------------- vendedora: venda pela boleta + cliente novo
        pg, erros = entrar(b, "vendedora"); abrir(pg)
        pg.on("dialog", lambda d: d.accept())
        ok(pg.is_visible("#abaVendas") and pg.is_visible("#abaClientes") and not pg.is_visible("#abaProdutos"), "vendedora vê Vendas e Clientes")
        pg.click("#abaVendas"); pg.wait_for_selector("#vnova")
        ok("Nenhuma venda no período" in pg.text_content("#tela"), "vendas vazias no começo")
        pg.click("#vnova"); pg.wait_for_selector("#dlg[open] #nvcq")
        pg.fill("#nvcq", "Carmen Fictícia"); pg.wait_for_timeout(150)
        ok("Cliente não encontrado" in pg.text_content("#nvcres"), "cliente novo: não encontrado na busca")
        pg.click("#nvcnovo"); pg.wait_for_selector("#dlg2[open]")
        ok(pg.input_value("#cl_nome") == "Carmen Fictícia", "cadastro do cliente começa com o nome digitado")
        pg.fill("#cl_tel", "(21) 99999-0000"); pg.select_option("#cl_dia", "21"); pg.select_option("#cl_mes", "7"); pg.fill("#cl_obs", "Prefere linho cru")
        pg.click("#clok"); pg.wait_for_timeout(700)
        ok(not pg.is_visible("#dlg2") and "Carmen Fictícia" in pg.text_content("#nvcli") and "21/jul" in pg.text_content("#nvcli"), "cliente salvo e escolhido na venda")
        pg.fill("#nvpq", "ves-mar"); pg.wait_for_timeout(150)
        ok("Azul P" in pg.text_content("#nvres") and "3 na loja" in pg.text_content("#nvres") and "Off White" not in pg.text_content("#nvres"), "busca de peça mostra só o que tem na loja da vendedora")
        pg.click('#nvres [data-add="0"]'); pg.wait_for_timeout(150)
        pg.fill('#nvitens [data-k="q"]', "2"); pg.fill('#nvitens [data-k="pct"]', "10"); pg.wait_for_timeout(100)
        ok(pg.input_value('#nvitens [data-k="vu"]') == "449,10" and "898,20" in pg.text_content("#nvitens").replace("\xa0", " "), "desconto de 10% na peça calcula o valor")
        pg.fill("#nvdesc", "0,20"); pg.wait_for_timeout(100)
        ok("898,00" in pg.text_content("#nvtotal").replace("\xa0", " ") and pg.input_value('#nvpags [data-k="valor"]') == "898,00", "desconto geral e pagamento preenchido com o total")
        pg.select_option('#nvpags [data-k="parcelas"]', "6"); pg.fill("#nvobs", "Niver 21/07")
        pg.screenshot(path=os.path.join(SAIDA, "linum_nova_venda.png"), full_page=True)
        pg.click("#nvok"); pg.wait_for_timeout(1000)
        ok("registrada" in pg.text_content("#msg") and not pg.is_visible("#dlg"), "venda registrada")
        ok(psql("select valor_bruto || ' ' || valor_total || ' ' || (pagamentos->0->>'parcelas') || ' ' || observacao from lin_vendas", saida=True) == "998.00 898.00 6 Niver 21/07"
           and qtd_banco(V_AZUL_P, "Ipanema") == 1, "venda gravada com tabela, total, parcelas e baixa no estoque da Ipanema")
        ok(psql("select comissao_pct || ' ' || comissao_valor from lin_vendas", saida=True) == "3.50 31.43" and "31,43" in pg.text_content(".kpis").replace("\xa0", " "),
           "comissão da vendedora: 3,5% do valor pago, no KPI dela")
        ok("Carmen Fictícia" in pg.text_content("#tela") and "898,00" in pg.text_content(".kpis").replace("\xa0", " "), "lista e total do período")
        pg.screenshot(path=os.path.join(SAIDA, "linum_vendas.png"), full_page=True)
        pg.click("#abaClientes"); pg.wait_for_selector("#clista")
        ok("Carmen Fictícia" in pg.text_content("#clista") and "(21) 99999-0000" in pg.text_content("#clista") and "898,00" in pg.text_content("#clista").replace("\xa0", " "), "cliente com telefone e total comprado")
        pg.click("#cniver"); pg.wait_for_timeout(200)
        ok(pg.locator("#cniver.on").count() == 1, "filtro de aniversariantes do mês")
        ok(not erros, "sem erros de JavaScript (vendas da vendedora)")
        pg.click("#abaVendas"); pg.wait_for_selector(".vrow"); pg.click(".vrow"); pg.wait_for_selector("#dlg[open]")
        ok(pg.locator("#vcanc").count() == 0 and "Em 6x" not in pg.text_content("#dlgf") and "em 6x" in pg.text_content("#dlgf"), "vendedora vê a boleta mas não cancela")
        pg.click("#vfechar")

        # ---------------------------------------------------------------- dono: vê todas e cancela
        pg, erros = entrar(b, "dono"); abrir(pg)
        pg.on("dialog", lambda d: d.accept("Cliente desistiu da compra"))
        pg.click("#abaVendas"); pg.wait_for_selector(".vrow")
        ok("Por vendedora" in pg.text_content("#tela") and "Vera Vendedora" in pg.text_content("#tela"), "Dono vê o resumo por loja e por vendedora")
        pg.click(".vrow"); pg.wait_for_selector("#vcanc"); pg.click("#vcanc"); pg.wait_for_timeout(1000)
        ok("cancelada" in pg.text_content("#msg") and qtd_banco(V_AZUL_P, "Ipanema") == 3
           and psql("select motivo_cancelamento from lin_vendas", saida=True) == "Cliente desistiu da compra", "Dono cancela: peças voltam e o motivo fica")
        ok(psql("select count(*) from auditoria where acao in ('linum_venda_registrada', 'linum_venda_cancelada', 'linum_cliente_criado')", saida=True) == "3", "venda, cancelamento e cliente na auditoria")
        ok(not erros, "sem erros de JavaScript (vendas do Dono)")

        # ---------------------------------------------------------------- Estoque também vende (0% de comissão) e vendedora em outra loja
        pg, erros = entrar(b, "estoque"); abrir(pg)
        ok(pg.is_visible("#abaVendas") and pg.is_visible("#abaClientes"), "Estoque vende e vê clientes")
        pg.click("#abaVendas"); pg.wait_for_selector("#vnova")
        ok("Nenhuma venda no período" in pg.text_content("#tela"), "Estoque vê só as vendas dele")
        pg.click("#vnova"); pg.wait_for_selector("#dlg[open] #nvloja")
        pg.fill("#nvcq", "carmen ficticia 21 99999-0000"); pg.wait_for_timeout(150)
        ok(pg.locator("#nvcres [data-cli]").count() == 1 and "Carmen Fictícia" in pg.text_content("#nvcres"), "nome e telefone juntos (sem acento) acham a cliente")
        pg.fill("#nvcq", "Joana Nova 21 98888-7777"); pg.wait_for_timeout(150); pg.click("#nvcnovo"); pg.wait_for_selector("#dlg2[open]")
        ok(pg.input_value("#cl_nome") == "Joana Nova" and pg.input_value("#cl_tel") == "(21) 98888-7777", "cliente novo: nome e telefone digitados juntos vão cada um para o seu campo")
        pg.click("#clx")
        pg.fill("#nvcq", "Carmen Ficticia"); pg.wait_for_timeout(150); pg.click("#nvcnovo"); pg.wait_for_selector("#dlg2[open]")
        pg.click("#clok"); pg.wait_for_timeout(300)
        ok(pg.is_visible("#clparecido") and "Já existe cliente com esse nome" in pg.text_content("#clparecido") and "(21) 99999-0000" in pg.text_content("#clparecido"), "nome igual a cliente já cadastrada: pergunta se é ela")
        pg.click("#clparecido [data-mesma]"); pg.wait_for_timeout(200)
        ok(not pg.is_visible("#dlg2") and "Carmen Fictícia" in pg.text_content("#nvcli") and psql("select count(*) from lin_clientes", saida=True) == "1", "É ela: usa o cadastro existente, sem duplicar")
        pg.click("#nvctroca"); pg.fill("#nvcq", "Carmen Ficticia"); pg.wait_for_timeout(150); pg.click("#nvcnovo"); pg.wait_for_selector("#dlg2[open]")
        pg.click("#clok"); pg.wait_for_timeout(300); pg.click("#cloutra"); pg.wait_for_timeout(700)
        ok(not pg.is_visible("#dlg2") and psql("select count(*) from lin_clientes", saida=True) == "2", "É outra pessoa: cria o cadastro novo")
        pg.select_option("#nvloja", label="Gávea"); pg.fill("#nvpq", "cal-are"); pg.wait_for_timeout(150)
        pg.click('#nvres [data-add="0"]'); pg.wait_for_timeout(150)
        pg.select_option('#nvpags [data-k="forma"]', "pix"); pg.click("#nvok"); pg.wait_for_timeout(1000)
        ok("registrada" in pg.text_content("#msg") and "Sua comissão" in pg.text_content(".kpis") and "sem comissão" in pg.text_content(".kpis"), "Estoque registra venda na Gávea; KPI sem comissão")
        ok(psql("select (select nome from lin_lojas where id = loja_id) || ' ' || comissao_pct || ' ' || comissao_valor from lin_vendas order by id desc limit 1", saida=True) == "Gávea 0.00 0.00",
           "venda do Estoque gravada na loja escolhida e sem comissão")
        ok(not any("preco_custo" in r for r in pg.respostas), "Estoque que vende continua sem receber custo")
        ok(not erros, "sem erros de JavaScript (Estoque que vende)")
        pg, erros = entrar(b, "vendedora"); abrir(pg)
        pg.click("#abaVendas"); pg.wait_for_selector("#vnova"); pg.click("#vnova"); pg.wait_for_selector("#dlg[open] #nvloja")
        ok(pg.eval_on_selector("#nvloja", "s => s.options[s.selectedIndex].text") == "Ipanema", "venda da vendedora começa na loja principal dela")
        pg.select_option("#nvloja", label="Gávea"); pg.fill("#nvpq", "ves-mar"); pg.wait_for_timeout(150)
        ok("Azul M" in pg.text_content("#nvres") and "na loja" in pg.text_content("#nvres"), "vendedora deslocada vê o estoque da outra loja")
        pg.click("#nvx")
        ok(not erros, "sem erros de JavaScript (vendedora deslocada)")

        # ---------------------------------------------------------------- troca / devolução com crédito na conta da cliente (2.4)
        pg.click("#vnova"); pg.wait_for_selector("#dlg[open] #nvloja")
        pg.fill("#nvcq", "Carmen"); pg.wait_for_timeout(150); pg.click("#nvcres [data-cli] >> nth=0"); pg.wait_for_timeout(500)
        ok(pg.inner_html("#nvcred") == "", "cliente sem crédito: a caixa de crédito não aparece")
        pg.fill("#nvpq", "ves-mar"); pg.wait_for_timeout(150); pg.click('#nvres [data-add="0"]'); pg.wait_for_timeout(150)
        pg.select_option('#nvpags [data-k="forma"]', "pix"); pg.click("#nvok"); pg.wait_for_timeout(1000)
        venda = psql("select max(id) from lin_vendas where cancelada_em is null and loja_id = (select id from lin_lojas where nome = 'Ipanema')", saida=True)
        cli = psql(f"select cliente_id from lin_vendas where id = {venda}", saida=True)
        pago_p = psql(f"select valor_total from lin_venda_itens where venda_id = {venda}", saida=True)
        p_ipa, p_gav, m_gav = qtd_banco(V_AZUL_P, "Ipanema"), qtd_banco(V_AZUL_P, "Gávea"), qtd_banco(V_AZUL_M, "Gávea")
        pg.click("#vtroca"); pg.wait_for_selector("#dlg[open] #trvnum")
        ok(pg.locator("#trpq").count() == 0 and "crédito na conta da cliente" in pg.text_content("#dlgf"), "troca/devolução: só a peça devolvida; o valor vira crédito")
        pg.select_option("#trloja", label="Gávea")
        pg.fill("#trvnum", "999999"); pg.click("#trvbusca"); pg.wait_for_timeout(500)
        ok("não encontrada" in pg.text_content("#trerr"), "troca: venda inexistente avisa")
        pg.fill("#trvnum", venda); pg.click("#trvbusca"); pg.wait_for_timeout(600)
        ok("pode trocar 1" in pg.text_content("#trdevbox") and "Azul P" in pg.text_content("#trdevbox") and "Carmen" in pg.text_content("#trcli"), "troca: a venda mostra as peças e traz a cliente")
        pg.click('#trdevbox [data-devv="0"]'); pg.wait_for_timeout(500)
        ok(pg.input_value("#trdevforma") == "credito_loja" and "Crédito atual" in pg.text_content("#trsaldo"), "o valor vai para o crédito da cliente (padrão), com o saldo atual")
        pg.fill("#trobs", "Tamanho não serviu")
        pg.screenshot(path=os.path.join(SAIDA, "linum_troca.png"), full_page=True)
        pg.click("#trok"); pg.wait_for_timeout(1200)
        ok(pg.is_visible("#trvenda") and "crédito na conta" in pg.text_content("#dlgf") and pg.locator(".trow").count() == 1, "devolução registrada: oferece a nova venda usando o crédito")
        ok(qtd_banco(V_AZUL_P, "Gávea") == p_gav + 1 and qtd_banco(V_AZUL_P, "Ipanema") == p_ipa, "a peça devolvida volta ao estoque da loja da devolução")
        ok(psql(f"select coalesce(sum(valor), 0) from lin_creditos where cliente_id = '{cli}'", saida=True) == pago_p, f"crédito da cliente = valor pago pela peça ({pago_p})")
        pg.click("#trvenda"); pg.wait_for_selector("#dlg[open] #nvcreduse"); pg.wait_for_timeout(300)
        ok(pg.is_checked("#nvcreduse") and "Carmen" in pg.text_content("#nvcli"), "nova venda já com a cliente e o crédito marcado")
        pg.select_option("#nvloja", label="Gávea"); pg.fill("#nvpq", "ves-mar"); pg.wait_for_timeout(150)
        pg.click('#nvres .vlin:has-text("Azul M") [data-add]'); pg.wait_for_timeout(150)
        pg.fill('#nvitens [data-k="vu"]', "600,00"); pg.wait_for_timeout(150)
        nf = pg.text_content("#nvnf").replace("\xa0", " ")
        ok("Valor da nota fiscal" in nf, f"mostra o que falta pagar e o valor da nota fiscal ({nf.strip()[:80]})")
        pg.select_option('#nvpags [data-k="forma"]', "pix"); pg.click("#nvok"); pg.wait_for_timeout(1200)
        vc = psql("select max(id) from lin_vendas", saida=True)
        ok(psql(f"select credito_usado || ' ' || valor_nf || ' ' || (pagamentos @> '[{{\"forma\":\"credito_loja\"}}]') from lin_vendas where id = {vc}", saida=True)
             == f"{pago_p} {round(600 - float(pago_p), 2):.2f} true"
           and psql(f"select coalesce(sum(valor), 0) from lin_creditos where cliente_id = '{cli}'", saida=True) == "0.00" and "Crédito usado" in pg.text_content("#msg"),
           "nova venda: crédito usado, paga só a diferença, nota fiscal sem o crédito, saldo zera")
        pg.click(".trow"); pg.wait_for_selector("#tfechar")
        ok(pg.locator("#tcanc").count() == 0 and "Tamanho não serviu" in pg.text_content("#dlgf") and "Devolução" in pg.text_content("#dlgf h3"), "vendedora vê a devolução mas não cancela")
        pg.click("#tfechar")
        pg.click("#vtroca"); pg.wait_for_selector("#dlg[open] #trvnum"); pg.fill("#trvnum", venda); pg.click("#trvbusca"); pg.wait_for_timeout(600)
        ok("já trocada" in pg.text_content("#trdevbox") and pg.locator("#trdevbox [data-devv]").count() == 0, "peça já devolvida não pode ser devolvida de novo")
        pg.click('[data-modo="avulsa"]'); pg.wait_for_timeout(300); pg.click("#trctroca"); pg.wait_for_timeout(300)
        pg.fill("#trdq", "ves-mar"); pg.wait_for_timeout(150); pg.click('#trdres [data-dadd="0"]'); pg.wait_for_timeout(150)
        pg.fill('#trdev [data-k="vu"]', "700,00"); pg.wait_for_timeout(100)
        pg.click("#trok"); pg.wait_for_timeout(600)
        ok("informe a cliente" in pg.text_content("#trerr"), "compra antiga sem cliente: crédito exige a cliente")
        pg.click("#trx")
        ok(not erros, "sem erros de JavaScript (troca/devolução e venda com crédito)")
        pg, erros = entrar(b, "dono"); abrir(pg)
        pg.on("dialog", lambda d: d.accept("Lançada por engano"))
        pg.click("#abaVendas"); pg.wait_for_selector(".trow"); pg.click(".trow"); pg.wait_for_selector("#tcanc"); pg.click("#tcanc"); pg.wait_for_timeout(1000)
        ok("já usou" in pg.text_content("#terr"), "Dono não cancela a devolução cujo crédito já foi usado")
        pg.click("#tfechar"); pg.click(f'.vrow[data-v="{vc}"]'); pg.wait_for_selector("#vcanc")
        ok("Valor da nota fiscal" in pg.text_content("#dlgf") and "Crédito da cliente" in pg.text_content("#dlgf"), "boleta mostra o crédito usado e o valor da nota fiscal")
        pg.click("#vcanc"); pg.wait_for_timeout(1000)
        ok(psql(f"select sum(valor) from lin_creditos where cliente_id = '{cli}'", saida=True) == pago_p and qtd_banco(V_AZUL_M, "Gávea") == m_gav, "cancelar a nova venda devolve o crédito e a peça")
        pg.click(".trow"); pg.wait_for_selector("#tcanc"); pg.click("#tcanc"); pg.wait_for_timeout(1000)
        ok("cancelada" in pg.text_content("#msg") and qtd_banco(V_AZUL_P, "Gávea") == p_gav and psql(f"select sum(valor) from lin_creditos where cliente_id = '{cli}'", saida=True) == "0.00",
           "Dono cancela a devolução: a peça sai de novo e o crédito sai da conta")
        ok(psql("select count(*) from auditoria where acao in ('linum_troca_registrada', 'linum_troca_cancelada')", saida=True) == "2", "devolução e cancelamento na auditoria")
        pg.click("#abaClientes"); pg.wait_for_selector(".crow"); pg.click(f'.crow[data-c="{cli}"]'); pg.wait_for_selector("#fccred")
        ok(pg.is_visible("#fcajus") and pg.is_visible("#fcext"), "ficha da cliente: crédito, extrato e ajuste (Dono)")
        pg.click("#fcext"); ok(pg.is_visible("#fcextrato") and "Usado na venda" in pg.text_content("#fcextrato"), "extrato do crédito na ficha")
        pg.click("#fcx")
        ok(not erros, "sem erros de JavaScript (cancelar devolução)")
        # relatório de créditos (Dono): saldo de todas as clientes e os lançamentos, sem abrir cada ficha
        psql(f"insert into lin_creditos (cliente_id, tipo, valor, observacao, criado_nome) values ('{cli}', 'ajuste', 50, 'bônus de teste', 'Dona')")
        pg.click("#abaCreditos"); pg.wait_for_selector("#crsaldos")
        ok("R$ 50,00" in pg.text_content(".kpis").replace("\xa0", " ") and pg.locator(".crcli").count() == 1 and "Carmen" in pg.text_content("#crsaldos")
           and pg.locator("#crlanc tbody tr").count() >= 5 and "bônus de teste" in pg.text_content("#crlanc"),
           "aba Créditos: saldo em aberto, clientes com saldo e lançamentos do período")
        pg.select_option("#crtipo", "ajuste"); pg.wait_for_timeout(600)
        ok(pg.locator("#crlanc tbody tr").count() == 1, "aba Créditos: filtro por tipo")
        pg.screenshot(path=os.path.join(SAIDA, "linum_creditos.png"), full_page=True)
        pg.click(".crcli"); pg.wait_for_selector("#dlg[open] #fccred")
        ok("50,00" in pg.text_content("#fccred"), "aba Créditos: clicar na cliente abre a ficha com o extrato")
        pg.click("#fcx"); pg.wait_for_timeout(200)
        psql(f"insert into lin_creditos (cliente_id, tipo, valor, observacao, criado_nome) values ('{cli}', 'ajuste', -50, 'tira o bônus de teste', 'Dona')")
        ok(not erros, "sem erros de JavaScript (aba Créditos)")
        # ---------------------------------------------------------------- custos das peças (2.18, só o Dono)
        ref_cu = psql("select referencia from lin_produtos where referencia not like 'NOVA-%' order by referencia limit 1", saida=True)
        psql(f"""insert into lin_custos (ficha, referencia, descricao, materia, qtd, mp_metro, gasto, qtd_risco, risco, modelagem, corte, lavanderia, costura,
                 aviamentos, passadoria, logistica, comissao, pagamento, venda, origem) values ('{ref_cu}', '{ref_cu}', 'Calça Marcel', 'linho timotex', 20, 78, 1.3, 20, 90, 300,
                 5, 3, 20, 7, 3, 3, 34, 80, 869, 'planilha CUSTO 2025'), ('B77', 'B77', 'Bata de teste', 'linho', 10, 50, 1, 10, 50, 100, 5, 0, 30, 2, 0, 0, 10, 20, 250, 'planilha CUSTO 2025')""")
        pg.click("#abaCustos"); pg.wait_for_selector("#cures")
        cu_id = psql(f"select id from lin_custos where ficha = '{ref_cu}'", saida=True)
        pg.click(f'.cuitem[data-cid="{cu_id}"]'); pg.wait_for_timeout(300)
        ok(pg.locator(".cuitem").count() == 2 and "275,90" in pg.text_content("#cures") and "3,15×" in pg.text_content("#cures"),
           "Custos: fichas da planilha, custo R$ 275,90 e markup 3,15× (iguais à planilha)")
        pg.fill("#cu_risco_peca_manual", "10"); pg.wait_for_timeout(200)
        ok("281,40" in pg.text_content("#cures") and pg.is_enabled("#cusalvar"), "Custos: a conta muda enquanto digita (risco por peça digitado)")
        pg.fill("#cu_markup_alvo", "3,4"); pg.fill("#cu_desconto_pct", "20"); pg.wait_for_timeout(200)
        ok("956,76" in pg.text_content("#cures") and "765,41" in pg.text_content("#cures"), "Custos: simulação com markup alvo e desconto")
        ok("869,00" in pg.text_content(".cuvenda") and "956,76" in pg.text_content(".cucalc"), "Ficha: valor de venda e venda calculada em destaque, como o custo")
        with pg.expect_popup() as pop: pg.click("#cuimp")
        fp = pop.value; fp.wait_for_load_state()
        pdf = os.path.join(SAIDA, "linum_ficha_custo.pdf"); fp.pdf(path=pdf, prefer_css_page_size=True, print_background=True)
        ok("Ficha de custo" in fp.text_content("header") and "956,76" in fp.text_content("body") and open(pdf, "rb").read().count(b"/Type /Page\n") + open(pdf, "rb").read().count(b"/Type /Page>") + open(pdf, "rb").read().count(b"/Type /Page ") == 1,
           "Imprimir ficha: cabeçalho, venda calculada e uma folha só (A4 deitada)")
        fp.close()
        pg.click("#cusalvar"); pg.wait_for_timeout(900)
        ok(psql(f"select round(custo, 2) || ' ' || markup_alvo from lin_custos where ficha = '{ref_cu}'", saida=True) == "281.40 3.4"
           and psql("select count(*) from auditoria where acao = 'linum_custo_alterado'", saida=True) == "1", "Custos: salvar grava e registra na auditoria")
        pg.click("#cudup"); pg.wait_for_timeout(300); pg.fill("#cu_venda", "990"); pg.click("#cusalvar"); pg.wait_for_timeout(900)
        ok(psql(f"select rascunho || ' ' || venda from lin_custos where ficha = 'Cópia de {ref_cu}'", saida=True) == "true 990", "Custos: duplicar cria uma cópia (simulação)")
        ok(pg.locator(".cuitem").count() == 2, "Custos: cópias ficam fora da lista até marcar 'Mostrar cópias'")
        pg.check("#cucop"); pg.wait_for_timeout(200)
        ok(pg.locator(".cuitem").count() == 3, "Custos: Mostrar cópias")
        pg.uncheck("#cucop")
        pg.click('[data-ca="todas"]'); pg.wait_for_selector("#cutb tr")
        ok(pg.locator("#cutb tr").count() == 2, "Custos: tabela com todas as peças")
        pg.click('[data-ca="margens"]'); pg.wait_for_selector("#cumg .kpis")
        ok("Por tecido" in pg.text_content("#cumg") and "linho timotex" in pg.text_content("#cumg"), "Custos: margens, composição e por tecido")
        pg.screenshot(path=os.path.join(SAIDA, "linum_custos_margens.png"), full_page=True)
        pg.click('[data-ca="sistema"]'); pg.wait_for_selector("#cusis")
        ok("Ficha sem peça no cadastro" in pg.text_content("#cucorpo") and pg.locator('[data-sit="sem_ficha"]').count() == 1, "Custos: comparação planilha × sistema")
        pg.click('[data-sit="diferente"]'); pg.wait_for_selector(".cumarca")
        ok(pg.is_disabled("#cuaplicar"), "Planilha × Sistema: botão só com alguma ficha marcada")
        pg.check(f'.cumarca[data-cid="{cu_id}"]')
        ok("(1)" in pg.text_content("#cuaplicar"), "Planilha × Sistema: botão conta as marcadas")
        pg.click("#cuaplicar"); pg.wait_for_timeout(1200)
        ok(psql(f"select preco_venda || ' ' || preco_custo from lin_produtos where referencia = '{ref_cu}'", saida=True) == "869.00 281.40"
           and "atualizada" in pg.text_content("#msg"), "Planilha × Sistema: Atualizar no cadastro grava preço de venda e custo da ficha na peça")
        pg.click('[data-sit="igual"]'); pg.wait_for_timeout(300)
        ok(ref_cu in pg.text_content("#cusis"), "Planilha × Sistema: a peça passa para Igual à ficha")
        b77 = psql("select id from lin_custos where ficha = 'B77'", saida=True)
        pg.click('[data-ca="fichas"]'); pg.wait_for_selector("#cures"); pg.click(f'.cuitem[data-cid="{b77}"]'); pg.wait_for_selector("#cuenviar")
        ok(pg.text_content("#cuenviar") == "Criar em Produtos", "Ficha sem peça: botão Criar em Produtos")
        pg.click("#cuenviar"); pg.wait_for_timeout(1200)
        ok(psql("select preco_venda || ' ' || preco_custo from lin_produtos where referencia = 'B77'", saida=True) == "250.00 132.00"
           and "criada em Produtos" in pg.text_content("#msg"), "Ficha: Criar em Produtos cria a peça com preço de venda e custo")
        pg.wait_for_selector("#cuenviar")
        ok(pg.text_content("#cuenviar") == "Atualizar em Produtos", "Ficha com peça: botão vira Atualizar em Produtos")
        # 2.20: ficha da versão artesanal = peça especial da mesma referência
        psql(f"""insert into lin_variantes (produto_id, cor, tamanho, edicao, preco_venda) select id, 'Cru', 'M', 'Pintura Artesanal', 990 from lin_produtos where referencia = '{ref_cu}';
                 insert into lin_custos (ficha, referencia, descricao, versao, corte, venda) values ('{ref_cu} artesanal', '{ref_cu}', 'Calça artesanal', 'artesanal', 400, 1290)""")
        pg.evaluate("carregar()"); pg.wait_for_timeout(500)
        pg.click('[data-ca="todas"]'); pg.wait_for_selector("#cutb tr"); pg.click('[data-ca="fichas"]'); pg.wait_for_selector("#cures")
        art = psql(f"select id from lin_custos where ficha = '{ref_cu} artesanal'", saida=True)
        pg.click(f'.cuitem[data-cid="{art}"]'); pg.wait_for_selector("#cu_edicao")
        ok("tem peças especiais" in pg.text_content("#cures") and "Pintura Artesanal" in pg.text_content("#cu_edicao"),
           "Ficha de versão: avisa que a peça tem peças especiais e lista as edições")
        pg.select_option("#cu_edicao", "Pintura Artesanal"); pg.wait_for_timeout(200)
        ok("Pintura Artesanal" in pg.text_content("#cures") and "990,00" in pg.text_content("#cures").replace("\xa0", " "), "Ficha: compara com o preço da peça especial")
        pg.click("#cusalvar"); pg.wait_for_timeout(900); pg.wait_for_selector("#cuenviar"); pg.click("#cuenviar"); pg.wait_for_timeout(1200)
        ok(psql("select preco_venda || ' ' || preco_custo from lin_variantes where edicao = 'Pintura Artesanal'", saida=True) == "1290.00 400.00"
           and psql(f"select preco_venda from lin_produtos where referencia = '{ref_cu}'", saida=True) == "869.00",
           "Atualizar em Produtos com peça especial: muda só a peça especial, a peça normal fica")
        pg.click('[data-ca="fichas"]'); pg.wait_for_selector("#cures")
        pg.screenshot(path=os.path.join(SAIDA, "linum_custos.png"), full_page=True)
        ok(not erros, "sem erros de JavaScript (aba Custos)")
        # ---------------------------------------------------------------- ajustes da peça vendida (2.8)
        pg.click("#abaVendas"); pg.wait_for_selector(".vrow")
        vaj = psql("select max(id) from lin_vendas where cancelada_em is null", saida=True)
        pg.click(f'.vrow[data-v="{vaj}"]'); pg.wait_for_selector("#dlg[open] [data-ajuste]")
        pg.click("[data-ajuste] >> nth=0"); pg.wait_for_selector("#dlg2[open] #ajok")
        dvenda = psql(f"select data from lin_vendas where id = {vaj}", saida=True)
        ok(pg.input_value("#ajprazo") > dvenda and pg.is_visible("#ajcostn"), "ajuste: volta em 10 dias úteis; sem costureira cadastrada, escreve o nome")
        ok(pg.eval_on_selector("#ajobs", "e => e.tagName") == "TEXTAREA", "observações para a costureira em campo grande")
        pg.click('[data-serv="Bainha"]'); pg.fill("#ajcostn", "Dona Rosa"); pg.fill("#ajvc", "30,00")
        pg.fill("#ajobs", "Bainha marcada com alfinete\nNão cortar o tecido, só dobrar"); pg.click("#ajok"); pg.wait_for_timeout(1200)
        ok(psql("select situacao || ' ' || costureira || ' ' || valor_costureira || ' ' || (servico ilike 'bainha%') from lin_ajustes", saida=True) == "na_costureira Dona Rosa 30.00 true"
           and "Ajuste nº" in pg.text_content("#msg"), "ajuste registrado: com a costureira, valor de R$ 30")
        ok(pg.is_visible("#ajimp") and "Dona Rosa" in pg.text_content("#dlg2f"), "depois de registrar: Imprimir / PDF e WhatsApp para a costureira")
        with pg.expect_popup() as pop: pg.click("#ajimp")
        fp = pop.value; fp.wait_for_load_state(); ft = fp.text_content("body")
        ok("Ficha de ajuste" in ft and "Dona Rosa" in ft and "alfinete" in ft and "Não cortar o tecido" in ft and "Volta até" in ft, "ficha de ajuste impressa com o que fazer e as observações")
        fp.close(); pg.click("#ajfim"); pg.wait_for_timeout(500)
        ok("Com a costureira" in pg.text_content("#vajustes"), "a boleta mostra o ajuste da peça")
        pg.click("#vfechar"); pg.click("#abaAjustes"); pg.wait_for_selector("#ajtab")
        ok("Dona Rosa" in pg.text_content("#ajtab") and "1" in pg.text_content(".kpis"), "aba Ajustes lista o que está com a costureira")
        with pg.expect_popup() as pop: pg.select_option("#ajimpc", "Dona Rosa")
        ok("Ficha de ajuste" in pop.value.text_content("body"), "imprimir / PDF de todas as peças com uma costureira"); pop.value.close()
        pg.click('[data-aj="pronto"]'); pg.wait_for_timeout(900)
        ok("Pronto na loja" in pg.text_content("#ajtab") and pg.is_visible("[data-zapcli]"), "voltou da costureira: pronto na loja, avisar a cliente")
        pg.click('[data-aj="entregue"]'); pg.wait_for_timeout(900)
        ok(psql("select situacao from lin_ajustes", saida=True) == "entregue" and psql("select count(*) from auditoria where acao like 'linum_ajuste_%'", saida=True) == "3",
           "entregue à cliente; envio, volta e entrega na auditoria")
        ok(not erros, "sem erros de JavaScript (ajustes)")

        # ---------------------------------------------------------------- relatório de comissões por mês (só o Dono)
        pg.click("#abaComissoes"); pg.wait_for_selector("#cmtab")
        tab = pg.text_content("#cmtab").replace("\xa0", " ")
        com_vera = psql("select replace(sum(comissao_valor)::text, '.', ',') from lin_vendas where cancelada_em is null and vendedora_nome = 'Vera Vendedora'", saida=True)
        ok("Vera Vendedora" in tab and f"R$ {com_vera}" in tab and "3,5%" in tab and "Edu Estoque" in tab and "sem comissão" in tab, f"comissões do mês por pessoa (Vera R$ {com_vera}; Estoque sem comissão)")
        ok(pg.locator(".cmdet:not(.oculto)").count() == 0, "detalhe fechado no começo")
        pg.click('.cmrow:has-text("Vera Vendedora")'); pg.wait_for_timeout(150)
        ok(pg.locator(".cmdet:not(.oculto)").count() == 1 and "Ipanema" in pg.text_content(".cmdet:not(.oculto)"), "clique na pessoa mostra as vendas dela")
        ok("Vera Vendedora" in pg.text_content("#cm12") and "Total" in pg.text_content("#cm12"), "tabela dos últimos 12 meses")
        with pg.expect_download() as dl: pg.click("#cmcsv")
        csv = open(dl.value.path(), encoding="utf-8-sig").read()
        ok(csv.startswith('"Mês";"Quem vendeu"') and "Vera Vendedora" in csv and com_vera in csv, "CSV das comissões do mês")
        pg.select_option("#cmloja", label="Gávea"); pg.wait_for_selector("#cmtab"); pg.wait_for_timeout(300)
        ok("Edu Estoque" in pg.text_content("#cmtab") and "Vera Vendedora" not in pg.text_content("#cmtab") and "Gávea" in pg.text_content("h2"), "filtro por loja")
        pg.click("#cmant"); pg.wait_for_timeout(500)
        ok("Nenhuma venda neste mês" in pg.text_content("#cmtab"), "mês anterior sem vendas")
        pg.screenshot(path=os.path.join(SAIDA, "linum_comissoes.png"), full_page=True)
        ok(not erros, "sem erros de JavaScript (comissões)")
        pg, erros = entrar(b, "vendedora"); abrir(pg)
        ok(not pg.is_visible("#abaComissoes"), "vendedora não vê o relatório de comissões")
        pg, erros = entrar(b, "estoque"); abrir(pg)
        ok(not pg.is_visible("#abaComissoes"), "Estoque não vê o relatório de comissões")

        # ---------------------------------------------------------------- CRM: possíveis clientes, contatos e próximo contato
        psql("update lin_clientes set proximo_contato = current_date - 2 where nome = 'Carmen Fictícia'")
        pg, erros = entrar(b, "vendedora"); abrir(pg)
        pg.click("#abaClientes"); pg.wait_for_selector("#clista .crow")
        ok("1 atrasado" in pg.text_content("#ckpis") and "atrasado" in pg.text_content('#clista .crow:has-text("Carmen Fictícia")'), "cliente com próximo contato vencido aparece atrasada")
        pg.click("#cnovo"); pg.wait_for_selector("#dlg2[open] #cl_resp")
        ok(pg.locator('[data-sit="possivel"].on').count() == 1 and pg.eval_on_selector("#cl_resp", "s => s.options[s.selectedIndex].text") == "Vera Vendedora",
           "novo cliente pelo CRM: começa como possível cliente, acompanhado por quem cadastra")
        pg.fill("#cl_nome", "Bruna Possível"); pg.fill("#cl_tel", "21977776666"); pg.select_option("#cl_origem", "Instagram")
        pg.fill("#cl_int", "Vestidos longos, tamanho M")
        pg.click("#clok"); pg.wait_for_selector("#dlg[open] #ctok")
        ok(psql("select situacao || ' ' || origem || ' ' || interesses || ' ' || responsavel_nome from lin_clientes where nome = 'Bruna Possível'", saida=True)
           == "possivel Instagram Vestidos longos, tamanho M Vera Vendedora", "possível cliente gravada com como conheceu, interesses e responsável")
        ok("possível cliente" in pg.text_content("#dlgf") and "Nenhum contato registrado" in pg.text_content("#cthist") and "Aqui%20%C3%A9%20Vera" in pg.get_attribute("#fcwa", "href"),
           "ficha abre depois de salvar, com WhatsApp pronto")
        pg.fill("#cttxt", "Chamei para ver a coleção nova"); pg.click("#ctok"); pg.wait_for_timeout(400)
        ok("Escolha o resultado" in pg.text_content("#cterr"), "contato sem resultado não registra")
        pg.select_option("#ctcanal", "whatsapp"); pg.select_option("#ctres", "vai_a_loja"); pg.click('[data-dias="3"]')
        pg.screenshot(path=os.path.join(SAIDA, "linum_crm_ficha.png"), full_page=True)
        pg.click("#ctok"); pg.wait_for_timeout(1000)
        ok(psql("select canal || ' ' || resultado || ' ' || por_nome || ' ' || (proximo_contato - (now() at time zone 'America/Sao_Paulo')::date) from lin_contatos where venda_id is null", saida=True) == "whatsapp vai_a_loja Vera Vendedora 3"
           and psql("select (proximo_contato - (now() at time zone 'America/Sao_Paulo')::date) || ' ' || (ultimo_contato is not null) from lin_clientes where nome = 'Bruna Possível'", saida=True) == "3 true",
           "contato gravado e próximo contato da cliente em 3 dias")
        ok("Chamei para ver a coleção nova" in pg.text_content("#cthist") and "Vai à loja" in pg.text_content("#cthist") and pg.locator(".ctitem").count() == 1, "histórico mostra o contato (Bruna não comprou: sem registro de venda)")
        ok(psql("select count(*) from auditoria where acao = 'linum_contato_registrado' and detalhes->>'texto' is null", saida=True) == "1", "contato na auditoria (sem o texto)")
        pg.click("#fcx")
        pg.click("#cagenda"); pg.wait_for_timeout(200)
        ok("Carmen Fictícia" in pg.text_content("#clista") and "Bruna Possível" not in pg.text_content("#clista"), "Para contatar até hoje: só quem está para hoje ou atrasado")
        pg.click("#cagenda"); pg.select_option("#csit", "possivel"); pg.wait_for_timeout(200)
        ok("Bruna Possível" in pg.text_content("#clista") and "Carmen Fictícia" not in pg.text_content("#clista"), "filtro de possíveis clientes")
        pg.select_option("#csit", ""); pg.click("#cmeus"); pg.wait_for_timeout(200)
        ok("Bruna Possível" in pg.text_content("#clista"), "Só os que eu acompanho")
        pg.click('#clista .crow:has-text("Bruna Possível")'); pg.wait_for_selector("#dlg[open] #fced"); pg.click("#fced"); pg.wait_for_selector("#dlg2[open] #cl_prox")
        pg.fill("#cl_prox", ""); pg.click("#clok"); pg.wait_for_timeout(800)
        ok(psql("select coalesce(proximo_contato::text, 'vazio') || ' ' || situacao from lin_clientes where nome = 'Bruna Possível'", saida=True) == "vazio possivel"
           and "Chamei para ver" in pg.text_content("#cthist"), "editar dados tira o próximo contato e a ficha continua com o histórico")
        pg.click("#fcx")
        ok(not erros, "sem erros de JavaScript (CRM da vendedora)")
        # visita sem contato
        pg.click("#abaVendas"); pg.wait_for_selector("#vvisita"); pg.click("#vvisita"); pg.wait_for_selector("#dlg[open] #visok")
        ok(pg.eval_on_selector("#visloja", "s => s.options[s.selectedIndex].text") == "Ipanema", "visita começa na loja principal")
        pg.click("#visok"); pg.wait_for_timeout(400)
        ok("por que não levou" in pg.text_content("#viserr"), "visita sem motivo não registra")
        pg.fill("#vispes", "2"); pg.click('[data-mot="tamanho"]'); pg.click('[data-mot="preco"]'); pg.click('[data-mot="preco"]'); pg.fill("#visfalt", "m")
        ok(not pg.is_visible("#visoutro"), "campo do outro motivo escondido até marcar Outro")
        pg.click('[data-mot="outro"]'); pg.click("#visok"); pg.wait_for_timeout(400)
        ok(pg.is_visible("#visoutro") and "outro motivo" in pg.text_content("#viserr"), "Outro marcado sem escrever o motivo não registra")
        pg.fill("#visoutro", "Procurava linho mais grosso")
        pg.fill("#vispq", "ves-mar"); pg.wait_for_timeout(150); pg.click('#visres .vlin:has-text("Azul G") [data-vadd]'); pg.wait_for_timeout(150)
        pg.fill("#visobs", "Procurava vestido para casamento")
        pg.screenshot(path=os.path.join(SAIDA, "linum_visita.png"), full_page=True)
        pg.click("#visok"); pg.wait_for_timeout(1000)
        ok("Visita registrada" in pg.text_content("#msg") and psql("select pessoas || ' ' || array_to_string(motivos, ',') || ' ' || motivo_outro || ' ' || faltou || ' ' || (pecas->0->>'tamanho') from lin_visitas", saida=True) == "2 outro,tamanho Procurava linho mais grosso m G",
           "visita gravada: 2 pessoas, dois motivos (preço desmarcado), outro escrito, peça olhada")
        ok("Visitas sem compra" in pg.text_content(".kpis") and "conversão" in pg.text_content(".kpis") and "VES-MAR Azul G" in pg.text_content("#visitas")
           and "Faltou tamanho" in pg.text_content("#visitas") and "Outro: Procurava linho mais grosso" in pg.text_content("#visitas") and "Preço" not in pg.text_content("#visitas tbody") and "M" in pg.text_content("#visitas"), "visitas do período: KPI de conversão, motivo, peça e o que faltou")
        ok(not erros, "sem erros de JavaScript (visita)")
        pg, erros = entrar(b, "dono"); abrir(pg)
        pg.click("#abaClientes"); pg.wait_for_selector("#clista .crow"); pg.click('#clista .crow:has-text("Bruna Possível")'); pg.wait_for_selector("#dlg[open] #cthist")
        ok("Vera Vendedora" in pg.text_content("#cthist"), "o Dono vê o histórico registrado pela vendedora")
        pg.click("#fcx"); pg.click('#clista .crow:has-text("Carmen Fictícia")'); pg.wait_for_selector("#dlg[open] #cthist")
        hist = pg.text_content("#cthist").replace("\xa0", " ")
        ok("registro automático da venda" in hist and "Comprou na Ipanema — venda nº" in hist and "Cancelada" in hist and "Cliente desistiu da compra" in hist,
           "a venda e o cancelamento entram sozinhos no histórico da cliente")
        pg.click("#fcx")
        pg.click('#clista .crow:has-text("Carmen Ficticia")'); pg.wait_for_selector("#dlg[open] #cthist")   # a outra Carmen (sem acento), da venda da Gávea
        hist2 = pg.text_content("#cthist").replace("\xa0", " ")
        ok("Comprou na Gávea" in hist2 and "R$" in hist2, "o Dono vê o valor da venda no histórico")
        pg.click("#fcx")
        pg2, erros2 = entrar(b, "vendedora"); abrir(pg2)
        pg2.click("#abaClientes"); pg2.wait_for_selector("#clista .crow"); pg2.click('#clista .crow:has-text("Carmen Fictícia")'); pg2.wait_for_selector("#dlg[open] #cthist")
        ok("Comprou na Ipanema" in pg2.text_content("#cthist") and "R$" not in pg2.text_content("#cthist"), "vendedora vê a compra no histórico sem o valor")
        ok(not erros2, "sem erros de JavaScript (histórico da vendedora)")
        pg.click("#abaVendas"); pg.wait_for_selector("#vvisita")
        ok(pg.locator("#visitas .visrow").count() == 1 and "Vera Vendedora" in pg.text_content("#visitas"), "o Dono vê a visita registrada pela vendedora")
        ok(not erros, "sem erros de JavaScript (CRM do Dono)")

        # ---------------------------------------------------------------- ranking das vendedoras
        pg, erros = entrar(b, "dono"); abrir(pg)
        pg.click("#abaRanking"); pg.wait_for_selector("#rktab")
        tab = pg.text_content("#rktab").replace("\xa0", " ")
        ok("Vera Vendedora" in tab and "Edu Estoque" in tab and "Dona Linum" not in tab and "R$" in tab, "Dono vê o ranking do mês com a equipe (sem o Dono) e os valores")
        ok(pg.locator("[data-nota]").count() == 0 and "Nota da Dona" not in pg.text_content("#tela") and "Três critérios" in pg.text_content("#tela"),
           "ranking sem a nota da Dona (decisão da Gorette): três critérios")
        ok("Vera Vendedora" in pg.text_content("#rklider") and "Liderando até agora" in pg.text_content("#rklider"), "Vera lidera o mês")
        pg.screenshot(path=os.path.join(SAIDA, "linum_ranking.png"), full_page=True)
        pg.click("#rkano"); pg.wait_for_timeout(500)
        ok("Ranking do ano" in pg.text_content("h2") and "Vera Vendedora" in pg.text_content("#rktab"), "ranking do ano")
        pg.click("#rkant"); pg.wait_for_timeout(500)
        ok("Ninguém da equipe tem vendas" in pg.text_content("#rklider"), "ano anterior sem dados")
        ok(not erros, "sem erros de JavaScript (ranking do Dono)")
        pg, erros = entrar(b, "vendedora"); abrir(pg)
        pg.click("#abaRanking"); pg.wait_for_selector("#rktab")
        eu, outra = pg.text_content(".rkrow.eu").replace("\xa0", " "), pg.text_content('.rkrow:has-text("Edu Estoque")').replace("\xa0", " ")
        ok("Vera Vendedora" in eu and "R$" in eu and "R$" not in outra,
           "vendedora vê o ranking: os próprios valores, sem os valores da colega")
        pg.screenshot(path=os.path.join(SAIDA, "linum_ranking_vendedora.png"), full_page=True)
        ok(not erros, "sem erros de JavaScript (ranking da vendedora)")

        # ---------------------------------------------------------------- produção: rolos, ficha, etapas e estoque
        pg, erros = entrar(b, "estoque"); abrir(pg)
        ok(not pg.is_visible("#abaProducao"), "Estoque sem a permissão Produção não vê a aba Produção")
        pg, erros = entrar(b, "dono"); abrir(pg)
        pg.click("#abaProducao"); pg.wait_for_selector("#pdabas")
        ok("com valores" in pg.text_content(".cabtela"), "Dono vê a produção com valores")
        ok(pg.get_attribute("#pdmapa", "href") == "ajuda/mapa-producao.html", "botão Mapa da produção na aba")
        pg.click('[data-pa="parceiros"]'); pg.wait_for_selector("#pdnovop")
        for nome, tipo, preco in (("Carlos Cortador", "cortador", "8,00"), ("Maria Costureira", "costureira", "25,00"), ("Lavanderia Azul", "lavanderia", "5,00"), ("Passadeira Rosa", "passadoria", "3,00")):
            pg.click("#pdnovop"); pg.wait_for_selector("#dlg2[open] #ppok")
            pg.fill("#ppnome", nome); pg.select_option("#pptipo", tipo); pg.fill("#pppreco", preco)
            if tipo == "costureira": pg.fill("#pptel", "21966665555")
            pg.click("#ppok"); pg.wait_for_timeout(600)
        ok(pg.locator(".pprow").count() == 4 and "R$ 25,00" in pg.text_content("#pdparcs").replace("\xa0", " "), "quatro parceiros com preço por peça")
        pg.click('[data-pa="metragem"]'); pg.wait_for_selector("#mtq"); pg.fill("#mtq", "cal-are"); pg.wait_for_timeout(150)
        pg.fill('[data-mt="10000000-0000-0000-0000-000000000002"]', "2,5"); pg.click('[data-mtok="10000000-0000-0000-0000-000000000002"]'); pg.wait_for_timeout(600)
        ok(float(psql("select consumo_metros from lin_produtos where referencia = 'CAL-ARE'", saida=True)) == 2.5, "metragem por peça salva")
        pg.click('[data-pa="rolos"]'); pg.wait_for_selector("#pdcompra"); pg.click("#pdcompra"); pg.wait_for_selector("#dlg2[open] #rcok")
        pg.fill("#rctec", "Linho puro"); pg.fill("#rccor", "Cru"); pg.fill("#rcqtd", "2"); pg.fill("#rcmet", "30"); pg.fill("#rcvalor", "1.200,00"); pg.fill("#rcforn", "Tecelagem Exemplo")
        pg.click("#rcok"); pg.wait_for_timeout(800)
        ok(pg.locator(".rlrow").count() == 2 and "-001" in pg.text_content("#pdrolos") and "R$ 20,00" in pg.text_content("#pdrolos").replace("\xa0", " "), "compra de 2 rolos de 30 m (R$ 20,00 o metro)")
        # peça nova, ainda sem cores e tamanhos: cria direto na ficha (2.5)
        psql("insert into lin_produtos (referencia, descricao, categoria, preco_venda) values ('BAT-CAD', 'Bata Cadarço', 'Bata', 259)")
        pg.click('[data-pa="fichas"]'); pg.wait_for_selector("#pdnova"); pg.evaluate("carregarProducao()"); pg.wait_for_timeout(400)
        pg.click("#pdnova"); pg.wait_for_selector("#dlg[open] #nfq")
        pg.fill("#nfq", "bat-cad"); pg.wait_for_timeout(150)
        ok("sem cores e tamanhos" in pg.text_content("#nfres") and pg.locator("#nfres [data-v]").count() == 0, "ficha: peça sem cores e tamanhos avisa e oferece cadastrar ali")
        pg.click("#nfres [data-novav]"); pg.fill("#nfres [data-ncor]", "Cru, Azul"); pg.fill("#nfres [data-ntam]", "P, M"); pg.click("#nfres [data-ncriar]"); pg.wait_for_timeout(900)
        ok(pg.locator("#nfres [data-v]").count() == 4 and "4 cor(es)/tamanho(s) criados" in pg.text_content("#nferr")
           and psql("select count(*) from lin_variantes v join lin_produtos p on p.id = v.produto_id where p.referencia = 'BAT-CAD'", saida=True) == "4",
           "ficha: Cru e Azul × P e M criados na peça, prontos para escolher")
        # peça que ainda nem existe no cadastro: "+ Peça nova" na própria ficha
        pg.fill("#nfq", "Vestido Lua"); pg.wait_for_timeout(150)
        ok("+ Peça nova" in pg.text_content("#nfres"), "ficha: peça não encontrada sugere + Peça nova")
        pg.click("#nfpnova"); pg.wait_for_selector("#dlg2[open] #pnok")
        ok(pg.input_value("#pnnome") == "Vestido Lua" and pg.input_value("#pntams") == "PP, P, M, G, GG, G1, G2", "peça nova já vem com o nome digitado e a grade da Linum")
        pg.fill("#pntams", "P, M, G"); pg.fill("#pncores", "Cru, Areia"); pg.fill("#pnmet", "2,2"); pg.fill("#pncat", "Vestido"); pg.click("#pnok"); pg.wait_for_timeout(1000)
        ref = psql("select referencia from lin_produtos where descricao = 'Vestido Lua'", saida=True)
        ok(ref.startswith("NOVA-") and pg.locator("#nfres [data-v]").count() == 6 and "criada" in pg.text_content("#nferr")
           and psql("select consumo_metros || ' ' || preco_venda from lin_produtos where descricao = 'Vestido Lua'", saida=True) == "2.2 0",
           f"peça nova criada ({ref}) com 2 cores × 3 tamanhos e 2,2 m por peça, pronta para a ficha")
        pg.click("#nfres [data-v] >> nth=0"); pg.wait_for_timeout(150)
        ok(pg.input_value('#nfitens [data-k="c"]') == "2,2", "a cor/tamanho da peça nova entra na ficha com a metragem informada")
        pg.click("#nfx")
        pg.click("#pdnova"); pg.wait_for_selector("#dlg[open] #nfq")
        pg.fill("#nfq", "cal-are"); pg.wait_for_timeout(150); pg.click(f'#nfres [data-v="{V_CRU_38}"]'); pg.wait_for_timeout(100)
        pg.fill('#nfitens [data-k="q"]', "4"); pg.wait_for_timeout(100)
        ok(pg.input_value('#nfitens [data-k="c"]') == "2,5" and "10 m" in pg.text_content("#nftot") and not pg.is_visible("[data-atu]"), "ficha: 4 peças × 2,5 m = 10 m de linho (metragem do cadastro)")
        pg.fill('#nfitens [data-k="c"]', "2,6"); pg.wait_for_timeout(100)
        ok(pg.is_visible("[data-atu]") and "10,4 m" in pg.text_content("#nftot"), "metragem trocada na ficha: aparece Atualizar na peça")
        pg.click("[data-atu]"); pg.wait_for_timeout(700)
        ok(float(psql("select consumo_metros from lin_produtos where referencia = 'CAL-ARE'", saida=True)) == 2.6 and not pg.is_visible("[data-atu]"), "Atualizar na peça grava a nova metragem no cadastro")
        pg.fill('#nfitens [data-k="c"]', "2,5"); pg.wait_for_timeout(100)
        pg.select_option("#nfloja", label="Gávea"); pg.fill("#nfmolde", "Molde calça reta")
        pg.click("#nfok"); pg.wait_for_selector("#dlg[open] #fitens")
        ficha = psql("select max(id) from lin_ordens", saida=True)
        ok(f"Ficha nº {ficha}" in pg.text_content("#dlgf") and "Molde calça reta" in pg.text_content("#dlgf"), "ficha criada e aberta")
        pg.click('[data-env="corte"]'); pg.wait_for_selector("#dlg2[open] #envok")
        ok("10 m" in pg.text_content("#envprec") and pg.locator('[data-rolo]').first.input_value() == "10", "envio ao corte: linho necessário já preenchido no primeiro rolo")
        pg.screenshot(path=os.path.join(SAIDA, "linum_producao_corte.png"), full_page=True)
        pg.click("#envok"); pg.wait_for_timeout(900)
        ok(psql("select min(saldo) from lin_rolos", saida=True) == "20.00" and "com o parceiro" in pg.text_content("#fenvios"), "linho saiu do rolo e as peças estão com o cortador")
        pg.click("#fenvios [data-rec]"); pg.wait_for_selector("#dlg2[open] #recok")
        pg.fill("[data-rb]", "3"); pg.fill("[data-rp]", "1"); pg.click("#recok"); pg.wait_for_timeout(400)
        ok("motivo" in pg.text_content("#recerr"), "perda sem motivo não é registrada")
        pg.fill("#dlg2 [data-rm]", "Corte errado"); pg.fill("[data-sobra]", "1,5"); pg.click("#recok"); pg.wait_for_timeout(900)
        ok(psql("select min(saldo) from lin_rolos", saida=True) == "21.50" and "recebido" in pg.text_content("#fenvios"), "conferência do corte: 3 boas, 1 perdida, sobra volta ao rolo")
        ok(pg.locator('[data-env="lavagem"], [data-env="passadoria"]').count() == 0 and pg.locator('[data-marca]').count() == 2, "lavagem e passadoria: só caixa de marcação, sem remessa")
        pg.click('[data-env="costura"]'); pg.wait_for_selector("#dlg2[open] #envok"); pg.click("#envok"); pg.wait_for_timeout(800)
        pg.click("#fenvios [data-rec]"); pg.wait_for_selector("#dlg2[open] #recok"); pg.click("#recok"); pg.wait_for_timeout(800)
        pg.check('[data-marca="lavagem"]'); pg.wait_for_timeout(800)
        ok(pg.is_checked('[data-marca="lavagem"]') and "Lavagem feita" in pg.text_content("#dlgf") and psql("select (lavagem_em is not null)::text from lin_ordens", saida=True) == "true",
           "lavagem marcada como feita (quem e quando)")
        ok("Dar entrada no estoque (3)" in pg.text_content("#dlgf") and "R$ 83,00" in pg.text_content("#fitens").replace("\xa0", " "),
           "depois da costura já dá entrada no estoque; custo por peça R$ 83,00 (linho 50 + corte 8 + costura 25)")
        antes = qtd_banco(V_CRU_38, "Gávea")
        pg.click('[data-env="estoque"]'); pg.wait_for_selector("#dlg2[open] #entok")
        ok(pg.eval_on_selector("#entloja", "s => s.options[s.selectedIndex].text") == "Gávea", "entrada vem com a loja da ficha")
        pg.click("#entok"); pg.wait_for_timeout(900)
        ok(qtd_banco(V_CRU_38, "Gávea") == antes + 3 and "concluída" in pg.text_content("#dlgf")
           and psql("select count(*) from lin_movimentos where tipo = 'producao'", saida=True) == "1", "3 peças entram no estoque da Gávea e a ficha fica concluída")
        pg.screenshot(path=os.path.join(SAIDA, "linum_producao_ficha.png"), full_page=True)
        # compra pelo XML da NF-e (nota fictícia: linho em metros, malha em quilos e um item que não é tecido)
        pg.click("#fx"); pg.click('[data-pa="rolos"]'); pg.wait_for_selector("#pdxml", state="attached")
        xml = ('<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe33261012345678000190550010000012341000012345" versao="4.00">'
               '<ide><nNF>1234</nNF><dhEmi>2026-10-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>12345678000190</CNPJ><xNome>Tecelagem Ficticia Ltda</xNome></emit>'
               '<det nItem="1"><prod><xProd>LINHO MISTO AREIA 1,40M</xProd><uCom>MT</uCom><qCom>61.0000</qCom><vProd>850.00</vProd><vFrete>50.00</vFrete></prod><imposto><IPI><IPITrib><vIPI>0.00</vIPI></IPITrib></IPI></imposto></det>'
               '<det nItem="2"><prod><xProd>MALHA DE LINHO CRU</xProd><uCom>KG</uCom><qCom>12.5000</qCom><vProd>500.00</vProd><vDesc>20.00</vDesc></prod><imposto/></det>'
               '<det nItem="3"><prod><xProd>ETIQUETA BORDADA</xProd><uCom>UN</uCom><qCom>100</qCom><vProd>80.00</vProd></prod><imposto/></det>'
               '</infNFe></NFe></nfeProc>')
        pg.set_input_files("#pdxml", files=[{"name": "nota.xml", "mimeType": "text/xml", "buffer": xml.encode()}]); pg.wait_for_selector("#dlg[open] #nfeok")
        dlg = pg.text_content("#dlgf").replace("\xa0", " ")
        ok("Tecelagem Ficticia Ltda" in dlg and "nº 1234" in dlg and "R$ 900,00" in dlg and "R$ 480,00" in dlg and "unidade não reconhecida" in dlg,
           "XML lido: fornecedor, número, valor de cada item (com frete e desconto) e o item sem unidade de tecido avisado")
        ok(pg.is_checked('[data-nfi="0"]') and pg.is_checked('[data-nfi="1"]') and not pg.is_checked('[data-nfi="2"]') and pg.input_value('[data-nfu="1"]') == "kg",
           "itens de tecido marcados, o resto desmarcado; quilos reconhecido")
        ok(pg.input_value('[data-nfc="0"]') == "Areia" and pg.input_value('[data-nft="0"]') == "LINHO MISTO 1,40M" and pg.input_value('[data-nfc="1"]') == "Cru"
           and pg.input_value('[data-nft="1"]') == "MALHA DE LINHO", "cor sugerida pela descrição do item (a nota não tem campo de cor)")
        # o item 1 entra sem cor, para preencher depois
        pg.fill('[data-nfr="0"]', "2"); pg.fill('[data-nfc="0"]', ""); pg.fill('[data-nft="0"]', "LINHO MISTO AREIA 1,40M")
        pg.screenshot(path=os.path.join(SAIDA, "linum_producao_xml.png"), full_page=True)
        pg.click("#nfeok"); pg.wait_for_timeout(900)
        ok(psql("select string_agg(unidade || ':' || metros_iniciais || ':' || valor_pago, ',' order by codigo) from lin_rolos where nota = '1234'", saida=True) == "m:30.50:450.00,m:30.50:450.00,kg:12.50:480.00"
           and "kg" in pg.text_content("#pdrolos") and "sem rendimento" in pg.text_content("#pdrolos"), "nota importada: 2 rolos de 30,5 m e 1 de 12,5 kg (sem rendimento), valor dividido")
        pg.set_input_files("#pdxml", files=[{"name": "nota.xml", "mimeType": "text/xml", "buffer": xml.encode()}]); pg.wait_for_selector("#dlg[open] #nfeok")
        ok("já importado" in pg.text_content("#dlgf") and pg.is_disabled('[data-nfi="0"]'), "a mesma nota de novo: itens já importados ficam travados")
        pg.click("#nfex")
        # 2.2: preencher as cores que faltam e editar o rolo
        pg.click("#pdcores"); pg.wait_for_selector("#dlg[open] #pcok")
        lm = pg.locator('#dlgf tr:has-text("LINHO MISTO AREIA")')
        ok(lm.count() == 2 and lm.first.locator("[data-pcc]").input_value() == "Areia" and lm.first.locator("[data-pct]").input_value() == "LINHO MISTO 1,40M"
           and pg.input_value('#dlgf tr:has-text("Linho puro") [data-pcx]') == "100% Linho" and pg.input_value('#dlgf tr:has-text("MALHA DE LINHO") [data-pcx]') == "",
           "Preencher cor e composição: rolos sem cor ou sem composição, com a sugestão pela descrição (Linho puro = 100% Linho)")
        lm.first.locator("[data-pcx]").fill("55% Linho 45% Algodão"); lm.nth(1).locator("[data-pcx]").fill("55% Linho 45% Algodão")
        pg.click("#pcok"); pg.wait_for_timeout(900)
        ok(psql("select string_agg(tecido || '|' || cor || '|' || composicao, ',') from lin_rolos where nota = '1234' and unidade = 'm'", saida=True) == "LINHO MISTO 1,40M|Areia|55% Linho 45% Algodão,LINHO MISTO 1,40M|Areia|55% Linho 45% Algodão"
           and psql("select string_agg(distinct composicao, ',') from lin_rolos where tecido = 'Linho puro'", saida=True) == "100% Linho"
           and "100% Linho" in pg.text_content("#pdrolos"), "cor e composição gravadas de uma vez; composição na lista de rolos")
        pg.click('.rlrow:has-text("MALHA DE LINHO")'); pg.wait_for_selector("#dlg[open] #rled"); pg.click("#rled"); pg.wait_for_selector("#dlg2[open] #reok")
        ok(pg.input_value("#recor") == "Cru" and pg.input_value("#revalor") == "480,00", "Editar dados do rolo: dados atuais e valor (Dono)")
        pg.fill("#recor", "Natural"); pg.fill("#recomp", "100% Linho"); pg.fill("#reobs", "Rolo conferido"); pg.click("#reok"); pg.wait_for_timeout(900)
        ok(psql("select cor || '|' || composicao || '|' || observacoes || '|' || saldo from lin_rolos where unidade = 'kg'", saida=True) == "Natural|100% Linho|Rolo conferido|12.50"
           and pg.locator("#pdcores").count() == 0
           and "Rolo conferido" in pg.text_content("#dlgf") and psql("select count(*) from auditoria where acao = 'linum_rolo_alterado'", saida=True) == "5",
           "rolo editado (cor e observação), saldo igual, auditoria por rolo")
        pg.click("#rlx")
        pg.click('[data-pa="painel"]'); pg.wait_for_selector("#pdtela .kpis")
        ok(pg.is_visible("#pdrend") and "Falta o rendimento" in pg.text_content("#pdrend"), "painel lembra o rendimento que falta no rolo comprado por quilo")
        pg.click('[data-pa="rolos"]'); pg.wait_for_selector(".rlrow"); pg.click('.rlrow:has-text("kg")'); pg.wait_for_selector("#dlg[open] #rrendok")
        pg.fill("#rrend", "4"); pg.click("#rrendok"); pg.wait_for_timeout(700)
        ok(psql("select rendimento from lin_rolos where unidade = 'kg'", saida=True) == "4.000" and "50 m" in pg.text_content("#dlgf"), "rendimento salvo: 12,5 kg × 4 m/kg ≈ 50 m")
        pg.click("#rlx"); pg.click('[data-pa="painel"]'); pg.wait_for_selector("#pdtela .kpis")
        ok("Maria Costureira" in pg.text_content("#pdpagl") and "R$ 75,00" in pg.text_content("#pdpagl").replace("\xa0", " "), "a pagar no mês: costureira 3 × R$ 25,00")
        pg.screenshot(path=os.path.join(SAIDA, "linum_producao_painel.png"), full_page=True)
        ok(not erros, "sem erros de JavaScript (produção do Dono)")
        # a Nervia dá a permissão Produção (sem valores) ao Estoque
        pg, erros = entrar(b, "admin"); abrir(pg)
        pg.click("#abaEquipe"); pg.wait_for_selector(".eq-salvar")
        pg.check('tr:has-text("Edu Estoque") .eq-prod'); pg.click('tr:has-text("Edu Estoque") .eq-salvar'); pg.wait_for_timeout(800)
        ok(psql("select permissoes::text from lin_membros where user_id = '00000000-0000-0000-0000-0000000000e1'", saida=True) == "{producao}", "Equipe: permissão Produção dada ao Estoque")
        pg, erros = entrar(b, "estoque"); abrir(pg)
        pg.click("#abaProducao"); pg.wait_for_selector("#pdabas")
        ok("sem valores" in pg.text_content(".cabtela"), "Estoque vê a produção sem valores")
        pg.click('[data-pa="fichas"]'); pg.wait_for_selector("#pdtodas"); pg.click("#pdtodas"); pg.wait_for_timeout(200); pg.click(".pdfrow"); pg.wait_for_selector("#dlg[open] #fitens")
        ok("Custo" not in pg.text_content("#dlgf") and "R$" not in pg.text_content("#dlgf"), "ficha sem custo nem preço por peça")
        pg.click("#fx"); pg.click('[data-pa="rolos"]'); pg.wait_for_timeout(300)
        ok("Valor pago" not in pg.text_content("#pdtela") and not any("valor_pago" in r or "preco_peca" in r or "custo_unitario" in r for r in pg.respostas),
           "o servidor não manda valor pago, preço por peça nem custo para quem não tem a permissão de valores")
        ok(not erros, "sem erros de JavaScript (produção sem valores)")
        pg, erros = entrar(b, "vendedora"); abrir(pg)
        ok(not pg.is_visible("#abaProducao") and not pg.is_visible("#abaCreditos"), "vendedora sem permissão não vê a Produção nem os Créditos")
        # estoque mudou em outra janela (outra pessoa vendeu): ao voltar para esta, o estoque se atualiza sozinho
        antes = qtd_banco(V_AZUL_P, "Gávea")
        psql(f"update lin_estoque set quantidade = 42 where variante_id = '{V_AZUL_P}' and loja_id = (select id from lin_lojas where nome = 'Gávea')")
        ok("42 un." not in pg.text_content("#lista"), "outra janela mudou o estoque: esta ainda mostra o antigo")
        pg.evaluate("ULTIMA_CARGA = 0; document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(800)
        ok("42 un." in pg.text_content("#lista"), "ao voltar para a janela, o estoque é recarregado sozinho")
        psql(f"update lin_estoque set quantidade = {antes} where variante_id = '{V_AZUL_P}' and loja_id = (select id from lin_lojas where nome = 'Gávea')")

        # ---------------------------------------------------------------- horário de trabalho (2.9)
        pg, erros = entrar(b, "dono"); abrir(pg)
        pg.click("#abaHorarios"); pg.wait_for_selector("text=Horário de trabalho")
        ok("sem restrição" in pg.text_content("#tela") and pg.locator('tr:has-text("Vera Vendedora") [data-hor]').count() == 1, "Horários: Dono vê a equipe, sem restrição por padrão")
        pg.click('tr:has-text("Vera Vendedora") [data-hor]'); pg.wait_for_selector("#dlg[open] #hlivre")
        pg.uncheck("#hlivre")
        for k in "12345": pg.check(f'.hdia[data-k="{k}"]')
        pg.fill('.hini[data-k="1"]', "10:00"); pg.fill('.hfim[data-k="1"]', "19:00"); pg.click("#hcopia")
        ok(pg.input_value('.hfim[data-k="5"]') == "19:00", "copiar o horário de segunda para os dias marcados")
        pg.click("#hok"); pg.wait_for_timeout(800)
        ok("Segunda a Sexta 10:00–19:00" in pg.text_content("#tela"), "horário salvo e mostrado em resumo (Segunda a Sexta)")
        # deixa a vendedora sem nenhum dia: fora do horário agora
        pg.click('tr:has-text("Vera Vendedora") [data-hor]'); pg.wait_for_selector("#dlg[open] #hlivre")
        for k in "12345": pg.uncheck(f'.hdia[data-k="{k}"]')
        pg.click("#hok"); pg.wait_for_timeout(800)
        ok("fora do horário" in pg.text_content("#tela"), "Dono vê a vendedora fora do horário")
        ok(not erros, "sem erros de JavaScript (Horários do Dono)")
        pg2, erros2 = entrar(b, "vendedora"); abrir(pg2)
        ok("Fora do seu horário" in pg2.text_content("#aviso") and not pg2.is_visible("#app"), "vendedora fora do horário não abre o app")
        pg2.screenshot(path=os.path.join(SAIDA, "linum_fora_do_horario.png"), full_page=True)
        ok(psql("select count(*) from auditoria where acao = 'linum_fora_do_horario'", saida=True) == "1", "tentativa fora do horário na auditoria")
        # liberação extra pelo Dono
        pg.click('tr:has-text("Vera Vendedora") [data-hor]'); pg.wait_for_selector("#dlg[open] #hextra")
        pg.fill("#hextra", pg.evaluate("new Date(Date.now() + 2*3600e3 - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)"))
        pg.click("#hok"); pg.wait_for_timeout(800)
        ok("liberação extra até" in pg.text_content("#tela") and "pode abrir" in pg.text_content('tr:has-text("Vera Vendedora")'), "liberação extra registrada")
        pg2, erros2 = entrar(b, "vendedora"); abrir(pg2)
        ok(pg2.is_visible("#app"), "com a liberação extra a vendedora abre o app")
        # o horário acaba com o app aberto: a tela fecha sozinha
        psql("update lin_membros set horario_extra_ate = null where user_id = '00000000-0000-0000-0000-0000000000b1'")
        pg2.evaluate("ULTIMA_CARGA = 0; document.dispatchEvent(new Event('visibilitychange'))"); pg2.wait_for_timeout(800)
        ok("Fora do seu horário" in pg2.text_content("#aviso") and not pg2.is_visible("#app"), "horário acabou com o app aberto: a tela fecha")
        ok(not erros2, "sem erros de JavaScript (vendedora fora do horário)")
        pg.click('tr:has-text("Vera Vendedora") [data-hor]'); pg.wait_for_selector("#dlg[open] #hlivre")
        pg.check("#hlivre"); pg.click("#hok"); pg.wait_for_timeout(800)
        ok(psql("select horario is null from lin_membros where user_id = '00000000-0000-0000-0000-0000000000b1'", saida=True) == "t"
           and psql("select count(*) from auditoria where acao = 'linum_horario_alterado'", saida=True) == "4", "volta a sem restrição; cada mudança na auditoria")
        pg2, erros2 = entrar(b, "vendedora"); abrir(pg2)
        ok(pg2.is_visible("#app") and not pg2.is_visible("#abaHorarios") and not pg2.is_visible("#abaCustos"), "sem restrição a vendedora entra; ela não vê as abas Horários e Custos")

        # ---------------------------------------------------------------- celular, iframe, ajuda e quem não tem acesso
        pg, erros = entrar(b, "vendedora", largura=390); abrir(pg)
        ok(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "celular sem rolagem lateral")
        pg.screenshot(path=os.path.join(SAIDA, "linum_celular.png"), full_page=True)
        pg.set_content(f'<iframe src="http://127.0.0.1:{PORTA_SITE}/apps/linum/" width="900" height="600"></iframe>'); pg.wait_for_timeout(1500)
        fr = pg.frames[1]
        ok(fr.evaluate("document.documentElement.classList.contains('embutido')") and not fr.is_visible(".topo"), "dentro da Área do Cliente esconde o próprio topo")
        pg, erros = entrar(b, "outro"); abrir(pg)
        ok("não tem acesso" in pg.text_content("#aviso") and not pg.is_visible("#app"), "login sem o app não vê o estoque")
        for pagina in ("cartao", "manual", "mapa", "mapa-producao"):
            abrir_ajuda = pg.goto(f"http://127.0.0.1:{PORTA_SITE}/apps/linum/ajuda/{pagina}.html")
            ok(abrir_ajuda.ok and "Sistema Linum" in pg.title() and pg.locator('script[src="/marca-dagua.js"][data-tipo="doc"]').count() == 1, f"ajuda: {pagina} com marca d'água")
        pg.goto(f"http://127.0.0.1:{PORTA_SITE}/ajuda/novidades.html?app=linum&nome=Sistema%20Linum"); pg.wait_for_timeout(400)
        ok("2.20" in pg.text_content("body"), "novidades do app (versão 2.20)")
        ok(psql("select mapa_url from apps where id = 'linum'", saida=True) == "/apps/linum/ajuda/mapa.html", "botão Mapa ligado no cadastro do app")
        b.close()
    print("TODOS OS TESTES DE TELA DO SISTEMA LINUM OK")
finally:
    api.terminate(); srv.shutdown()
    if os.path.exists(conf): os.remove(conf)
