"""Teste da tela com Playwright, trocando o supabase-js por uma versão em memória (testes/supabase_falso.js).
Uso: python3 testes/tela_test.py [pasta_para_prints]
"""
import os, sys, threading, http.server, functools
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, "testes")
FALSO = open(os.path.join(RAIZ, "testes", "supabase_falso.js"), encoding="utf-8").read()
# Chart.js do npm (o teste não acessa o CDN); sem ele, um substituto mínimo
_cj = "/tmp/claude-0/cjs/package/dist/chart.umd.js"
CHARTJS = open(_cj, encoding="utf-8").read() if os.path.exists(_cj) else "window.Chart=class{constructor(){}update(){}}"
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
    pg.route("**/Chart.js/**", lambda r: r.fulfill(body=CHARTJS, content_type="text/javascript"))
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
    # registro de auditoria da empresa
    pg.click("text=Registro de auditoria"); pg.wait_for_selector("#auditoria div")
    assert "Certificado A1 cadastrado" in pg.inner_text("#auditoria") and "Ciência" not in pg.inner_text("#auditoria"), "só registros da empresa aberta"
    # recuperação de NF-e anteriores (consNSU)
    assert pg.locator("#bRecuperar").is_enabled()
    pg.once("dialog", lambda d: d.accept())
    antes = len(pg.evaluate("window.__chamadas"))
    pg.click("#bRecuperar"); pg.wait_for_timeout(400)
    rec = [c for c in pg.evaluate("window.__chamadas")[antes:] if c[0] == "fn:sincronizar"]
    assert rec and rec[-1][1].get("acao") == "recuperar_nfe", rec
    # chave NF-e por empresa
    assert "NF-e ligada" in pg.inner_text("#painel") and pg.locator("#bNfeChave").inner_text() == "Desligar NF-e"
    pg.once("dialog", lambda d: d.accept())
    pg.click("#bNfeChave"); pg.wait_for_selector("text=Ligar NF-e")
    assert pg.locator("#bNfe").is_disabled() and "outro sistema" in pg.inner_text("#painel")
    assert "NF-e desligada" in pg.locator(".emp", has_text="Nervia").inner_text()
    pg.screenshot(path=f"{SAIDA}/tela_nfe_desligada.png")
    pg.click("#bNfeChave"); pg.wait_for_selector("text=Desligar NF-e")
    assert pg.locator("#bNfe").is_enabled() and "só um sistema" in pg.inner_text("#msgP")
    assert pg.locator("#xSit").input_value() == ""
    pg.locator(".ck").first.check()
    pg.once("dialog", lambda d: d.accept())
    pg.click("text=Dar ciência nas selecionadas"); pg.wait_for_selector("#msgP.ok")
    assert [c for c in pg.evaluate("window.__chamadas") if c[0] == "fn:ciencia"][-1][1]["evento"] == "ciencia"
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
    pg.click(".emp >> text=Linum"); pg.wait_for_selector("#termoInfo")
    assert pg.locator("#bNfe").is_disabled()
    assert "pendente" in pg.inner_text("#termoInfo") and pg.locator("#cArq").count() == 0, "sem termo não aparece o envio do certificado"
    assert "termo pendente" in pg.inner_text(".emp >> nth=0") or "termo pendente" in pg.inner_text("#listaEmp")
    with pg.expect_popup() as pop:
        pg.click("#termoInfo >> text=Gerar termo")
    tp = pop.value
    tp.route("**/supabase-js@*/**", lambda r: r.fulfill(body=FALSO, content_type="text/javascript"))
    tp.route("**/config.js", lambda r: r.fulfill(body=CONFIG, content_type="text/javascript"))
    tp.reload(); tp.wait_for_selector(".folha")
    t = tp.inner_text(".folha")
    assert "TERMO DE AUTORIZAÇÃO" in t and "22.222.222/0001-22" in t and "Linum" in t and "32.072.678/0001-76" in t and "não são armazenados" in t, t[:400]
    tp.emulate_media(media="print"); tp.pdf(path=f"{SAIDA}/termo.pdf", format="A4"); tp.close()
    pg.click("#termoInfo >> text=Registrar"); pg.click("text=Salvar termo"); pg.wait_for_selector("#msgP.err")
    pg.fill("#tData", "2026-10-14"); pg.fill("#tSign", "Fulana de Tal - sócia"); pg.click("text=Salvar termo"); pg.wait_for_selector("#cArq")
    assert "assinado em 14/10/2026" in pg.inner_text("#termoInfo")
    # nova empresa
    pg.click("text=+ Adicionar empresa"); pg.fill("#fNome", "iGuardei"); pg.fill("#fCnpj", "33.333.333/0001-33")
    pg.click("#novaBox >> text=Salvar"); pg.wait_for_selector("text=gere o termo de custódia")
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
    assert pg.locator("#bNfe").count() == 0, "cliente não busca na SEFAZ"
    assert pg.locator("text=Dar ciência nas selecionadas").count() == 1 and pg.locator("text=Confirmar operação nas selecionadas").count() == 1, "cliente manifesta"
    assert pg.locator("text=Dar ciência nas selecionadas").is_disabled(), "sem certificado, sem manifestação"
    assert "NF-e só com resumo" in pg.inner_text("#kpis")
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
    assert pg.locator(".app").count() == 3, "app inativo não aparece na grade"
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
    pg.locator("#nApps input").first.check()
    assert pg.locator("#nEmpresas input").count() == 2, "novo login mostra as empresas do Notas Fiscais"
    pg.locator("#nEmpresas label", has_text="Linum").locator("input").check()
    pg.click("text=Criar login"); pg.wait_for_selector("#msgAdm.ok")
    cria = [c for c in pg.evaluate("window.__chamadas") if c[0] == "fn:usuarios"][-1][1]
    assert cria["cnpjs"] == ["22222222000122"] and cria["admin"] is False, cria
    # login existente: liberar e retirar empresa direto na Administração
    cli = pg.locator(".usu", has_text="financeiro@linum.com.br")
    assert cli.locator("label", has_text="Linum").locator("input").is_checked()
    assert not cli.locator("label", has_text="Nervia").locator("input").is_checked()
    cli.locator("label", has_text="Nervia").locator("input").check(); pg.wait_for_selector("#msgAdm.ok")
    assert pg.evaluate("window.__chamadas").count(["nf_acessos", "insert"]) == 1
    cli = pg.locator(".usu", has_text="financeiro@linum.com.br")
    cli.locator("label", has_text="Linum").locator("input").uncheck(); pg.wait_for_timeout(200)
    cli.locator("label", has_text="Nervia").locator("input").uncheck(); pg.wait_for_timeout(200)
    assert pg.locator(".usu", has_text="financeiro@linum.com.br").locator(".aviso-emp").is_visible()
    adm = pg.locator(".usu", has_text="marco@nervia.com.br")
    assert adm.locator("#nEmpresas, .chips input").count() == 0, "admin não tem lista de empresas"
    pg.screenshot(path=f"{SAIDA}/portal_admin.png")
    pg.click("#abaAud"); pg.wait_for_selector("table.aud")
    assert pg.locator("table.aud tr").count() == 6 and "Ciência da Operação (SEFAZ)" in pg.inner_text("table.aud")
    pg.fill("#audQ", "login criado"); assert pg.locator("table.aud tr").count() == 2
    pg.screenshot(path=f"{SAIDA}/portal_auditoria.png")
    # acessos do site (só admin); entrar como admin marca este navegador para não ser contado
    pg.click("#abaAcs"); pg.wait_for_selector("#acSaida table")
    t = pg.inner_text("#acSaida")
    assert "4\nacessos" in t and "3\nvisitantes" in t, t[:300]
    assert "Rio de Janeiro (RJ)" in t and "Exterior: US" in t and "Niterói / RJ" in t and "189.10.20.30" in t and "whatsapp" in t, t
    assert "não são contados" in pg.inner_text("#admConteudo")
    assert pg.evaluate("localStorage.getItem('nervia-nao-contar')") == "1"
    pg.fill("#acDe", "2020-01-01"); pg.dispatch_event("#acDe", "change"); pg.wait_for_timeout(300)
    assert "5\nacessos" in pg.inner_text("#acSaida"), "acesso antigo, já sem IP, continua na contagem"
    pg.select_option("#acPag", "demo"); pg.wait_for_timeout(300)
    assert "1\nacessos" in pg.inner_text("#acSaida")
    assert pg.locator("#acSaida table").first.locator("tr").count() <= 6, "período longo: só dias com acesso"
    pg.select_option("#acPag", ""); pg.fill("#acDe", pg.input_value("#acAte")[:8] + "01"); pg.dispatch_event("#acDe", "change"); pg.wait_for_timeout(300)
    pg.screenshot(path=f"{SAIDA}/portal_acessos.png", full_page=True)
    with pg.expect_download() as dl: pg.click("text=CSV")
    assert "189.10.20.30" in open(dl.value.path(), encoding="utf-8-sig").read()
    cp = b.new_page(); cp.route("**/supabase-js@*/**", lambda r: r.fulfill(body=FALSO, content_type="text/javascript"))
    cp.route("**/config.js", lambda r: r.fulfill(body=CONFIG, content_type="text/javascript"))
    cp.goto("http://127.0.0.1:8811/cliente/comprovante.html?id=1&papel=admin"); cp.wait_for_selector(".folha")
    tc = cp.inner_text(".folha")
    assert "Comprovante de registro nº 1" in tc and "891260000123456" in tc and "200.1.2.3" in tc and "Financeiro Linum" in tc, tc[:500]
    cp.screenshot(path=f"{SAIDA}/comprovante.png", full_page=True); cp.close()
    for i, esperado in ((4, "Nenhum campo mudou"), (5, "Natural")):
        cp = b.new_page(); cp.route("**/supabase-js@*/**", lambda r: r.fulfill(body=FALSO, content_type="text/javascript"))
        cp.route("**/config.js", lambda r: r.fulfill(body=CONFIG, content_type="text/javascript"))
        cp.goto(f"http://127.0.0.1:8811/cliente/comprovante.html?id={i}&papel=admin"); cp.wait_for_selector(".folha")
        tc = cp.inner_text(".folha")
        assert "O que mudou" in tc and esperado in tc and '"id"' not in tc, tc[:800]
        if i == 5: assert "(vazio)" in tc
        cp.screenshot(path=f"{SAIDA}/comprovante_mudou_{i}.png", full_page=True); cp.close()
    pg.click("#abaApps"); pg.wait_for_selector("text=Novo aplicativo")
    nv = pg.locator(".cartao").last
    nv.locator(".fId").fill("relatorios"); nv.locator(".fNome").fill("Relatórios"); nv.locator(".fUrl").fill("/apps/relatorios/")
    nv.locator("text=Adicionar aplicativo").click(); pg.wait_for_selector("#msgAdm.ok")
    nv = pg.locator(".cartao").last
    nv.locator(".fId").fill("Com Espaço"); nv.locator(".fNome").fill("X"); nv.locator(".fUrl").fill("/x/")
    nv.locator("text=Adicionar aplicativo").click(); pg.wait_for_selector("#msgAdm.err")
    assert not erros, erros

    # ---------------- contador de acessos do site (site/acesso.js)
    sp = b.new_page(); avisos = []
    sp.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
    sp.route("**/registrar-acesso", lambda r: (avisos.append(r.request.post_data), r.fulfill(status=204)))
    sp.goto("http://127.0.0.1:8811/"); sp.wait_for_timeout(500)
    assert avisos == [], "fora do domínio da Nervia / navegador automatizado não conta"
    sp.add_init_script("window.NERVIA_ACESSO_TESTE = true")
    sp.goto("http://127.0.0.1:8811/?utm_source=whatsapp"); sp.wait_for_timeout(500)
    assert len(avisos) == 1 and '"pagina":"/"' in avisos[0] and '"origem":"whatsapp"' in avisos[0], avisos
    assert sp.locator("footer a[href='/privacidade.html']").is_visible()
    sp.goto("http://127.0.0.1:8811/privacidade.html"); sp.wait_for_timeout(500)
    assert len(avisos) == 2 and "90 dias" in sp.inner_text("main")
    sp.set_viewport_size({"width": 390, "height": 844}); assert sp.evaluate("document.documentElement.scrollWidth") <= 390
    sp.evaluate("localStorage.setItem('nervia-nao-contar','1')"); sp.goto("http://127.0.0.1:8811/"); sp.wait_for_timeout(500)
    assert len(avisos) == 2, "equipe Nervia não conta"
    sp.close()

    # ---------------- Área do Cliente: cliente com app / sem app
    pg, erros = nova(b)
    pg.goto("http://127.0.0.1:8811/cliente/?papel=cliente"); pg.wait_for_selector(".app")
    assert pg.locator("#bAdmin").is_hidden()
    assert pg.locator(".app").count() == 3
    pg.click(".app >> text=Notas Fiscais"); quadro = pg.frame_locator("#frame"); quadro.locator("#tab table").wait_for()
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
    assert pg.locator("#bMapa").is_hidden(), "app sem mapa mental não mostra o botão Mapa"
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
    pg.click("#pEsqueci >> text=← Voltar para entrar"); pg.wait_for_selector("#pEntrar:not(.oculto)")
    pg.goto("about:blank"); pg.goto("http://127.0.0.1:8811/cliente/?papel=anon#esqueci"); pg.wait_for_selector("#pEsqueci:not(.oculto)")
    # login do app aberto fora do portal aponta para o esqueci
    pg.goto("http://127.0.0.1:8811/apps/notas/?papel=anon"); pg.wait_for_selector("#telaLogin:not(.oculto)")
    assert pg.get_attribute("text=Esqueci minha senha", "href") == "/cliente/#esqueci"
    pg.set_viewport_size({"width": 390, "height": 844}); pg.goto("http://127.0.0.1:8811/cliente/?papel=anon"); pg.wait_for_selector("#vLogin:not(.oculto)")
    assert pg.evaluate("document.documentElement.scrollWidth") <= 390
    pg.screenshot(path=f"{SAIDA}/portal_login_celular.png")
    assert not erros, erros

    # ---------------- esqueci minha senha AUTOMÁTICO (CFG.ESQUECI_AUTOMATICO) + senha nova pelo link + aba E-mails
    pg, erros = nova(b)
    pg.route("**/config.js", lambda r: r.fulfill(body=CONFIG.replace("NFE_HABILITADA:true", "NFE_HABILITADA:true,ESQUECI_AUTOMATICO:true"), content_type="text/javascript"))
    pg.goto("http://127.0.0.1:8811/cliente/?papel=anon"); pg.wait_for_selector("#vLogin:not(.oculto)")
    pg.fill("#lEmail", "financeiro@linum.com.br"); pg.click("text=Esqueci minha senha"); pg.wait_for_selector("#pEsqueciAuto:not(.oculto)")
    assert pg.is_hidden("#pEsqueci") and pg.input_value("#aEmail") == "financeiro@linum.com.br"
    pg.click("#bLink"); pg.wait_for_selector("#msgLogin.ok")
    reset = [c for c in pg.evaluate("window.__chamadas") if c[0] == "auth:reset"]
    assert reset and reset[0][1] == "financeiro@linum.com.br" and reset[0][2]["redirectTo"] == "http://127.0.0.1:8811/cliente/", reset
    assert "Se este e-mail tiver login" in pg.inner_text("#msgLogin")
    pg.screenshot(path=f"{SAIDA}/portal_esqueci_auto.png")
    # link vencido: volta para o pedido com aviso
    pg.goto("about:blank"); pg.goto("http://127.0.0.1:8811/cliente/?papel=anon#error=access_denied&error_code=otp_expired"); pg.wait_for_selector("#pEsqueciAuto:not(.oculto)")
    assert "venceu ou já foi usado" in pg.inner_text("#msgLogin")
    # voltou pelo link do e-mail: pede a senha nova antes de entrar
    pg.goto("about:blank"); pg.goto("http://127.0.0.1:8811/cliente/?papel=recuperacao#access_token=x&type=recovery"); pg.wait_for_selector("#pNova:not(.oculto)")
    assert pg.is_hidden("#vArea") and pg.inner_text("#tLogin") == "Criar senha nova"
    pg.fill("#rsSenha", "senhanova123"); pg.fill("#rsSenha2", "outra12345"); pg.click("#pNova button"); pg.wait_for_selector("#msgLogin.err")
    pg.fill("#rsSenha2", "senhanova123"); pg.click("#pNova button"); pg.wait_for_selector("#vArea:not(.oculto)")
    assert ["auth:updateUser", {"password": "senhanova123"}] in pg.evaluate("window.__chamadas")
    assert "type=recovery" not in pg.url
    assert not erros, erros
    # Administração → E-mails
    pg, erros = nova(b)
    pg.goto("http://127.0.0.1:8811/cliente/?papel=admin#admin"); pg.wait_for_selector("#abaEml")
    # editar nome e e-mail de um login
    pg.goto("http://127.0.0.1:8811/cliente/?papel=admin#admin"); pg.wait_for_selector("#ed-u-cli", state="attached")
    pg.click("#admConteudo .usu:has(#ed-u-cli) >> text=editar nome e e-mail"); pg.wait_for_selector("#ed-u-cli:not(.oculto)")
    pg.fill("#ed-u-cli .edEmail", "financeiro2@linum.com.br"); pg.fill("#ed-u-cli .edNome", "Financeiro da Linum")
    pg.on("dialog", lambda d: d.accept())
    pg.click("#ed-u-cli >> text=Salvar"); pg.wait_for_selector("#msgAdm.ok")
    ed = [c for c in pg.evaluate("window.__chamadas") if c[0] == "fn:usuarios"][-1][1]
    assert ed == {"acao": "editar", "user_id": "u-cli", "nome": "Financeiro da Linum", "email": "financeiro2@linum.com.br"}, ed
    assert "financeiro2@linum.com.br" in pg.inner_text("#msgAdm")
    # volta da Administração para os aplicativos (botão na página e o "Área do Cliente" do topo)
    pg.click("#bVoltarAdm"); pg.wait_for_selector("#vApps:not(.oculto)"); assert pg.is_hidden("#vAdmin")
    pg.click("#bAdmin"); pg.wait_for_selector("#vAdmin:not(.oculto)")
    pg.click(".topo .area"); pg.wait_for_selector("#vApps:not(.oculto)")
    pg.click("#bAdmin"); pg.wait_for_selector("#vAdmin:not(.oculto)")
    pg.click("#abaEml"); pg.wait_for_selector("#tEmail")
    t = pg.inner_text("#admConteudo")
    assert "nao-responda@nervia.com.br" in t and "Senha nova" in t and "falhou" in t and "Caixa não encontrada" in t and "desligado" in t, t
    pg.fill("#tEmail", "marco@nervia.com.br"); pg.click("#admConteudo button:has-text('Enviar teste')"); pg.wait_for_selector("#msgAdm.ok")
    assert "marco@nervia.com.br" in pg.inner_text("#msgAdm")
    pg.screenshot(path=f"{SAIDA}/portal_emails.png", full_page=True)
    assert not erros, erros

    # ---------------- Painel de Notas
    pg, erros = nova(b)
    pg.goto("http://127.0.0.1:8811/apps/painel-nf/?papel=admin&painel=1"); pg.wait_for_selector("#painel:not(.oculto)")
    k = pg.inner_text("#kpis")
    # compras sem canceladas: (1840,90+389,70+1000+5320)*2 + 800+1200+1000 = 20101,20
    assert "20.101,20" in k, k
    assert pg.locator("#tbForn tr").count() == 4, pg.inner_text("#tbForn")
    pg.select_option("#fAno", "2025"); pg.wait_for_timeout(100)
    assert "2.000,00" in pg.inner_text("#kpis") and pg.locator("#tbForn tr").count() == 1
    pg.select_option("#fMes", "12"); pg.wait_for_timeout(100)
    k = pg.inner_text("#kpis"); assert "1.200,00" in k and "800,00" in k, k   # comparação com nov/2025
    pg.click("text=Limpar filtros"); pg.wait_for_timeout(100)
    pg.locator("#tbForn tr", has_text="KALUNGA").click(); pg.wait_for_timeout(100)
    assert pg.input_value("#fForn").startswith("KALUNGA") and pg.locator("#tbNotas tr").count() == 4
    pg.fill("#fForn", ""); pg.dispatch_event("#fForn", "input"); pg.wait_for_timeout(100)
    pg.select_option("#fEmpresa", "22222222000122"); pg.wait_for_timeout(100)
    assert "8.550,60" in pg.inner_text("#kpis")
    pg.select_option("#fCanc", "dentro"); pg.wait_for_timeout(100)
    assert "9.162,60" in pg.inner_text("#kpis")
    pg.select_option("#fEmpresa", ""); pg.select_option("#fCanc", "fora")
    pg.fill("#fDe", "2026-09-01"); pg.dispatch_event("#fDe", "change"); pg.fill("#fAte", "2026-09-30"); pg.dispatch_event("#fAte", "change"); pg.wait_for_timeout(100)
    assert pg.input_value("#fAno") == "" and "11.640,00" in pg.inner_text("#kpis"), pg.inner_text("#kpis")
    assert pg.locator("#fPapel").is_hidden() and "vendas" not in pg.inner_text(".topo").lower(), "visão Vendas desligada"
    with pg.expect_download() as d:
        pg.click("text=Exportar CSV")
    csv = open(d.value.path(), encoding="utf-8-sig").read()
    assert "COMERCIAL EXEMPLO SA" not in csv and csv.count("\n") >= 1, csv
    pg.screenshot(path=f"{SAIDA}/painel_nf.png", full_page=True)
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(200)
    assert pg.evaluate("document.documentElement.scrollWidth") <= 390, "painel: rolagem horizontal no celular"
    pg.screenshot(path=f"{SAIDA}/painel_nf_celular.png", full_page=True)
    assert not erros, erros
    # cliente: só a empresa liberada, dentro do portal
    pg, erros = nova(b)
    pg.goto("http://127.0.0.1:8811/cliente/?papel=cliente#app/painel-nf"); pg.wait_for_selector("#vVisor:not(.oculto)")
    q = pg.frame_locator("#frame"); q.locator("#painel:not(.oculto)").wait_for()
    assert q.locator(".topo").is_hidden() and q.locator("#fEmpresa option").count() == 1
    assert "8.550,60" in q.locator("#kpis").inner_text()
    pg.click("#bCartao"); pg.frame_locator("#frameAjuda").locator("text=Cartão de referência").first.wait_for()
    assert not erros, erros

    # ---------------- site público: link da Área do Cliente
    pg, erros = nova(b)
    pg.goto("http://127.0.0.1:8811/"); pg.wait_for_selector("text=Área do Cliente")
    assert pg.locator("img[alt='Nervia Tecnologia']").first.evaluate("i => i.naturalWidth") > 0, "logo carregou"
    pg.screenshot(path=f"{SAIDA}/site_nervia.png")
    b.close()
print("TESTES DE TELA OK")
