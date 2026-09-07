import { COPY_BANK, PARTIAL_LINE, fillSlots, selectLine } from "@oracle/core";
import { numeral } from "./numerals";

// Home's truth-telling lines (audit §3.1, #9, #7, §5.2, #6, §5). All pure —
// node-tested. index.tsx supplies the live inputs and priority order.

const RISK_MS = 3 * 3_600_000;
const RISK = COPY_BANK.filter((l) => l.id.startsWith("streak.risk"));

// A partial day is silently un-rated otherwise (audit §3.1): name the count
// and the rule together, and only while the day is actually partial.
export function partialLine(sealedCount: number, total: number): string | null {
  if (sealedCount <= 0 || sealedCount >= total) return null;
  return `${numeral(sealedCount)} OF ${numeral(total)} SEALED · ${PARTIAL_LINE}`;
}

// "N ORACLES ALREADY WAITING" counts people who already sealed (audit #9) —
// this counts who has spoken, and never claims a crowd that doesn't exist.
export function spokenLine(playerCount: number): string {
  if (playerCount <= 0) return "THE ORACLE SPEAKS";
  return playerCount === 1 ? "1 ORACLE HAS ALREADY SPOKEN" : `${playerCount} ORACLES HAVE ALREADY SPOKEN`;
}

// The streak is invisible on the day it matters (audit §5.2): warn inside
// the last three hours before lock, only while unsealed and only when there
// is a vigil to lose. Matches vigilLine: the oracle starts counting at 2, so
// a streak of 1 never speaks ("YOUR VIGIL OF 1 DAYS" would read as a bug).
export function riskLine(
  streak: number,
  anySealed: boolean,
  msUntilLock: number | null,
  seedKey: string
): string | null {
  if (streak < 2 || anySealed || msUntilLock === null || msUntilLock > RISK_MS) return null;
  const line = selectLine(RISK, seedKey, ["streak"]);
  return line ? fillSlots(line.text, { streak }) : null;
}

// Lapsed players get silence though the copy exists (audit #6): speak once
// the vigil is broken (streak reset to 0) and yesterday went unplayed —
// never for a brand-new player, and never when the shield held.
export function lapseNotice(
  daysConsulted: number,
  streak: number,
  playedYesterday: boolean | null,
  seedKey: string
): string | null {
  if (daysConsulted <= 0 || streak !== 0 || playedYesterday !== false) return null;
  return "THE VIGIL BEGINS AGAIN. YOUR RECORD REMAINS.";
}
