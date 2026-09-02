// Thin OneSignal REST sender. No keys → clean no-op (the voice exists in-app
// regardless; spec §7). Live sends are hand-verified once EAS builds + keys
// exist — do not attempt to unit-test the HTTP path.
export interface PushEnv {
  ONESIGNAL_APP_ID?: string;
  ONESIGNAL_API_KEY?: string;
}

export interface OutboundPush {
  /** OneSignal external_id aliases to deliver this one line to — a player's
   *  devices. The client logs in as its DEVICE id (notifications/onesignal.ts),
   *  never its user id; targeting user ids was a silent no-delivery bug for as
   *  long as this file existed unwired (audit 2026-09-02 §5.2). */
  externalIds: ReadonlyArray<string>;
  text: string;
}

export async function sendPushes(
  env: PushEnv,
  pushes: ReadonlyArray<OutboundPush>,
): Promise<{ sent: number; skipped: number }> {
  // A push with no reachable device is not a failure to report — it is a
  // player whose devices are gone. It still counts as skipped so the settle
  // report's arithmetic adds up.
  const deliverable = pushes.filter((p) => p.externalIds.length > 0);
  if (!env.ONESIGNAL_APP_ID || !env.ONESIGNAL_API_KEY) return { sent: 0, skipped: pushes.length };
  let sent = 0;
  for (const p of deliverable) {
    try {
      const res = await fetch("https://onesignal.com/api/v1/notifications", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Basic ${env.ONESIGNAL_API_KEY}` },
        body: JSON.stringify({
          app_id: env.ONESIGNAL_APP_ID,
          include_aliases: { external_id: [...p.externalIds] },
          target_channel: "push",
          contents: { en: p.text },
        }),
      });
      if (res.ok) sent++;
    } catch {
      // spec §7: an unreachable OneSignal skips the push, never the batch
    }
  }
  return { sent, skipped: pushes.length - sent };
}
