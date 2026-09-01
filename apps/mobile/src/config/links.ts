// The share destination. There is no App Store record yet, so this is
// configuration rather than a constant: set EXPO_PUBLIC_SHARE_URL as an EAS
// dashboard environment variable once the ASC app id exists (see
// docs/superpowers/plans/assets/revenue-rites/dashboard-runbook.md §5).
// Absent → the share message ships with no link at all, which is correct;
// a dead link on a share is worse than none.
const raw = process.env.EXPO_PUBLIC_SHARE_URL?.trim();
export const SHARE_URL: string | null = raw && raw.length > 0 ? raw : null;
