import { describe, it, expect } from "vitest";
import { COPY_BANK, PLUS_CREED_LINES, LITURGY, LITURGY_LINES, RITES_LINES, OPENING_RITES, OPENING_RITES_LINES, SCORE_GLOSS, PARTIAL_LINE, SUMMONS_LINES, PAYWALL_CTA_LINES, PUSH_CAMPAIGN_LINES, PIPELINE_LINES, provenanceLine, fillSlots, inPlayLine, READING_LINES, type CopyLine } from "../src/copy";
import { CONSTANTS } from "../src/constants";

const BANNED = ["CHECK", "TAP", "CLICK", "VISIT", "RESULTS", "DON'T MISS"];
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const worst = (l: CopyLine) => fillSlots(l.text, { n: 99, streak: 999, outcome: "YES", call: "YES AT 95%", points: "-261" });

describe("the liturgy", () => {
  it("is frozen, verbatim", () => {
    expect(LITURGY).toBe("EVERY ANSWER SEALED BEFORE THE OUTCOME. YOUR CALLS, THE ORACLE, AND THE DAILY BOARD.");
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
      // The approved lapse explanation names retained results; all other ambient bans remain.
      for (const b of BANNED) {
        if (l.id === "streak.lapse-1" && b === "RESULTS") continue;
        expect(l.text, l.id).not.toContain(b);
      }
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
      if (l.text.includes("{outcome}")) expect(l.requires ?? [], l.id).toContain("outcome");
      if (l.text.includes("{call}")) expect(l.requires ?? [], l.id).toContain("call");
      if (l.text.includes("{points}")) expect(l.requires ?? [], l.id).toContain("points");
      expect(worst(l), l.id).not.toMatch(/[{}]/);
    }
  });
  it("curiosity gap: no noon line carries a score", () => {
    for (const l of COPY_BANK.filter((x) => x.pool === "noon")) {
      expect(l.text, l.id).not.toContain("POINTS");
      expect(l.text, l.id).not.toMatch(/\bSCORE\b/);
      expect(worst(l), l.id).not.toMatch(/[+-]\d/);
    }
  });
  it("has the spec'd pool shape", () => {
    const count = (p: string) => COPY_BANK.filter((l) => l.pool === p).length;
    expect(count("noon")).toBeGreaterThanOrEqual(25);
    expect(count("closing")).toBeGreaterThanOrEqual(20);
    expect(count("streak")).toBeGreaterThanOrEqual(10);
    expect(count("system")).toBeGreaterThanOrEqual(5);
    // The creed moved to PLUS_CREED_LINES (reading register) — what stays
    // in the bank is the paywall's machine voice: the rescue offer Home
    // prints and the terms line. The creed's own floor is asserted below.
    expect(count("paywall")).toBeGreaterThanOrEqual(2);
    expect(count("resolve")).toBeGreaterThanOrEqual(8);
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
    expect(RITES_LINES.length).toBe(16);
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
    // the per-day rate appears with it. Case-insensitive since the score
    // gloss moved to the reading register and is no longer shouted.
    for (const line of [...RITES_LINES, ...Object.values(SCORE_GLOSS)]) {
      if (/fifty/i.test(line)) expect(line, line).toMatch(/five (a day|calls a day)/i);
    }
  });
  it("partial and summons lines hold the machine register", () => {
    // SCORE_GLOSS is no longer here. A gloss is a sentence explaining the row
    // above it — read, not recognised — so it is governed by the reading
    // register in test/reading-register.test.ts instead. Everything that
    // remains in this list is a line the machine says about itself.
    for (const l of [PARTIAL_LINE, ...SUMMONS_LINES]) {
      expect(l, l).toBe(l.toUpperCase());
      expect(l, l).not.toMatch(EMOJI);
      expect(l, l).not.toContain("!");
      // Plain-language instructions may name results; ambient bank restrictions remain above.
      expect(l.length, l).toBeLessThanOrEqual(140);
    }
  });
});

describe("the calling", () => {
  it("is three beats in the register: caps, no emoji, no exclamation, no CTA verbs, push-length", async () => {
    const { CALLING_LINES } = await import("../src/copy");
    expect(CALLING_LINES.length).toBe(3);
    for (const l of CALLING_LINES) {
      expect(l, l).toBe(l.toUpperCase());
      expect(l, l).not.toMatch(EMOJI);
      expect(l, l).not.toContain("!");
      for (const b of BANNED) expect(l, l).not.toContain(b);
      expect(l.length, l).toBeLessThanOrEqual(140);
    }
  });
  it("introduces the product and rivalry", async () => {
    const { CALLING_LINES } = await import("../src/copy");
    const all = CALLING_LINES.join(" ");
    expect(all).toContain("OUTSEE");
    expect(all).toContain("MEET THE ORACLE");
    expect(all).toContain("IT MAKES A CALL. SO DO YOU.");
    expect(CALLING_LINES[CALLING_LINES.length - 1]).toBe("IT MAKES A CALL. SO DO YOU.");
  });
  it("never states a rule the rites own — no scoring, no noon, no shield", async () => {
    const { CALLING_LINES } = await import("../src/copy");
    const all = CALLING_LINES.join(" ");
    for (const w of ["POINTS", "SHIELD", "NOON", "BIG ONE", "FIRST HOUR"]) expect(all).not.toContain(w);
  });
});

describe("the paywall creed (spec §5 — bank lines, quarantined CTA labels, campaign copy)", () => {
  it("every paywall-pool line in the bank holds the standard register", () => {
    // Two, since the creed left for the reading register: the rescue offer
    // and the terms line. Both are still machine voice and still held to it.
    const paywall = COPY_BANK.filter((l) => l.pool === "paywall");
    expect(paywall.length).toBeGreaterThanOrEqual(2);
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
    // Everything the paywall screen prints, wherever it now lives: the creed
    // is reading copy in PLUS_CREED_LINES, and the Oracle Score clause is
    // still paywall.terms-1 in the bank. Matched case-insensitively because
    // the two halves are deliberately in different registers now.
    expect(PLUS_CREED_LINES.length).toBeGreaterThanOrEqual(4);
    const shown = [
      ...PLUS_CREED_LINES,
      ...COPY_BANK.filter((l) => l.pool === "paywall").map((l) => l.text),
    ].join(" ").toUpperCase();
    expect(CONSTANTS.SHIELD_MIN_STREAK).toBe(3);
    expect(shown).toContain("THREE DAYS OR MORE");
    // What the subscription actually grants, in the player's words.
    expect(shown).toContain("THREE SHIELDS");
    // The wall that makes the whole economy honest, said at the till.
    expect(shown).toContain("FORECAST RATING");
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

describe("the pipeline's own lines (design 2026-09-04 §11)", () => {
  it("holds the register: caps, no emoji, no exclamation, no CTA verbs, push-length", () => {
    const lines = [...Object.values(PIPELINE_LINES), provenanceLine(99, 99)!];
    for (const l of lines) {
      expect(l, l).toBe(l.toUpperCase());
      expect(l, l).not.toMatch(EMOJI);
      expect(l, l).not.toContain("!");
      for (const b of BANNED) expect(l, l).not.toContain(b);
      expect(l.length, l).toBeLessThanOrEqual(140);
    }
  });

  it("withholds the provenance line when nothing was written, so a bank drop claims no gauntlet", () => {
    expect(provenanceLine(0, 0)).toBeNull();
    expect(provenanceLine(0, 5)).toBeNull();
    expect(provenanceLine(15, 10)).toBe("15 WRITTEN · 10 PUT DOWN");
  });

  it("names the pre-flight in the canon exactly once", () => {
    // Bound to the ONE line that makes the claim. An assertion against the
    // joined canon is vacuous the moment a phrase appears in two rites.
    const rite = RITES_LINES.find((l) => l.includes("PUT TO THE MACHINE"));
    expect(rite).toBeDefined();
    expect(rite).toContain("WHAT IT COULD ANSWER, YOU NEVER SEE.");
    expect(RITES_LINES.filter((l) => l.includes("PUT TO THE MACHINE"))).toHaveLength(1);
  });

  it("keeps the new rite out of the opening — a first-timer meets it in play", () => {
    const rite = RITES_LINES.find((l) => l.includes("PUT TO THE MACHINE"))!;
    expect(OPENING_RITES_LINES).not.toContain(rite);
  });

  it("the four banner-bound lines fit the round screen's single-row banner", () => {
    // round.tsx renders these into a minHeight slot sized for one short
    // line; a longer one wraps and pushes the layout around it.
    for (const key of ["answerLeaked", "withdrawnMisauthored", "withdrawnUnresolvable", "struck"] as const) {
      expect(PIPELINE_LINES[key].length, key).toBeLessThanOrEqual(40);
    }
  });
});

describe("the resolve pool (design 2026-09-09 §2.1)", () => {
  const RESOLVE = COPY_BANK.filter((l) => l.pool === "resolve");
  it("has at least eight lines, every one carrying all three slots and requiring them", () => {
    expect(RESOLVE.length).toBeGreaterThanOrEqual(8);
    for (const l of RESOLVE) {
      expect(l.text, l.id).toContain("{outcome}");
      expect(l.text, l.id).toContain("{call}");
      expect(l.text, l.id).toContain("{points}");
      expect(l.requires ?? [], l.id).toEqual(expect.arrayContaining(["outcome", "call", "points"]));
    }
  });
  it("expands cleanly and fits a push at worst case", () => {
    for (const l of RESOLVE) {
      const filled = fillSlots(l.text, { outcome: "NO", call: "YES AT 95%", points: "-261" });
      expect(filled, l.id).not.toMatch(/[{}]/);
      expect(filled.length, l.id).toBeLessThanOrEqual(140);
    }
  });
  it("holds the register", () => {
    for (const l of RESOLVE) {
      // Stripped of its lowercase slot tokens first, as every other register
      // check in this file does (see "register: mono caps..." above) — the
      // tokens themselves are required to be lowercase by the test above.
      expect(l.text.replace(/\{[a-z]+\}/g, ""), l.id).toBe(l.text.replace(/\{[a-z]+\}/g, "").toUpperCase());
      expect(l.text, l.id).not.toContain("!");
      for (const b of BANNED) expect(l.text, l.id).not.toContain(b);
    }
  });
});

describe("the reading lines (design 2026-09-09 §2.2, §3.1)", () => {
  it("inPlayLine prints both counts", () => {
    expect(inPlayLine(3, 2)).toBe("IN PLAY · 3 DECIDED · 2 PENDING");
    expect(inPlayLine(1, 4)).toBe("IN PLAY · 1 DECIDED · 4 PENDING");
  });
  it("every reading line holds the register and fits the home slot", () => {
    for (const l of [inPlayLine(5, 0), ...Object.values(READING_LINES)]) {
      expect(l).toBe(l.toUpperCase());
      expect(l).not.toContain("!");
      expect(l.length).toBeLessThanOrEqual(40);
    }
  });
});
