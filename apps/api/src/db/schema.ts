import { pgTable, uuid, text, integer, boolean, timestamp, date, numeric, jsonb, uniqueIndex, index, pgEnum, primaryKey } from "drizzle-orm/pg-core";

export const questionStatus = pgEnum("question_status", ["draft", "approved", "scheduled", "open", "locked", "resolved", "void"]);
export const outcome = pgEnum("outcome", ["yes", "no", "void"]);
export const roundStatus = pgEnum("round_status", ["scheduled", "open", "locked", "resolved"]);
export const category = pgEnum("category", ["markets", "sports", "weather", "culture", "news"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  appleSub: text("apple_sub").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  streakCurrent: integer("streak_current").notNull().default(0),
  streakBest: integer("streak_best").notNull().default(0),
  freeShieldUsedAt: date("free_shield_used_at"),
  oracleScore: integer("oracle_score"),
  callsResolved: integer("calls_resolved").notNull().default(0),
  // Idempotency marker: the latest round date this user's streak has been
  // settled through. Lets a crashed settleRound retry skip finished users
  // (neon-http has no transactions to lean on).
  streakSettledThrough: date("streak_settled_through"),
}, (t) => [index("users_oracle_score_idx").on(t.oracleScore)]);

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  installTokenHash: text("install_token_hash").notNull(),
  platform: text("platform").notNull(),
  // Salted hash of the minting IP — the device-mint throttle's only memory.
  ipHash: text("ip_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("devices_ip_hash_idx").on(t.ipHash, t.createdAt)]);

export const rounds = pgTable("rounds", {
  date: date("date").primaryKey(),
  status: roundStatus("status").notNull().default("scheduled"),
  playerCount: integer("player_count").notNull().default(0),
  // What the gauntlet cost, in candidates (design 2026-09-04 §11.1). Default
  // 0 so every round authored before 0007 reads as "unknown" rather than as a
  // perfect night — the reveal withholds the line entirely at 0.
  candidatesWritten: integer("candidates_written").notNull().default(0),
  candidatesRejected: integer("candidates_rejected").notNull().default(0),
});

export const questions = pgTable("questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  roundDate: date("round_date").notNull().references(() => rounds.date),
  slot: integer("slot").notNull(),
  isBigOne: boolean("is_big_one").notNull().default(false),
  text: text("text").notNull(),
  category: category("category").notNull(),
  resolutionCriteria: text("resolution_criteria").notNull(),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url"),
  opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
  locksAt: timestamp("locks_at", { withTimezone: true }).notNull(),
  // Written at draft time but currently read nowhere and predates the 24h
  // grace period — this is NOT the void deadline. The actual void deadline
  // is computed live as noon ET two days after the round date (see
  // pipeline/state.ts decideActions); do not trust this column for that.
  resolveBy: timestamp("resolve_by", { withTimezone: true }).notNull(),
  status: questionStatus("status").notNull().default("scheduled"),
  outcome: outcome("outcome"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionEvidence: jsonb("resolution_evidence"),
  crowdYesPct: numeric("crowd_yes_pct"),
  // Distinct predictors on this question at resolution — the contrarian
  // floor (CONTRARIAN_MIN_CROWD) is judged against this, never re-derived.
  crowdCount: integer("crowd_count"),
  marketProb: numeric("market_prob"),
  // The author's own P(YES) at draft time — validated 0.3-0.7 and, until
  // 0006, thrown away. Without it nothing could ever score the author's
  // claimed uncertainty against what actually happened, so nothing measured
  // whether the questions were contested (design 2026-09-03 §6). Nullable:
  // every question asked before 0006 predates the column and must stay
  // unscored rather than be imputed a 0.5 nobody stated.
  authorProb: numeric("author_prob"),
  // The Oracle's own forecast (skill-weighted aggregate), stamped at lock.
  oracleProbYes: numeric("oracle_p_yes"),
  // Written ONLY by the in-window probe (pipeline/probe.ts) when it finds the
  // answer already exists and pulls the lock forward. This is why a boolean
  // derived from locks_at will not do: an authored early lock and a healed one
  // both produce locks_at < noon, and only the second is the machine catching
  // a leak in real time (design 2026-09-04 §11.2).
  lockHealedAt: timestamp("lock_healed_at", { withTimezone: true }),
  // The normalized subject of the question ("btc-close-above-threshold"), as
  // stated by the author. The gauntlet's tier-0 dedupe compares against the
  // last TOPIC_KEY_DAYS of these; the text dedupe it replaces let "will BTC
  // close above $X" through every night with a new X.
  topicKey: text("topic_key"),
}, (t) => [index("questions_round_date_idx").on(t.roundDate)]);

export const predictions = pgTable("predictions", {
  id: uuid("id").primaryKey().defaultRandom(),
  questionId: uuid("question_id").notNull().references(() => questions.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  answer: boolean("answer").notNull(),
  confidence: integer("confidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  firstHour: boolean("first_hour").notNull().default(false),
  brier: numeric("brier"),
  points: integer("points"),
}, (t) => [uniqueIndex("predictions_question_user_unique").on(t.questionId, t.userId), index("predictions_user_idx").on(t.userId)]);

// Oracle Plus entitlements (backend spec L55). Written by the RevenueCat
// webhook (Plan 3b); read by streak settlement for paid shields.
export const entitlements = pgTable("entitlements", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  plusActive: boolean("plus_active").notNull().default(false),
  shieldsRemaining: integer("shields_remaining").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Evergreen draft bank: date-agnostic five-question drafts the noon publish
// falls through to when no round is scheduled for today (design spec §6:
// "the drop must never depend on the agent being alive").
export const draftBank = pgTable("draft_bank", {
  id: uuid("id").primaryKey().defaultRandom(),
  draft: jsonb("draft").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  usedOn: date("used_on"),
});

// Processed RevenueCat webhook event ids — the webhook's idempotency marker
// (neon-http has no transactions; insert-first, conflict = already handled).
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per user per round: how heavily the ledger weighed that day.
//
// Stamped once by settleRound from the vigil the player carried INTO the day,
// and never revised -- the reveal computes day_points on read, so a live read
// of users.streak_current would silently rewrite every past day each time the
// streak moved. "NOTHING IS REVISED" is a promise the schema has to keep.
export const userRounds = pgTable("user_rounds", {
  userId: uuid("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  vigilMult: numeric("vigil_mult").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.date] })]);

// The pipeline's daily model-call meter (design 2026-09-04 §9.1). One row per
// ET date, incremented before every model call. An unattended loop with hourly
// retries has no upper bound without it.
export const pipelineSpend = pgTable("pipeline_spend", {
  date: date("date").primaryKey(),
  calls: integer("calls").notNull().default(0),
});
