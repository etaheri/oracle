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
