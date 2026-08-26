// The share pattern: Wordle's feed-readable artifact, in Roman numerals.
// win ✓ · loss ✗ · void ∅ · unanswered ·
export type QuestionResult = "win" | "loss" | "void" | "none";

export const RESULT_MARKS: Record<QuestionResult, string> = { win: "✓", loss: "✗", void: "∅", none: "·" };
const NUMERALS = ["I", "II", "III", "IV", "V"];

export function patternLine(results: ReadonlyArray<QuestionResult>): string {
  return results.map((r, i) => `${NUMERALS[i] ?? String(i + 1)}${RESULT_MARKS[r]}`).join(" ");
}

export function shareMessage(d: { date: string; dayPoints: number; results: ReadonlyArray<QuestionResult> }): string {
  const points = d.dayPoints >= 0 ? `+${d.dayPoints}` : String(d.dayPoints);
  return `🔮 ORACLE ${d.date} — ${patternLine(d.results)} · ${points} · can you outsee me?`;
}
