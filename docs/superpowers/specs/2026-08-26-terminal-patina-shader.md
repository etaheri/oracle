# Terminal Patina — Skia Shader Implementation Spec

> Companion to `2026-08-26-oracle-brand-brief.md` §4–5. Delivered by Erik 2026-08-26.
> This is the starter architecture and SkSL for the ASCII treatment in the mobile app
> (React Native Skia). Phase 1 is scheduled after the delight pass
> (`docs/superpowers/plans/2026-08-26-delight-pass.md`).

## Architecture

Skia is a strong fit. Build it as a GPU shader using:

- The brand image as one texture
- A pre-rendered monospace glyph atlas as a second texture
- An optional mask as a third texture
- SkSL to choose glyphs based on image luminance

SkSL cannot conveniently "type" font glyphs inside the fragment shader. Pre-render
characters such as ` .:-+*#%@` into one horizontal PNG atlas, then have the shader
select a tile. React Native Skia supports custom SkSL through RuntimeEffect, nested
image shaders, uniforms, and animated values.

```text
Brand image ──────────┐
                      ├─→ ASCII Runtime Shader → final image
ASCII glyph atlas ────┤
                      │
Effect mask ──────────┘
```

Uniforms: `cellSize`, `intensity`, `threshold`, `time`, ASCII color, reveal position.

Use the mask to limit ASCII to: marble wrist, orb reflection, orb halo, painted-hand
edge, background atmospheric pockets. That is much more on-brand than converting the
entire image.

## Starter SkSL shader

Replaces masked regions with luminance-selected ASCII glyphs.

```tsx
import {
  Canvas,
  Fill,
  ImageShader,
  Shader,
  Skia,
  useImage,
  vec,
} from "@shopify/react-native-skia";

const asciiEffect = Skia.RuntimeEffect.Make(`
  uniform shader image;
  uniform shader glyphAtlas;
  uniform shader effectMask;
  uniform float2 resolution;
  uniform float2 atlasSize;
  uniform float cellSize;
  uniform float glyphCount;
  uniform float intensity;
  uniform float time;
  uniform float4 asciiColor;

  float luminance(half3 color) {
    return dot(color, half3(0.299, 0.587, 0.114));
  }

  float hash21(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  half4 main(float2 xy) {
    // Determine the current ASCII cell.
    float2 cellID = floor(xy / cellSize);
    float2 localUV = fract(xy / cellSize);

    // Sample the original image once at the center of each cell.
    float2 samplePoint = (cellID + 0.5) * cellSize;
    half4 source = image.eval(xy);
    half4 cellColor = image.eval(samplePoint);
    float brightness = clamp(luminance(cellColor.rgb), 0.0, 1.0);

    // Dark regions use denser glyphs.
    float glyphIndex = floor(
      (1.0 - brightness) * (glyphCount - 1.0) + 0.5
    );

    float glyphWidth = atlasSize.x / glyphCount;
    float glyphHeight = atlasSize.y;
    float2 atlasPosition = float2(
      glyphIndex * glyphWidth + localUV.x * glyphWidth,
      localUV.y * glyphHeight
    );

    half4 glyphSample = glyphAtlas.eval(atlasPosition);

    // White glyphs on transparent background.
    float glyphAlpha = max(
      glyphSample.a,
      luminance(glyphSample.rgb)
    );

    float maskAmount = effectMask.eval(xy).a;

    // Slight cell-level instability for the atmospheric variant.
    float noise = hash21(cellID + floor(time * 4.0));
    float atmosphericGate = smoothstep(0.22, 0.72, noise);

    float coverage =
      glyphAlpha *
      maskAmount *
      intensity *
      atmosphericGate;

    half3 tintedGlyph =
      asciiColor.rgb *
      mix(0.65, 1.2, brightness);

    half3 result = mix(
      source.rgb,
      tintedGlyph,
      clamp(coverage, 0.0, 1.0)
    );

    return half4(result, source.a);
  }
`)!;
```

## React Native Skia component

```tsx
type ASCIIImageProps = {
  width: number;
  height: number;
};

export function ASCIIImage({
  width,
  height,
}: ASCIIImageProps) {
  const image = useImage(
    require("./assets/orb-and-hands.png")
  );
  const glyphAtlas = useImage(
    require("./assets/ascii-atlas.png")
  );
  const effectMask = useImage(
    require("./assets/ascii-mask.png")
  );

  if (!image || !glyphAtlas || !effectMask) {
    return null;
  }

  const glyphCount = 10;
  const atlasWidth = glyphAtlas.width();
  const atlasHeight = glyphAtlas.height();

  return (
    <Canvas style={{ width, height }}>
      <Fill>
        <Shader
          source={asciiEffect}
          uniforms={{
            resolution: vec(width, height),
            atlasSize: vec(atlasWidth, atlasHeight),
            cellSize: 8,
            glyphCount,
            intensity: 0.72,
            time: 0,
            asciiColor: [0.72, 0.78, 0.9, 1],
          }}
        >
          <ImageShader
            image={image}
            fit="cover"
            rect={{ x: 0, y: 0, width, height }}
          />
          <ImageShader
            image={glyphAtlas}
            fit="fill"
            rect={{
              x: 0,
              y: 0,
              width: atlasWidth,
              height: atlasHeight,
            }}
          />
          <ImageShader
            image={effectMask}
            fit="cover"
            rect={{ x: 0, y: 0, width, height }}
          />
        </Shader>
      </Fill>
    </Canvas>
  );
}
```

Children are assigned to the shader uniforms in declaration order:

1. `image`
2. `glyphAtlas`
3. `effectMask`

## Glyph atlas

Make a transparent PNG containing equal-width glyph cells:

```text
  . : - + * # % @
```

Order the atlas from least dense to most dense. Because the shader inverts brightness
when selecting a character, dark image cells receive denser characters.

Recommended specifications:

- Monospace typeface
- White glyphs
- Transparent background
- 32 × 48 or 48 × 64 pixels per glyph
- Identical cell widths
- No padding variation between glyphs
- 1× and 2× versions for testing

For the brand tone, test `. : - + * # %` first. Avoid letters initially: punctuation
reads as atmosphere; random letters can resemble broken text or corrupted localization.

## Mask design

The mask determines where the shader appears:

- Black/transparent: original image remains intact
- White/opaque: full ASCII
- Gray: blended transition

For the core composition, make a mask with:

- White around the lower marble wrist
- Soft gray along the marble forearm
- Small white arcs over two orb reflections
- Black across the orb's center
- Black across all fingertips
- Black across the upper painted hand

Blur the mask transition slightly so the material appears to dissolve instead of being
cut off.

## Three modes worth shipping

### Terminal Patina

Static, sparse ASCII embedded in the artwork.

- `cellSize: 7`, `intensity: 0.55`
- Use on website imagery and editorial social posts.

### Activation

Characters move from a hand toward the orb when the user interacts.

- Animate: reveal center → toward the orb; `intensity: 0 → 0.8 → 0`; `time` continuously increasing
- Use for touch, loading, listening, and transitions.

### Atmospheric Dust

Only a few cells appear and change slowly around the halo.

- `cellSize: 6`, `intensity: 0.25`, time update: 2–4 changes per second
- Avoid updating the pattern every frame. A slower rhythm feels intentional and
  prevents nervous visual noise.

## Performance guidance

- Keep cells around 6–12 physical pixels.
- Avoid calculating several neighboring samples per pixel initially.
- Sample luminance once at each cell center.
- Animate uniforms rather than rebuilding the shader.
- Render only inside the artwork bounds.
- Pause animation when the asset is offscreen.
- Test on an older Android device, not only an iPhone simulator.
- Account for pixel density; React Native Skia notes that runtime shader image filters
  do not automatically handle density scaling — supersample where crispness matters.
- Caveat: for purely decorative floating characters, Skia's **Atlas** component may be
  easier and cheaper because it efficiently renders many sprites. Use the shader when
  characters must reconstruct, dissolve, or respond to the underlying image; use Atlas
  for independent particles.
