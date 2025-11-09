DO $$ BEGIN
ALTER TABLE "feeds" ADD COLUMN "use_archive_links" boolean DEFAULT false NOT NULL;
EXCEPTION
WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "feeds" ADD COLUMN "last_error_message_at" timestamp;
EXCEPTION
WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "feeds" ADD COLUMN "ignore_errors" boolean DEFAULT false NOT NULL;
EXCEPTION
WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "feeds" ADD COLUMN "disable_failure_notifications" boolean DEFAULT false NOT NULL;
EXCEPTION
WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "feeds" ADD COLUMN "disabled" boolean DEFAULT false NOT NULL;
EXCEPTION
WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "feeds" ADD COLUMN "language" text;
EXCEPTION
WHEN duplicate_column THEN null;
END $$;