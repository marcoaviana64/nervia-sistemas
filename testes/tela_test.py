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
    # seleção em todas as linhas + espelho para impressão
    assert pg.locator(".ck").count() == 5, "toda linha tem caixa de seleção"
    pg.check("#ckTodas"); assert pg.locator(".ck:checked").count() == 5 and "5 selecionada" in pg.inner_text("#nSel")
    pg.uncheck("#ckTodas"); assert pg.locator(".ck:checked").count() == 0
    pg.click("text=Imprimir espelho"); pg.wait_for_selector("#msgP.info")
    assert "Marque" in pg.inner_text("#msgP")
    # ciência só considera NF-e com resumo: marcar uma NFS-e avisa e não chama a função
    linha_nfse = pg.locator("#tab tbody tr", has_text="LINK FIBRA")
    linha_nfse.locator(".ck").check()
    antes = len(pg.evaluate("window.__chamadas"))
    pg.click("text=Dar ciência nas selecionadas"); pg.wait_for_selector("#msgP.info")
    assert "não há NF-e" in pg.inner_text("#msgP")
    assert not [c for c in pg.evaluate("window.__chamadas")[antes:] if c[0] == "fn:ciencia"]
    pg.check("#ckTodas")
    with pg.expect_popup() as pop:
        pg.click("text=Imprimir espelho")
    esp = pop.value
    esp.route("**/supabase-js@*/**", lambda r: r.fulfill(body=FALSO, content_type="text/javascript"))
    esp.route("**/config.js", lambda r: r.fulfill(body=CONFIG, content_type="text/javascript"))
    esp.reload(); esp.wait_for_selector(".folha")
    assert esp.locator(".folha").count() == 5
    txt = esp.inner_text("#saida")
    assert txt.count("DANFE") >= 2 and "DANFSe v1.0" in txt and "ESPELHO DE RESUMO" in txt and "CANCELADA" in txt, txt[:500]
    assert "CABO DE REDE CAT6" in txt and "LINK DEDICADO 500 MEGA" in txt and "333260000123456" in txt
    assert esp.locator("svg.cb rect").count() > 50, "código de barras da chave"
    assert "só com resumo" in esp.inner_text("#info")
    esp.screenshot(path=f"{SAIDA}/espelho_danfe.png", full_page=False)
    esp.locator(".folha", has_text="DANFSe").first.screenshot(path=f"{SAIDA}/espelho_danfse.png")
    esp.emulate_media(media="print"); esp.pdf(path=f"{SAIDA}/espelhos.pdf", format="A4")
    import re as _re
    paginas = len(_re.findall(rb"/Type\s*/Page[^s]", open(f"{SAIDA}/espelhos.pdf", "rb").read()))
    assert paginas == 5, f"uma nota por folha: 5 notas, {paginas} páginas"
    esp.close()
    # espelho de uma linha só
    with pg.expect_popup() as pop:
        linha_nfse.locator("text=espelho").click()
    assert "ids=" in pop.value.url
    pop.value.close()
    pg.uncheck("#ckTodas")

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
    assert pg.locator("#bNfe").count() == 0 and pg.locator("text=Dar ciência").count() == 0
    assert pg.locator(".ck").count() == 5, "cliente também seleciona linhas (espelho/CSV)"
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

    # ---------------- ajuda do app: cartão rápido e manual no painel ao lado
    pg, erros = nova(b)
    pg.goto("http://127.0.0.1:8811/cliente/?papel=cliente#app/notas"); pg.wait_for_selector("#vVisor:not(.oculto)")
    pg.click("#bCartao"); pg.wait_for_selector("#painelAjuda:not(.oculto)")
    pg.frame_locator("#frameAjuda").locator("text=Cartão de referência").first.wait_for()
    assert "Cartão rápido" in pg.inner_text("#tituloAjuda")
    pg.frame_locator("#frame").locator("#tab table").wait_for()  # o app continua aberto ao lado
    pg.screenshot(path=f"{SAIDA}/portal_ajuda.png")
    pg.click("#bManual"); pg.frame_locator("#frameAjuda").locator("text=Tarefas da equipe Nervia").first.wait_for()
    pg.click("text=Fechar ✕"); assert pg.locator("#painelAjuda").is_hidden()
    for pag in ["cartao", "manual"]:
        pg.goto(f"http://127.0.0.1:8811/apps/notas/ajuda/{pag}.html")
        assert pg.locator("img").first.evaluate("i => i.naturalWidth") > 0
        assert pg.evaluate("getComputedStyle(document.body).fontSize") == "14px", "ajuda.css carregou"
    pg.set_viewport_size({"width": 390, "height": 844})
    for pag in ["cartao", "manual"]:
        pg.goto(f"http://127.0.0.1:8811/apps/notas/ajuda/{pag}.html")
        assert pg.evaluate("document.documentElement.scrollWidth") <= 390, f"{pag}: rolagem horizontal no celular"
    pg.screenshot(path=f"{SAIDA}/ajuda_celular.png", full_page=True)
    assert not erros, erros

    # ---------------- esqueci minha senha + contato
    pg, erros = nova(b)
    pg.goto("http://127.0.0.1:8811/cliente/?papel=anon"); pg.wait_for_selector("#vLogin:not(.oculto)")
    pg.fill("#lEmail", "financeiro@linum.com.br")
    assert "financeiro%40linum.com.br" in pg.get_attribute("#cWhats", "href") and pg.get_attribute("#cWhats", "href").startswith("https://wa.me/5521966869374")
    assert pg.get_attribute("#cEmail", "href").startswith("mailto:atendimento@nervia.com.br")
    pg.fill("#lSenha", "errada"); pg.click("#pEntrar button:has-text('Entrar')"); pg.wait_for_selector("#msgLogin.err")
    pg.click("text=Esqueci minha senha"); pg.wait_for_selector("#pEsqueci:not(.oculto)")
    assert pg.input_value("#rEmail") == "financeiro@linum.com.br", "aproveita o e-mail digitado"
    href = pg.get_attribute("#bPedir", "href")
    assert href.startswith("mailto:atendimento@nervia.com.br?subject=") and "financeiro%40linum.com.br" in href, href
    assert not [c for c in pg.evaluate("window.__chamadas") if str(c[0]).startswith("auth:reset")], "não envia e-mail automático"
    pg.screenshot(path=f"{SAIDA}/portal_esqueci.png")
    pg.click("text=← Voltar para entrar"); pg.wait_for_selector("#pEntrar:not(.oculto)")
    pg.goto("about:blank"); pg.goto("http://127.0.0.1:8811/cliente/?papel=anon#esqueci"); pg.wait_for_selector("#pEsqueci:not(.oculto)")
    # login do app aberto fora do portal aponta para o esqueci
    pg.goto("http://127.0.0.1:8811/apps/notas/?papel=anon"); pg.wait_for_selector("#telaLogin:not(.oculto)")
    assert pg.get_attribute("text=Esqueci minha senha", "href") == "/cliente/#esqueci"
    pg.set_viewport_size({"width": 390, "height": 844}); pg.goto("http://127.0.0.1:8811/cliente/?papel=anon"); pg.wait_for_selector("#vLogin:not(.oculto)")
    assert pg.evaluate("document.documentElement.scrollWidth") <= 390
    pg.screenshot(path=f"{SAIDA}/portal_login_celular.png")
    assert not erros, erros

    # ---------------- site público: link da Área do Cliente
    pg, erros = nova(b)
    pg.goto("http://127.0.0.1:8811/"); pg.wait_for_selector("text=Área do Cliente")
    assert pg.locator("img[alt='Nervia Tecnologia']").first.evaluate("i => i.naturalWidth") > 0, "logo carregou"
    pg.screenshot(path=f"{SAIDA}/site_nervia.png")
    b.close()
print("TESTES DE TELA OK")
