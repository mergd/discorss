CREATE TABLE IF NOT EXISTS "feed_failures" (
	"id" serial PRIMARY KEY NOT NULL,
	"feed_id" uuid NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "feeds"
ALTER COLUMN "id"
SET DATA TYPE uuid USING "id"::uuid;
--> statement-breakpoint
ALTER TABLE "feeds"
ADD COLUMN "recent_links" text;
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "feed_failures"
ADD CONSTRAINT "feed_failures_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
WHEN duplicate_object THEN null;
END $$;