# Real-Time Oracle Orb — Design

**Date:** 2026-09-01
**Status:** approved in brainstorm, implementation plan next
**Builds on:** `2026-09-01-boot-orb-handoff-design.md`, `2026-08-26-terminal-patina-shader.md`, `2026-08-26-oracle-brand-brief.md` §4, `src/ui/OrbLayer.tsx`, `src/ui/GlassRefraction.tsx`, `src/game/heroStage.ts`
**Source of truth for appearance:** `design/art-direction/orb-reference.png` (the canonical image, background-removed, 1408×768)

## Problem

The orb is a 1.2 MB animated WebP (`orb-loop.webp`, 118 frames). It cannot
respond to touch, it cannot reflect the crowd beyond a tinted glow behind it,
and its silhouette breathes — measured across the loop it varies from 279×277
to 296×284 px, and its centre sits 5.5 px above the tile's. A brand object
that is *the* artifact of the app should be a stable, precise, physical thing
whose interior is alive and responsive, not a video of one.

Replace the renderer, not the composition. The hands, the gold dust ring, the
mood glow, and the boot rite's slide all stay exactly as they are.

## What the canonical image actually contains

Measured, not assumed (`design/scripts/make-orb-layers.py` re-derives all of
this):

- **Alpha bbox is 380×382 at centre (704, 385), radius ≈ 190.5.** Tight to the
  sphere.
- **There is no contact shadow.** Background removal deleted it; 89.4 % of the
  file is fully transparent and the bbox admits no shadow region.
- **The interior is fully opaque** (alpha 254–255 throughout). The glass's own
  transparency did not survive removal, so the shader cannot simply show
  through — a knockout is mandatory.
- **A radial knockout at r 0.55 → 0.72 separates cleanly.** It removes the
  entire lavender-and-peach body and preserves the blue-grey rim, the broad
  upper-left specular, and the lower-right reflection. A chroma-based mask is
  worse: it centres on the warm core, under-removes the lavender, and hazes
  the top highlight.

Consequences for the brief: §4's contact shadow, §6's museum-white background
and contact caustic, and the `oracle-orb-shadow.png` / `museum-reflection.png`
assets are all **out of scope** — the orb floats between two hands and has no
ground plane.

The reference orb also differs from the shipped loop in one visible way: the
loop's frame 0 carries warm reddish reflections of the hands baked into its
right edge, and the reference, being an isolated render, does not. After the
swap the hands will no longer appear in the glass. Accepted.

## Geometry

`heroStage.ts` is **unchanged**. The orb tile keeps its rect, so nothing else
on Home moves. Inside that tile the orb becomes a fixed circle at frame 0's
size and position:

```
ORB_D  = 0.897      // 278 / 310 — frame 0's diameter, as a fraction of the tile
ORB_DY = -0.0177    // -5.5 / 310 — frame 0's centre sits above the tile's
```

The silhouette never changes again. §4's "must never wobble, squash, pulse, or
deform" is satisfied by there being no code path that writes to it.

## Architecture

One Skia `Canvas` per orb, in the existing tile, drawing in this order:

```
SkSL interior (clipped to the circle)
  → orb-shell.png          (raster, never displaced or filtered)
  → halo                   (procedural, outside the silhouette)
```

`GlassRefraction` stays exactly as it is, layered above, on its own Canvas.
Its ASCII belongs on top of the glass and it is already shipped and tuned;
merging it into the new shader would risk a working behaviour for one draw
call.

### Modules — `apps/mobile/src/ui/orb/`

| Module | Purpose | Imports |
|---|---|---|
| `OracleOrb.tsx` | Public component. Live vs. static tier, touch target, ref handle. | Skia, RN |
| `OracleOrbCanvas.tsx` | The Canvas: interior → shell → halo. Binds uniforms. | Skia, Reanimated |
| `orbShader.ts` | SkSL source, one module-scope compiled effect, guarded. | Skia |
| `orbState.ts` | **Pure.** State → uniform targets, transition validity, transient resolution. | — |
| `orbTouch.ts` | **Pure.** Screen → local `[-1,1]`, hit test, sphere normal, clamping. | — |
| `orbRipples.ts` | **Pure.** Two slots; which slot a new tap takes. | — |
| `orbQuality.ts` | **Pure.** `(prop, reducedMotion, compiled)` → tier. | — |

Five of the seven are pure and node-testable, following the precedent set by
`orbMood.ts` and `haloMood.ts`: tests never import Skia or React Native.

`oracleOrbAnimations` from the brief is **not** a module. Its job — "state to
target uniforms over time" — is `orbState.ts` plus Reanimated's own timing;
a separate layer would only forward.

`OracleOrbSplashHandoff` is **not** a module. `BootRite` already owns the
handoff, and does something more specific than §9 describes.

## The shader

### Sample the interior; never invent it

The script emits `orb-interior.png` (256², the region the knockout removed —
the field is entirely low-frequency, so 256 is ample). The shader displaces
the *sample coordinate* and never authors colour:

```
p      = local coords in [-1,1];  transparent where length(p) > 1
z      = sqrt(max(0, 1 - dot(p,p)))          // sphere front face
n      = normalize(float3(p.x, p.y, z))
warp   = parallaxA + parallaxB + refract(z) + ripple(p, t)
colour = interior.eval(uvFor(p + warp))
```

At baseline every warp term is zero, so the sampled interior is
**pixel-identical to the reference by construction**. This is the design's
central bet: §15.1 ("the non-animated layered renderer matches the approved
source image") stops being an open-ended tuning exercise against an eyeballed
target and becomes an assertion the tests can make.

It also excludes the brief's §4 failure modes geometrically rather than by
taste:

- *"Centre recedes without shrinking into a dot"* is an outward coordinate
  scale. It cannot produce a dot, because it never scales toward the origin.
- *"No opaque purple geometry"* holds because every interior pixel is a sample
  of a translucent reference field; there is no path that emits a solid fill.
- *"Opposing parallax"* is two samples at differently-signed warps mixed by a
  slow weight. The field is smooth, so the double sample reads as depth rather
  than as a ghost image.

Warm centre, halo, and dispersion remain procedural. The halo is outside the
silhouette; dispersion is a two-radius sample split, exactly the technique
`GlassRefraction` already uses.

### Uniforms

Twelve, not the brief's twenty-one. The dropped ones either belong to the
retired shadow/caustic work or are now consequences of the warp rather than
inputs to it.

```
resolution · time · stateProgress · qualityLevel
parallax · centerDepth · centerLean
refractionStrength · dispersionStrength · haloIntensity
rippleA(origin, startTime, strength) · rippleB(origin, startTime, strength)
```

### Ripple

A travelling band over the approximated sphere, 900–1300 ms, phased as the
brief specifies: local optical compression, lavender wave expanding over the
sphere, the warm centre leaning toward the touch, then return to the current
steady state. Smooth falloff, no hard rings. The opposite-side caustic from
§6 is retained as an interior term only — there is no contact surface for it
to land on.

## States

`orbState.ts` speaks ORACLE's own vocabulary, not a voice assistant's. The
brief's six (`idle`/`listening`/`thinking`/`responding`/`success`/`error`)
describe a product this app does not have, and §4 explicitly forbids the orb
from resembling one.

| State | Meaning | Behaviour |
|---|---|---|
| `dormant` | Boot rite; the still | `time` frozen, all warps at baseline |
| `waking` | The handoff | 700–1000 ms rise; warm centre advances, halo fades in |
| `attending` | Round open, unsealed | Slow opposing parallax, warm centre broad and slightly off-axis |
| `sealed` | Player has committed | Parallax slows, interior settles, halo steady |
| `revealing` | The crowd is shown | Warm centre advances toward the front glass, one caustic sweeps the lower hemisphere |
| `spent` | Day is done | Warm centre recedes and cools, halo contracts |

Crowd lean and turnout stay **continuous inputs**, not states: `orbGlowRgb`,
`haloGate`, and `haloDwell` feed tint and restlessness unchanged, so the orb
keeps carrying the crowd exactly as it does today.

Reanimated drives the uniform targets on the UI thread with `withTiming`.
There is no JS animation loop and no per-frame React state — §11's hard
requirements.

## Interaction

A `Pressable` sized to the tile, **on Home only**.

- `orbTouch.locate()` converts to `[-1,1]`, rejects `length > 1` so the tile's
  corners are not tappable, and returns the sphere normal.
- `orbRipples.assign()` picks a slot: a free one, else the oldest completed,
  else the weakest.
- Light haptic through the existing `expo-haptics` dependency. No new package.
- **No navigation.** The orb answers with a ripple and nothing else.

`BootRite` passes `frozen` and no press handler, so its full-screen skip
`Pressable` keeps every tap, orb included.

## Quality and fallback

`orbQuality.resolve()` takes three real signals and decides once at mount.
There is deliberately **no runtime frame-rate governor**: the project has no
FPS telemetry, and §11 forbids branching on device models, so `auto` would
have nothing honest to read.

| Tier | When | Behaviour |
|---|---|---|
| `high` | Default | Two interior samples, dispersion on, two ripple slots |
| `reduced` | Explicit prop | One interior sample, dispersion off, one ripple slot |
| `static` | Shader failed to compile, image failed to load, or reduced motion | `orb-fallback.png` via `expo-image`, press target and callbacks preserved |

Time progression pauses when the app backgrounds and when the orb unmounts.
The effect is compiled once at module scope. No allocation inside animation
frames.

Failures log through `console.error`, matching `GlassRefraction`. No new
analytics service. A failure must never block startup or navigation.

## Assets

One new script, `design/scripts/make-orb-layers.py`, alongside the existing
`make-ascii-atlas.py` and `make-hero-loop.py`. Requires Pillow (a venv at
`design/.venv` is fine; it is gitignored).

Input: `design/art-direction/orb-reference.png`.

Committed outputs in `apps/mobile/assets/art/`:

| Asset | Size | Contents |
|---|---|---|
| `orb-shell.png` | 512² | Reference with the interior knocked out at r 0.55 → 0.72 |
| `orb-interior.png` | 256² | The removed field — what the shader samples |
| `orb-fallback.png` | 512² | Reference unmodified, for the static tier |

Knockout radius and feather are named constants at the top of the script, so
the separation is re-tunable in one place and the assets are reproducible.

**Deleted:** `orb-loop.webp` (1.2 MB off the bundle) and `src/ui/OrbLayer.tsx`.

## Testing

### Unit — vitest, no Skia or RN imports

Valid and invalid transitions; interrupted-transition priority; state change
arriving during a ripple; screen-to-local conversion; circular hit testing;
sphere-normal approximation; ripple-slot replacement across the three cases;
quality resolution for each of the three signals; reduced-motion selection.

**Baseline identity:** at rest, every warp term is zero. This is the
automatable half of §15.1 and the reason the sample-don't-invent design was
chosen.

### Component

Static fallback renders; press callback receives normalized coordinates;
outside-circle presses do not ripple; accessibility props propagate
(`accessibilityLabel` defaults to `Oracle`, image semantics unless the parent
gives it button semantics); state prop changes reach the controller;
`BootRite` still skips on a tap over the orb.

### Visual — manual gate, not automated

There is no headless Skia in this toolchain, so the brief's twelve reference
frames become a dev-only comparison screen and a review checkpoint, not
snapshot tests. **The static match must be approved before ripple or state
animation work begins** (§16 step 4).

The screen shows: the supplied reference, the layered static reconstruction,
each of the six states, a centre tap, an edge tap, the reduced tier, and the
static fallback.

### Performance — requires devices

Cannot be run from this environment. On one representative iOS device and one
mid-range Android, record: average frame rate; slowest observed frame periods;
time to first rendered orb frame; memory before and after mounting; behaviour
after repeated navigation mount/unmount cycles. Target 60 fps, with 30 fps
acceptable in the reduced tier.

## Sequence

1. `make-orb-layers.py`; commit the three assets. **Visual approval gate.**
2. `orbTouch.ts` + tests.
3. `orbState.ts`, `orbRipples.ts`, `orbQuality.ts` + tests.
4. `orbShader.ts` + `OracleOrbCanvas.tsx`, baseline only — no motion.
   **Static match approval gate against the reference.**
5. Interior parallax and the six states.
6. Tap ripple.
7. Static fallback and quality tiers.
8. Swap `OrbLayer` → `OracleOrb` in `LivingHero` and `BootRite`; delete
   `orb-loop.webp`.
9. Accessibility pass, visual review screen, device performance validation.

## Open items

- Device performance numbers (step 9) need hardware and are the user's to run.
- The knockout radius may want a small adjustment after the step-1 visual gate;
  the constants exist for exactly that.

## Principle

Protect the exterior precision and put the mystery inside. The shell is
photographic and never moves. The interior is the reference's own material,
displaced.
