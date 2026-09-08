// The one summons fires only after a seal (index.tsx gates it on
// `anySealed`), and it burns its flag on display rather than on consent. A
// player who opens the app and answers nothing is therefore never asked for
// notification permission — and is exactly the player a reminder exists to
// bring back. This decides when Home offers them the door instead.
//
// Pure on purpose: the render reads it, the tests read it, and nothing here
// touches Expo or the OS.

/** What the platform last told us. `unknown` is the pre-read state, not an answer. */
export type PermissionState = "unknown" | "undetermined" | "granted" | "denied";

export interface ReminderOfferState {
  /** Questions still answerable right now — see roundAvailability. */
  openCount: number;
  /** Whether anything in today's round is sealed. */
  anySealed: boolean;
  permission: PermissionState;
}

/**
 * `ask` routes to the summons — the same screen a player is shown, so both
 * paths explain themselves the same way. `settings` deep-links out, because
 * once iOS has been refused no in-app prompt can reach the switch again.
 * `null` renders nothing at all.
 */
export function shouldOfferReminder({ openCount, anySealed, permission }: ReminderOfferState): "ask" | "settings" | null {
  // Nothing to be late for.
  if (openCount <= 0) return null;
  // The summons owns the ask from the first seal onward; two offers for one
  // permission is a nag, and this one would be the redundant half.
  if (anySealed) return null;
  if (permission === "granted") return null;
  // A control that cannot work is worse than no control, and before the read
  // lands an offer would be a guess at the reader's own settings.
  if (permission === "unknown") return null;
  return permission === "denied" ? "settings" : "ask";
}
