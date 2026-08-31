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
    expect(r.find((x) => x.kind === "closing" && x.date === "2026-08-28")!.body).toMatch(/ALL FIVE|WHOLE DAYS/);
  });
  it("schedules one noon reminder 45 minutes after lock, only once something is sealed", () => {
    const noon = planReminders(locksAt, "2026-08-28", 1).filter((x) => x.kind === "noon");
    expect(noon).toHaveLength(1);
    expect(noon[0]!.at.toISOString()).toBe("2026-08-29T16:45:00.000Z");
    expect(noon[0]!.body).toBe("NOON HAS PASSED. THE OUTCOMES BELONG TO THE LEDGER NOW.");
    expect(planReminders(locksAt, "2026-08-28", 0).some((x) => x.kind === "noon")).toBe(false);
  });
  it("a sealed day still gets its noon reminder and no closing call", () => {
    const r = planReminders(locksAt, "2026-08-28", 5);
    expect(r.filter((x) => x.date === "2026-08-28").map((x) => x.kind)).toEqual(["noon"]);
  });
});
