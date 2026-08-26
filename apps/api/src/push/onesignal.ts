// Thin OneSignal REST sender. No keys → clean no-op (the voice exists in-app
// regardless; spec §7). Live sends are hand-verified once EAS builds + keys
// exist — do not attempt to unit-test the HTTP path.
export async function sendPushes(
  env: { ONESIGNAL_APP_ID?: string; ONESIGNAL_API_KEY?: string },
  pushes: ReadonlyArray<{ userId: string; text: string }>,
): Promise<{ sent: number; skipped: number }> {
  if (!env.ONESIGNAL_APP_ID || !env.ONESIGNAL_API_KEY) return { sent: 0, skipped: pushes.length };
  let sent = 0;
  for (const p of pushes) {
    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${env.ONESIGNAL_API_KEY}` },
      body: JSON.stringify({
        app_id: env.ONESIGNAL_APP_ID,
        include_aliases: { external_id: [p.userId] },
        target_channel: "push",
        contents: { en: p.text },
      }),
    });
    if (res.ok) sent++;
  }
  return { sent, skipped: pushes.length - sent };
}
