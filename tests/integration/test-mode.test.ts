import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { conversations, monthlyUsage, promptImpressions } from "@/db/schema";
import { resetDb } from "../helpers/db";
import {
  makeAccount,
  makeConversation,
  makeImpression,
  makeMembership,
  makeMessage,
  makeSite,
  makeSource,
  makeUser,
} from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "", emailVerified: true } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { GET as configGET } from "@/app/api/widget/config/route";
import { POST as chatPOST } from "@/app/api/widget/chat/route";
import { POST as promptPOST } from "@/app/api/widget/prompt/route";
import { POST as eventPOST } from "@/app/api/widget/prompt-event/route";
import { POST as subscribePOST } from "@/app/api/widget/subscribe/route";
import InstallPage from "@/app/app/sites/[siteId]/install/page";
import ConversationsPage from "@/app/app/sites/[siteId]/conversations/page";
import ConversationPage from "@/app/app/sites/[siteId]/conversations/[conversationId]/page";
import { findRelevantConversations } from "@/lib/ask/search";
import { generateSiteInsights } from "@/lib/insights/generate";
import { dailyInsights } from "@/lib/insights/schedule";
import { enqueuedJobs } from "@/lib/jobs";
import { replaceChunks } from "@/lib/kb/store";
import { pausedKinds, promptStats } from "@/lib/prompts/backoff";
import { getSiteByPublicKey } from "@/lib/sites";
import { getDailyConversations, getTopStartPages, getTotals } from "@/lib/stats/queries";
import { getPlatformTotals } from "@/lib/stats/platform";
import { parseRange } from "@/lib/stats/range";
import { monthKey } from "@/lib/usage/meter";
import { testModeKey } from "@/lib/widget/test-mode";
import type { PageContext, WidgetConfig } from "@/shared/widget-protocol";

beforeEach(resetDb);

const ORIGIN = "https://example.com";
const get = (path: string) => new Request(`http://localhost:3000${path}`, { headers: { Origin: ORIGIN } });
const post = (path: string, body: unknown) =>
  new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
// "Now" a minute ahead, so rows made during a test fall inside the range.
const range = () => parseRange("30d", new Date(Date.now() + 60_000));

const page = (over: Partial<PageContext> = {}): PageContext => ({
  url: "https://example.com/product/shampoo/",
  title: "Shampoo",
  lang: "en",
  headings: ["Shampoo"],
  visibleText: "A gentle shampoo for dry hair.",
  product: null,
  kind: "product",
  ...over,
});

/** A site whose crawl learned the shampoo page, so suggestions can be written for it. */
async function widgetSite(overrides: Parameters<typeof makeSite>[1] = {}) {
  const site = await makeSite((await makeAccount({ plan: "starter" })).id, overrides);
  const src = await makeSource(site.id, {
    kind: "page",
    title: "Shampoo | Shop",
    url: "https://example.com/product/shampoo",
    status: "ready",
  });
  await replaceChunks({ sourceId: src.id, siteId: site.id, texts: ["Crawled: a gentle sulfate-free shampoo for dry hair."] });
  return (await getSiteByPublicKey(site.publicKey))!;
}

/** 20 shown, all dismissed: the "question" type is paused for the site. */
async function pauseQuestions(siteId: string) {
  for (let i = 0; i < 20; i++) {
    await makeImpression(siteId, { kind: "question", shownAt: new Date(Date.now() - 3600_000), outcome: "dismissed" });
  }
}

const config = async (key: string, test?: string) => {
  const q = test === undefined ? "" : `&test=${encodeURIComponent(test)}`;
  const res = await configGET(get(`/api/widget/config?key=${key}${q}`));
  expect(res.status).toBe(200);
  return (await res.json()) as WidgetConfig;
};

async function chat(key: string, body: Record<string, unknown> = {}) {
  const res = await chatPOST(
    post(`/api/widget/chat?key=${key}`, { key, sid: "visitor_session_1", cid: null, message: "Is it good for dry hair?", page: page(), ...body }),
  );
  expect(res.status).toBe(200);
  await res.text(); // the stream ends once the reply and its usage are saved
}

const monthCount = async (accountId: string) =>
  (
    await db
      .select({ c: monthlyUsage.conversations })
      .from(monthlyUsage)
      .where(and(eq(monthlyUsage.accountId, accountId), eq(monthlyUsage.month, monthKey(new Date()))))
  )[0]?.c ?? 0;

const promptBody = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  sid: "sid-tttttttt",
  page: page(),
  intent: "exploring",
  confidence: 0.8,
  ...over,
});

describe("GET /api/widget/config", () => {
  it("says testMode only with the site's own valid key", async () => {
    const site = await widgetSite();
    const other = await widgetSite();
    expect((await config(site.publicKey)).testMode).toBe(false);
    expect((await config(site.publicKey, testModeKey(site.publicKey))).testMode).toBe(true);
    expect((await config(site.publicKey, testModeKey(other.publicKey))).testMode).toBe(false);
    expect((await config(site.publicKey, "forged-forged-forged-forged-0000")).testMode).toBe(false);
    expect((await config(site.publicKey, "")).testMode).toBe(false);
  });

  it("a test tab ignores back-off, but still respects suggestions switched off", async () => {
    const site = await widgetSite();
    await pauseQuestions(site.id);
    expect((await config(site.publicKey)).pausedKinds).toEqual(["question"]);
    expect((await config(site.publicKey, testModeKey(site.publicKey))).pausedKinds).toEqual([]);

    const off = await widgetSite({ proactivity: "off" });
    expect(await config(off.publicKey, testModeKey(off.publicKey))).toMatchObject({ testMode: true, proactivity: "off" });
  });
});

describe("POST /api/widget/chat in test mode", () => {
  it("marks the conversation Test and leaves it out of the month's count and the numbers", async () => {
    const site = await widgetSite();
    await chat(site.publicKey, { test: testModeKey(site.publicKey) });
    const [conv] = await db.select().from(conversations).where(eq(conversations.siteId, site.id));
    expect(conv.isTest).toBe(true);
    expect(await monthCount(site.accountId)).toBe(0);

    const totals = await getTotals([site.id], range());
    expect(totals).toMatchObject({ conversations: 0, visitorMessages: 0, unanswered: 0 });
    expect((await getDailyConversations([site.id], range())).every((d) => d.conversations === 0)).toBe(true);
    expect(await getTopStartPages([site.id], range())).toEqual([]);
    expect((await getPlatformTotals(range())).conversations).toBe(0);
    expect(await findRelevantConversations(site.id, "dry hair")).toEqual([]);
  });

  it("an invalid key behaves exactly like today", async () => {
    const site = await widgetSite();
    const other = await widgetSite();
    await chat(site.publicKey, { test: testModeKey(other.publicKey) });
    const [conv] = await db.select().from(conversations).where(eq(conversations.siteId, site.id));
    expect(conv.isTest).toBe(false);
    expect(await monthCount(site.accountId)).toBe(1);
    expect((await getTotals([site.id], range())).conversations).toBe(1);
  });

  it("a malformed test field is ignored, never an error", async () => {
    const site = await widgetSite();
    await chat(site.publicKey, { test: 12345 });
    await chat(site.publicKey, { test: { nested: true }, sid: "visitor_session_2" });
    expect(await monthCount(site.accountId)).toBe(2);
    const rows = await db.select().from(conversations).where(eq(conversations.siteId, site.id));
    expect(rows.map((r) => r.isTest)).toEqual([false, false]);
  });
});

describe("test conversations are left out of insights and Ask", () => {
  it("generateSiteInsights and the daily candidates skip test conversations", async () => {
    const site = await makeSite((await makeAccount()).id);
    const c = await makeConversation(site.id, { isTest: true, lastMessageAt: new Date(Date.now() - 60_000) });
    await makeMessage(c.id, { content: "a test question about dry hair" });
    const callModel = vi.fn();
    expect(await generateSiteInsights(site.id, { window: "24h", callModel })).toEqual({
      status: "skipped",
      reason: "no-conversations",
    });
    expect(callModel).not.toHaveBeenCalled();
    expect(await dailyInsights()).toBe(0);
    expect(enqueuedJobs()).toEqual([]);
  });

  it("Ask finds the real conversation and never the test one", async () => {
    const site = await makeSite((await makeAccount()).id);
    const real = await makeConversation(site.id);
    await makeMessage(real.id, { content: "Do you ship to Cyprus?" });
    const test = await makeConversation(site.id, { isTest: true });
    await makeMessage(test.id, { content: "Do you ship to Cyprus? (test)" });
    const found = await findRelevantConversations(site.id, "ship to Cyprus");
    expect(found.map((f) => f.id)).toEqual([real.id]);
  });
});

describe("POST /api/widget/prompt in test mode", () => {
  it("ignores paused types and records Test impressions that back-off and the stats leave out", async () => {
    const site = await widgetSite();
    await pauseQuestions(site.id);
    const url = `/api/widget/prompt?key=${site.publicKey}`;
    expect((await promptPOST(post(url, promptBody(site.publicKey)))).status).toBe(204);

    const res = await promptPOST(post(url, promptBody(site.publicKey, { test: testModeKey(site.publicKey) })));
    expect(res.status).toBe(200);
    const offer = (await res.json()) as { id: string };
    const [imp] = await db.select().from(promptImpressions).where(eq(promptImpressions.id, offer.id));
    expect(imp.isTest).toBe(true);

    // The test impression is shown and dismissed: back-off and the stats still count only the 20 real ones.
    await eventPOST(post(`/api/widget/prompt-event?key=${site.publicKey}`, { key: site.publicKey, sid: "sid-tttttttt", id: offer.id, event: "shown", test: testModeKey(site.publicKey) }));
    await eventPOST(post(`/api/widget/prompt-event?key=${site.publicKey}`, { key: site.publicKey, sid: "sid-tttttttt", id: offer.id, event: "dismissed", test: testModeKey(site.publicKey) }));
    const stats = await promptStats(site.id, range());
    expect(stats.question).toEqual({ shown: 20, tapped: 0, dismissed: 20 });
  });

  it("test impressions never pause a type", async () => {
    const site = await widgetSite();
    for (let i = 0; i < 25; i++) {
      await makeImpression(site.id, { isTest: true, shownAt: new Date(Date.now() - 3600_000), outcome: "dismissed" });
    }
    expect(await pausedKinds(site.id)).toEqual([]);
  });

  it("lifts the per-visit limit (7th request allowed) only with a valid key", async () => {
    const site = await widgetSite();
    const url = `/api/widget/prompt?key=${site.publicKey}`;
    const test = testModeKey(site.publicKey);
    for (let i = 0; i < 7; i++) {
      expect((await promptPOST(post(url, promptBody(site.publicKey, { test })))).status).not.toBe(429);
    }
    const forged = promptBody(site.publicKey, { sid: "sid-ffffffff", test: "forged-forged-forged-forged-0000" });
    for (let i = 0; i < 6; i++) expect((await promptPOST(post(url, forged))).status).not.toBe(429);
    expect((await promptPOST(post(url, forged))).status).toBe(429);
  });

  it("an invalid key still skips paused types and records normal impressions", async () => {
    const site = await widgetSite();
    const other = await widgetSite();
    const url = `/api/widget/prompt?key=${site.publicKey}`;
    const ok = await promptPOST(post(url, promptBody(site.publicKey, { test: testModeKey(other.publicKey) })));
    expect(ok.status).toBe(200);
    const [imp] = await db.select().from(promptImpressions).where(eq(promptImpressions.id, ((await ok.json()) as { id: string }).id));
    expect(imp.isTest).toBe(false);
    await pauseQuestions(site.id);
    const res = await promptPOST(post(url, promptBody(site.publicKey, { sid: "sid-gggggggg", test: testModeKey(other.publicKey) })));
    expect(res.status).toBe(204);
  });

  it("respects suggestions switched off", async () => {
    const site = await widgetSite({ proactivity: "off" });
    const res = await promptPOST(post(`/api/widget/prompt?key=${site.publicKey}`, promptBody(site.publicKey, { test: testModeKey(site.publicKey) })));
    expect(res.status).toBe(204);
  });
});

describe("subscribe accepts the test field", () => {
  it("a test key on subscribe is not an error", async () => {
    const site = await widgetSite();
    const res = await subscribePOST(
      post(`/api/widget/subscribe?key=${site.publicKey}`, {
        key: site.publicKey,
        sid: "sid-ssssssss",
        cid: null,
        email: "owner@example.com",
        language: "en",
        test: testModeKey(site.publicKey),
      }),
    );
    // No verified sending domain in tests: the same 403 a real visitor gets, not a 400.
    expect(res.status).toBe(403);
  });
});

describe("admin pages", () => {
  async function memberSite() {
    const u = await makeUser();
    const account = await makeAccount();
    await makeMembership(account.id, u.id);
    current.user = { id: u.id, email: u.email, emailVerified: true };
    return makeSite(account.id, { baseUrl: "https://shop.example.com" });
  }

  async function digestOf(p: Promise<unknown>) {
    try {
      await p;
      return null;
    } catch (err) {
      return (err as { digest?: string }).digest ?? String(err);
    }
  }

  it("the install page links to the site in test mode with its own key", async () => {
    const site = await memberSite();
    const html = renderToStaticMarkup(await InstallPage({ params: Promise.resolve({ siteId: site.id }) } as never));
    expect(html).toContain("Test the bot on your site");
    expect(html).toContain(`href="https://shop.example.com#concierge-test=${testModeKey(site.publicKey)}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toMatch(/class="btn btn-primary[^"]*"/);
    expect(html).toContain(
      "Opens your website with the bot in test mode in that tab only: greeting on every page, suggestions after 3 seconds with no limit, and the email ask after the first reply. Test chats are marked Test and left out of your numbers.",
    );
  });

  it("another account's site is not found", async () => {
    const other = await makeSite((await makeAccount()).id);
    await memberSite();
    expect(await digestOf(InstallPage({ params: Promise.resolve({ siteId: other.id }) } as never))).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
  });

  it("the conversations list and transcript show test conversations with a Test badge", async () => {
    const site = await memberSite();
    const real = await makeConversation(site.id);
    await makeMessage(real.id, { content: "real question" });
    const test = await makeConversation(site.id, { isTest: true });
    await makeMessage(test.id, { content: "test question" });

    const list = renderToStaticMarkup(
      await ConversationsPage({ params: Promise.resolve({ siteId: site.id }), searchParams: Promise.resolve({}) } as never),
    );
    expect(list).toContain("real question");
    expect(list).toContain("test question");
    expect((list.match(/class="badge[^"]*">Test</g) ?? []).length).toBe(1);

    const testHtml = renderToStaticMarkup(
      await ConversationPage({ params: Promise.resolve({ siteId: site.id, conversationId: test.id }) } as never),
    );
    expect(testHtml).toMatch(/class="badge[^"]*">Test</);
    const realHtml = renderToStaticMarkup(
      await ConversationPage({ params: Promise.resolve({ siteId: site.id, conversationId: real.id }) } as never),
    );
    expect(realHtml).not.toMatch(/class="badge[^"]*">Test</);
  });
});
