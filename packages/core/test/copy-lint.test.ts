import { describe, it, expect } from "vitest";
import { COPY_BANK, LITURGY, LITURGY_LINES, RITES_LINES, OPENING_RITES, OPENING_RITES_LINES, SCORE_GLOSS, PARTIAL_LINE, SUMMONS_LINES, PAYWALL_CTA_LINES, PUSH_CAMPAIGN_LINES, fillSlots, type CopyLine } from "../src/copy";
import { CONSTANTS } from "../src/constants";

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
    // Bound to the rite it guards, not the joined canon: "ALL FIVE" also
    // appears in the partial-day rule, so a canon-wide toContain stays green
    // with the first-hour rite deleted -- an alarm that cannot ring.
    const firstHour = RITES_LINES.find((l) => l.includes("WITHIN THE FIRST HOUR"));
    expect(firstHour, "the rite naming the first-hour bonus is missing").toBeDefined();
    expect(firstHour!).toContain("ALL FIVE");
    // Early locks are the norm now: a player who finds a card already closed
    // must have been told this could happen.
    expect(all).toContain("BEFORE NOON");
    expect(RITES_LINES.length).toBe(15);
  });
  it("name the goal, and define every noun the rest of the app leans on", () => {
    // The app said "THE DAY DOES NOT RATE", "YOUR VIGIL", "A BOUNTY" and
    // "ORACLE SCORE" across four screens and defined none of them
    // (audit 2026-09-02 §1.1). Each now has exactly one rite that does.
    const all = RITES_LINES.join(" ");
    expect(all).toContain("ORACLE SCORE");
    // A CALL is the noun the reveal, the plaque and the partial-day notice all
    // lean on. It has to be defined before it can be counted.
    expect(all).toContain("EVERY ANSWER YOU SEAL IS A CALL");
    expect(all).toContain("RATE ONLY IF ALL FIVE WERE SEALED");
    expect(all).toContain("A VIGIL IS A RUN OF UNBROKEN NOONS");
    expect(all).toContain("BOUNTY");
  });
  it("name the two floors the engine actually enforces", () => {
    // The rites used to say only "THE SHIELD MAY HOLD", so a two-day vigil
    // could be sold a rescue that settleStreak would refuse to spend; and the
    // bounty's crowd floor was never stated at all. Both are spelled out in
    // words here and enforced by constants elsewhere — these are the
    // tripwires that keep copy and engine in step.
    const all = RITES_LINES.join(" ");
    expect(CONSTANTS.SHIELD_MIN_STREAK).toBe(3);
    expect(all).toContain("THREE DAYS OR MORE");
    expect(CONSTANTS.CONTRARIAN_MIN_CROWD).toBe(20);
    expect(all).toContain("TWENTY MUST HAVE SPOKEN");
    expect(CONSTANTS.ORACLE_SCORE_MIN_CALLS).toBe(50);
    expect(all).toContain("FIFTY RATED CALLS");
    // ...and the rate that converts it, without which fifty reads as the same
    // scale as the five questions every other surface talks about. Five a day
    // is why fifty is ten days.
    expect(all).toContain("FIVE A DAY");
    // The vigil's stake, pinned to the engine that pays it. A player is told
    // the day is weighed in BOTH directions -- if that ever stops being true
    // in scoring.ts, this line becomes a lie and this assertion the alarm.
    // Bound to the ONE line that makes each claim, never to the joined canon:
    // "TEN DAYS" also appears in the Oracle Score rite and "IN BOTH DIRECTIONS"
    // in the Big One rite, so a canon-wide toContain passes even with both
    // vigil rites deleted -- an alarm that cannot ring.
    const vigilStake = RITES_LINES.find((l) => l.includes("A VIGIL IS A RUN OF UNBROKEN NOONS"));
    const vigilCeiling = RITES_LINES.find((l) => l.includes("THE VIGIL'S WEIGHT RISES"));
    expect(vigilStake, "the rite naming the vigil's stake is missing").toBeDefined();
    expect(vigilCeiling, "the rite naming the vigil's ceiling is missing").toBeDefined();
    expect(vigilStake!).toContain("IN BOTH DIRECTIONS");
    expect(CONSTANTS.VIGIL_MULT_MAX_DAYS).toBe(10);
    expect(vigilCeiling!).toContain("TEN DAYS");
  });
  it("names the first hour's stake at the rate the engine actually pays", () => {
    // The first hour is no longer a gift on winning days: dayPoints routes it
    // through weighDay, so it amplifies a lost day just as hard. The rite has
    // to say so, and it has to say the rate scoring.ts actually applies --
    // tuning FIRST_HOUR_BONUS must fail here rather than quietly leave a rite
    // promising ten percent while the engine pays something else.
    // Bound to the one rite that makes the claim, never to the joined canon:
    // "IN BOTH DIRECTIONS" also appears in the vigil and big-one rites, so a
    // canon-wide toContain stays green with this rite deleted.
    const firstHour = RITES_LINES.find((l) => l.includes("WITHIN THE FIRST HOUR"));
    expect(firstHour, "the rite naming the first-hour bonus is missing").toBeDefined();
    expect(CONSTANTS.FIRST_HOUR_BONUS).toBe(0.1);
    expect(firstHour!).toContain("TEN PERCENT");
    expect(firstHour!).toContain("IN BOTH DIRECTIONS");
    // ...and never the wins-only promise it replaced.
    expect(firstHour!).not.toContain("PAYS TEN PERCENT MORE");
  });
  it("teaches the shield before it is ever sold", () => {
    // The shield is a real-money purchase surfaced on Home and a permanent
    // plaque row. A player who reads only the opening must still meet it.
    const opening = OPENING_RITES_LINES.join(" ");
    expect(opening).toContain("SHIELD");
    expect(opening).toContain("THREE DAYS OR MORE");
    // ...and the stake the shield exists to defend.
    expect(opening).toContain("WEIGHS");
  });
  it("open with a subset of the same numbered canon, not a second copy of it", () => {
    // The two screens must never drift: the opening is literally the head of
    // RITES_LINES, so a rule's numeral means the same thing on both.
    expect(OPENING_RITES_LINES.length).toBe(OPENING_RITES);
    expect([...OPENING_RITES_LINES]).toEqual(RITES_LINES.slice(0, OPENING_RITES));
    expect(OPENING_RITES).toBeLessThan(RITES_LINES.length);
  });
  it("open on what the first card actually depends on", () => {
    const opening = OPENING_RITES_LINES.join(" ");
    for (const word of ["FIVE QUESTIONS", "PULL", "SEALED", "CROWD", "CONVICTION", "ORACLE SCORE", "ALL FIVE"]) {
      expect(opening, word).toContain(word);
    }
    // ...and defer what is only met later in play.
    // SHIELD was deferred here on 2026-09-02, when a shield defended a vigil
    // that did nothing. It is now a real-money purchase offered on Home and a
    // permanent plaque row, defending a vigil that weighs every day played --
    // the one deferred rule a player can be CHARGED for before meeting it.
    // The bounty and the first hour stay deferred: they cost nothing to miss.
    for (const word of ["FIRST HOUR", "BIG ONE"]) expect(opening, word).not.toContain(word);
  });
  it("scale every cumulative number against the daily one", () => {
    // "0 OF 50" on a screen whose every other surface says five is the honest
    // question a player actually asked. Anywhere the lifetime count appears,
    // the per-day rate appears with it.
    for (const line of [...RITES_LINES, ...Object.values(SCORE_GLOSS)]) {
      if (/FIFTY/.test(line)) expect(line, line).toMatch(/FIVE (A DAY|CALLS A DAY)/);
    }
  });
  it("partial, summons and score-gloss lines hold the register", () => {
    for (const l of [PARTIAL_LINE, ...SUMMONS_LINES, ...Object.values(SCORE_GLOSS)]) {
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

  it("the paywall states the mechanic it charges for", () => {
    // The whole pool, not just the creed: the Oracle Score clause lives in
    // paywall.terms-1, and `plus.tsx` renders creed lines while the terms line
    // is the one that has to stay true about what money cannot buy.
    const creed = COPY_BANK.filter((l) => l.pool === "paywall").map((l) => l.text).join(" ");
    expect(CONSTANTS.SHIELD_MIN_STREAK).toBe(3);
    expect(creed).toContain("THREE DAYS OR MORE");
    // What the subscription actually grants, in the player's words.
    expect(creed).toContain("THREE SHIELDS");
    // The wall that makes the whole economy honest, said at the till.
    expect(creed).toContain("ORACLE SCORE");
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
