// Swipe-to-lean: dragging the card face tilts it toward a side; releasing
// past the commit threshold SEALS that side at the conviction the pull
// implies. The scale is tuned for instant feedback: conviction resolves at
// LEAN_COMMIT (one small nudge — 55%), climbs the 5-point grid, and tops out
// at LEAN_FULL, well within a single thumb stroke. Below LEAN_COMMIT a
// release cancels and the card springs home. Pure — node-tested.
export const LEAN_DEAD_ZONE = 0.05; // no visual lean under this fraction
export const LEAN_COMMIT = 0.12; // fraction of card width where 55% resolves
export const LEAN_FULL = 0.62; // fraction of card width where 95% lands

export function leanProgress(dx: number, cardWidth: number): number {
  if (cardWidth <= 0) return 0;
  const p = Math.max(-1, Math.min(1, dx / cardWidth));
  return Math.abs(p) < LEAN_DEAD_ZONE ? 0 : p;
}

export function leanRelease(dx: number, cardWidth: number): { answer: boolean; confidence: number } | null {
  const step = leanStep(dx, cardWidth);
  if (step === -1) return null;
  return { answer: dx > 0, confidence: 55 + step * 5 };
}

// Which conviction step (0..8 → 55..95) the current pull magnitude implies,
// or -1 below the commit threshold. Marked 'worklet' so the pan gesture can
// tick haptics per step on the UI thread; still a plain function under node.
export function leanStep(dx: number, cardWidth: number): number {
  "worklet";
  if (cardWidth <= 0) return -1;
  const p = Math.min(1, Math.abs(dx) / cardWidth);
  if (p < LEAN_COMMIT) return -1;
  return Math.round(((Math.min(p, LEAN_FULL) - LEAN_COMMIT) / (LEAN_FULL - LEAN_COMMIT)) * 8);
}

// The accessible twin of the pull: press-and-hold charges conviction at one
// grid step per HOLD_STEP_MS, 55 up to 95. Same metaphor, no motion needed.
export const HOLD_STEP_MS = 200;

export function holdConfidence(heldMs: number): number {
  return 55 + Math.min(8, Math.max(0, Math.floor(heldMs / HOLD_STEP_MS))) * 5;
}
