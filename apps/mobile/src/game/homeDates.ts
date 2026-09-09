// Home reads "yesterday" two different ways, and conflating them starved the
// shield and lapse notices (audit finding A): `shield_used_on` is the date
// the player did NOT play, so it can only ever equal CALENDAR yesterday —
// never the reading round's own date, which can lag behind by however long
// verification took. Likewise `playedYesterday` (fed to lapseNotice) has to
// ask about calendar yesterday, or a still-in-play reading round makes it
// permanently unreachable. The rail item and the slot CTA, on the other
// hand, want the ledger's own surface: the reading round itself, whatever
// date that turns out to be.
//
// This module is the one place that splits those two concepts so index.tsx
// cannot silently drift back into using one for the other.
function yesterdayOf(date: string | undefined, nowMs: number): string {
  const base = date ? new Date(`${date}T00:00:00Z`) : new Date(nowMs);
  return new Date(base.getTime() - 86_400_000).toISOString().slice(0, 10);
}

export interface HomeDates {
  /** The morning-after concept: what shieldNotice and lapseNotice mean by
   *  "yesterday" — always calendar yesterday of the round (or of now, absent
   *  a round). */
  calendarYesterday: string;
  /** The ledger surface: the reading round's own date when there is one,
   *  falling back to calendar yesterday when there isn't. Drives the rail
   *  item and the slot CTA's link. */
  ledgerDate: string;
}

export function homeDates(
  readingDate: string | null | undefined,
  roundDate: string | undefined,
  nowMs: number = Date.now(),
): HomeDates {
  const calendarYesterday = yesterdayOf(roundDate, nowMs);
  return { calendarYesterday, ledgerDate: readingDate ?? calendarYesterday };
}
