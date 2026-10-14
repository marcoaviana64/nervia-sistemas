"""Gera a demonstração pública (site/demo/) a partir dos apps reais.

Copia a Área do Cliente, o Buscador, o espelho e o Painel, troca o supabase-js por
site/demo/supabase-demo.js (dados fictícios em memória, sem rede) e acerta os links para /demo/.
Rodar sempre que um desses apps mudar:  python3 divulgacao/demo/gerar.py
"""
import os, re, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SITE = os.path.join(RAIZ, "site")
WHATS = "https://wa.me/5521966869374?text=" + "Ol%C3%A1%2C%20vi%20a%20demonstra%C3%A7%C3%A3o%20da%20Plataforma%20Nervia%20e%20quero%20saber%20mais."

PAGINAS = {  # origem -> destino (dentro de site/)
    "cliente/index.html": "demo/index.html",
    "apps/notas/index.html": "demo/apps/notas/index.html",
    "apps/notas/espelho.html": "demo/apps/notas/espelho.html",
    "apps/painel-nf/index.html": "demo/apps/painel-nf/index.html",
}

SUPABASE = re.compile(r'<script src="https://cdn\.jsdelivr\.net/npm/@supabase/supabase-js@[^"]+"></script>')

FAIXA_CSS = """<style id="demo-css">
.demo-faixa{position:sticky;top:0;z-index:9999;display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;
  padding:8px 16px;background:#0B2545;color:#fff;font:600 14px/1.35 Inter,system-ui,sans-serif;text-align:center}
.demo-faixa b{color:#2BB3D1}
.demo-faixa a{background:#2BB3D1;color:#06222c;text-decoration:none;border-radius:999px;padding:6px 14px;font-weight:700;white-space:nowrap}
.demo-faixa .demo-dica{font-weight:400;color:#bcd3df}
.visor{height:calc(100vh - 65px - var(--demo-h, 0px)) !important}
@media (max-width:600px){.demo-faixa{font-size:12.5px;gap:8px;padding:6px 10px}.demo-faixa .demo-dica{display:none}.demo-faixa a{padding:4px 10px}}
.demo-selo{position:fixed;right:12px;bottom:12px;z-index:9999;background:#0B2545;color:#fff;font:600 12px Inter,system-ui,sans-serif;
  padding:6px 12px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.2);opacity:.92;pointer-events:none}
</style>"""

FAIXA_PORTAL = f"""<div class="demo-faixa" id="demoFaixa"><span><b>Demonstração</b> · todas as empresas e notas são fictícias.</span>
<span class="demo-dica">Para entrar, use qualquer e-mail e senha.</span><a href="{WHATS}" target="_blank" rel="noopener">Quero assinar</a></div>
<script>(function(){{var f=document.getElementById("demoFaixa");function m(){{document.documentElement.style.setProperty("--demo-h",f.offsetHeight+"px")}}
addEventListener("resize",m);document.addEventListener("DOMContentLoaded",m);m();}})();</script>"""

# Nos apps: só um selo discreto, e só quando abertos fora da Área do Cliente (no iframe a faixa do portal já avisa).
SELO_APP = """<div class="demo-selo" id="demoSelo" style="display:none">Demonstração · dados fictícios</div>
<script>if(window.self===window.top)document.getElementById("demoSelo").style.display="";</script>"""

# Baixar XML: na demonstração o arquivo é gerado no navegador; baixa sem sair da página.
XML_ORIG = "location.href = data.signedUrl;"
XML_DEMO = ('const a = document.createElement("a"); a.href = data.signedUrl; a.download = n.xml_path.split("/").pop(); '
            'document.body.appendChild(a); a.click(); a.remove();')


def converter(html, origem):
    novo, n = SUPABASE.subn('<script src="/demo/supabase-demo.js"></script>', html)
    if n != 1:
        sys.exit(f"{origem}: script do supabase-js não encontrado")
    novo = novo.replace("/apps/notas/espelho.html", "/demo/apps/notas/espelho.html")
    novo = novo.replace('"/cliente/', '"/demo/').replace("'/cliente/", "'/demo/")
    if origem == "apps/notas/index.html":
        if XML_ORIG not in novo:
            sys.exit("Buscador: trecho do download do XML mudou; ajuste XML_ORIG em gerar.py")
        novo = novo.replace(XML_ORIG, XML_DEMO)
    titulo = re.search(r"<title>(.*?)</title>", novo, re.S)
    if titulo:
        novo = novo.replace(titulo.group(0), f"<title>Demonstração · {titulo.group(1).strip()}</title>", 1)
    cab = ('<meta name="robots" content="noindex">\n'
           "<!-- GERADO por divulgacao/demo/gerar.py a partir de site/" + origem + ". Não editar aqui. -->\n" + FAIXA_CSS)
    novo = novo.replace("</head>", cab + "\n</head>", 1)
    faixa = FAIXA_PORTAL if origem == "cliente/index.html" else SELO_APP
    novo = re.sub(r"(<body[^>]*>)", lambda m: m.group(1) + "\n" + faixa, novo, count=1)
    return novo


for origem, destino in PAGINAS.items():
    with open(os.path.join(SITE, origem), encoding="utf-8") as f:
        html = f.read()
    caminho = os.path.join(SITE, destino)
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, "w", encoding="utf-8") as f:
        f.write(converter(html, origem))
    print("gerado", destino)
