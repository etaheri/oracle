import { MODEL_MEMBER_IDS } from "@oracle/core";
import { etClock } from "./channel";

// Home's status line while a round is open and there is still a take to seal
// (design 2026-09-25 §6.5): the machines clocked in at 09:00 and have already
// guessed. It names how many and when, and nothing about what they said.
export const FLOOR_DARK = "THE FLOOR IS DARK · THE MACHINES DID NOT CLOCK IN";

export function shiftLine(input: { open: boolean; allSealed: boolean; room: boolean; councilCommittedAt: string | null }): string | null {
  if (!input.open || input.allSealed || !input.room) return null;
  if (input.councilCommittedAt === null) return FLOOR_DARK;
  return `${MODEL_MEMBER_IDS.length} MACHINES ONLINE · CLOCKED IN ${etClock(input.councilCommittedAt)}`;
}
