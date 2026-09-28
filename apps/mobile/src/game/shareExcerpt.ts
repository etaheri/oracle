import type { LogLine } from "@oracle/core";
import { channelHeader, etClock, nick, sharePct } from "./channel";
import { sideWord } from "./sideWords";

// The night card's middle block (design 2026-09-25 §6.6): the Big One's
// channel, cut to what fits. Skia text does not wrap and has no font fallback,
// so every line is one row of the mono face, inside the card's measure, in
// printable ASCII and the middle dot. Pure; ShareCard draws what this returns.
//
// 46 columns: IBM Plex Mono advances 0.6em, so at the card's 18px each column
// is 10.8px and the 500px between the card's inner margins holds 46.
export const EXCERPT_COLS = 46;
// The widest nick, `<sonnet>`, and two spaces after it.
const NICK_COLS = 10;

export interface ExcerptLine { text: string; tone: "head" | "win" | "loss" | "mute" | "you" }

// What a member wrote is model output: curly quotes, dashes, emoji. The quotes
// and dashes are translated; anything else the face cannot draw is dropped.
export function asciiOnly(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E·\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fit(text: string): string {
  const flat = text.trimEnd();
  return flat.length <= EXCERPT_COLS ? flat : `${flat.slice(0, EXCERPT_COLS - 3).trimEnd()}...`;
}

const row = (stamp: string, who: string, rest: string) => fit(`${stamp} ${who.padEnd(NICK_COLS)}${rest}`);

export function shareExcerpt(input: { date: string; log: ReadonlyArray<LogLine>; my: { answer: boolean; sealedAt: string | null } | null }): ExcerptLine[] {
  const guesses = input.log.filter((l) => l.kind === "say" && l.p_yes !== null);
  if (guesses.length === 0) return [];
  const out: ExcerptLine[] = [{ text: channelHeader(input.date), tone: "head" }];
  for (const l of guesses) {
    out.push({ text: row(etClock(l.at), nick(l.member), [sharePct(l.p_yes!), asciiOnly(l.text)].filter(Boolean).join("  ")), tone: l.tone });
  }
  if (input.my) {
    out.push({ text: row(input.my.sealedAt === null ? "--:--" : etClock(input.my.sealedAt), "<you>", sideWord(input.my.answer, true)), tone: "you" });
  }
  const verdict = input.log.find((l) => l.kind === "system");
  // The card is a screenshot of a result, not a census: the head count the
  // channel prints on the reveal stays there.
  if (verdict) out.push({ text: fit(`${etClock(verdict.at)} *** ${asciiOnly(verdict.text.replace(/ · \d+ PLAYERS?$/, ""))}`), tone: "mute" });
  for (const l of input.log.filter((r) => r.kind === "say" && r.p_yes === null)) {
    out.push({ text: row(etClock(l.at), nick(l.member), asciiOnly(l.text)), tone: "loss" });
  }
  return out;
}

// The share message carries the excerpt's first and last lines (design §6.6).
// The card pads its columns; a message does not.
export function excerptEnds(lines: ReadonlyArray<ExcerptLine>): [string, string] | null {
  if (lines.length < 2) return null;
  const flat = (s: string) => s.replace(/\s+/g, " ");
  return [flat(lines[0]!.text), flat(lines[lines.length - 1]!.text)];
}
