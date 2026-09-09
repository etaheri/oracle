import { CONSTANTS } from "@oracle/core";

// ET wall-clock helpers. The cron is UTC and dumb; ALL schedule intelligence
// derives from these (spec §2-3). Intl only — never hard-coded offsets.
const ET = "America/New_York";

export interface ETNow { date: string; hour: number; minute: number }

export function etNow(now: Date): ETNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  // some engines render midnight as "24" with hour12:false
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24, minute: Number(get("minute")) };
}

// Noon ET on `date` as a UTC instant: 16:00Z under EDT, 17:00Z under EST.
// Decided by asking Intl what 16:00Z reads as in ET on that date.
export function noonET(date: string): Date {
  const edt = new Date(`${date}T16:00:00Z`);
  return etNow(edt).hour === 12 ? edt : new Date(`${date}T17:00:00Z`);
}

export function addDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

// The fast-round rule's threshold (design 2026-09-09 §1.2): the lock plus the
// evening lag. At most one question in a v2 round may resolve after this.
export function fastResolveBy(date: string): Date {
  return new Date(noonET(addDays(date, 1)).getTime() + CONSTANTS.EVENING_RESOLVE_LAG_HOURS * 3_600_000);
}

// The void deadline: noon ET two days after the round date. This is the same
// instant decideActions (state.ts) voids unresolved questions at; it lives
// here so authoring can refuse a question that would void unseen.
export function voidDeadline(date: string): Date {
  return noonET(addDays(date, 2));
}
