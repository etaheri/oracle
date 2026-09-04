// The candidate — what the author produces now, in surplus, before anything
// has decided which five will run (design 2026-09-04 §3).
//
// A candidate is a DraftQuestion minus the two fields selection assigns (slot,
// is_big_one) plus the one the dedupe needs (topic_key). Keeping the two shapes
// separate is what lets a rejection in one category be SUBSTITUTED rather than
// re-authored: nothing about a candidate commits it to a position in a round.
import { z } from "zod";
import { and, gte, isNotNull, lt } from "drizzle-orm";
import { schema, type Db } from "../db/client";
import { addDays } from "./clock";
import { RESOLVES_AFTER_LOCK } from "./draft";

// A repeated subject is the dedupe the text comparison never caught: "will BTC
// close above $X" passed it every night with a new X (audit 2026-09-01 §2.5).
export const TOPIC_KEY_DAYS = 7;

export const CandidateSchema = z
  .object({
    category: z.enum(["markets", "sports", "weather", "culture", "news"]),
    text: z.string().min(10),
    resolution_criteria: z.string().min(10),
    source_name: z.string().min(1),
    source_url: z.string().url(),
    author_probability: z.number().min(0.3).max(0.7),
    market_prob: z.number().min(0).max(1).nullable().default(null),
    resolves_at: z.union([z.iso.datetime({ offset: true }), z.literal(RESOLVES_AFTER_LOCK)]),
    // A NORMALIZED SUBJECT, not the question text: "btc-close-above-threshold",
    // never "Will BTC close above $70,000 on Friday?".
    topic_key: z.string().min(3).max(64).regex(/^[a-z0-9-]+$/),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.category === "weather" && q.resolves_at === RESOLVES_AFTER_LOCK) {
      ctx.addIssue({ code: "custom", message: "weather must name a resolves_at instant", path: ["resolves_at"] });
    }
  });

export type Candidate = z.infer<typeof CandidateSchema>;

export const REJECT_REASONS = [
  "structural",
  "duplicate-topic",
  "compound",
  "dead-source",
  "ambiguous",
  "uncontested",
  "already-resolvable",
  "taste",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export interface Rejection { text: string; reason: RejectReason; detail: string }
export interface Screened { passed: Candidate[]; rejected: Rejection[] }

export function emptyTally(): Record<RejectReason, number> {
  return Object.fromEntries(REJECT_REASONS.map((r) => [r, 0])) as Record<RejectReason, number>;
}

// A literal scan, deliberately. Detecting whether two PREDICATES are joined
// needs a parser this project will not have, and surplus is exactly what makes
// over-rejection affordable — that is the argument of §3.1. A false rejection
// costs one of fourteen candidates; a compound question that ships costs a
// day's ledger entry that two careful readers can answer differently.
const COMPOUND = /\s(and|or)\s/i;

function textOf(raw: unknown): string {
  if (raw && typeof raw === "object" && typeof (raw as { text?: unknown }).text === "string") {
    return (raw as { text: string }).text;
  }
  return "(unparseable candidate)";
}

export function screenCandidates(
  raw: unknown[],
  opts: { opensAt: Date; locksAtDefault: Date; recentTopicKeys: ReadonlySet<string> },
): Screened {
  const passed: Candidate[] = [];
  const rejected: Rejection[] = [];
  // A key repeated INSIDE one batch is as much a repeat as one from last week;
  // the first occurrence wins and every later one is put down.
  const seen = new Set<string>(opts.recentTopicKeys);

  for (const item of raw) {
    const parsed = CandidateSchema.safeParse(item);
    if (!parsed.success) {
      rejected.push({
        text: textOf(item),
        reason: "structural",
        detail: parsed.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("; "),
      });
      continue;
    }
    const c = parsed.data;

    if (c.resolves_at !== RESOLVES_AFTER_LOCK) {
      const t = new Date(c.resolves_at);
      if (Number.isNaN(t.getTime()) || t.getTime() <= opts.opensAt.getTime()) {
        rejected.push({ text: c.text, reason: "structural", detail: "resolves_at is at or before the round opens" });
        continue;
      }
      if (t.getTime() > opts.locksAtDefault.getTime()) {
        rejected.push({ text: c.text, reason: "structural", detail: "resolves_at runs past the round's own close" });
        continue;
      }
    }

    if (seen.has(c.topic_key)) {
      rejected.push({ text: c.text, reason: "duplicate-topic", detail: `topic_key "${c.topic_key}" ran within ${TOPIC_KEY_DAYS} days` });
      continue;
    }

    if (COMPOUND.test(c.text)) {
      rejected.push({ text: c.text, reason: "compound", detail: "two clauses joined by and/or" });
      continue;
    }

    seen.add(c.topic_key);
    passed.push(c);
  }

  return { passed, rejected };
}

export async function recentTopicKeys(db: Db, date: string): Promise<Set<string>> {
  const since = addDays(date, -TOPIC_KEY_DAYS);
  const rows = await db.query.questions.findMany({
    where: and(
      gte(schema.questions.roundDate, since),
      lt(schema.questions.roundDate, date),
      isNotNull(schema.questions.topicKey),
    ),
    columns: { topicKey: true },
  });
  return new Set(rows.map((r) => r.topicKey!).filter((k) => k.length > 0));
}
