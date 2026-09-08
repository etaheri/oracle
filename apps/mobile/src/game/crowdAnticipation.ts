import { VERDICT_MIN_PLAYERS } from "./crowdVerdict";

type SubmittedCall = { questionId: string; answer: boolean; sealed: boolean };
type CrowdReading = { id: string; crowd_yes_pct: number; player_count: number };

export function crowdAnticipation(calls: SubmittedCall[], crowd: CrowdReading[]): string | null {
  const byId = new Map(crowd.map((reading) => [reading.id, reading]));
  let disagreements = 0;
  for (const call of calls) {
    if (!call.sealed) continue;
    const reading = byId.get(call.questionId);
    if (!reading || reading.player_count < VERDICT_MIN_PLAYERS || reading.crowd_yes_pct === 50) continue;
    const crowdCallsYes = reading.crowd_yes_pct > 50;
    if (call.answer !== crowdCallsYes) disagreements += 1;
  }
  if (disagreements === 0) return null;
  return `The crowd currently leans the other way on ${disagreements} of your calls.`;
}
