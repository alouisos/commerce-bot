import type { PgBoss } from "pg-boss";
import { getBoss, JOBS, type JobData, type JobName } from "@/lib/jobs";

export type Handlers = Partial<{ [N in JobName]: (data: JobData[N]) => Promise<void> }>;

/** Later tasks add their handler to this map. */
export const handlers: Handlers = {};

export async function registerHandlers(boss: PgBoss, map: Handlers): Promise<void> {
  for (const name of Object.values(JOBS)) {
    const handler = map[name] as ((data: unknown) => Promise<void>) | undefined;
    if (!handler) continue;
    await boss.work(name, async (jobs) => {
      for (const job of jobs) await handler(job.data);
    });
  }
}

async function main() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file; rely on the process environment
  }
  const boss = await getBoss();
  await registerHandlers(boss, handlers);
  console.log("[worker] started");
  const stop = async () => {
    await boss.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
