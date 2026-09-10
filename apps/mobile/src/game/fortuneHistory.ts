import type { MeLedger } from "@oracle/core";
import { formatFortune, signedFortune } from "./fortuneText";

// The record's fortune history (design §8.3): one row per settled round,
// newest first. The route sends them oldest first with a running total.
export function fortuneHistoryLines(history: MeLedger["fortune_history"], max = 10): string[] {
  return [...history].reverse().slice(0, max).map((h) => `${h.date} · ${signedFortune(h.delta)} · ${formatFortune(h.fortune_after)}`);
}
