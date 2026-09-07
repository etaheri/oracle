// The share pattern: Wordle's feed-readable artifact, in Roman numerals.
// win ✓ · loss ✗ · void ∅ · unanswered ·
import { SHARE_URL } from "../config/links";
import { numeral } from "./numerals";

export type QuestionResult = "win" | "loss" | "void" | "none";

export const RESULT_MARKS: Record<QuestionResult, string> = { win: "✓", loss: "✗", void: "∅", none: "·" };

// The shared numerals, not a private five: a day is five calls, but the app
// only has one alphabet and a second copy of it is a thing that drifts.
export function patternLine(results: ReadonlyArray<QuestionResult>): string {
  return results.map((r, i) => `${numeral(i + 1)}${RESULT_MARKS[r]}`).join(" ");
}

export function shareMessage(
  d: { date: string; dayPoints: number; results: ReadonlyArray<QuestionResult>; duelText?: string },
  url: string | null = SHARE_URL,
): string {
  const points = d.dayPoints >= 0 ? `+${d.dayPoints}` : String(d.dayPoints);
  const body = `🔮 ORACLE ${d.date} — ${patternLine(d.results)} · ${points}${d.duelText ? ` · ${d.duelText}` : ""} · can you outsee me?`;
  return url ? `${body} ${url}` : body;
}
