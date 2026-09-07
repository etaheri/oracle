ALTER TABLE "questions" ADD COLUMN "context" jsonb;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "rules_version" integer DEFAULT 1 NOT NULL;