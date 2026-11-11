// The site admin's view of buyer emails: the on/off setting, the buyers, the approval queue, what was sent
// and the feedback. Callers must have checked access to the site; every query is scoped to it.
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { accounts, buyerEmails, buyerFeedback, buyerOrders, buyers, sites, storeConnections } from "@/db/schema";
import { BODY_MAX, SUBJECT_MAX, cleanSubject, filterLinks } from "@/lib/email/writer";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { planStatus } from "@/lib/plans";
import { redactEmails } from "@/lib/privacy/redact";

export const BUYER_PAGE_SIZE = 25;

const modeSchema = z.enum(["off", "approval", "automatic"]);

/**
 * Switches buyer emails off, to the approval queue, or to automatic. Turning them on needs a verified
 * sending domain and a WooCommerce connection. `buyerEmailsSince` is set only when switching on from off:
 * drafting skips orders before it, so changing approval <-> automatic must leave it alone. Turning off
 * needs no clean-up: drafting and sending both check the mode, so unsent emails are skipped.
 */
export async function setBuyerEmails(siteId: string, mode: unknown, now: Date = new Date()): Promise<void> {
  const parsed = modeSchema.safeParse(mode);
  if (!parsed.success) throw new ValidationError("Choose off, approval queue or automatic");
  const next = parsed.data;
  const [site] = await db
    .select({
      buyerEmails: sites.buyerEmails,
      sendingDomainStatus: sites.sendingDomainStatus,
      plan: accounts.plan,
      trialEndsAt: accounts.trialEndsAt,
      limitOverrides: accounts.limitOverrides,
    })
    .from(sites)
    .innerJoin(accounts, eq(accounts.id, sites.accountId))
    .where(eq(sites.id, siteId));
  if (!site) throw new NotFoundError("Site not found");

  if (next !== "off") {
    if (site.sendingDomainStatus !== "verified") throw new ValidationError("Verify your sending domain first.");
    const [store] = await db.select({ id: storeConnections.id }).from(storeConnections).where(eq(storeConnections.siteId, siteId));
    if (!store) throw new ValidationError("Connect WooCommerce first.");
    if (next === "automatic" && !planStatus(site, now).limits.autoSendEmails) {
      throw new ValidationError("Automatic sending needs the Growth plan or higher");
    }
  }
  await db
    .update(sites)
    .set({ buyerEmails: next, ...(site.buyerEmails === "off" && next !== "off" ? { buyerEmailsSince: now } : {}) })
    .where(eq(sites.id, siteId));
}

export async function listBuyers(siteId: string) {
  const rows = await db
    .select({ id: buyers.id, email: buyers.email, firstName: buyers.firstName, status: buyers.status, createdAt: buyers.createdAt })
    .from(buyers)
    .where(eq(buyers.siteId, siteId))
    .orderBy(desc(buyers.createdAt), desc(buyers.id));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const orders = await db
    .select({ buyerId: buyerOrders.buyerId, items: buyerOrders.items })
    .from(buyerOrders)
    .where(and(eq(buyerOrders.siteId, siteId), inArray(buyerOrders.buyerId, ids)));
  const emails = await db
    .select({ id: buyerEmails.id, buyerId: buyerEmails.buyerId, step: buyerEmails.step, status: buyerEmails.status })
    .from(buyerEmails)
    .where(and(eq(buyerEmails.siteId, siteId), inArray(buyerEmails.buyerId, ids)))
    .orderBy(desc(buyerEmails.createdAt), desc(buyerEmails.step));
  const ratings = await db
    .select({ buyerId: buyerEmails.buyerId, rating: buyerFeedback.rating })
    .from(buyerFeedback)
    .innerJoin(buyerEmails, eq(buyerEmails.id, buyerFeedback.buyerEmailId))
    .where(eq(buyerFeedback.siteId, siteId))
    .orderBy(desc(buyerFeedback.updatedAt));
  return rows.map((r) => {
    const mine = orders.filter((o) => o.buyerId === r.id);
    const products = [...new Set(mine.flatMap((o) => o.items.map((i) => i.name)).filter(Boolean))];
    // The newest email that isn't over: what the buyer's sequence is doing now; else the newest one.
    const seq = emails.filter((e) => e.buyerId === r.id);
    const current = seq.find((e) => ["scheduled", "draft", "approved", "sending"].includes(e.status)) ?? seq[0];
    return {
      ...r,
      orders: mine.length,
      products,
      sequence: current ? { step: current.step, status: current.status } : null,
      rating: ratings.find((x) => x.buyerId === r.id)?.rating ?? null,
    };
  });
}

export async function listBuyerQueue(siteId: string) {
  return db
    .select({
      id: buyerEmails.id,
      subject: buyerEmails.subject,
      body: buyerEmails.body,
      step: buyerEmails.step,
      createdAt: buyerEmails.createdAt,
      email: buyers.email,
    })
    .from(buyerEmails)
    .innerJoin(buyers, eq(buyers.id, buyerEmails.buyerId))
    .where(and(eq(buyerEmails.siteId, siteId), eq(buyerEmails.status, "draft")))
    .orderBy(asc(buyerEmails.createdAt), asc(buyerEmails.id));
}

export async function listBuyerSent(siteId: string, page: number) {
  const p = Number.isInteger(page) && page > 0 ? page : 1;
  const where = and(eq(buyerEmails.siteId, siteId), eq(buyerEmails.status, "sent"));
  const rows = await db
    .select({
      id: buyerEmails.id,
      subject: buyerEmails.subject,
      step: buyerEmails.step,
      sentAt: buyerEmails.sentAt,
      clicks: buyerEmails.clicks,
      email: buyers.email,
    })
    .from(buyerEmails)
    .innerJoin(buyers, eq(buyers.id, buyerEmails.buyerId))
    .where(where)
    .orderBy(desc(buyerEmails.sentAt), desc(buyerEmails.id))
    .limit(BUYER_PAGE_SIZE)
    .offset((p - 1) * BUYER_PAGE_SIZE);
  const [{ total }] = await db.select({ total: count() }).from(buyerEmails).where(where);
  return { rows, total, page: p, pages: Math.max(1, Math.ceil(total / BUYER_PAGE_SIZE)) };
}

export async function listFeedback(siteId: string) {
  return db
    .select({
      id: buyerFeedback.id,
      rating: buyerFeedback.rating,
      comment: buyerFeedback.comment,
      createdAt: buyerFeedback.createdAt,
      step: buyerEmails.step,
      email: buyers.email,
    })
    .from(buyerFeedback)
    .innerJoin(buyerEmails, eq(buyerEmails.id, buyerFeedback.buyerEmailId))
    .innerJoin(buyers, eq(buyers.id, buyerEmails.buyerId))
    .where(eq(buyerFeedback.siteId, siteId))
    .orderBy(desc(buyerFeedback.updatedAt), desc(buyerFeedback.id));
}

async function draftOf(siteId: string, id: string) {
  const [row] = await db
    .select({ id: buyerEmails.id, status: buyerEmails.status })
    .from(buyerEmails)
    .where(and(eq(buyerEmails.siteId, siteId), sql`${buyerEmails.id}::text = ${id}`));
  if (!row) throw new NotFoundError("Email not found");
  if (row.status !== "draft") throw new ValidationError("Only emails waiting for approval can be changed");
  return row;
}

/** Saves an edited draft with the same scrubbing the writer applies; the tracked links are recomputed from it. */
export async function updateBuyerDraft(siteId: string, id: string, input: { subject: string; body: string }): Promise<void> {
  await draftOf(siteId, id);
  const [site] = await db
    .select({ baseUrl: sites.baseUrl, allowedOrigins: sites.allowedOrigins })
    .from(sites)
    .where(eq(sites.id, siteId));
  const subject = cleanSubject(redactEmails(input.subject), site);
  const raw = redactEmails(input.body.replace(/\r\n?/g, "\n")).trim();
  if (subject.length < 1) throw new ValidationError(`The subject needs 1 to ${SUBJECT_MAX} characters`);
  if (raw.length < 1 || raw.length > BODY_MAX) throw new ValidationError("The email needs 1 to 6,000 characters");
  const { body, links } = filterLinks(raw, site);
  if (!body.trim()) throw new ValidationError("The email needs 1 to 6,000 characters");
  await db
    .update(buyerEmails)
    .set({ subject, body: body.trim(), links, updatedAt: new Date() })
    .where(and(eq(buyerEmails.id, id), eq(buyerEmails.siteId, siteId), eq(buyerEmails.status, "draft")));
}

export async function approveBuyerDraft(siteId: string, id: string, now: Date = new Date()): Promise<void> {
  await draftOf(siteId, id);
  await db
    .update(buyerEmails)
    .set({ status: "approved", scheduledFor: now, updatedAt: now })
    .where(and(eq(buyerEmails.id, id), eq(buyerEmails.siteId, siteId), eq(buyerEmails.status, "draft")));
}

export async function discardBuyerDraft(siteId: string, id: string): Promise<void> {
  await draftOf(siteId, id);
  await db
    .update(buyerEmails)
    .set({ status: "discarded", updatedAt: new Date() })
    .where(and(eq(buyerEmails.id, id), eq(buyerEmails.siteId, siteId), eq(buyerEmails.status, "draft")));
}
