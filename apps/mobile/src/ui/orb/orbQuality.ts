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
