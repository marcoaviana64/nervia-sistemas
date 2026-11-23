#!/usr/bin/env python3
# Gera o ícone do NVPlayer: adaptável (Android 8+), redondo e legado (Android 7), em 5 densidades.
import os, math
from PIL import Image, ImageDraw

# pasta res do app (relativa à raiz do repo); gera ic_launcher (quadrado), ic_launcher_round e ic_launcher_foreground.
RES = "iptv-tv/app/src/main/res"
SS = 4  # supersampling

NAVY1 = (16, 24, 48)     # #101830
NAVY0 = (8, 12, 26)      # #080c1a
CIANO = (52, 224, 242)   # #34e0f2
AZUL  = (14, 165, 233)   # #0ea5e9

def lerp(a, b, t): return tuple(round(a[i] + (b[i]-a[i])*t) for i in range(3))

def fundo_grad(size):
    """Quadrado de fundo: degradê navy diagonal + brilho ciano no topo."""
    im = Image.new("RGB", (size, size))
    px = im.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2*size)
            px[x, y] = lerp(NAVY1, NAVY0, t)
    # brilho radial ciano suave no canto superior
    glow = Image.new("L", (size, size), 0)
    g = glow.load()
    cx, cy, r = size*0.30, size*0.12, size*0.9
    for y in range(size):
        for x in range(size):
            d = math.hypot(x-cx, y-cy)/r
            if d < 1:
                g[x, y] = int(70*(1-d)**2)
    cyan = Image.new("RGB", (size, size), CIANO)
    im = Image.composite(cyan, im, glow)
    return im

def triangulo_mask(size):
    """Máscara do triângulo de play (apontando à direita, centrado opticamente)."""
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    L = size*0.37; R = size*0.70; T = size*0.28; B = size*0.72
    d.polygon([(L, T), (L, B), (R, size*0.5)], fill=255)
    return m

def triangulo(size):
    """Triângulo com degradê ciano->azul, sobre transparente."""
    grad = Image.new("RGB", (size, size))
    g = grad.load()
    for y in range(size):
        for x in range(size):
            t = (x*0.3 + y*0.7)/size
            g[x, y] = lerp(CIANO, AZUL, min(1, max(0, t)))
    out = Image.new("RGBA", (size, size), (0,0,0,0))
    out.paste(grad, (0,0), triangulo_mask(size))
    return out

def quadrado_arred(size, raio_frac=0.22):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0,0,size-1,size-1], radius=int(size*raio_frac), fill=255)
    return m

def circulo(size):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse([0,0,size-1,size-1], fill=255)
    return m

def icone_legado(size, redondo=False):
    s = size*SS
    base = fundo_grad(s).convert("RGBA")
    base.alpha_composite(triangulo(s))
    mask = circulo(s) if redondo else quadrado_arred(s)
    base.putalpha(mask)
    return base.resize((size, size), Image.LANCZOS)

def foreground(size):
    """Camada da frente do ícone adaptável: só o triângulo, na zona segura (centro ~60%)."""
    s = size*SS
    out = Image.new("RGBA", (s, s), (0,0,0,0))
    tri = triangulo(s)
    out.alpha_composite(tri)
    return out.resize((size, size), Image.LANCZOS)

def salvar(im, caminho):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    im.save(caminho)

# densidade -> (lado legado, lado foreground adaptável 108dp)
DENS = {"mdpi":(48,108), "hdpi":(72,162), "xhdpi":(96,216), "xxhdpi":(144,324), "xxxhdpi":(192,432)}

for dens,(leg, fg) in DENS.items():
    salvar(icone_legado(leg, False),  f"{RES}/mipmap-{dens}/ic_launcher.png")
    salvar(icone_legado(leg, True),   f"{RES}/mipmap-{dens}/ic_launcher_round.png")
    salvar(foreground(fg),            f"{RES}/mipmap-{dens}/ic_launcher_foreground.png")

print("Ícones gerados.")
