"""Teste da tela com Playwright, trocando o supabase-js por uma versão em memória (testes/supabase_falso.js).
Uso: python3 testes/tela_test.py [pasta_para_prints]
"""
import os, sys, threading, http.server, functools
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, "testes")
FALSO = open(os.path.join(RAIZ, "testes", "supabase_falso.js"), encoding="utf-8").read()
CONFIG = 'window.BUSCADOR_CONFIG={SUPABASE_URL:"https://teste.supabase.co",SUPABASE_ANON_KEY:"x",NFE_HABILITADA:true};'

srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8811),
    functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(RAIZ, "site")))
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()

def nova(b):
    pg = b.new_page(viewport={"width": 1400, "height": 860})
    erros = []
    pg.on("pageerror", lambda e: erros.append(str(e)))
    pg.route("**/supabase-js@*/**", lambda r: r.fulfill(body=FALSO, content_type="text/javascript"))
    pg.route("**/config.js", lambda r: r.fulfill(body=CONFIG, content_type="text/javascript"))
    pg.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
    return pg, erros

def abrir(b, papel):
    pg = b.new_page(viewport={"width": 1400, "height": 860})
    erros = []
    pg.on("pageerror", lambda e: erros.append(str(e)))
    pg.route("**/supabase-js@*/**", lambda r: r.fulfill(body=FALSO, content_type="text/javascript"))
    pg.route("**/config.js", lambda r: r.fulfill(body=CONFIG, content_type="text/javascript"))
    pg.goto(f"http://127.0.0.1:8811/apps/notas/?papel={papel}")
    pg.wait_for_selector("#tab table")
    return pg, erros

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------------- admin
    pg, erros = abrir(b, "admin")
    assert pg.locator(".emp").count() == 2
    pg.click(".emp >> text=Nervia"); pg.wait_for_selector("text=próxima liberada")
    assert pg.locator("#tab tbody tr").count() == 5
    assert "8.550,60" in pg.inner_text("#kpis"), pg.inner_text("#kpis")
    assert "próxima liberada" in pg.inner_text("#painel")
    pg.screenshot(path=f"{SAIDA}/tela_admin.png")
    pg.fill("#xQ", "kalunga"); pg.wait_for_timeout(600)
    assert pg.locator("#tab tbody tr").count() == 1
    pg.fill("#xQ", ""); pg.wait_for_timeout(600)
    pg.select_option("#xSit", "Cancelada"); pg.wait_for_timeout(300)
    assert pg.locator("#tab tbody tr").count() == 1
    pg.select_option("#xSit", ""); pg.wait_for_timeout(300)
    pg.click("#bNfe"); pg.wait_for_selector("#msgP.ok")
    assert "Novas: 3" in pg.inner_text("#msgP")
    assert pg.locator("#xSit").input_value() == ""
    pg.locator(".ck").first.check()
    pg.once("dialog", lambda d: d.accept())
    pg.click("text=Dar ciência nas selecionadas"); pg.wait_for_selector("#msgP.ok")
    assert "Ciência registrada em 1" in pg.inner_text("#msgP")
    # empresa sem certificado: botões desligados, formulário de envio
    pg.click(".emp >> text=Linum"); pg.wait_for_selector("#cArq")
    assert pg.locator("#bNfe").is_disabled()
    # nova empresa
    pg.click("text=+ Adicionar empresa"); pg.fill("#fNome", "iGuardei"); pg.fill("#fCnpj", "33.333.333/0001-33")
    pg.click("#novaBox >> text=Salvar"); pg.wait_for_selector("text=Envie o certificado A1")
    assert pg.locator(".emp").count() == 3
    # logins
    pg.click("text=Quem vê cada empresa"); pg.wait_for_selector("h1:has-text('Quem vê cada empresa')")
    assert pg.locator(".usu").count() == 2, "só logins de clientes (sem admin)"
    pg.screenshot(path=f"{SAIDA}/tela_logins.png")
    assert not erros, erros

    # ---------------- cliente
    pg, erros = abrir(b, "cliente")
    assert pg.locator(".emp").count() == 1, "cliente deve ver só a Linum"
    assert "Linum" in pg.inner_text(".emp")
    assert pg.locator("#bNfe").count() == 0 and pg.locator(".ck").count() == 0
    assert pg.locator("text=Gerenciar logins").is_hidden()
    assert pg.locator("#cArq").count() == 0, "cliente não vê envio de certificado"
    assert pg.locator("#tab tbody tr").count() == 5
    with pg.expect_download() as d:
        pg.click("text=Exportar CSV")
    csv = open(d.value.path(), encoding="utf-8-sig").read()
    assert csv.count("\n") == 5 and "KALUNGA" in csv
    pg.screenshot(path=f"{SAIDA}/tela_cliente.png")
    assert not erros, erros
    # celular
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(200)
    assert pg.evaluate("document.documentElement.scrollWidth") <= 390, "rolagem horizontal no celular"
    pg.screenshot(path=f"{SAIDA}/tela_celular.png")

    # ---------------- Área do Cliente: admin
    pg, erros = nova(b)
    pg.goto("http://127.0.0.1:8811/cliente/?papel=admin"); pg.wait_for_selector(".app")
    assert pg.locator(".app").count() == 1, "app inativo não aparece na grade"
    pg.screenshot(path=f"{SAIDA}/portal_apps.png")
    pg.click(".app >> text=Notas Fiscais"); pg.wait_for_selector("#vVisor:not(.oculto)")
    assert pg.url.endswith("/cliente/?papel=admin#app/notas"), "deve continuar na página da Nervia: " + pg.url
    quadro = pg.frame_locator("#frame")
    quadro.locator("#tab table").wait_for()
    assert quadro.locator("header").is_hidden(), "dentro do portal o topo do app some"
    assert pg.locator("header .area").is_visible()
    pg.screenshot(path=f"{SAIDA}/portal_app_aberto.png")
    pg.reload(); pg.wait_for_selector("#vVisor:not(.oculto)")  # F5 mantém o app aberto
    pg.click("text=← Meus aplicativos"); pg.wait_for_selector("#vApps:not(.oculto)")
    pg.click("#bAdmin"); pg.wait_for_selector("text=Novo login")
    assert pg.locator(".usu").count() == 3
    pg.fill("#nNome", "Fulano"); pg.fill("#nEmail", "fulano@cliente.com"); pg.fill("#nSenha", "12345678")
    pg.locator("#nApps input").first.check(); pg.click("text=Criar login"); pg.wait_for_selector("#msgAdm.ok")
    pg.screenshot(path=f"{SAIDA}/portal_admin.png")
    pg.click("#abaApps"); pg.wait_for_selector("text=Novo aplicativo")
    nv = pg.locator(".cartao").last
    nv.locator(".fId").fill("relatorios"); nv.locator(".fNome").fill("Relatórios"); nv.locator(".fUrl").fill("/apps/relatorios/")
    nv.locator("text=Adicionar aplicativo").click(); pg.wait_for_selector("#msgAdm.ok")
    nv = pg.locator(".cartao").last
    nv.locator(".fId").fill("Com Espaço"); nv.locator(".fNome").fill("X"); nv.locator(".fUrl").fill("/x/")
    nv.locator("text=Adicionar aplicativo").click(); pg.wait_for_selector("#msgAdm.err")
    assert not erros, erros

    # ---------------- Área do Cliente: cliente com app / sem app
    pg, erros = nova(b)
    pg.goto("http://127.0.0.1:8811/cliente/?papel=cliente"); pg.wait_for_selector(".app")
    assert pg.locator("#bAdmin").is_hidden()
    assert pg.locator(".app").count() == 1
    pg.click(".app"); quadro = pg.frame_locator("#frame"); quadro.locator("#tab table").wait_for()
    assert quadro.locator(".emp").count() == 1, "cliente vê só a empresa liberada dentro do app"
    pg.goto("http://127.0.0.1:8811/cliente/?papel=cliente#admin"); pg.wait_for_timeout(500)
    assert pg.locator("#vAdmin").is_hidden(), "cliente não entra na administração"
    pg.set_viewport_size({"width": 390, "height": 844}); pg.goto("http://127.0.0.1:8811/cliente/?papel=cliente"); pg.wait_for_selector(".app")
    assert pg.evaluate("document.documentElement.scrollWidth") <= 390
    pg.screenshot(path=f"{SAIDA}/portal_celular.png")
    pg2, erros2 = nova(b)
    pg2.goto("http://127.0.0.1:8811/cliente/?papel=semapp"); pg2.wait_for_selector(".vazio")
    assert "Nenhum aplicativo" in pg2.inner_text(".vazio")
    assert not erros and not erros2, (erros, erros2)

    # ---------------- site público: link da Área do Cliente
    pg, erros = nova(b)
    pg.goto("http://127.0.0.1:8811/"); pg.wait_for_selector("text=Área do Cliente")
    assert pg.locator("img[alt='Nervia Tecnologia']").first.evaluate("i => i.naturalWidth") > 0, "logo carregou"
    pg.screenshot(path=f"{SAIDA}/site_nervia.png")
    b.close()
print("TESTES DE TELA OK")
