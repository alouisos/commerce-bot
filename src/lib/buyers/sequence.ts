// Two follow-up emails per order: scheduled when the order is recorded, written when due, then sent like
// the chat follow-ups (approval queue or automatic). Every unclear case means no email.
import { and, eq, gt, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, buyerEmails, buyerOrders, buyers, sites, storeConnections, type BuyerEmail } from "@/db/schema";
import { canDraftEmail, canSendEmail, fromAddress } from "@/lib/email/domain";
import { sendMail } from "@/lib/email/provider";
import { buyerOneClickUrl, buyerUnsubscribePageUrl, feedbackUrl, renderEmail } from "@/lib/email/render";
import type { CallModel } from "@/lib/email/writer";
import { planStatus } from "@/lib/plans";
import { countEmailSent } from "@/lib/usage/meter";
import { gapUntil, isSuppressed } from "./suppression";
import { writeBuyerEmail } from "./writer";

export { MIN_GAP_DAYS } from "./suppression";

/** Days after the order each email is due. */
export const STEP_DELAY_DAYS = { 1: 5, 2: 14 } as const;

const D = 86400_000;
/** Same limits as the chat follow-ups (src/lib/email/schedule.ts). */
const MAX_WRITES_PER_TICK = 50;
const MAX_SENDS_PER_TICK = 500;
const MAX_SEND_ATTEMPTS = 3;
/** A failed write is retried a day later; after 3 failures that email is given up. */
const MAX_WRITE_ATTEMPTS = 3;
const WRITE_RETRY_MS = D;
/** An email that couldn't be written within this long after the order (domain unverified, caps) is dropped. */
const MAX_ORDER_AGE_MS = 45 * D;

/** Only orders placed since buyer emails were (last) switched on, and not older than the age limit, get an email. */
const isFresh = (orderedAt: Date, since: Date | null, now: Date) =>
  !!since && orderedAt >= since && now.getTime() - orderedAt.getTime() <= MAX_ORDER_AGE_MS;

/**
 * Schedules the two emails of a newly recorded order, replacing the buyer's pending sequence. Nothing for
 * a suppressed buyer, a site with buyer emails off, a removed account, or an order older than the buyer's
 * newest one.
 */
export async function scheduleForOrder(orderId: string, now: Date = new Date()): Promise<void> {
  const [row] = await db
    .select({ order: buyerOrders, buyer: buyers, site: sites, account: accounts })
    .from(buyerOrders)
    .innerJoin(buyers, eq(buyers.id, buyerOrders.buyerId))
    .innerJoin(sites, eq(sites.id, buyerOrders.siteId))
    .innerJoin(accounts, eq(accounts.id, sites.accountId))
    .where(eq(buyerOrders.id, orderId));
  if (!row) return;
  const { order, buyer, site, account } = row;
  if (site.buyerEmails === "off" || account.removedAt || buyer.status !== "subscribed") return;
  if (await isSuppressed(site.id, buyer.email)) return;
  const [newer] = await db
    .select({ id: buyerOrders.id })
    .from(buyerOrders)
    .where(and(eq(buyerOrders.buyerId, buyer.id), gt(buyerOrders.orderedAt, order.orderedAt)))
    .limit(1);
  if (newer) return;

  await db.transaction(async (tx) => {
    await tx
      .update(buyerEmails)
      .set({ status: "discarded", updatedAt: now })
      .where(and(eq(buyerEmails.buyerId, buyer.id), inArray(buyerEmails.status, ["scheduled", "draft", "approved"])));
    await tx.insert(buyerEmails).values(
      ([1, 2] as const).map((step) => ({
        siteId: site.id,
        buyerId: buyer.id,
        orderId: order.id,
        step,
        status: "scheduled" as const,
        language: site.defaultLanguage,
        scheduledFor: new Date(order.orderedAt.getTime() + STEP_DELAY_DAYS[step] * D),
        createdAt: now,
        updatedAt: now,
      })),
    );
  });
}

async function update(id: string, patch: Partial<BuyerEmail>, now: Date, status?: BuyerEmail["status"]) {
  return db
    .update(buyerEmails)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(buyerEmails.id, id), ...(status ? [eq(buyerEmails.status, status)] : [])))
    .returning({ id: buyerEmails.id });
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

const hasStore = () => sql<boolean>`exists (select 1 from ${storeConnections} where ${storeConnections.siteId} = ${sites.id})`;

/** Writes the scheduled buyer emails that are due. Returns how many drafts or approved emails were written. */
export async function draftDueBuyerEmails(now: Date, callModel?: CallModel): Promise<number> {
  const rows = await db
    .select({ email: buyerEmails, buyer: buyers, order: buyerOrders, site: sites, account: accounts })
    .from(buyerEmails)
    .innerJoin(buyers, eq(buyers.id, buyerEmails.buyerId))
    .innerJoin(buyerOrders, eq(buyerOrders.id, buyerEmails.orderId))
    .innerJoin(sites, eq(sites.id, buyerEmails.siteId))
    .innerJoin(accounts, eq(accounts.id, sites.accountId))
    .where(
      and(
        eq(buyerEmails.status, "scheduled"),
        lte(buyerEmails.scheduledFor, now),
        isNull(accounts.removedAt),
        ne(sites.buyerEmails, "off"),
        eq(sites.sendingDomainStatus, "verified"),
        hasStore(),
        // Nothing of this buyer waiting to go out, and step 2 never before step 1 of the same order.
        sql`not exists (select 1 from buyer_emails o where o.buyer_id = ${buyerEmails.buyerId} and o.status in ('draft', 'approved', 'sending'))`,
        sql`not exists (select 1 from buyer_emails e where e.order_id = ${buyerEmails.orderId} and e.status = 'scheduled' and e.step < ${buyerEmails.step})`,
      ),
    )
    .orderBy(buyerEmails.scheduledFor);

  let written = 0;
  let attempts = 0;
  const writable = new Map<string, boolean>();
  for (const { email: row, buyer, order, site: s, account } of rows) {
    if (attempts >= MAX_WRITES_PER_TICK) break;
    const site = { ...s, account };
    if (!isFresh(order.orderedAt, s.buyerEmailsSince, now) || buyer.status !== "subscribed" || (await isSuppressed(site.id, buyer.email))) {
      await update(row.id, { status: "skipped" }, now, "scheduled");
      continue;
    }
    if (!writable.has(site.id)) writable.set(site.id, await canDraftEmail(site, account, now));
    if (!writable.get(site.id)) continue;
    const until = await gapUntil(site.id, buyer.email, now);
    if (until) {
      await update(row.id, { scheduledFor: until }, now, "scheduled");
      continue;
    }

    let email;
    attempts++;
    try {
      email = await writeBuyerEmail({ site, buyer, order, step: row.step as 1 | 2 }, { callModel, now });
    } catch (err) {
      console.error("buyer email write failed", { buyerEmailId: row.id }, err);
      const n = row.attempts + 1;
      await update(
        row.id,
        {
          attempts: n,
          error: `Write failed: ${(err as Error).message}`.slice(0, 500),
          ...(n >= MAX_WRITE_ATTEMPTS ? { status: "failed" as const } : { scheduledFor: new Date(now.getTime() + WRITE_RETRY_MS) }),
        },
        now,
        "scheduled",
      );
      continue;
    }
    if (!email) {
      // The owner AI budget is spent: nothing for this site this tick.
      writable.set(site.id, false);
      continue;
    }
    const auto = s.buyerEmails === "automatic" && planStatus(account, now).limits.autoSendEmails;
    try {
      const done = await update(
        row.id,
        {
          status: auto ? "approved" : "draft",
          subject: email.subject,
          body: email.body,
          links: email.links,
          language: s.defaultLanguage,
          scheduledFor: now,
          attempts: 0,
          error: null,
        },
        now,
        "scheduled",
      );
      if (done.length > 0) written++;
    } catch (err) {
      // Another tick already opened an email for this buyer.
      if (!isUniqueViolation(err)) throw err;
    }
  }
  return written;
}

async function sendOne(id: string, now: Date): Promise<"sent" | "skipped" | "deferred" | "error" | null> {
  // Claim: only one tick can move an email from approved to sending.
  const [claimed] = await db
    .update(buyerEmails)
    .set({ status: "sending", updatedAt: now })
    .where(and(eq(buyerEmails.id, id), eq(buyerEmails.status, "approved")))
    .returning();
  if (!claimed) return null;

  const [row] = await db
    .select({ buyer: buyers, site: sites, account: accounts, order: buyerOrders, store: hasStore() })
    .from(buyers)
    .innerJoin(sites, eq(sites.id, buyers.siteId))
    .innerJoin(accounts, eq(accounts.id, sites.accountId))
    .innerJoin(buyerOrders, eq(buyerOrders.id, claimed.orderId))
    .where(eq(buyers.id, claimed.buyerId));
  if (
    !row ||
    row.buyer.status !== "subscribed" ||
    row.account.removedAt ||
    row.site.buyerEmails === "off" ||
    !row.store ||
    !isFresh(row.order.orderedAt, row.site.buyerEmailsSince, now) ||
    (await isSuppressed(row.site.id, row.buyer.email)) ||
    !(await canSendEmail(row.site, row.account, now))
  ) {
    await update(id, { status: "skipped" }, now);
    return "skipped";
  }
  const { buyer, site, account } = row;
  const until = await gapUntil(site.id, buyer.email, now);
  if (until) {
    await update(id, { status: "approved", scheduledFor: until }, now);
    return "deferred";
  }
  const { html, text } = renderEmail({
    body: claimed.body,
    links: claimed.links,
    messageId: claimed.id,
    siteName: site.name,
    unsubscribeUrl: buyerUnsubscribePageUrl(buyer.token),
    imageUrl: () => null,
    language: claimed.language,
    kind: "buyer",
    feedbackUrl: feedbackUrl(claimed.feedbackToken),
  });
  try {
    const { id: providerId } = await sendMail({
      from: fromAddress(site),
      to: buyer.email,
      subject: claimed.subject,
      text,
      html,
      headers: {
        "List-Unsubscribe": `<${buyerOneClickUrl(buyer.token)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    await update(id, { status: "sent", sentAt: now, providerId, error: null }, now);
    await countEmailSent(account.id, now);
    return "sent";
  } catch (err) {
    const attempts = claimed.attempts + 1;
    await update(
      id,
      {
        status: attempts >= MAX_SEND_ATTEMPTS ? "failed" : "approved",
        attempts,
        error: `Failed: ${(err as Error).message}`.slice(0, 500),
      },
      now,
    );
    return "error";
  }
}

/**
 * Sends the approved buyer emails that are due, spaced `intervalMs` apart (from `lastSend`, the time of the
 * tick's previous send, if any).
 */
export async function sendApprovedBuyerEmails(
  now: Date,
  intervalMs: number,
  lastSend = 0,
): Promise<{ sent: number; skipped: number }> {
  const due = await db
    .select({ id: buyerEmails.id })
    .from(buyerEmails)
    .where(and(eq(buyerEmails.status, "approved"), lte(buyerEmails.scheduledFor, now)))
    .orderBy(buyerEmails.scheduledFor)
    .limit(MAX_SENDS_PER_TICK);
  let sent = 0;
  let skipped = 0;
  let last = lastSend;
  for (const { id } of due) {
    const wait = last + intervalMs - Date.now();
    if (last && wait > 0) await new Promise((r) => setTimeout(r, wait));
    const r = await sendOne(id, now);
    if (r === "sent" || r === "error") last = Date.now();
    if (r === "sent") sent++;
    else if (r === "skipped") skipped++;
  }
  return { sent, skipped };
}
