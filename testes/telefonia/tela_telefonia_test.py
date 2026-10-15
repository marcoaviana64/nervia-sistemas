"""Teste de tela do app Auditoria de Telefonia Móvel e da demonstração, com o Supabase falso (testes/supabase_falso.js).
Usa as exportações FICTÍCIAS de testes/telefonia/exemplo (gerar com testes/telefonia/gerar_exemplo.py).
Uso: python3 testes/telefonia/tela_telefonia_test.py [pasta_para_prints]
"""
import os, sys, glob, threading, http.server, functools
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAIDA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, "testes")
os.makedirs(SAIDA, exist_ok=True)
FALSO = open(os.path.join(RAIZ, "testes", "supabase_falso.js"), encoding="utf-8").read()
EXEMPLO = open(os.path.join(RAIZ, "site", "demo", "telefonia", "exemplo.js"), encoding="utf-8").read()
CSVS = sorted(glob.glob(os.path.join(RAIZ, "testes", "telefonia", "exemplo", "*.csv")))
CONFIG = 'window.NERVIA_CONFIG={SUPABASE_URL:"https://teste.supabase.co",SUPABASE_ANON_KEY:"x"};'
assert len(CSVS) == 5, "rode antes: python3 testes/telefonia/gerar_exemplo.py"

srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8812),
    functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(RAIZ, "site")))
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://127.0.0.1:8812"

def nova(b, semente=False, largura=1400):
    pg = b.new_page(viewport={"width": largura, "height": 900})
    erros = []
    pg.on("pageerror", lambda e: erros.append(str(e)))
    pg.route("**/supabase-js@*/**", lambda r: r.fulfill(body=FALSO, content_type="text/javascript"))
    pg.route("**/config.js", lambda r: r.fulfill(body=CONFIG, content_type="text/javascript"))
    pg.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
    if semente: pg.add_init_script(EXEMPLO + "\nwindow.__TEL_SEED = window.EXEMPLO_TELEFONIA;")
    return pg, erros

def chamadas(pg, tabela, op):
    return [c for c in pg.evaluate("window.__chamadas") if c[0] == tabela and c[1] == op]

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- equipe Nervia monta o relatório do zero
    pg, erros = nova(b)
    pg.goto(f"{URL}/apps/telefonia/?papel=admin"); pg.wait_for_selector("text=Nenhum relatório cadastrado")
    pg.click("#bNovo"); pg.wait_for_selector("#eTitulo")
    pg.fill("#eTitulo", "Exemplo Engenharia"); pg.fill("#eEmpresa", "EXEMPLO ENGENHARIA LTDA")
    pg.set_input_files("#eArquivos", CSVS); pg.wait_for_selector("#eLinhas tr[data-n]")
    assert pg.locator("#eLinhas tr[data-n]").count() == 6
    resumo = pg.inner_text("#eResumo")
    assert "06/04/2026 a 15/10/2026" in resumo and "2 arquivo(s) de dados, 2 de chamadas, 1 de assinante" in resumo, resumo
    assert pg.input_value("#eConta") == "700000001" and pg.input_value("#ePerfil") == "TudoLiberado"
    assert pg.input_value("#eLinhas tr[data-n='5521990000101'] [data-k=add]") == "Passaporte Américas 5 GB; Passaporte Mundo 10 GB"
    for n, nome in zip(range(101, 107), ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fábio"]):
        pg.fill(f"#eLinhas tr[data-n='5521990000{n}'] [data-k=dono]", nome)
    pg.click("#ePrevia"); pg.wait_for_selector(".prev-tag")
    assert "Roaming de Carla" in pg.inner_text("#alerts"), pg.inner_text("#alerts")
    pg.screenshot(path=f"{SAIDA}/telefonia_editor.png", full_page=True)
    pg.click("#eSalvar"); pg.wait_for_selector("#msg.ok")
    assert "ainda não aparece para o cliente" in pg.inner_text("#msg")
    assert len(chamadas(pg, "tel_relatorios", "insert")) == 1 and len(chamadas(pg, "tel_arquivos", "insert")) == 5
    assert "Não publicado" in pg.inner_text("#situ") and pg.locator(".prev-tag").count() == 0
    assert "Ana" in pg.inner_text("#tbl") and "Elisa" in pg.inner_text("#alerts")
    # publicar e liberar
    pg.once("dialog", lambda d: d.accept()); pg.click("#bPublicar"); pg.wait_for_selector("#situ >> text=Publicado")
    pg.click("#bQuem"); pg.wait_for_selector("[data-uid='u-cli']")
    pg.check("[data-uid='u-cli']"); pg.wait_for_selector("#msg.ok")
    assert chamadas(pg, "tel_acessos", "insert"), "liberou o login"
    # atualizar: os arquivos guardados continuam valendo, e o nome de quem usa cada linha é mantido
    pg.click("#bEditar"); pg.wait_for_selector("#eResumo:not(.oculto)")
    assert pg.locator(".arqs .a").count() == 5 and "06/04/2026 a 15/10/2026" in pg.inner_text("#eResumo")
    assert pg.input_value("#eLinhas tr[data-n='5521990000103'] [data-k=dono]") == "Carla"
    pg.click(".arqs .a:has-text('Relatorio-Dados-20261015') .lnk"); pg.wait_for_timeout(200)
    assert "a 10/07/2026" in pg.inner_text("#eResumo"), "sem a exportação nova, os dados vão até 10/07"
    pg.click("#eCancelar")
    pg.once("dialog", lambda d: d.accept()); pg.click("#bExcluir"); pg.wait_for_selector("text=Nenhum relatório cadastrado")
    assert not erros, erros

    # ---------------- cliente vê só o relatório publicado e liberado, sem botões de administração
    pg, erros = nova(b, semente=True)
    pg.goto(f"{URL}/apps/telefonia/?papel=cliente"); pg.wait_for_selector("#kpis .kpi")
    assert pg.locator("#barra").is_hidden(), "um relatório só: sem barra"
    assert pg.locator("#bNovo").is_hidden() and pg.locator("#editor").is_hidden()
    assert "Exemplo Engenharia" in pg.inner_text("h1") and "Outro Cliente" not in pg.content()
    pg.click("#chips button >> text=Carla"); pg.wait_for_timeout(200)
    assert "Carla" in pg.inner_text("#dailyStats") or "Total" in pg.inner_text("#dailyStats")
    pg.screenshot(path=f"{SAIDA}/telefonia_cliente.png", full_page=True)
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(300)
    assert pg.evaluate("document.documentElement.scrollWidth") <= 390, "rolagem horizontal no celular"
    pg.screenshot(path=f"{SAIDA}/telefonia_celular.png")
    assert not erros, erros

    # login sem relatório liberado / sem login
    pg, erros = nova(b, semente=True)
    pg.goto(f"{URL}/apps/telefonia/?papel=semapp"); pg.wait_for_selector("text=Nenhum relatório liberado")
    pg.goto(f"{URL}/apps/telefonia/?papel=anon"); pg.wait_for_selector("text=Área do Cliente")
    assert not erros, erros

    # dentro da Área do Cliente (iframe, com cartão e manual)
    pg, erros = nova(b, semente=True)
    pg.goto(f"{URL}/cliente/?papel=cliente"); pg.wait_for_selector(".app")
    pg.click(".app >> text=Auditoria de Telefonia Móvel"); pg.wait_for_selector("#vVisor:not(.oculto)")
    quadro = pg.frame_locator("#frame"); quadro.locator("#kpis .kpi").first.wait_for()
    assert quadro.locator(".app-topo").is_hidden(), "topo próprio some dentro da Área do Cliente"
    assert not erros, erros

    # cartão e manual
    for pag in ["cartao", "manual"]:
        pg, erros = nova(b, largura=390)
        pg.goto(f"{URL}/apps/telefonia/ajuda/{pag}.html"); pg.wait_for_selector(".pagina h2")
        assert pg.evaluate("document.documentElement.scrollWidth") <= 390, f"{pag}: rolagem horizontal no celular"
        assert not erros, erros

    # ---------------- demonstração pública
    pg, erros = nova(b)
    pg.goto(f"{URL}/demo/telefonia/"); pg.wait_for_selector("#kpis .kpi")
    assert "Demonstração com dados fictícios" in pg.inner_text(".demo-faixa") and "wa.me/5521966869374" in pg.get_attribute("#wa", "href")
    assert pg.locator("#recs .rec").count() >= 4
    pg.screenshot(path=f"{SAIDA}/telefonia_demo.png")
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(300)
    assert pg.evaluate("document.documentElement.scrollWidth") <= 390
    assert not erros, erros
    b.close()
print("TESTES DE TELA (TELEFONIA) OK")
