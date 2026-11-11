import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  accounts,
  buyerEmails,
  buyerOrders,
  buyers,
  contacts,
  emailMessages,
  emailSuppressions,
  monthlyUsage,
  sites,
  storeConnections,
  usageEvents,
} from "@/db/schema";
import { pollOrders } from "@/lib/buyers/poll";
import { MIN_GAP_DAYS, STEP_DELAY_DAYS, scheduleForOrder } from "@/lib/buyers/sequence";
import { emailHash, isSuppressed, suppress } from "@/lib/buyers/suppression";
import { deletePerson } from "@/lib/email/admin";
import { confirmContact } from "@/lib/email/contacts";
import { trackClick } from "@/lib/email/links";
import { setProviderForTests, type OutgoingEmail } from "@/lib/email/provider";
import { emailTick } from "@/lib/email/schedule";
import type { CallModel } from "@/lib/email/writer";
import { connectWooCommerce } from "@/lib/sales/connections";
import { setWooTransportForTests, type WooOrder } from "@/lib/sales/woocommerce";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeSite } from "../helpers/factories";

const H = 3600_000;
const D = 24 * H;
const T0 = new Date("2026-11-10T10:00:00Z");
const day = (n: number) => new Date(T0.getTime() + n * D);
const EMAIL = "maria@example.com";

let sent: OutgoingEmail[] = [];
let modelCalls = 0;
const callModel: CallModel = async () => {
  modelCalls++;
  return {
    content: { subject: `Subject ${modelCalls}`, body: "Hi Maria!\n\nSee the [guide](https://milianjo.com/p/oil)." },
    model: "claude-sonnet-5-5",
    usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
};
const tick = (now: Date) => emailTick(now, { callModel, sendIntervalMs: 0 });

beforeEach(async () => {
  await resetDb();
  sent = [];
  modelCalls = 0;
  setProviderForTests({
    send: async (m) => {
      sent.push(m);
      return { id: `re_${sent.length}` };
    },
  });
  setWooTransportForTests({
    fetch: (async () => new Response("[]", { status: 200 })) as typeof fetch,
    lookup: async () => ["93.184.216.34"],
  });
});
afterEach(() => setProviderForTests(null));

type Opts = { plan?: "starter" | "growth"; mode?: "approval" | "automatic"; verified?: boolean; woo?: boolean };

async function setup(opts: Opts = {}) {
  const account = await makeAccount({ plan: opts.plan ?? "growth" });
  const site = await makeSite(account.id, {
    name: "Milian Jo",
    baseUrl: "https://milianjo.com",
    allowedOrigins: ["https://milianjo.com"],
    sendingDomain: "milianjo.com",
    sendingDomainStatus: opts.verified === false ? "pending" : "verified",
    buyerEmails: opts.mode ?? "automatic",
    buyerEmailsSince: day(-1),
  });
  if (opts.woo !== false) {
    await connectWooCommerce(site.id, { storeUrl: "https://milianjo.com", consumerKey: "ck_" + "a".repeat(40), consumerSecret: "cs_" + "b".repeat(40) });
  }
  const [buyer] = await db
    .insert(buyers)
    .values({ siteId: site.id, email: EMAIL, firstName: "Maria", status: "subscribed", token: "b".repeat(43), ref: "q".repeat(22) })
    .returning();
  const order = await makeOrder(site.id, buyer.id, "1", T0);
  return { account, site, buyer, order };
}

async function makeOrder(siteId: string, buyerId: string, externalId: string, orderedAt: Date) {
  const [order] = await db
    .insert(buyerOrders)
    .values({ siteId, buyerId, externalId, orderedAt, items: [{ productId: 7, name: "Olive oil", url: "https://milianjo.com/p/oil" }] })
    .returning();
  return order;
}

async function makeContact(siteId: string, over: Partial<typeof contacts.$inferInsert> = {}) {
  const [contact] = await db
    .insert(contacts)
    .values({
      siteId,
      email: EMAIL,
      language: "en",
      status: "subscribed",
      consentText: "x",
      consentLanguage: "en",
      consentedAt: day(-3),
      confirmedAt: day(-3),
      token: "t".repeat(43),
      ref: "r".repeat(22),
      ...over,
    })
    .returning();
  return contact;
}

const rows = () => db.select().from(buyerEmails).orderBy(asc(buyerEmails.createdAt), asc(buyerEmails.step));
const byStep = async (step: number) => (await rows()).filter((r) => r.step === step);

describe("scheduleForOrder", () => {
  it("schedules step 1 for day 5 and step 2 for day 14 after the order", async () => {
    expect(STEP_DELAY_DAYS).toEqual({ 1: 5, 2: 14 });
    expect(MIN_GAP_DAYS).toBe(7);
    const { order } = await setup();
    await scheduleForOrder(order.id, T0);
    const r = await rows();
    expect(r.map((x) => [x.step, x.status, x.scheduledFor])).toEqual([
      [1, "scheduled", day(5)],
      [2, "scheduled", day(14)],
    ]);
    expect(r[0].feedbackToken).not.toBe(r[1].feedbackToken);
  });

  it("schedules nothing for a buyer whose address unsubscribed from chat follow-ups", async () => {
    const { site, order } = await setup();
    await makeContact(site.id, { status: "unsubscribed" });
    expect(await isSuppressed(site.id, "Maria@Example.com")).toBe(true);
    await scheduleForOrder(order.id, T0);
    expect(await rows()).toHaveLength(0);
  });

  it("schedules nothing for an unsubscribed buyer", async () => {
    const { site, buyer, order } = await setup();
    await db.update(buyers).set({ status: "unsubscribed" }).where(eq(buyers.id, buyer.id));
    expect(await isSuppressed(site.id, EMAIL)).toBe(true);
    await scheduleForOrder(order.id, T0);
    expect(await rows()).toHaveLength(0);
  });

  it("a new order replaces the pending sequence; an older one doesn't", async () => {
    const { site, buyer, order } = await setup({ mode: "approval", plan: "starter" });
    await scheduleForOrder(order.id, T0);
    await tick(day(5)); // step 1 waits for approval
    const second = await makeOrder(site.id, buyer.id, "2", day(6));
    await scheduleForOrder(second.id, day(6));
    const r = await rows();
    expect(r.filter((x) => x.orderId === order.id).map((x) => x.status)).toEqual(["discarded", "discarded"]);
    expect(r.filter((x) => x.orderId === second.id).map((x) => [x.step, x.status, x.scheduledFor])).toEqual([
      [1, "scheduled", day(11)],
      [2, "scheduled", day(20)],
    ]);
    const older = await makeOrder(site.id, buyer.id, "0", day(-1));
    await scheduleForOrder(older.id, day(6));
    expect((await rows()).filter((x) => x.orderId === older.id)).toHaveLength(0);
    expect((await rows()).filter((x) => x.orderId === second.id && x.status === "scheduled")).toHaveLength(2);
  });

  it("is called by pollOrders for every new order", async () => {
    const { site } = await setup();
    const woo: WooOrder = {
      id: 42,
      orderKey: "k42",
      status: "completed",
      currency: "EUR",
      total: "10.00",
      createdGmt: "2026-11-10T10:00:00",
      billingEmail: "new@example.com",
      firstName: "Nia",
      items: [{ productId: 7, name: "Olive oil" }],
    };
    await pollOrders(T0, { list: async () => ({ orders: [woo], truncated: false }), urls: async () => new Map() });
    const [b] = await db.select().from(buyers).where(and(eq(buyers.siteId, site.id), eq(buyers.email, "new@example.com")));
    const r = (await rows()).filter((x) => x.buyerId === b.id);
    expect(r.map((x) => [x.step, x.status])).toEqual([
      [1, "scheduled"],
      [2, "scheduled"],
    ]);
  });
});

describe("buyer emails in emailTick", () => {
  it("automatic (plan allows it): step 1 goes out on day 5 and step 2 on day 14, metered as buyer_email", async () => {
    const { account, order } = await setup();
    await scheduleForOrder(order.id, T0);
    expect(await tick(new Date(day(5).getTime() - 60_000))).toEqual({ drafted: 0, sent: 0, skipped: 0 });
    expect(modelCalls).toBe(0);
    expect(await tick(day(5))).toEqual({ drafted: 1, sent: 1, skipped: 0 });
    expect((await byStep(1))[0]).toMatchObject({ status: "sent", sentAt: day(5), subject: "Subject 1", language: "en" });
    await tick(day(13));
    expect(sent).toHaveLength(1);
    await tick(day(14));
    expect(sent).toHaveLength(2);
    expect((await byStep(2))[0]).toMatchObject({ status: "sent", sentAt: day(14) });
    expect((await db.select().from(usageEvents)).map((e) => e.kind)).toEqual(["buyer_email", "buyer_email"]);
    const [usage] = await db.select().from(monthlyUsage).where(eq(monthlyUsage.accountId, account.id));
    expect(usage.emails).toBe(2);
    expect(usage.aiCostMicros).toBe(0);
    await tick(day(60));
    expect(sent).toHaveLength(2);
  });

  it("every sent email has the buyer's one-click unsubscribe, a feedback link and tracked shop links", async () => {
    const { buyer, order } = await setup();
    await scheduleForOrder(order.id, T0);
    await tick(day(5));
    const [m] = await byStep(1);
    expect(sent[0]).toMatchObject({ from: '"Milian Jo" <hello@milianjo.com>', to: EMAIL, subject: "Subject 1" });
    expect(sent[0].headers).toEqual({
      "List-Unsubscribe": `<http://localhost:3000/e/b/${buyer.token}/one-click>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    for (const part of [sent[0].html, sent[0].text]) {
      expect(part).toContain(`http://localhost:3000/e/b/${buyer.token}`);
      expect(part).toContain(`http://localhost:3000/e/f/${m.feedbackToken}`);
      expect(part).toContain(`http://localhost:3000/e/c/${m.id}/0`);
      expect(part).not.toContain("asked Milian Jo for recommendations");
    }
    // The tracked link leads to the shop with the buyer's ref, and counts the click.
    expect(await trackClick(m.id, 0, day(6))).toBe(`https://milianjo.com/p/oil?cc_ref=${buyer.ref}`);
    expect((await byStep(1))[0]).toMatchObject({ clicks: 1, clickedAt: day(6) });
  });

  it("approval mode drafts and waits; so does automatic on a plan without auto-send", async () => {
    for (const plan of ["starter", "growth"] as const) {
      await resetDb();
      sent = [];
      modelCalls = 0;
      const { order } = await setup({ plan, mode: plan === "starter" ? "automatic" : "approval" });
      await scheduleForOrder(order.id, T0);
      expect(await tick(day(5))).toEqual({ drafted: 1, sent: 0, skipped: 0 });
      expect((await byStep(1))[0]).toMatchObject({ status: "draft", subject: "Subject 1" });
      expect(sent).toHaveLength(0);
      // A waiting draft blocks the next step.
      await tick(day(14));
      expect((await byStep(2))[0].status).toBe("scheduled");
    }
  });

  it("an unverified domain, no WooCommerce connection, buyer emails off or a removed account: nothing drafted", async () => {
    const cases: [Opts, ((siteId: string, accountId: string) => Promise<unknown>) | null][] = [
      [{ verified: false }, null],
      [{ woo: false }, null],
      [{}, (siteId) => db.update(sites).set({ buyerEmails: "off" }).where(eq(sites.id, siteId))],
      [{}, (_s, accountId) => db.update(accounts).set({ removedAt: T0 }).where(eq(accounts.id, accountId))],
      [{}, (siteId) => db.delete(storeConnections).where(eq(storeConnections.siteId, siteId))],
    ];
    for (const [opts, after] of cases) {
      await resetDb();
      modelCalls = 0;
      const { site, account, order } = await setup(opts);
      await scheduleForOrder(order.id, T0);
      if (after) await after(site.id, account.id);
      expect(await tick(day(5))).toEqual({ drafted: 0, sent: 0, skipped: 0 });
      expect(modelCalls).toBe(0);
      expect(sent).toHaveLength(0);
    }
  });

  it("a buyer who became suppressed after scheduling gets nothing drafted, and an approved email is skipped", async () => {
    const { site, order } = await setup({ mode: "approval", plan: "starter" });
    await scheduleForOrder(order.id, T0);
    await makeContact(site.id, { status: "unsubscribed" });
    await tick(day(5));
    expect(modelCalls).toBe(0);
    expect((await byStep(1))[0].status).toBe("skipped");

    await resetDb();
    const s2 = await setup({ mode: "approval", plan: "starter" });
    await scheduleForOrder(s2.order.id, T0);
    await tick(day(5));
    await db.update(buyerEmails).set({ status: "approved" }).where(eq(buyerEmails.status, "draft"));
    await db.update(buyers).set({ status: "unsubscribed" }).where(eq(buyers.id, s2.buyer.id));
    expect(await tick(day(6))).toMatchObject({ sent: 0, skipped: 1 });
    expect(sent).toHaveLength(0);
  });

  it("orders from before buyer emails were (last) switched on are never emailed", async () => {
    const { site, order } = await setup();
    await scheduleForOrder(order.id, T0);
    await db.update(sites).set({ buyerEmailsSince: day(1) }).where(eq(sites.id, site.id));
    await tick(day(5));
    expect(modelCalls).toBe(0);
    expect(sent).toHaveLength(0);
    expect((await byStep(1))[0].status).toBe("skipped");
  });

  it("two ticks at once send exactly once", async () => {
    const { order } = await setup();
    await scheduleForOrder(order.id, T0);
    await Promise.all([tick(day(5)), tick(day(5))]);
    expect(sent).toHaveLength(1);
    expect((await byStep(1)).map((r) => r.status)).toEqual(["sent"]);
  });

  it("a failed write is retried a day later, and gives up after 3", async () => {
    const { order } = await setup();
    await scheduleForOrder(order.id, T0);
    let calls = 0;
    const broken: CallModel = async () => {
      calls++;
      return { content: { nope: true }, model: "claude-sonnet-5-5", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    };
    await emailTick(day(5), { callModel: broken });
    await emailTick(new Date(day(5).getTime() + H), { callModel: broken });
    expect(calls).toBe(1);
    expect((await byStep(1))[0]).toMatchObject({ status: "scheduled", attempts: 1, scheduledFor: day(6) });
    await emailTick(day(6), { callModel: broken });
    await emailTick(day(7), { callModel: broken });
    expect(calls).toBe(3);
    expect((await byStep(1))[0]).toMatchObject({ status: "failed", attempts: 3 });
    expect(sent).toHaveLength(0);
  });
});

describe("at most one email per 7 days to an address, across both tracks", () => {
  it("a chat follow-up sent 3 days before day 5 pushes the buyer email to 7 days after it", async () => {
    const { site, order } = await setup();
    const contact = await makeContact(site.id);
    await db.insert(emailMessages).values({
      siteId: site.id,
      contactId: contact.id,
      step: 1,
      status: "sent",
      subject: "s",
      body: "b",
      language: "en",
      scheduledFor: day(2),
      sentAt: day(2),
    });
    await scheduleForOrder(order.id, T0);
    expect(await tick(day(5))).toEqual({ drafted: 0, sent: 0, skipped: 0 });
    expect(modelCalls).toBe(0);
    expect((await byStep(1))[0]).toMatchObject({ status: "scheduled", scheduledFor: day(9) });
    await tick(new Date(day(9).getTime() - 60_000));
    expect(sent).toHaveLength(0);
    await tick(day(9));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(EMAIL);
  });

  it("an approved buyer email waits when a chat email went out meanwhile", async () => {
    const { site, order } = await setup({ mode: "approval", plan: "starter" });
    await scheduleForOrder(order.id, T0);
    await tick(day(5));
    const contact = await makeContact(site.id);
    await db.insert(emailMessages).values({ siteId: site.id, contactId: contact.id, step: 1, status: "sent", subject: "s", body: "b", language: "en", scheduledFor: day(6), sentAt: day(6) });
    await db.update(buyerEmails).set({ status: "approved", scheduledFor: day(7) }).where(eq(buyerEmails.status, "draft"));
    expect(await tick(day(7))).toEqual({ drafted: 0, sent: 0, skipped: 0 });
    expect((await byStep(1))[0]).toMatchObject({ status: "approved", scheduledFor: day(13) });
    await tick(day(13));
    expect(sent).toHaveLength(1);
  });

  it("a chat follow-up waits 7 days after a buyer email", async () => {
    const { site, order } = await setup();
    await scheduleForOrder(order.id, T0);
    await tick(day(5));
    expect(sent).toHaveLength(1);
    const convo = await makeConversation(site.id, { lastMessageAt: day(5) });
    const contact = await makeContact(site.id, { sequenceConversationId: convo.id });
    await db.insert(emailMessages).values({ siteId: site.id, contactId: contact.id, step: 1, status: "approved", subject: "s", body: "b", language: "en", scheduledFor: day(6) });
    expect(await tick(day(6))).toMatchObject({ sent: 0, skipped: 0 });
    const [chat] = await db.select().from(emailMessages).where(eq(emailMessages.contactId, contact.id));
    expect(chat).toMatchObject({ status: "approved", scheduledFor: day(12) });
    await tick(day(12));
    expect(sent.map((m) => m.subject)).toEqual(["Subject 1", "s"]);
  });

  it("step 2 waits for a step 1 that was delayed, then keeps the gap", async () => {
    const { site, order } = await setup({ verified: false });
    await scheduleForOrder(order.id, T0);
    await tick(day(10));
    await db.update(sites).set({ sendingDomainStatus: "verified" }).where(eq(sites.id, site.id));
    await tick(day(15));
    expect(sent).toHaveLength(1);
    expect((await byStep(1))[0].status).toBe("sent");
    await tick(day(16));
    expect(sent).toHaveLength(1);
    expect((await byStep(2))[0]).toMatchObject({ status: "scheduled", scheduledFor: day(22) });
    await tick(day(22));
    expect(sent).toHaveLength(2);
  });
});

describe("one suppression check for both tracks", () => {
  it("a buyer who unsubscribed gets no chat follow-up: none drafted, a pending one skipped", async () => {
    const { site, buyer } = await setup();
    const convo = await makeConversation(site.id, { lastMessageAt: day(0) });
    const contact = await makeContact(site.id, { sequenceConversationId: convo.id });
    await db.update(buyers).set({ status: "unsubscribed" }).where(eq(buyers.id, buyer.id));
    // Due by its own schedule (2 hours after the chat), but never written.
    expect(await tick(day(1))).toEqual({ drafted: 0, sent: 0, skipped: 0 });
    expect(modelCalls).toBe(0);
    // One approved before the unsubscribe is skipped, not sent.
    await db.insert(emailMessages).values({ siteId: site.id, contactId: contact.id, step: 1, status: "approved", subject: "s", body: "b", language: "en", scheduledFor: day(1) });
    expect(await tick(day(2))).toEqual({ drafted: 0, sent: 0, skipped: 1 });
    expect(sent).toHaveLength(0);
    const [chat] = await db.select().from(emailMessages).where(eq(emailMessages.contactId, contact.id));
    expect(chat.status).toBe("skipped");
  });
});

describe("deletePerson", () => {
  it("erasure sticks: a later order from the address schedules and sends nothing; others are unaffected", async () => {
    const { site, order } = await setup();
    await scheduleForOrder(order.id, T0);
    await deletePerson(site.id, "Maria@Example.com");
    const supp = await db.select().from(emailSuppressions);
    expect(supp).toEqual([expect.objectContaining({ siteId: site.id, emailHash: emailHash(EMAIL), reason: "erased" })]);
    expect(JSON.stringify(supp)).not.toMatch(/maria/i);
    expect(await isSuppressed(site.id, EMAIL)).toBe(true);

    const woo = (id: number, billingEmail: string): WooOrder => ({
      id,
      orderKey: `k${id}`,
      status: "completed",
      currency: "EUR",
      total: "10.00",
      createdGmt: "2026-11-11T10:00:00",
      billingEmail,
      firstName: "X",
      items: [{ productId: 7, name: "Olive oil" }],
    });
    await pollOrders(day(1), {
      list: async () => ({ orders: [woo(50, "MARIA@example.com"), woo(51, "other@example.com")], truncated: false }),
      urls: async () => new Map(),
    });
    const [other] = await db.select().from(buyers).where(eq(buyers.email, "other@example.com"));
    const r = await rows();
    expect(r.every((x) => x.buyerId === other.id)).toBe(true);
    expect(r).toHaveLength(2);
    await tick(day(6));
    expect(sent.map((m) => m.to)).toEqual(["other@example.com"]);
    // Another site's same address is not suppressed.
    const elsewhere = await makeSite((await makeAccount()).id);
    expect(await isSuppressed(elsewhere.id, EMAIL)).toBe(false);
  });

  it("a confirmed new chat opt-in lifts the erasure; an unsubscribed-buyer hash stays", async () => {
    const { site } = await setup();
    await deletePerson(site.id, EMAIL);
    const optIn = async () => {
      const contact = await makeContact(site.id, { status: "pending", confirmedAt: null, consentedAt: day(1) });
      await makeConversation(site.id, { contactId: contact.id, lastMessageAt: day(1) });
      return contact;
    };
    // Only pending, not confirmed: still suppressed.
    const contact = await optIn();
    expect(await isSuppressed(site.id, EMAIL)).toBe(true);
    expect(await confirmContact(contact.token, day(1))).not.toBeNull();
    expect(await isSuppressed(site.id, EMAIL)).toBe(false);
    expect(await db.select().from(emailSuppressions)).toHaveLength(0);
    // The chat follow-up is written again (the site's chat emails wait for approval).
    expect(await tick(new Date(day(1).getTime() + 3 * H))).toMatchObject({ drafted: 1 });
    expect((await db.select().from(emailMessages).where(eq(emailMessages.contactId, contact.id))).map((m) => m.status)).toEqual(["draft"]);

    // A buyer unsubscribe kept as a hash isn't lifted by chat consent.
    await db.delete(contacts).where(eq(contacts.siteId, site.id));
    await suppress(site.id, EMAIL, "unsubscribed");
    const again = await optIn();
    await confirmContact(again.token, day(1));
    expect(await isSuppressed(site.id, EMAIL)).toBe(true);
    expect((await db.select().from(emailSuppressions)).map((x) => x.reason)).toEqual(["unsubscribed"]);
  });

  it("removes the buyer with their orders and emails", async () => {
    const { site, order } = await setup();
    await scheduleForOrder(order.id, T0);
    await tick(day(5));
    expect(await deletePerson(site.id, "Maria@Example.com")).toEqual({ deleted: true });
    expect(await db.select().from(buyers)).toHaveLength(0);
    expect(await db.select().from(buyerOrders)).toHaveLength(0);
    expect(await db.select().from(buyerEmails)).toHaveLength(0);
  });
});
