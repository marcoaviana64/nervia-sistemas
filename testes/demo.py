"""Modo demonstração: abre o site, a Área do Cliente e os apps no seu computador, com DADOS FICTÍCIOS.
Não acessa o Supabase nem a SEFAZ. Nada do que você fizer aqui é gravado de verdade.

Uso:  python testes/demo.py        (ou dois cliques em iniciar-demo.bat)
Abre http://localhost:8090 — use a barra amarela embaixo para trocar entre admin, cliente e cliente sem app.
"""
import http.server, os, re, socketserver, sys, threading, webbrowser

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(RAIZ, "site")
FALSO = os.path.join(RAIZ, "testes", "supabase_falso.js")
PORTA = int(os.environ.get("PORTA", "8090"))

CONFIG = 'window.NERVIA_CONFIG = window.BUSCADOR_CONFIG = {SUPABASE_URL:"https://demo.supabase.co",SUPABASE_ANON_KEY:"demo",NFE_HABILITADA:false};'
BARRA = """
<div id="__demo" style="position:fixed;left:12px;bottom:12px;z-index:99999;background:#fff3c4;border:1px solid #e0c35a;
 border-radius:10px;padding:8px 12px;font:13px system-ui,sans-serif;color:#4a3b00;box-shadow:0 4px 16px rgba(0,0,0,.15);display:flex;gap:8px;align-items:center;flex-wrap:wrap">
 <b>DEMONSTRAÇÃO</b> dados fictícios · ver como:
 <select onchange="localStorage.setItem('papel_teste',this.value);location.href=location.pathname" style="font:inherit;padding:2px 4px">
  <option value="admin">Admin (Nervia)</option><option value="cliente">Cliente com o app Notas</option><option value="semapp">Cliente sem apps</option>
 </select>
 <script>try{document.currentScript.previousElementSibling.value=localStorage.getItem('papel_teste')||'admin'}catch(e){}</script>
</div>"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=SITE, **kw)

    def log_message(self, *a):
        pass

    def _enviar(self, corpo: bytes, tipo: str):
        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        caminho = self.path.split("?")[0].split("#")[0]
        if caminho == "/config.js":
            return self._enviar(CONFIG.encode(), "text/javascript; charset=utf-8")
        if caminho == "/__demo/supabase.js":
            return self._enviar(open(FALSO, "rb").read(), "text/javascript; charset=utf-8")
        arq = os.path.join(SITE, caminho.lstrip("/"))
        if os.path.isdir(arq) and not caminho.endswith("/"):
            self.send_response(301); self.send_header("Location", caminho + "/"); self.end_headers(); return
        if os.path.isdir(arq):
            arq = os.path.join(arq, "index.html")
        if arq.endswith(".html") and os.path.isfile(arq):
            html = open(arq, encoding="utf-8").read()
            # troca o supabase-js real pela versão de demonstração
            html = re.sub(r'<script src="https://cdn\.jsdelivr\.net/npm/@supabase/supabase-js@[^"]+"></script>',
                          '<script src="/__demo/supabase.js"></script>', html)
            # a barra de troca de usuário só aparece na janela principal (não dentro do app embutido)
            html = html.replace("</body>", BARRA + "<script>if(window.self!==window.top)document.getElementById('__demo').remove()</script></body>")
            return self._enviar(html.encode("utf-8"), "text/html; charset=utf-8")
        return super().do_GET()


class Servidor(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = False  # no Windows, True deixaria duas cópias na mesma porta


def abrir_servidor():
    """Usa a porta 8090; se estiver ocupada, tenta as seguintes."""
    for porta in range(PORTA, PORTA + 20):
        try:
            return Servidor(("127.0.0.1", porta), Handler), porta
        except OSError:
            continue
    raise SystemExit(f"Nenhuma porta livre entre {PORTA} e {PORTA + 19}.")


if __name__ == "__main__":
    srv, PORTA = abrir_servidor()
    url = f"http://localhost:{PORTA}/"
    print(f"\n  Demonstração rodando em {url}\n  Área do Cliente: {url}cliente/\n  Feche esta janela para encerrar.\n")
    if "--sem-navegador" not in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(url + "cliente/")).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
