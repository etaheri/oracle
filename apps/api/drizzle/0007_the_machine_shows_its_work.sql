CREATE TABLE "pipeline_spend" (
	"date" date PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "lock_healed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "topic_key" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "candidates_written" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "candidates_rejected" integer DEFAULT 0 NOT NULL;