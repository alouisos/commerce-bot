import { and, desc, eq, gte, isNull, max } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, conversations, sites, siteInsights, usageEvents, type SiteInsight } from "@/db/schema";
import { enqueue, JOBS } from "@/lib/jobs";
import { INSIGHT_WINDOWS, WINDOW_MS, type InsightWindow } from "./prompt";

/** Queues an insights refresh for one window of the site (deduped per site and window by the queue's stately policy). */
export function enqueueInsights(siteId: string, window: InsightWindow): Promise<void> {
  return enqueue(JOBS.generateInsights, { siteId, window }, { singletonKey: `${siteId}:${window}` });
}

/** Queues all three insight windows for every site with a conversation in the last 30 days; returns how many sites. */
export async function dailyInsights(now: Date = new Date()): Promise<number> {
  const rows = await db
    .selectDistinct({ siteId: conversations.siteId })
    .from(conversations)
    .innerJoin(sites, eq(sites.id, conversations.siteId))
    .innerJoin(accounts, eq(accounts.id, sites.accountId))
    .where(
      and(
        gte(conversations.lastMessageAt, new Date(now.getTime() - WINDOW_MS["30d"])),
        eq(conversations.isTest, false),
        isNull(accounts.removedAt),
      ),
    );
  for (const r of rows) for (const w of INSIGHT_WINDOWS) await enqueueInsights(r.siteId, w);
  return rows.length;
}

/** Whether an insight still describes its window: a quiet site keeps old insights, which must not pass for current ones. */
export function isInsightFresh(insight: { periodTo: Date }, window: InsightWindow, now: Date): boolean {
  return insight.periodTo.getTime() >= now.getTime() - WINDOW_MS[window];
}

/** The site's newest insight for a window, if any. Callers must have checked access to the site. */
export async function latestInsight(siteId: string, window: InsightWindow): Promise<SiteInsight | null> {
  const [row] = await db
    .select()
    .from(siteInsights)
    .where(and(eq(siteInsights.siteId, siteId), eq(siteInsights.window, window)))
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
