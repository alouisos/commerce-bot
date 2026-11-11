import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { monthlyUsage } from "@/db/schema";
import { resetDb } from "../helpers/db";
import { makeAccount, makeSite } from "../helpers/factories";
import {
  aiBlocked,
  countConversation,
  countEmailSent,
  getMonthUsage,
  getQuota,
  monthKey,
  OWNER_KINDS,
  ownerAiBlocked,
  recordModelUsage,
} from "@/lib/usage/meter";
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
  it("counts sent emails per month", async () => {
    const a = await makeAccount();
    expect(await countEmailSent(a.id, nov)).toBe(1);
    expect(await countEmailSent(a.id, nov)).toBe(2);
    expect(await countEmailSent(a.id, dec)).toBe(1);
    expect(await getMonthUsage(a.id, nov)).toMatchObject({ emails: 2, conversations: 0 });
  });
  describe("owner AI budget", () => {
    const usage = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 };
    it("lists the owner kinds", () => {
      expect([...OWNER_KINDS]).toEqual(["insights", "ask", "buyer_email"]);
    });
    it("meters owner kinds to ownerAiCostMicros, never to the visitor budget", async () => {
      const a = await makeAccount({ plan: "starter" });
      const s = await makeSite(a.id);
      const cost = costMicros("claude-opus-5-5", usage);
      for (const kind of OWNER_KINDS) {
        await recordModelUsage({ accountId: a.id, siteId: s.id, kind, model: "claude-opus-5-5", usage, now: nov });
      }
      expect(await getMonthUsage(a.id, nov)).toMatchObject({ aiCostMicros: 0, ownerAiCostMicros: 3 * cost });
    });
    it("still meters chat to aiCostMicros", async () => {
      const a = await makeAccount({ plan: "starter" });
      await recordModelUsage({ accountId: a.id, siteId: null, kind: "chat", model: "claude-opus-5-5", usage, now: nov });
      expect(await getMonthUsage(a.id, nov)).toMatchObject({
        aiCostMicros: costMicros("claude-opus-5-5", usage),
        ownerAiCostMicros: 0,
      });
    });
    it("owner spend past the visitor ceiling leaves the bot on AI", async () => {
      const a = await makeAccount({ plan: "starter" });
      await db.insert(monthlyUsage).values({ accountId: a.id, month: monthKey(nov), ownerAiCostMicros: 500_000_000 });
      expect(aiBlocked(await getQuota(a, nov))).toBe(false);
      expect(await ownerAiBlocked(a, nov)).toBe(true);
    });
    it("ownerAiBlocked flips at the plan's owner ceiling and resets next month", async () => {
      const a = await makeAccount({ plan: "starter" });
      await db.insert(monthlyUsage).values({ accountId: a.id, month: monthKey(nov), ownerAiCostMicros: 4_999_999 });
      expect(await ownerAiBlocked(a, nov)).toBe(false);
      await db.update(monthlyUsage).set({ ownerAiCostMicros: 5_000_000 }).where(eq(monthlyUsage.accountId, a.id));
      expect(await ownerAiBlocked(a, nov)).toBe(true);
      expect(await ownerAiBlocked(a, dec)).toBe(false);
    });
    it("ownerAiBlocked is true for an expired trial", async () => {
      const a = await makeAccount({ plan: "trial", trialEndsAt: new Date("2026-11-01T00:00:00Z") });
      expect(await ownerAiBlocked(a, nov)).toBe(true);
    });
  });
});
