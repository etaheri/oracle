ALTER TABLE "users" DROP CONSTRAINT "users_clerk_id_unique";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "clerk_id";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "apple_sub" text UNIQUE;--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
