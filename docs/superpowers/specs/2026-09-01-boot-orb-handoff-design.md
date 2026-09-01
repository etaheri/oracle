# Boot → Home Orb Handoff — Design

**Date:** 2026-09-01
**Status:** approved in brainstorm, prototype next
**Builds on:** `2026-08-26-terminal-patina-shader.md` (Atmospheric Dust), `2026-08-26-oracle-brand-brief.md` §4 (ASCII as transition), `src/ui/BootRite.tsx`, `src/ui/LivingHero.tsx`, `src/game/bootGate.ts`

## Problem

The boot rite is a title card: dust ring + machine text, centered on the raw
screen, then a fade to Home, whose hero sits at an unrelated position. The
transition reads as two screens, not one arrival. The brief casts ASCII as
*transition* and the orb as *the* brand object; the orb should be the thing
that persists from cold start into the temple.

## Storyboard

```
t = 0        Boot field (museumWhite). ORB — a still (frame 0, autoplay off),
             at the size it will have on Home, screen-centered. Gold dust ring
             around it. Machine text prints below:
             ORACLE OS V1.0 / THE ORB WAKES / THE LEDGER OPENS / READY.
t = HOLD     Boot done →
  +0   ms    Field fades (450ms, as today). Orb + dust rise to Home's measured
             anchor (550ms, ease-out cubic). Boot text fades in place (200ms);
             it never travels — it is the machine's voice, not the artifact.
  +300 ms    Home's mood glow (Skia radial) fades in under the arriving orb.
  +450 ms    Hands begin entering from the left/right edges.
  +550 ms    Orb lands. Home mounts its own orb at the anchor, autoplay on,
             starting at frame 0 — pixel-identical to the still that arrived.
             The orb starts swirling: THE ORB WAKES. Overlay unmounts.
  +900 ms    Title materializes (existing MaterializeTitle, cued later).
 ~+1300 ms   Hands at rest.
  +1400 ms   Epigraph decodes (existing DecodeLines).
```

Reduced motion: unchanged. The rite never mounts; Home shows the graded still
(`creation-hands-orb.jpg`) with no glow, as today.

## Components

### `LivingHero` → a stage of layers (`src/ui/LivingHero.tsx`)

Same outer footprint as today (`w = window width`, `h = w / (1000/562)`), so
nothing else on Home moves. Children, back to front:

1. **Glow** — existing Skia radial, tinted by crowd mood. Opacity animatable
   (fades in at +300ms on cold start; 1 thereafter).
2. **Dust** — existing `AsciiDust` ring around the orb center.
3. **`HandLayer` ×2** — one transparent animated WebP each, positioned by
   stage fraction. Props: `source`, `side: "left" | "right"`, `enter: boolean`.
   Placeholder behavior: Reanimated `translateX` from off-edge to rest (700ms,
   ease-out) when `enter` flips true. Real-asset behavior: the clip's own
   entrance, cued by mounting with `autoplay` when `enter` flips true.
4. **`OrbLayer`** — one transparent animated WebP, 1:1 tile, centered at
   stage (0.50, 0.47), diameter `h * ORB_DIAMETER_RATIO` (≈0.52 of `h` for the
   current art — measured from frame 0: r≈135px of 562). Props: `source`,
   `playing: boolean` → `autoplay`. Mounted only once `orbLanded` (or
   immediately on warm/deep-link paths where no handoff happens).

`LivingHero` takes `phase: "cold" | "waking" | "live"`. `"cold"` = glow at 0,
hands off-edge, orb unmounted (overlay still holding). `"waking"` = the rite's
`done` has fired: glow fades in after 300ms, hands begin entering after 450ms;
orb still unmounted while the overlay's orb slides. `"live"` = orb landed: the
orb mounts and plays; everything as today. Home derives the phase from the
gate: `!booted → "cold"`, `booted && !orbLanded → "waking"`, `orbLanded →
"live"`, with both flags initialized from the gate's synchronous getters so a
warm mount renders `"live"` on its first frame.

### `BootRite` (`src/ui/BootRite.tsx`)

- Renders `OrbLayer` still (`playing={false}`) + `AsciiDust` centered, machine
  text below. Orb diameter equals the Home diameter (same formula, same window
  width), so the slide is pure translation.
- On `done`: calls `markBootDone()` immediately (as today — the bottom-stack
  DecodeLines print as the field fades), then reads the anchor. If present, runs the slide (`translateX/Y` to the
  anchor's orb center, 550ms `Easing.out(Easing.cubic)`) alongside the existing
  `FadeOut`; text opacity → 0 in 200ms. On slide completion, calls
  `markOrbLanded()`, then unmounts.
- If no anchor at `done` (deep link, measurement not yet published, anything):
  today's behavior — fade only — and `markOrbLanded()` fires with `markBootDone()`.

`CallingRite` (first-open) is out of scope for the prototype; it keeps the plain
fade. Follow-up once the boot version is right.

### `bootGate` (`src/game/bootGate.ts`)

Grows from one event to a small phase signal, same module-level shape:

- `markBootDone()` / `onBootDone(cb)` — unchanged.
- `markOrbLanded()` / `onOrbLanded(cb)` — the moment Home should mount its orb
  and start the hands. Fires immediately if already landed.
- `setHeroAnchor({ x, y, w, h })` / `getHeroAnchor()` — the orb's rect in
  window coordinates, published by Home's `OrbLayer` slot via
  `onLayout` → `measureInWindow`. Re-published on every layout change; the
  rite reads it once, at `done`.
- `resetBootGateForTest()` clears all three.

### Home (`src/app/index.tsx`)

- `booted` (existing) keeps gating the epigraph/DecodeLines. Add
  `orbLanded` from `onOrbLanded`; pass `phase={orbLanded ? "live" : "cold"}`
  to `LivingHero`.
- Title cue: `MaterializeTitle active` fires at `orbLanded + 350ms` (was
  `booted`). Epigraph: `orbLanded + 850ms`. Implemented as one small
  `useCueTimers(orbLanded)` hook returning `{ title, epigraph }` booleans.
- Warm paths (Home focused later, rite already gone): `onOrbLanded` fires
  synchronously → `"live"` on first render, no cold flash.

## Data flow

```
Home mounts under overlay ─ onLayout ─▶ setHeroAnchor(rect)
Boot HOLD elapses ─▶ done ─▶ getHeroAnchor()
        ├─ anchor: slide orb → rect, fade field/text ─▶ markOrbLanded() ─▶ unmount
        └─ none:  fade field ─▶ markBootDone() + markOrbLanded() ─▶ unmount
Home: onOrbLanded ─▶ phase "live" (orb mounts, autoplay; hands enter; glow up)
      ─▶ +350ms title ─▶ +850ms epigraph
```

## Assets

### Prototype placeholders (cut from `hero-loop.webp`, 1000×562, 118 frames @ 83ms)

| File | Crop (x, y, w, h) | Notes |
|---|---|---|
| `assets/art/orb-loop.webp` | 355, 120, 290, 290 | orb centered (500, 265), r≈135 + margin |
| `assets/art/hand-left-loop.webp` | 0, 0, 345, 562 | infinite loop, idle |
| `assets/art/hand-right-loop.webp` | 655, 0, 345, 562 | infinite loop, idle |

Pipeline (the local ffmpeg has no WebP encoder): `ffmpeg -i hero-loop.webp -vf crop=W:H:X:Y
frames/%03d.png` → `img2webp -loop 0 -d 83 -lossy -q 80 frames/*.png -o out.webp`.
Verify each keeps alpha and frame count (`webpmux -info` → "transparency", 118 frames). Keep `hero-loop.webp`
until the layered hero ships; delete in the cleanup commit.

### Real assets (brief for generation)

- **Orb**: 1:1 transparent WebP loop, ≥600×600, seamless, loop count 0. Orb
  fills ~93% of the tile (matches the crop margin above so `ORB_DIAMETER_RATIO`
  holds). Frame 0 must be a clean rest frame — it is the boot still.
- **Hands**: two transparent WebP *entrance* clips, ~1.0–1.3s @ 12fps, each
  sized to its 345×562 stage slot (or 2× that). Enter from the outer edge, end
  on the rest pose. **Loop count 1** (`webpmux -loop 1`) so the last frame
  holds as the idle. Optional: separate idle loops later; not in this design.
- **Glow** stays procedural (Skia), so mood tinting keeps working.

## Verification

- `tsc`, `vitest run`. New unit tests for `bootGate` phases and anchor
  (`test/bootGate.test.ts` exists) and for the cue-timer hook.
- On device (iOS first, then Android):
  1. Cold start → orb rises and lands with no visible jump; loop starts
     swirling at landing; hands enter; title after.
  2. Cold start via a notification deep link into `/reveal/...` → plain fade,
     no orb slide, no errors.
  3. Warm return to Home → `"live"` immediately, no cold flash.
  4. Reduced motion on → no rite, graded still.
  5. Console shows no `Terminal Patina SkSL` error.
- Unknown to confirm on device: whether `expo-image` honors the file's WebP
  loop count on iOS (SDWebImage) and Android (Glide). If not, fallback is
  `stopAnimating()` on a timer at the clip's known duration.

## Out of scope

`CallingRite` handoff; idle hand loops separate from entrance; any change to
round/reveal/ledger; the boot text content or timings.
