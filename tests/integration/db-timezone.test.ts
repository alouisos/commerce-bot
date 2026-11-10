import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

describe("database session", () => {
  // Columns are `timestamp without time zone`: now() defaults and JS Dates must agree on UTC,
  // or "UTC day" buckets and the insights up-to-date check drift by the server's offset.
  it("runs in UTC whatever the server's default timezone", async () => {
    const [row] = (await db.execute(sql`select current_setting('TimeZone') as tz`)) as unknown as { tz: string }[];
    expect(row.tz).toBe("UTC");
  });
});
