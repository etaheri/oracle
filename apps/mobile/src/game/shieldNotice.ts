import { COPY_BANK } from "@oracle/core";

// The morning-after line when the free shield held a missed noon. The copy
// lives in the versioned bank (streak.shield-1); this module only decides
// WHEN it may speak: shield_used_on === yesterday, nothing else.
const LINE = COPY_BANK.find((l) => l.id === "streak.shield-1")!.text;

export function shieldNotice(shieldUsedOn: string | null, yesterday: string): string | null {
  return shieldUsedOn !== null && shieldUsedOn === yesterday ? LINE : null;
}
