import { getNotifAsked, markNotifAsked } from "../api/flags";

// The one summons, ever (voice spec §4): the interstitial precedes the OS
// prompt, and the flag flips the moment it is shown so it can never repeat.
// A decline is therefore final too — which is the whole reason Home carries a
// separate door for the reader who was never asked at all.

/** Optional overrides, for tests. Same idiom as api/auth.ts's `deps`. */
export interface SummonDeps {
  asked?: () => Promise<boolean>;
  mark?: () => Promise<void>;
}

/**
 * Show the summons now, and count it as the one ask.
 *
 * Home's reminder control routes here directly rather than through
 * maybeSummon, which would refuse to show anything on a second visit. Marking
 * the flag here is what keeps the invariant true across BOTH doors: without
 * it, a reader who enabled notifications from Home would be summoned again the
 * first time they sealed a question.
 */
export async function summonNow(push: (href: "/summons") => void, deps: SummonDeps = {}): Promise<void> {
  try {
    await (deps.mark ?? markNotifAsked)();
    push("/summons");
  } catch {}
}

/** Show the summons unless it has already been shown once. */
export async function maybeSummon(push: (href: "/summons") => void, deps: SummonDeps = {}): Promise<void> {
  try {
    if (await (deps.asked ?? getNotifAsked)()) return;
    await summonNow(push, deps);
  } catch {}
}
