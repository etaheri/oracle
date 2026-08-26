#!/usr/bin/env python3
"""Convert the VEED alpha-webm hero loop into the in-app animated WebP.

Usage: python3 make-hero-loop.py [source.webm]
Requires: ffmpeg on PATH, Pillow (pip install pillow).
"""
import glob
import os
import subprocess
import sys
import tempfile

from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_SRC = os.path.join(REPO, "design/art-direction/hero-loop-source.webm")
OUT = os.path.join(REPO, "apps/mobile/assets/art/hero-loop.webp")
FPS, WIDTH, QUALITY = 12, 1000, 72
# Pillow encodes the WebP alpha plane at full quality by default, and this
# asset is mostly soft transparent glow — alpha_quality is the size lever
# (q72/aq70 = 2.8MB ping-pong vs 4.6MB at the default alpha).
ALPHA_QUALITY = 70

src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
with tempfile.TemporaryDirectory() as td:
    # -c:v libvpx-vp9 BEFORE -i: ffmpeg's default vp9 path drops the alpha plane
    subprocess.run(
        ["ffmpeg", "-v", "error", "-c:v", "libvpx-vp9", "-i", src,
         "-vf", f"fps={FPS}", os.path.join(td, "f%03d.png")],
        check=True,
    )
    frames = [Image.open(f).convert("RGBA") for f in sorted(glob.glob(os.path.join(td, "f*.png")))]
    h = round(frames[0].size[1] * WIDTH / frames[0].size[0])
    frames = [f.resize((WIDTH, h), Image.LANCZOS) for f in frames]
    # Ping-pong: play forward then backward so the loop never snaps back to
    # frame one. Interior frames only — repeating either endpoint would hold
    # it for two frames at each turnaround.
    frames = frames + frames[-2:0:-1]
    frames[0].save(OUT, save_all=True, append_images=frames[1:],
                   duration=int(1000 / FPS), loop=0, quality=QUALITY,
                   alpha_quality=ALPHA_QUALITY, method=4)

mb = os.path.getsize(OUT) / 1e6
print(f"{OUT}: {mb:.2f} MB, {len(frames)} frames, {frames[0].size[0]}x{frames[0].size[1]}")
assert mb <= 3.0, "hero loop too heavy — lower QUALITY or FPS"
