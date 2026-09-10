ALTER TABLE "predictions" ADD COLUMN "fortune_at_seal" integer;--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "stake" integer;--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "line_p_yes" numeric;--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "payout" integer;--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "line_p_yes" numeric;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "market_source" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "market_id" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "market_event_key" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "market_closes_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "house_delta" integer;--> statement-breakpoint
ALTER TABLE "user_rounds" ADD COLUMN "fortune_at_open" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "fortune" integer DEFAULT 1000 NOT NULL;
--> statement-breakpoint
-- The house line is written once and never rewritten (design 2026-09-10
-- §5.5). Same posture as oracle_p_yes in guard_oracle_question_commitment
-- (0009), enforced here as its own trigger so that function stays untouched.
CREATE FUNCTION guard_house_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.line_p_yes IS NOT NULL AND NEW.line_p_yes IS DISTINCT FROM OLD.line_p_yes THEN
    RAISE EXCEPTION 'line: the house line is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER house_line_guard BEFORE UPDATE ON questions
  FOR EACH ROW EXECUTE FUNCTION guard_house_line();
