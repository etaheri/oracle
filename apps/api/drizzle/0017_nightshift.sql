CREATE TABLE "reactions" (
	"question_id" uuid NOT NULL,
	"member" text NOT NULL,
	"text" text NOT NULL,
	"model" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_question_id_member_pk" PRIMARY KEY("question_id","member")
);
--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "seen_on_label" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "seen_on_url" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "unhinged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;