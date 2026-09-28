import { describe, it, expect } from "vitest";
import type { LogLine } from "@oracle/core";
import { shareExcerpt, excerptEnds, asciiOnly, EXCERPT_COLS } from "../src/game/shareExcerpt";

const say = (member: "haiku" | "sonnet" | "opus", p: number | null, text: string, at: string, tone: LogLine["tone"]): LogLine => ({ at, kind: "say", member, text, p_yes: p, tone });
const LOG: LogLine[] = [
  say("haiku", 0.31, "no chance", "2026-09-25T13:00:00.000Z", "loss"),
  say("sonnet", 0.44, "", "2026-09-25T13:00:01.000Z", "loss"),
  say("opus", 0.4, "On reflection — and I said this about “cereal” on the 19th — the room will not go for it 🙃", "2026-09-25T13:00:02.000Z", "loss"),
  { at: "2026-09-26T16:00:00.000Z", kind: "system", member: null, text: "THE ROOM AGREED · 62% · 41 PLAYERS", p_yes: null, tone: "mute" },
  say("haiku", null, "ok the room is wrong", "2026-09-26T16:01:00.000Z", "loss"),
  { at: "2026-09-26T16:02:00.000Z", kind: "note", member: "sonnet", text: "weigh the villain.", p_yes: null, tone: "mute" },
];
const mine = { answer: true, sealedAt: "2026-09-25T16:14:00.000Z" };

describe("the share card's excerpt (design 2026-09-25 §6.6)", () => {
  it("prints the header, one line per machine, the caller, the room, then the reactions", () => {
    const out = shareExcerpt({ date: "2026-09-25", log: LOG, my: mine });
    expect(out.map((l) => l.text)).toEqual([
      "#nightshift · 09-25",
      "09:00 <haiku>   31  no chance",
      "09:00 <sonnet>  44",
      "09:00 <opus>    40  On reflection - and I s...",
      "12:14 <you>     AGREE",
      "12:00 *** THE ROOM AGREED · 62%",
      "12:01 <haiku>   ok the room is wrong",
    ]);
    expect(out.map((l) => l.tone)).toEqual(["head", "loss", "loss", "loss", "you", "mute", "loss"]);
  });
  it("keeps every line inside the card's measure and inside the font", () => {
    for (const l of shareExcerpt({ date: "2026-09-25", log: LOG, my: mine })) {
      expect(l.text.length, l.text).toBeLessThanOrEqual(EXCERPT_COLS);
      expect(l.text, l.text).toMatch(/^[\x20-\x7E·]*$/);
    }
  });
  it("leaves the notes to self off the card, and the caller off when they sat it out", () => {
    const out = shareExcerpt({ date: "2026-09-25", log: LOG, my: null });
    expect(out.some((l) => l.text.includes("note to self"))).toBe(false);
    expect(out.some((l) => l.text.includes("<you>"))).toBe(false);
  });
  it("prints a blank clock when the seal time is unknown, and disagree in full", () => {
    const out = shareExcerpt({ date: "2026-09-25", log: LOG, my: { answer: false, sealedAt: null } });
    expect(out[4]!.text).toBe("--:-- <you>     DISAGREE");
  });
  it("is empty when no machine clocked in", () => {
    expect(shareExcerpt({ date: "2026-09-25", log: [], my: mine })).toEqual([]);
  });
  it("strips what the card's font cannot draw", () => {
    expect(asciiOnly("“quoted” — it’s… fine 🙃")).toBe("\"quoted\" - it's... fine");
    expect(asciiOnly("a\n  b")).toBe("a b");
  });
  it("hands the share message its first and last lines, single-spaced", () => {
    expect(excerptEnds(shareExcerpt({ date: "2026-09-25", log: LOG, my: mine }))).toEqual(["#nightshift · 09-25", "12:01 <haiku> ok the room is wrong"]);
    expect(excerptEnds([])).toBeNull();
  });
});
