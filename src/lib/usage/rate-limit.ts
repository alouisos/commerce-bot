import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Fixed-window rate limit held in Postgres. One atomic upsert, so concurrent
 * callers agree on the count. Returns true when the call is allowed.
 */
export async function hit(key: string, limit: number, windowSec: number, now: Date = new Date()): Promise<boolean> {
  const windowStart = new Date(Math.floor(now.getTime() / (windowSec * 1000)) * windowSec * 1000);
  const res = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, ${windowStart.toISOString()}::timestamp, 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < EXCLUDED.window_start THEN 1 ELSE rate_limits.count + 1 END,
      window_start = GREATEST(rate_limits.window_start, EXCLUDED.window_start)
    RETURNING count
  `);
  const row = (res as unknown as { rows?: { count: number }[] }).rows?.[0] ?? (res as unknown as { count: number }[])[0];
  return Number(row.count) <= limit;
}
