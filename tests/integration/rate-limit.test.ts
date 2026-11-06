import { beforeEach, describe, expect, it } from "vitest";
import { hit } from "@/lib/usage/rate-limit";
import { resetDb } from "../helpers/db";

beforeEach(resetDb);

describe("hit", () => {
  it("allows up to the limit, then blocks, then allows in a new window", async () => {
    const t = new Date("2026-03-01T10:00:10Z");
    expect(await hit("k", 3, 60, t)).toBe(true);
    expect(await hit("k", 3, 60, t)).toBe(true);
    expect(await hit("k", 3, 60, t)).toBe(true);
    expect(await hit("k", 3, 60, t)).toBe(false);
    expect(await hit("other", 3, 60, t)).toBe(true);
    expect(await hit("k", 3, 60, new Date("2026-03-01T10:01:05Z"))).toBe(true);
  });
  it("is atomic under concurrency", async () => {
    const t = new Date("2026-03-01T10:00:10Z");
    const results = await Promise.all(Array.from({ length: 10 }, () => hit("c", 5, 3600, t)));
    expect(results.filter(Boolean)).toHaveLength(5);
  });
});
