export type MilestoneId = "first_round" | "first_result" | "first_oracle_win" | "three_rounds" | "seven_rounds";
export const MILESTONE_COPY: Record<MilestoneId, string> = {
  // Two different moments — sealing a round, and that round being read a
  // day later — and they used to share six of seven words, so the plaque
  // stacked them and they looked like one line rendered twice.
  first_round: "YOUR FIRST CALLS ARE SEALED",
  first_result: "YOUR FIRST ROUND IS READ",
  first_oracle_win: "YOUR FIRST VICTORY OVER THE ORACLE",
  three_rounds: "THREE ROUNDS. A RECORD TAKES SHAPE.",
  seven_rounds: "SEVEN ROUNDS. YOUR RECORD ENDURES.",
};
export function earnedMilestones(facts: { completedRounds: number; resolvedCompletedRounds: number; oracleWins: number }): MilestoneId[] {
  const earned: MilestoneId[] = [];
  if (facts.completedRounds >= 1) earned.push("first_round");
  if (facts.resolvedCompletedRounds >= 1) earned.push("first_result");
  if (facts.oracleWins >= 1) earned.push("first_oracle_win");
  if (facts.completedRounds >= 3) earned.push("three_rounds");
  if (facts.completedRounds >= 7) earned.push("seven_rounds");
  return earned;
}
