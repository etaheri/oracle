import { practiceOutcome, type Exhibition } from "@oracle/core";
import { formatFortune } from "./fortuneText";
import { lineLabel, receiptLine } from "./stakeText";

export type PracticePrediction = { answer: boolean };

// Practice runs on the practice fortune and the exhibition's line (design
// §8.3); nothing here touches the player's fortune. Reading register for the
// sentences, machine register for the receipt and the line.
export function practiceResult(prediction: PracticePrediction, exhibition: Exhibition) {
  const out = practiceOutcome(prediction, exhibition);
  const side = (a: boolean) => (a ? "YES" : "NO");
  const verdict = out.delta > 0 ? `You took the Oracle for ${formatFortune(out.delta)}.` : `The Oracle took ${formatFortune(-out.delta)}.`;
  const other = side(exhibition.outcome !== "yes");
  const counterfactual = out.oppositeDelta >= 0
    ? `Had it gone ${other}, the same call would have won ${formatFortune(out.oppositeDelta)}.`
    : `Had it gone ${other}, the same call would have lost ${formatFortune(-out.oppositeDelta)}.`;
  // The room's result on a past hot take (design 2026-09-22 §9.5): the
  // majority's side and its share. A market question keeps the plain outcome.
  const outcomeSide = side(exhibition.outcome === "yes");
  const roomPct = exhibition.crowdYesPct;
  const roomSidePct = roomPct === null ? null : exhibition.outcome === "yes" ? roomPct : 100 - roomPct;
  const roomLine = roomSidePct === null ? `Actual outcome: ${outcomeSide}.` : `The room said ${outcomeSide}, ${roomSidePct}%.`;
  return {
    ...out,
    receipt: receiptLine({ answer: prediction.answer, line: out.line }),
    verdict,
    counterfactual,
    roomLine,
    oracleLine: lineLabel(out.line)!,
  };
}
