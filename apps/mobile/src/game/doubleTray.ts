import { doubledStake, odds, type MineToday, type RoundToday } from "@oracle/core";
import { isClosed, nextOpenQuestion } from "./questionState";

// The tray after the fifth seal (design 2026-09-14 §5.3). Pure — node-tested.
// One tile per sealed, staked call; the round screen decides when to show it
// through `trayState`.
export type TrayTile = {
  id: string; slot: number; text: string; isBigOne: boolean; answer: boolean;
  stake: number; doubledStake: number; wins: number; doubledWins: number; locked: boolean;
};
export type TrayState = "hidden" | "open" | "placed";

export const TRAY_TITLE = "PLACE YOUR DOUBLE";
export const TRAY_READ = "Your surest call. Its stake doubles.";
export const DOUBLE_NOTICE = "YOUR DOUBLE IS UNPLACED";

export function trayTiles(questions: RoundToday["questions"], mine: MineToday["predictions"], now: number): TrayTile[] {
  const byId = new Map(mine.map((p) => [p.question_id, p]));
  return [...questions]
    .sort((a, b) => a.slot - b.slot)
    .flatMap((q) => {
      const p = byId.get(q.id);
      // An unstaked call (no line committed, design §5.5) has nothing to
      // double: no stake to grow and no odds to price the winnings at.
      if (!p || p.stake === null || q.line_p_yes === null) return [];
      const stake = p.stake;
      const rate = odds(p.answer, q.line_p_yes);
      const dbl = doubledStake(stake);
      return [{
        id: q.id, slot: q.slot, text: q.text, isBigOne: q.is_big_one, answer: p.answer,
        stake, doubledStake: dbl, wins: Math.round(stake * rate), doubledWins: Math.round(dbl * rate),
        locked: isClosed(q, now),
      }];
    });
}

// Hidden while any card is still dealable, or when no sealed call is still
// open to double; placed once the server has the double; open otherwise.
export function trayState(questions: RoundToday["questions"], mine: MineToday["predictions"], doubleQuestionId: string | null, now: number): TrayState {
  if (doubleQuestionId !== null) return "placed";
  const sealed = new Set(mine.map((p) => p.question_id));
  if (nextOpenQuestion(questions, (id) => sealed.has(id), now)) return "hidden";
  return trayTiles(questions, mine, now).some((t) => !t.locked) ? "open" : "hidden";
}
