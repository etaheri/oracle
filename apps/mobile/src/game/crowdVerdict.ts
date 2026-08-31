import { contrarianApplies } from "@oracle/core";

// The per-seal payout line: one mono verdict printed in the stationary
// footer the moment a card is thrown, while the next card deals. `against`
// mirrors the scoring engine's own contrarian rule — crowd size and all —
// so a gold AGAINST THE TIDE here is always an honest promise of the bonus.
// Below the crowd floor the tide isn't named at all. Pure — node-tested.
export const VERDICT_MIN_PLAYERS = 5;

export function crowdVerdict(answer: boolean, crowdYesPct: number, playerCount: number): { line: string; against: boolean } {
  if (playerCount < VERDICT_MIN_PLAYERS) return { line: "THE CROWD IS STILL GATHERING", against: false };
  const sidePct = answer ? crowdYesPct : 100 - crowdYesPct;
  const tide = sidePct < 40 ? "AGAINST THE TIDE" : sidePct >= 60 ? "WITH THE TIDE" : "THE CROWD SPLITS";
  // Gold only when the bounty can truly pay: the engine's own rule, crowd floor included.
  return { line: `${crowdYesPct}% SAY YES · ${tide}`, against: contrarianApplies(sidePct, playerCount) };
}
