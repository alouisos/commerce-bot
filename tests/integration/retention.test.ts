import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contacts, conversations, emailMessages, leads, messages, promptImpressions, sales } from "@/db/schema";
import { applyRetention } from "@/lib/privacy/retention";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeImpression, makeLead, makeMessage, makeSite } from "../helpers/factories";

beforeEach(resetDb);

const now = new Date("2026-11-10T03:30:00Z");
const monthsAgo = (m: number) => {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - m);
  return d;
};
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);

let n = 0;
async function contact(siteId: string, over: Partial<typeof contacts.$inferInsert>) {
  n++;
  const [c] = await db
    .insert(contacts)
    .values({
      siteId,
      email: `p${n}@example.com`,
      language: "en",
      status: "subscribed",
      consentText: "x",
      consentLanguage: "en",
      consentedAt: monthsAgo(30),
      confirmedAt: monthsAgo(30),
      token: `tok${n}`.padEnd(43, "x"),
      ref: `ref${n}`.padEnd(22, "y"),
      ...over,
    })
    .returning();
  return c;
}

const ids = async <T extends { id: string }>(rows: Promise<T[]>) => (await rows).map((r) => r.id).sort();

describe("applyRetention", () => {
  it("deletes old data per site, and keeps subscribed people", async () => {
    const account = await makeAccount();
    const s24 = await makeSite(account.id);
    const s6 = await makeSite(account.id, { retentionMonths: 6 });

    const old24 = await makeConversation(s24.id, { lastMessageAt: monthsAgo(25) });
    await makeMessage(old24.id);
    const keep24 = await makeConversation(s24.id, { lastMessageAt: monthsAgo(23) });
    await makeConversation(s6.id, { lastMessageAt: monthsAgo(7) });
    const keep6 = await makeConversation(s6.id, { lastMessageAt: monthsAgo(5) });
    // A 7-month-old conversation is fine on the 24-month site.
    const mid24 = await makeConversation(s24.id, { lastMessageAt: monthsAgo(7) });

    await makeImpression(s24.id, { createdAt: monthsAgo(25) });
    const newImp = await makeImpression(s24.id, { createdAt: monthsAgo(1) });
    await makeLead(s6.id, { createdAt: monthsAgo(7) });
    const newLead = await makeLead(s6.id, { createdAt: monthsAgo(1) });

    const subscribed = await contact(s24.id, {});
    await contact(s24.id, { status: "unsubscribed", unsubscribedAt: monthsAgo(25) });
    const unsubNew = await contact(s24.id, { status: "unsubscribed", unsubscribedAt: monthsAgo(2) });
    await contact(s24.id, { status: "pending", confirmedAt: null, consentedAt: daysAgo(8) });
    const pendingNew = await contact(s24.id, { status: "pending", confirmedAt: null, consentedAt: daysAgo(2) });

    await db
      .insert(emailMessages)
      .values({ siteId: s24.id, contactId: subscribed.id, step: 1, status: "sent", subject: "s", body: "b", language: "en", scheduledFor: monthsAgo(25), createdAt: monthsAgo(25) })
      .returning();
    const [newMail] = await db
      .insert(emailMessages)
      .values({ siteId: s24.id, contactId: subscribed.id, step: 2, status: "sent", subject: "s", body: "b", language: "en", scheduledFor: monthsAgo(1), createdAt: monthsAgo(1) })
      .returning();

    const res = await applyRetention(now);
    expect(res).toEqual({ conversations: 2, impressions: 1, leads: 1, emails: 1, contacts: 2, sales: 0 });

    expect(await ids(db.select({ id: conversations.id }).from(conversations))).toEqual([keep24.id, keep6.id, mid24.id].sort());
    expect(await db.select().from(messages).where(eq(messages.conversationId, old24.id))).toHaveLength(0);
    expect(await ids(db.select({ id: promptImpressions.id }).from(promptImpressions))).toEqual([newImp.id]);
    expect(await ids(db.select({ id: leads.id }).from(leads))).toEqual([newLead.id]);
    expect(await ids(db.select({ id: emailMessages.id }).from(emailMessages))).toEqual([newMail.id]);
    expect(await ids(db.select({ id: contacts.id }).from(contacts))).toEqual(
      [subscribed.id, unsubNew.id, pendingNew.id].sort(),
    );
  });

  it("keeps a subscribed contact's consent lead while they're subscribed", async () => {
    const account = await makeAccount();
    const site = await makeSite(account.id, { retentionMonths: 6 });
    await contact(site.id, { email: "kept@example.com" });
    const kept = await makeLead(site.id, { email: "kept@example.com", source: "consent", createdAt: monthsAgo(12) });
    await makeLead(site.id, { email: "gone@example.com", source: "consent", createdAt: monthsAgo(12) });
    await applyRetention(now);
    expect(await ids(db.select({ id: leads.id }).from(leads))).toEqual([kept.id]);
  });

  it("deletes sales older than the site's retention", async () => {
    const account = await makeAccount();
    const site = await makeSite(account.id);
    const base = { siteId: site.id, source: "page" as const, verified: false, visitorSessionId: "sid", viaChat: true };
    await db.insert(sales).values({ ...base, orderedAt: monthsAgo(25), pageUrl: "https://example.com/a" });
    const [kept] = await db.insert(sales).values({ ...base, orderedAt: monthsAgo(23), pageUrl: "https://example.com/b" }).returning();
    expect((await applyRetention(now)).sales).toBe(1);
    expect(await ids(db.select({ id: sales.id }).from(sales))).toEqual([kept.id]);
  });
});
