import { CONSTANTS as C, contrarianApplies } from "@oracle/core";

// The per-seal payout line: one mono verdict printed in the stationary
// footer the moment a card is thrown, while the next card deals. `against`
// mirrors the scoring engine's own contrarian rule — crowd size and all —
// so a gold AGAINST THE TIDE here is always an honest promise of the bonus.
// Below the crowd floor the tide isn't named at all. Pure — node-tested.
export const VERDICT_MIN_PLAYERS = 5;

// Said in the crowd's place, not about it: under five players the percentage
// is mostly the player themselves. Exported because the round's finale
// (CrowdReveal) holds its tongue at the same floor, from the same string.
export const GATHERING_LINE = "THE CROWD IS STILL GATHERING";

// The minority side, named where the bounty cannot yet pay. "AGAINST THE
// TIDE" is the phrase the plaque stat, the epithet and the reveal's gold
// moment all use, so it is reserved for the crowds that actually earn it
// (CONTRARIAN_MIN_CROWD). Between the two floors the line still tells the
// player they are in the minority — it just stops promising a bounty, which
// used to be carried by colour alone (brief §11).
export const UNCOUNTED_TIDE = "FEW STAND WHERE YOU STAND";

export function crowdVerdict(answer: boolean, crowdYesPct: number, playerCount: number): { line: string; against: boolean } {
  if (playerCount < VERDICT_MIN_PLAYERS) return { line: GATHERING_LINE, against: false };
  const sidePct = answer ? crowdYesPct : 100 - crowdYesPct;
  // The engine's own rule, crowd floor included — gold only when the bounty
  // can truly pay, and now the words only when it can too.
  const against = contrarianApplies(sidePct, playerCount);
  const tide =
    sidePct < C.CONTRARIAN_CROWD_PCT
      ? against
        ? "AGAINST THE TIDE"
        : UNCOUNTED_TIDE
      : sidePct >= 100 - C.CONTRARIAN_CROWD_PCT
        ? "WITH THE TIDE"
        : "THE CROWD SPLITS";
  return { line: `${crowdYesPct}% SAY YES · ${tide}`, against };
}
