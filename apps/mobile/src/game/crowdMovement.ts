import { VERDICT_MIN_PLAYERS } from "./crowdVerdict";

export const MOVEMENT_MIN_DELTA = 5;

// How the tide moved after you committed (design 2026-09-09 §4.1). Pure.
// Both floors are display floors: under VERDICT_MIN_PLAYERS at either end a
// percentage is mostly the reader, so the line stays silent. It never
// mentions the bounty — that is crowdVerdict's job and it has its own floor.
export function crowdMovement(
  atSeal: { pct: number; count: number } | null | undefined,
  now: { pct: number; count: number } | null | undefined,
  final: boolean,
): string | null {
  if (!atSeal || !now) return null;
  if (atSeal.count < VERDICT_MIN_PLAYERS || now.count < VERDICT_MIN_PLAYERS) return null;
  if (Math.abs(now.pct - atSeal.pct) < MOVEMENT_MIN_DELTA) return null;
  return `WHEN YOU SEALED ${atSeal.pct}% SAID YES · ${final ? "IT ENDED AT" : "NOW"} ${now.pct}%`;
}
