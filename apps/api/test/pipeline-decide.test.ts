import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { decideActions, loadPipelineState, type PipelineState } from "../src/pipeline/state";
import { makeTestDb, seedRound } from "./helpers/db";
import * as schema from "../src/db/schema";
import type { ETNow } from "../src/pipeline/clock";

const empty: PipelineState = { openRound: null, lockedRound: null, scheduledDates: [], bankCount: 0, claudeAvailable: true };
const at = (hour: number, minute = 0) => ({ date: "2026-08-27", hour, minute });

describe("decideActions", () => {
  it("does nothing on a quiet mid-morning tick", () => {
    expect(decideActions(at(9), { ...empty, openRound: { date: "2026-08-26", lockPassed: false, needsForecast: false } })).toEqual([]);
  });
  it("locks a round past its lock time", () => {
    const acts = decideActions(at(12), { ...empty, openRound: { date: "2026-08-26", lockPassed: true, needsForecast: false } });
    expect(acts[0]).toEqual({ kind: "lock", date: "2026-08-26" });
  });
  it("locks then publishes in one noon tick, forecasting today right after", () => {
    const acts = decideActions(at(12), { openRound: { date: "2026-08-26", lockPassed: true, needsForecast: false }, lockedRound: null, scheduledDates: ["2026-08-27"], bankCount: 0, claudeAvailable: true });
    expect(acts.map((a) => a.kind)).toEqual(["lock", "publish", "forecast"]);
  });
  it("never publishes while another round is open and not yet lockable", () => {
    const acts = decideActions(at(12), { openRound: { date: "2026-08-26", lockPassed: false, needsForecast: false }, lockedRound: null, scheduledDates: ["2026-08-27"], bankCount: 0, claudeAvailable: true });
    expect(acts.some((a) => a.kind === "publish")).toBe(false);
  });
  it("does not publish before noon", () => {
    expect(decideActions(at(11, 50), { ...empty, scheduledDates: ["2026-08-27"] })).toEqual([]);
  });
  it("retries resolution every tick in the noon hour, hourly after, and voids at noon the next day", () => {
    const st: PipelineState = { ...empty, lockedRound: { date: "2026-08-26", unresolvedIds: ["a", "b"] } };
    const resolve = { kind: "resolve", date: "2026-08-26", questionIds: ["a", "b"] };
    expect(decideActions(at(12, 20), st)).toEqual([resolve]);          // noon hour: every tick
    expect(decideActions(at(13, 0), st)).toEqual([resolve]);           // hourly at :00
    expect(decideActions(at(13, 20), st)).toEqual([]);                 // throttled
    expect(decideActions(at(15, 5), st)).toEqual([resolve]);
    expect(decideActions({ date: "2026-08-28", hour: 11, minute: 50 }, st)).toEqual([]);
    expect(decideActions({ date: "2026-08-28", hour: 12, minute: 0 }, st)).toEqual([{ kind: "void", date: "2026-08-26", questionIds: ["a", "b"] }]);
  });
  it("warns (not criticals) hourly while a round is unresolved past the noon hour", () => {
    const acts = decideActions(at(13, 30), { ...empty, lockedRound: { date: "2026-08-26", unresolvedIds: ["a"] } });
    expect(acts.filter((a) => a.kind === "alert")).toEqual([expect.objectContaining({ level: "warn" })]);
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
    expect(decideActions(at(12, 10), { ...empty, openRound: { date: "2026-08-27", lockPassed: false, needsForecast: false } })).toEqual([]);
  });
  it("no alert at 13:30 once a locked round has nothing left unresolved (settles instead)", () => {
    const acts = decideActions(at(13, 30), { ...empty, lockedRound: { date: "2026-08-26", unresolvedIds: [] } });
    expect(acts.filter((a) => a.kind === "alert")).toEqual([]);
    expect(acts).toContainEqual({ kind: "settle", date: "2026-08-26" });
  });
  it("falls through to the bank at noon when nothing is scheduled for today", () => {
    expect(decideActions(at(12), { ...empty, bankCount: 2 })).toEqual([
      { kind: "publish-bank", date: "2026-08-27" },
      { kind: "forecast", date: "2026-08-27" },
    ]);
    expect(decideActions(at(12), { ...empty, bankCount: 2, scheduledDates: ["2026-08-27"] }).map((a) => a.kind)).toEqual(["publish", "forecast"]);
    expect(decideActions(at(12), { ...empty, bankCount: 2, openRound: { date: "2026-08-27", lockPassed: false, needsForecast: false } })).toEqual([]);
    expect(decideActions(at(11, 50), { ...empty, bankCount: 2 })).toEqual([]);
  });
  it("never falls through to the bank when today already has a locked round (all-five-early-locks tail)", () => {
    const acts = decideActions(at(12), {
      ...empty,
      lockedRound: { date: "2026-08-27", unresolvedIds: ["a"] },
      bankCount: 2,
    });
    expect(acts.some((a) => a.kind === "publish-bank")).toBe(false);
  });

  it("the 12:10 critical only fires with an empty bank; 23:00 downgrades to warn with a bank", () => {
    expect(decideActions(at(12, 10), { ...empty, bankCount: 1 }).some((a) => a.kind === "alert")).toBe(false);
    const warn = decideActions(at(23, 0), { ...empty, bankCount: 3 }).find((a) => a.kind === "alert");
    expect(warn).toMatchObject({ level: "warn" });
    expect((warn as { message: string }).message).toContain("3 left");
  });
});

describe("loadPipelineState", () => {
  it("classifies open/locked/scheduled rounds and unresolved questions", async () => {
    const { db } = await makeTestDb();
    await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });
    const st = await loadPipelineState(db, new Date("2026-08-27T16:05:00Z"), true);
    expect(st.openRound).toEqual({ date: "2026-08-26", lockPassed: true, needsForecast: true });
    expect(st.claudeAvailable).toBe(true);
    const st2 = await loadPipelineState(db, new Date("2026-08-27T15:00:00Z"), false);
    expect(st2.openRound).toEqual({ date: "2026-08-26", lockPassed: false, needsForecast: true });
    expect(st2.claudeAvailable).toBe(false);
  });

  it("picks the oldest locked round when more than one is locked", async () => {
    const { db } = await makeTestDb();
    await seedRound(db, { date: "2026-08-25", opensAt: new Date("2026-08-25T16:00:00Z"), locksAt: new Date("2026-08-26T16:00:00Z") });
    await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });
    // Both rounds ended up locked (an anomaly the pipeline should still
    // recover from cleanly, oldest first).
    await db.update(schema.rounds).set({ status: "locked" }).where(eq(schema.rounds.date, "2026-08-25"));
    await db.update(schema.rounds).set({ status: "locked" }).where(eq(schema.rounds.date, "2026-08-26"));
    await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.roundDate, "2026-08-25"));
    await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.roundDate, "2026-08-26"));

    const st = await loadPipelineState(db, new Date("2026-08-27T16:05:00Z"), true);
    expect(st.lockedRound?.date).toBe("2026-08-25");
  });
});

describe("the forecast action", () => {
  const openNeeding = {
    openRound: { date: "2026-09-03", lockPassed: false, needsForecast: true },
    lockedRound: null, scheduledDates: [], bankCount: 5, claudeAvailable: true,
  };
  it("is decided while the open round has unforecast questions", () => {
    const actions = decideActions(
      { date: "2026-09-03", hour: 13, minute: 5 } as ETNow, openNeeding,
    );
    expect(actions).toContainEqual({ kind: "forecast", date: "2026-09-03" });
  });
  it("is throttled to once an hour, like authoring", () => {
    const actions = decideActions(
      { date: "2026-09-03", hour: 13, minute: 35 } as ETNow, openNeeding,
    );
    expect(actions.find((a) => a.kind === "forecast")).toBeUndefined();
  });
  it("stops once every question carries a forecast", () => {
    const actions = decideActions(
      { date: "2026-09-03", hour: 13, minute: 5 } as ETNow,
      { ...openNeeding, openRound: { ...openNeeding.openRound, needsForecast: false } },
    );
    expect(actions.find((a) => a.kind === "forecast")).toBeUndefined();
  });
  it("is never decided for a round that has already passed its lock", () => {
    // Past lock the answers exist; a forecast then would be a look-up.
    const actions = decideActions(
      { date: "2026-09-03", hour: 13, minute: 5 } as ETNow,
      { ...openNeeding, openRound: { ...openNeeding.openRound, lockPassed: true } },
    );
    expect(actions.find((a) => a.kind === "forecast")).toBeUndefined();
  });
  it("is never decided with no Claude client — it would only throw", () => {
    const actions = decideActions(
      { date: "2026-09-03", hour: 13, minute: 5 } as ETNow,
      { ...openNeeding, claudeAvailable: false },
    );
    expect(actions.find((a) => a.kind === "forecast")).toBeUndefined();
  });
  it("warns once daily, in the 23:00 window, when the round still needs a forecast and there is no Claude client", () => {
    const blocked = { ...openNeeding, claudeAvailable: false };
    const midday = decideActions({ date: "2026-09-03", hour: 13, minute: 5 } as ETNow, blocked);
    expect(midday.some((a) => a.kind === "alert")).toBe(false);
    const nightly = decideActions({ date: "2026-09-03", hour: 23, minute: 5 } as ETNow, blocked);
    expect(nightly).toContainEqual({
      kind: "alert",
      level: "warn",
      message: "the Oracle cannot take its position on 2026-09-03 — no Claude client configured",
    });
    // Throttled: outside the 23:00 window on minute<10, nothing.
    const laterSameHour = decideActions({ date: "2026-09-03", hour: 23, minute: 35 } as ETNow, blocked);
    expect(laterSameHour.some((a) => a.kind === "alert" && a.message.includes("Claude client"))).toBe(false);
    // Never fires once claude is available again.
    const recovered = decideActions({ date: "2026-09-03", hour: 23, minute: 5 } as ETNow, openNeeding);
    expect(recovered.some((a) => a.kind === "alert" && a.message.includes("Claude client"))).toBe(false);
  });

  // 2026-09-03 review: the Oracle must commit in the SAME tick that opens the
  // round -- ahead of every player -- not an hour later on the minute<10
  // catch-up throttle.
  describe("same-tick commitment (spec §2.1: the Oracle answers first)", () => {
    const noon = { date: "2026-09-03", hour: 12, minute: 0 } as ETNow;

    it("decides forecast for today right after publish, with no open round yet", () => {
      const acts = decideActions(noon, { openRound: null, lockedRound: null, scheduledDates: ["2026-09-03"], bankCount: 0, claudeAvailable: true });
      expect(acts).toEqual([
        { kind: "publish", date: "2026-09-03" },
        { kind: "forecast", date: "2026-09-03" },
      ]);
    });

    it("decides forecast for today right after publish-bank", () => {
      const acts = decideActions(noon, { openRound: null, lockedRound: null, scheduledDates: [], bankCount: 3, claudeAvailable: true });
      expect(acts).toEqual([
        { kind: "publish-bank", date: "2026-09-03" },
        { kind: "forecast", date: "2026-09-03" },
      ]);
    });

    it("still catches up on an already-open round that needs a forecast (same-tick attempt not applicable)", () => {
      const acts = decideActions(
        { date: "2026-09-03", hour: 13, minute: 5 } as ETNow,
        { openRound: { date: "2026-09-03", lockPassed: false, needsForecast: true }, lockedRound: null, scheduledDates: [], bankCount: 0, claudeAvailable: true },
      );
      expect(acts).toEqual([{ kind: "forecast", date: "2026-09-03" }]);
    });

    it("decides neither publish's nor publish-bank's forecast when claudeAvailable is false", () => {
      const published = decideActions(noon, { openRound: null, lockedRound: null, scheduledDates: ["2026-09-03"], bankCount: 0, claudeAvailable: false });
      expect(published).toEqual([{ kind: "publish", date: "2026-09-03" }]);
      const banked = decideActions(noon, { openRound: null, lockedRound: null, scheduledDates: [], bankCount: 3, claudeAvailable: false });
      expect(banked).toEqual([{ kind: "publish-bank", date: "2026-09-03" }]);
    });
  });
});
