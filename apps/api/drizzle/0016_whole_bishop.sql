ALTER TABLE "predictions" ADD COLUMN "doubled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_rounds" ADD COLUMN "double_question_id" uuid;--> statement-breakpoint
ALTER TABLE "user_rounds" ADD COLUMN "bust_fortune" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "best_fortune" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "run_started_on" date;--> statement-breakpoint
ALTER TABLE "user_rounds" ADD CONSTRAINT "user_rounds_double_question_id_questions_id_fk" FOREIGN KEY ("double_question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- The stake is fixed at seal (design 2026-09-14 §6.2). The one permitted
-- change is the double: doubled false → true, the stake exactly doubled, and
-- only before settlement. Settlement's own writes (payout, settled_at) never
-- touch the stake and pass through untouched.
CREATE FUNCTION guard_double() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stake IS DISTINCT FROM OLD.stake THEN
    IF OLD.doubled = false AND NEW.doubled = true AND OLD.stake IS NOT NULL AND NEW.stake = OLD.stake * 2 AND OLD.settled_at IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'predictions.stake is fixed at seal; only the double may change it';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guard_double BEFORE UPDATE ON predictions
  FOR EACH ROW EXECUTE FUNCTION guard_double();