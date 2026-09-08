import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import * as Notifications from "expo-notifications";
import type { PermissionState } from "../game/reminderOffer";

// Reading the OS's answer, and nothing else — the decision about what to do
// with it lives in game/reminderOffer.ts where it can be tested without a
// device.
//
// `unknown` is the honest pre-read value and the value every failure falls
// back to. shouldOfferReminder renders nothing for it, so a permissions API
// that throws costs the reader an offer they might not have needed, never a
// broken control or a crash. Same posture as every other flag in this app.

export async function readNotificationPermission(): Promise<PermissionState> {
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted) return "granted";
    // canAskAgain distinguishes the reader who has never been asked from the
    // one who said no: only the former can still be shown a system prompt,
    // and the latter has to be sent to Settings instead.
    return p.canAskAgain ? "undetermined" : "denied";
  } catch {
    return "unknown";
  }
}

/**
 * Re-reads on every focus, because the answer can change outside the app —
 * a reader who leaves for Settings and returns must not come back to a
 * control still offering what they just enabled.
 */
export function useNotificationPermission(): PermissionState {
  const [state, setState] = useState<PermissionState>("unknown");
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void readNotificationPermission().then((p) => { if (alive) setState(p); });
      return () => { alive = false; };
    }, []),
  );
  return state;
}
