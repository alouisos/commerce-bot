// Reads each opted-in shop's new orders and records who bought what. It records only; emails are
// scheduled from the new orders by a later step.
import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, buyerOrders, buyers, sites, storeConnections } from "@/db/schema";
import { getStoreCredentials, markConnectionFailing } from "@/lib/sales/connections";
import { utc } from "@/lib/sales/verify";
import { listOrdersSince, productUrls, WooError, type WooOrder } from "@/lib/sales/woocommerce";

const LOOKBACK_MS = 24 * 3600_000;
const token = (bytes: number) => randomBytes(bytes).toString("base64url");

type Deps = { list?: typeof listOrdersSince; urls?: typeof productUrls };

async function pollSite(
  site: { id: string; buyerEmailsSince: Date; ordersPolledAt: Date | null },
  now: Date,
  deps: Required<Deps>,
): Promise<string[]> {
  const creds = await getStoreCredentials(site.id);
  if (!creds) return [];
  const since = site.buyerEmailsSince;
  // Look back a day every time: an order that was pending when last seen and is paid later still has its
  // original creation date. Re-read orders are deduped below and don't count as new.
  const lookback = site.ordersPolledAt ? new Date(site.ordersPolledAt.getTime() - LOOKBACK_MS) : since;
  const after = lookback > since ? lookback : since;
  let truncated = false;
  let orders: WooOrder[];
  let urls = new Map<number, string>();
  try {
    const listed = await deps.list(creds, after);
    truncated = listed.truncated;
    orders = listed.orders.filter((o) => utc(o.createdGmt) >= since && o.billingEmail);
    const ids = orders.flatMap((o) => o.items.map((i) => i.productId));
    if (ids.length > 0) urls = await deps.urls(creds, ids).catch(() => new Map<number, string>());
  } catch (e) {
    await markConnectionFailing(site.id, e instanceof WooError ? e.message : "Couldn't read your shop's orders");
    return [];
  }

  const newOrderIds: string[] = [];
  for (const o of orders) {
    const email = o.billingEmail!.trim().toLowerCase();
    await db
      .insert(buyers)
      .values({ siteId: site.id, email, firstName: o.firstName, status: "subscribed", token: token(32), ref: token(16) })
      .onConflictDoNothing({ target: [buyers.siteId, buyers.email] });
    const [buyer] = await db
      .select({ id: buyers.id })
      .from(buyers)
      .where(and(eq(buyers.siteId, site.id), eq(buyers.email, email)));
    const [row] = await db
      .insert(buyerOrders)
      .values({
        siteId: site.id,
        buyerId: buyer.id,
        externalId: String(o.id),
        orderedAt: utc(o.createdGmt),
        items: o.items.map((i) => ({ ...i, url: urls.get(i.productId) ?? null })),
      })
      .onConflictDoNothing({ target: [buyerOrders.siteId, buyerOrders.externalId] })
      .returning({ id: buyerOrders.id });
    if (row) newOrderIds.push(row.id);
  }
  // Only after every order is stored, so a failure above is retried from the same point.
  await db
    .update(storeConnections)
    .set({ status: "connected", lastError: null })
    .where(and(eq(storeConnections.siteId, site.id), eq(storeConnections.status, "failing")));
  // When the list was cut off, continue from where it stopped (the next poll looks back LOOKBACK_MS from here).
  const last = orders.length > 0 ? utc(orders[orders.length - 1].createdGmt) : null;
  const polledAt = truncated && last ? new Date(Math.min(last.getTime() + LOOKBACK_MS, now.getTime())) : now;
  await db.update(sites).set({ ordersPolledAt: polledAt }).where(eq(sites.id, site.id));
  return newOrderIds;
}

/** Records new orders of every site that switched buyer emails on. Returns how many new orders were recorded. */
export async function pollOrders(now: Date = new Date(), opts: Deps = {}): Promise<number> {
  const deps = { list: opts.list ?? listOrdersSince, urls: opts.urls ?? productUrls };
  const rows = await db
    .select({ id: sites.id, since: sites.buyerEmailsSince, polledAt: sites.ordersPolledAt })
    .from(sites)
    .innerJoin(accounts, eq(accounts.id, sites.accountId))
    .innerJoin(storeConnections, eq(storeConnections.siteId, sites.id))
    .where(and(ne(sites.buyerEmails, "off"), isNull(accounts.removedAt), inArray(storeConnections.status, ["connected", "failing"])));
  const created: string[] = [];
  for (const r of rows) {
    if (!r.since) continue;
    try {
      created.push(...(await pollSite({ id: r.id, buyerEmailsSince: r.since, ordersPolledAt: r.polledAt }, now, deps)));
    } catch (e) {
      console.error(`[buyers] poll failed for ${r.id}`, e);
    }
  }
  // Task 13: schedule an email for each id in `created`.
  return created.length;
}
