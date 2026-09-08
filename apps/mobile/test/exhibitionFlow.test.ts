import { describe, expect, it } from "vitest";
import type { Exhibition } from "@oracle/core";
import {
  beginExhibition,
  chooseExhibition,
  createDepartureGuard,
  exhibitionExit,
  revealExhibition,
  retryExhibition,
  sealExhibition,
} from "../src/game/exhibitionFlow";

const historical: Exhibition = {
  id: "historical-2026-09-01-1",
  kind: "historical",
  question: "Did the measure pass?",
  context: "The vote was scheduled after this question closed.",
  sourceName: "Public record",
  roundDate: "2026-09-01",
  oraclePYes: 0.65,
  outcome: "yes",
};

const replacement: Exhibition = {
  ...historical,
  id: "historical-2026-09-02-1",
  oraclePYes: 0.2,
  outcome: "no",
};

describe("exhibition flow", () => {
  it("does not reveal before a prediction is sealed", () => {
    const flow = beginExhibition(historical);

    expect(revealExhibition(flow)).toEqual({ flow, completedNow: false });
  });

  it("freezes the displayed example when a fresh response arrives", () => {
    expect(chooseExhibition(historical, replacement)).toBe(historical);
    expect(chooseExhibition(null, replacement)).toBe(replacement);
    expect(chooseExhibition(replacement, historical)).toBe(replacement);
  });

  it("retries the same Oracle forecast and outcome", () => {
    const revealed = revealExhibition(sealExhibition(beginExhibition(historical), { answer: true, confidence: 70 })).flow;
    const retried = retryExhibition(revealed);

    expect(retried).toMatchObject({ phase: "choosing", exhibition: historical, prediction: null });
  });

  it("records completion only on the first reveal in a route session", () => {
    const sealed = sealExhibition(beginExhibition(historical), { answer: true, confidence: 70 });
    const first = revealExhibition(sealed);
    const secondAttempt = sealExhibition(retryExhibition(first.flow), { answer: false, confidence: 55 });
    const second = revealExhibition(secondAttempt);

    expect(first.completedNow).toBe(true);
    expect(second.completedNow).toBe(false);
  });

  it("returns home when the live round has closed", () => {
    expect(exhibitionExit({ kind: "waiting", primary: "exhibition", label: "CHALLENGE THE ORACLE" })).toEqual({
      label: "RETURN HOME",
      pathname: "/",
    });
  });

  it("enters only a currently available live round", () => {
    expect(exhibitionExit({ kind: "live", primary: "live", label: "PLAY TODAY" })).toEqual({ label: "PLAY TODAY", pathname: "/round" });
    expect(exhibitionExit({ kind: "partial", primary: "live", label: "ANSWER REMAINING QUESTIONS" })).toEqual({
      label: "ANSWER REMAINING QUESTIONS",
      pathname: "/round",
    });
    expect(exhibitionExit({ kind: "error", primary: "retry", label: "RETRY" })).toEqual({ label: "RETURN HOME", pathname: "/" });
  });

  it("cancels a pending navigation callback when another departure wins", () => {
    const guard = createDepartureGuard();
    const pending = guard.begin();

    guard.invalidate();

    expect(guard.owns(pending)).toBe(false);
    const next = guard.begin();
    expect(guard.owns(next)).toBe(true);
    expect(guard.owns(pending)).toBe(false);
  });
});
