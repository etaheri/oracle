# Terminal Patina Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the brand's ASCII layer in-app: a glyph-atlas asset, one shared SkSL patina shader, Atmospheric Dust on the two loading states, and an Activation ripple that sweeps the card when a prophecy is sealed.

**Architecture:** One runtime shader (`TerminalPatina.tsx`) renders sparse, hash-selected monospace glyphs inside an annulus mask — no source-image sampling in phase 1 (the luminance/materialization mode from the spec is phase 2, for campaign imagery). Two thin components share it: `AsciiDust` (slow-stepping halo, loading states) and `AsciiActivation` (expanding ring driven by a Reanimated progress value, fired by the seal flow between the wax stamp and the flip). The glyph atlas is a Pillow-generated transparent PNG strip of IBM Plex Mono punctuation.

**Tech Stack:** @shopify/react-native-skia 2.6.2 (RuntimeEffect + ImageShader + useClock), react-native-reanimated 4.5.1, Pillow (asset script only). No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-terminal-patina-shader.md` (starter SkSL + modes + performance rules) and `docs/superpowers/specs/2026-08-26-oracle-brand-brief.md` §4–5 (Terminal Patina behaviors, restrictions, reduced-motion rules).

## Global Constraints

- Expo SDK 57 exact — consult https://docs.expo.dev/versions/v57.0.0/ before using any Expo API (per `apps/mobile/AGENTS.md`).
- No new npm dependencies.
- ASCII characters: punctuation only in phase 1 — atlas is `[space] . : - + * # %` (8 glyphs, least → most dense). No letters, no Matrix green, no full-image conversion, no rapid flicker (brief §4).
- Pattern steps at 2–4 changes/second for Dust (quantize the clock — never re-randomize every frame). Activation may step faster (8/s) for its 560ms life.
- ASCII colors from the brief: lavender `#B7A9E4`, glassBlue `#9CB5D1`, mutedInk `#666A73`, gold tier for Activation (`goldText #7E6538`). Never terminal green.
- Reduced motion (`useReducedMotion` from react-native-reanimated): Dust freezes its pattern (static patina stays visible); Activation renders nothing (the seal flow already bypasses the stamp under reduced motion).
- ASCII is decorative — loading states must keep a text label as the accessible signal; never encode status in ASCII alone (brief §11).
- Cells must be ≥6 physical px: cell width 9 logical px @3x = 27px — safe.
- Animate uniforms, never rebuild the shader. Keep canvases bounded to the artwork area.
- House easing is `Easing.out(Easing.poly(4))`; `Easing.quart` does not exist in Reanimated.
- Palette tokens come from `src/theme.ts`; this feature passes colors as `[r, g, b]` number tuples because they become shader uniforms.
- Verification commands (repo root): `pnpm --filter @oracle/mobile exec tsc --noEmit` and `pnpm --filter @oracle/mobile test` (currently 21 tests — must stay green).
- Simulator workflow: Metro MUST run from `apps/mobile` (check `lsof -nP -iTCP:8081 -sTCP:LISTEN`; if missing: `cd apps/mobile && nohup npx expo start --port 8081 > /tmp/expo.log 2>&1 &`). API: `lsof -nP -iTCP:8787 -sTCP:LISTEN`; if missing: `cd apps/api && nohup npx wrangler dev --port 8787 > /tmp/wrangler.log 2>&1 &`. Find the booted simulator UDID with `xcrun simctl list devices booted`. Fast Refresh from a nohup'd Metro silently fails — for EVERY visual check: `xcrun simctl terminate <UDID> host.exp.Exponent; xcrun simctl openurl <UDID> "exp://127.0.0.1:8081/--/<path>"`, wait ~22s on first load, then `xcrun simctl io <UDID> screenshot <file>`.
- Any temporary debug edit made for verification MUST be reverted before the task's commit; `git status`/`git diff` before committing.

---

### Task 1: ASCII glyph atlas

**Files:**
- Create: `design/scripts/make-ascii-atlas.py`
- Create (generated): `apps/mobile/assets/art/ascii-atlas.png`

**Interfaces:**
- Produces: `apps/mobile/assets/art/ascii-atlas.png` — transparent PNG, 768×128: eight 96×128 cells, glyphs `[space] . : - + * # %` in IBM Plex Mono, white fill, horizontally centered per cell, shared baseline. Task 2 requires this exact path and geometry (atlas cell aspect 96:128 = 3:4).

- [ ] **Step 1: Write the generator script**

Create `design/scripts/make-ascii-atlas.py`:

```python
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
```

- [ ] **Step 2: Run it and verify**

Run: `python3 design/scripts/make-ascii-atlas.py` (if system python lacks Pillow: `python3 -m venv /tmp/patina-venv && /tmp/patina-venv/bin/pip -q install pillow && /tmp/patina-venv/bin/python design/scripts/make-ascii-atlas.py`)
Expected: prints `.../ascii-atlas.png: 768x128, 8 glyphs`, no assertion failure.

- [ ] **Step 3: Commit**

```bash
git add design/scripts/make-ascii-atlas.py apps/mobile/assets/art/ascii-atlas.png
git commit -m "feat(mobile): terminal patina glyph atlas"
```

---

### Task 2: Patina shader + AsciiDust / AsciiActivation components

**Files:**
- Create: `apps/mobile/src/ui/TerminalPatina.tsx`

**Interfaces:**
- Consumes: `apps/mobile/assets/art/ascii-atlas.png` from Task 1 (768×128, 8 glyphs, cell 96×128).
- Produces:
  - `AsciiDust({ size?: number; color?: readonly [number, number, number]; intensity?: number; gate?: number; innerRatio?: number; outerRatio?: number })` — square Canvas, defaults size 180, lavender, intensity 0.28, gate 0.22, annulus 0.24–0.46 of size. Task 3 renders `<AsciiDust />` with defaults.
  - `AsciiActivation({ width: number; height: number; durationMs?: number; debugProgress?: number })` — absolute-positioned overlay Canvas at (0,0,width,height); self-animates an expanding glyph ring over `durationMs` (default 560) then stays invisible; `debugProgress` freezes the animation at a fixed 0..1 for screenshots. Returns `null` under reduced motion. Task 4 renders it sized via `onLayout`.

- [ ] **Step 1: Write the component file**

Create `apps/mobile/src/ui/TerminalPatina.tsx`:

```tsx
import { useEffect } from "react";
import { Canvas, Fill, ImageShader, Shader, Skia, useClock, useImage } from "@shopify/react-native-skia";
import { Easing, useDerivedValue, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

// Terminal Patina (brand brief §4-5, spec 2026-08-26-terminal-patina-shader.md):
// sparse hash-selected monospace glyphs inside an annulus mask. Phase 1 has no
// source-image sampling — glyph choice is per-cell hash, so this is the
// "atmospheric" material, not image reconstruction (that's phase 2).
// Uniforms animate; the effect is compiled once at module load.
const ATLAS = require("../../assets/art/ascii-atlas.png");
const ATLAS_W = 768;
const ATLAS_H = 128;
const GLYPH_COUNT = 8;
const CELL_W = 9; // logical px; 27 physical @3x — above the 6px floor
const CELL_H = 12; // keeps the atlas cell's 3:4 aspect

const PATINA_SKSL = `
uniform shader glyphAtlas;
uniform float2 atlasSize;
uniform float glyphCount;
uniform float2 cell;
uniform float intensity;
uniform float t;
uniform float4 tint;
uniform float2 center;
uniform float innerR;
uniform float outerR;
uniform float gate;

float hash21(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

half4 main(float2 xy) {
  float2 cellID = floor(xy / cell);
  float2 localUV = fract(xy / cell);
  float2 cellCenter = (cellID + 0.5) * cell;
  float d = distance(cellCenter, center);
  float band = smoothstep(innerR - cell.y, innerR + cell.y, d)
             * (1.0 - smoothstep(outerR - cell.y, outerR + cell.y, d));
  float show = step(1.0 - gate, hash21(cellID + t));
  float idx = 1.0 + floor(hash21(cellID * 1.7 + t * 0.37) * (glyphCount - 1.0));
  idx = min(idx, glyphCount - 1.0);
  float glyphW = atlasSize.x / glyphCount;
  float2 atlasPos = float2(idx * glyphW + localUV.x * glyphW, localUV.y * atlasSize.y);
  half4 g = glyphAtlas.eval(atlasPos);
  half a = half(g.a * band * show * intensity);
  return half4(half3(tint.rgb) * a, a);
}`;

const effect = Skia.RuntimeEffect.Make(PATINA_SKSL)!;

const LAVENDER = [183, 169, 228] as const;
const GOLD = [126, 101, 56] as const; // goldText

function tintOf(c: readonly [number, number, number]): [number, number, number, number] {
  return [c[0] / 255, c[1] / 255, c[2] / 255, 1];
}

// Atmospheric Dust (spec mode 3): a slow-stepping glyph halo. The clock is
// quantized to 3 steps/s — the pattern must never re-randomize per frame.
export function AsciiDust({
  size = 180,
  color = LAVENDER,
  intensity = 0.28,
  gate = 0.22,
  innerRatio = 0.24,
  outerRatio = 0.46,
}: {
  size?: number;
  color?: readonly [number, number, number];
  intensity?: number;
  gate?: number;
  innerRatio?: number;
  outerRatio?: number;
}) {
  const atlas = useImage(ATLAS);
  const clock = useClock();
  const reducedMotion = useReducedMotion();

  const uniforms = useDerivedValue(() => ({
    atlasSize: [ATLAS_W, ATLAS_H],
    glyphCount: GLYPH_COUNT,
    cell: [CELL_W, CELL_H],
    intensity,
    t: reducedMotion ? 1 : Math.floor(clock.value / 333),
    tint: tintOf(color),
    center: [size / 2, size / 2],
    innerR: size * innerRatio,
    outerR: size * outerRatio,
    gate,
  }), [size, color, intensity, gate, innerRatio, outerRatio, reducedMotion]);

  if (!atlas) return null;
  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Fill>
        <Shader source={effect} uniforms={uniforms}>
          <ImageShader image={atlas} rect={{ x: 0, y: 0, width: ATLAS_W, height: ATLAS_H }} />
        </Shader>
      </Fill>
    </Canvas>
  );
}

// Activation (spec mode 2): a glyph ring travels outward across the artwork,
// intensity 0 -> 0.8 -> 0, then the overlay is inert. Fired by the seal flow.
export function AsciiActivation({
  width,
  height,
  durationMs = 560,
  debugProgress,
}: {
  width: number;
  height: number;
  durationMs?: number;
  debugProgress?: number;
}) {
  const atlas = useImage(ATLAS);
  const clock = useClock();
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(debugProgress ?? 0);

  useEffect(() => {
    if (debugProgress !== undefined) { progress.value = debugProgress; return; }
    progress.value = withTiming(1, { duration: durationMs, easing: Easing.out(Easing.poly(4)) });
  }, [debugProgress, durationMs, progress]);

  const maxR = Math.hypot(width, height) / 2 + 40;
  const uniforms = useDerivedValue(() => {
    const p = progress.value;
    const outerR = p * maxR;
    return {
      atlasSize: [ATLAS_W, ATLAS_H],
      glyphCount: GLYPH_COUNT,
      cell: [CELL_W, CELL_H],
      intensity: 0.8 * (1 - Math.abs(2 * p - 1)),
      t: Math.floor(clock.value / 125),
      tint: tintOf(GOLD),
      center: [width / 2, height / 2],
      innerR: Math.max(0, outerR - width * 0.45),
      outerR,
      gate: 0.35,
    };
  }, [width, height, maxR]);

  if (reducedMotion || !atlas || width === 0 || height === 0) return null;
  return (
    <Canvas style={{ position: "absolute", left: 0, top: 0, width, height }} pointerEvents="none">
      <Fill>
        <Shader source={effect} uniforms={uniforms}>
          <ImageShader image={atlas} rect={{ x: 0, y: 0, width: ATLAS_W, height: ATLAS_H }} />
        </Shader>
      </Fill>
    </Canvas>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @oracle/mobile exec tsc --noEmit` — Expected: clean. (If `Fill` + `Shader` child typing complains about the `uniforms` derived-value shape, the existing `src/ui/Grain.tsx` uses the same pattern — match it exactly.)

- [ ] **Step 3: Visual smoke test via temp render**

Temporarily add to `apps/mobile/src/app/index.tsx` — import `AsciiDust` from `../ui/TerminalPatina` and place `<AsciiDust />` directly under `<LivingHero lean={lean} />`. Cold-start (see Global Constraints simulator workflow) to `exp://127.0.0.1:8081`, wait, screenshot. Expected: a sparse ring of lavender punctuation characters below the hero — individual glyphs legible, no solid block, no flicker artifacts in a second screenshot taken 1s later (pattern may differ slightly — that's the 3/s step). REVERT the temp edit (`git diff` must show only `TerminalPatina.tsx` added).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/ui/TerminalPatina.tsx
git commit -m "feat(mobile): terminal patina shader — AsciiDust + AsciiActivation"
```

---

### Task 3: Atmospheric Dust on the loading states

**Files:**
- Modify: `apps/mobile/src/app/round.tsx` (the `today.isLoading` branch, ~line 28)
- Modify: `apps/mobile/src/app/reveal/[date].tsx` (the `reveal.isLoading` branch, ~line 38)

**Interfaces:**
- Consumes: `AsciiDust` from Task 2 (`import { AsciiDust } from "../ui/TerminalPatina";` — note `../../ui/TerminalPatina` from `reveal/[date].tsx`).

- [ ] **Step 1: Round loading state**

In `apps/mobile/src/app/round.tsx`, the loading branch currently reads:

```tsx
  if (today.isLoading) return <Screen><TopBar /><ActivityIndicator color={colors.agedGold} /></Screen>;
```

Replace with:

```tsx
  if (today.isLoading) return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(3) }}>
        <AsciiDust />
        <Eyebrow>The oracle is consulted</Eyebrow>
      </View>
    </Screen>
  );
```

Add the import `import { AsciiDust } from "../ui/TerminalPatina";`. Remove `ActivityIndicator` from the `react-native` import if nothing else in the file uses it (check first).

- [ ] **Step 2: Reveal loading state**

In `apps/mobile/src/app/reveal/[date].tsx`, the loading branch currently reads:

```tsx
  if (reveal.isLoading) return <Screen><TopBar /><Eyebrow>Consulting the void…</Eyebrow></Screen>;
```

Replace with:

```tsx
  if (reveal.isLoading) return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(3) }}>
        <AsciiDust />
        <Eyebrow>Consulting the void…</Eyebrow>
      </View>
    </Screen>
  );
```

Add the import `import { AsciiDust } from "../../ui/TerminalPatina";`. (`View`, `space`, `Eyebrow` are already imported in both files — verify.)

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm --filter @oracle/mobile exec tsc --noEmit && pnpm --filter @oracle/mobile test`
Expected: clean; 21 tests pass.

- [ ] **Step 4: Visual verification of the loading state**

The API responds too fast to catch loading live, so force it: temporarily change the round.tsx condition to `if (today.isLoading || true)`. Cold-start to `exp://127.0.0.1:8081/--/round`, screenshot. Expected: centered lavender glyph halo above "THE ORACLE IS CONSULTED", museum-white ground, TopBar intact. REVERT the temp condition (`git diff` shows only the intended two-file integration).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/app/round.tsx "apps/mobile/src/app/reveal/[date].tsx"
git commit -m "feat(mobile): atmospheric dust on loading states"
```

---

### Task 4: Activation ripple on seal

**Files:**
- Modify: `apps/mobile/src/ui/OracleCard.tsx`

**Interfaces:**
- Consumes: `AsciiActivation` from Task 2; existing seal flow (`stamped` state, `SealStamp`, `STAMP_MS = 240`, flip fires `onSealed` at `STAMP_MS + 320` = 560ms — Activation's default `durationMs` matches this window exactly).

- [ ] **Step 1: Wire the overlay**

In `apps/mobile/src/ui/OracleCard.tsx`:

1. Add imports:

```tsx
import { AsciiActivation } from "./TerminalPatina";
```

2. Add card-size state next to the existing `stamped` state (`useState` is already imported):

```tsx
  const [cardSize, setCardSize] = useState({ w: 0, h: 0 });
```

3. Capture the front face's size — add `onLayout` to the front `Animated.View`:

```tsx
      <Animated.View style={frontStyle} onLayout={(e) => setCardSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
```

4. Render the ripple UNDER the stamp (glyphs sweep the card, the wax seal stays focal). The front face currently ends with:

```tsx
        </CardChrome>
        {stamped && <SealStamp numeral={numeral(q.slot)} />}
      </Animated.View>
```

Change to:

```tsx
        </CardChrome>
        {stamped && <AsciiActivation width={cardSize.w} height={cardSize.h} />}
        {stamped && <SealStamp numeral={numeral(q.slot)} />}
      </Animated.View>
```

No timing changes: `AsciiActivation` mounts when `stamped` flips true and runs its 560ms life inside the existing stamp→flip window. Under reduced motion the component returns `null` on its own (and `stamped` never becomes true on that path anyway).

- [ ] **Step 2: Typecheck + tests**

Run: `pnpm --filter @oracle/mobile exec tsc --noEmit && pnpm --filter @oracle/mobile test`
Expected: clean; 21 tests pass.

- [ ] **Step 3: Static visual verification**

Temporarily change the ripple line to force it mid-flight:

```tsx
        {true && <AsciiActivation width={cardSize.w} height={cardSize.h} debugProgress={0.45} />}
```

Cold-start to `exp://127.0.0.1:8081/--/round`, screenshot. Expected: a partial ring of small gold punctuation glyphs sweeping the card face (roughly mid-card at progress 0.45), card content readable beneath, no glyphs outside the card bounds. REVERT to the `{stamped && ...}` form (`git diff` shows only the intended integration).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/ui/OracleCard.tsx
git commit -m "feat(mobile): ascii activation ripple on seal"
```

---

### Task 5: Full-pass verification + evidence

**Files:**
- Create: `docs/superpowers/plans/assets/terminal-patina-1/` (screenshots)

- [ ] **Step 1: Clean state**

Run: `pnpm --filter @oracle/mobile exec tsc --noEmit && pnpm --filter @oracle/mobile test && git status --porcelain`
Expected: typecheck clean, 21 tests pass, no stray temp edits in the tree.

- [ ] **Step 2: Capture evidence**

Cold-start the app to real state (`exp://127.0.0.1:8081`) and confirm home renders normally (no dust on home — it was a temp render). Re-run the Task 3 temp-force + screenshot into `docs/superpowers/plans/assets/terminal-patina-1/dust-loading.png` and the Task 4 debugProgress screenshot into `.../activation-mid.png`, reverting both temp edits afterward (verify with `git status --porcelain` — only the new PNGs appear).

- [ ] **Step 3: Commit evidence**

```bash
git add docs/superpowers/plans/assets/terminal-patina-1/
git commit -m "chore(mobile): terminal patina phase-1 evidence"
```

- [ ] **Step 4: Hand-test handoff**

Report to the user what needs a human hand: (1) seal a card — the full stamp + gold glyph sweep + flip sequence in motion; (2) loading dust in real network conditions (cold app start on cellular); (3) shader perf on a real device, especially older Android.

---

## Self-Review Notes

- **Spec coverage:** atlas per spec §glyph-atlas (punctuation-first ✓, monospace white transparent ✓); shader = spec's masked-annulus variant with hash glyph selection (documented deviation: no luminance sampling — phase 2); Dust mode ✓ (2–4 steps/s, intensity 0.25–0.3, sparse); Activation mode ✓ (travel + 0→0.8→0 envelope); Reflection mode explicitly deferred to phase 2; reduced-motion rules ✓ (freeze Dust, no Activation); accessibility ✓ (text label kept on loading states); performance rules ✓ (uniforms only, quantized time, bounded canvases, ≥6px cells).
- **Type consistency:** `AsciiDust`/`AsciiActivation` names and props match across Tasks 2/3/4; `STAMP_MS + 320 = 560` matches `durationMs` default.
- **Placeholder scan:** none — all code inline.
