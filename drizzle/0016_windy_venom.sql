CREATE TABLE "buyer_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"ordered_at" timestamp NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"status" text NOT NULL,
	"token" text NOT NULL,
	"ref" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "buyers_token_unique" UNIQUE("token"),
	CONSTRAINT "buyers_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "buyer_emails" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "buyer_emails_since" timestamp;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "orders_polled_at" timestamp;--> statement-breakpoint
ALTER TABLE "buyer_orders" ADD CONSTRAINT "buyer_orders_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_orders" ADD CONSTRAINT "buyer_orders_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "buyer_orders_site_external_idx" ON "buyer_orders" USING btree ("site_id","external_id");--> statement-breakpoint
CREATE INDEX "buyer_orders_buyer_idx" ON "buyer_orders" USING btree ("buyer_id","ordered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "buyers_site_email_idx" ON "buyers" USING btree ("site_id","email");