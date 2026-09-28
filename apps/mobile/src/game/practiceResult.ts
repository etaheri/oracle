import { practiceOutcome, type Exhibition } from "@oracle/core";
import { formatFortune } from "./fortuneText";
import { lineLabel, receiptLine } from "./stakeText";

export type PracticePrediction = { answer: boolean };

// Practice runs on the practice fortune and the exhibition's line (design
// §8.3); nothing here touches the player's fortune. Reading register for the
// sentences, machine register for the receipt and the line.
export function practiceResult(prediction: PracticePrediction, exhibition: Exhibition) {
  const out = practiceOutcome(prediction, exhibition);
  const room = exhibition.crowd;
  const verdict = out.delta > 0 ? `You took the Oracle for ${formatFortune(out.delta)}.` : `The Oracle took ${formatFortune(-out.delta)}.`;
  const lost = out.oppositeDelta >= 0 ? `won ${formatFortune(out.oppositeDelta)}` : `lost ${formatFortune(-out.oppositeDelta)}`;
  const otherWay = exhibition.outcome !== "yes";
  const counterfactual = room
    ? `Had the room ${otherWay ? "agreed" : "disagreed"}, the same call would have ${lost}.`
    : `Had it gone ${otherWay ? "YES" : "NO"}, the same call would have ${lost}.`;
  // The room's result on a past hot take: the majority's side and its share.
  // A market question keeps the plain outcome.
  const agreed = exhibition.outcome === "yes";
  const roomPct = exhibition.crowdYesPct;
  const roomSidePct = roomPct === null ? null : agreed ? roomPct : 100 - roomPct;
  const roomLine = roomSidePct === null
    ? `Actual outcome: ${agreed ? "YES" : "NO"}.`
    : room
      ? `The room ${agreed ? "agreed" : "disagreed"}, ${roomSidePct}%.`
      : `The room said ${agreed ? "YES" : "NO"}, ${roomSidePct}%.`;
  return {
    ...out,
    receipt: receiptLine({ answer: prediction.answer, line: out.line, room }),
    verdict,
    counterfactual,
    roomLine,
    oracleLine: lineLabel(out.line, room)!,
  };
}
