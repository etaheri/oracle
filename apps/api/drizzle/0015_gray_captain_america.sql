CREATE TABLE "evidence" (
	"question_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"published_at" timestamp with time zone,
	"highlight" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evidence_question_id_rank_pk" PRIMARY KEY("question_id","rank")
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member" text NOT NULL,
	"series_key" text NOT NULL,
	"question_id" uuid NOT NULL,
	"text" text NOT NULL,
	"resolved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lines" (
	"question_id" uuid NOT NULL,
	"member" text NOT NULL,
	"p_yes" numeric NOT NULL,
	"committed_at" timestamp with time zone NOT NULL,
	"model" text,
	"prompt_version" text,
	"reasoning" text,
	"cited" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"lessons_received" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	CONSTRAINT "lines_question_id_member_pk" PRIMARY KEY("question_id","member")
);
--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "market_series_key" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lines" ADD CONSTRAINT "lines_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lessons_member_question_idx" ON "lessons" USING btree ("member","question_id");--> statement-breakpoint
CREATE INDEX "lessons_member_series_idx" ON "lessons" USING btree ("member","series_key","resolved_at");
--> statement-breakpoint
-- The Council commit (design 2026-09-11 §7). Wraps commit_oracle_forecast so
-- the members' rows land in the same statement as oracle_p_yes: the Neon
-- HTTP driver has no interactive transactions, and a function is one.
-- Returns false, writing nothing, when the round is already committed.
CREATE FUNCTION commit_council(
  p_date date, p_snapshot jsonb, p_lines jsonb, p_version text, p_checked_at timestamptz
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  committed boolean;
BEGIN
  committed := commit_oracle_forecast(p_date, p_snapshot, 'council', p_version, p_checked_at);
  IF NOT committed THEN RETURN false; END IF;
  INSERT INTO lines (question_id, member, p_yes, committed_at, model, prompt_version, reasoning, cited, lessons_received)
  SELECT (x->>'question_id')::uuid, x->>'member', (x->>'p_yes')::numeric, p_checked_at,
         x->>'model', x->>'prompt_version', x->>'reasoning',
         coalesce((SELECT array_agg(v::integer) FROM jsonb_array_elements_text(coalesce(x->'cited', '[]'::jsonb)) v), '{}'::integer[]),
         coalesce((SELECT array_agg(v::uuid) FROM jsonb_array_elements_text(coalesce(x->'lessons_received', '[]'::jsonb)) v), '{}'::uuid[])
  FROM jsonb_array_elements(p_lines) x;
  RETURN true;
END;
$$;
--> statement-breakpoint
-- A member's line is a commitment (design 2026-09-11 C4). Deletes are left to
-- the cascade from questions; nothing rewrites a row.
CREATE FUNCTION guard_lines_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lines: a member''s line is immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER lines_immutable BEFORE UPDATE ON lines
  FOR EACH ROW EXECUTE FUNCTION guard_lines_immutable();