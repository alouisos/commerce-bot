import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { promptImpressions } from "@/db/schema";
import type { StatsRange } from "@/lib/stats/range";
import type { PromptKind } from "@/shared/widget-protocol";

export const BACKOFF_WINDOW_DAYS = 14;
const BACKOFF_MIN_SHOWN = 20;
const KINDS: PromptKind[] = ["question", "pairing"];

type Counts = { shown: number; tapped: number; dismissed: number };

async function countByKind(siteId: string, from: Date, to: Date): Promise<Record<PromptKind, Counts>> {
  const rows = await db
    .select({
      kind: promptImpressions.kind,
      shown: sql<number>`count(*)`.mapWith(Number),
      tapped: sql<number>`count(*) filter (where ${promptImpressions.outcome} = 'tapped')`.mapWith(Number),
      dismissed: sql<number>`count(*) filter (where ${promptImpressions.outcome} = 'dismissed')`.mapWith(Number),
    })
    .from(promptImpressions)
    .where(
      and(
        eq(promptImpressions.siteId, siteId),
        eq(promptImpressions.isTest, false),
        isNotNull(promptImpressions.shownAt),
        gte(promptImpressions.shownAt, from),
        lte(promptImpressions.shownAt, to),
      ),
    )
    .groupBy(promptImpressions.kind);
  const out = Object.fromEntries(KINDS.map((k) => [k, { shown: 0, tapped: 0, dismissed: 0 }])) as Record<
    PromptKind,
    Counts
  >;
  for (const r of rows) out[r.kind] = { shown: r.shown, tapped: r.tapped, dismissed: r.dismissed };
  return out;
}

/**
 * Suggestion types the site's visitors keep dismissing (test-tab impressions never count): over the last 14 days, at least 20 shown and
 * half or more dismissed. A paused type resumes by itself as those impressions leave the window.
 */
export async function pausedKinds(siteId: string, now: Date = new Date()): Promise<PromptKind[]> {
  const from = new Date(now.getTime() - BACKOFF_WINDOW_DAYS * 24 * 3600_000);
  const counts = await countByKind(siteId, from, now);
  return KINDS.filter((k) => counts[k].shown >= BACKOFF_MIN_SHOWN && counts[k].dismissed * 2 >= counts[k].shown);
}

/** Shown / tapped / dismissed per suggestion type, by when they were shown. Callers check site access. */
export function promptStats(siteId: string, range: StatsRange): Promise<Record<PromptKind, Counts>> {
  return countByKind(siteId, range.from, range.to);
}
