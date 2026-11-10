// A purchase the widget saw. Connected WooCommerce shops are checked by a job; other sites get an
// unverified sale without an amount. Only purchases the bot helped are stored.
import { db } from "@/db/client";
import { sales } from "@/db/schema";
import { stopSequence } from "@/lib/email/schedule";
import { enqueue, JOBS } from "@/lib/jobs";
import type { WidgetSite } from "@/lib/widget/guard";
import { emailAttribution, visitAttribution } from "./attribution";
import { hasStoreConnection } from "./connections";

export type Sighting = { sid: string; url: string; orderId: string | null; orderKey: string | null; ref: string | null };

/** Inserts a sale unless the same order (or visit and page) is already stored. True when a row was added. */
export async function saveSale(values: typeof sales.$inferInsert): Promise<boolean> {
  const rows = await db.insert(sales).values(values).onConflictDoNothing().returning({ id: sales.id });
  return rows.length > 0;
}

export async function recordSighting(site: WidgetSite, input: Sighting, now: Date = new Date()): Promise<void> {
  if (await hasStoreConnection(site.id)) {
    // Only an order the shop can confirm counts here; the key proves the browser saw the real order page.
    if (!input.orderId || !input.orderKey) return;
    await enqueue(
      JOBS.verifyOrder,
      { siteId: site.id, ...input, orderId: input.orderId, orderKey: input.orderKey, seenAt: now.toISOString() },
      // One check per order per hour, however many times the page is reported.
      { singletonKey: `${site.id}:${input.orderId}`, singletonSeconds: 3600 },
    );
    return;
  }

  const visit = await visitAttribution(site.id, input.sid, now);
  const email = await emailAttribution(site.id, { ref: input.ref, email: null }, now);
  if (!visit.conversationId && !visit.promptImpressionId && !email) return;
  await saveSale({
    siteId: site.id,
    source: "page",
    externalId: input.orderId,
    verified: false,
    amountMinor: null,
    currency: null,
    orderedAt: now,
    visitorSessionId: input.sid,
    pageUrl: input.url,
    viaChat: !!visit.conversationId,
    viaPrompt: !!visit.promptImpressionId,
    viaEmail: !!email,
    conversationId: visit.conversationId,
    promptImpressionId: visit.promptImpressionId,
    contactId: email?.contactId ?? null,
    emailMessageId: email?.emailMessageId ?? null,
  });
  if (email) await stopSequence(email.contactId, now);
}
