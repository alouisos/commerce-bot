import { sql as dsql } from "drizzle-orm";
import { db } from "@/db/client";
import { clearEnqueuedJobs } from "@/lib/jobs";

const TABLES = [
  "account_invites",
  "sales",
  "store_connections",
  "email_messages",
  "contacts",
  "rate_limits",
  "site_insights",
  "prompt_cache",
  "leads",
  "monthly_usage",
  "usage_events",
  "messages",
  "conversations",
  "prompt_impressions",
  "kb_chunks",
  "kb_sources",
  "site_greetings",
  "sites",
  "memberships",
  "accounts",
  "verification",
  "session",
  "account",
  '"user"',
];

export async function resetDb(): Promise<void> {
  await db.execute(dsql.raw(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`));
  clearEnqueuedJobs();
}
