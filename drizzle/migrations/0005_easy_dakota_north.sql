CREATE TABLE "guilds" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"language" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "use_archive_links" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "last_error_message_at" timestamp;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "ignore_errors" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "disable_failure_notifications" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "language" text;