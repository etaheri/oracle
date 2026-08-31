import { OneSignal, LogLevel } from "react-native-onesignal";
import { KEYS } from "../config/keys";
import { getDeviceId } from "../api/auth";

// Missing key = dark, no crash (Global Constraint): every export here is a
// no-op until initOneSignal has actually initialized the native SDK.
let ready = false;

export async function initOneSignal(): Promise<void> {
  if (ready || !KEYS.oneSignalAppId) return;
  OneSignal.Debug.setLogLevel(LogLevel.None);
  OneSignal.initialize(KEYS.oneSignalAppId);
  const deviceId = await getDeviceId();
  if (deviceId) OneSignal.login(deviceId); // external id = device id (spec §5)
  ready = true;
}

export async function requestPushPermission(): Promise<void> {
  if (!ready) return;
  await OneSignal.Notifications.requestPermission(false); // false: no fallback re-prompt — the summons is the only ask
}
