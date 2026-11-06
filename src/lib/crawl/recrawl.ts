import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sites, type Site } from "@/db/schema";
import { CRAWL_MAX_SECONDS, enqueueCrawl } from "@/lib/jobs";

type CrawlState = Pick<Site, "crawlStatus" | "crawlStartedAt">;

/** A crawl is running if it says so and started within the crawl job's lifetime (pg-boss expires it after). */
export function isCrawlRunning(site: CrawlState, now: Date = new Date()): boolean {
  if (site.crawlStatus !== "crawling") return false;
  if (!site.crawlStartedAt) return false;
  return now.getTime() - site.crawlStartedAt.getTime() < CRAWL_MAX_SECONDS * 1000;
}

/** The status to show an admin: a crawl left "crawling" past its lifetime (e.g. a dead worker) is "stale". */
export function crawlStatusLabel(site: CrawlState, now: Date = new Date()): Site["crawlStatus"] | "stale" {
  if (site.crawlStatus === "crawling" && !isCrawlRunning(site, now)) return "stale";
  return site.crawlStatus;
}

/** Enqueues a crawl unless one is already running (a stale one doesn't count). */
export async function recrawlNow(siteId: string): Promise<void> {
  const [site] = await db
    .select({ crawlStatus: sites.crawlStatus, crawlStartedAt: sites.crawlStartedAt })
    .from(sites)
    .where(eq(sites.id, siteId));
  if (!site || isCrawlRunning(site)) return;
  await enqueueCrawl(siteId);
}

export async function weeklyRecrawl(): Promise<void> {
  const all = await db.select({ id: sites.id }).from(sites);
  for (const s of all) await enqueueCrawl(s.id);
}
