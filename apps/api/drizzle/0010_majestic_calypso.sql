CREATE TABLE "pipeline_usage" (
	"date" date NOT NULL,
	"model" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"web_searches" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pipeline_usage_date_model_pk" PRIMARY KEY("date","model")
);
