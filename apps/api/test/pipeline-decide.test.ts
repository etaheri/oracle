import { describe, expect, it } from "vitest";
import { decideActions, loadPipelineState, type PipelineState } from "../src/pipeline/state";
import { makeTestDb, seedRound } from "./helpers/db";

const empty: PipelineState = { openRound: null, lockedRound: null, scheduledDates: [] };
const at = (hour: number, minute = 0) => ({ date: "2026-08-27", hour, minute });

describe("decideActions", () => {
  it("does nothing on a quiet mid-morning tick", () => {
    expect(decideActions(at(9), { ...empty, openRound: { date: "2026-08-26", lockPassed: false } })).toEqual([]);
  });
  it("locks a round past its lock time", () => {
    const acts = decideActions(at(12), { ...empty, openRound: { date: "2026-08-26", lockPassed: true } });
    expect(acts[0]).toEqual({ kind: "lock", date: "2026-08-26" });
  });
  it("locks then publishes in one noon tick", () => {
    const acts = decideActions(at(12), { openRound: { date: "2026-08-26", lockPassed: true }, lockedRound: null, scheduledDates: ["2026-08-27"] });
    expect(acts.map((a) => a.kind)).toEqual(["lock", "publish"]);
  });
  it("never publishes while another round is open and not yet lockable", () => {
    const acts = decideActions(at(12), { openRound: { date: "2026-08-26", lockPassed: false }, lockedRound: null, scheduledDates: ["2026-08-27"] });
    expect(acts.some((a) => a.kind === "publish")).toBe(false);
  });
  it("does not publish before noon", () => {
    expect(decideActions(at(11, 50), { ...empty, scheduledDates: ["2026-08-27"] })).toEqual([]);
  });
  it("resolves unresolved questions before 13:00 and voids after", () => {
    const st: PipelineState = { ...empty, lockedRound: { date: "2026-08-26", unresolvedIds: ["a", "b"] } };
    expect(decideActions(at(12, 20), st)).toEqual([{ kind: "resolve", date: "2026-08-26", questionIds: ["a", "b"] }]);
    expect(decideActions(at(13, 0), st)).toEqual([{ kind: "void", date: "2026-08-26", questionIds: ["a", "b"] }]);
  });
  it("settles once nothing is unresolved", () => {
    expect(decideActions(at(12, 30), { ...empty, lockedRound: { date: "2026-08-26", unresolvedIds: [] } }))
      .toEqual([{ kind: "settle", date: "2026-08-26" }]);
  });
  it("authors tomorrow from 17:00, only on minute<10 ticks", () => {
    expect(decideActions(at(17, 0), empty)).toEqual([{ kind: "author", date: "2026-08-28" }]);
    expect(decideActions(at(17, 30), empty)).toEqual([]);
    expect(decideActions(at(16, 0), empty)).toEqual([]);
  });
  it("skips author when tomorrow is drafted", () => {
    expect(decideActions(at(18, 0), { ...empty, scheduledDates: ["2026-08-28"] })).toEqual([]);
  });
  it("criticals at 23:00 with no draft", () => {
    const acts = decideActions(at(23, 0), empty);
    expect(acts.some((a) => a.kind === "alert" && a.level === "critical" && a.message.includes("2026-08-28"))).toBe(true);
  });
  it("criticals at 12:10 with nothing published or publishable", () => {
    const acts = decideActions(at(12, 10), empty);
    expect(acts.some((a) => a.kind === "alert" && a.level === "critical")).toBe(true);
    expect(decideActions(at(12, 10), { ...empty, openRound: { date: "2026-08-27", lockPassed: false } })).toEqual([]);
  });
  it("criticals at 13:30 with a still-unsettled round", () => {
    const acts = decideActions(at(13, 30), { ...empty, lockedRound: { date: "2026-08-26", unresolvedIds: [] } });
    expect(acts.filter((a) => a.kind === "alert").length).toBe(1);
  });
});

describe("loadPipelineState", () => {
  it("classifies open/locked/scheduled rounds and unresolved questions", async () => {
    const { db } = await makeTestDb();
    await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });
    const st = await loadPipelineState(db, new Date("2026-08-27T16:05:00Z"));
    expect(st.openRound).toEqual({ date: "2026-08-26", lockPassed: true });
    const st2 = await loadPipelineState(db, new Date("2026-08-27T15:00:00Z"));
    expect(st2.openRound).toEqual({ date: "2026-08-26", lockPassed: false });
  });
});
