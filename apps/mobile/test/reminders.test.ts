import { describe, it, expect } from "vitest";
import { planReminders, REMINDER_DAYS, REMINDER_LEAD_MS } from "../src/game/reminders";

const locksAt = "2026-08-29T16:00:00.000Z"; // today's round (2026-08-28) locks tomorrow noon ET

describe("planReminders", () => {
  it("plans one reminder per day, three hours before each lock", () => {
    const r = planReminders(locksAt, "2026-08-28", false);
    expect(r).toHaveLength(REMINDER_DAYS);
    expect(REMINDER_LEAD_MS).toBe(3 * 3_600_000);
    expect(r[0]!.date).toBe("2026-08-28");
    expect(r[0]!.at.toISOString()).toBe("2026-08-29T13:00:00.000Z");
    expect(r[1]!.at.getTime() - r[0]!.at.getTime()).toBe(86_400_000);
  });
  it("skips today once the prophecy is sealed", () => {
    const r = planReminders(locksAt, "2026-08-28", true);
    expect(r).toHaveLength(REMINDER_DAYS - 1);
    expect(r[0]!.date).toBe("2026-08-29");
  });
  it("draws deterministic machine-voice copy from the closing pool", () => {
    const a = planReminders(locksAt, "2026-08-28", false);
    const b = planReminders(locksAt, "2026-08-28", false);
    expect(a.map((x) => x.body)).toEqual(b.map((x) => x.body));
    for (const x of a) {
      expect(x.body).toBe(x.body.toUpperCase());
      expect(x.body).not.toContain("{"); // no unexpanded slots — the {n} players line must never be drawn
    }
  });
});
