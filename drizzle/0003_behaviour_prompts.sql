CREATE TABLE "prompt_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"url_key" text NOT NULL,
	"kind" text NOT NULL,
	"language" text NOT NULL,
	"text" text,
	"question" text,
	"model" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_impressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"visitor_session_id" text NOT NULL,
	"kind" text NOT NULL,
	"intent" text NOT NULL,
	"confidence" real NOT NULL,
	"language" text NOT NULL,
	"page_url" text NOT NULL,
	"text" text NOT NULL,
	"question" text NOT NULL,
	"shown_at" timestamp,
	"outcome" text,
	"outcome_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "intent" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "intent_confidence" real;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "visit" jsonb;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "prompt_impression_id" uuid;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "proactivity" text DEFAULT 'gentle' NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_cache" ADD CONSTRAINT "prompt_cache_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_impressions" ADD CONSTRAINT "prompt_impressions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_cache_key_idx" ON "prompt_cache" USING btree ("site_id","url_key","kind","language");--> statement-breakpoint
CREATE INDEX "prompt_impressions_site_shown_idx" ON "prompt_impressions" USING btree ("site_id","shown_at");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_prompt_impression_id_prompt_impressions_id_fk" FOREIGN KEY ("prompt_impression_id") REFERENCES "public"."prompt_impressions"("id") ON DELETE set null ON UPDATE no action;