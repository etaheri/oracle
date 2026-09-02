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
// Tracks the native OneSignal.initialize() call specifically, separate from
// `ready` (which also requires a successful login) — a retry after a
// device-id miss must never call initialize() a second time.
let initialized = false;

export async function initOneSignal(): Promise<void> {
  if (ready || !KEYS.oneSignalAppId) return;
  const appId = KEYS.oneSignalAppId;
  if (!inflight) {
    inflight = (async () => {
      if (!initialized) {
        OneSignal.Debug.setLogLevel(LogLevel.None);
        OneSignal.initialize(appId);
        initialized = true; // native init must never run twice, even across retries
      }
      const deviceId = await getDeviceId();
      if (!deviceId) {
        // No device token yet (fresh-install race) — login was skipped for
        // this attempt. Don't mark ready: a later call must retry the login
        // rather than silently no-op forever (mirrors the thrown-error path).
        return;
      }
      // external id = device id (spec §5). THE SERVER TARGETS THIS EXACT
      // VALUE: push/compose.ts resolves each user to their device ids and
      // sendPushes passes them as include_aliases.external_id. It used to
      // send user ids here, which matched nothing — every push would have
      // been silently dropped (audit 2026-09-02 §5.2). If this login key ever
      // changes, that resolution changes with it.
      OneSignal.login(deviceId);
      ready = true;
    })().finally(() => { inflight = null; });
  }
  return inflight;
}

// See purchases.resetIdentity — the struck record's device id is gone, and a
// push alias pointing at it would address nobody. The native SDK stays
// initialized (that must never run twice); only the login is dropped, so the
// next initOneSignal logs in as the freshly minted device.
export async function resetIdentity(): Promise<void> {
  if (!ready) return;
  ready = false;
  inflight = null;
  try {
    OneSignal.logout();
  } catch {
    // Nothing to log out of; `ready` is already false, which is what matters.
  }
}

export async function requestPushPermission(): Promise<void> {
  // Self-sufficient: don't assume boot's fire-and-forget init already
  // finished — a tap on the summons screen must not silently no-op while
  // that init is still in flight (or hasn't started).
  await initOneSignal();
  if (!ready) return;
  await OneSignal.Notifications.requestPermission(false); // false: no fallback re-prompt — the summons is the only ask
}
