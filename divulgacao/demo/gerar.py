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
    # Orçamentos de Compras: app e página do fornecedor, com o "servidor" fictício site/demo/compras-demo.js
    "apps/compras/index.html": "demo/compras/index.html",
    "cotacao/index.html": "demo/cotacao/index.html",
}
COMPRAS = ("apps/compras/index.html", "cotacao/index.html")

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

# Orçamentos de Compras: faixa com "Ver como" (papel), dica do que testar, mapa mental e recomeçar.
WHATS_COMPRAS = "https://wa.me/5521966869374?text=" + "Ol%C3%A1%2C%20vi%20a%20demonstra%C3%A7%C3%A3o%20do%20Or%C3%A7amentos%20de%20Compras%20da%20Nervia%20e%20quero%20saber%20mais."
COMPRAS_CSS = """<style id="demo-cmp-css">
.demo-faixa label{display:inline-flex;align-items:center;gap:6px;font-weight:600;margin:0;color:#fff;text-transform:none;letter-spacing:0;font-size:inherit}
.demo-faixa select{width:auto;font:600 13px Inter,system-ui,sans-serif;padding:4px 8px;border-radius:8px;border:1px solid #2BB3D1;background:#0f3157;color:#fff}
.demo-faixa .demo-sec{background:transparent;border:1px solid #2BB3D1;color:#fff;border-radius:999px;padding:5px 12px;font:600 13px Inter,system-ui,sans-serif;cursor:pointer;text-decoration:none;white-space:nowrap}
.demo-faixa .demo-dica{max-width:520px}
.demo-modal{position:fixed;inset:0;z-index:10000;background:#0009;display:grid;place-items:center;padding:16px}
.demo-modal>div{background:#fff;color:#0f1b2d;border-radius:14px;max-width:560px;width:100%;padding:18px;font:14px/1.5 Inter,system-ui,sans-serif;box-shadow:0 10px 40px #0006}
.demo-modal h3{margin:0 0 8px;font-size:16px}.demo-modal pre{white-space:pre-wrap;background:#f3f6f8;border-radius:10px;padding:10px 12px;font:13px/1.5 Inter,system-ui,sans-serif;margin:8px 0 14px;overflow-wrap:anywhere}
.demo-modal .bts{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
.demo-modal button{font:600 14px Inter,system-ui,sans-serif;border-radius:10px;padding:9px 14px;cursor:pointer;border:1px solid #c9d3de;background:#fff;color:#0f1b2d}
.demo-modal button.pri{background:#107e99;border-color:#107e99;color:#fff}
@media (max-width:600px){.demo-faixa .demo-sec{padding:3px 9px;font-size:12px}}
</style>"""

FAIXA_COMPRAS = f"""<div class="demo-faixa" id="demoFaixa"><span><b>Demonstração</b> · shopping, pessoas e fornecedores fictícios.</span>
<label>Ver como <select id="demoPapel"></select></label><span class="demo-dica" id="demoDica"></span>
<a class="demo-sec" href="/apps/compras/ajuda/mapa.html" target="_blank" rel="noopener">Mapa mental</a><button class="demo-sec" id="demoRecomecar" type="button">Recomeçar</button>
<a href="{WHATS_COMPRAS}" target="_blank" rel="noopener">Quero para a minha empresa</a></div>
<script>(function(){{var D=window.NERVIA_DEMO_COMPRAS,s=document.getElementById("demoPapel"),P=D.pessoas;
var DICA={{solicitante:"Peça uma compra em + Nova requisição.",comprador:"Abra o Compressor para o chiller 2 e mande o convite da Arcádia pelo WhatsApp: você vê a página que o fornecedor recebe.",
gerente:"Em Esperando você: aprove as câmeras e avalie o fornecedor do piso.",diretor:"Aprove a reforma do telhado (acima de R$ 50 mil, depois do Gerente)."}};
Object.keys(P).forEach(function(k){{var o=document.createElement("option");o.value=k;o.textContent=k.charAt(0).toUpperCase()+k.slice(1)+" — "+P[k].nome;s.appendChild(o);}});
s.value=D.papel();document.getElementById("demoDica").textContent=DICA[D.papel()];
s.onchange=function(){{D.trocarPapel(s.value);location.reload();}};
document.getElementById("demoRecomecar").onclick=function(){{if(confirm("Voltar a demonstração ao início? O que você fez aqui será apagado.")){{D.recomecar();location.reload();}}}};
addEventListener("storage",function(e){{if(e.key===D.chave&&typeof window.carregar==="function")window.carregar();}});
var abrir=window.open.bind(window);
window.open=function(u,a,c){{var t=String(u||"");if(!/^https:\\/\\/wa\\.me\\//.test(t)&&!/^mailto:/i.test(t))return abrir(u,a,c);
  var q=t.indexOf("?")>=0?new URLSearchParams(t.slice(t.indexOf("?")+1)):new URLSearchParams(""),txt=q.get("text")||q.get("body")||"",m=txt.match(/https?:\\/\\/\\S+\\/demo\\/cotacao\\/#[0-9a-f]{{64}}/);
  var w=document.createElement("div");w.className="demo-modal";w.innerHTML='<div><h3></h3><pre></pre><div class="bts"><button type="button" data-f>Fechar</button></div></div>';
  w.querySelector("h3").textContent="No app de verdade, abre o seu "+(/^mailto:/i.test(t)?"e-mail":"WhatsApp")+" com esta mensagem pronta:";w.querySelector("pre").textContent=txt;
  if(m){{var b=document.createElement("button");b.className="pri";b.type="button";b.textContent="Abrir a página do fornecedor →";b.onclick=function(){{abrir(m[0],"_blank");w.remove();}};w.querySelector(".bts").appendChild(b);}}
  w.querySelector("[data-f]").onclick=function(){{w.remove();}};w.onclick=function(e){{if(e.target===w)w.remove();}};document.body.appendChild(w);return null;}};
}})();</script>"""

FAIXA_COTACAO = f"""<div class="demo-faixa" id="demoFaixa"><span><b>Demonstração</b> · esta é a página que o fornecedor recebe pelo link, sem login. Dados fictícios.</span>
<a class="demo-sec" href="/demo/compras/">← Voltar ao app do comprador</a><a href="{WHATS_COMPRAS}" target="_blank" rel="noopener">Quero para a minha empresa</a></div>
<script>(function(){{if(!/^#[0-9a-f]{{64}}$/.test(location.hash)){{var c=window.NERVIA_DEMO_COMPRAS.codigoExemplo();if(c)history.replaceState(null,"","#"+c);}}}})();</script>"""

# Baixar XML: na demonstração o arquivo é gerado no navegador; baixa sem sair da página.
XML_ORIG = "location.href = data.signedUrl;"
XML_DEMO = ('const a = document.createElement("a"); a.href = data.signedUrl; a.download = n.xml_path.split("/").pop(); '
            'document.body.appendChild(a); a.click(); a.remove();')


def converter(html, origem):
    falso = "/demo/compras-demo.js" if origem in COMPRAS else "/demo/supabase-demo.js"
    novo, n = SUPABASE.subn(f'<script src="{falso}"></script>', html)
    if n != 1:
        sys.exit(f"{origem}: script do supabase-js não encontrado")
    novo = novo.replace("/apps/notas/espelho.html", "/demo/apps/notas/espelho.html")
    novo = novo.replace('"/cliente/', '"/demo/').replace("'/cliente/", "'/demo/")
    if origem == "apps/compras/index.html":
        if novo.count("/cotacao/#") != 1:
            sys.exit("Compras: endereço do link do convite mudou; ajuste gerar.py")
        novo = novo.replace("/cotacao/#", "/demo/cotacao/#")
    if origem == "apps/notas/index.html":
        if XML_ORIG not in novo:
            sys.exit("Buscador: trecho do download do XML mudou; ajuste XML_ORIG em gerar.py")
        novo = novo.replace(XML_ORIG, XML_DEMO)
    titulo = re.search(r"<title>(.*?)</title>", novo, re.S)
    if titulo:
        novo = novo.replace(titulo.group(0), f"<title>Demonstração · {titulo.group(1).strip()}</title>", 1)
    cab = ('<meta name="robots" content="noindex">\n'
           "<!-- GERADO por divulgacao/demo/gerar.py a partir de site/" + origem + ". Não editar aqui. -->\n" + FAIXA_CSS
           + (COMPRAS_CSS if origem in COMPRAS else ""))
    novo = novo.replace("</head>", cab + "\n</head>", 1)
    # contagem de acessos da demonstração (só conta a janela principal, não o app no iframe)
    novo = novo.replace("</body>", '<script src="/acesso.js" defer></script>\n</body>', 1)
    faixa = {"cliente/index.html": FAIXA_PORTAL, "apps/compras/index.html": FAIXA_COMPRAS, "cotacao/index.html": FAIXA_COTACAO}.get(origem, SELO_APP)
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
