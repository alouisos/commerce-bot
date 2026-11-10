import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db/client";
import { accounts, monthlyUsage } from "@/db/schema";
import { canSendEmail } from "@/lib/email/domain";
import { PlanLimitError } from "@/lib/errors";
import { addText } from "@/lib/kb/sources";
import { setAccountLimits } from "@/lib/limits";
import { effectiveEmailMode, updateEmailSettings } from "@/lib/site-settings";
import { createSite } from "@/lib/sites";
import { getQuota, monthKey } from "@/lib/usage/meter";
import { buildWidgetConfig } from "@/lib/widget/config";
import { resetDb } from "../helpers/db";
import { makeAccount, makeMembership, makeSite, makeUser } from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "", emailVerified: true } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/access", async (orig) => {
  const mod = await orig<typeof import("@/lib/access")>();
  return {
    ...mod,
    isPlatformOwner: (u: { email: string; emailVerified: boolean }) => mod.isPlatformOwner(u, ["boss@example.com"]),
  };
});

import { saveLimitsAction } from "@/app/owner/actions";
import OwnerAccountPage from "@/app/owner/accounts/[accountId]/page";

beforeEach(resetDb);

const now = new Date();
const reload = async (id: string) => (await db.select().from(accounts).where(eq(accounts.id, id)))[0];
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

async function platformOwner() {
  const u = await makeUser("boss@example.com");
  current.user = { id: u.id, email: u.email, emailVerified: true };
}

describe("limit overrides are honoured by every limit check", () => {
  it("websites", async () => {
    const a = await makeAccount({ plan: "starter" });
    await createSite(a.id, { name: "One", baseUrl: "https://one.example.com" });
    await expect(createSite(a.id, { name: "Two", baseUrl: "https://two.example.com" })).rejects.toBeInstanceOf(PlanLimitError);
    await setAccountLimits(a.id, { websites: 2 });
    await createSite(a.id, { name: "Two", baseUrl: "https://two.example.com" });
  });

  it("the conversation quota", async () => {
    const a = await makeAccount({ plan: "starter" });
    await db.insert(monthlyUsage).values({ accountId: a.id, month: monthKey(now), conversations: 750 });
    expect((await getQuota(await reload(a.id), now)).state).toBe("ceiling");
    await setAccountLimits(a.id, { conversationsPerMonth: 1000 });
    const q = await getQuota(await reload(a.id), now);
    expect(q).toMatchObject({ limit: 1000, state: "ok" });
  });

  it("the AI spend ceiling", async () => {
    const a = await makeAccount({ plan: "starter" });
    await db.insert(monthlyUsage).values({ accountId: a.id, month: monthKey(now), aiCostMicros: 30_000_000 });
    expect((await getQuota(await reload(a.id), now)).aiBudgetReached).toBe(true);
    await setAccountLimits(a.id, { aiCostCeilingMicros: 50_000_000 });
    expect((await getQuota(await reload(a.id), now)).aiBudgetReached).toBe(false);
  });

  it("the monthly email cap", async () => {
    const a = await makeAccount({ plan: "starter" });
    const site = await makeSite(a.id, { sendingDomain: "example.com", sendingDomainStatus: "verified" });
    await db.insert(monthlyUsage).values({ accountId: a.id, month: monthKey(now), emails: 10 });
    expect(await canSendEmail(site, await reload(a.id), now)).toBe(true);
    await setAccountLimits(a.id, { emailsPerMonth: 10 });
    expect(await canSendEmail(site, await reload(a.id), now)).toBe(false);
  });

  it("automatic sending", async () => {
    const a = await makeAccount({ plan: "starter" });
    const site = await makeSite(a.id, { emailMode: "automatic" });
    expect(effectiveEmailMode(site, await reload(a.id))).toBe("approval");
    await setAccountLimits(a.id, { autoSendEmails: true });
    expect(effectiveEmailMode(site, await reload(a.id))).toBe("automatic");
    await updateEmailSettings(site.id, {
      emailMode: "automatic",
      emailIntervalDays: 4,
      emailMaxPerPerson: 3,
      emailFromName: "",
      emailFromLocal: "hello",
      retentionMonths: 24,
      consentMode: "auto",
    });
  });

  it("the badge", async () => {
    const a = await makeAccount({ plan: "starter" });
    const site = await makeSite(a.id);
    expect((await buildWidgetConfig({ ...site, account: await reload(a.id) }, null)).showBadge).toBe(true);
    await setAccountLimits(a.id, { removeBadge: true });
    expect((await buildWidgetConfig({ ...site, account: await reload(a.id) }, null)).showBadge).toBe(false);
  });

  it("storage", async () => {
    const a = await makeAccount({ plan: "starter" });
    const site = await makeSite(a.id);
    await setAccountLimits(a.id, { storageBytes: 1024 });
    await expect(addText(site.id, { title: "Big", text: "x".repeat(2000) })).rejects.toBeInstanceOf(PlanLimitError);
  });
});

describe("the owner's Limits form", () => {
  it("saves overrides, and empty fields go back to the plan", async () => {
    await platformOwner();
    const a = await makeAccount({ plan: "starter" });
    const res = await saveLimitsAction(
      a.id,
      {},
      form({ conversationsPerMonth: "2000", storageMb: "250", websites: "", emailsPerMonth: "", aiCeilingUsd: "", autoSendEmails: "on", removeBadge: "default" }),
    );
    expect(res).toEqual({ saved: true });
    expect((await reload(a.id)).limitOverrides).toEqual({ conversationsPerMonth: 2000, storageBytes: 250 * 1024 * 1024, autoSendEmails: true });
    await saveLimitsAction(a.id, {}, form({ conversationsPerMonth: "", storageMb: "", autoSendEmails: "default", removeBadge: "default" }));
    expect((await reload(a.id)).limitOverrides).toEqual({});
  });

  it("refuses bad numbers", async () => {
    await platformOwner();
    const a = await makeAccount({ plan: "starter" });
    expect((await saveLimitsAction(a.id, {}, form({ conversationsPerMonth: "-5" }))).error).toBeTruthy();
    expect((await saveLimitsAction(a.id, {}, form({ websites: "2.5" }))).error).toBeTruthy();
    expect((await reload(a.id)).limitOverrides).toBeNull();
  });

  it("a customer can't use it", async () => {
    const u = await makeUser("customer@example.com");
    const a = await makeAccount({ plan: "starter" });
    await makeMembership(a.id, u.id);
    current.user = { id: u.id, email: u.email, emailVerified: true };
    let digest: string | undefined;
    try {
      await saveLimitsAction(a.id, {}, form({ conversationsPerMonth: "99999" }));
    } catch (e) {
      digest = (e as { digest?: string }).digest;
    }
    expect(digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect((await reload(a.id)).limitOverrides).toBeNull();
  });

  it("the account page shows the plan defaults as placeholders", async () => {
    await platformOwner();
    const a = await makeAccount({ plan: "starter" });
    const html = renderToStaticMarkup(
      await OwnerAccountPage({ params: Promise.resolve({ accountId: a.id }), searchParams: Promise.resolve({}) } as never),
    );
    expect(html).toContain("Save limits");
    expect(html).toContain('placeholder="500 (plan)"');
  });
});
