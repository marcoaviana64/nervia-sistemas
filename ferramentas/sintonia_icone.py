# Gera os ícones do NVSintonia (site/sintonia/icone-*.png): fundo verde Nervia e dois círculos que se cruzam.
# Uso: python3 ferramentas/sintonia_icone.py
from PIL import Image, ImageDraw

def icone(tam, mascara=False):
    esc = 4
    S = tam * esc
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if mascara:
        d.rectangle([0, 0, S, S], fill=(0, 168, 98, 255))
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=(0, 168, 98, 255))
    area = 0.62 if mascara else 0.78           # a máscara corta as bordas: desenho menor
    r = S * area * 0.30
    cy = S / 2
    w = max(2, int(S * 0.045))
    for cx, cor in ((S / 2 - r * 0.55, (4, 20, 12, 255)), (S / 2 + r * 0.55, (255, 255, 255, 255))):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=cor, width=w)
    d.ellipse([S / 2 - w * 0.9, cy - w * 0.9, S / 2 + w * 0.9, cy + w * 0.9], fill=(255, 255, 255, 255))
    return img.resize((tam, tam), Image.LANCZOS)

for nome, tam, m in (("icone-192.png", 192, False), ("icone-512.png", 512, False), ("icone-512-mascara.png", 512, True)):
    icone(tam, m).save("site/sintonia/" + nome, optimize=True)
    print("site/sintonia/" + nome)
