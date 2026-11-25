# Gera os ícones do NVAura (site/aura/icone-*.png): fundo em degradê roxo → rosa, um anel de "aura" e uma estrela dourada.
# Uso: python3 ferramentas/aura_icone.py
import math
from PIL import Image, ImageDraw

A, B, OURO = (109, 60, 240), (255, 92, 154), (255, 181, 71)

def degrade(S):
    img = Image.new("RGBA", (S, S))
    px = img.load()
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * S)
            px[x, y] = tuple(int(A[i] + (B[i] - A[i]) * t) for i in range(3)) + (255,)
    return img

def estrela(cx, cy, r):
    pts = []
    for i in range(10):
        ang = -math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.45
        pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
    return pts

def icone(tam, mascara=False):
    esc = 3
    S = tam * esc
    fundo = degrade(S)
    mask = Image.new("L", (S, S), 0)
    dm = ImageDraw.Draw(mask)
    if mascara:
        dm.rectangle([0, 0, S, S], fill=255)
    else:
        dm.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(fundo, (0, 0), mask)
    d = ImageDraw.Draw(img)
    area = 0.62 if mascara else 0.8
    r = S * area * 0.42
    c = S / 2
    w = max(2, int(S * 0.035))
    for k, alfa in ((1.0, 255), (1.18, 110)):
        rr = r * k
        d.ellipse([c - rr, c - rr, c + rr, c + rr], outline=(255, 255, 255, alfa), width=w)
    d.polygon(estrela(c, c + r * 0.04, r * 0.62), fill=OURO + (255,))
    return img.resize((tam, tam), Image.LANCZOS)

for nome, tam, m in (("icone-192.png", 192, False), ("icone-512.png", 512, False), ("icone-512-mascara.png", 512, True)):
    icone(tam, m).save("site/aura/" + nome, optimize=True)
    print("site/aura/" + nome)
