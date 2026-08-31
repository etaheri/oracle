// Native-SDK keys. All optional: absent key = that SDK stays dark and the app
// still runs (Global Constraint: degrade, never crash, pre-account).
export const KEYS = {
  rcIos: process.env.EXPO_PUBLIC_RC_IOS_KEY,
  oneSignalAppId: process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID,
  posthog: process.env.EXPO_PUBLIC_POSTHOG_KEY,
  posthogHost: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
} as const;
