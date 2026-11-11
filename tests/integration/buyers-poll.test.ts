import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, buyerOrders, buyers, sites, storeConnections } from "@/db/schema";
import { pollOrders } from "@/lib/buyers/poll";
import { connectWooCommerce } from "@/lib/sales/connections";
import { setWooTransportForTests, WooError, type WooOrder } from "@/lib/sales/woocommerce";
import { resetDb } from "../helpers/db";
import { makeAccount, makeSite } from "../helpers/factories";

const CK = "ck_" + "a".repeat(40);
const CS = "cs_" + "b".repeat(40);
const since = new Date("2026-11-10T00:00:00Z");
const now = new Date("2026-11-11T12:00:00Z");

const order = (id: number, over: Partial<WooOrder> = {}): WooOrder => ({
  id,
  orderKey: `k${id}`,
  status: "completed",
  currency: "EUR",
  total: "10.00",
  createdGmt: "2026-11-10T10:00:00",
  billingEmail: "Maria@Example.com",
  firstName: "Maria",
  items: [{ productId: 7, name: "Olive oil" }],
  ...over,
});

beforeEach(async () => {
  await resetDb();
  // connectWooCommerce tests the connection through the transport.
  setWooTransportForTests({
    fetch: (async () => new Response("[]", { status: 200 })) as typeof fetch,
    lookup: async () => ["93.184.216.34"],
  });
});

async function setup(over: Partial<typeof sites.$inferInsert> = { buyerEmails: "approval", buyerEmailsSince: since }) {
  const account = await makeAccount({ plan: "starter" });
  const site = await makeSite(account.id, { baseUrl: "https://milianjo.com", allowedOrigins: ["https://milianjo.com"], ...over });
  await connectWooCommerce(site.id, { storeUrl: "https://milianjo.com", consumerKey: CK, consumerSecret: CS });
  return { account, site };
}

const urls = async () => new Map([[7, "https://milianjo.com/p/oil"]]);

describe("pollOrders", () => {
  it("records buyers lowercased with their orders and product links, and advances ordersPolledAt", async () => {
    const { site } = await setup();
    const n = await pollOrders(now, { list: async () => [order(1)], urls });
    expect(n).toBe(1);
    const [b] = await db.select().from(buyers);
    expect(b).toMatchObject({ siteId: site.id, email: "maria@example.com", firstName: "Maria", status: "subscribed" });
    expect(b.token).toBeTruthy();
    expect(b.ref).toBeTruthy();
    const [o] = await db.select().from(buyerOrders);
    expect(o.externalId).toBe("1");
    expect(o.items).toEqual([{ productId: 7, name: "Olive oil", url: "https://milianjo.com/p/oil" }]);
    const [s] = await db.select().from(sites).where(eq(sites.id, site.id));
    expect(s.ordersPolledAt).toEqual(now);
  });

  it("never polls a site with buyer emails off", async () => {
    await setup({ buyerEmails: "off" });
    let called = 0;
    expect(await pollOrders(now, { list: async () => (called++, [order(1)]), urls })).toBe(0);
    expect(called).toBe(0);
    expect(await db.select().from(buyers)).toHaveLength(0);
  });

  it("asks for orders after buyerEmailsSince and imports none from before it", async () => {
    await setup();
    const asked: Date[] = [];
    const n = await pollOrders(now, {
      list: async (_c, after) => {
        asked.push(after);
        return [order(1, { createdGmt: "2026-11-09T23:59:00" }), order(2, { createdGmt: "2026-11-10T00:01:00", billingEmail: "new@example.com" })];
      },
      urls,
    });
    expect(asked[0]).toEqual(since);
    expect(n).toBe(1);
    const rows = await db.select().from(buyerOrders);
    expect(rows.map((r) => r.externalId)).toEqual(["2"]);
  });

  it("asks after the last poll once there has been one", async () => {
    await setup();
    await pollOrders(now, { list: async () => [], urls });
    const asked: Date[] = [];
    await pollOrders(new Date("2026-11-11T13:00:00Z"), { list: async (_c, a) => (asked.push(a), []), urls });
    expect(asked[0]).toEqual(now);
  });

  it("does not duplicate a repeated order and reuses the buyer", async () => {
    await setup();
    expect(await pollOrders(now, { list: async () => [order(1)], urls })).toBe(1);
    expect(await pollOrders(now, { list: async () => [order(1), order(2, { billingEmail: "MARIA@example.com" })], urls })).toBe(1);
    expect(await db.select().from(buyers)).toHaveLength(1);
    expect(await db.select().from(buyerOrders)).toHaveLength(2);
  });

  it("keeps a null first name and a null product url when the lookup fails", async () => {
    await setup();
    await pollOrders(now, {
      list: async () => [order(1, { firstName: null })],
      urls: async () => {
        throw new WooError("unavailable", "x");
      },
    });
    const [b] = await db.select().from(buyers);
    expect(b.firstName).toBeNull();
    const [o] = await db.select().from(buyerOrders);
    expect(o.items[0].url).toBeNull();
  });

  it("marks a failing store, keeps ordersPolledAt, and polls it again next time", async () => {
    const { site } = await setup();
    const fail = async () => {
      throw new WooError("unauthorized", "WooCommerce refused the key");
    };
    expect(await pollOrders(now, { list: fail, urls })).toBe(0);
    const [c] = await db.select().from(storeConnections).where(eq(storeConnections.siteId, site.id));
    expect(c).toMatchObject({ status: "failing", lastError: "WooCommerce refused the key" });
    const [s] = await db.select().from(sites).where(eq(sites.id, site.id));
    expect(s.ordersPolledAt).toBeNull();
    expect(await pollOrders(now, { list: async () => [order(1)], urls })).toBe(1);
    const [c2] = await db.select().from(storeConnections).where(eq(storeConnections.siteId, site.id));
    expect(c2.status).toBe("connected");
  });

  it("skips orders without a billing email and removed accounts", async () => {
    const { account } = await setup();
    expect(await pollOrders(now, { list: async () => [order(1, { billingEmail: null })], urls })).toBe(0);
    await db.update(accounts).set({ removedAt: now }).where(eq(accounts.id, account.id));
    let called = 0;
    expect(await pollOrders(now, { list: async () => (called++, [order(2)]), urls })).toBe(0);
    expect(called).toBe(0);
  });
});
