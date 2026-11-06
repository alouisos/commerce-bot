import { describe, expect, it } from "vitest";
import { PLAN_LIMITS, planStatus } from "@/lib/plans";
import { quotaState } from "@/lib/usage/quota";

describe("plans", () => {
  it("has the documented limits", () => {
    expect(PLAN_LIMITS.starter).toMatchObject({ websites: 1, conversationsPerMonth: 500, emailsPerMonth: 1000, storageBytes: 100 * 1024 ** 2, admins: 2, autoSendEmails: false, removeBadge: false });
    expect(PLAN_LIMITS.growth).toMatchObject({ websites: 3, conversationsPerMonth: 2000, emailsPerMonth: 5000, storageBytes: 1024 ** 3, admins: 5, autoSendEmails: true, removeBadge: true });
    expect(PLAN_LIMITS.pro).toMatchObject({ websites: 10, conversationsPerMonth: 10000, emailsPerMonth: 25000, storageBytes: 5 * 1024 ** 3, admins: null });
    expect(PLAN_LIMITS.trial).toEqual(PLAN_LIMITS.growth);
    expect(PLAN_LIMITS.complimentary).toEqual(PLAN_LIMITS.pro);
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
