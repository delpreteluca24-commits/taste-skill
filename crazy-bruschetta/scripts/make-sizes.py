#!/usr/bin/env python3
"""
Da UNA foto originale ricava i tagli piccoli che servono al srcset.

Il ristorante manda un solo file per nome (hero.jpg, interno-1.jpg, ...).
Questo script genera i derivati -600 / -1000 / -800 / -1400 accanto all'originale,
cosi' non devi chiedere tre versioni della stessa foto.

Uso:
    python3 scripts/make-sizes.py                 # rigenera i derivati di tutte le foto
    python3 scripts/make-sizes.py hero.jpg        # solo una

Richiede Pillow:  pip install Pillow
"""

import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "assets" / "img"

# quali derivati servono per ciascuna foto (deve combaciare con i srcset di index.html)
TARGETS = {
    "hero.jpg": [800, 1400],
    "interno-1.jpg": [600, 1000],
    "interno-2.jpg": [600, 1000],
    "interno-3.jpg": [600, 1000],
    "interno-4.jpg": [600, 1000],
    "dehors.jpg": [600, 1000],
    "neon.jpg": [600, 1000],
    "og.jpg": [],
}


def derive(name: str, widths: list[int]):
    src = IMG / name
    if not src.exists():
        print(f"  ! manca {name}, salto")
        return
    stem = name.rsplit(".", 1)[0]
    with Image.open(src) as im:
        im = im.convert("RGB")
        for w in widths:
            if w >= im.width:
                print(f"  ! {name} e' largo {im.width}px, non posso derivare {w}px")
                continue
            h = round(im.height * w / im.width)
            out = IMG / f"{stem}-{w}.jpg"
            im.resize((w, h), Image.LANCZOS).save(
                out, "JPEG", quality=80, optimize=True, progressive=True
            )
            print(f"  {out.relative_to(ROOT)}  ({w}x{h})")


def main():
    wanted = sys.argv[1:] or list(TARGETS)
    for name in wanted:
        if name not in TARGETS:
            print(f"  ! {name} non e' nell'elenco, salto")
            continue
        derive(name, TARGETS[name])
    print("\nFatto.")


if __name__ == "__main__":
    main()
