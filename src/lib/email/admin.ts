// The site admin's view of emails: the approval queue, what was sent, who subscribed, and deleting a person.
// Callers must have checked access to the site; every query is scoped to it.
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { buyers, contacts, conversations, emailMessages, leads, promptImpressions, sales, sites } from "@/db/schema";
import { suppress } from "@/lib/buyers/suppression";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { BODY_MAX, SUBJECT_MAX, filterLinks } from "./writer";

export const SENT_PAGE_SIZE = 25;

export async function listQueue(siteId: string) {
  return db
    .select({
      id: emailMessages.id,
      subject: emailMessages.subject,
      body: emailMessages.body,
      step: emailMessages.step,
      createdAt: emailMessages.createdAt,
      conversationId: emailMessages.conversationId,
      email: contacts.email,
    })
    .from(emailMessages)
    .innerJoin(contacts, eq(contacts.id, emailMessages.contactId))
    .where(and(eq(emailMessages.siteId, siteId), eq(emailMessages.status, "draft")))
    .orderBy(asc(emailMessages.createdAt), asc(emailMessages.id));
}

export async function listSent(siteId: string, page: number) {
  const p = Number.isInteger(page) && page > 0 ? page : 1;
  const where = and(eq(emailMessages.siteId, siteId), eq(emailMessages.status, "sent"));
  const rows = await db
    .select({
      id: emailMessages.id,
      subject: emailMessages.subject,
      sentAt: emailMessages.sentAt,
      clicks: emailMessages.clicks,
      sales: sql<number>`(select count(*)::int from sales s where s.email_message_id = ${sql.raw('"email_messages"."id"')})`,
      email: contacts.email,
    })
    .from(emailMessages)
    .innerJoin(contacts, eq(contacts.id, emailMessages.contactId))
    .where(where)
    .orderBy(desc(emailMessages.sentAt), desc(emailMessages.id))
    .limit(SENT_PAGE_SIZE)
    .offset((p - 1) * SENT_PAGE_SIZE);
  const [{ total }] = await db.select({ total: count() }).from(emailMessages).where(where);
  return { rows, total, page: p, pages: Math.max(1, Math.ceil(total / SENT_PAGE_SIZE)) };
}

export async function listPeople(siteId: string) {
  return db
    .select({
      id: contacts.id,
      email: contacts.email,
      status: contacts.status,
      consentedAt: contacts.consentedAt,
      confirmedAt: contacts.confirmedAt,
      sent: sql<number>`(select count(*)::int from ${emailMessages} where ${emailMessages.contactId} = ${sql.raw('"contacts"."id"')} and ${emailMessages.status} = 'sent')`,
    })
    .from(contacts)
    .where(eq(contacts.siteId, siteId))
    .orderBy(desc(contacts.consentedAt));
}

async function draftOf(siteId: string, id: string) {
  const [row] = await db
    .select({ id: emailMessages.id, status: emailMessages.status })
    .from(emailMessages)
    .where(and(eq(emailMessages.siteId, siteId), sql`${emailMessages.id}::text = ${id}`));
  if (!row) throw new NotFoundError("Email not found");
  if (row.status !== "draft") throw new ValidationError("Only emails waiting for approval can be changed");
  return row;
}

export async function updateDraft(siteId: string, id: string, input: { subject: string; body: string }): Promise<void> {
  await draftOf(siteId, id);
  const subject = input.subject.replace(/\s+/g, " ").trim();
  const body = input.body.replace(/\r\n?/g, "\n").trim();
  if (subject.length < 1 || subject.length > SUBJECT_MAX) {
    throw new ValidationError(`The subject needs 1 to ${SUBJECT_MAX} characters`);
  }
  if (body.length < 1 || body.length > BODY_MAX) throw new ValidationError("The email needs 1 to 6,000 characters");
  const [site] = await db
    .select({ baseUrl: sites.baseUrl, allowedOrigins: sites.allowedOrigins })
    .from(sites)
    .where(eq(sites.id, siteId));
  const filtered = filterLinks(body, site);
  await db
    .update(emailMessages)
    .set({ subject, body: filtered.body, links: filtered.links, updatedAt: new Date() })
    .where(and(eq(emailMessages.id, id), eq(emailMessages.status, "draft")));
}

export async function approveDraft(siteId: string, id: string): Promise<void> {
  await draftOf(siteId, id);
  const now = new Date();
  await db
    .update(emailMessages)
    .set({ status: "approved", scheduledFor: now, updatedAt: now })
    .where(and(eq(emailMessages.id, id), eq(emailMessages.status, "draft")));
}

export async function discardDraft(siteId: string, id: string): Promise<void> {
  await draftOf(siteId, id);
  await db
    .update(emailMessages)
    .set({ status: "discarded", updatedAt: new Date() })
    .where(and(eq(emailMessages.id, id), eq(emailMessages.status, "draft")));
}

/**
 * Deletes everything this site holds about one email address: its leads, the conversations linked to
 * those leads or to the contact (their messages cascade), the contact (its emails cascade), and the buyer
 * (their orders, buyer emails and feedback cascade). A hash of the address is kept so that neither track
 * emails it again.
 */
export async function deletePerson(siteId: string, rawEmail: string): Promise<{ deleted: boolean }> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return { deleted: false };
  return db.transaction(async (tx) => {
    const [contact] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.siteId, siteId), eq(contacts.email, email)));
    const leadRows = await tx
      .select({ id: leads.id, conversationId: leads.conversationId })
      .from(leads)
      .where(and(eq(leads.siteId, siteId), sql`lower(${leads.email}) = ${email}`));
    const fromLeads = leadRows.map((l) => l.conversationId).filter((c): c is string => !!c);
    const convoConditions = [
      ...(fromLeads.length ? [inArray(conversations.id, fromLeads)] : []),
      ...(contact ? [eq(conversations.contactId, contact.id)] : []),
    ];
    if (convoConditions.length) {
      // Everything from the same visits goes too: other conversations, suggestions, and the visit id and
      // order address on their sales (the sale itself stays as an anonymous count).
      const visits = await tx
        .selectDistinct({ sid: conversations.visitorSessionId })
        .from(conversations)
        .where(and(eq(conversations.siteId, siteId), or(...convoConditions)));
      const sids = visits.map((v) => v.sid);
      await tx.delete(conversations).where(and(eq(conversations.siteId, siteId), or(...convoConditions)));
      if (sids.length) {
        await tx.delete(conversations).where(and(eq(conversations.siteId, siteId), inArray(conversations.visitorSessionId, sids)));
        await tx
          .delete(promptImpressions)
          .where(and(eq(promptImpressions.siteId, siteId), inArray(promptImpressions.visitorSessionId, sids)));
        await tx
          .update(sales)
          .set({ visitorSessionId: "", pageUrl: "" })
          .where(and(eq(sales.siteId, siteId), inArray(sales.visitorSessionId, sids)));
      }
    }
    if (contact) {
      await tx.update(sales).set({ visitorSessionId: "", pageUrl: "" }).where(and(eq(sales.siteId, siteId), eq(sales.contactId, contact.id)));
    }
    if (leadRows.length) await tx.delete(leads).where(inArray(leads.id, leadRows.map((l) => l.id)));
    if (contact) await tx.delete(contacts).where(eq(contacts.id, contact.id));
    // Never email this address again from this site, on either track; only a hash is kept.
    await suppress(siteId, email, "erased", tx);
    const buyer = await tx
      .delete(buyers)
      .where(and(eq(buyers.siteId, siteId), eq(buyers.email, email)))
      .returning({ id: buyers.id });
    return { deleted: !!contact || leadRows.length > 0 || buyer.length > 0 };
  });
}
