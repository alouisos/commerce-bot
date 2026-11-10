CREATE TABLE "site_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"period_from" timestamp NOT NULL,
	"period_to" timestamp NOT NULL,
	"conversation_count" integer NOT NULL,
	"content" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_insights" ADD CONSTRAINT "site_insights_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_insights_site_created_idx" ON "site_insights" USING btree ("site_id","created_at");