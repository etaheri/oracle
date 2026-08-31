import { pgTable, uuid, text, integer, boolean, timestamp, date, numeric, jsonb, uniqueIndex, index, pgEnum } from "drizzle-orm/pg-core";

export const questionStatus = pgEnum("question_status", ["draft", "approved", "scheduled", "open", "locked", "resolved", "void"]);
export const outcome = pgEnum("outcome", ["yes", "no", "void"]);
export const roundStatus = pgEnum("round_status", ["scheduled", "open", "locked", "resolved"]);
export const category = pgEnum("category", ["markets", "sports", "weather", "culture", "news"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").unique(),
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
  // The Oracle's own forecast (skill-weighted aggregate), stamped at lock.
  oracleProbYes: numeric("oracle_p_yes"),
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
