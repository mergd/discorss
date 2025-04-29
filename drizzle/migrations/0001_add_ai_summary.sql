ALTER TABLE "feeds" ADD COLUMN "summarize" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "last_summary" text;