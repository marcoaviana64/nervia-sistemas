import os, threading, http.server, functools, sys
from playwright.sync_api import sync_playwright
S=os.path.dirname(os.path.abspath(__file__)); R=os.path.dirname(os.path.dirname(S))
_f=open(f"{R}/testes/supabase_falso.js",encoding="utf-8").read().replace("  const pode = (cnpj)","  if (window.__demo) window.__demo(db);\n  const pode = (cnpj)",1)
FALSO=_f.replace("financeiro@linum.com.br","financeiro@exemplo.com.br").replace("Financeiro Linum","Financeiro")
DEMO=open(f"{S}/demo.js",encoding="utf-8").read()
CJ=open("/tmp/claude-0/cjs/package/dist/chart.umd.js",encoding="utf-8").read()
CONFIG='window.BUSCADOR_CONFIG={SUPABASE_URL:"https://teste.supabase.co",SUPABASE_ANON_KEY:"x",NFE_HABILITADA:true};'
srv=http.server.ThreadingHTTPServer(("127.0.0.1",8822),functools.partial(http.server.SimpleHTTPRequestHandler,directory=f"{R}/site"))
http.server.SimpleHTTPRequestHandler.log_message=lambda *a:None
threading.Thread(target=srv.serve_forever,daemon=True).start()
U="http://127.0.0.1:8822"
def nova(b,w=1440,h=900):
    pg=b.new_page(viewport={"width":w,"height":h},device_scale_factor=2,locale="pt-BR")
    pg.on("pageerror",lambda e:print("ERRO",e))
    pg.route("**/supabase-js@*/**",lambda r:r.fulfill(body=DEMO+"\n"+FALSO,content_type="text/javascript"))
    pg.route("**/config.js",lambda r:r.fulfill(body=CONFIG,content_type="text/javascript"))
    pg.route("https://fonts.googleapis.com/**",lambda r:r.fulfill(body="",content_type="text/css"))
    pg.route("**/Chart.js/**",lambda r:r.fulfill(body=CJ,content_type="text/javascript"))
    return pg
alvo=sys.argv[1:] or ["portal","buscador","painel","espelho"]
with sync_playwright() as p:
    b=p.chromium.launch(args=["--lang=pt-BR"],env={**os.environ,"LANG":"pt_BR.UTF-8","LANGUAGE":"pt_BR:pt","LC_ALL":"pt_BR.UTF-8"})
    if "portal" in alvo:
        pg=nova(b,1280,760); pg.goto(f"{U}/cliente/?papel=cliente"); pg.wait_for_selector(".app"); pg.wait_for_timeout(400)
        pg.screenshot(path=f"{S}/img/portal.png")
    if "buscador" in alvo:
        pg=nova(b,1440,1150); pg.goto(f"{U}/apps/notas/?papel=cliente"); pg.wait_for_timeout(1200)
        pg.screenshot(path=f"{S}/img/buscador.png")
    if "painel" in alvo:
        pg=nova(b,1440,1000); pg.goto(f"{U}/apps/painel-nf/?papel=cliente"); pg.wait_for_selector("#painel:not(.oculto)"); pg.wait_for_timeout(1500)
        pg.screenshot(path=f"{S}/img/painel.png")
        pg.screenshot(path=f"{S}/img/painel_full.png",full_page=True)
    if "espelho" in alvo:
        pg=nova(b,1000,1300); pg.goto(f"{U}/apps/notas/espelho.html?ids=113&papel=cliente"); pg.wait_for_timeout(1500)
        pg.screenshot(path=f"{S}/img/espelho.png")
    b.close()
