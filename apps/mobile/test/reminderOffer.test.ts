import { it, expect } from "vitest";
import { shouldOfferReminder } from "../src/game/reminderOffer";

// The hole this closes: the summons only ever fires after a seal
// (index.tsx gates it on `anySealed`), so a player who opens the app and
// never answers is never asked for notification permission — and is
// therefore unreachable by the reminder that exists to bring them back.

it("offers the ask to a player who has an open round and has sealed nothing", () => {
  expect(shouldOfferReminder({ openCount: 1, anySealed: false, permission: "undetermined" })).toBe("ask");
});

it("stays silent once anything is sealed, because the summons itself takes over", () => {
  expect(shouldOfferReminder({ openCount: 1, anySealed: true, permission: "undetermined" })).toBe(null);
});

it("stays silent when permission is already granted", () => {
  expect(shouldOfferReminder({ openCount: 1, anySealed: false, permission: "granted" })).toBe(null);
});

it("sends a refused player to Settings, where the only remaining switch lives", () => {
  expect(shouldOfferReminder({ openCount: 1, anySealed: false, permission: "denied" })).toBe("settings");
});

// A control that cannot work is worse than no control: until the async
// permission read lands we know nothing, and an offer would be a guess.
it("stays silent while the permission read is still unknown", () => {
  expect(shouldOfferReminder({ openCount: 1, anySealed: false, permission: "unknown" })).toBe(null);
});

// Nothing to be reminded about: the round is over, or has not opened.
it("stays silent when there is no open question to be late for", () => {
  expect(shouldOfferReminder({ openCount: 0, anySealed: false, permission: "undetermined" })).toBe(null);
});
