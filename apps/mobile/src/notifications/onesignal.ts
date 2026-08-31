import { OneSignal, LogLevel } from "react-native-onesignal";
import { KEYS } from "../config/keys";
import { getDeviceId } from "../api/auth";

// Missing key = dark, no crash (Global Constraint): every export here is a
// no-op until initOneSignal has actually initialized the native SDK.
let ready = false;
// Shared in-flight promise: boot fires initOneSignal() fire-and-forget, but
// a "LET IT SPEAK" tap can land before that resolves. Without this, a
// concurrent second call would either double-initialize the native SDK or
// (if requestPushPermission only checked `ready`) silently no-op and burn
// the once-ever ask on nothing. Every caller awaits the SAME init.
let inflight: Promise<void> | null = null;

export async function initOneSignal(): Promise<void> {
  if (ready || !KEYS.oneSignalAppId) return;
  const appId = KEYS.oneSignalAppId;
  if (!inflight) {
    inflight = (async () => {
      OneSignal.Debug.setLogLevel(LogLevel.None);
      OneSignal.initialize(appId);
      const deviceId = await getDeviceId();
      if (deviceId) OneSignal.login(deviceId); // external id = device id (spec §5)
      ready = true;
    })().finally(() => { inflight = null; });
  }
  return inflight;
}

export async function requestPushPermission(): Promise<void> {
  // Self-sufficient: don't assume boot's fire-and-forget init already
  // finished — a tap on the summons screen must not silently no-op while
  // that init is still in flight (or hasn't started).
  await initOneSignal();
  if (!ready) return;
  await OneSignal.Notifications.requestPermission(false); // false: no fallback re-prompt — the summons is the only ask
}
