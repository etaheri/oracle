import { describe, it, expect } from "vitest";
import { COPY_BANK, LITURGY, LITURGY_LINES, fillSlots, type CopyLine } from "../src/copy";

const BANNED = ["CHECK", "TAP", "CLICK", "VISIT", "RESULTS", "DON'T MISS"];
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const worst = (l: CopyLine) => fillSlots(l.text, { n: 99, streak: 999 });

describe("the liturgy", () => {
  it("is frozen, verbatim", () => {
    expect(LITURGY).toBe("EVERY ANSWER SEALED BEFORE THE OUTCOME. EVERY SCORE READ AGAINST THE CROWD. NOTHING REVISED.");
    expect(LITURGY_LINES.join(" ")).toBe(LITURGY);
  });
});

describe("copy lint (spec §2/§3 — every line, every rule)", () => {
  it("bank is at least 60 lines with unique ids matching their pool", () => {
    expect(COPY_BANK.length).toBeGreaterThanOrEqual(60);
    const ids = COPY_BANK.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of COPY_BANK) expect(l.id.startsWith(`${l.pool}.`)).toBe(true);
  });
  it("register: mono caps, no emoji, no exclamation, no CTA verbs", () => {
    for (const l of COPY_BANK) {
      expect(l.text, l.id).toBe(l.text.toUpperCase());
      expect(l.text, l.id).not.toMatch(EMOJI);
      expect(l.text, l.id).not.toContain("!");
      for (const b of BANNED) expect(l.text, l.id).not.toContain(b);
    }
  });
  it("fits a push after worst-case slot expansion", () => {
    for (const l of COPY_BANK) expect(worst(l).length, l.id).toBeLessThanOrEqual(140);
  });
  it("every slot is backed by a requirement, and expansion clears all slots", () => {
    for (const l of COPY_BANK) {
      if (l.text.includes("{n}")) expect(l.requires ?? [], l.id).toContain(l.pool === "closing" ? "players" : "results");
      if (l.text.includes("{streak}")) expect(l.requires ?? [], l.id).toContain("streak");
      expect(worst(l), l.id).not.toMatch(/[{}]/);
    }
  });
  it("curiosity gap: no noon line carries a score", () => {
    for (const l of COPY_BANK.filter((x) => x.pool === "noon")) {
      expect(l.text, l.id).not.toContain("POINTS");
      expect(l.text, l.id).not.toContain("SCORE");
      expect(worst(l), l.id).not.toMatch(/[+-]\d/);
    }
  });
  it("has the spec'd pool shape", () => {
    const count = (p: string) => COPY_BANK.filter((l) => l.pool === p).length;
    expect(count("noon")).toBeGreaterThanOrEqual(25);
    expect(count("closing")).toBeGreaterThanOrEqual(20);
    expect(count("streak")).toBeGreaterThanOrEqual(10);
    expect(count("system")).toBeGreaterThanOrEqual(5);
  });
});
