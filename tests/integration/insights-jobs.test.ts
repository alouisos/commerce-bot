import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db/client";
import { siteInsights } from "@/db/schema";
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

async function insightAt(siteId: string, createdAt: Date) {
  await db.insert(siteInsights).values({
    siteId,
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
    expect(enqueuedJobs()).toEqual([
      { name: JOBS.generateInsights, data: { siteId: active.id }, options: { singletonKey: active.id } },
    ]);
  });
});

describe("refreshInsightsAction", () => {
  it("is not found for a site the user can't access", async () => {
    const other = await makeSite((await makeAccount()).id);
    await memberSite();
    expect(await digest(refreshInsightsAction(other.id))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(enqueuedJobs()).toHaveLength(0);
  });

  it("refuses within an hour of the last insight", async () => {
    const site = await memberSite();
    await insightAt(site.id, new Date(Date.now() - 10 * 60_000));
    expect(await refreshInsightsAction(site.id)).toEqual({
      ok: false,
      error: "Insights were refreshed less than an hour ago.",
    });
    expect(enqueuedJobs()).toHaveLength(0);
  });

  it("enqueues a refresh otherwise", async () => {
    const site = await memberSite();
    await insightAt(site.id, new Date(Date.now() - 2 * 3600_000));
    expect(await refreshInsightsAction(site.id)).toEqual({ ok: true });
    expect(enqueuedJobs()).toEqual([
      { name: JOBS.generateInsights, data: { siteId: site.id }, options: { singletonKey: site.id } },
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

  it("explains insights before there are any", async () => {
    const site = await memberSite();
    const html = renderToStaticMarkup(await InsightsSection({ siteId: site.id }));
    expect(html).toContain("Insights appear after your bot&#x27;s first conversations. They refresh every day.");
  });
});
