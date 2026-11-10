import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db/client";
import { accounts, contacts, emailMessages, kbSources, monthlyUsage } from "@/db/schema";
import { QuotaBanner } from "@/components/QuotaBanner";
import { setProviderForTests, type OutgoingEmail } from "@/lib/email/provider";
import { emailTick } from "@/lib/email/schedule";
import { replaceChunks } from "@/lib/kb/store";
import { setAccountLimits } from "@/lib/limits";
import { offerPrompt } from "@/lib/prompts/offer";
import { getSiteByPublicKey } from "@/lib/sites";
import { atMonthlyLimit, usageLevels } from "@/lib/usage/levels";
import { monthKey } from "@/lib/usage/meter";
import { buildWidgetConfig } from "@/lib/widget/config";
import { POST as subscribePOST } from "@/app/api/widget/subscribe/route";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeMessage, makeSite, makeSource } from "../helpers/factories";

const sent: OutgoingEmail[] = [];
beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  setProviderForTests({ send: async (m) => (sent.push(m), { id: "re_1" }) });
});
afterEach(() => setProviderForTests(null));

const now = new Date();
const MB = 1024 * 1024;

async function setup(usage: { conversations?: number; emails?: number } = {}) {
  const account = await makeAccount({ plan: "starter" });
  const raw = await makeSite(account.id, {
    proactivity: "active",
    sendingDomain: "example.com",
    sendingDomainStatus: "verified",
  });
  await db.insert(monthlyUsage).values({ accountId: account.id, month: monthKey(now), conversations: usage.conversations ?? 0, emails: usage.emails ?? 0 });
  const src = await makeSource(raw.id, { kind: "page", title: "Shampoo", url: "https://example.com/product/shampoo", status: "ready" });
  await replaceChunks({ sourceId: src.id, siteId: raw.id, texts: ["A gentle shampoo."] });
  const site = (await getSiteByPublicKey(raw.publicKey))!;
  return { account, site };
}

const reload = async (id: string) => (await db.select().from(accounts).where(eq(accounts.id, id)))[0];
const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
const promptInput = {
  sid: "sid-limits-1",
  page: {
    url: "https://example.com/product/shampoo/",
    title: "Shampoo",
    lang: "en",
    headings: [],
    visibleText: "",
    product: null,
    kind: "product" as const,
  },
  intent: "exploring" as const,
  confidence: 0.8,
};

async function subscriberWithApproved(siteId: string) {
  const convo = await makeConversation(siteId, { lastMessageAt: new Date(now.getTime() - 5 * 3600_000) });
  await makeMessage(convo.id);
  const [c] = await db
    .insert(contacts)
    .values({
      siteId,
      email: "m@example.com",
      language: "en",
      status: "subscribed",
      consentText: "x",
      consentLanguage: "en",
      consentedAt: new Date(now.getTime() - 10 * 3600_000),
      confirmedAt: new Date(now.getTime() - 10 * 3600_000),
      token: "t".repeat(43),
      ref: "r".repeat(22),
      sequenceConversationId: convo.id,
    })
    .returning();
  const other = await makeConversation(siteId, { lastMessageAt: new Date(now.getTime() - 5 * 3600_000) });
  await makeMessage(other.id);
  await db.insert(contacts).values({
    siteId,
    email: "due@example.com",
    language: "en",
    status: "subscribed",
    consentText: "x",
    consentLanguage: "en",
    consentedAt: new Date(now.getTime() - 10 * 3600_000),
    confirmedAt: new Date(now.getTime() - 10 * 3600_000),
    token: "u".repeat(43),
    ref: "s".repeat(22),
    sequenceConversationId: other.id,
  });
  await db.insert(emailMessages).values({
    siteId,
    contactId: c.id,
    conversationId: convo.id,
    step: 1,
    status: "approved",
    subject: "Hello",
    body: "Hi",
    language: "en",
    scheduledFor: new Date(now.getTime() - 60_000),
  });
}

describe("at 100 % of the month's conversations", () => {
  it("keeps answering, but no suggestions, no email offer, no new drafts; approved emails still go", async () => {
    const { account, site } = await setup({ conversations: 500 });
    const cfg = await buildWidgetConfig(site, null, now);
    expect(cfg).toMatchObject({ mode: "ai", proactivity: "off", emailCapture: false });

    const callModel = vi.fn(async () => ({ content: { show: true, text: "t", question: "q" }, model: "claude-opus-5-5", usage }));
    expect(await offerPrompt(site, promptInput, { callModel })).toBeNull();
    expect(callModel).not.toHaveBeenCalled();

    const res = await subscribePOST(
      new Request(`http://localhost:3000/api/widget/subscribe?key=${site.publicKey}`, {
        method: "POST",
        headers: { Origin: "https://example.com", "Content-Type": "application/json" },
        body: JSON.stringify({ key: site.publicKey, sid: "sid-limits-1", cid: null, email: "a@example.com", language: "en" }),
      }),
    );
    expect(res.status).toBe(403);

    await subscriberWithApproved(site.id);
    const writer = vi.fn(async () => ({ content: { subject: "s", body: "b" }, model: "claude-opus-5-5", usage }));
    const out = await emailTick(now, { callModel: writer, sendIntervalMs: 0 });
    expect(writer).not.toHaveBeenCalled();
    expect(out).toMatchObject({ drafted: 0, sent: 1 });
    expect(await atMonthlyLimit(await reload(account.id), now)).toBe(true);
  });

  it("an override above the usage lifts the gate", async () => {
    const { account, site } = await setup({ conversations: 500 });
    await setAccountLimits(account.id, { conversationsPerMonth: 1000 });
    const fresh = (await getSiteByPublicKey(site.publicKey))!;
    expect(await buildWidgetConfig(fresh, null, now)).toMatchObject({ proactivity: "active", emailCapture: true });
  });
});

describe("at 100 % of the month's emails", () => {
  it("no drafts and no sends", async () => {
    const { site } = await setup({ emails: 1000 });
    await subscriberWithApproved(site.id);
    const writer = vi.fn(async () => ({ content: { subject: "s", body: "b" }, model: "claude-opus-5-5", usage }));
    const out = await emailTick(now, { callModel: writer, sendIntervalMs: 0 });
    expect(writer).not.toHaveBeenCalled();
    expect(out.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe("below 100 %", () => {
  it("nothing is gated at 499", async () => {
    const { site } = await setup({ conversations: 499 });
    expect(await buildWidgetConfig(site, null, now)).toMatchObject({ proactivity: "active", emailCapture: true });
  });
});

describe("usageLevels and the banner", () => {
  it("computes warning and full levels", async () => {
    const { account, site } = await setup({ conversations: 400 });
    await db.insert(kbSources).values({ siteId: site.id, kind: "text", title: "Big", bytes: 85 * MB, status: "ready" });
    const levels = await usageLevels(await reload(account.id), now);
    expect(levels.conversations).toMatchObject({ used: 400, limit: 500, level: "warning" });
    expect(levels.emails.level).toBe("ok");
    expect(levels.storage.level).toBe("warning");
    await db.update(monthlyUsage).set({ conversations: 500 }).where(eq(monthlyUsage.accountId, account.id));
    expect((await usageLevels(await reload(account.id), now)).conversations.level).toBe("full");
  });

  it("shows the 80 % storage warning", async () => {
    const { account, site } = await setup();
    await db.insert(kbSources).values({ siteId: site.id, kind: "text", title: "Big", bytes: 85 * MB, status: "ready" });
    const html = renderToStaticMarkup((await QuotaBanner({ account: await reload(account.id) }))!);
    expect(html).toContain("You&#x27;ve used 85 % of your knowledge-base storage.");
    expect(html).toContain('href="/app/usage"');
  });

  it("shows the 100 % text with the contact address", async () => {
    const { account } = await setup({ conversations: 500 });
    const html = renderToStaticMarkup((await QuotaBanner({ account: await reload(account.id) }))!);
    expect(html).toContain(
      "You&#x27;ve reached this month&#x27;s conversations. Your bot keeps answering, but makes no new suggestions or emails until next month. Contact help@example.com to raise your limit.",
    );
  });
});
