import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { monthlyUsage } from "@/db/schema";
import { resetDb } from "../helpers/db";
import { makeAccount, makeSite } from "../helpers/factories";
import { countConversation, getMonthUsage, getQuota, monthKey, recordModelUsage } from "@/lib/usage/meter";
import { costMicros } from "@/lib/ai/pricing";

beforeEach(async () => {
  await resetDb();
});

const nov = new Date("2026-11-06T10:00:00Z");
const dec = new Date("2026-12-01T00:00:00Z");

describe("metering", () => {
  it("monthKey is UTC", () => {
    expect(monthKey(new Date("2026-11-30T23:59:59Z"))).toBe("2026-11");
    expect(monthKey(dec)).toBe("2026-12");
  });
  it("counts per month", async () => {
    const a = await makeAccount();
    expect(await countConversation(a.id, nov)).toBe(1);
    expect(await countConversation(a.id, nov)).toBe(2);
    expect(await countConversation(a.id, dec)).toBe(1);
  });
  it("is atomic under concurrency", async () => {
    const a = await makeAccount();
    await Promise.all(Array.from({ length: 20 }, () => countConversation(a.id, nov)));
    expect((await getMonthUsage(a.id, nov)).conversations).toBe(20);
  });
  it("records model usage cost", async () => {
    const a = await makeAccount();
    const s = await makeSite(a.id);
    const usage = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 };
    await recordModelUsage({ accountId: a.id, siteId: s.id, kind: "chat", model: "claude-opus-5-5", usage, now: nov });
    await recordModelUsage({ accountId: a.id, siteId: null, kind: "image_description", model: "claude-opus-5-5", usage, now: nov });
    const u = await getMonthUsage(a.id, nov);
    expect(u.aiCostMicros).toBe(2 * costMicros("claude-opus-5-5", usage));
    expect(u.conversations).toBe(0);
  });
  it("getQuota", async () => {
    const a = await makeAccount({ plan: "starter" });
    expect(await getQuota(a, nov)).toEqual({
      plan: "starter",
      expired: false,
      used: 0,
      limit: 500,
      state: "ok",
      aiCostMicros: 0,
      aiCostCeilingMicros: 25_000_000,
      aiBudgetReached: false,
    });
    for (let i = 0; i < 400; i++) await countConversation(a.id, nov);
    expect((await getQuota(a, nov)).state).toBe("warning");
  });
  it("getQuota reports the AI budget as reached at the plan's ceiling", async () => {
    const a = await makeAccount({ plan: "starter" });
    await db.insert(monthlyUsage).values({ accountId: a.id, month: monthKey(nov), aiCostMicros: 24_999_999 });
    expect((await getQuota(a, nov)).aiBudgetReached).toBe(false);
    await db.update(monthlyUsage).set({ aiCostMicros: 25_000_000 }).where(eq(monthlyUsage.accountId, a.id));
    expect(await getQuota(a, nov)).toMatchObject({ aiCostMicros: 25_000_000, aiBudgetReached: true, state: "ok" });
    // Next month starts from zero.
    expect((await getQuota(a, dec)).aiBudgetReached).toBe(false);
  });
});
