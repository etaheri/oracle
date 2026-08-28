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
