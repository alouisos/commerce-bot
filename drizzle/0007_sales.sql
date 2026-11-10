CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text,
	"verified" boolean NOT NULL,
	"amount_minor" bigint,
	"currency" text,
	"ordered_at" timestamp NOT NULL,
	"visitor_session_id" text NOT NULL,
	"page_url" text NOT NULL,
	"via_chat" boolean DEFAULT false NOT NULL,
	"via_prompt" boolean DEFAULT false NOT NULL,
	"via_email" boolean DEFAULT false NOT NULL,
	"conversation_id" uuid,
	"prompt_impression_id" uuid,
	"contact_id" uuid,
	"email_message_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"store_url" text NOT NULL,
	"consumer_key" text NOT NULL,
	"consumer_secret_enc" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"verified_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "store_connections_site_id_unique" UNIQUE("site_id")
);
--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_prompt_impression_id_prompt_impressions_id_fk" FOREIGN KEY ("prompt_impression_id") REFERENCES "public"."prompt_impressions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_email_message_id_email_messages_id_fk" FOREIGN KEY ("email_message_id") REFERENCES "public"."email_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_connections" ADD CONSTRAINT "store_connections_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_idx" ON "sales" USING btree ("site_id","source","external_id") WHERE "sales"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_page_idx" ON "sales" USING btree ("site_id","visitor_session_id","page_url") WHERE "sales"."external_id" is null;--> statement-breakpoint
CREATE INDEX "sales_site_ordered_idx" ON "sales" USING btree ("site_id","ordered_at");