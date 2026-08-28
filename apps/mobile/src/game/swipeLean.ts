import { snapConfidence } from "./confidence";

// Swipe-to-lean: dragging the card face tilts it toward a side; releasing
// past the commit threshold SELECTS that side (never seals — the seal stays
// an explicit button). Drag distance suggests conviction: a nudge past the
// threshold is 55, a full-width pull is 95, always snapped to the grid and
// always still adjustable on the slider. Pure — node-tested.
export const LEAN_COMMIT = 0.35; // fraction of card width that selects
export const LEAN_DEAD_ZONE = 0.05; // no visual lean under this fraction

export function leanProgress(dx: number, cardWidth: number): number {
  if (cardWidth <= 0) return 0;
  const p = Math.max(-1, Math.min(1, dx / cardWidth));
  return Math.abs(p) < LEAN_DEAD_ZONE ? 0 : p;
}

export function leanRelease(dx: number, cardWidth: number): { answer: boolean; confidence: number } | null {
  if (cardWidth <= 0) return null;
  const p = Math.max(-1, Math.min(1, dx / cardWidth));
  if (Math.abs(p) < LEAN_COMMIT) return null;
  const conviction = (Math.abs(p) - LEAN_COMMIT) / (1 - LEAN_COMMIT);
  return { answer: p > 0, confidence: snapConfidence(conviction) };
}
