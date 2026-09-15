// The swipe seal (design 2026-09-14 H2): the side is the whole choice, and
// the swipe or the button that sets it is the seal. Pure — node-tested. The
// card renders this; it decides nothing itself.
export type SealChoice = { side: boolean | null };

export const INITIAL_CHOICE: SealChoice = { side: null };

export function chooseSide(c: SealChoice, side: boolean): SealChoice {
  return { ...c, side };
}

export function canSeal(c: SealChoice): c is SealChoice & { side: boolean } {
  return c.side !== null;
}
