import { describe, it, expect } from "vitest";
import { COPY_BANK, LITURGY, LITURGY_LINES, RITES_LINES, PARTIAL_LINE, SUMMONS_LINES, PAYWALL_CTA_LINES, PUSH_CAMPAIGN_LINES, fillSlots, type CopyLine } from "../src/copy";

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
      expect(l.text.replace(/\{[a-z]+\}/g, ""), l.id).toBe(l.text.replace(/\{[a-z]+\}/g, "").toUpperCase());
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
      if (l.text.includes("{n}")) {
        if (l.pool === "closing") {
          expect(l.requires ?? [], l.id).toContain("players");
        } else {
          expect(l.requires ?? [], l.id).toContain("results");
          expect(l.requires ?? [], l.id).toContain("wrong");
        }
      }
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
    expect(count("paywall")).toBeGreaterThanOrEqual(5);
  });
  it("carries the streak-at-risk and partial-closing lines", () => {
    expect(COPY_BANK.find((l) => l.id === "streak.risk-1")?.requires).toContain("streak");
    const partial = COPY_BANK.filter((l) => (l.requires ?? []).includes("partial"));
    expect(partial.length).toBeGreaterThanOrEqual(2);
    for (const l of partial) expect(l.pool).toBe("closing");
  });
});

describe("the rites", () => {
  it("exist, and hold the register: caps, no emoji, no exclamation, no CTA verbs, push-length", () => {
    expect(RITES_LINES.length).toBeGreaterThanOrEqual(8);
    for (const l of RITES_LINES) {
      expect(l, l).toBe(l.toUpperCase());
      expect(l, l).not.toMatch(EMOJI);
      expect(l, l).not.toContain("!");
      for (const b of BANNED) expect(l, l).not.toContain(b);
      expect(l.length, l).toBeLessThanOrEqual(140);
    }
  });
  it("teach the load-bearing rules", () => {
    const all = RITES_LINES.join(" ");
    for (const word of ["SEALED", "CROWD", "BIG ONE", "TIDE", "FIRST HOUR", "SHIELD", "NOON"]) expect(all).toContain(word);
  });
  it("state the current rules: bounty not double, all five for the first hour, the city of noon, partial days, staggered locks", () => {
    const all = RITES_LINES.join(" ");
    expect(all).not.toContain("PAYS TWICE");
    expect(all).toContain("NEW YORK");
    expect(all).toContain("ALL FIVE");
    // Early locks are the norm now: a player who finds a card already closed
    // must have been told this could happen.
    expect(all).toContain("BEFORE NOON");
    expect(RITES_LINES.length).toBe(12);
  });
  it("partial and summons lines hold the register", () => {
    for (const l of [PARTIAL_LINE, ...SUMMONS_LINES]) {
      expect(l, l).toBe(l.toUpperCase());
      expect(l, l).not.toMatch(EMOJI);
      expect(l, l).not.toContain("!");
      for (const b of BANNED) expect(l, l).not.toContain(b);
      expect(l.length, l).toBeLessThanOrEqual(140);
    }
  });
});

describe("the calling", () => {
  it("is five beats in the register: caps, no emoji, no exclamation, no CTA verbs, push-length", async () => {
    const { CALLING_LINES } = await import("../src/copy");
    expect(CALLING_LINES.length).toBe(5);
    for (const l of CALLING_LINES) {
      expect(l, l).toBe(l.toUpperCase());
      expect(l, l).not.toMatch(EMOJI);
      expect(l, l).not.toContain("!");
      for (const b of BANNED) expect(l, l).not.toContain(b);
      expect(l.length, l).toBeLessThanOrEqual(140);
    }
  });
  it("tells the search, the receipts, the ledger, and ends on the player", async () => {
    const { CALLING_LINES } = await import("../src/copy");
    const all = CALLING_LINES.join(" ");
    expect(all).toContain("SEARCH");
    expect(all).toContain("RECEIPTS");
    expect(all).toContain("LEDGER");
    expect(CALLING_LINES[CALLING_LINES.length - 1]).toBe("THE SEARCH CONTINUES. IT HAS REACHED YOU.");
  });
  it("never states a rule the rites own — no scoring, no noon, no shield", async () => {
    const { CALLING_LINES } = await import("../src/copy");
    const all = CALLING_LINES.join(" ");
    for (const w of ["POINTS", "SHIELD", "NOON", "BIG ONE", "FIRST HOUR"]) expect(all).not.toContain(w);
  });
});

describe("the paywall creed (spec §5 — bank lines, quarantined CTA labels, campaign copy)", () => {
  it("every paywall-pool line in the bank holds the standard register", () => {
    const paywall = COPY_BANK.filter((l) => l.pool === "paywall");
    expect(paywall.length).toBeGreaterThanOrEqual(5);
    for (const l of paywall) {
      expect(l.text.replace(/\{[a-z]+\}/g, ""), l.id).toBe(l.text.replace(/\{[a-z]+\}/g, "").toUpperCase());
      expect(l.text, l.id).not.toMatch(EMOJI);
      expect(l.text, l.id).not.toContain("!");
      for (const b of BANNED) expect(l.text, l.id).not.toContain(b);
      expect(worst(l).length, l.id).toBeLessThanOrEqual(140);
      if (l.text.includes("{streak}")) expect(l.requires ?? [], l.id).toContain("streak");
      expect(worst(l), l.id).not.toMatch(/[{}]/);
    }
  });

  it("CTA labels are quarantined: caps, no emoji, no exclamation, short enough for a button", () => {
    const labels = Object.values(PAYWALL_CTA_LINES);
    expect(labels.length).toBeGreaterThanOrEqual(3);
    for (const l of labels) {
      expect(l, l).toBe(l.toUpperCase());
      expect(l, l).not.toMatch(EMOJI);
      expect(l, l).not.toContain("!");
      expect(l.length, l).toBeLessThanOrEqual(32);
    }
  });

  it("push-campaign copy holds the standard bank register at push length", () => {
    const lines = Object.values(PUSH_CAMPAIGN_LINES);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const l of lines) {
      expect(l, l).toBe(l.toUpperCase());
      expect(l, l).not.toMatch(EMOJI);
      expect(l, l).not.toContain("!");
      for (const b of BANNED) expect(l, l).not.toContain(b);
      expect(l.length, l).toBeLessThanOrEqual(140);
    }
  });
});
