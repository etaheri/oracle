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

// The handle printed on the share cards themselves (design 2026-09-09
// §3.2) — a screenshot loses the share text, the pixels do not. A short
// display string, never a full URL: set EXPO_PUBLIC_SHARE_HANDLE once a
// registered domain exists. Absent → the card prints nothing extra. Must be
// ASCII: Skia's Plex Mono has no glyph fallback, and the card would render
// tofu for anything outside it -- so anything outside the printable-ASCII
// range is stripped rather than trusted from the environment.
const rawHandle = process.env.EXPO_PUBLIC_SHARE_HANDLE?.trim();
const ascii = rawHandle?.replace(/[^\x20-\x7E]/g, "").trim();
export const SHARE_HANDLE: string | null = ascii && ascii.length > 0 ? ascii.toUpperCase() : null;
