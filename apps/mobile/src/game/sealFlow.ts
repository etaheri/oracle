import { LADDER_CONFIDENCES, LADDER_DEFAULT } from "@oracle/core";

// The two-step seal (design D11): tap a side, tap a rung, tap SEAL. Pure --
// node-tested. The card renders this; it decides nothing itself.
export type SealChoice = { side: boolean | null; confidence: number };

export const INITIAL_CHOICE: SealChoice = { side: null, confidence: LADDER_DEFAULT };

export function chooseSide(c: SealChoice, side: boolean): SealChoice {
  return { ...c, side };
}

export function chooseRung(c: SealChoice, confidence: number): SealChoice {
  if (c.side === null) return c;
  if (!(LADDER_CONFIDENCES as readonly number[]).includes(confidence)) return c;
  return { ...c, confidence };
}

export function canSeal(c: SealChoice): c is SealChoice & { side: boolean } {
  return c.side !== null;
}
