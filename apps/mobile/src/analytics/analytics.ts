import PostHog from "posthog-react-native";
import { KEYS } from "../config/keys";

// round_locked and shield_used are server-observed states with no client
// moment to hang a capture() off (a lock is silence, a shield is applied by
// the ledger job) — the PostHog dashboard reads both from reveal views
// instead. Every other event below has a real client-side call site.
export type AnalyticsEvent =
  | "round_opened"
  | "question_answered"
  | "round_locked"
  | "reveal_viewed"
  | "card_shared"
  | "paywall_viewed"
  | "purchase_completed"
  | "shield_used"
  | "record_claimed";

let client: PostHog | null = null;

export function initAnalytics(): void {
  if (client || !KEYS.posthog) return;
  client = new PostHog(KEYS.posthog, { host: KEYS.posthogHost });
}

export function capture(event: AnalyticsEvent, props?: Record<string, unknown>): void {
  // Call sites only ever pass JSON-safe primitives; the cast just bridges
  // our looser public signature (brief's interface) to PostHog's stricter
  // JsonType-keyed properties type.
  client?.capture(event, props as Record<string, string | number | boolean | null>);
}
