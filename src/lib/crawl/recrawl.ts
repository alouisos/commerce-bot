import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sites } from "@/db/schema";
import { enqueue, JOBS } from "@/lib/jobs";

/** Enqueues a crawl unless one is already running. */
export async function recrawlNow(siteId: string): Promise<void> {
  const [site] = await db.select({ crawlStatus: sites.crawlStatus }).from(sites).where(eq(sites.id, siteId));
  if (!site || site.crawlStatus === "crawling") return;
  await enqueue(JOBS.crawlSite, { siteId });
}

export async function weeklyRecrawl(): Promise<void> {
  const all = await db.select({ id: sites.id }).from(sites);
  for (const s of all) await enqueue(JOBS.crawlSite, { siteId: s.id });
}
