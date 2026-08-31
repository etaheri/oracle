import { getNotifAsked, markNotifAsked } from "../api/flags";

// The one summons, ever (voice spec §4): the interstitial precedes the OS
// prompt, and the flag flips the moment it is shown so it can never repeat.
export async function maybeSummon(push: (href: "/summons") => void): Promise<void> {
  try {
    if (await getNotifAsked()) return;
    await markNotifAsked();
    push("/summons");
  } catch {}
}
