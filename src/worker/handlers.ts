import type { PgBoss } from "pg-boss";
import { JOBS, type JobData, type JobName } from "@/lib/jobs";
import { crawlSite } from "@/lib/crawl/crawl-site";
import { weeklyRecrawl } from "@/lib/crawl/recrawl";
import { emailTick } from "@/lib/email/schedule";
import { generateSiteInsights } from "@/lib/insights/generate";
import { dailyInsights } from "@/lib/insights/schedule";
import { ingestSource } from "@/lib/kb/ingest";

export type Handlers = Partial<{ [N in JobName]: (data: JobData[N]) => Promise<void> }>;

/** Later tasks add their handler to this map. Importing this module has no side effects. */
export const handlers: Handlers = {
  [JOBS.ingestSource]: ({ sourceId }) => ingestSource(sourceId),
  [JOBS.crawlSite]: async ({ siteId }) => {
    await crawlSite(siteId);
  },
  [JOBS.weeklyRecrawl]: () => weeklyRecrawl(),
  [JOBS.generateInsights]: async ({ siteId }) => {
    const out = await generateSiteInsights(siteId);
    console.log(`[insights] ${siteId}: ${out.status === "created" ? "created" : `skipped (${out.reason})`}`);
  },
  [JOBS.dailyInsights]: async () => {
    await dailyInsights();
  },
  [JOBS.emailTick]: async () => {
    const out = await emailTick();
    if (out.drafted || out.sent || out.skipped) console.log(`[email] drafted ${out.drafted}, sent ${out.sent}, skipped ${out.skipped}`);
  },
};

export async function registerHandlers(boss: PgBoss, map: Handlers): Promise<void> {
  for (const name of Object.values(JOBS)) {
    const handler = map[name] as ((data: unknown) => Promise<void>) | undefined;
    if (!handler) continue;
    // One job per call, so a failing job does not fail the others.
    await boss.work(name, { batchSize: 1 }, async (jobs) => {
      for (const job of jobs) await handler(job.data);
    });
  }
}
