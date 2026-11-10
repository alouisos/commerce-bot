// Daily deletion of data older than each site's retention period. People still subscribed are kept.
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

const PENDING_KEEP_DAYS = 7;

async function deleted(query: ReturnType<typeof sql>): Promise<number> {
  const res = await db.execute(query);
  const r = res as unknown as { count?: number; rowCount?: number };
  return Number(r.count ?? r.rowCount ?? 0);
}

export async function applyRetention(now: Date = new Date()): Promise<{
  conversations: number;
  impressions: number;
  leads: number;
  emails: number;
  contacts: number;
  sales: number;
}> {
  const at = sql`${now.toISOString()}::timestamp`;
  const cutoff = sql`(${at} - make_interval(months => s.retention_months))`;

  // Messages go with their conversations (cascade).
  const conversations = await deleted(sql`
    DELETE FROM conversations c USING sites s
    WHERE c.site_id = s.id AND c.last_message_at < ${cutoff}`);
  const impressions = await deleted(sql`
    DELETE FROM prompt_impressions p USING sites s
    WHERE p.site_id = s.id AND p.created_at < ${cutoff}`);
  // A consent lead stays while that person is still subscribed: it records how they signed up.
  const leads = await deleted(sql`
    DELETE FROM leads l USING sites s
    WHERE l.site_id = s.id AND l.created_at < ${cutoff}
      AND NOT (l.source = 'consent' AND EXISTS (
        SELECT 1 FROM contacts k
        WHERE k.site_id = l.site_id AND k.email = lower(l.email) AND k.status = 'subscribed'))`);
  const emails = await deleted(sql`
    DELETE FROM email_messages e USING sites s
    WHERE e.site_id = s.id AND e.created_at < ${cutoff}`);
  const contacts = await deleted(sql`
    DELETE FROM contacts k USING sites s
    WHERE k.site_id = s.id AND (
      (k.status = 'unsubscribed' AND k.unsubscribed_at < ${cutoff})
      OR (k.status = 'pending' AND k.consented_at < ${at} - make_interval(days => ${PENDING_KEEP_DAYS})))`);
  const sales = await deleted(sql`
    DELETE FROM sales x USING sites s
    WHERE x.site_id = s.id AND x.ordered_at < ${cutoff}`);
  // Rate-limit counters only matter for their window (at most a day).
  await db.execute(sql`DELETE FROM rate_limits WHERE window_start < ${at} - interval '2 days'`);
  return { conversations, impressions, leads, emails, contacts, sales };
}
