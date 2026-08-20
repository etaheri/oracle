CREATE TYPE "public"."category" AS ENUM('markets', 'sports', 'weather', 'culture', 'news');--> statement-breakpoint
CREATE TYPE "public"."outcome" AS ENUM('yes', 'no', 'void');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('draft', 'approved', 'scheduled', 'open', 'locked', 'resolved', 'void');--> statement-breakpoint
CREATE TYPE "public"."round_status" AS ENUM('scheduled', 'open', 'locked', 'resolved');--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"install_token_hash" text NOT NULL,
	"platform" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"answer" boolean NOT NULL,
	"confidence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_hour" boolean DEFAULT false NOT NULL,
	"brier" numeric,
	"points" integer
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_date" date NOT NULL,
	"slot" integer NOT NULL,
	"is_big_one" boolean DEFAULT false NOT NULL,
	"text" text NOT NULL,
	"category" "category" NOT NULL,
	"resolution_criteria" text NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text,
	"opens_at" timestamp with time zone NOT NULL,
	"locks_at" timestamp with time zone NOT NULL,
	"resolve_by" timestamp with time zone NOT NULL,
	"status" "question_status" DEFAULT 'scheduled' NOT NULL,
	"outcome" "outcome",
	"resolved_at" timestamp with time zone,
	"resolution_evidence" jsonb,
	"crowd_yes_pct" numeric,
	"market_prob" numeric
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"date" date PRIMARY KEY NOT NULL,
	"status" "round_status" DEFAULT 'scheduled' NOT NULL,
	"player_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"streak_current" integer DEFAULT 0 NOT NULL,
	"streak_best" integer DEFAULT 0 NOT NULL,
	"free_shield_used_at" date,
	"oracle_score" integer,
	"calls_resolved" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_round_date_rounds_date_fk" FOREIGN KEY ("round_date") REFERENCES "public"."rounds"("date") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "predictions_question_user_unique" ON "predictions" USING btree ("question_id","user_id");