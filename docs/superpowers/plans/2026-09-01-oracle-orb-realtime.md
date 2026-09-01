# Real-Time Oracle Orb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1.2 MB animated-WebP orb with a hybrid raster-plus-Skia renderer that keeps the approved glass shell photographic and animates only its interior, responding to touch and to the day's state.

**Architecture:** One Skia `Canvas` per orb draws an SkSL interior, then the raster shell on top, then a tight halo. The shader never authors colour — it samples `orb-interior.png` (the field the shell knockout removed) and displaces the sample coordinate, so at rest the composite is pixel-identical to the reference by construction. Five pure, node-testable modules own touch mapping, ripple slots, quality resolution, and state-to-uniform targets.

**Tech Stack:** TypeScript, React Native 0.86, Expo SDK 57, `@shopify/react-native-skia` 2.6.2, `react-native-reanimated` 4.5.1, `expo-haptics`, vitest 4, Pillow (asset script only).

**Spec:** `docs/superpowers/specs/2026-09-01-oracle-orb-realtime-design.md`

## Global Constraints

- **No new runtime dependencies.** Everything needed is already in `apps/mobile/package.json`. Pillow lives in `design/.venv` (gitignored) and is build-time only.
- **`apps/mobile/src/game/heroStage.ts` must not change.** The orb tile keeps its rect so nothing else on Home moves.
- **Tests are pure.** Files in `apps/mobile/test/*.test.ts` may never import Skia, React, or React Native — same rule `orbMood.ts` and `haloMood.ts` already follow. `vitest.config.ts` only collects `test/**/*.test.ts`; do not add `.tsx` tests or testing-library dependencies.
- **The shell raster is never displaced, filtered, or deformed.** No code path may write to the silhouette.
- **Orb geometry, as fractions of the tile:** diameter `0.897`, centre y-offset `-0.0177`. These come from measuring frame 0 of the retired loop; the orb must never deviate from them at runtime.
- **Knockout constants:** inner radius `0.55`, outer radius `0.72`, as fractions of the orb radius.
- **Palette (from `src/theme.ts`, do not re-declare literals in new files):** `glassBlue #9CB5D1`, `lavender #B7A9E4`, `warmCenter #F2BE91`, `museumWhite #F7F6F2`.
- **Failures degrade, never crash.** A shader compile failure or a missing image drops to the static tier and logs via `console.error`, exactly as `src/ui/GlassRefraction.tsx` does. Startup and navigation must never block.
- **Baseline to preserve:** `pnpm test` = 150 passing, `pnpm typecheck` = clean. Both must hold after every task.
- **Run commands from `apps/mobile/`** unless a step says otherwise.
- **Commit after every task.** End commit messages with `Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ`.

---

## File Structure

**Create:**
- `design/scripts/make-orb-layers.py` — derives all three rasters from the canonical image; owns the knockout constants and the reconstruction assertion.
- `apps/mobile/assets/art/orb-shell.png` — 512², glass shell with the interior knocked out.
- `apps/mobile/assets/art/orb-interior.png` — 256², the field the shader samples.
- `apps/mobile/assets/art/orb-fallback.png` — 512², the reference unmodified.
- `apps/mobile/src/ui/orb/orbTouch.ts` — pure: screen→local coords, hit test, sphere normal.
- `apps/mobile/src/ui/orb/orbRipples.ts` — pure: two ripple slots.
- `apps/mobile/src/ui/orb/orbQuality.ts` — pure: tier resolution.
- `apps/mobile/src/ui/orb/orbState.ts` — pure: state→uniform targets.
- `apps/mobile/src/ui/orb/orbShader.ts` — SkSL source + module-scope compiled effect.
- `apps/mobile/src/ui/orb/OracleOrbCanvas.tsx` — the Canvas; binds uniforms.
- `apps/mobile/src/ui/orb/OracleOrb.tsx` — public component; tiers, touch target, ref handle.
- `apps/mobile/test/orbTouch.test.ts`, `orbRipples.test.ts`, `orbQuality.test.ts`, `orbState.test.ts`.

**Modify:**
- `apps/mobile/src/ui/LivingHero.tsx` — swap `OrbLayer` for `OracleOrb`.
- `apps/mobile/src/ui/BootRite.tsx` — swap `OrbLayer` for `OracleOrb`.

**Delete:**
- `apps/mobile/src/ui/OrbLayer.tsx`
- `apps/mobile/assets/art/orb-loop.webp`

**Task dependency order.** Tasks 2–5 are independent of each other and of Task 1; they may run in parallel. Task 6 needs Tasks 1 and 4. Tasks 7–9 are sequential after 6. Task 10 needs everything.

---

### Task 1: Asset pipeline

**Files:**
- Create: `design/scripts/make-orb-layers.py`
- Create (generated, committed): `apps/mobile/assets/art/orb-shell.png`, `orb-interior.png`, `orb-fallback.png`
- Reads: `design/art-direction/orb-reference.png`

**Interfaces:**
- Consumes: nothing.
- Produces: three PNGs. `orb-interior.png` is 256×256, RGB from the reference, alpha 255 everywhere. `orb-shell.png` is 512×512, RGB from the reference, alpha = `reference.alpha × (1 − mask)`. `orb-fallback.png` is 512×512, the reference orb cropped square, unmodified. All three are square crops of the same bounding box, so the orb's centre is each image's centre and its diameter is each image's full width.

- [ ] **Step 1: Write the script**

The reconstruction identity is the whole point of the alpha split, so it is asserted, not assumed. With shell over interior and both carrying the same RGB `C`:

```
out = C·a·(1−m) + C·1·(1 − a·(1−m))   which for a = 1 is  C·(1−m) + C·m = C
```

```python
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
```

- [ ] **Step 2: Run it**

Run from the repo root:

```bash
design/.venv/bin/python design/scripts/make-orb-layers.py
```

Expected: `reconstruction worst channel delta inside the orb: 0` (any value ≤ 3 passes) followed by the write confirmation. A non-zero exit means the alpha split is wrong — fix the split, do not raise the threshold.

- [ ] **Step 3: Confirm the outputs**

```bash
cd apps/mobile && ls -la assets/art/orb-shell.png assets/art/orb-interior.png assets/art/orb-fallback.png
```

Expected: three files, shell and fallback 512², interior 256². The shell must show a hollow glass ring with the rim, the upper-left specular, and the lower-right reflection intact.

- [ ] **Step 4: Commit**

```bash
git add design/scripts/make-orb-layers.py apps/mobile/assets/art/orb-shell.png apps/mobile/assets/art/orb-interior.png apps/mobile/assets/art/orb-fallback.png
git commit -m "feat(design): derive the orb's shell, interior, and fallback rasters

The split is by alpha rather than by colour, so compositing the shell back
over the interior reconstructs the canonical image exactly. The script
asserts that identity before it writes.

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

### Task 2: `orbTouch` — screen to sphere

**Files:**
- Create: `apps/mobile/src/ui/orb/orbTouch.ts`
- Test: `apps/mobile/test/orbTouch.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type OrbPoint = { x: number; y: number }`
  - `type OrbHit = { local: OrbPoint; normal: readonly [number, number, number] }`
  - `locate(touch: OrbPoint, tile: number): OrbHit | null` — `touch` is in tile-local pixels (0…`tile`), `tile` is the tile's side length in pixels. Returns `null` when the touch falls outside the orb's circle. `local` is in `[-1, 1]`.
  - `ORB_D = 0.897`, `ORB_DY = -0.0177` — exported so `OracleOrbCanvas` and `LivingHero` share one source of truth.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { locate, ORB_D, ORB_DY } from "../src/ui/orb/orbTouch";

// A 310px tile, the size the hero stage gives the orb on a typical phone.
const TILE = 310;
// The orb's centre inside that tile: horizontally centred, lifted by ORB_DY.
const CX = TILE / 2;
const CY = TILE / 2 + ORB_DY * TILE;
const R = (ORB_D * TILE) / 2;

describe("locate", () => {
  it("puts the orb's centre at the origin", () => {
    const hit = locate({ x: CX, y: CY }, TILE);
    expect(hit).not.toBeNull();
    expect(hit!.local.x).toBeCloseTo(0, 5);
    expect(hit!.local.y).toBeCloseTo(0, 5);
  });

  it("faces the viewer at the centre", () => {
    const [nx, ny, nz] = locate({ x: CX, y: CY }, TILE)!.normal;
    expect(nx).toBeCloseTo(0, 5);
    expect(ny).toBeCloseTo(0, 5);
    expect(nz).toBeCloseTo(1, 5);
  });

  it("reaches exactly 1 at the silhouette", () => {
    const hit = locate({ x: CX + R * 0.999, y: CY }, TILE)!;
    expect(hit.local.x).toBeCloseTo(0.999, 3);
    // At the rim the normal lies very nearly in the screen plane.
    expect(hit.normal[2]).toBeLessThan(0.05);
  });

  it("rejects a touch outside the circle", () => {
    expect(locate({ x: CX + R * 1.01, y: CY }, TILE)).toBeNull();
    // The tile's corners are outside the orb and must not be tappable.
    expect(locate({ x: 0, y: 0 }, TILE)).toBeNull();
    expect(locate({ x: TILE, y: TILE }, TILE)).toBeNull();
  });

  it("accounts for the orb sitting above the tile's centre", () => {
    // The tile's own centre is BELOW the orb's, so its local y is positive.
    const hit = locate({ x: CX, y: TILE / 2 }, TILE)!;
    expect(hit.local.y).toBeGreaterThan(0);
  });

  it("returns a unit normal everywhere inside", () => {
    for (const [dx, dy] of [[0.3, -0.4], [-0.7, 0.2], [0.0, 0.9], [0.5, 0.5]]) {
      const [nx, ny, nz] = locate({ x: CX + dx * R, y: CY + dy * R }, TILE)!.normal;
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
    }
  });

  it("survives a degenerate tile without producing NaN", () => {
    expect(locate({ x: 0, y: 0 }, 0)).toBeNull();
    expect(locate({ x: Number.NaN, y: 0 }, TILE)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/mobile && pnpm vitest run test/orbTouch.test.ts`
Expected: FAIL — cannot resolve `../src/ui/orb/orbTouch`.

- [ ] **Step 3: Write the implementation**

```ts
// Touch, in the orb's own terms. Pure: the tests must never load Skia.
//
// The tile is a square from the hero stage; the orb is a circle inside it,
// at frame 0's measured diameter and centre (see the design doc's Geometry
// section). Everything downstream — ripple origins, hit testing — speaks the
// normalized [-1, 1] coordinates this produces.

// Fractions of the tile's side. The orb never deviates from these at runtime:
// the silhouette is fixed by construction, not by animation discipline.
export const ORB_D = 0.897;
export const ORB_DY = -0.0177;

export type OrbPoint = { x: number; y: number };
export type OrbHit = { local: OrbPoint; normal: readonly [number, number, number] };

export function locate(touch: OrbPoint, tile: number): OrbHit | null {
  if (!Number.isFinite(tile) || tile <= 0) return null;
  if (!Number.isFinite(touch.x) || !Number.isFinite(touch.y)) return null;

  const r = (ORB_D * tile) / 2;
  const cx = tile / 2;
  const cy = tile / 2 + ORB_DY * tile;
  const x = (touch.x - cx) / r;
  const y = (touch.y - cy) / r;

  const d2 = x * x + y * y;
  // Outside the silhouette is not a touch on the orb — the tile's corners
  // belong to the hero, not to the glass.
  if (d2 > 1) return null;

  // Front-facing sphere normal. z falls to 0 at the rim, so a touch there
  // leans entirely across the surface rather than into it.
  const z = Math.sqrt(Math.max(0, 1 - d2));
  const len = Math.hypot(x, y, z) || 1;
  return { local: { x, y }, normal: [x / len, y / len, z / len] };
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd apps/mobile && pnpm vitest run test/orbTouch.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/ui/orb/orbTouch.ts apps/mobile/test/orbTouch.test.ts
git commit -m "feat(mobile): map touches into the orb's own coordinates

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

### Task 3: `orbRipples` — two slots

**Files:**
- Create: `apps/mobile/src/ui/orb/orbRipples.ts`
- Test: `apps/mobile/test/orbRipples.test.ts`

**Interfaces:**
- Consumes: `OrbPoint` from `orbTouch.ts`.
- Produces:
  - `RIPPLE_MS = 1300`
  - `type Ripple = { origin: OrbPoint; startMs: number; strength: number }`
  - `type RippleSlots = readonly [Ripple | null, Ripple | null]`
  - `EMPTY_SLOTS: RippleSlots`
  - `assign(slots: RippleSlots, next: Ripple, nowMs: number, capacity?: number): RippleSlots` — `capacity` is 2 (high tier) or 1 (reduced tier), default 2.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { assign, EMPTY_SLOTS, RIPPLE_MS, type RippleSlots } from "../src/ui/orb/orbRipples";

const at = (t: number, s = 1) => ({ origin: { x: 0, y: 0 }, startMs: t, strength: s });

describe("assign", () => {
  it("takes the first free slot", () => {
    const slots = assign(EMPTY_SLOTS, at(0), 0);
    expect(slots[0]).not.toBeNull();
    expect(slots[1]).toBeNull();
  });

  it("a second tap takes the second slot", () => {
    let slots = assign(EMPTY_SLOTS, at(0), 0);
    slots = assign(slots, at(100), 100);
    expect(slots[0]!.startMs).toBe(0);
    expect(slots[1]!.startMs).toBe(100);
  });

  it("a third tap reclaims a slot whose ripple has finished", () => {
    let slots = assign(EMPTY_SLOTS, at(0), 0);
    slots = assign(slots, at(1000), 1000);
    // At t = 1400 the first ripple is done (started at 0, lasts RIPPLE_MS).
    slots = assign(slots, at(1400), 1400);
    expect(slots[0]!.startMs).toBe(1400);
    expect(slots[1]!.startMs).toBe(1000);
  });

  it("with both still running, replaces the weakest", () => {
    let slots: RippleSlots = [at(0, 0.9), at(50, 0.3)];
    slots = assign(slots, at(100, 1), 100);
    expect(slots[0]!.strength).toBe(0.9);
    expect(slots[1]!.strength).toBe(1);
  });

  it("breaks a strength tie by replacing the oldest", () => {
    let slots: RippleSlots = [at(0, 0.5), at(50, 0.5)];
    slots = assign(slots, at(100), 100);
    expect(slots[0]!.startMs).toBe(100);
    expect(slots[1]!.startMs).toBe(50);
  });

  it("honours a capacity of one in the reduced tier", () => {
    let slots = assign(EMPTY_SLOTS, at(0), 0, 1);
    slots = assign(slots, at(100), 100, 1);
    expect(slots[0]!.startMs).toBe(100);
    expect(slots[1]).toBeNull();
  });

  it("never mutates the slots it was given", () => {
    const before = EMPTY_SLOTS;
    assign(before, at(0), 0);
    expect(before[0]).toBeNull();
  });

  it("expires a ripple exactly at RIPPLE_MS", () => {
    let slots: RippleSlots = [at(0, 1), at(0, 1)];
    slots = assign(slots, at(RIPPLE_MS), RIPPLE_MS);
    expect(slots[0]!.startMs).toBe(RIPPLE_MS);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/mobile && pnpm vitest run test/orbRipples.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// Ripple slots. Two at most, because the shader carries two ripple uniforms
// and a third would have to displace one of them anyway -- better to choose
// which, here, in code that can be reasoned about, than in SkSL.
import type { OrbPoint } from "./orbTouch";

// A ripple's whole life, in milliseconds: compression, the wave crossing the
// sphere, the warm centre leaning, then the return to the steady state.
export const RIPPLE_MS = 1300;

export type Ripple = { origin: OrbPoint; startMs: number; strength: number };
export type RippleSlots = readonly [Ripple | null, Ripple | null];

export const EMPTY_SLOTS: RippleSlots = [null, null];

function done(r: Ripple | null, nowMs: number): boolean {
  return r === null || nowMs - r.startMs >= RIPPLE_MS;
}

export function assign(
  slots: RippleSlots,
  next: Ripple,
  nowMs: number,
  capacity: number = 2,
): RippleSlots {
  const out: (Ripple | null)[] = [slots[0], slots[1]];
  const usable = capacity >= 2 ? 2 : 1;

  // The reduced tier owns one slot; the second is held empty rather than
  // left stale, so dropping a tier never leaves a ripple frozen mid-travel.
  if (usable === 1) return [next, null];

  // A free or finished slot first -- a tap should never cut a live ripple
  // short while a spent one sits idle beside it.
  for (let i = 0; i < usable; i++) {
    if (done(out[i], nowMs)) {
      out[i] = next;
      return [out[0], out[1]];
    }
  }

  // Both still travelling: the weakest yields, and on a tie the oldest does,
  // since it is closest to finishing anyway.
  const a = out[0]!;
  const b = out[1]!;
  const replaceFirst = a.strength < b.strength || (a.strength === b.strength && a.startMs <= b.startMs);
  out[replaceFirst ? 0 : 1] = next;
  return [out[0], out[1]];
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd apps/mobile && pnpm vitest run test/orbRipples.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/ui/orb/orbRipples.ts apps/mobile/test/orbRipples.test.ts
git commit -m "feat(mobile): choose which ripple a third tap displaces

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

### Task 4: `orbQuality` — tier resolution

**Files:**
- Create: `apps/mobile/src/ui/orb/orbQuality.ts`
- Test: `apps/mobile/test/orbQuality.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type OrbTier = "high" | "reduced" | "static"`
  - `type OrbQualityProp = "auto" | "high" | "reduced" | "static"`
  - `type QualitySignals = { prop?: OrbQualityProp; reducedMotion: boolean; compiled: boolean; imagesReady: boolean }`
  - `resolve(signals: QualitySignals): OrbTier`
  - `rippleCapacity(tier: OrbTier): number`, `interiorSamples(tier: OrbTier): number`, `dispersionEnabled(tier: OrbTier): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  dispersionEnabled,
  interiorSamples,
  resolve,
  rippleCapacity,
} from "../src/ui/orb/orbQuality";

const ok = { reducedMotion: false, compiled: true, imagesReady: true };

describe("resolve", () => {
  it("runs high when everything is available", () => {
    expect(resolve(ok)).toBe("high");
    expect(resolve({ ...ok, prop: "auto" })).toBe("high");
  });

  it("falls to static when the shader did not compile", () => {
    expect(resolve({ ...ok, compiled: false })).toBe("static");
  });

  it("falls to static when the images are not loaded", () => {
    expect(resolve({ ...ok, imagesReady: false })).toBe("static");
  });

  it("falls to static under reduced motion", () => {
    expect(resolve({ ...ok, reducedMotion: true })).toBe("static");
  });

  it("lets an explicit prop pick a lower tier", () => {
    expect(resolve({ ...ok, prop: "reduced" })).toBe("reduced");
    expect(resolve({ ...ok, prop: "static" })).toBe("static");
  });

  it("never lets a prop override a hard failure", () => {
    // Asking for high on a device where the shader failed must not render a
    // shader. The signals are facts; the prop is only a preference.
    expect(resolve({ ...ok, prop: "high", compiled: false })).toBe("static");
    expect(resolve({ ...ok, prop: "high", reducedMotion: true })).toBe("static");
    expect(resolve({ ...ok, prop: "reduced", imagesReady: false })).toBe("static");
  });
});

describe("tier capabilities", () => {
  it("gives the high tier two ripples, two samples, and dispersion", () => {
    expect(rippleCapacity("high")).toBe(2);
    expect(interiorSamples("high")).toBe(2);
    expect(dispersionEnabled("high")).toBe(true);
  });

  it("halves the reduced tier and drops dispersion", () => {
    expect(rippleCapacity("reduced")).toBe(1);
    expect(interiorSamples("reduced")).toBe(1);
    expect(dispersionEnabled("reduced")).toBe(false);
  });

  it("gives the static tier no ripples at all", () => {
    expect(rippleCapacity("static")).toBe(0);
    expect(dispersionEnabled("static")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/mobile && pnpm vitest run test/orbQuality.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// Which orb we can actually draw.
//
// There is deliberately no runtime frame-rate governor. The project has no FPS
// telemetry and the brief forbids branching on device models, so an "auto"
// tier would have nothing honest to read. These three signals are real, and
// they are all read once at mount.

export type OrbTier = "high" | "reduced" | "static";
export type OrbQualityProp = "auto" | "high" | "reduced" | "static";

export type QualitySignals = {
  prop?: OrbQualityProp;
  reducedMotion: boolean;
  compiled: boolean;
  imagesReady: boolean;
};

export function resolve({ prop = "auto", reducedMotion, compiled, imagesReady }: QualitySignals): OrbTier {
  // Facts beat preferences: asking for `high` on a device whose shader failed
  // to compile must not produce a shader.
  if (!compiled || !imagesReady || reducedMotion) return "static";
  if (prop === "static") return "static";
  if (prop === "reduced") return "reduced";
  return "high";
}

export function rippleCapacity(tier: OrbTier): number {
  return tier === "high" ? 2 : tier === "reduced" ? 1 : 0;
}

export function interiorSamples(tier: OrbTier): number {
  // The static tier draws a raster, so its sample count is nominal.
  return tier === "high" ? 2 : 1;
}

export function dispersionEnabled(tier: OrbTier): boolean {
  return tier === "high";
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd apps/mobile && pnpm vitest run test/orbQuality.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/ui/orb/orbQuality.ts apps/mobile/test/orbQuality.test.ts
git commit -m "feat(mobile): resolve the orb's tier from signals that are real

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

### Task 5: `orbState` — states to uniform targets

**Files:**
- Create: `apps/mobile/src/ui/orb/orbState.ts`
- Test: `apps/mobile/test/orbState.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type OrbState = "dormant" | "waking" | "attending" | "sealed" | "revealing" | "spent"`
  - `type OrbTargets = { parallax: number; centerDepth: number; centerLean: number; refraction: number; halo: number; timeScale: number }`
  - `targetsFor(state: OrbState): OrbTargets`
  - `transitionMs(from: OrbState, to: OrbState): number`
  - `isTransient(state: OrbState): boolean`
  - `settleTo(state: OrbState): OrbState`
  - `nextState(current: OrbState, requested: OrbState): OrbState`

`centerDepth` is positive when the warm centre recedes (an outward coordinate scale) and negative when it advances. It can never shrink the centre to a dot, because it never scales toward the origin.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  isTransient,
  nextState,
  settleTo,
  targetsFor,
  transitionMs,
  type OrbState,
} from "../src/ui/orb/orbState";

const ALL: OrbState[] = ["dormant", "waking", "attending", "sealed", "revealing", "spent"];

describe("targetsFor", () => {
  it("freezes the orb completely while dormant", () => {
    const t = targetsFor("dormant");
    // The boot rite holds a still. Every warp must be at baseline, or the
    // still would not be the reference image.
    expect(t.timeScale).toBe(0);
    expect(t.parallax).toBe(0);
    expect(t.centerDepth).toBe(0);
    expect(t.centerLean).toBe(0);
    expect(t.refraction).toBe(0);
  });

  it("opens the interior's depth when the day is being revealed", () => {
    // Revealing advances the centre toward the front glass: negative depth.
    expect(targetsFor("revealing").centerDepth).toBeLessThan(0);
    expect(targetsFor("revealing").halo).toBeGreaterThan(targetsFor("attending").halo);
  });

  it("lets the centre recede when the day is spent, without erasing it", () => {
    expect(targetsFor("spent").centerDepth).toBeGreaterThan(0);
    expect(targetsFor("spent").halo).toBeLessThan(targetsFor("attending").halo);
  });

  it("settles the interior once the player has sealed", () => {
    expect(targetsFor("sealed").parallax).toBeLessThan(targetsFor("attending").parallax);
  });

  it("keeps every state inside the range the shader can carry", () => {
    for (const s of ALL) {
      const t = targetsFor(s);
      expect(t.parallax).toBeGreaterThanOrEqual(0);
      expect(t.parallax).toBeLessThanOrEqual(1);
      expect(t.halo).toBeGreaterThanOrEqual(0);
      expect(t.halo).toBeLessThanOrEqual(1);
      expect(Math.abs(t.centerDepth)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(t.centerLean)).toBeLessThanOrEqual(0.5);
      expect(t.refraction).toBeGreaterThanOrEqual(0);
      expect(t.refraction).toBeLessThanOrEqual(1);
      expect(t.timeScale).toBeGreaterThanOrEqual(0);
    }
  });

  it("never returns an opaque or degenerate interior", () => {
    // A centre that scaled toward the origin would collapse into the dot the
    // brief forbids. Nothing may scale below the baseline.
    for (const s of ALL) expect(targetsFor(s).centerDepth).toBeGreaterThan(-0.5);
  });
});

describe("transitionMs", () => {
  it("runs the awakening between 700 and 1000ms", () => {
    const ms = transitionMs("dormant", "waking");
    expect(ms).toBeGreaterThanOrEqual(700);
    expect(ms).toBeLessThanOrEqual(1000);
  });

  it("moves between steady states slowly enough not to be countable", () => {
    expect(transitionMs("attending", "sealed")).toBeGreaterThanOrEqual(400);
  });

  it("is symmetric for steady states", () => {
    expect(transitionMs("attending", "spent")).toBe(transitionMs("spent", "attending"));
  });
});

describe("transients", () => {
  it("marks only waking and revealing as transient", () => {
    expect(isTransient("waking")).toBe(true);
    expect(isTransient("revealing")).toBe(true);
    expect(isTransient("attending")).toBe(false);
    expect(isTransient("dormant")).toBe(false);
  });

  it("settles a transient into the state that should follow it", () => {
    expect(settleTo("waking")).toBe("attending");
    expect(settleTo("revealing")).toBe("spent");
  });

  it("leaves steady states where they are", () => {
    expect(settleTo("attending")).toBe("attending");
    expect(settleTo("sealed")).toBe("sealed");
  });
});

describe("nextState", () => {
  it("accepts any move out of a steady state", () => {
    expect(nextState("attending", "sealed")).toBe("sealed");
    expect(nextState("sealed", "revealing")).toBe("revealing");
  });

  it("refuses to restart a transient that is already running", () => {
    // Without this, a parent re-rendering with the same prop would re-run the
    // awakening on every commit.
    expect(nextState("waking", "waking")).toBe("waking");
    expect(nextState("revealing", "revealing")).toBe("revealing");
  });

  it("never returns to dormant once the orb has woken", () => {
    // Dormant is the boot rite's still. Going back would freeze a live orb.
    expect(nextState("attending", "dormant")).toBe("attending");
    expect(nextState("waking", "dormant")).toBe("waking");
  });

  it("lets a real state change interrupt a transient", () => {
    expect(nextState("waking", "sealed")).toBe("sealed");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/mobile && pnpm vitest run test/orbState.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// The orb's states, in ORACLE's vocabulary rather than a voice assistant's.
// Pure: no React, no Skia, no Reanimated. This module decides *what* the
// interior should be doing; OracleOrbCanvas decides how to get there.

export type OrbState = "dormant" | "waking" | "attending" | "sealed" | "revealing" | "spent";

export type OrbTargets = {
  // How fast the two interior layers slide past each other. 0 is still.
  parallax: number;
  // Positive recedes the warm centre (an outward coordinate scale); negative
  // advances it toward the front glass. It never scales toward the origin, so
  // the centre cannot collapse into a dot.
  centerDepth: number;
  // How far the centre sits off-axis.
  centerLean: number;
  // Interior-only refraction, strongest where the glass is steepest.
  refraction: number;
  // The tight glow just outside the silhouette.
  halo: number;
  // Multiplier on the shader's clock. 0 freezes the orb on its current frame.
  timeScale: number;
};

const TARGETS: Record<OrbState, OrbTargets> = {
  // The boot rite's still. Every warp at baseline, so what it holds IS the
  // reference image.
  dormant: { parallax: 0, centerDepth: 0, centerLean: 0, refraction: 0, halo: 0, timeScale: 0 },
  // The arrival: the centre comes forward and the halo lights.
  waking: { parallax: 0.35, centerDepth: -0.08, centerLean: 0.06, refraction: 0.5, halo: 0.55, timeScale: 1 },
  // A round is open. Slow opposing drift, broad and slightly off-axis warmth.
  // The cycle must not be consciously countable, hence the low parallax.
  attending: { parallax: 0.4, centerDepth: 0, centerLean: 0.08, refraction: 0.55, halo: 0.5, timeScale: 1 },
  // The player has committed. The interior settles.
  sealed: { parallax: 0.22, centerDepth: 0.04, centerLean: 0.04, refraction: 0.5, halo: 0.45, timeScale: 0.8 },
  // The crowd is shown. The centre advances and the interior opens.
  revealing: { parallax: 0.55, centerDepth: -0.16, centerLean: 0.12, refraction: 0.7, halo: 0.7, timeScale: 1.15 },
  // The day is done. The centre withdraws and cools; the halo contracts.
  spent: { parallax: 0.18, centerDepth: 0.14, centerLean: 0.02, refraction: 0.42, halo: 0.3, timeScale: 0.6 },
};

// Transients play once and resolve. Everything else is a steady state the orb
// can sit in indefinitely.
const TRANSIENT: Record<OrbState, OrbState | null> = {
  dormant: null,
  waking: "attending",
  attending: null,
  sealed: null,
  revealing: "spent",
  spent: null,
};

export function targetsFor(state: OrbState): OrbTargets {
  return TARGETS[state];
}

export function isTransient(state: OrbState): boolean {
  return TRANSIENT[state] !== null;
}

export function settleTo(state: OrbState): OrbState {
  return TRANSIENT[state] ?? state;
}

// The awakening owns its duration (the brief's 700-1000ms); everything else
// crossfades slowly enough that the change is felt rather than watched.
const WAKE_MS = 850;
const STEADY_MS = 600;

export function transitionMs(from: OrbState, to: OrbState): number {
  if (from === "dormant" || to === "waking") return WAKE_MS;
  return STEADY_MS;
}

export function nextState(current: OrbState, requested: OrbState): OrbState {
  // Dormant is the boot rite's frozen still. An orb that has woken must never
  // be sent back to it -- that would freeze a live orb mid-drift.
  if (requested === "dormant" && current !== "dormant") return current;
  // A transient already running is not restarted by a repeat of its own name,
  // or a parent re-rendering with an unchanged prop would re-run the
  // awakening on every commit.
  if (requested === current) return current;
  return requested;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd apps/mobile && pnpm vitest run test/orbState.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/ui/orb/orbState.ts apps/mobile/test/orbState.test.ts
git commit -m "feat(mobile): give the orb ORACLE's states, not a voice assistant's

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

### Task 6: The shader and canvas, at baseline only

**Files:**
- Create: `apps/mobile/src/ui/orb/orbShader.ts`
- Create: `apps/mobile/src/ui/orb/OracleOrbCanvas.tsx`

**Interfaces:**
- Consumes: `ORB_D`, `ORB_DY` from `orbTouch.ts`; `OrbTier` from `orbQuality.ts`.
- Produces:
  - From `orbShader.ts`: `ORB_EFFECT: SkRuntimeEffect | null`, `INTERIOR_SIZE = 256`, `orbCompiled(): boolean`.
  - From `OracleOrbCanvas.tsx`: `OracleOrbCanvas({ tile, live, tier })` where `live` is a `SharedValue<OrbUniforms>` (what `useDerivedValue` returns). Also exports `type OrbUniforms`.

**No motion in this task.** Every warp term is wired but held at zero. The deliverable is a canvas that is indistinguishable from the reference.

- [ ] **Step 1: Write the shader**

```ts
import { Skia } from "@shopify/react-native-skia";

// The orb's interior. The shader never authors colour -- it samples the
// reference's own interior field and displaces the sample coordinate. At
// baseline every warp term is zero, so the composite is pixel-identical to
// the canonical image by construction rather than by tuning.
//
// The shell raster is drawn OVER this, untouched, and carries the rim, the
// specular arcs, and the silhouette's antialiasing.

export const INTERIOR_SIZE = 256;

const ORB_SKSL = `
uniform shader interior;
uniform float2 texSize;
uniform float2 c;          // orb centre, in canvas pixels
uniform float r;           // orb radius, in canvas pixels
uniform float t;           // the orb's own drift time, scaled by timeScale
uniform float now;         // unscaled seconds -- ripples answer a human touch
                           // and must not slow down when the orb's drift does
uniform float parallax;
uniform float centerDepth;
uniform float2 centerLean;
uniform float refraction;
uniform float dispersion;
uniform float samples;     // 2 = high tier, 1 = reduced
uniform float4 rippleA;    // xy origin in [-1,1], z start seconds, w strength
uniform float4 rippleB;

const float RIPPLE_LIFE = 1.3;

float2 uvFor(float2 q) {
  return (q * 0.5 + 0.5) * texSize;
}

// A travelling band over the approximated sphere. Smooth falloff, no rings.
float2 rippleWarp(float2 p, float4 rp, float now) {
  if (rp.w <= 0.0) { return float2(0.0); }
  float age = now - rp.z;
  if (age < 0.0 || age > RIPPLE_LIFE) { return float2(0.0); }
  float2 away = p - rp.xy;
  float dist = length(away);
  if (dist < 1e-4) { return float2(0.0); }
  // The front leaves the touch and crosses the interior over the ripple's life.
  float front = (age / RIPPLE_LIFE) * 2.2;
  // Squared directly: pow() with a negative base is undefined, and
  // (dist - front) is negative everywhere ahead of the travelling front.
  float e = (dist - front) * 3.2;
  float band = exp(-e * e);
  // The first 80ms compress inward; the wave then expands outward. That sign
  // flip IS the local optical compression the brief asks for.
  float compress = mix(-1.0, 1.0, smoothstep(0.0, 0.08, age));
  float decay = 1.0 - smoothstep(0.7, RIPPLE_LIFE, age);
  return normalize(away) * band * decay * compress * rp.w * 0.06;
}

half4 main(float2 xy) {
  float2 p = (xy - c) / r;
  float d2 = dot(p, p);
  // Outside the silhouette the interior contributes nothing; the shell owns
  // the edge.
  if (d2 >= 1.0) { return half4(0.0); }
  float z = sqrt(max(0.0, 1.0 - d2));

  // Interior-only refraction: (1 - z) is the glass's steepness, zero dead
  // centre and one at the rim, so the field crowds toward the silhouette.
  float2 refr = p * refraction * (1.0 - z) * 0.10;

  // The warm centre. A positive centerDepth scales the sample outward, which
  // spreads the centre and reads as receding; it never scales toward the
  // origin, so the centre cannot collapse into a dot.
  float core = exp(-d2 * 3.0);
  float2 depth = p * centerDepth * core;
  float2 lean = centerLean * core;

  float2 ripple = rippleWarp(p, rippleA, now) + rippleWarp(p, rippleB, now);

  float2 base = p + refr + depth - lean + ripple;

  // Two interior layers drifting in opposition. The field is smooth and
  // low-frequency, so a double sample reads as depth rather than as a ghost.
  float2 driftA = float2(sin(t * 0.11), cos(t * 0.09)) * parallax * 0.045 * (1.0 - z);
  float2 driftB = float2(cos(t * 0.07), sin(t * 0.13)) * parallax * -0.030 * (1.0 - z);

  half4 layerA = interior.eval(uvFor(base + driftA));
  half4 col = layerA;
  if (samples > 1.5) {
    half4 layerB = interior.eval(uvFor(base + driftB));
    col = mix(layerA, layerB, half(0.5));
  }

  // Dispersion: the paths coincide in the middle and separate only where the
  // glass is steep. Physical, not an RGB split.
  if (dispersion > 0.0) {
    float k = dispersion * (1.0 - z) * 0.012;
    half rr = interior.eval(uvFor(base * (1.0 + k))).r;
    half bb = interior.eval(uvFor(base * (1.0 - k))).b;
    col = half4(rr, col.g, bb, col.a);
  }

  return col;
}`;

// Guarded, not asserted: a compile failure costs the interior, not the app.
let effect: ReturnType<typeof Skia.RuntimeEffect.Make> = null;
try {
  effect = Skia.RuntimeEffect.Make(ORB_SKSL);
} catch (e) {
  console.error("Oracle orb SkSL failed to compile:", e);
}
if (!effect) console.error("Oracle orb SkSL produced no effect; falling back to the static orb.");

export const ORB_EFFECT = effect;

export function orbCompiled(): boolean {
  return ORB_EFFECT !== null;
}
```

- [ ] **Step 2: Write the canvas, with every warp held at zero**

```tsx
import { Canvas, Circle, Fill, Image, ImageShader, RadialGradient, Shader, useImage, vec } from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import { ORB_D, ORB_DY } from "./orbTouch";
import { INTERIOR_SIZE, ORB_EFFECT } from "./orbShader";
import { dispersionEnabled, interiorSamples, type OrbTier } from "./orbQuality";

const SHELL = require("../../../assets/art/orb-shell.png");
const INTERIOR = require("../../../assets/art/orb-interior.png");

// How far past the silhouette the halo reaches. The tile clears the orb by
// about 5% a side, so this stays inside it and the canvas never has to grow
// (growing it would move the hero's layout, which heroStage forbids).
const HALO_R = 1.1;

export type OrbUniforms = {
  t: number;
  now: number;
  parallax: number;
  centerDepth: number;
  centerLean: number;
  refraction: number;
  halo: number;
  rippleA: readonly [number, number, number, number];
  rippleB: readonly [number, number, number, number];
};

export function OracleOrbCanvas({
  tile,
  live,
  tier,
}: {
  tile: number;
  live: SharedValue<OrbUniforms>;
  tier: OrbTier;
}) {
  const shell = useImage(SHELL);
  const interior = useImage(INTERIOR);

  const r = (ORB_D * tile) / 2;
  const cx = tile / 2;
  const cy = tile / 2 + ORB_DY * tile;

  const uniforms = useDerivedValue(() => {
    const u = live.value;
    return {
      texSize: [INTERIOR_SIZE, INTERIOR_SIZE],
      c: [cx, cy],
      r,
      t: u.t,
      now: u.now,
      parallax: u.parallax,
      centerDepth: u.centerDepth,
      centerLean: [u.centerLean, u.centerLean * 0.4],
      refraction: u.refraction,
      dispersion: dispersionEnabled(tier) ? 1 : 0,
      samples: interiorSamples(tier),
      rippleA: u.rippleA,
      rippleB: u.rippleB,
    };
  }, [cx, cy, r, tier]);

  // The halo lives outside the silhouette, so it is a Skia layer rather than a
  // shader term -- the shader returns transparent past d = 1 by design.
  const haloOpacity = useDerivedValue(() => live.value.halo, []);

  if (!ORB_EFFECT || !shell || !interior) return null;

  return (
    <Canvas style={{ width: tile, height: tile }} pointerEvents="none">
      {/* The interior, clipped to the circle by the shader itself. */}
      <Fill>
        <Shader source={ORB_EFFECT} uniforms={uniforms}>
          <ImageShader
            image={interior}
            fit="none"
            tx="clamp"
            ty="clamp"
            rect={{ x: 0, y: 0, width: INTERIOR_SIZE, height: INTERIOR_SIZE }}
          />
        </Shader>
      </Fill>
      {/* The shell, over the top, never displaced or filtered. It carries the
          rim, the specular arcs, and the silhouette's antialiasing. */}
      <Image image={shell} x={cx - r} y={cy - r} width={r * 2} height={r * 2} fit="fill" />
      {/* A tight glow just past the rim -- distinct from LivingHero's broad
          mood glow, which sits far behind the whole stage. */}
      <Circle cx={cx} cy={cy} r={r * HALO_R} opacity={haloOpacity}>
        <RadialGradient
          c={vec(cx, cy)}
          r={r * HALO_R}
          colors={["rgba(156,181,209,0)", "rgba(156,181,209,0.22)", "rgba(156,181,209,0)"]}
          positions={[0, 1 / HALO_R - 0.02, 1]}
        />
      </Circle>
    </Canvas>
  );
}
```

The halo's rgba stops are `colors.glassBlue` (`#9CB5D1`) with per-stop alpha,
which the token itself cannot carry. Do not substitute a different blue.

- [ ] **Step 3: Typecheck**

Run: `cd apps/mobile && pnpm typecheck`
Expected: clean. If `ImageShader`'s `fit` prop rejects `"none"` in Skia 2.6.2, use `fit="fill"` with the same `rect` — the rect is already the texture's exact size, so the two are equivalent here.

- [ ] **Step 4: Run the full suite**

Run: `cd apps/mobile && pnpm test`
Expected: all tests pass (150 plus the new pure-module tests). This task adds no tests — its correctness is the static match, which the Task 1 script already asserted numerically and which the device checkpoint confirms visually.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/ui/orb/orbShader.ts apps/mobile/src/ui/orb/OracleOrbCanvas.tsx
git commit -m "feat(mobile): sample the orb's interior rather than inventing it

Every warp term is wired but held at zero, so the composite is the canonical
image exactly. Motion lands on top of a baseline that is already correct.

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

### Task 7: The public component

**Files:**
- Create: `apps/mobile/src/ui/orb/OracleOrb.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces:
  - `type OracleOrbHandle = { ripple(local?: OrbPoint): void; transitionTo(state: OrbState): void; settle(): void }`
  - `OracleOrb(props)` where props are `{ tile: number; state?: OrbState; quality?: OrbQualityProp; interactive?: boolean; accessibilityLabel?: string; testID?: string; onPress?(local: OrbPoint): void }`, wrapped in `forwardRef`.

This task turns the baseline canvas into a live one: it owns the clock, drives the uniforms from `orbState` targets through Reanimated, handles taps, and renders the static tier.

- [ ] **Step 1: Write the component**

```tsx
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Easing, useDerivedValue, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useClock } from "@shopify/react-native-skia";
import { locate, type OrbPoint } from "./orbTouch";
import { assign, EMPTY_SLOTS, type RippleSlots } from "./orbRipples";
import { nextState, settleTo, isTransient, targetsFor, transitionMs, type OrbState } from "./orbState";
import { resolve, rippleCapacity, type OrbQualityProp } from "./orbQuality";
import { orbCompiled } from "./orbShader";
import { OracleOrbCanvas, type OrbUniforms } from "./OracleOrbCanvas";

const FALLBACK = require("../../../assets/art/orb-fallback.png");

export type OracleOrbHandle = {
  ripple(local?: OrbPoint): void;
  transitionTo(state: OrbState): void;
  settle(): void;
};

export const OracleOrb = forwardRef<OracleOrbHandle, {
  tile: number;
  state?: OrbState;
  quality?: OrbQualityProp;
  interactive?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  onPress?(local: OrbPoint): void;
}>(function OracleOrb(
  { tile, state = "attending", quality = "auto", interactive = false, accessibilityLabel = "Oracle", testID, onPress },
  ref,
) {
  const reducedMotion = useReducedMotion();
  const [imagesReady, setImagesReady] = useState(true);
  const tier = resolve({ prop: quality, reducedMotion, compiled: orbCompiled(), imagesReady });

  const [current, setCurrent] = useState<OrbState>(state);
  const slots = useRef<RippleSlots>(EMPTY_SLOTS);
  const clock = useClock();
  const paused = useSharedValue(0);

  // The animated targets. Each is its own shared value so Reanimated can
  // blend an interrupted transition rather than snapping it.
  const parallax = useSharedValue(targetsFor(state).parallax);
  const centerDepth = useSharedValue(targetsFor(state).centerDepth);
  const centerLean = useSharedValue(targetsFor(state).centerLean);
  const refraction = useSharedValue(targetsFor(state).refraction);
  const halo = useSharedValue(targetsFor(state).halo);
  const timeScale = useSharedValue(targetsFor(state).timeScale);
  const rippleA = useSharedValue<readonly [number, number, number, number]>([0, 0, 0, 0]);
  const rippleB = useSharedValue<readonly [number, number, number, number]>([0, 0, 0, 0]);

  // The orb's own accumulated time. It is integrated from the clock rather
  // than read off it, for two reasons: timeScale becomes a *rate*, so slowing
  // the orb down never jumps its phase; and pausing genuinely holds the
  // current frame instead of snapping the interior back to t = 0.
  const elapsed = useSharedValue(0);
  const lastTick = useSharedValue(-1);

  // Follow the state prop through the state machine, so a repeated prop never
  // restarts a transient and dormant never claims a woken orb.
  useEffect(() => {
    setCurrent((c) => nextState(c, state));
  }, [state]);

  // Drive the uniforms toward the current state's targets.
  useEffect(() => {
    const to = targetsFor(current);
    const ms = transitionMs(current, current);
    const cfg = { duration: ms, easing: Easing.inOut(Easing.quad) };
    parallax.value = withTiming(to.parallax, cfg);
    centerDepth.value = withTiming(to.centerDepth, cfg);
    centerLean.value = withTiming(to.centerLean, cfg);
    refraction.value = withTiming(to.refraction, cfg);
    halo.value = withTiming(to.halo, cfg);
    timeScale.value = withTiming(to.timeScale, cfg);

    // A transient resolves into its steady state on its own.
    if (!isTransient(current)) return;
    const id = setTimeout(() => setCurrent((c) => (c === current ? settleTo(current) : c)), ms);
    return () => clearTimeout(id);
  }, [current, parallax, centerDepth, centerLean, refraction, halo, timeScale]);

  // Stop the clock when the app is not in front. No work while backgrounded.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      paused.value = s === "active" ? 0 : 1;
    });
    return () => sub.remove();
  }, [paused]);

  const live = useDerivedValue<OrbUniforms>(() => {
    // Integrate, don't sample: dt is scaled, so timeScale is a rate and the
    // phase is continuous across every change of state and every pause.
    const now = clock.value / 1000;
    const dt = lastTick.value < 0 ? 0 : Math.max(0, Math.min(0.1, now - lastTick.value));
    lastTick.value = now;
    if (!paused.value) elapsed.value += dt * timeScale.value;
    return {
      t: elapsed.value,
      now,
      parallax: parallax.value,
      centerDepth: centerDepth.value,
      centerLean: centerLean.value,
      refraction: refraction.value,
      halo: halo.value,
      rippleA: rippleA.value,
      rippleB: rippleB.value,
    };
  }, []);

  const fire = useCallback(
    (local: OrbPoint) => {
      const capacity = rippleCapacity(tier);
      if (capacity === 0) return;
      const nowMs = Date.now();
      const nowSec = clock.value / 1000;
      slots.current = assign(slots.current, { origin: local, startMs: nowMs, strength: 1 }, nowMs, capacity);
      const pack = (i: 0 | 1): readonly [number, number, number, number] => {
        const r = slots.current[i];
        if (!r) return [0, 0, 0, 0];
        // The shader's clock is in the same seconds the uniforms carry, so a
        // ripple's start is expressed there, not in wall time.
        return [r.origin.x, r.origin.y, r.startMs === nowMs ? nowSec : nowSec - (nowMs - r.startMs) / 1000, r.strength];
      };
      rippleA.value = pack(0);
      rippleB.value = pack(1);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [tier, clock, rippleA, rippleB],
  );

  useImperativeHandle(
    ref,
    () => ({
      ripple: (local) => fire(local ?? { x: 0, y: 0 }),
      transitionTo: (s) => setCurrent((c) => nextState(c, s)),
      settle: () => setCurrent((c) => settleTo(c)),
    }),
    [fire],
  );

  const handlePress = useCallback(
    (e: { nativeEvent: { locationX: number; locationY: number } }) => {
      const hit = locate({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }, tile);
      // A press on the tile's corner is not a press on the glass.
      if (!hit) return;
      fire(hit.local);
      onPress?.(hit.local);
    },
    [tile, fire, onPress],
  );

  const body =
    tier === "static" ? (
      <Image
        source={FALLBACK}
        contentFit="contain"
        style={{ width: tile, height: tile }}
        onError={() => setImagesReady(false)}
        accessible={false}
      />
    ) : (
      <OracleOrbCanvas tile={tile} live={live} tier={tier} />
    );

  // The press target is preserved in every tier, including static -- the
  // fallback must not silently drop interaction.
  if (!interactive) {
    return (
      <View style={{ width: tile, height: tile }} accessibilityLabel={accessibilityLabel} accessible testID={testID}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={{ width: tile, height: tile }}
    >
      {body}
    </Pressable>
  );
});
```

- [ ] **Step 2: Typecheck and run the suite**

Run: `cd apps/mobile && pnpm typecheck && pnpm test`
Expected: clean typecheck, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/ui/orb/OracleOrb.tsx
git commit -m "feat(mobile): the orb's public component, with tiers and taps

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

### Task 8: Swap it in and retire the loop

**Files:**
- Modify: `apps/mobile/src/ui/LivingHero.tsx`
- Modify: `apps/mobile/src/ui/BootRite.tsx`
- Delete: `apps/mobile/src/ui/OrbLayer.tsx`, `apps/mobile/assets/art/orb-loop.webp`

**Interfaces:**
- Consumes: `OracleOrb` from Task 7.
- Produces: nothing new.

- [ ] **Step 1: Swap the orb in `LivingHero.tsx`**

Replace the `OrbLayer` import with `import { OracleOrb } from "./orb/OracleOrb";`.

The orb slot currently renders `{phase === "live" && <OrbLayer rect={...} playing />}` and the slot `View` carries `pointerEvents="none"`. Make three changes:

1. Drop `pointerEvents="none"` from the slot `View` — the orb needs to receive taps. Every other layer in `LivingHero` keeps its `pointerEvents="none"`.
2. Render the orb in **both** the waking and live phases, so the arriving orb is the real one:

```tsx
{phase !== "cold" && (
  <OracleOrb
    tile={orb.w}
    state={phase === "waking" ? "waking" : "attending"}
    interactive
    accessibilityLabel="Oracle"
  />
)}
```

3. Leave the reduced-motion branch at the top of the component untouched — it returns the graded still before any of this runs.

- [ ] **Step 2: Swap the orb in `BootRite.tsx`**

Replace the `OrbLayer` import with `import { OracleOrb } from "./orb/OracleOrb";`, and replace the `<OrbLayer ... playing={false} />` line with a dormant, non-interactive orb inside the same centring wrapper the tile had:

```tsx
<View style={{ position: "absolute", left: (dustBox.w - orb.w) / 2, top: (dustBox.h - orb.h) / 2 }}>
  <OracleOrb tile={orb.w} state="dormant" />
</View>
```

`interactive` is omitted, so the rite's full-screen skip `Pressable` keeps every tap, the orb included.

- [ ] **Step 3: Delete the retired renderer and its asset**

```bash
cd /Users/eriktaheri/Development/oracle
git rm apps/mobile/src/ui/OrbLayer.tsx apps/mobile/assets/art/orb-loop.webp
```

- [ ] **Step 4: Confirm nothing else referenced them**

```bash
cd /Users/eriktaheri/Development/oracle && grep -rn "OrbLayer\|orb-loop" apps/ docs/ design/ --include=*.tsx --include=*.ts --include=*.json
```

Expected: no hits in `apps/`. Hits in `docs/` are historical spec prose and must be left alone.

- [ ] **Step 5: Typecheck and run the suite**

Run: `cd apps/mobile && pnpm typecheck && pnpm test`
Expected: clean typecheck, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A apps/mobile
git commit -m "feat(mobile): the orb becomes real-time, and the loop retires

Home's orb takes taps; the boot rite holds a dormant one whose frozen frame
is the canonical image. Drops 1.2MB of WebP from the bundle.

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

## Device Checkpoints

Two, deliberately — booting the simulator is expensive, so verification is batched rather than continuous.

**Checkpoint A — after Task 6.** The static-match gate. Build and look at the orb at rest against `design/art-direction/orb-reference.png`. Confirm: the rim, the broad upper-left specular, and the lower-right reflection are all present and unchanged; the warm centre is broad and diffused, not a point; there is no seam or ring where the knockout feather sits; the silhouette is a clean circle. **If this fails, adjust `KNOCK_INNER`/`KNOCK_OUTER` in `make-orb-layers.py` and re-run Task 1 — do not compensate in the shader.**

**Checkpoint B — after Task 8.** The whole feature. Confirm: cold start prints the rite and the orb slides into Home's slot with no jump and no material change; the orb drifts once landed, with no countable pulse and no dot at the centre; a tap inside the glass ripples from that point and returns to rest; a tap on the tile's corner does nothing; the shell's highlights never move during any of it.

**Not covered here:** the spec's §14 performance validation (average frame rate, slowest frames, memory across mount/unmount cycles, on one iOS and one mid-range Android). That needs hardware and is the user's to run.

---

## Deviations from the spec

- **Component tests are dropped.** `vitest.config.ts` collects only `test/**/*.test.ts`, there is no `@testing-library/react-native` or `react-test-renderer`, and all 26 existing test files are pure logic. Standing up RN component testing on RN 0.86 with React 19.2 is its own project. The behaviour those tests would cover — fallback rendering, press coordinates, outside-circle rejection, accessibility props — is verified at Checkpoint B instead.
- **The static-match assertion moved into the asset script**, where it can run without a simulator. This is the automatable half of §15.1 and it is stronger there than it would be as a rendering test.
