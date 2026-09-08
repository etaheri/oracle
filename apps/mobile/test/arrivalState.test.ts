import { describe, expect, it } from "vitest";
import { arrivalInputForRound, arrivalState, type ArrivalInput, type ArrivalRound } from "../src/game/arrivalState";

const ready: ArrivalInput = {
  loading: false,
  failed: false,
  hydrated: true,
  hasRound: true,
  openCount: 5,
  missedCount: 0,
  allSubmitted: false,
  firstVisit: true,
  nextOpensAt: null,
};

describe("arrivalState", () => {
  it("keeps first and returning live invitations distinct", () => {
    expect(arrivalState(ready)).toMatchObject({ kind: "live", primary: "live", label: "MAKE YOUR FIRST CALL" });
    expect(arrivalState({ ...ready, firstVisit: false }).label).toBe("PLAY TODAY");
  });

  it("never offers live play when no questions remain open", () => {
    expect(arrivalState({ ...ready, openCount: 0 })).toMatchObject({ kind: "waiting", primary: "exhibition", label: "CHALLENGE THE ORACLE" });
  });

  it("keeps loading, hydration, and failure truthful", () => {
    expect(arrivalState({ ...ready, loading: true })).toMatchObject({ kind: "loading", primary: null, label: null });
    expect(arrivalState({ ...ready, hydrated: false })).toMatchObject({ kind: "loading", primary: null, label: null });
    expect(arrivalState({ ...ready, failed: true })).toMatchObject({ kind: "error", primary: "retry", label: "RETRY" });
    expect(arrivalState({ ...ready, failed: true, hydrated: false })).toMatchObject({ kind: "error", primary: "retry", label: "RETRY" });
  });

  it("leads with remaining questions after a player misses earlier locks", () => {
    expect(arrivalState({ ...ready, openCount: 2, missedCount: 3 })).toMatchObject({
      kind: "partial",
      primary: "live",
      label: "ANSWER REMAINING QUESTIONS",
    });
  });

  it("shows the crowd only after every required question is submitted", () => {
    expect(arrivalState({ ...ready, openCount: 0, allSubmitted: true })).toMatchObject({
      kind: "submitted",
      primary: "crowd",
      label: "SEE THE CROWD",
    });
  });
});

describe("arrivalInputForRound", () => {
  const round: ArrivalRound = {
    rules_version: 2,
    questions: [
      { id: "sealed", locks_at: "2026-09-08T15:00:00Z", lock_healed: false },
      { id: "void", locks_at: "2026-09-08T14:00:00Z", lock_healed: true },
      { id: "missed", locks_at: "2026-09-08T14:00:00Z", lock_healed: false },
      { id: "open", locks_at: "2026-09-08T16:00:00Z", lock_healed: false },
    ],
  };

  it("distinguishes healed voids from unanswered missed questions", () => {
    expect(arrivalInputForRound(round, new Set(["sealed"]), Date.parse("2026-09-08T15:30:00Z"), {
      loading: false, failed: false, hydrated: true, firstVisit: false, nextOpensAt: null,
    })).toMatchObject({ openCount: 1, missedCount: 1, allSubmitted: false });
  });

  it("requires non-empty question data before declaring all submitted", () => {
    const flags = { loading: false, failed: false, hydrated: true, firstVisit: false, nextOpensAt: null };
    expect(arrivalInputForRound({ rules_version: 2, questions: [] }, new Set(), Date.now(), flags).allSubmitted).toBe(false);
    expect(arrivalInputForRound(null, new Set(), Date.now(), flags)).toMatchObject({ hasRound: false, allSubmitted: false });
  });

  it("treats every non-void sealed question as submitted", () => {
    const snapshot = arrivalInputForRound(round, new Set(["sealed", "missed", "open"]), Date.parse("2026-09-08T15:30:00Z"), {
      loading: false, failed: false, hydrated: true, firstVisit: false, nextOpensAt: null,
    });
    expect(snapshot).toMatchObject({ openCount: 0, missedCount: 0, allSubmitted: true });
  });
});
