ALTER TABLE "memberships" ADD COLUMN "insights_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "insights_token" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_insights_token_unique" UNIQUE("insights_token");
--> statement-breakpoint
UPDATE "memberships" SET "insights_token" = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') WHERE "insights_token" IS NULL;
