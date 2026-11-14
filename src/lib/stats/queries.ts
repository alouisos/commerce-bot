import { and, asc, count, countDistinct, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { conversations, leads, messages } from "@/db/schema";
import { dayKeys, type StatsRange } from "./range";

export type Totals = { conversations: number; visitorMessages: number; emailsCaptured: number; unanswered: number };

const zero = (): Totals => ({ conversations: 0, visitorMessages: 0, emailsCaptured: 0, unanswered: 0 });

/** Conversations started in the range, leaving out the owner's test conversations. */
const convInRange = (siteIds: string[], range: StatsRange) =>
  and(
    inArray(conversations.siteId, siteIds),
    eq(conversations.isTest, false),
    gte(conversations.createdAt, range.from),
    lte(conversations.createdAt, range.to),
  );

/**
 * Per-site totals for the range. Conversations count by when they started; visitor messages are those in
 * conversations that started in range; emails captured count leads created in range; unanswered counts
 * conversations (started in range) with at least one fallback reply.
 */
export async function getTotalsBySite(siteIds: string[], range: StatsRange): Promise<Map<string, Totals>> {
  const out = new Map(siteIds.map((id) => [id, zero()]));
  if (siteIds.length === 0) return out;

  const [convRows, msgRows, leadRows] = await Promise.all([
    db
      .select({ siteId: conversations.siteId, n: count() })
      .from(conversations)
      .where(convInRange(siteIds, range))
      .groupBy(conversations.siteId),
    db
      .select({
        siteId: conversations.siteId,
        visitor: sql<number>`count(*) filter (where ${messages.role} = 'visitor')`.mapWith(Number),
        unanswered: sql<number>`count(distinct ${conversations.id}) filter (where ${messages.kind} = 'fallback')`.mapWith(
          Number,
        ),
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(convInRange(siteIds, range))
      .groupBy(conversations.siteId),
    db
      .select({ siteId: leads.siteId, n: count() })
      .from(leads)
      .where(and(inArray(leads.siteId, siteIds), gte(leads.createdAt, range.from), lte(leads.createdAt, range.to)))
      .groupBy(leads.siteId),
  ]);

  for (const r of convRows) out.get(r.siteId)!.conversations = r.n;
  for (const r of msgRows) {
    const t = out.get(r.siteId)!;
    t.visitorMessages = r.visitor;
    t.unanswered = r.unanswered;
  }
  for (const r of leadRows) out.get(r.siteId)!.emailsCaptured = r.n;
  return out;
}

/** Totals summed across the given sites. */
export async function getTotals(siteIds: string[], range: StatsRange): Promise<Totals> {
  const sum = zero();
  for (const t of (await getTotalsBySite(siteIds, range)).values()) {
    sum.conversations += t.conversations;
    sum.visitorMessages += t.visitorMessages;
    sum.emailsCaptured += t.emailsCaptured;
    sum.unanswered += t.unanswered;
  }
  return sum;
}

/** Conversations started per UTC day, one entry for every day of the range. */
export async function getDailyConversations(
  siteIds: string[],
  range: StatsRange,
): Promise<{ day: string; conversations: number }[]> {
  const counts = new Map<string, number>();
  if (siteIds.length > 0) {
    const day = sql<string>`to_char(${conversations.createdAt}, 'YYYY-MM-DD')`;
    const rows = await db
      .select({ day, n: count() })
      .from(conversations)
      .where(convInRange(siteIds, range))
      .groupBy(day);
    for (const r of rows) counts.set(r.day, r.n);
  }
  return dayKeys(range).map((d) => ({ day: d, conversations: counts.get(d) ?? 0 }));
}

/** The pages where most conversations started. */
export async function getTopStartPages(
  siteIds: string[],
  range: StatsRange,
  limit = 5,
): Promise<{ url: string; conversations: number }[]> {
  if (siteIds.length === 0) return [];
  const n = countDistinct(conversations.id);
  const rows = await db
    .select({ url: conversations.firstPageUrl, conversations: n })
    .from(conversations)
    .where(and(convInRange(siteIds, range), isNotNull(conversations.firstPageUrl)))
    .groupBy(conversations.firstPageUrl)
    .orderBy(desc(n), asc(conversations.firstPageUrl))
    .limit(limit);
  return rows.map((r) => ({ url: r.url!, conversations: r.conversations }));
}
