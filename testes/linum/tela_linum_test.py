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

def chips(pg): return pg.eval_on_selector_all(".prod", "cs => cs.map(c => c.querySelector('h2').textContent + ' @ ' + c.querySelector('.selo').textContent + ': ' + [...c.querySelectorAll('.chip')].map(x => x.querySelector('b').textContent + ' ' + x.querySelector('small').textContent + '=' + x.querySelector('strong').textContent).join(', '))")
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
           "um cartão por produto e loja, tamanhos na ordem P M G, zerados ocultos")
        ok(pg.text_content("#resumo").startswith("2 produto(s) · 13 peça(s)"), "resumo de produtos e peças")
        ok("R$ 590,00" in pg.text_content(".prod >> nth=0").replace("\xa0", " "), "peça especial (edição) com preço próprio no quadrado")
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
        pg.fill("#nv_c", "Areia, Preto"); pg.fill("#nv_t", "P, M"); pg.click("#pfs"); pg.wait_for_timeout(900)
        ok("Produto cadastrado; 4 variação(ões) nova(s)." in pg.text_content("#dlgf .msg.ok"), "novo produto com cores × tamanhos")
        ok(psql("select preco_venda || ' ' || preco_custo || ' ' || codigo_barras from lin_produtos where referencia = 'SAI-DUN'", saida=True).endswith("0000236")
           and psql("select preco_venda || ' ' || preco_custo from lin_produtos where referencia = 'SAI-DUN'", saida=True) == "1299.90 80.50",
           "preços com vírgula gravados certo e código de barras automático")
        pg.fill('#dlgf [data-e="cor"]', "Areia"); pg.fill('#dlgf [data-e="tamanho"]', "M"); pg.fill('#dlgf [data-e="edicao"]', "Bordada"); pg.fill('#dlgf [data-e="preco_venda"]', "1.590,00")
        pg.click("#espadd"); pg.wait_for_timeout(800)
        ok("Peça especial acrescentada" in pg.text_content("#dlgf") and psql("select preco_venda || ' ' || (codigo_barras like '%0000237') from lin_variantes where edicao = 'Bordada' and cor = 'Areia'", saida=True) == "1590.00 true",
           "peça especial com preço e código próprios")
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

        # ---------------------------------------------------------------- troca (a opção "Troca" da boleta)
        pg.click("#vnova"); pg.wait_for_selector("#dlg[open] #nvloja")
        pg.fill("#nvpq", "ves-mar"); pg.wait_for_timeout(150); pg.click('#nvres [data-add="0"]'); pg.wait_for_timeout(150)
        pg.select_option('#nvpags [data-k="forma"]', "pix"); pg.click("#nvok"); pg.wait_for_timeout(1000)
        venda = psql("select max(id) from lin_vendas where cancelada_em is null and loja_id = (select id from lin_lojas where nome = 'Ipanema')", saida=True)
        p_ipa, p_gav, m_gav = qtd_banco(V_AZUL_P, "Ipanema"), qtd_banco(V_AZUL_P, "Gávea"), qtd_banco(V_AZUL_M, "Gávea")
        pg.click("#vtroca"); pg.wait_for_selector("#dlg[open] #trvnum")
        pg.select_option("#trloja", label="Gávea")
        pg.fill("#trvnum", "999999"); pg.click("#trvbusca"); pg.wait_for_timeout(500)
        ok("não encontrada" in pg.text_content("#trerr"), "troca: venda inexistente avisa")
        pg.fill("#trvnum", venda); pg.click("#trvbusca"); pg.wait_for_timeout(600)
        ok("pode trocar 1" in pg.text_content("#trdevbox") and "Azul P" in pg.text_content("#trdevbox"), "troca: a venda mostra as peças que podem ser trocadas")
        pg.click('#trdevbox [data-devv="0"]'); pg.wait_for_timeout(150)
        pg.click("#trok"); pg.wait_for_timeout(300)
        ok("leva" in pg.text_content("#trerr"), "troca: sem a peça levada não registra")
        pg.fill("#trpq", "ves-mar"); pg.wait_for_timeout(150)
        ok("Azul M" in pg.text_content("#trres") and f"{m_gav} na loja" in pg.text_content("#trres"), "troca: peça levada do estoque da loja da troca")
        pg.click('#trres .vlin:has-text("Azul M") [data-nadd]'); pg.wait_for_timeout(150)
        pg.fill('#trnovas [data-k="vu"]', "600,00"); pg.wait_for_timeout(100)
        dif = pg.text_content("#trdif").replace("\xa0", " ")
        ok("A cliente paga" in pg.text_content("#trdiftxt") and pg.is_visible("#trforma"), f"troca: diferença a pagar ({dif}) com forma de pagamento")
        pg.select_option("#trforma", "credito"); pg.select_option("#trparc", "2"); pg.fill("#trobs", "Tamanho não serviu")
        pg.screenshot(path=os.path.join(SAIDA, "linum_troca.png"), full_page=True)
        pg.click("#trok"); pg.wait_for_timeout(1000)
        ok("registrada" in pg.text_content("#msg") and not pg.is_visible("#dlg") and pg.locator(".trow").count() == 1, "troca registrada e listada nas Trocas do período")
        ok(qtd_banco(V_AZUL_P, "Gávea") == p_gav + 1 and qtd_banco(V_AZUL_M, "Gávea") == m_gav - 1 and qtd_banco(V_AZUL_P, "Ipanema") == p_ipa,
           "troca: devolvida entra e levada sai do estoque da loja da troca")
        ok(psql(f"select venda_id || ' ' || (pagamentos->0->>'forma') || ' ' || (pagamentos->0->>'parcelas') || ' ' || (diferenca = valor_novas - valor_devolvido) from lin_trocas", saida=True) == f"{venda} credito 2 true",
           "troca gravada com a venda, a diferença e o pagamento")
        ok(psql("select comissao_valor from lin_vendas where id = " + venda, saida=True) == psql("select round(valor_total * comissao_pct / 100, 2) from lin_vendas where id = " + venda, saida=True), "troca não muda a comissão da venda")
        pg.click(".trow"); pg.wait_for_selector("#tfechar")
        ok(pg.locator("#tcanc").count() == 0 and "Tamanho não serviu" in pg.text_content("#dlgf"), "vendedora vê a troca mas não cancela")
        pg.click("#tfechar")
        pg.click("#vtroca"); pg.wait_for_selector("#dlg[open] #trvnum"); pg.fill("#trvnum", venda); pg.click("#trvbusca"); pg.wait_for_timeout(600)
        ok("já trocada" in pg.text_content("#trdevbox") and pg.locator("#trdevbox [data-devv]").count() == 0, "peça já trocada não pode ser trocada de novo")
        pg.click('[data-modo="avulsa"]'); pg.fill("#trdq", "ves-mar"); pg.wait_for_timeout(150); pg.click('#trdres [data-dadd="0"]'); pg.wait_for_timeout(150)
        pg.fill('#trdev [data-k="vu"]', "700,00"); pg.fill("#trpq", "ves-mar"); pg.wait_for_timeout(150); pg.click('#trres [data-nadd="0"]'); pg.wait_for_timeout(150)
        pg.fill('#trnovas [data-k="vu"]', "100,00"); pg.wait_for_timeout(100)
        ok("A loja devolve" in pg.text_content("#trdiftxt") and pg.is_visible("#trdevforma"), "compra antiga: valor devolvido maior e pergunta como devolver")
        pg.click("#trok"); pg.wait_for_timeout(600)
        ok("volta para a cliente" in pg.text_content("#trerr"), "sem escolher como devolver não registra")
        pg.click("#trx")
        ok(not erros, "sem erros de JavaScript (troca)")
        pg, erros = entrar(b, "dono"); abrir(pg)
        pg.on("dialog", lambda d: d.accept("Lançada por engano"))
        pg.click("#abaVendas"); pg.wait_for_selector(".trow"); pg.click(".trow"); pg.wait_for_selector("#tcanc"); pg.click("#tcanc"); pg.wait_for_timeout(1000)
        ok("cancelada" in pg.text_content("#msg") and qtd_banco(V_AZUL_P, "Gávea") == p_gav and qtd_banco(V_AZUL_M, "Gávea") == m_gav, "Dono cancela a troca: o estoque volta ao que era")
        ok(psql("select count(*) from auditoria where acao in ('linum_troca_registrada', 'linum_troca_cancelada')", saida=True) == "2", "troca e cancelamento na auditoria")
        ok(not erros, "sem erros de JavaScript (cancelar troca)")

        # ---------------------------------------------------------------- celular, iframe, ajuda e quem não tem acesso
        pg, erros = entrar(b, "vendedora", largura=390); abrir(pg)
        ok(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "celular sem rolagem lateral")
        pg.screenshot(path=os.path.join(SAIDA, "linum_celular.png"), full_page=True)
        pg.set_content(f'<iframe src="http://127.0.0.1:{PORTA_SITE}/apps/linum/" width="900" height="600"></iframe>'); pg.wait_for_timeout(1500)
        fr = pg.frames[1]
        ok(fr.evaluate("document.documentElement.classList.contains('embutido')") and not fr.is_visible(".topo"), "dentro da Área do Cliente esconde o próprio topo")
        pg, erros = entrar(b, "outro"); abrir(pg)
        ok("não tem acesso" in pg.text_content("#aviso") and not pg.is_visible("#app"), "login sem o app não vê o estoque")
        for pagina in ("cartao", "manual", "mapa"):
            abrir_ajuda = pg.goto(f"http://127.0.0.1:{PORTA_SITE}/apps/linum/ajuda/{pagina}.html")
            ok(abrir_ajuda.ok and "Sistema Linum" in pg.title() and pg.locator('script[src="/marca-dagua.js"][data-tipo="doc"]').count() == 1, f"ajuda: {pagina} com marca d'água")
        pg.goto(f"http://127.0.0.1:{PORTA_SITE}/ajuda/novidades.html?app=linum&nome=Sistema%20Linum"); pg.wait_for_timeout(400)
        ok("1.6" in pg.text_content("body"), "novidades do app (versão 1.6)")
        ok(psql("select mapa_url from apps where id = 'linum'", saida=True) == "/apps/linum/ajuda/mapa.html", "botão Mapa ligado no cadastro do app")
        b.close()
    print("TODOS OS TESTES DE TELA DO SISTEMA LINUM OK")
finally:
    api.terminate(); srv.shutdown()
    if os.path.exists(conf): os.remove(conf)
