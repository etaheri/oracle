import { practiceOutcome, type Exhibition } from "@oracle/core";
import { formatFortune } from "./fortuneText";
import { lineLabel, receiptLine } from "./stakeText";

export type PracticePrediction = { answer: boolean; confidence: number };

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
  return {
    ...out,
    receipt: receiptLine({ answer: prediction.answer, stake: out.stake, wins: out.wins, confidence: prediction.confidence }),
    verdict,
    counterfactual,
    oracleLine: lineLabel(out.line)!,
  };
}
