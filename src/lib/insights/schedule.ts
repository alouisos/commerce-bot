import { and, desc, eq, gte, max } from "drizzle-orm";
import { db } from "@/db/client";
import { conversations, siteInsights, usageEvents, type SiteInsight } from "@/db/schema";
import { enqueue, JOBS } from "@/lib/jobs";

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Queues an insights refresh for the site (deduped per site by the queue's stately policy). */
export function enqueueInsights(siteId: string): Promise<void> {
  return enqueue(JOBS.generateInsights, { siteId }, { singletonKey: siteId });
}

/** Queues insights for every site with a conversation in the last 30 days; returns how many. */
export async function dailyInsights(now: Date = new Date()): Promise<number> {
  const rows = await db
    .selectDistinct({ siteId: conversations.siteId })
    .from(conversations)
    .where(gte(conversations.lastMessageAt, new Date(now.getTime() - WINDOW_MS)));
  for (const r of rows) await enqueueInsights(r.siteId);
  return rows.length;
}

/** The site's newest insight, if any. Callers must have checked access to the site. */
export async function latestInsight(siteId: string): Promise<SiteInsight | null> {
  const [row] = await db
    .select()
    .from(siteInsights)
    .where(eq(siteInsights.siteId, siteId))
    .orderBy(desc(siteInsights.createdAt))
    .limit(1);
  return row ?? null;
}

/** When insights were last generated or attempted for the site (a failed run is metered but stores nothing). */
export async function lastInsightsAttempt(siteId: string): Promise<Date | null> {
  const [[insight], [attempt]] = await Promise.all([
    db.select({ at: max(siteInsights.createdAt) }).from(siteInsights).where(eq(siteInsights.siteId, siteId)),
    db
      .select({ at: max(usageEvents.createdAt) })
      .from(usageEvents)
      .where(and(eq(usageEvents.siteId, siteId), eq(usageEvents.kind, "insights"))),
  ]);
  const times = [insight?.at, attempt?.at].filter((d): d is Date => d instanceof Date);
  return times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null;
}
