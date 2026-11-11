CREATE TABLE "buyer_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"buyer_email_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "buyer_feedback_rating_check" CHECK ("buyer_feedback"."rating" between 1 and 5),
	CONSTRAINT "buyer_feedback_comment_check" CHECK (char_length("buyer_feedback"."comment") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "buyer_feedback" ADD CONSTRAINT "buyer_feedback_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_feedback" ADD CONSTRAINT "buyer_feedback_buyer_email_id_buyer_emails_id_fk" FOREIGN KEY ("buyer_email_id") REFERENCES "public"."buyer_emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "buyer_feedback_email_idx" ON "buyer_feedback" USING btree ("buyer_email_id");--> statement-breakpoint
CREATE INDEX "buyer_feedback_site_idx" ON "buyer_feedback" USING btree ("site_id","created_at");