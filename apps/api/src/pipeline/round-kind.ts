// The round kind (design 2026-09-22 T3): one Worker var, one deploy, and the
// market round stays available. Absent on PipelineDeps means the market
// round, which is what every existing test constructs; buildPipelineDeps
// always sets it, and ITS default is opinion.
import type { PipelineDeps } from "./index";

export type RoundKind = "opinion" | "market";

export function parseRoundKind(raw: string | undefined): RoundKind {
  return raw === "market" ? "market" : "opinion";
}

export function roundKindOf(deps: Pick<PipelineDeps, "roundKind">): RoundKind {
  return deps.roundKind ?? "market";
}

// The site the crowd question points at (design 2026-09-22 §4.2): the URL
// standings.ts already hard-codes, now a var so a rename is one deploy.
export const DEFAULT_SITE_URL = "https://outseen-site.etaheri.workers.dev";

export function parseSiteUrl(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : DEFAULT_SITE_URL;
}

export function siteUrlOf(deps: Pick<PipelineDeps, "siteUrl">): string {
  return deps.siteUrl ?? DEFAULT_SITE_URL;
}
