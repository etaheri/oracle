import { describe, it, expect } from "vitest";
import { epigraphFor, EPIGRAPHS, EASTER_EGG } from "../src/game/epigraph";

describe("epigraphFor", () => {
  it("is deterministic for a given date", () => {
    expect(epigraphFor("2026-08-26")).toEqual(epigraphFor("2026-08-26"));
  });

  it("always returns an entry from the canon or the easter egg", () => {
    for (let d = 1; d <= 28; d++) {
      const e = epigraphFor(`2026-09-${String(d).padStart(2, "0")}`);
      expect([...EPIGRAPHS, EASTER_EGG]).toContainEqual(e);
    }
  });

  it("rotates across consecutive days rather than repeating", () => {
    const a = epigraphFor("2026-09-01");
    const b = epigraphFor("2026-09-02");
    const c = epigraphFor("2026-09-03");
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(c);
  });

  it("surfaces the easter egg rarely but reachably", () => {
    let eggs = 0;
    const start = Date.parse("2026-01-01T00:00:00Z");
    for (let i = 0; i < 365; i++) {
      const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      if (epigraphFor(date) === EASTER_EGG) eggs++;
    }
    expect(eggs).toBeGreaterThan(0); // it does appear
    expect(eggs).toBeLessThan(37); // ~1 in 10 days at most
  });

  it("every canon entry has text and a source", () => {
    expect(EPIGRAPHS.length).toBeGreaterThanOrEqual(10);
    for (const e of [...EPIGRAPHS, EASTER_EGG]) {
      expect(e.text.length).toBeGreaterThan(0);
      expect(e.source.length).toBeGreaterThan(0);
    }
  });
});
