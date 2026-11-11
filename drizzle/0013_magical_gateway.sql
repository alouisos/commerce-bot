DROP INDEX "site_insights_site_created_idx";--> statement-breakpoint
ALTER TABLE "site_insights" ADD COLUMN "window" text DEFAULT '30d' NOT NULL;--> statement-breakpoint
CREATE INDEX "site_insights_site_window_created_idx" ON "site_insights" USING btree ("site_id","window","created_at");