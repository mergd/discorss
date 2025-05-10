ALTER TABLE "feeds" RENAME COLUMN "last_summary" TO "last_article_summary";--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "last_comments_summary" text;