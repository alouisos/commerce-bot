import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, contacts, emailMessages, sales, storeConnections } from "@/db/schema";
import { deletePerson } from "@/lib/email/admin";
import { clearEnqueuedJobs, enqueuedJobs, JOBS, type JobData } from "@/lib/jobs";
import { connectWooCommerce } from "@/lib/sales/connections";
import { verifyOrder } from "@/lib/sales/verify";
import { setWooTransportForTests } from "@/lib/sales/woocommerce";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeMessage, makeSite } from "../helpers/factories";

const CK = "ck_" + "a".repeat(40);
const CS = "cs_" + "b".repeat(40);
const SID = "visitor_buying_1";
const now = new Date("2026-11-10T12:00:00Z");
const seenAt = new Date("2026-11-10T11:00:00Z");

let order: Record<string, unknown> | null;
let status = 200;
let notFoundBody = { code: "woocommerce_rest_shop_order_invalid_id", message: "Invalid ID." };
let redirectTo: string | null = null;
let gets: string[] = [];

function wooOrder(over: Record<string, unknown> = {}) {
  return {
    id: 1234,
    order_key: "wc_order_AbC123xyz",
    status: "processing",
    currency: "EUR",
    total: "34.90",
    date_created_gmt: "2026-11-10T10:59:00",
    billing: { email: "Maria@Example.com" },
    ...over,
  };
}

beforeEach(async () => {
  await resetDb();
  clearEnqueuedJobs();
  order = wooOrder();
  status = 200;
  notFoundBody = { code: "woocommerce_rest_shop_order_invalid_id", message: "Invalid ID." };
  redirectTo = null;
  gets = [];
  setWooTransportForTests({
    fetch: (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      gets.push(url.pathname);
      if (url.pathname.endsWith("/orders")) return new Response("[]", { status: 200 });
      if (redirectTo) return new Response(null, { status: 301, headers: { location: redirectTo } });
      if (status !== 200) return new Response("{}", { status });
      return order ? new Response(JSON.stringify(order), { status: 200 }) : new Response(JSON.stringify(notFoundBody), { status: 404 });
    }) as typeof fetch,
    lookup: async () => ["93.184.216.34"],
  });
});
afterEach(() => setWooTransportForTests(null));

async function setup(opts: { chat?: boolean } = { chat: true }) {
  const account = await makeAccount({ plan: "starter" });
  const site = await makeSite(account.id, { baseUrl: "https://milianjo.com", allowedOrigins: ["https://milianjo.com"] });
  await connectWooCommerce(site.id, { storeUrl: "https://milianjo.com", consumerKey: CK, consumerSecret: CS });
  if (opts.chat) {
    const convo = await makeConversation(site.id, { visitorSessionId: SID, createdAt: new Date("2026-11-10T10:30:00Z") });
    await makeMessage(convo.id);
  }
  return { site };
}

const job = (siteId: string, over: Partial<JobData["verify-order"]> = {}): JobData["verify-order"] => ({
  siteId,
  sid: SID,
  url: "https://milianjo.com/checkout/order-received/1234/",
  orderId: "1234",
  orderKey: "wc_order_AbC123xyz",
  ref: null,
  seenAt: seenAt.toISOString(),
  ...over,
});

async function subscriber(siteId: string, clickedAt: Date | null) {
  const [c] = await db
    .insert(contacts)
    .values({
      siteId,
      email: "maria@example.com",
      language: "el",
      status: "subscribed",
      consentText: "x",
      consentLanguage: "el",
      consentedAt: new Date("2026-10-01T00:00:00Z"),
      confirmedAt: new Date("2026-10-01T00:00:00Z"),
      token: "t".repeat(43),
      ref: "r".repeat(22),
      sequenceConversationId: (await makeConversation(siteId)).id,
    })
    .returning();
  const [sent] = await db
    .insert(emailMessages)
    .values({ siteId, contactId: c.id, step: 1, status: "sent", subject: "s", body: "b", language: "el", scheduledFor: now, sentAt: new Date("2026-11-05T00:00:00Z"), lastClickedAt: clickedAt })
    .returning();
  const [approved] = await db
    .insert(emailMessages)
    .values({ siteId, contactId: c.id, step: 2, status: "approved", subject: "s", body: "b", language: "el", scheduledFor: now })
    .returning();
  return { contact: c, sent, approved };
}

const allSales = () => db.select().from(sales);

describe("verifyOrder", () => {
  it("records a verified sale with the real amount, once", async () => {
    const { site } = await setup();
    expect(await verifyOrder(job(site.id), { now })).toBe("recorded");
    expect(gets).toContain("/wp-json/wc/v3/orders/1234");
    const [sale] = await allSales();
    expect(sale).toMatchObject({
      source: "woocommerce",
      verified: true,
      externalId: "1234",
      amountMinor: 3490,
      currency: "EUR",
      viaChat: true,
      orderedAt: new Date("2026-11-10T10:59:00Z"),
    });
    expect(await verifyOrder(job(site.id), { now })).toBe("recorded");
    expect(await allSales()).toHaveLength(1);
  });

  it("a wrong order key or an unknown order records nothing", async () => {
    const { site } = await setup();
    expect(await verifyOrder(job(site.id, { orderKey: "wc_order_Forged999" }), { now })).toBe("rejected");
    order = null;
    expect(await verifyOrder(job(site.id), { now })).toBe("rejected");
    expect(await allSales()).toHaveLength(0);
  });

  it("a refused key marks the connection failing", async () => {
    const { site } = await setup();
    status = 401;
    expect(await verifyOrder(job(site.id), { now })).toBe("rejected");
    const [conn] = await db.select().from(storeConnections).where(eq(storeConnections.siteId, site.id));
    expect(conn).toMatchObject({ status: "failing", lastError: "WooCommerce refused the key. Reconnect it in Settings." });
  });

  it("a shop that now redirects marks the connection failing, naming where", async () => {
    const { site } = await setup();
    redirectTo = "https://www.milianjo.com/wp-json/wc/v3/orders/1234";
    expect(await verifyOrder(job(site.id), { now })).toBe("rejected");
    const [conn] = await db.select().from(storeConnections).where(eq(storeConnections.siteId, site.id));
    expect(conn).toMatchObject({
      status: "failing",
      lastError: "Your shop redirects to https://www.milianjo.com. Reconnect WooCommerce with that address.",
    });
  });

  it("a REST API that's gone marks the connection failing; a missing order doesn't", async () => {
    const { site } = await setup();
    order = null;
    expect(await verifyOrder(job(site.id), { now })).toBe("rejected");
    expect((await db.select().from(storeConnections))[0].status).toBe("connected");
    notFoundBody = { code: "rest_no_route", message: "No route was found" };
    expect(await verifyOrder(job(site.id), { now })).toBe("rejected");
    expect((await db.select().from(storeConnections))[0]).toMatchObject({
      status: "failing",
      lastError: "Your shop's WooCommerce REST API can't be reached any more. Reconnect WooCommerce.",
    });
  });

  it("a stored key that can't be read marks the connection failing", async () => {
    const { site } = await setup();
    await db.update(storeConnections).set({ consumerSecretEnc: "v1.broken.broken.broken" });
    expect(await verifyOrder(job(site.id), { now })).toBe("rejected");
    expect((await db.select().from(storeConnections))[0]).toMatchObject({
      status: "failing",
      lastError: "The saved WooCommerce key can't be read any more. Reconnect WooCommerce.",
    });
  });

  it("an outage throws, so the job is retried", async () => {
    const { site } = await setup();
    status = 503;
    await expect(verifyOrder(job(site.id), { now })).rejects.toThrow();
    expect(await allSales()).toHaveLength(0);
  });

  it.each(["refunded", "failed", "cancelled", "checkout-draft"])("a %s order isn't counted", async (s) => {
    const { site } = await setup();
    order = wooOrder({ status: s });
    expect(await verifyOrder(job(site.id), { now })).toBe("rejected");
    expect(await allSales()).toHaveLength(0);
  });

  it.each(["completed", "on-hold"])("a %s order is counted", async (s) => {
    const { site } = await setup();
    order = wooOrder({ status: s });
    expect(await verifyOrder(job(site.id), { now })).toBe("recorded");
  });

  it("a pending order is checked again later, three times at most", async () => {
    const { site } = await setup();
    order = wooOrder({ status: "pending" });
    expect(await verifyOrder(job(site.id), { now })).toBe("retry");
    const [again] = enqueuedJobs().filter((j) => j.name === JOBS.verifyOrder);
    expect(again.data).toMatchObject({ orderId: "1234", attempt: 1 });
    expect(again.options.startAfter).toEqual(new Date(now.getTime() + 30 * 60_000));
    expect(await verifyOrder(job(site.id, { attempt: 3 }), { now })).toBe("rejected");
    expect(await allSales()).toHaveLength(0);
  });

  it("a billing email of a contact who clicked recently attributes it to the email and stops the series", async () => {
    const { site } = await setup({ chat: false });
    const { contact, sent, approved } = await subscriber(site.id, new Date("2026-11-07T00:00:00Z"));
    expect(await verifyOrder(job(site.id), { now })).toBe("recorded");
    const [sale] = await allSales();
    expect(sale).toMatchObject({ viaEmail: true, viaChat: false, contactId: contact.id, emailMessageId: sent.id });
    expect((await db.select().from(emailMessages).where(eq(emailMessages.id, approved.id)))[0].status).toBe("discarded");
    expect((await db.select().from(contacts).where(eq(contacts.id, contact.id)))[0].sequenceConversationId).toBeNull();
    // The billing address is stored nowhere but the contact it matched.
    const hits = await db.execute(sql`select count(*)::int as n from sales where row_to_json(sales)::text ilike '%maria@%'`);
    expect(Number((hits as unknown as { n: number }[])[0]?.n ?? (hits as unknown as { rows: { n: number }[] }).rows?.[0]?.n)).toBe(0);
  });

  it("a subscriber who buys without a recent click: no sale stored, but the series stops", async () => {
    const { site } = await setup({ chat: false });
    const { contact, approved } = await subscriber(site.id, null);
    expect(await verifyOrder(job(site.id), { now })).toBe("unattributed");
    expect(await allSales()).toHaveLength(0);
    expect((await db.select().from(emailMessages).where(eq(emailMessages.id, approved.id)))[0].status).toBe("discarded");
    expect((await db.select().from(contacts).where(eq(contacts.id, contact.id)))[0].sequenceConversationId).toBeNull();
  });

  it("a purchase the bot didn't help with leaves nothing", async () => {
    const { site } = await setup({ chat: false });
    expect(await verifyOrder(job(site.id), { now })).toBe("unattributed");
    expect(await allSales()).toHaveLength(0);
  });

  it("a garbled total keeps the sale without an amount", async () => {
    const { site } = await setup();
    order = wooOrder({ total: "lots" });
    expect(await verifyOrder(job(site.id), { now })).toBe("recorded");
    expect((await allSales())[0].amountMinor).toBeNull();
  });

  it("without a connection the job does nothing", async () => {
    const site = await makeSite((await makeAccount()).id);
    expect(await verifyOrder(job(site.id), { now })).toBe("rejected");
  });

  it("deleting the person keeps the sale as an anonymous count", async () => {
    const { site } = await setup({ chat: false });
    await subscriber(site.id, new Date("2026-11-07T00:00:00Z"));
    await verifyOrder(job(site.id), { now });
    await deletePerson(site.id, "maria@example.com");
    const [sale] = await allSales();
    expect(sale).toMatchObject({ contactId: null, emailMessageId: null, viaEmail: true, amountMinor: 3490 });
  });
});

describe("verifyOrder and removed customers", () => {
  it("rejects without calling the shop or recording a sale", async () => {
    const { site } = await setup();
    await db.update(accounts).set({ removedAt: now }).where(eq(accounts.id, site.accountId));
    gets = [];
    expect(await verifyOrder(job(site.id), { now })).toBe("rejected");
    expect(gets).toHaveLength(0);
    expect(await allSales()).toHaveLength(0);
  });
});
