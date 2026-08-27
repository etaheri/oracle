// The machine prints. Pure frame logic for the DecodeLine treatment and the
// ASCII crowd gauge — deterministic so a given seed and step always render
// the same frame (house rule: patina never re-randomizes per frame).

// Symbols only: an unrevealed cell must never masquerade as the final letter.
const NOISE_POOL = "+*:=%#/\\-·";

// Same char-walk family as epigraph/voiceSeed hashes.
function hash(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Frame `step` of `totalSteps`: a left-to-right reveal of `text`, with the
// unrevealed remainder scrambled from the noise pool. Spaces stay spaces so
// the word-shape reads through the static.
export function decodeFrame(text: string, step: number, totalSteps: number, seedKey: string): string {
  if (step >= totalSteps) return text;
  const revealed = Math.floor((text.length * Math.max(0, step)) / totalSteps);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (i < revealed || text[i] === " ") out += text[i];
    else out += NOISE_POOL[hash(`${seedKey}:${i}:${step}`) % NOISE_POOL.length];
  }
  return out;
}

export const GAUGE_CELLS = 12;

// [#####·······] — the crowd bar in the machine's own alphabet. `progress`
// (0..1) lets the fill print cell by cell during the reveal animation.
export function asciiGauge(pct: number, progress = 1): string {
  const clamped = Math.min(100, Math.max(0, pct));
  const target = Math.round((clamped / 100) * GAUGE_CELLS);
  const filled = Math.round(target * Math.min(1, Math.max(0, progress)));
  return `[${"#".repeat(filled)}${"·".repeat(GAUGE_CELLS - filled)}]`;
}
