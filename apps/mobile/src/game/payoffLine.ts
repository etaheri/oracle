import { payoff } from "@oracle/core";

// The card's honest stake, printed under the reading: what this conviction
// earns if right and costs if wrong. A true minus sign — this is a receipt.
const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

export function payoffLine(confidence: number, isBigOne: boolean): string {
  const p = payoff(confidence, isBigOne);
  return `${signed(p.win)} IF RIGHT · ${signed(p.loss)} IF WRONG`;
}
