export type RoundRulesVersion = 1 | 2;
export const CURRENT_RULES_VERSION: RoundRulesVersion = 2;

/** Version 1 keeps every original question mandatory, even if voided. */
export function ratingEligible(version: number, questions: Array<{ id: string; outcome: "yes" | "no" | "void" | null }>, answeredIds: ReadonlySet<string>): boolean {
  if (!questions.length || questions.some(q => q.outcome === null)) return false;
  const required = version >= 2 ? questions.filter(q => q.outcome !== "void") : questions;
  return (version < 2 || required.length >= 3) && required.every(q => answeredIds.has(q.id));
}
