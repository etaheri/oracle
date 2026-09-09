import { describe, expect, it } from "vitest";
import { habitualHour, withSealHour, HABIT_MIN_DAYS, HABIT_KEEP } from "../src/game/habit";

describe("habit (design 2026-09-09 §4.2)", () => {
  it("is null until enough distinct days", () => {
    expect(HABIT_MIN_DAYS).toBe(3);
    const h = [{ date: "2026-09-01", hour: 8 }, { date: "2026-09-02", hour: 9 }];
    expect(habitualHour(h)).toBeNull();
    expect(habitualHour([...h, { date: "2026-09-03", hour: 21 }])).toBe(9);
  });
  it("takes the median (even count → lower middle)", () => {
    expect(habitualHour([{ date: "a", hour: 7 }, { date: "b", hour: 8 }, { date: "c", hour: 20 }, { date: "d", hour: 21 }])).toBe(8);
  });
  it("records once per date and keeps the newest HABIT_KEEP", () => {
    let h: ReturnType<typeof withSealHour> = [];
    h = withSealHour(h, { date: "2026-09-01", hour: 8 });
    h = withSealHour(h, { date: "2026-09-01", hour: 22 }); // same day: first seal wins
    expect(h).toEqual([{ date: "2026-09-01", hour: 8 }]);
    for (let i = 2; i <= HABIT_KEEP + 3; i++) h = withSealHour(h, { date: `2026-09-${String(i).padStart(2, "0")}`, hour: 9 });
    expect(h).toHaveLength(HABIT_KEEP);
    expect(h[0]!.date).toBe("2026-09-04");
  });
});

