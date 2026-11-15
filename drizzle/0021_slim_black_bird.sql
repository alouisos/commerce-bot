ALTER TABLE "sites" ADD COLUMN "personality" text DEFAULT 'friendly' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "personality_notes" text DEFAULT '' NOT NULL;