// Thin Telegram bot sender for pipeline alerts (spec §11). No token/chatId →
// clean no-op, imitating the OneSignal no-op precedent (src/push/onesignal.ts):
// the pipeline must run identically whether or not alerting is configured.
// Send failures are caught and logged — alerts are never load-bearing.
export interface TelegramClient { send(text: string): Promise<void> }

export function makeTelegramClient(
  botToken: string | undefined,
  chatId: string | undefined,
  fetchFn: typeof fetch = fetch,
): TelegramClient {
  return {
    async send(text: string): Promise<void> {
      if (!botToken || !chatId) {
        console.log("[telegram] no-op (missing botToken/chatId):", text);
        return;
      }
      try {
        const res = await fetchFn(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
        });
        if (!res.ok) {
          const bodyText = await res.text().catch(() => "");
          console.error("[telegram] send failed:", res.status, bodyText);
        }
      } catch (err) {
        console.error("[telegram] send failed:", err);
      }
    },
  };
}
