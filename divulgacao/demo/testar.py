"""Teste da demonstração (site/demo/) no Chromium, sem rede. Uso: python3 divulgacao/demo/testar.py [pasta_prints]"""
import os, sys, threading, http.server, functools
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAIDA = sys.argv[1] if len(sys.argv) > 1 else "/tmp"
_cj = "/tmp/claude-0/cjs/package/dist/chart.umd.js"
CHARTJS = open(_cj, encoding="utf-8").read() if os.path.exists(_cj) else "window.Chart=class{constructor(){}update(){}destroy(){}}"
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8833), functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(RAIZ, "site")))
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
U = "http://127.0.0.1:8833"
erros, externos = [], []

def preparar(ctx):
    ctx.on("page", lambda p: p.on("pageerror", lambda e: erros.append(str(e))))
    def rota(r):
        url = r.request.url
        if url.startswith(U): return r.continue_()
        if "Chart.js" in url: return r.fulfill(body=CHARTJS, content_type="text/javascript")
        if "fonts.googleapis" in url or "fonts.gstatic" in url: return r.fulfill(body="", content_type="text/css")
        externos.append(url); return r.abort()
    ctx.route("**/*", rota)

with sync_playwright() as p:
    b = p.chromium.launch(env={**os.environ, "LANG": "pt_BR.UTF-8", "LANGUAGE": "pt_BR:pt"})
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, locale="pt-BR", accept_downloads=True)
    preparar(ctx)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: erros.append(str(e)))

    # 1. entra direto (sessão de demonstração) e vê os 2 apps
    pg.goto(f"{U}/demo/"); pg.wait_for_selector(".app")
    assert pg.locator(".app").count() == 2, pg.inner_text("body")
    assert "Demonstração" in pg.inner_text("#demoFaixa")
    pg.screenshot(path=f"{SAIDA}/demo_portal.png")

    # 2. Buscador no iframe
    pg.locator(".app", has_text="Notas Fiscais").click(); pg.wait_for_selector("#vVisor:not(.oculto)")
    fr = pg.frame_locator("iframe").first
    fr.locator("table tbody tr").first.wait_for()
    linhas = fr.locator("table tbody tr").count()
    texto = fr.locator("body").inner_text()
    assert linhas > 50, linhas
    for t in ("só resumo", "manifestada", "Cancelada", "TEXTIL HORIZONTE", "FIBRA NET"):
        assert t in texto, t
    assert "Buscar NF-e agora" not in texto  # visão de cliente
    pg.screenshot(path=f"{SAIDA}/demo_buscador.png")
    # busca por fornecedor
    fr.locator("input[placeholder^='Fornecedor']").fill("textil"); pg.wait_for_timeout(700)
    t2 = fr.locator("table tbody").inner_text()
    assert "TEXTIL" in t2 and "PAPELARIA" not in t2, t2[:300]
    fr.locator("input[placeholder^='Fornecedor']").fill(""); pg.wait_for_timeout(700)
    # XML: baixa sem sair da página
    with pg.expect_download() as d:
        fr.locator("button.lnk", has_text="XML").first.click()
    xml = open(d.value.path(), encoding="utf-8").read()
    assert ("<nfeProc" in xml and "FICTICIA" in xml) or "<resNFe" in xml or ("<NFSe" in xml and "FICTICIA" in xml), xml[:200]
    assert fr.locator("table tbody tr").count() == linhas  # continua na tela
    # CSV das marcadas
    fr.locator(".ck").nth(0).check(); fr.locator(".ck").nth(1).check()
    with pg.expect_download() as d:
        fr.locator("button", has_text="Exportar CSV").click()
    csv = open(d.value.path(), encoding="utf-8-sig").read().strip().splitlines()
    assert len(csv) == 3, csv
    # espelho das marcadas (nova aba), uma folha por nota
    with ctx.expect_page() as nova:
        fr.locator("button", has_text="Imprimir espelho").click()
    esp = nova.value; esp.wait_for_load_state(); esp.wait_for_timeout(1200)
    assert esp.locator(".folha").count() == 2, esp.inner_text("body")[:300]
    esp.screenshot(path=f"{SAIDA}/demo_espelho.png", full_page=True); esp.close()
    # cartão de ajuda ao lado
    pg.click("#bCartao"); pg.wait_for_selector("#painelAjuda:not(.oculto)")
    pg.click("#bCartao")

    # 3. espelho da NF-e só com resumo e de uma NFS-e
    ids = pg.evaluate("""async () => { const c = supabase.createClient(); const { data } = await c.from('nf_notas').select('*');
        const r = data.find(n => n.tipo==='NFE' && !n.completo && !n.manifestada); const s = data.find(n => n.tipo==='NFSE');
        const e = data.find(n => n.tipo==='NFE' && n.completo && n.papel==='recebida'); return [r.id, s.id, e.id]; }""")
    esp = ctx.new_page(); esp.goto(f"{U}/demo/apps/notas/espelho.html?ids={','.join(map(str, ids))}"); esp.wait_for_timeout(1500)
    te = esp.inner_text("body")
    assert esp.locator(".folha").count() == 3 and "SEM VALOR FISCAL" in te and "DANFSe" in te and "DANFE" in te, te[:400]
    esp.close()

    # 4. Painel de Notas
    pg.goto(f"{U}/demo/#app/painel-nf"); pg.wait_for_selector("#vVisor:not(.oculto)")
    fp = pg.frame_locator("iframe").first
    fp.locator("#painel:not(.oculto)").wait_for(); pg.wait_for_timeout(1200)
    k = fp.locator("#kpis").inner_text()
    assert "R$" in k and fp.locator("#tbForn tr").count() >= 9, k
    pg.screenshot(path=f"{SAIDA}/demo_painel.png")
    assert fp.locator("#fPapel").is_hidden(), "visão Vendas desligada"
    fp.locator("#fEmpresa").select_option("12345678000271"); pg.wait_for_timeout(500)
    assert "TEXTIL HORIZONTE" not in fp.locator("#tbForn").inner_text()  # filial não compra da têxtil

    # 5. sair e entrar com qualquer e-mail/senha
    pg.goto(f"{U}/demo/"); pg.wait_for_selector(".app")
    pg.click("text=Sair"); pg.wait_for_selector("#vLogin:not(.oculto)")
    pg.fill("#lEmail", "teste@cliente.com.br"); pg.fill("#lSenha", "1234"); pg.keyboard.press("Enter")
    pg.wait_for_selector(".app")

    # 6. celular
    m = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, locale="pt-BR"); preparar(m)
    mp = m.new_page(); mp.goto(f"{U}/demo/"); mp.wait_for_selector(".app"); mp.screenshot(path=f"{SAIDA}/demo_celular.png")
    mp.locator(".app", has_text="Painel de Notas").click(); mp.wait_for_timeout(1800); mp.screenshot(path=f"{SAIDA}/demo_celular_painel.png")
    b.close()

assert not erros, erros
assert not externos, externos
print("demo OK")
