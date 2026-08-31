// The per-seal payout line: one mono verdict printed in the stationary
// footer the moment a card is thrown, while the next card deals. `against`
// mirrors the scoring engine's contrarian rule (my side < 40% → the
// CONTRARIAN_MULT condition), so a gold AGAINST THE TIDE here is always an
// honest promise of the multiplier. Pure — node-tested.
export function crowdVerdict(answer: boolean, crowdYesPct: number): { line: string; against: boolean } {
  const sidePct = answer ? crowdYesPct : 100 - crowdYesPct;
  const against = sidePct < 40;
  const tide = against ? "AGAINST THE TIDE" : sidePct >= 60 ? "WITH THE TIDE" : "THE CROWD SPLITS";
  return { line: `${crowdYesPct}% SAY YES · ${tide}`, against };
}
