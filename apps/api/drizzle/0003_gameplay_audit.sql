CREATE TABLE "draft_bank" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_on" date
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "ip_hash" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "crowd_count" integer;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "oracle_p_yes" numeric;--> statement-breakpoint
CREATE INDEX "devices_ip_hash_idx" ON "devices" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "predictions_user_idx" ON "predictions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "questions_round_date_idx" ON "questions" USING btree ("round_date");--> statement-breakpoint
CREATE INDEX "users_oracle_score_idx" ON "users" USING btree ("oracle_score");