# Product Visual Design and Implementation Brief

> Delivered by Erik 2026-08-26. This is the authoritative brand system; it refines
> the "digital antiquity" direction in 2026-08-09-oracle-design.md §3b. Where they
> conflict, this brief wins (see the reconciliation notes at the bottom).

## Overview

Build a premium cross-platform visual system for a marketing website and iOS/Android app.

The central brand object is a luminous glass orb. It represents intelligence, possibility, connection, and an idea becoming tangible.

The visual language combines:

- Renaissance-inspired painted imagery
- Carrara marble sculpture
- A pristine futuristic glass orb
- Sparse ASCII/terminal interference
- Quiet museum-like backgrounds
- Contemporary, minimal interface design

The intended tension is:

**Old-world humanity × timeless sculpture × luminous intelligence × restrained digital interference**

The final experience should feel poetic, intelligent, sacred, slightly surreal, and premium. It must not resemble generic AI, cyberpunk, wellness-tech, or stock photography.

---

# 1. Core Visual Identity

## The orb

The orb is the consistent, recognizable brand asset across the website, app, store listing, social content, email, and motion.

Preserve these characteristics:

- Near-perfect spherical geometry
- Transparent glass outer shell
- Cool blue-gray glass rim
- Physically believable reflection and refraction
- Diffused lavender inner atmosphere
- Warm peach-white luminous center
- Restrained pale-blue halo
- Soft environmental or contact shadow
- Quiet, premium studio lighting

The orb must never become:

- A planet
- An eye or pupil
- A crystal ball on a stand
- A metallic sphere
- A soap bubble
- A portal filled with literal scenery
- A neon cyberpunk object
- A container for fake UI, icons, or text

The center should remain soft and atmospheric, not a sharp starburst.

## Material hierarchy

The design system uses four distinct materials:

1. **Paint** represents humanity, history, emotion, and imagination.
2. **Marble** represents permanence, structure, protection, and trust.
3. **Glass and light** represent intelligence, possibility, and the product itself.
4. **ASCII characters** represent digital transformation, computation, and hidden system activity.

Do not blur these materials into one generic AI-generated aesthetic. Their contrast is the point.

---

# 2. Hands and Gestures

Do not use photographic or contemporary advertising hands.

There are two coordinated hand systems.

## Painted hands

Use Renaissance-inspired, old-master painted hands with:

- Graceful, slightly elongated anatomy
- Expressive finger positioning
- Warm layered pigments
- Subtle painterly brushwork
- Softly modeled knuckles
- Ultramarine, vermilion, muted ochre, and aged-gold sleeves
- Restored oil-painting or fresco character

They should feel allegorical, sacred, and museum-like.

Do not directly reproduce a specific historical composition, figure, or painting. The gestures should be original.

## Marble hands

Use idealized Renaissance sculpture rendered in luminous Carrara marble:

- Graceful proportions
- Clearly separated fingers
- Subtle gray veining
- Restrained chisel texture
- Slightly weathered edges
- Soft directional museum lighting
- Ivory-white or cool-white stone

Marble must remain visibly stone. It must not resemble living skin, plaster, glossy ceramic, plastic, or a generic 3D render.

## Gesture library

Maintain approved painted and marble versions of these gestures:

1. Reaching
2. Almost touching
3. Presenting
4. Receiving
5. Protecting from above
6. Supporting from below
7. Releasing
8. Inviting
9. Pointing with wonder

Prefer gestures that create emotional tension around the orb without obscuring it.

---

# 3. Background System

The compositions should feel flat and spacious, but not sterile.

## Primary: Museum White

Use for approximately 70% of imagery.

```text
#F7F6F2
```

Characteristics:

- Nearly flat warm white
- Faint lime-plaster tonality
- Extremely subtle paper or mineral grain
- Gentle ambient falloff
- No visible room, wall seam, or horizon

## Secondary: Luminous White

Use for approximately 15% of imagery.

```text
#F5F6F7
```

Characteristics:

- Clean high-key off-white
- Almost imperceptible cool-blue gradient near the orb
- Minimal visible texture
- More contemporary and product-oriented

## Contrast: Midnight Museum

Use for approximately 10% of imagery.

```text
#121A2B
```

Characteristics:

- Deep desaturated midnight blue
- Subtle tonal depth
- Soft falloff
- No stars, smoke, particles, galaxies, or sci-fi scenery

## Editorial accent: Fresco White

Use for approximately 5% of imagery.

```text
#F3F0E9
```

Characteristics:

- Warm lime-plaster field
- Faint mineral texture
- Delicate aged variation
- No cracks, ruins, stains, distressed borders, or theatrical antiquing

Large areas of quiet negative space are essential. Background texture should be perceived subconsciously rather than becoming a visible feature.

---

# 4. ASCII Treatment

Call the ASCII design treatment **Terminal Patina**.

Terminal Patina is a sparse digital material that appears within or around the artwork. It should feel like computation quietly entering a museum artifact.

Use ASCII in approximately 20–30% of campaign imagery. Within an individual image, it should generally cover only 5–20% of the composition.

Preferred characters:

```text
. : - + * # % / \ ( ) 0 1
```

Begin primarily with punctuation. Letters should be rare because random letters can resemble corrupted copy.

## Approved ASCII behaviors

### Edge shimmer

ASCII characters replace small portions of a hand or orb silhouette.

### Materialization

A painted or marble wrist gradually dissolves into a character grid while retaining its shape, light, and volume.

### Halo atmosphere

Sparse characters collect around the pale-blue orb halo and disperse into the background.

### Glass reflection

Tiny curved rows of ASCII are refracted inside selected glass highlights.

### Digital shadow

A small portion of a cast shadow breaks into horizontal terminal characters.

## ASCII restrictions

Do not use:

- Matrix-style green code
- Large code blocks
- Readable programming code
- Random words
- Full-image ASCII conversion
- RGB splitting
- VHS overlays
- Pixel sorting
- Aggressive corruption
- Rapid flickering
- Fluorescent neon
- Dense character rain

The ASCII should be discovered as a detail, not immediately dominate the image.

## Preferred hero treatment

For compositions containing the painted upper hand, marble lower hand, and orb:

- Keep the painted upper hand intact
- Allow the marble wrist to dissolve partially into ASCII
- Add extremely subtle ASCII refraction to one or two orb highlights
- Keep the orb's warm center completely clear
- Preserve all fingertips and expressive anatomical details

This creates the conceptual hierarchy:

- Painted hand: human history
- Marble hand: permanent form
- ASCII transition: digital transformation
- Glass orb: intelligence and possibility

---

# 5. ASCII Shader Implementation

Assume React Native Skia for the mobile app.

Implement the dynamic ASCII effect as a custom SkSL runtime shader.

## Shader inputs

The shader should accept:

- Original image texture
- Pre-rendered ASCII glyph-atlas texture
- Grayscale effect-mask texture
- Canvas resolution
- Glyph-atlas dimensions
- Cell size
- Glyph count
- Effect intensity
- Animation time
- ASCII color
- Optional reveal origin
- Optional reveal radius
- Optional noise threshold

## Processing logic

For every character cell:

1. Sample the source image at the center of the cell.
2. Calculate luminance.
3. Convert luminance into a glyph-atlas index.
4. Sample the selected glyph.
5. Read effect intensity from the grayscale mask.
6. Blend the colored glyph with the original image.
7. Preserve the unmasked image exactly.

Dark image regions should generally select denser glyphs.

Use a horizontal transparent PNG atlas with equal-sized cells. Suggested glyph order:

```text
[space] . : - + * # % @
```

Use a monospaced font, white glyphs, transparent background, and identical padding for every glyph.

## Mask rules

- Black or transparent: no ASCII
- White: full ASCII treatment
- Gray: transitional blend

For the core brand composition, the effect mask should be:

- White near the end of the marble wrist
- Soft gray through the wrist transition
- White in two small orb-reflection arcs
- Black over the warm orb center
- Black over every fingertip
- Black across the painted upper hand
- Black through important copy-safe areas

## Animation modes

### Terminal Patina

Static or nearly static.

- Cell size: approximately 7–10 logical pixels
- Intensity: 0.4–0.65
- Character pattern changes rarely

### Activation

ASCII travels from a marble or painted hand toward the orb.

- Animate reveal origin or radial mask
- Intensity rises from 0 to approximately 0.8
- One restrained light ripple occurs inside the orb
- Effect returns to 0 or settles around 0.2

### Atmospheric Dust

Sparse characters drift near the orb halo.

- Intensity: approximately 0.15–0.3
- Slow changes at 2–4 steps per second
- Do not randomize every rendered frame

### Reflection

ASCII moves slowly across selected glass highlights.

- Very low contrast
- Curves with the orb's spherical surface
- Must not cross the luminous center

## Performance requirements

- Animate uniforms instead of recompiling the shader.
- Sample source luminance once per cell.
- Avoid expensive multi-sample edge detection in the first version.
- Pause animation when the component is offscreen.
- Respect reduced-motion settings.
- Test on older Android hardware.
- Account for device pixel density.
- Use supersampling where needed to keep small glyphs crisp.
- Avoid cells smaller than approximately 6 physical pixels.
- Keep the shader constrained to the artwork bounds.

For independent floating characters that do not reconstruct the image, use Skia's sprite atlas rendering rather than the full image shader.

## Reduced-motion behavior

When reduced motion is enabled:

- Freeze character positions
- Disable traveling glitches and pulses
- Preserve a static Terminal Patina treatment
- Allow only an optional slow opacity change

---

# 6. Image Composition Rules

## Copy-safe areas

Every generated image should be created without baked-in marketing copy.

Common compositions:

- Desktop hero: orb on right, left 45–50% quiet
- Reverse desktop hero: orb on left, right 45–50% quiet
- Mobile hero: orb below center, upper 35–40% quiet
- App Store background: main subject in lower-middle, upper third quiet
- Social portrait: subject slightly below center, upper third available
- Open Graph: all critical imagery inside central 80%

Do not place fake product interfaces into generated artwork. Composite real screenshots and copy later.

## Lighting

Use:

- Diffused museum-quality light
- Soft, believable shadows
- Restrained highlights
- Consistent light direction across combined materials

Avoid:

- Hard commercial product lighting
- Extreme bloom
- Sharp starbursts
- Strong lens flare
- Heavy vignettes
- Dramatic fantasy lighting

---

# 7. Application UI Direction

The interface should remain quieter and more contemporary than the campaign artwork.

## UI characteristics

- Warm-white foundation
- Dark ink typography
- Very restrained borders
- Generous spacing
- Soft corners used selectively
- Minimal gradients
- Orb used as a stateful product object
- ASCII used for delight, loading, activation, and transitions

The UI should not imitate a Renaissance interface. The historical layer belongs primarily to imagery and motion.

## Suggested design tokens

```ts
const colors = {
  museumWhite: "#F7F6F2",
  frescoWhite: "#F3F0E9",
  luminousWhite: "#F5F6F7",
  midnightMuseum: "#121A2B",
  ink: "#17191F",
  mutedInk: "#666A73",
  glassBlue: "#9CB5D1",
  lavender: "#B7A9E4",
  warmCenter: "#F2BE91",
  vermilion: "#A84B35",
  ultramarine: "#243D78",
  agedGold: "#AA8A50",
};
```

Use ASCII colors primarily from:

- Warm white
- Cool blue-gray
- Pale lavender
- Occasionally muted ink

Avoid terminal green as a default.

## Orb states

The app may use the orb for:

- Idle
- Listening
- Thinking
- Responding
- Success
- Error

Suggested behavior:

- Idle: almost imperceptible breathing
- Listening: gentle warm-center pulse
- Thinking: slow lavender movement and sparse ASCII halo
- Responding: warm light expands outward
- Success: one restrained halo ripple
- Error: light contracts softly; avoid aggressive red flashing

---

# 8. Website Behavior

## Hero

Use a warm museum-white background and an orb-led composition.

Preferred imagery:

- Orb alone
- Painted hand approaching the orb
- Marble hand supporting it
- Painted and marble hands interacting across the orb
- Sparse Terminal Patina along a wrist or glass reflection

ASCII may animate gently on hover or during initial reveal, but the page should settle into stillness quickly.

## Feature sections

Use one visual metaphor per feature:

- Discover: hand revealing the orb
- Connect: two hands exchanging it
- Create: internal light becoming more expansive
- Understand: interior atmosphere becoming clearer
- Protect: marble hands sheltering it
- Transform: marble or painted material transitioning into ASCII

Alternate image placement across sections while preserving generous whitespace.

## Hover details

Potential micro-interactions:

- A fingertip converts into ASCII for 150–300 ms
- A small ASCII arc appears around the orb rim
- A few characters travel through a glass reflection
- A button hover produces a tiny punctuation trail
- A feature card reveals a static terminal coordinate or symbol cluster

Do not apply a glitch to every interactive element.

---

# 9. Production Assets

The initial production sprint should include:

1. Canonical transparent orb cutout
2. Simplified app-icon orb
3. Dark-mode orb
4. Painted hand approaching the orb
5. Painted and marble hands exchanging the orb
6. Marble hands protecting the orb
7. Desktop website hero
8. Mobile website hero
9. Eight-second orb breathing loop
10. Three-second touch/activation animation
11. Six App Store or Play Store screenshot backgrounds
12. Four social-launch stills
13. Four vertical social clips
14. Open Graph image
15. Email and press header
16. Painted-hand gesture reference sheet
17. Marble-hand gesture reference sheet
18. Transparent ASCII atmospheric-element library
19. ASCII glyph-atlas texture
20. Grayscale ASCII masks for primary compositions

---

# 10. Weavy Generation Workflow

Preserve both the image reference and its descriptive prompt.

```text
Orb reference image ─→ Image Describer ─→ orb description
        │
        └───────────────────────────────→ image-edit reference

Hand/style reference ─→ Image Describer ─→ style description
        │
        └───────────────────────────────→ optional second reference

Orb description
+ style description
+ asset-specific prompt
+ material lock
+ negative prompt
        ↓
Prompt combiner
        ↓
Reference-aware image edit/generation
        ↓
Masked correction
        ↓
Background removal or outpainting
        ↓
ASCII edit branch
        ↓
Upscale
        ↓
Preview and export
```

Generate clean masters first. Add ASCII through a masked edit or later compositing branch. Do not ask the first generation to solve the composition, hands, orb, typography, and ASCII simultaneously.

## Orb lock prompt

```text
Preserve the supplied orb as the same recognizable object. It remains a near-perfect transparent glass sphere with a cool blue-gray rim, realistic refraction and reflection, a diffused lavender interior, a soft peach-white luminous center and a restrained pale-blue halo. Do not redesign, flatten, elongate, open, decorate or add symbols to the orb.
```

## Painted-hand lock prompt

```text
Render every hand in a consistent old-master painted world with graceful Renaissance-inspired anatomy, expressive fingers, warm layered pigments, subtle brushwork and ultramarine, vermilion, muted ochre or aged-gold drapery. The hand must feel allegorical and museum-like, not photographic or commercial. Use an original gesture rather than recreating an identifiable historical artwork.
```

## Marble-hand lock prompt

```text
Preserve the approved Carrara marble material, graceful Renaissance proportions, subtle gray veining, restrained chisel texture, softly weathered surface and directional museum lighting. The hand must remain sculptural stone, never living skin, plaster, glossy ceramic or a generic 3D render.
```

## Terminal Patina prompt

```text
Add a restrained digital intervention made from tiny monospaced ASCII punctuation. Confine the effect to the specified mask or material transition. Make the characters follow the original subject's anatomy, volume, lighting, reflection or shadow. Preserve the orb's center, expressive fingertips and large areas of negative space. The result should feel like a quiet terminal signal entering a museum artifact.
```

## Global negative prompt

```text
No photographic advertising hands, modern corporate clothing, malformed anatomy, extra fingers, fused fingers, fake interface, text, logo, watermark, eye, planet, crystal-ball stand, metallic orb, soap bubble, cyberpunk scenery, Matrix rain, green code, full-image glitch, RGB split, VHS effect, pixel sorting, large code blocks, excessive bloom, starburst, heavy vignette, clutter or direct copy of an identifiable historical artwork.
```

---

# 11. Accessibility

- ASCII is decorative and must never be required to understand content.
- Do not encode essential status solely through color or motion.
- Maintain readable contrast over museum-white backgrounds.
- Supply useful alternative text for brand artwork.
- Respect reduced-motion settings.
- Avoid rapid flicker or high-frequency glitching.
- Ensure touch targets and focus states remain conventional and clear.
- The app must remain fully usable if shader effects are disabled.

---

# 12. Quality Standard

Approve a visual when:

- The orb is immediately recognizable
- Paint, marble, glass, and ASCII remain materially distinct
- The gesture communicates clearly
- The composition contains useful negative space
- The effect survives mobile cropping
- ASCII feels intentional and delightful
- The result feels calm, human, intelligent, and premium

Reject a visual when:

- ASCII dominates the artwork
- Hands resemble stock photography
- Marble resembles plastic or skin
- The orb becomes opaque or symbolic
- The background becomes scenic or theatrical
- The visual resembles generic AI or cyberpunk marketing
- Motion feels nervous, glitchy, or distracting
- Important anatomy or the orb's center is obscured

The guiding principle for every implementation decision is:

**Protect the silence. Preserve the orb. Let the digital layer appear as a discovered detail.**
