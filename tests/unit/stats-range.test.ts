import { describe, expect, it } from "vitest";
import { dayKeys, parseRange } from "@/lib/stats/range";

const now = new Date("2026-11-10T15:00:00Z");

describe("parseRange", () => {
  it("defaults to the last 30 days, also for unknown values", () => {
    expect(parseRange(undefined, now).key).toBe("30d");
    expect(parseRange("bogus", now).key).toBe("30d");
    expect(parseRange(["7d", "90d"], now).key).toBe("7d");
    expect(parseRange("30d", now).label).toBe("Last 30 days");
  });

  it("7 days is today plus the 6 previous UTC days, up to now", () => {
    const r = parseRange("7d", now);
    expect(r.days).toBe(7);
    expect(r.label).toBe("Last 7 days");
    expect(r.from.toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(r.to).toEqual(now);
    expect(dayKeys(r)).toEqual([
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
    ]);
  });

  it("90 days has 90 buckets ending today", () => {
    const keys = dayKeys(parseRange("90d", now));
    expect(keys).toHaveLength(90);
    expect(keys.at(-1)).toBe("2026-11-10");
  });
});
