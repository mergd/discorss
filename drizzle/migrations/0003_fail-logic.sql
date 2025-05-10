ALTER TABLE "feeds" ADD COLUMN "last_failure_notification_at" timestamp;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "backoff_until" timestamp;