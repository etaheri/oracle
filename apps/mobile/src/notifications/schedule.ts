import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { planReminders } from "../game/reminders";

// Local closing reminders — no push service. Reseal = cancel everything and
// schedule the next 7 days fresh; runs on every home mount, so drift and
// stale copies never accumulate. All failures are swallowed: a reminder is
// never worth a crash.

const ANDROID_CHANNEL_ID = "default";

// Android 8+ (API 26+) silently drops any notification with no channel —
// the trigger below carries channelId to match. Safe to call every reseal:
// creating an existing channel with the same id is a no-op.
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "Default",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function resealReminders(locksAt: string, roundDate: string, sealedCount: number): Promise<void> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await ensureAndroidChannel();
    await Notifications.cancelAllScheduledNotificationsAsync();
    const now = Date.now();
    for (const r of planReminders(locksAt, roundDate, sealedCount)) {
      if (r.at.getTime() <= now) continue; // inside the 3h window already — no late nag
      await Notifications.scheduleNotificationAsync({
        content: { title: "Outseen", body: r.body },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: r.at,
          ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
        },
      });
    }
  } catch {}
}
