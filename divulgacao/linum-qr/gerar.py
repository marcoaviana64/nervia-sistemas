#!/usr/bin/env python3
"""QR codes da LINUM com a origem de cada um (pedido do Marco em 28/10/2026).

Cada QR leva para https://nervia.com.br/linum/?o=<origem>; a página conta a leitura com a origem (site_acessos),
então dá para saber quantas pessoas leram o QR da vitrine de Ipanema, da Gávea, da sacola, do cartão…

Uso:  pip install segno playwright   (o Chromium já vem no ambiente)
      python3 divulgacao/linum-qr/gerar.py [pasta de saída]   (padrão: ./linum-qr)
Gera, para cada origem: <origem>.svg (só o QR, vetor, para a gráfica / Canva / Trakto) e <origem>.png (1200 px),
e um "adesivos.pdf" com um adesivo por página no tamanho real (7 cm), igual ao da vitrine.
Origem nova: acrescente em ORIGENS (só letras minúsculas, números e hífen) e rode de novo.
"""
import base64, io, os, sys
import segno
from playwright.sync_api import sync_playwright

BASE = "https://nervia.com.br/linum/?o="
ORIGENS = {
    "ipanema": "Vitrine / loja de Ipanema",
    "gavea": "Vitrine / loja da Gávea",
    "sacola": "Sacolas",
    "cartao": "Cartões de visita",
    "etiqueta": "Etiquetas das peças",
}


def main():
    saida = sys.argv[1] if len(sys.argv) > 1 else "linum-qr"
    os.makedirs(saida, exist_ok=True)
    paginas = []
    for o, desc in ORIGENS.items():
        url = BASE + o
        qr = segno.make(url, error="h", micro=False)   # correção alta: aguenta adesivo arranhado ou um selo no meio
        qr.save(os.path.join(saida, f"{o}.svg"), scale=10, border=2, dark="#000")
        qr.save(os.path.join(saida, f"{o}.png"), scale=max(1, 1200 // qr.symbol_size(border=2)[0]), border=2)
        buf = io.BytesIO(); qr.save(buf, kind="svg", scale=10, border=0, xmldecl=False, svgns=True)
        svg = base64.b64encode(buf.getvalue()).decode()
        paginas.append(f"""<section class="ad"><p class="t">Aponte a câmera do celular e<br>saiba mais sobre a <span class="m">LINUM</span><br>100% linho feito à mão.</p>
<img src="data:image/svg+xml;base64,{svg}" alt="QR {o}"><p class="o">{desc} · {url.replace('https://', '')}</p></section>""")
    html = """<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 80mm 95mm; margin: 0; }
body { margin: 0; font-family: "Open Sans", Arial, sans-serif; }
.ad { width: 80mm; height: 95mm; padding: 6mm 5mm 4mm; box-sizing: border-box; text-align: center; page-break-after: always; display: flex; flex-direction: column; align-items: center; }
.t { font-size: 12.5pt; font-weight: 700; line-height: 1.3; margin: 0 0 4mm; color: #222; }
.m { font-family: Georgia, serif; font-weight: 400; letter-spacing: .12em; color: #5b4a6b; font-size: 14pt; }
img { width: 58mm; height: 58mm; }
.o { font-size: 6.5pt; color: #999; margin: auto 0 0; }
</style></head><body>""" + "".join(paginas) + "</body></html>"
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(); pg.set_content(html, wait_until="load")
        pg.pdf(path=os.path.join(saida, "adesivos.pdf"), prefer_css_page_size=True, print_background=True); b.close()
    for o in ORIGENS:
        print(BASE + o)
    print("->", os.path.abspath(saida))


if __name__ == "__main__":
    main()
