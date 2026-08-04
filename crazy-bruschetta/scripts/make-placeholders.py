#!/usr/bin/env python3
"""
Genera i placeholder grigi di assets/img/ con i nomi e le dimensioni definitive.

Servono solo finché non arrivano le foto vere: ogni file qui dentro va
sostituito 1:1 con lo scatto corrispondente (stesso nome, stesse proporzioni).
L'elenco di cosa chiedere al ristorante e' in SHOT-LIST.md.

Uso:
    python3 scripts/make-placeholders.py

Richiede Pillow:  pip install Pillow
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "assets" / "img"

BG = (74, 85, 96)        # grigio-blu neutro, non compete con la palette
FG = (168, 178, 188)     # testo
LINE = (95, 107, 119)    # griglia diagonale

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def placeholder(path: Path, w: int, h: int, label: str):
    """Rettangolo grigio con nome file e dimensioni stampati sopra."""
    im = Image.new("RGB", (w, h), BG)
    dr = ImageDraw.Draw(im)

    # diagonali leggere, per distinguere a colpo d'occhio un placeholder da una foto
    step = max(w, h) // 12 or 40
    for x in range(-h, w + h, step):
        dr.line([(x, 0), (x + h, h)], fill=LINE, width=1)

    dr.rectangle([8, 8, w - 9, h - 9], outline=LINE, width=2)

    f1 = font(FONT_BOLD, max(14, min(w, h) // 14))
    f2 = font(FONT_REG, max(11, min(w, h) // 22))

    t1, t2 = label, f"{w}x{h}"
    b1 = dr.textbbox((0, 0), t1, font=f1)
    b2 = dr.textbbox((0, 0), t2, font=f2)
    total = (b1[3] - b1[1]) + (b2[3] - b2[1]) + 12
    y = (h - total) // 2

    dr.text(((w - (b1[2] - b1[0])) // 2, y), t1, font=f1, fill=FG)
    dr.text(((w - (b2[2] - b2[0])) // 2, y + (b1[3] - b1[1]) + 12), t2, font=f2, fill=FG)

    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "JPEG", quality=72, optimize=True, progressive=True)
    print(f"  {path.relative_to(ROOT)}  ({w}x{h})")


# --- foto che finiscono in <img> con srcset -> servono i 3 tagli ----------------
# base = originale (piu' grande), poi i due derivati con suffisso -<width>
RESPONSIVE = [
    # (nome base, larghezza originale, altezza originale, larghezze derivate)
    ("hero.jpg", 2000, 1333, [800, 1400]),
    ("og.jpg", 1200, 630, []),
    ("interno-1.jpg", 1600, 1067, [600, 1000]),
    ("interno-2.jpg", 1200, 1600, [600, 1000]),
    ("interno-3.jpg", 1600, 1067, [600, 1000]),
    ("interno-4.jpg", 1200, 1600, [600, 1000]),
    ("dehors.jpg", 1600, 1067, [600, 1000]),
    ("neon.jpg", 1200, 1600, [600, 1000]),
]

# --- foto piatto: compaiono solo dentro il pannello di dettaglio, un taglio solo -
PIATTI = [
    "tagliere-della-casa", "tagliere-speciale",
    "semplice", "cotto-e-fiordilatte", "crudo-e-stracchino", "viennese",
    "ligure", "diavola", "contadina",
    "fit", "norma", "nerano", "boscaiola", "pistacchiosa", "vesuvio", "gorgo-speck",
    "tellaro", "spezzina", "monterosso", "delicata",
    "tortino-al-cioccolato", "bruschetta-nutella", "cremoso-al-pistacchio",
    "gnocchetti-al-pesto", "caprese", "bresaola-rucola-pomodorini-grana",
    "lasagna-al-ragu", "hamburger",
]
PIATTO_W, PIATTO_H = 1200, 900


def main():
    print("Genero i placeholder in assets/img/ ...")
    for name, w, h, derived in RESPONSIVE:
        stem = name.rsplit(".", 1)[0]
        placeholder(IMG / name, w, h, name)
        for dw in derived:
            dh = round(h * dw / w)
            placeholder(IMG / f"{stem}-{dw}.jpg", dw, dh, f"{stem}-{dw}.jpg")

    for slug in PIATTI:
        placeholder(IMG / "piatti" / f"{slug}.jpg", PIATTO_W, PIATTO_H, f"piatti/{slug}.jpg")

    n = sum(1 + len(d) for _, _, _, d in RESPONSIVE) + len(PIATTI)
    print(f"\nFatto: {n} file.")


if __name__ == "__main__":
    main()
