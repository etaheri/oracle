import { roundAvailability } from "./roundAvailability";

export type ArrivalInput = {
  loading: boolean;
  failed: boolean;
  hydrated: boolean;
  hasRound: boolean;
  openCount: number;
  missedCount: number;
  allSubmitted: boolean;
  firstVisit: boolean;
  nextOpensAt: string | null;
};

export type ArrivalState = {
  kind: "loading" | "error" | "live" | "partial" | "submitted" | "waiting";
  primary: "retry" | "live" | "crowd" | "exhibition" | null;
  label: string | null;
};

export type ArrivalQuestion = {
  id: string;
  locks_at: string;
  lock_healed?: boolean;
};

export type ArrivalRound = {
  rules_version: number;
  questions: ArrivalQuestion[];
};

export type ArrivalSnapshot = Omit<ArrivalInput, "hasRound" | "openCount" | "missedCount" | "allSubmitted">;

export function arrivalState(input: ArrivalInput): ArrivalState {
  if (input.loading) return { kind: "loading", primary: null, label: null };
  if (input.failed) return { kind: "error", primary: "retry", label: "RETRY" };
  if (!input.hydrated) return { kind: "loading", primary: null, label: null };
  if (input.hasRound && input.allSubmitted) return { kind: "submitted", primary: "crowd", label: "SEE THE CROWD" };
  if (input.openCount > 0) {
    return input.missedCount > 0
      ? { kind: "partial", primary: "live", label: "ANSWER REMAINING QUESTIONS" }
      : { kind: "live", primary: "live", label: input.firstVisit ? "MAKE YOUR FIRST CALL" : "PLAY TODAY" };
  }
  return { kind: "waiting", primary: "exhibition", label: "CHALLENGE THE ORACLE" };
}

export function arrivalInputForRound(
  round: ArrivalRound | null | undefined,
  sealedIds: ReadonlySet<string>,
  nowMs: number,
  snapshot: ArrivalSnapshot,
): ArrivalInput {
  if (!round) {
    return { ...snapshot, hasRound: false, openCount: 0, missedCount: 0, allSubmitted: false };
  }

  const availability = roundAvailability(round.questions, sealedIds, nowMs, round.rules_version);
  const required = round.questions.filter((question) => !(round.rules_version >= 2 && question.lock_healed));
  return {
    ...snapshot,
    hasRound: true,
    openCount: availability.openCount,
    missedCount: availability.missedCount,
    allSubmitted: required.length > 0 && required.every((question) => sealedIds.has(question.id)),
  };
}
