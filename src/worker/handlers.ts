import type { PgBoss } from "pg-boss";
import { JOBS, type JobData, type JobName } from "@/lib/jobs";
import { ingestSource } from "@/lib/kb/ingest";

export type Handlers = Partial<{ [N in JobName]: (data: JobData[N]) => Promise<void> }>;

/** Later tasks add their handler to this map. Importing this module has no side effects. */
export const handlers: Handlers = {
  [JOBS.ingestSource]: ({ sourceId }) => ingestSource(sourceId),
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
