CREATE TABLE "entitlements" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"plus_active" boolean DEFAULT false NOT NULL,
	"shields_remaining" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;