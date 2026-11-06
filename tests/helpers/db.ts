import { sql as dsql } from "drizzle-orm";
import { db } from "@/db/client";
import { clearEnqueuedJobs } from "@/lib/jobs";

const TABLES = [
  "rate_limits",
  "leads",
  "monthly_usage",
  "usage_events",
  "messages",
  "conversations",
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
