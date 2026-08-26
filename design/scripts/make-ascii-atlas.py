#!/usr/bin/env python3
"""Generate the Terminal Patina glyph atlas (brand brief §5).

Eight cells, least->most dense: [space] . : - + * # %
White IBM Plex Mono glyphs on transparency, one horizontal strip.
Usage: python3 make-ascii-atlas.py   (requires Pillow)
"""
import os

from PIL import Image, ImageDraw, ImageFont

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FONT = os.path.join(REPO, "apps/mobile/assets/fonts/IBMPlexMono-Regular.ttf")
OUT = os.path.join(REPO, "apps/mobile/assets/art/ascii-atlas.png")

GLYPHS = [" ", ".", ":", "-", "+", "*", "#", "%"]
CELL_W, CELL_H = 96, 128

font = ImageFont.truetype(FONT, 104)
atlas = Image.new("RGBA", (CELL_W * len(GLYPHS), CELL_H), (0, 0, 0, 0))
draw = ImageDraw.Draw(atlas)

# Shared metrics so every glyph sits on the same baseline.
ascent, descent = font.getmetrics()
baseline_y = (CELL_H - (ascent + descent)) // 2 + ascent

for i, ch in enumerate(GLYPHS):
    if ch == " ":
        continue
    x0, y0, x1, y1 = font.getbbox(ch)
    w = x1 - x0
    x = i * CELL_W + (CELL_W - w) // 2 - x0
    draw.text((x, baseline_y - ascent), ch, font=font, fill=(255, 255, 255, 255))

atlas.save(OUT)

# Sanity: every non-space cell must contain ink.
for i, ch in enumerate(GLYPHS):
    cell = atlas.crop((i * CELL_W, 0, (i + 1) * CELL_W, CELL_H))
    bbox = cell.split()[3].getbbox()
    if ch == " ":
        assert bbox is None, "space cell must be empty"
    else:
        assert bbox is not None, f"glyph {ch!r} rendered empty"
print(f"{OUT}: {atlas.size[0]}x{atlas.size[1]}, {len(GLYPHS)} glyphs")
