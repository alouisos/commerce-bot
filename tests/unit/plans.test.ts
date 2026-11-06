import { describe, expect, it } from "vitest";
import { MAX_VISITOR_MESSAGES_PER_CONVERSATION, PLAN_LIMITS, planStatus } from "@/lib/plans";
import { quotaState } from "@/lib/usage/quota";

describe("plans", () => {
  it("has the documented limits", () => {
    expect(PLAN_LIMITS.starter).toMatchObject({ websites: 1, conversationsPerMonth: 500, emailsPerMonth: 1000, storageBytes: 100 * 1024 ** 2, admins: 2, autoSendEmails: false, removeBadge: false });
    expect(PLAN_LIMITS.growth).toMatchObject({ websites: 3, conversationsPerMonth: 2000, emailsPerMonth: 5000, storageBytes: 1024 ** 3, admins: 5, autoSendEmails: true, removeBadge: true });
    expect(PLAN_LIMITS.pro).toMatchObject({ websites: 10, conversationsPerMonth: 10000, emailsPerMonth: 25000, storageBytes: 5 * 1024 ** 3, admins: null });
    // Trial has Growth limits except its AI cost ceiling, which is lower (10 USD vs 70 USD).
    const { aiCostCeilingMicros: trialCeiling, ...trialRest } = PLAN_LIMITS.trial;
    const { aiCostCeilingMicros: growthCeiling, ...growthRest } = PLAN_LIMITS.growth;
    expect(trialRest).toEqual(growthRest);
    expect([trialCeiling, growthCeiling]).toEqual([10_000_000, 70_000_000]);
    expect(PLAN_LIMITS.complimentary).toEqual(PLAN_LIMITS.pro);
  });
  it("has a monthly AI cost ceiling per plan, in micro-USD", () => {
    expect(Object.fromEntries(Object.entries(PLAN_LIMITS).map(([k, v]) => [k, v.aiCostCeilingMicros]))).toEqual({
      trial: 10_000_000,
      starter: 25_000_000,
      growth: 70_000_000,
      pro: 180_000_000,
      complimentary: 180_000_000,
    });
    expect(MAX_VISITOR_MESSAGES_PER_CONVERSATION).toBe(40);
  });
  it("planStatus handles trial expiry", () => {
    expect(planStatus({ plan: "trial", trialEndsAt: new Date("2026-11-20") }, new Date("2026-11-21")).expired).toBe(true);
    expect(planStatus({ plan: "trial", trialEndsAt: new Date("2026-11-20") }, new Date("2026-11-20")).expired).toBe(true);
    expect(planStatus({ plan: "trial", trialEndsAt: new Date("2026-11-20") }, new Date("2026-11-19")).expired).toBe(false);
    expect(planStatus({ plan: "trial", trialEndsAt: null }, new Date()).expired).toBe(false);
    expect(planStatus({ plan: "complimentary", trialEndsAt: null }, new Date()).expired).toBe(false);
    expect(planStatus({ plan: "starter", trialEndsAt: new Date("2020-01-01") }, new Date()).expired).toBe(false);
    expect(planStatus({ plan: "pro", trialEndsAt: null }, new Date()).limits).toBe(PLAN_LIMITS.pro);
  });
  it("quotaState thresholds", () => {
    expect([0, 399, 400, 499, 500, 749, 750].map((u) => quotaState(u, 500))).toEqual(["ok", "ok", "warning", "warning", "limit", "limit", "ceiling"]);
    expect(quotaState(0, 0)).toBe("ceiling");
  });
});
