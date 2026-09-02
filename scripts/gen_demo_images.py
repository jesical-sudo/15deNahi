#!/usr/bin/env python3
"""Genera fotos de ejemplo para el feed de demostración del muro.
No son fotos reales de invitados -- son placeholders con la paleta del
evento (plateado / rosa / blanco / negro) para poder ver el muro
funcionando antes de tener fotos reales."""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "img", "demo")
os.makedirs(OUT, exist_ok=True)

PALETTES = [
    [(18, 15, 20), (194, 89, 124), (12, 10, 14)],   # negro -> rosa profundo
    [(28, 23, 32), (232, 147, 173), (18, 15, 20)],  # ciruela -> rosa
    [(20, 19, 23), (199, 202, 209), (10, 9, 11)],   # negro -> plateado
    [(30, 22, 27), (238, 240, 243), (16, 12, 15)],  # negro -> blanco plata
    [(24, 18, 24), (194, 89, 124), (199, 202, 209)],# rosa -> plateado
]

random.seed(15)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make_gradient(size, c1, c2, angle_deg):
    w, h = size
    im = Image.new("RGB", size)
    px = im.load()
    rad = math.radians(angle_deg)
    dx, dy = math.cos(rad), math.sin(rad)
    coords = [(x, y) for x in (0, w) for y in (0, h)]
    proj = [x * dx + y * dy for x, y in coords]
    lo, hi = min(proj), max(proj)
    for y in range(h):
        for x in range(0, w, 2):
            t = ((x * dx + y * dy) - lo) / (hi - lo + 1e-6)
            col = lerp(c1, c2, t)
            px[x, y] = col
            if x + 1 < w:
                px[x + 1, y] = col
    return im


def add_sparkle(draw, w, h, n, color):
    for _ in range(n):
        x, y = random.randint(0, w), random.randint(0, h)
        r = random.choice([1, 1, 1, 2, 2, 3])
        a = random.randint(60, 190)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color + (a,))


def font(size):
    for path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


LABELS = [
    "Ensayo del vals", "Previa con amigas", "Llegando al salón",
    "Familia completa", "La torta", "Pista de baile", "Brindis",
    "Cambio de zapatillas", "Recuerdo del día", "Última foto de la noche",
]

for i, label in enumerate(LABELS):
    portrait = i % 3 != 0
    size = (1080, 1350) if portrait else (1080, 1080)
    c1, c2, c3 = PALETTES[i % len(PALETTES)]
    angle = random.choice([20, 45, 70, 110, 160])
    im = make_gradient(size, c1, c2, angle)
    im = im.filter(ImageFilter.GaussianBlur(0.6))

    overlay = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    add_sparkle(draw, *size, 140, (238, 240, 243))

    # marco fino plateado
    draw.rectangle([18, 18, size[0] - 18, size[1] - 18], outline=(199, 202, 209, 140), width=2)

    # etiqueta
    f = font(40)
    tw = draw.textlength(label, font=f)
    draw.text(((size[0] - tw) / 2, size[1] - 110), label, font=f, fill=(246, 243, 245, 235))
    f2 = font(26)
    tag = "foto de ejemplo · #15deNahi"
    tw2 = draw.textlength(tag, font=f2)
    draw.text(((size[0] - tw2) / 2, size[1] - 64), tag, font=f2, fill=(199, 202, 209, 190))

    im = Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")
    im.save(os.path.join(OUT, f"demo{i+1:02d}.jpg"), quality=82)

print("listo:", len(LABELS), "imágenes en", OUT)
