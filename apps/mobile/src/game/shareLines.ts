import { SHARE_URL } from "../config/links";
import { formatFortune, signedFortune } from "./fortuneText";
import { patternLine, type QuestionResult } from "./sharePattern";

// The share card's second line (design §8.3): the Oracle's line on the Big
// One and what the player did about it.
export function shareBigOneLine(input: { line: number | null; answer: boolean | null; stake: number | null; delta: number | null }): string | null {
  if (input.line === null) return null;
  const said = `THE ORACLE SAID ${Math.round(input.line * 100)}% YES`;
  if (input.answer === null || input.stake === null) return `${said} · YOU SAT IT OUT`;
  const took = `YOU TOOK ${input.answer ? "YES" : "NO"} FOR ${formatFortune(input.stake)}`;
  return input.delta === null ? `${said} · ${took}` : `${said} · ${took} · ${signedFortune(input.delta)}`;
}

export function fortuneShareMessage(
  d: { date: string; delta: number; fortuneAfter: number; results: ReadonlyArray<QuestionResult> },
  url: string | null = SHARE_URL,
): string {
  const body = `🔮 OUTSEEN ${d.date} — ${patternLine(d.results)} · ${signedFortune(d.delta)} · FORTUNE ${formatFortune(d.fortuneAfter)} · can you beat the house?`;
  return url ? `${body} ${url}` : body;
}

// Skia text does not wrap, and the Big One's money line runs past the card at
// its full length. Broken by hand on the last " · " that still leaves the head
// inside the measure; a line with no separator in reach is left whole.
export const SHARE_LINE_MAX = 44;
export function splitShareLine(line: string, max = SHARE_LINE_MAX): [string, string | null] {
  if (line.length <= max) return [line, null];
  const cut = line.lastIndexOf(" · ", max);
  if (cut < 0) return [line, null];
  return [line.slice(0, cut), line.slice(cut + 3)];
}
