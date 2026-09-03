CREATE TABLE "user_rounds" (
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"vigil_mult" numeric NOT NULL,
	CONSTRAINT "user_rounds_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
ALTER TABLE "user_rounds" ADD CONSTRAINT "user_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;