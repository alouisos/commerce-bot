CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"email" text NOT NULL,
	"language" text NOT NULL,
	"status" text NOT NULL,
	"consent_text" text NOT NULL,
	"consent_language" text NOT NULL,
	"consented_at" timestamp NOT NULL,
	"confirmed_at" timestamp,
	"unsubscribed_at" timestamp,
	"token" text NOT NULL,
	"ref" text NOT NULL,
	"sequence_conversation_id" uuid,
	"sequence_started_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_token_unique" UNIQUE("token"),
	CONSTRAINT "contacts_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid,
	"step" integer NOT NULL,
	"status" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"language" text NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"sent_at" timestamp,
	"provider_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"clicked_at" timestamp,
	"clicks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "monthly_usage" ADD COLUMN "emails" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "email_mode" text DEFAULT 'approval' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "email_interval_days" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "email_max_per_person" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "email_from_name" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "email_from_local" text DEFAULT 'hello' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "sending_domain" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "sending_domain_id" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "sending_domain_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "retention_months" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "consent_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_sequence_conversation_id_conversations_id_fk" FOREIGN KEY ("sequence_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_site_email_idx" ON "contacts" USING btree ("site_id","email");--> statement-breakpoint
CREATE INDEX "email_messages_status_scheduled_idx" ON "email_messages" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "email_messages_contact_idx" ON "email_messages" USING btree ("contact_id","created_at");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;