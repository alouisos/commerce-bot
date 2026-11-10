import { PgBoss, type Queue, type SendOptions } from "pg-boss";
import { env } from "@/lib/env";

export const JOBS = {
  crawlSite: "crawl-site",
  ingestSource: "ingest-source",
  weeklyRecrawl: "weekly-recrawl",
  generateInsights: "generate-insights",
  dailyInsights: "daily-insights",
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

export type JobData = {
  "crawl-site": { siteId: string };
  "ingest-source": { sourceId: string };
  "weekly-recrawl": Record<string, never>;
  "generate-insights": { siteId: string };
  "daily-insights": Record<string, never>;
};

/** Longest a crawl may run before pg-boss expires it; a "crawling" site older than this is stale. */
export const CRAWL_MAX_SECONDS = 3 * 3600;

/**
 * Per-queue options. crawl-site: a crawl of up to 300 pages can outlast pg-boss's 15-minute default,
 * and a retry would re-crawl from scratch, so it gets 3 hours and no retries. `stately` keeps at most
 * one queued and one active job per singletonKey (the site id), so overlapping requests dedupe.
 */
export const QUEUE_OPTIONS: Partial<Record<JobName, Omit<Queue, "name">>> = {
  [JOBS.crawlSite]: { policy: "stately", expireInSeconds: CRAWL_MAX_SECONDS, retryLimit: 0 },
  // One model call per site; stately dedupes the daily run and manual refreshes of the same site.
  [JOBS.generateInsights]: { policy: "stately", retryLimit: 1, expireInSeconds: 900 },
};

type Recorded = { name: JobName; data: JobData[JobName]; options: SendOptions };
const recorded: Recorded[] = [];

export function enqueuedJobs(): readonly Recorded[] {
  return recorded;
}

export function clearEnqueuedJobs(): void {
  recorded.length = 0;
}

/** Creates every queue, and brings an existing queue's lifetime options up to date (create never updates). */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const name of Object.values(JOBS)) {
    const { policy, ...options } = QUEUE_OPTIONS[name] ?? {};
    await boss.createQueue(name, { policy, ...options });
    if (Object.keys(options).length > 0) await boss.updateQueue(name, options);
    const queue = await boss.getQueue(name);
    if (policy && queue && queue.policy !== policy) {
      // pg-boss cannot change a queue's policy in place; it needs deleteQueue + createQueue (drops its jobs).
      console.warn(`[pg-boss] queue ${name} has policy ${queue.policy}, expected ${policy}; recreate it to dedupe jobs`);
    }
  }
}

const g = globalThis as unknown as { __boss?: Promise<PgBoss> };

export function getBoss(): Promise<PgBoss> {
  g.__boss ??= (async () => {
    const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss" });
    boss.on("error", (err) => console.error("[pg-boss]", err));
    await boss.start();
    await ensureQueues(boss);
    return boss;
  })();
  return g.__boss;
}

export async function enqueue<N extends JobName>(name: N, data: JobData[N], options: SendOptions = {}): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    recorded.push({ name, data, options });
    return;
  }
  const boss = await getBoss();
  await boss.send(name, data, options);
}

/** Enqueues a crawl of the site, deduped per site by pg-boss (see QUEUE_OPTIONS). */
export function enqueueCrawl(siteId: string): Promise<void> {
  return enqueue(JOBS.crawlSite, { siteId }, { singletonKey: siteId });
}
