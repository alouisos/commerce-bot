ALTER TABLE "conversations" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_impressions" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;