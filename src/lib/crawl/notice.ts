import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { kbSources, type Site } from "@/db/schema";
import { crawlStatusLabel } from "./recrawl";

export type PageCounts = { ready: number; failed: number; working: number };

/** How long after a crawl finishes the "your website is ready" notice is offered (until dismissed). */
export const READY_NOTICE_MS = 7 * 24 * 60 * 60 * 1000;

export type CrawlNotice =
  | { kind: "queued" }
  | { kind: "crawling"; counts: PageCounts }
  | { kind: "ready"; counts: PageCounts; finishedAt: Date }
  | { kind: "failed" }
  | { kind: "stale" };

type NoticeSite = Pick<Site, "crawlStatus" | "crawlStartedAt" | "lastCrawledAt">;

/** What to tell the admin about the website crawl right now, or null when there is nothing to say. */
export function crawlNotice(site: NoticeSite, counts: PageCounts, now: Date = new Date()): CrawlNotice | null {
  switch (crawlStatusLabel(site, now)) {
    case "crawling":
      return { kind: "crawling", counts };
    case "stale":
      return { kind: "stale" };
    case "failed":
      return { kind: "failed" };
    case "idle":
      // A new site is idle until the worker picks up the crawl that adding it enqueued.
      return site.lastCrawledAt ? null : { kind: "queued" };
    case "done":
      if (site.lastCrawledAt && now.getTime() - site.lastCrawledAt.getTime() < READY_NOTICE_MS) {
        return { kind: "ready", counts, finishedAt: site.lastCrawledAt };
      }
      return null;
  }
}

/** Whether the page should keep refreshing itself for this notice. */
export function noticeIsLive(notice: CrawlNotice | null): boolean {
  return notice?.kind === "crawling" || notice?.kind === "queued";
}

const ZERO: PageCounts = { ready: 0, failed: 0, working: 0 };

/** Crawled-page counts by status for each site (sites with no pages get zeros). */
export async function pageCounts(siteIds: string[]): Promise<Map<string, PageCounts>> {
  const out = new Map(siteIds.map((id) => [id, { ...ZERO }]));
  if (siteIds.length === 0) return out;
  const rows = await db
    .select({ siteId: kbSources.siteId, status: kbSources.status, n: count() })
    .from(kbSources)
    .where(and(inArray(kbSources.siteId, siteIds), eq(kbSources.kind, "page")))
    .groupBy(kbSources.siteId, kbSources.status);
  for (const r of rows) {
    const c = out.get(r.siteId);
    if (!c) continue;
    if (r.status === "ready") c.ready += r.n;
    else if (r.status === "failed") c.failed += r.n;
    else c.working += r.n;
  }
  return out;
}
