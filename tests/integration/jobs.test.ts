import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgBoss } from "pg-boss";
import postgres from "postgres";
import { ensureQueues, JOBS, QUEUE_OPTIONS } from "@/lib/jobs";
import { handlers } from "@/worker/handlers";
import { TEST_DATABASE_URL } from "../test-env";

// A real pg-boss in its own schema of the test database: checks the crawl queue's lifetime settings
// and that singletonKey dedupes queued crawls of one site.
const SCHEMA = "pgboss_jobs_test";
let boss: PgBoss;

async function dropSchema() {
  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await sql.end();
}

beforeAll(async () => {
  await dropSchema();
  boss = new PgBoss({ connectionString: TEST_DATABASE_URL, schema: SCHEMA, supervise: false, schedule: false });
  boss.on("error", () => {});
  await boss.start();
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await dropSchema();
});

describe("job queues", () => {
  it("crawl-site lives up to 3 hours, is not retried, and is stately", async () => {
    expect(QUEUE_OPTIONS[JOBS.crawlSite]).toEqual({ policy: "stately", expireInSeconds: 3 * 3600, retryLimit: 0 });
    await ensureQueues(boss);
    const q = await boss.getQueue(JOBS.crawlSite);
    expect(q).toMatchObject({ policy: "stately", expireInSeconds: 10800, retryLimit: 0 });
  });

  it("updates the lifetime of an existing crawl-site queue", async () => {
    await boss.updateQueue(JOBS.crawlSite, { expireInSeconds: 900, retryLimit: 2 });
    await ensureQueues(boss);
    expect(await boss.getQueue(JOBS.crawlSite)).toMatchObject({ expireInSeconds: 10800, retryLimit: 0 });
  });

  it("a second queued crawl for the same site is dropped; another site's is kept", async () => {
    await ensureQueues(boss);
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    const first = await boss.send(JOBS.crawlSite, { siteId: a }, { singletonKey: a });
    const dup = await boss.send(JOBS.crawlSite, { siteId: a }, { singletonKey: a });
    const other = await boss.send(JOBS.crawlSite, { siteId: b }, { singletonKey: b });
    expect(first).toBeTruthy();
    expect(dup).toBeNull();
    expect(other).toBeTruthy();
  });

  it("email-tick runs one at a time and isn't retried", async () => {
    expect(QUEUE_OPTIONS[JOBS.emailTick]).toEqual({ policy: "singleton", retryLimit: 0 });
    await ensureQueues(boss);
    expect(await boss.getQueue(JOBS.emailTick)).toMatchObject({ policy: "singleton", retryLimit: 0 });
  });

  it("the worker handles the email tick and the nightly retention job", () => {
    expect(JOBS.retention).toBe("retention");
    expect(typeof handlers[JOBS.emailTick]).toBe("function");
    expect(typeof handlers[JOBS.retention]).toBe("function");
  });
});
