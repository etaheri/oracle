// The share pattern: Wordle's feed-readable artifact, in Roman numerals.
// win ✓ · loss ✗ · void ∅ · unanswered ·
import { SHARE_URL } from "../config/links";

export type QuestionResult = "win" | "loss" | "void" | "none";

export const RESULT_MARKS: Record<QuestionResult, string> = { win: "✓", loss: "✗", void: "∅", none: "·" };
const NUMERALS = ["I", "II", "III", "IV", "V"];

export function patternLine(results: ReadonlyArray<QuestionResult>): string {
  return results.map((r, i) => `${NUMERALS[i] ?? String(i + 1)}${RESULT_MARKS[r]}`).join(" ");
}

export function shareMessage(
  d: { date: string; dayPoints: number; results: ReadonlyArray<QuestionResult> },
  url: string | null = SHARE_URL,
): string {
  const points = d.dayPoints >= 0 ? `+${d.dayPoints}` : String(d.dayPoints);
  const body = `🔮 ORACLE ${d.date} — ${patternLine(d.results)} · ${points} · can you outsee me?`;
  return url ? `${body} ${url}` : body;
}
