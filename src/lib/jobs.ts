import { PgBoss, type Queue, type SendOptions } from "pg-boss";
import { env } from "@/lib/env";

export const JOBS = {
  crawlSite: "crawl-site",
  ingestSource: "ingest-source",
  weeklyRecrawl: "weekly-recrawl",
  generateInsights: "generate-insights",
  dailyInsights: "daily-insights",
  emailTick: "email-tick",
  retention: "retention",
  verifyOrder: "verify-order",
  usageNotices: "usage-notices",
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

export type JobData = {
  "crawl-site": { siteId: string };
  "ingest-source": { sourceId: string };
  "weekly-recrawl": Record<string, never>;
  "generate-insights": { siteId: string };
  "daily-insights": Record<string, never>;
  "email-tick": Record<string, never>;
  retention: Record<string, never>;
  "usage-notices": Record<string, never>;
  "verify-order": {
    siteId: string;
    sid: string;
    url: string;
    orderId: string;
    orderKey: string;
    ref: string | null;
    /** ISO time the widget saw the order page. */
    seenAt: string;
    /** Re-checks of a pending order so far. */
    attempt?: number;
  };
};

/** Longest a crawl may run before pg-boss expires it; a "crawling" site older than this is stale. */
export const CRAWL_MAX_SECONDS = 3 * 3600;

/**
 * Per-queue options. crawl-site: a crawl of up to 300 pages can outlast pg-boss's 15-minute default,
 * and a retry would re-crawl from scratch, so it gets 3 hours and no retries. `stately` keeps at most
 * one queued and one active job per singletonKey (the site id), so overlapping requests dedupe.
 */
export const QUEUE_OPTIONS: Partial<Record<JobName, Omit<Queue, "name">>> = {
  // A file that can't be read won't read on a third try; and a stuck parse must not hold the job for 15 min.
  [JOBS.ingestSource]: { retryLimit: 1, expireInSeconds: 300 },
  [JOBS.crawlSite]: { policy: "stately", expireInSeconds: CRAWL_MAX_SECONDS, retryLimit: 0 },
  // One model call per site; stately dedupes the daily run and manual refreshes of the same site.
  [JOBS.generateInsights]: { policy: "stately", retryLimit: 1, expireInSeconds: 900 },
  // One tick at a time; a failed tick is simply picked up by the next one 15 minutes later. A tick may run
  // longer than 15 minutes (up to 50 model calls plus throttled sends), so it isn't expired at pg-boss's
  // 15-minute default, which would let the next tick start beside it.
  [JOBS.emailTick]: { policy: "singleton", retryLimit: 0, expireInSeconds: 3600 },
  // One WooCommerce request; retried with backoff while the shop is unreachable.
  [JOBS.verifyOrder]: { retryLimit: 3, retryDelay: 120, retryBackoff: true, expireInSeconds: 300 },
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
