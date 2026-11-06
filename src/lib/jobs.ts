import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";

export const JOBS = {
  crawlSite: "crawl-site",
  ingestSource: "ingest-source",
  weeklyRecrawl: "weekly-recrawl",
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

export type JobData = {
  "crawl-site": { siteId: string };
  "ingest-source": { sourceId: string };
  "weekly-recrawl": Record<string, never>;
};

type Recorded = { name: JobName; data: JobData[JobName] };
const recorded: Recorded[] = [];

export function enqueuedJobs(): readonly Recorded[] {
  return recorded;
}

export function clearEnqueuedJobs(): void {
  recorded.length = 0;
}

const g = globalThis as unknown as { __boss?: Promise<PgBoss> };

export function getBoss(): Promise<PgBoss> {
  g.__boss ??= (async () => {
    const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss" });
    boss.on("error", (err) => console.error("[pg-boss]", err));
    await boss.start();
    for (const name of Object.values(JOBS)) await boss.createQueue(name);
    return boss;
  })();
  return g.__boss;
}

export async function enqueue<N extends JobName>(name: N, data: JobData[N]): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    recorded.push({ name, data });
    return;
  }
  const boss = await getBoss();
  await boss.send(name, data);
}
