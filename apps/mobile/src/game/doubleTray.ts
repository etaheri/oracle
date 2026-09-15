import { FORTUNE, doubledStake, odds, type MineToday, type RoundToday } from "@oracle/core";
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
// The tray's own failure line. A tap that reaches a server which has moved on
// — the question locked, the double already elsewhere — must say so; silence
// leaves the player tapping a tile that will never take.
export const DOUBLE_FAILED = "THE DOUBLE DID NOT LAND";
// The beat the placed tile holds before the stage moves to the crowd finale.
export const TRAY_HOLD_MS = 900;

export function trayTiles(questions: RoundToday["questions"], mine: MineToday["predictions"], now: number): TrayTile[] {
  const byId = new Map(mine.map((p) => [p.question_id, p]));
  return [...questions]
    .sort((a, b) => a.slot - b.slot)
    .flatMap((q) => {
      const p = byId.get(q.id);
      // An unstaked call (no line committed, design §5.5) has nothing to
      // double: no stake to grow and no odds to price the winnings at.
      if (!p || p.stake === null || q.line_p_yes === null) return [];
      // The server's double route stores `stake * 2` on the row it doubles, so
      // a placed call comes back from /today/mine ALREADY doubled. Price from
      // the base either way, or the beat between the tap and the hand-off
      // reads the stake doubled twice.
      const stake = p.doubled ? p.stake / FORTUNE.DOUBLE_MULT : p.stake;
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

// What the round's stage shows once the card is gone. `hasOpenCard` is read
// from the LOCAL store and `tray` from the SERVER's rows, and those two do not
// land together: on the fifth seal the mine refetch is still in flight when
// the last card goes, so `trayState` says "hidden" for one round trip. Taking
// that at face value flashed the crowd finale — the whole payoff — for a beat
// and then yanked it back for the tray, every time under reduced motion.
// While the server's hand is still unknown the stage shows nothing instead.
export type TrayStage = "card" | "tray" | "waiting" | "finale";

export function trayStage(input: { hasOpenCard: boolean; tray: TrayState; mineSettled: boolean; holdPlaced: boolean }): TrayStage {
  if (input.hasOpenCard) return "card";
  if (input.tray === "open" || (input.tray === "placed" && input.holdPlaced)) return "tray";
  // "placed" is settled fact whoever reported it, so it never waits.
  if (input.tray !== "placed" && !input.mineSettled) return "waiting";
  return "finale";
}
