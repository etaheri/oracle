import { describe, it, expect } from "vitest";
import { planReminders, REMINDER_DAYS, REMINDER_LEAD_MS } from "../src/game/reminders";

const locksAt = "2026-08-29T16:00:00.000Z"; // today's round (2026-08-28) locks tomorrow noon ET

describe("planReminders", () => {
  it("plans one reminder per day, three hours before each lock", () => {
    const r = planReminders(locksAt, "2026-08-28", 0);
    expect(r).toHaveLength(REMINDER_DAYS);
    expect(REMINDER_LEAD_MS).toBe(3 * 3_600_000);
    expect(r[0]!.date).toBe("2026-08-28");
    expect(r[0]!.at.toISOString()).toBe("2026-08-29T13:00:00.000Z");
    expect(r[1]!.at.getTime() - r[0]!.at.getTime()).toBe(86_400_000);
  });
  it("skips today's closing call once the prophecy is fully sealed", () => {
    const r = planReminders(locksAt, "2026-08-28", 5);
    expect(r.filter((x) => x.kind === "closing")).toHaveLength(REMINDER_DAYS - 1);
    expect(r.filter((x) => x.kind === "closing")[0]!.date).toBe("2026-08-29");
  });
  it("draws deterministic machine-voice copy from the closing pool", () => {
    const a = planReminders(locksAt, "2026-08-28", 0);
    const b = planReminders(locksAt, "2026-08-28", 0);
    expect(a.map((x) => x.body)).toEqual(b.map((x) => x.body));
    for (const x of a) {
      expect(x.body).toBe(x.body.toUpperCase());
      expect(x.body).not.toContain("{"); // no unexpanded slots — the {n} players line must never be drawn
    }
  });
  it("a partial day draws a partial-aware closing line", () => {
    const r = planReminders(locksAt, "2026-08-28", 3);
    expect(r.find((x) => x.kind === "closing" && x.date === "2026-08-28")!.body).toMatch(/NON-VOID QUESTION|INCOMPLETE ROUND/);
  });
  it("schedules one noon reminder 45 minutes after lock, only once something is sealed", () => {
    const noon = planReminders(locksAt, "2026-08-28", 1).filter((x) => x.kind === "noon");
    expect(noon).toHaveLength(1);
    expect(noon[0]!.at.toISOString()).toBe("2026-08-29T16:45:00.000Z");
    expect(noon[0]!.body).toBe("RETURN TO OUTSEEN TO CHECK YOUR PREDICTIONS AND THE NEXT CHALLENGE.");
    expect(planReminders(locksAt, "2026-08-28", 0).some((x) => x.kind === "noon")).toBe(false);
  });
  it("a sealed day still gets its noon reminder and no closing call", () => {
    const r = planReminders(locksAt, "2026-08-28", 5);
    expect(r.filter((x) => x.date === "2026-08-28").map((x) => x.kind)).toEqual(["noon"]);
  });
});

describe("planReminders with a habitual hour (design 2026-09-09 §4.2)", () => {
  // Pretend the device is in UTC so localHourOf is the UTC hour.
  const utcHour = (ms: number) => new Date(ms).getUTCHours();
  const lock = "2026-09-11T16:00:00Z"; // noon ET
  it("moves each closing reminder to the habitual hour inside that round's window", () => {
    const out = planReminders(lock, "2026-09-10", 0, 5, { hour: 20, localHourOf: utcHour });
    const closing = out.filter((r) => r.kind === "closing");
    expect(closing[0]!.at.toISOString()).toBe("2026-09-10T20:00:00.000Z"); // day 0's window is 09-10 16:00Z → 09-11 15:30Z
    expect(closing[1]!.at.toISOString()).toBe("2026-09-11T20:00:00.000Z");
  });
  // Day 0's window is [lock0 − 24h, lock0 − 30min] = [2026-09-10T16:00Z, 2026-09-11T15:30Z],
  // sampled hourly from the start. That is exactly 23.5h / 1h = 24 samples,
  // one for every hour-of-day 0..23 — so every *valid* habitual hour lands
  // somewhere in the window; there is no hour value for which the window
  // arithmetic itself excludes a match. What's worth pinning down instead is
  // where in the window the boundary hours resolve to, and that a hour which
  // truly never recurs (never returned by localHourOf) still falls back.
  it("resolves the window's boundary hours to its first and last sampled instants", () => {
    // Hour 16 is the window's very first sampled instant (the start itself).
    const edge = planReminders(lock, "2026-09-10", 0, 5, { hour: 16, localHourOf: utcHour });
    expect(edge.filter((r) => r.kind === "closing")[0]!.at.toISOString()).toBe("2026-09-10T16:00:00.000Z");
    // Hour 15 is the window's last sampled instant: 2026-09-11T15:00Z, which
    // is 30 minutes before the 15:30Z cutoff — inside the window, not past it.
    const out = planReminders(lock, "2026-09-10", 0, 5, { hour: 15, localHourOf: utcHour });
    expect(out.filter((r) => r.kind === "closing")[0]!.at.toISOString()).toBe("2026-09-11T15:00:00.000Z");
  });
  it("falls back to the default lead when the habitual hour never recurs in the window", () => {
    // 99 is never returned by localHourOf, so no sampled instant can match —
    // the closing reminder must sit at the plain default lead time.
    const withHabit = planReminders(lock, "2026-09-10", 0, 5, { hour: 99, localHourOf: utcHour });
    const withoutHabit = planReminders(lock, "2026-09-10", 0);
    const a = withHabit.filter((r) => r.kind === "closing").map((r) => r.at.toISOString());
    const b = withoutHabit.filter((r) => r.kind === "closing").map((r) => r.at.toISOString());
    expect(a).toEqual(b);
  });
  it("is byte-identical to the default plan when habit is null", () => {
    expect(planReminders(lock, "2026-09-10", 2, 5, null)).toEqual(planReminders(lock, "2026-09-10", 2));
  });
  it("never moves the noon reminder", () => {
    const withHabit = planReminders(lock, "2026-09-10", 1, 5, { hour: 20, localHourOf: utcHour }).find((r) => r.kind === "noon")!;
    const without = planReminders(lock, "2026-09-10", 1).find((r) => r.kind === "noon")!;
    expect(withHabit.at.toISOString()).toBe(without.at.toISOString());
  });
});

it("never invents future settlement, deadlines, or crowd activity", () => {
  for (let day = 1; day <= 28; day++) {
    for (const count of [0, 1, 5]) {
      for (const reminder of planReminders(locksAt, `2026-08-${String(day).padStart(2, "0")}`, count)) {
        expect(reminder.body).not.toMatch(/RESULT IS READY|NOW SETTLED|OUTCOMES BELONG|CROWD HAS|CROWD IS|UNTIL NOON|HOURS REMAIN|ENDS AT/);
      }
    }
  }
});
