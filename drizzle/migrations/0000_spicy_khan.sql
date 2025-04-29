CREATE TABLE IF NOT EXISTS "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"name_lower" text NOT NULL,
	"frequency_minutes" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feeds" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"channel_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"nickname" text,
	"category" text,
	"added_by" text NOT NULL,
	"frequency_override_minutes" integer,
	"last_checked" timestamp,
	"last_item_guid" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "categories_guild_name_lower_idx" ON "categories" USING btree ("guild_id", "name_lower");