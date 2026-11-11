import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db/client";
import { siteInsights, usageEvents } from "@/db/schema";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeMembership, makeSite, makeUser } from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "", emailVerified: true } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { enqueuedJobs, JOBS, QUEUE_OPTIONS } from "@/lib/jobs";
import { dailyInsights } from "@/lib/insights/schedule";
import { refreshInsightsAction } from "@/app/app/sites/[siteId]/overview/actions";
import { InsightsSection } from "@/app/app/sites/[siteId]/overview/insights-section";
import { handlers } from "@/worker/handlers";

beforeEach(resetDb);

const DAY = 24 * 3600_000;

async function memberSite() {
  const u = await makeUser();
  const account = await makeAccount();
  await makeMembership(account.id, u.id);
  current.user = { id: u.id, email: u.email, emailVerified: true };
  return makeSite(account.id);
}

async function insightAt(siteId: string, createdAt: Date, window: "24h" | "7d" | "30d" = "24h") {
  await db.insert(siteInsights).values({
    siteId,
    window,
    periodFrom: new Date(createdAt.getTime() - 30 * DAY),
    periodTo: createdAt,
    conversationCount: 4,
    model: "claude-opus-5-5",
    createdAt,
    content: {
      summary: "Visitors want help choosing a shampoo.",
      topQuestions: [{ topic: "Dry hair", detail: "Which product for dry hair" }],
      knowledgeGaps: [{ question: "Do you ship to Cyprus?", suggestion: "Add your shipping countries" }],
      objections: [],
      curiousProducts: [],
    },
  });
}

async function digest(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return (e as { digest?: string }).digest;
  }
}

describe("insight jobs", () => {
  it("the generate queue is stately with one retry", () => {
    expect(QUEUE_OPTIONS[JOBS.generateInsights]).toEqual({ policy: "stately", retryLimit: 1, expireInSeconds: 900 });
    expect(handlers[JOBS.generateInsights]).toBeTypeOf("function");
    expect(handlers[JOBS.dailyInsights]).toBeTypeOf("function");
  });

  it("the daily job enqueues sites with a conversation in the last 30 days", async () => {
    const account = await makeAccount();
    const active = await makeSite(account.id);
    const quiet = await makeSite(account.id);
    await makeSite(account.id);
    await makeConversation(active.id, { lastMessageAt: new Date(Date.now() - 2 * DAY) });
    await makeConversation(active.id, { lastMessageAt: new Date(Date.now() - 3 * DAY) });
    await makeConversation(quiet.id, { lastMessageAt: new Date(Date.now() - 40 * DAY) });
    expect(await dailyInsights()).toBe(1);
    expect(enqueuedJobs()).toEqual(
      (["24h", "7d", "30d"] as const).map((window) => ({
        name: JOBS.generateInsights,
        data: { siteId: active.id, window },
        options: { singletonKey: `${active.id}:${window}` },
      })),
    );
  });
});

describe("refreshInsightsAction", () => {
  it("is not found for a site the user can't access", async () => {
    const other = await makeSite((await makeAccount()).id);
    await memberSite();
    expect(await digest(refreshInsightsAction(other.id, "24h"))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(enqueuedJobs()).toHaveLength(0);
  });

  it("refuses within an hour of the last insight", async () => {
    const site = await memberSite();
    await insightAt(site.id, new Date(Date.now() - 10 * 60_000));
    expect(await refreshInsightsAction(site.id, "7d")).toEqual({
      ok: false,
      error: "Insights were refreshed less than an hour ago.",
    });
    expect(enqueuedJobs()).toHaveLength(0);
  });

  it("also counts a failed attempt in the last hour (it was metered but stored nothing)", async () => {
    const site = await memberSite();
    await insightAt(site.id, new Date(Date.now() - 5 * 3600_000));
    await db.insert(usageEvents).values({
      accountId: site.accountId,
      siteId: site.id,
      kind: "insights",
      model: "claude-opus-5-5",
      createdAt: new Date(Date.now() - 10 * 60_000),
    });
    expect(await refreshInsightsAction(site.id, "7d")).toEqual({
      ok: false,
      error: "Insights were refreshed less than an hour ago.",
    });
    expect(enqueuedJobs()).toHaveLength(0);
  });

  it("enqueues a refresh otherwise", async () => {
    const site = await memberSite();
    await insightAt(site.id, new Date(Date.now() - 2 * 3600_000));
    expect(await refreshInsightsAction(site.id, "7d")).toEqual({ ok: true });
    expect(enqueuedJobs()).toEqual([
      { name: JOBS.generateInsights, data: { siteId: site.id, window: "7d" }, options: { singletonKey: `${site.id}:7d` } },
    ]);
  });
});

describe("InsightsSection", () => {
  it("shows the latest insight with its knowledge gaps", async () => {
    const site = await memberSite();
    await insightAt(site.id, new Date(Date.now() - 2 * 3600_000));
    const html = renderToStaticMarkup(await InsightsSection({ siteId: site.id }));
    expect(html).toContain("from 4 conversations");
    expect(html).toContain("Visitors want help choosing a shampoo.");
    expect(html).toContain("What people ask most");
    expect(html).toContain("Questions the bot couldn&#x27;t answer well");
    expect(html).toContain("Do you ship to Cyprus?");
    expect(html).toContain("Add your shipping countries");
    expect(html).toContain(`href="/app/sites/${site.id}/knowledge"`);
    expect(html).not.toContain("Worries before buying");
    expect(html).toContain("Refresh");
  });

  it("shows only the chosen window and marks it current", async () => {
    const site = await memberSite();
    await insightAt(site.id, new Date(Date.now() - 2 * 3600_000), "7d");
    const week = renderToStaticMarkup(await InsightsSection({ siteId: site.id, window: "7d", params: { range: "30d" } }));
    expect(week).toContain("Visitors want help choosing a shampoo.");
    expect(week).toMatch(/aria-current="page"[^>]*>7 days</);
    expect(week).toContain("range=30d&amp;insights=24h");
    const day = renderToStaticMarkup(await InsightsSection({ siteId: site.id, window: "24h" }));
    expect(day).not.toContain("Visitors want help choosing a shampoo.");
    expect(day).toContain("Not enough conversations in this period");
  });

  it("says insights are paused and disables Refresh when the owner budget is used up", async () => {
    const site = await memberSite();
    const { accounts } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(accounts).set({ plan: "trial", trialEndsAt: new Date(Date.now() - 1000) }).where(eq(accounts.id, site.accountId));
    const html = renderToStaticMarkup(await InsightsSection({ siteId: site.id }));
    expect(html).toContain("Insights are paused until next month: this month&#x27;s owner AI budget is used up.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Refresh/);
  });

  it("explains insights before there are any", async () => {
    const site = await memberSite();
    const html = renderToStaticMarkup(await InsightsSection({ siteId: site.id }));
    expect(html).toContain("Insights appear after your bot&#x27;s first conversations. They refresh every day.");
  });
});

describe("dailyInsights and removed customers", () => {
  it("queues nothing for a removed account's site", async () => {
    const { accounts } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const site = await memberSite();
    await makeConversation(site.id, { lastMessageAt: new Date() });
    await db.update(accounts).set({ removedAt: new Date() }).where(eq(accounts.id, site.accountId));
    expect(await dailyInsights()).toBe(0);
    expect(enqueuedJobs().filter((j) => j.name === JOBS.generateInsights)).toHaveLength(0);
  });
});
