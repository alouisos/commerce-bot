// Checking a purchase the widget saw against the shop's WooCommerce: the order exists, its key matches
// the page the visitor was on, and it's paid (or awaiting a bank transfer). Then attribution and the amount.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, sites } from "@/db/schema";
import { stopSequence } from "@/lib/email/schedule";
import { enqueue, JOBS, type JobData } from "@/lib/jobs";
import { contactFor, emailAttribution, visitAttribution } from "./attribution";
import { getStoreCredentials, markConnectionFailing } from "./connections";
import { toMinorUnits } from "./money";
import { saveSale } from "./record";
import { fetchOrder, WooError } from "./woocommerce";

const COUNTED = new Set(["processing", "completed", "on-hold"]);
/** A pending order is looked at again after these delays, then dropped. */
const PENDING_RECHECK_MINUTES = [30, 60, 120];

export function utc(gmt: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(gmt) ? gmt : `${gmt}Z`);
}

export async function verifyOrder(
  data: JobData["verify-order"],
  opts: { now?: Date } = {},
): Promise<"recorded" | "unattributed" | "rejected" | "retry"> {
  const now = opts.now ?? new Date();
  // A removed customer's bot is off: no checks, no sales recorded.
  const [active] = await db
    .select({ id: sites.id })
    .from(sites)
    .innerJoin(accounts, eq(accounts.id, sites.accountId))
    .where(and(eq(sites.id, data.siteId), isNull(accounts.removedAt)));
  if (!active) return "rejected";
  let creds;
  try {
    creds = await getStoreCredentials(data.siteId);
  } catch {
    // The app secret changed since the key was saved: every check would fail, so say so in Settings.
    await markConnectionFailing(data.siteId, "The saved WooCommerce key can't be read any more. Reconnect WooCommerce.");
    return "rejected";
  }
  if (!creds) return "rejected";

  let order;
  try {
    order = await fetchOrder(creds, data.orderId);
  } catch (err) {
    if (err instanceof WooError && err.kind === "unauthorized") {
      await markConnectionFailing(data.siteId, "WooCommerce refused the key. Reconnect it in Settings.");
      return "rejected";
    }
    if (err instanceof WooError && (err.kind === "redirect" || err.kind === "no-api")) {
      await markConnectionFailing(data.siteId, err.message);
      return "rejected";
    }
    throw err; // the shop is unreachable: pg-boss retries
  }
  if (!order || order.orderKey !== data.orderKey) return "rejected";

  if (!COUNTED.has(order.status)) {
    const attempt = data.attempt ?? 0;
    if (order.status === "pending" && attempt < PENDING_RECHECK_MINUTES.length) {
      await enqueue(
        JOBS.verifyOrder,
        { ...data, attempt: attempt + 1 },
        {
          startAfter: new Date(now.getTime() + PENDING_RECHECK_MINUTES[attempt] * 60_000),
          singletonKey: `${data.siteId}:${data.orderId}:${attempt + 1}`,
        },
      );
      return "retry";
    }
    return "rejected";
  }

  const orderedAt = utc(order.createdGmt);
  const seenAt = new Date(data.seenAt);
  const by = { ref: data.ref, email: order.billingEmail };
  const visit = await visitAttribution(data.siteId, data.sid, seenAt);
  const email = await emailAttribution(data.siteId, by, orderedAt);

  // Buying ends their series of follow-ups, whether or not an email helped.
  const contactId = email?.contactId ?? (await contactFor(data.siteId, by));
  if (contactId) await stopSequence(contactId, now);

  if (!visit.conversationId && !visit.promptImpressionId && !email) return "unattributed";
  await saveSale({
    siteId: data.siteId,
    source: "woocommerce",
    externalId: String(order.id),
    verified: true,
    amountMinor: toMinorUnits(order.total, order.currency),
    currency: order.currency,
    orderedAt,
    visitorSessionId: data.sid,
    pageUrl: data.url,
    viaChat: !!visit.conversationId,
    viaPrompt: !!visit.promptImpressionId,
    viaEmail: !!email,
    conversationId: visit.conversationId,
    promptImpressionId: visit.promptImpressionId,
    contactId: email?.contactId ?? null,
    emailMessageId: email?.emailMessageId ?? null,
  });
  return "recorded";
}
