CREATE TABLE "buyer_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"step" integer NOT NULL,
	"status" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"language" text NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"sent_at" timestamp,
	"provider_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"clicked_at" timestamp,
	"last_clicked_at" timestamp,
	"clicks" integer DEFAULT 0 NOT NULL,
	"feedback_token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "buyer_emails_feedback_token_unique" UNIQUE("feedback_token")
);
--> statement-breakpoint
ALTER TABLE "buyer_emails" ADD CONSTRAINT "buyer_emails_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_emails" ADD CONSTRAINT "buyer_emails_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_emails" ADD CONSTRAINT "buyer_emails_order_id_buyer_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."buyer_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buyer_emails_status_scheduled_idx" ON "buyer_emails" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "buyer_emails_buyer_idx" ON "buyer_emails" USING btree ("buyer_id","created_at");--> statement-breakpoint
CREATE INDEX "buyer_emails_order_idx" ON "buyer_emails" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "buyer_emails_one_open_idx" ON "buyer_emails" USING btree ("buyer_id") WHERE "buyer_emails"."status" in ('draft', 'approved', 'sending');