// Who may be emailed, and when, across both tracks (chat follow-ups and buyer emails) of one site.
import { createHash } from "node:crypto";
import { and, eq, max, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { buyerEmails, buyers, contacts, emailMessages, emailSuppressions } from "@/db/schema";

/** At most one email per this many days to one address on one site, whichever track sends it. */
export const MIN_GAP_DAYS = 7;
const GAP_MS = MIN_GAP_DAYS * 86400_000;

/** The stored form of an address in email_suppressions: sha256 of the lowercased address, base64url. */
export const emailHash = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("base64url");

/** Anything that can insert: the db or an open transaction. */
type Inserter = Pick<typeof db, "insert">;

/** Records that this site must never email the address again (without storing the address). */
export async function suppress(
  siteId: string,
  email: string,
  reason: "erased" | "unsubscribed",
  executor: Inserter = db,
): Promise<void> {
  await executor
    .insert(emailSuppressions)
    .values({ siteId, emailHash: emailHash(email), reason })
    .onConflictDoNothing({ target: [emailSuppressions.siteId, emailSuppressions.emailHash] });
}

/**
 * One check for both tracks: the buyer unsubscribed from buyer emails, the address unsubscribed from chat
 * follow-ups, or it was erased ("Delete all data") or pruned while unsubscribed.
 */
export async function isSuppressed(siteId: string, email: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  const [row] = await db.execute<{ suppressed: boolean }>(sql`select
    exists (select 1 from ${buyers} where ${buyers.siteId} = ${siteId} and ${buyers.email} = ${address} and ${buyers.status} = 'unsubscribed')
    or exists (select 1 from ${contacts} where ${contacts.siteId} = ${siteId} and ${contacts.email} = ${address} and ${contacts.status} = 'unsubscribed')
    or exists (select 1 from ${emailSuppressions} where ${emailSuppressions.siteId} = ${siteId} and ${emailSuppressions.emailHash} = ${emailHash(address)})
    as suppressed`);
  return !!row?.suppressed;
}

export type Track = "chat" | "buyer";

/** When an email of the given tracks last went out to this address on this site, or null. */
export async function lastEmailSentAt(
  siteId: string,
  email: string,
  tracks: readonly Track[] = ["chat", "buyer"],
): Promise<Date | null> {
  const address = email.trim().toLowerCase();
  const times: Date[] = [];
  if (tracks.includes("chat")) {
    const [r] = await db
      .select({ at: max(emailMessages.sentAt) })
      .from(emailMessages)
      .innerJoin(contacts, eq(contacts.id, emailMessages.contactId))
      .where(and(eq(contacts.siteId, siteId), eq(contacts.email, address), eq(emailMessages.status, "sent")));
    if (r?.at) times.push(r.at);
  }
  if (tracks.includes("buyer")) {
    const [r] = await db
      .select({ at: max(buyerEmails.sentAt) })
      .from(buyerEmails)
      .innerJoin(buyers, eq(buyers.id, buyerEmails.buyerId))
      .where(and(eq(buyers.siteId, siteId), eq(buyers.email, address), eq(buyerEmails.status, "sent")));
    if (r?.at) times.push(r.at);
  }
  return times.length ? new Date(Math.max(...times.map((t) => t.getTime()))) : null;
}

/** The earliest time another email may go out to this address, or null when it may go out now. */
export async function gapUntil(
  siteId: string,
  email: string,
  now: Date,
  tracks: readonly Track[] = ["chat", "buyer"],
): Promise<Date | null> {
  const last = await lastEmailSentAt(siteId, email, tracks);
  if (!last) return null;
  const until = last.getTime() + GAP_MS;
  return until > now.getTime() ? new Date(until) : null;
}
