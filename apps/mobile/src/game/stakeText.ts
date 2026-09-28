import { sideWord } from "./sideWords";

// The card's estimate text (design 2026-09-22 §9). Before the seal the card
// shows nothing about the room; after it, the side and what the Oracle
// expected. Money moved to the tray, where the double decision needs it.
// Machine register throughout.
export function lineLabel(line: number | null, room = false): string | null {
  if (line === null) return null;
  return `THE ORACLE EXPECTED ${Math.round(line * 100)}% ${room ? "TO AGREE" : "YES"}`;
}

// How a side is taken, in one line. Two ways in, so two lines: the swipe is
// the seal, but reduced motion turns the gesture off and leaves the buttons,
// and a caption that says "swipe" beside a dead gesture teaches a lie. The
// card and the practice caption both read this, so they can never disagree.
// No trailing period on either: at iPhone width the full stop pushed
// "SWIPE RIGHT FOR YES, LEFT FOR NO." onto a second line under the card
// (assets/hand/hand-card.png). The tap hint drops its own for symmetry.
export const SWIPE_HINT = "SWIPE RIGHT FOR YES, LEFT FOR NO";
// The hot take's hint. It drops "SWIPE" to stay the length of the line above:
// that one already fills the card's measure at iPhone width, and a longer one
// wraps under the buttons.
export const SWIPE_HINT_ROOM = "RIGHT TO AGREE, LEFT TO DISAGREE";
export const TAP_HINT = "TAP A SIDE TO SEAL";

export function sealHint(reducedMotion: boolean, room = false): string {
  if (reducedMotion) return TAP_HINT;
  return room ? SWIPE_HINT_ROOM : SWIPE_HINT;
}

// The receipt under the stage. An unstaked round (no line committed, design
// 2026-09-10 §5.5) has only the side to say.
export function receiptLine(input: { answer: boolean; line: number | null; doubled?: boolean; room?: boolean }): string {
  const room = input.room ?? false;
  const side = sideWord(input.answer, room);
  const label = lineLabel(input.line, room);
  if (label === null) return side;
  const body = `${side} · ${label}`;
  return input.doubled ? `${body} · DOUBLED` : body;
}

// The round screen's line per sealed call (design 2026-09-22 §9.2): the side,
// the estimate the player played against, and DOUBLED when it carries the
// double. An unstaked round keeps saying only whose side it is.
export function crowdCallLine(input: { answer: boolean; line: number | null; doubled: boolean; room?: boolean }): string {
  const room = input.room ?? false;
  if (input.line === null) return `YOU: ${sideWord(input.answer, room)}`;
  return receiptLine({ answer: input.answer, line: input.line, doubled: input.doubled, room });
}
