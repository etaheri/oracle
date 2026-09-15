import { describe, it, expect } from "vitest";
import type { RoundToday, MineToday } from "@oracle/core";
import { trayTiles, trayState, trayStage } from "../src/game/doubleTray";

type Q = RoundToday["questions"][number];
const NOW = Date.parse("2026-09-14T17:00:00Z");
const q = (slot: number, over: Partial<Q> = {}): Q => ({
  id: `q${slot}`, slot, is_big_one: slot === 5, text: `Will ${slot}?`, category: "WEATHER", source_name: "Kalshi",
  resolution_criteria: "", context: null, locks_at: "2026-09-15T16:00:00Z", lock_healed: false, struck: false, struck_reason: null, line_p_yes: 0.35, ...over,
});
type P = MineToday["predictions"][number];
const p = (slot: number, over: Partial<P> = {}): P => ({ question_id: `q${slot}`, answer: true, confidence: 75, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null, stake: slot === 5 ? 100 : 50, doubled: false, ...over });
const five = [q(1), q(2), q(3), q(4), q(5)];

describe("the tray (design §5.3)", () => {
  it("lists every sealed call in slot order with the doubled arithmetic at the line", () => {
    const tiles = trayTiles(five, [p(3), p(1), p(5, { answer: false })], NOW);
    expect(tiles.map((t) => t.slot)).toEqual([1, 3, 5]);
    expect(tiles[0]).toMatchObject({ id: "q1", answer: true, stake: 50, doubledStake: 100, wins: 93, doubledWins: 186, isBigOne: false, locked: false });
    // NO at a 35% line pays 0.538 per unit: 100 → 54, doubled 200 → 108.
    expect(tiles[2]).toMatchObject({ id: "q5", answer: false, stake: 100, doubledStake: 200, wins: 54, doubledWins: 108, isBigOne: true });
  });
  it("marks a locked question's tile and skips an unstaked call", () => {
    const qs = [q(1, { locks_at: "2026-09-14T16:00:00Z" }), q(2)];
    const tiles = trayTiles(qs, [p(1), p(2, { stake: null })], NOW);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ id: "q1", locked: true });
  });
  it("reads a placed double back at its base stake, never doubling it twice", () => {
    // The server's double route stores `stake * 2` with `doubled = true`, so
    // /today/mine comes back carrying the ALREADY doubled stake. The tile has
    // to price from the base again or the beat after the tap reads 200 → 400.
    const tiles = trayTiles([q(1)], [p(1, { stake: 100, doubled: true })], NOW);
    expect(tiles[0]).toMatchObject({ stake: 50, doubledStake: 100, wins: 93, doubledWins: 186 });
  });
  it("is hidden while a card is still open, open once the hand is sealed, placed once the double lands", () => {
    expect(trayState(five, [p(1), p(2), p(3), p(4)], null, NOW)).toBe("hidden");
    expect(trayState(five, [p(1), p(2), p(3), p(4), p(5)], null, NOW)).toBe("open");
    expect(trayState(five, [p(1), p(2), p(3), p(4), p(5)], "q5", NOW)).toBe("placed");
  });
  it("opens on a partial hand once the rest has locked, and hides when nothing sealed is still open", () => {
    const late = [q(1), q(2), q(3, { locks_at: "2026-09-14T16:00:00Z" }), q(4, { locks_at: "2026-09-14T16:00:00Z" }), q(5, { locks_at: "2026-09-14T16:00:00Z" })];
    expect(trayState(late, [p(1), p(2)], null, NOW)).toBe("open");
    const allLocked = five.map((x) => ({ ...x, locks_at: "2026-09-14T16:00:00Z" }));
    expect(trayState(allLocked, [p(1), p(2), p(3), p(4), p(5)], null, NOW)).toBe("hidden");
    expect(trayState(five, [], null, NOW)).toBe("hidden");
  });
});

describe("the stage after the last card (design §5.3)", () => {
  it("waits rather than flashing the finale while the server's hand is still in flight", () => {
    // `hasOpenCard` reads the local store and `tray` reads the server's rows,
    // so on the fifth seal the mine refetch is still out when the card goes.
    // "hidden" means "not known yet" there, not "there is no tray".
    expect(trayStage({ hasOpenCard: true, tray: "hidden", mineSettled: false, holdPlaced: false })).toBe("card");
    expect(trayStage({ hasOpenCard: false, tray: "hidden", mineSettled: false, holdPlaced: false })).toBe("waiting");
    expect(trayStage({ hasOpenCard: false, tray: "hidden", mineSettled: true, holdPlaced: false })).toBe("finale");
    expect(trayStage({ hasOpenCard: false, tray: "open", mineSettled: false, holdPlaced: false })).toBe("tray");
  });
  it("holds the tray for the beat after the double lands, then hands over to the finale", () => {
    expect(trayStage({ hasOpenCard: false, tray: "placed", mineSettled: true, holdPlaced: true })).toBe("tray");
    expect(trayStage({ hasOpenCard: false, tray: "placed", mineSettled: true, holdPlaced: false })).toBe("finale");
    // A double placed on an earlier visit is settled fact: never a wait.
    expect(trayStage({ hasOpenCard: false, tray: "placed", mineSettled: false, holdPlaced: false })).toBe("finale");
  });
});
