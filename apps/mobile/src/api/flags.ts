import { withSealHour, type SealHour } from "../game/habit";

// Small persisted flags (SecureStore, same store as the device token).
// Failures degrade to the flag's zero value — never throw for a flag.
async function store() {
  return import("expo-secure-store");
}

const REVEAL_SEEN_KEY = "oracle.reveal_seen"; // holds the last reveal DATE viewed

export async function getRevealSeen(): Promise<string | null> {
  try { return await (await store()).getItemAsync(REVEAL_SEEN_KEY); } catch { return null; }
}
export async function markRevealSeen(date: string): Promise<void> {
  try { await (await store()).setItemAsync(REVEAL_SEEN_KEY, date); } catch {}
}

const RITES_SEEN_KEY = "oracle.rites_seen";

export async function getRitesSeen(): Promise<boolean> {
  try { return (await (await store()).getItemAsync(RITES_SEEN_KEY)) === "1"; } catch { return false; }
}
export async function markRitesSeen(): Promise<void> {
  try { await (await store()).setItemAsync(RITES_SEEN_KEY, "1"); } catch {}
}

const SWIPE_HINTED_KEY = "oracle.swipe_hinted";

export async function getSwipeHinted(): Promise<boolean> {
  try { return (await (await store()).getItemAsync(SWIPE_HINTED_KEY)) === "1"; } catch { return true; } // storage failure → never replay the nudge
}
export async function markSwipeHinted(): Promise<void> {
  try { await (await store()).setItemAsync(SWIPE_HINTED_KEY, "1"); } catch {}
}

const FLOOR_NOTICED_KEY = "oracle.floor_noticed";

// The one-time floor rite: the first committed pull ever shows "NO COIN
// FLIPS · 55 IS THE LEAST BELIEF" in place of the conviction reading.
export async function getFloorNoticed(): Promise<boolean> {
  try { return (await (await store()).getItemAsync(FLOOR_NOTICED_KEY)) === "1"; } catch { return true; } // storage failure → never replay the rite
}
export async function markFloorNoticed(): Promise<void> {
  try { await (await store()).setItemAsync(FLOOR_NOTICED_KEY, "1"); } catch {}
}

const NOTIF_ASKED_KEY = "oracle.notif_asked";

export async function getNotifAsked(): Promise<boolean> {
  try { return (await (await store()).getItemAsync(NOTIF_ASKED_KEY)) === "1"; } catch { return true; } // storage failure → never nag
}
export async function markNotifAsked(): Promise<void> {
  try { await (await store()).setItemAsync(NOTIF_ASKED_KEY, "1"); } catch {}
}

const CALLING_SEEN_KEY = "oracle.calling_seen";

// The Calling: the one-time cinematic on the very first open. Storage
// failure → seen — the lore must never replay at a veteran.
export async function getCallingSeen(): Promise<boolean> {
  try { return (await (await store()).getItemAsync(CALLING_SEEN_KEY)) === "1"; } catch { return true; }
}
export async function markCallingSeen(): Promise<void> {
  try { await (await store()).setItemAsync(CALLING_SEEN_KEY, "1"); } catch {}
}

const ORB_GREETED_KEY = "oracle.orb_greeted"; // holds the last DATE the orb greeted

// The orb's once-a-day self-ripple. Storage failure → null → the greeting
// plays again on the next cold start: it is a two-second courtesy, not a rite,
// and a repeated one costs far less than a player who never learns the glass
// answers a touch.
export async function getOrbGreeted(): Promise<string | null> {
  try { return await (await store()).getItemAsync(ORB_GREETED_KEY); } catch { return null; }
}
export async function markOrbGreeted(date: string): Promise<void> {
  try { await (await store()).setItemAsync(ORB_GREETED_KEY, date); } catch {}
}

const PRACTICE_SEEN_KEY = "oracle.practice_seen";
export async function getPracticeSeen(): Promise<boolean> {
  try { return (await (await store()).getItemAsync(PRACTICE_SEEN_KEY)) === "1"; } catch { return true; }
}
export async function markPracticeSeen(): Promise<void> {
  try { await (await store()).setItemAsync(PRACTICE_SEEN_KEY, "1"); } catch {}
}
export async function claimFirstLiveSeal(): Promise<boolean> {
  try {
    const storage = await store();
    if (await storage.getItemAsync("oracle.first_live_seal")) return false;
    await storage.setItemAsync("oracle.first_live_seal", "1"); return true;
  } catch { return false; }
}
export async function getSeenMilestones(): Promise<string[]> {
  try { const value: unknown = JSON.parse(await (await store()).getItemAsync("oracle.milestones_seen") ?? "[]"); return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}
export async function markMilestoneSeen(id: string): Promise<void> {
  try { const ids = await getSeenMilestones(); await (await store()).setItemAsync("oracle.milestones_seen", JSON.stringify([...new Set([...ids, id])])); } catch {}
}

const SEAL_HOURS_KEY = "oracle.seal_hours";

// The habitual-hour history (design 2026-09-09 §4.2): one (date, hour) per
// local calendar day, first seal wins, newest HABIT_KEEP kept. Pure logic
// lives in game/habit.ts — this is just the persisted store.
export async function getSealHours(): Promise<SealHour[]> {
  try {
    const value: unknown = JSON.parse((await (await store()).getItemAsync(SEAL_HOURS_KEY)) ?? "[]");
    return Array.isArray(value)
      ? value.filter((x): x is SealHour => !!x && typeof x === "object" && typeof (x as SealHour).date === "string" && typeof (x as SealHour).hour === "number")
      : [];
  } catch { return []; }
}
export async function recordSealHour(now: Date): Promise<void> {
  try {
    const local = {
      date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
      hour: now.getHours(),
    };
    const prev = await getSealHours();
    const next = withSealHour(prev, local);
    if (next === prev) return; // today's date already recorded — nothing changed, skip the write
    await (await store()).setItemAsync(SEAL_HOURS_KEY, JSON.stringify(next));
  } catch {}
}
