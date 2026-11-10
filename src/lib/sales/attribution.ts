// Was this purchase helped by the bot? Same-visit chat or tapped suggestion, or a recent email click.
import { and, desc, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { contacts, conversations, emailMessages, promptImpressions } from "@/db/schema";

export const EMAIL_WINDOW_MS = 30 * 86400_000;

export async function visitAttribution(
  siteId: string,
  sid: string,
  before: Date,
): Promise<{ conversationId: string | null; promptImpressionId: string | null }> {
  const [convo] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.siteId, siteId),
        eq(conversations.visitorSessionId, sid),
        lt(conversations.createdAt, before),
        sql`exists (select 1 from messages m where m.conversation_id = ${sql.raw('"conversations"."id"')} and m.role = 'visitor')`,
      ),
    )
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  const [impression] = await db
    .select({ id: promptImpressions.id })
    .from(promptImpressions)
    .where(
      and(
        eq(promptImpressions.siteId, siteId),
        eq(promptImpressions.visitorSessionId, sid),
        eq(promptImpressions.outcome, "tapped"),
        lt(promptImpressions.createdAt, before),
      ),
    )
    .orderBy(desc(promptImpressions.createdAt))
    .limit(1);
  return { conversationId: convo?.id ?? null, promptImpressionId: impression?.id ?? null };
}

/** The site's contact by the visit's email ref, else by the order's billing email. */
export async function contactFor(siteId: string, by: { ref: string | null; email: string | null }): Promise<string | null> {
  if (by.ref) {
    const [c] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.siteId, siteId), eq(contacts.ref, by.ref)));
    if (c) return c.id;
  }
  const email = by.email?.trim().toLowerCase();
  if (email) {
    const [c] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.siteId, siteId), eq(contacts.email, email)));
    if (c) return c.id;
  }
  return null;
}

/** The contact's email clicked most recently in the 30 days before the order, if any. */
export async function emailAttribution(
  siteId: string,
  by: { ref: string | null; email: string | null },
  orderedAt: Date,
): Promise<{ contactId: string; emailMessageId: string } | null> {
  const contactId = await contactFor(siteId, by);
  if (!contactId) return null;
  const [msg] = await db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.siteId, siteId),
        eq(emailMessages.contactId, contactId),
        isNotNull(emailMessages.lastClickedAt),
        gt(emailMessages.lastClickedAt, new Date(orderedAt.getTime() - EMAIL_WINDOW_MS)),
        lt(emailMessages.lastClickedAt, orderedAt),
      ),
    )
    .orderBy(desc(emailMessages.lastClickedAt))
    .limit(1);
  return msg ? { contactId, emailMessageId: msg.id } : null;
}
