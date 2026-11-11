// What the links in buyer emails do: unsubscribe the buyer, and take product feedback.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { buyerEmails, buyerFeedback, buyerOrders, buyers, sites } from "@/db/schema";
import { hit } from "@/lib/usage/rate-limit";

const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;
export const MAX_COMMENT = 2000;
/** Per feedback link: enough to fix a typo, not enough to flood. */
const FEEDBACK_HITS_PER_HOUR = 10;

/** Emails not yet sent: they all stop when the buyer unsubscribes. */
const OPEN_STATUSES = ["scheduled", "draft", "approved"] as const;

/**
 * Unsubscribes the buyer behind the token (once) and discards every unsent email of theirs, scheduled ones
 * included. Null for an unknown token. isSuppressed then blocks both tracks for the address.
 */
export async function unsubscribeBuyer(
  token: string,
  now: Date = new Date(),
): Promise<{ siteName: string; language: string } | null> {
  if (!TOKEN.test(token)) return null;
  const [row] = await db
    .select({ id: buyers.id, defaultLanguage: sites.defaultLanguage, siteName: sites.name })
    .from(buyers)
    .innerJoin(sites, eq(sites.id, buyers.siteId))
    .where(eq(buyers.token, token));
  if (!row) return null;
  await db.transaction(async (tx) => {
    await tx
      .update(buyers)
      .set({ status: "unsubscribed" })
      .where(and(eq(buyers.id, row.id), sql`${buyers.status} <> 'unsubscribed'`));
    await tx
      .update(buyerEmails)
      .set({ status: "discarded", updatedAt: now })
      .where(and(eq(buyerEmails.buyerId, row.id), inArray(buyerEmails.status, [...OPEN_STATUSES])));
  });
  return { siteName: row.siteName, language: row.defaultLanguage };
}

/** For the unsubscribe page, without changing anything. Null for an unknown token. */
export async function buyerUnsubscribeState(
  token: string,
): Promise<{ state: "subscribed" | "unsubscribed"; siteName: string; language: string } | null> {
  if (!TOKEN.test(token)) return null;
  const [row] = await db
    .select({ status: buyers.status, defaultLanguage: sites.defaultLanguage, siteName: sites.name })
    .from(buyers)
    .innerJoin(sites, eq(sites.id, buyers.siteId))
    .where(eq(buyers.token, token));
  if (!row) return null;
  return { state: row.status, siteName: row.siteName, language: row.defaultLanguage };
}

export type FeedbackForm = {
  siteName: string;
  language: string;
  products: { name: string; url: string | null }[];
  /** What was sent before, so the form can show it and a resubmission updates it. */
  rating: number | null;
  comment: string;
};

/** The feedback page's data: the products of the email's order. Null for an unknown token. */
export async function feedbackForm(token: string): Promise<FeedbackForm | null> {
  if (!TOKEN.test(token)) return null;
  const [row] = await db
    .select({
      id: buyerEmails.id,
      language: buyerEmails.language,
      items: buyerOrders.items,
      siteName: sites.name,
    })
    .from(buyerEmails)
    .innerJoin(buyerOrders, eq(buyerOrders.id, buyerEmails.orderId))
    .innerJoin(sites, eq(sites.id, buyerEmails.siteId))
    .where(eq(buyerEmails.feedbackToken, token));
  if (!row) return null;
  const [existing] = await db
    .select({ rating: buyerFeedback.rating, comment: buyerFeedback.comment })
    .from(buyerFeedback)
    .where(eq(buyerFeedback.buyerEmailId, row.id));
  return {
    siteName: row.siteName,
    language: row.language,
    products: row.items.map((i) => ({ name: i.name, url: i.url })),
    rating: existing?.rating ?? null,
    comment: existing?.comment ?? "",
  };
}

/**
 * Records a rating (1 to 5) and an optional comment for the email behind the token. A second submission
 * updates the first. The site comes from the email, never from the caller.
 */
export async function submitFeedback(
  token: string,
  input: { rating: number; comment: string },
): Promise<{ ok: true } | { error: string }> {
  if (!TOKEN.test(token)) return { error: "This link has expired or isn't valid." };
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) return { error: "Choose a rating from 1 to 5." };
  const comment = input.comment.trim();
  if (comment.length > MAX_COMMENT) return { error: `Keep your comment under ${MAX_COMMENT} characters.` };
  const [email] = await db
    .select({ id: buyerEmails.id, siteId: buyerEmails.siteId })
    .from(buyerEmails)
    .where(eq(buyerEmails.feedbackToken, token));
  if (!email) return { error: "This link has expired or isn't valid." };
  if (!(await hit(`feedback:${token}`, FEEDBACK_HITS_PER_HOUR, 3600))) return { error: "Too many attempts. Please try again later." };
  await db
    .insert(buyerFeedback)
    .values({ siteId: email.siteId, buyerEmailId: email.id, rating: input.rating, comment })
    .onConflictDoUpdate({
      target: buyerFeedback.buyerEmailId,
      set: { rating: input.rating, comment, updatedAt: new Date() },
    });
  return { ok: true };
}
