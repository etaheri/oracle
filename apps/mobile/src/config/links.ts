// The share destination. There is no App Store record yet, so this is
// configuration rather than a constant: set EXPO_PUBLIC_SHARE_URL as an EAS
// dashboard environment variable once the ASC app id exists (see
// docs/superpowers/plans/assets/revenue-rites/dashboard-runbook.md §5).
// Absent → the share message ships with no link at all, which is correct;
// a dead link on a share is worse than none.
const raw = process.env.EXPO_PUBLIC_SHARE_URL?.trim();
export const SHARE_URL: string | null = raw && raw.length > 0 ? raw : null;

// App Review requires a reachable privacy link on a subscription paywall,
// and this one does not exist yet — there is no registered domain to host
// it on. Same configuration shape as SHARE_URL above: set
// EXPO_PUBLIC_PRIVACY_URL as an EAS dashboard environment variable once the
// page exists. Absent → the paywall simply does not offer the link; a dead
// link in front of App Review is worse than an absent one.
const rawPrivacy = process.env.EXPO_PUBLIC_PRIVACY_URL?.trim();
export const PRIVACY_URL: string | null = rawPrivacy && rawPrivacy.length > 0 ? rawPrivacy : null;
