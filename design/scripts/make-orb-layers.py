#!/usr/bin/env python3
"""Derive the orb's raster layers from the canonical image.

The shell keeps every photographic highlight and the blue-grey rim; the
interior is the low-frequency lavender-and-peach field the shader samples and
displaces. The split is by alpha, not by colour, so compositing the shell back
over the interior reconstructs the reference exactly -- which this script
asserts before writing anything.

Usage: design/.venv/bin/python design/scripts/make-orb-layers.py
Requires: Pillow.
"""
import math
import os
import sys

from PIL import Image, ImageChops, ImageFilter

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO, "design/art-direction/orb-reference.png")
OUT = os.path.join(REPO, "apps/mobile/assets/art")

# The knockout, as fractions of the orb radius. Measured, not guessed: angular
# variance of the reference rises steeply past r=0.72 (the specular arcs and
# the rim), and everything inside 0.55 is smooth lavender-to-peach with no
# structure worth preserving. Widen the feather before moving the radii.
KNOCK_INNER = 0.55
KNOCK_OUTER = 0.72

SHELL_SIZE = 512
INTERIOR_SIZE = 256  # the field is entirely low-frequency; 256 is ample
FALLBACK_SIZE = 512


def orb_crop(im):
    """The reference cropped to a square on the orb's alpha bounding box."""
    box = im.getchannel("A").getbbox()
    cx, cy = (box[0] + box[2]) // 2, (box[1] + box[3]) // 2
    r = ((box[2] - box[0]) + (box[3] - box[1])) // 4
    return im.crop((cx - r, cy - r, cx + r, cy + r))


def knockout_mask(size):
    """1.0 inside KNOCK_INNER, 0.0 outside KNOCK_OUTER, smoothstepped between."""
    mask = Image.new("L", (size, size), 0)
    px = mask.load()
    half = size / 2.0
    for y in range(size):
        for x in range(size):
            d = math.hypot(x + 0.5 - half, y + 0.5 - half) / half
            if d <= KNOCK_INNER:
                v = 1.0
            elif d >= KNOCK_OUTER:
                v = 0.0
            else:
                u = (d - KNOCK_INNER) / (KNOCK_OUTER - KNOCK_INNER)
                v = 1.0 - (u * u * (3.0 - 2.0 * u))  # smoothstep
            px[x, y] = int(round(255 * v))
    return mask.filter(ImageFilter.GaussianBlur(size / 256.0))


def main():
    if not os.path.exists(SRC):
        sys.exit(f"missing canonical image: {SRC}")
    orb = orb_crop(Image.open(SRC).convert("RGBA"))

    shell = orb.resize((SHELL_SIZE, SHELL_SIZE), Image.LANCZOS)
    mask = knockout_mask(SHELL_SIZE)
    # Shell alpha is scaled by (1 - mask); the interior keeps full alpha. This
    # exact pairing is what makes the composite reconstruct the reference.
    shell_alpha = ImageChops.multiply(shell.getchannel("A"), ImageChops.invert(mask))

    interior = orb.resize((INTERIOR_SIZE, INTERIOR_SIZE), Image.LANCZOS)
    interior.putalpha(255)

    # Verify before writing: shell over interior must equal the reference.
    base = interior.resize((SHELL_SIZE, SHELL_SIZE), Image.LANCZOS)
    knocked = shell.copy()
    knocked.putalpha(shell_alpha)
    recon = Image.alpha_composite(base, knocked)
    solid = shell.getchannel("A").point(lambda v: 255 if v == 255 else 0)
    diff = ImageChops.difference(recon.convert("RGB"), shell.convert("RGB"))
    worst = max(
        ch.getextrema()[1]
        for ch in Image.composite(diff, Image.new("RGB", diff.size), solid).split()
    )
    print(f"reconstruction worst channel delta inside the orb: {worst}")
    if worst > 3:
        sys.exit(f"reconstruction drifted by {worst}; the alpha split is wrong")

    os.makedirs(OUT, exist_ok=True)
    knocked.save(os.path.join(OUT, "orb-shell.png"))
    interior.save(os.path.join(OUT, "orb-interior.png"))
    orb.resize((FALLBACK_SIZE, FALLBACK_SIZE), Image.LANCZOS).save(
        os.path.join(OUT, "orb-fallback.png")
    )
    print("wrote orb-shell.png, orb-interior.png, orb-fallback.png")


if __name__ == "__main__":
    main()
