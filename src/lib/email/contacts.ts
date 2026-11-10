// Consent capture with double opt-in. The stored wording always comes from the server's copy.
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { contacts, conversations, leads, sites } from "@/db/schema";
import { copyFor, emailCopyFor, fillSite } from "@/lib/copy/defaults";
import { appBaseUrl } from "@/lib/widget/config";
import { findOwnedConversation } from "@/lib/widget/conversation";
import type { WidgetSite } from "@/lib/widget/guard";
import { fromAddress } from "./domain";
import { restartSequence } from "./schedule";
import { sendMail } from "./provider";

export const CONFIRM_VALID_MS = 7 * 86400_000;

const token = (bytes: number) => randomBytes(bytes).toString("base64url");

/** The language whose consent copy the visitor actually saw (English for languages without copy). */
export function consentLanguage(language: string): "en" | "el" {
  return language === "el" ? "el" : "en";
}

/** Exactly what the consent card showed: the question and the fine print, with the site's name. */
export function consentWording(language: string, siteName: string): string {
  const c = copyFor(consentLanguage(language));
  return fillSite(`${c.consentAsk} ${c.consentFine}`, siteName);
}

async function sendConfirmation(
  site: WidgetSite,
  contact: { email: string; token: string; language: string },
): Promise<void> {
  const { copy } = emailCopyFor(contact.language);
  const link = `${appBaseUrl()}/e/confirm/${contact.token}`;
  await sendMail({
    from: fromAddress(site),
    to: contact.email,
    subject: fillSite(copy.confirmSubject, site.name),
    text: `${fillSite(copy.confirmBody, site.name)}\n\n${link}\n`,
  });
}

export async function subscribe(
  site: WidgetSite,
  input: { sid: string; cid: string | null; email: string; language: string },
  now: Date = new Date(),
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const conversationId = await findOwnedConversation(site.id, input.sid, input.cid);
  const consent = {
    status: "pending" as const,
    language: input.language,
    consentText: consentWording(input.language, site.name),
    consentLanguage: consentLanguage(input.language),
    consentedAt: now,
    confirmedAt: null,
    unsubscribedAt: null,
    token: token(32),
  };

  const { contact, needsConfirmation, restart } = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.siteId, site.id), eq(contacts.email, email)))
      .for("update");
    let contact;
    let needsConfirmation = true;
    let restart = false;
    if (!existing) {
      [contact] = await tx
        .insert(contacts)
        .values({ siteId: site.id, email, ref: token(16), ...consent })
        .onConflictDoNothing()
        .returning();
      if (!contact) {
        // Created concurrently by another request for the same address.
        [contact] = await tx.select().from(contacts).where(and(eq(contacts.siteId, site.id), eq(contacts.email, email)));
        needsConfirmation = false;
      }
    } else if (existing.status === "subscribed") {
      contact = existing;
      needsConfirmation = false;
      restart = conversationId !== null && conversationId !== existing.sequenceConversationId;
    } else {
      // Pending or unsubscribed: consent again, with a fresh link.
      [contact] = await tx.update(contacts).set(consent).where(eq(contacts.id, existing.id)).returning();
    }
    await tx.insert(leads).values({
      siteId: site.id,
      conversationId,
      email,
      message: "Asked for personalised recommendations",
      source: "consent",
    });
    if (conversationId) {
      await tx.update(conversations).set({ contactId: contact.id }).where(eq(conversations.id, conversationId));
    }
    return { contact, needsConfirmation, restart };
  });

  // Already subscribed: follow-ups now come from this conversation.
  if (restart && conversationId) await restartSequence(contact.id, conversationId, now);
  if (needsConfirmation) await sendConfirmation(site, contact);
}

/** A pending contact under 7 days old becomes subscribed and starts its sequence. Idempotent. */
export async function confirmContact(
  tokenValue: string,
  now: Date = new Date(),
): Promise<{ siteName: string; language: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(tokenValue)) return null;
  const [row] = await db
    .select({ contact: contacts, siteName: sites.name })
    .from(contacts)
    .innerJoin(sites, eq(sites.id, contacts.siteId))
    .where(eq(contacts.token, tokenValue));
  if (!row) return null;
  const { contact, siteName } = row;
  const result = { siteName, language: contact.language };
  if (contact.status === "subscribed") return result;
  if (contact.status !== "pending" || now.getTime() - contact.consentedAt.getTime() >= CONFIRM_VALID_MS) return null;

  const [latest] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.contactId, contact.id))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);
  const updated = await db
    .update(contacts)
    .set({
      status: "subscribed",
      confirmedAt: now,
      sequenceConversationId: latest?.id ?? null,
      sequenceStartedAt: now,
    })
    .where(
      and(
        eq(contacts.id, contact.id),
        eq(contacts.status, "pending"),
        gt(contacts.consentedAt, new Date(now.getTime() - CONFIRM_VALID_MS)),
      ),
    )
    .returning({ id: contacts.id });
  return updated.length > 0 ? result : (await confirmedAlready(contact.id)) ? result : null;
}

async function confirmedAlready(contactId: string): Promise<boolean> {
  const [c] = await db.select({ status: contacts.status }).from(contacts).where(eq(contacts.id, contactId));
  return c?.status === "subscribed";
}

/** For the confirm page, without changing anything: what the token's link can do now. */
export async function confirmState(
  tokenValue: string,
  now: Date = new Date(),
): Promise<{ state: "subscribed" | "confirmable" | "invalid"; siteName: string; language: string }> {
  const invalid = { state: "invalid" as const, siteName: "", language: "en" };
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(tokenValue)) return invalid;
  const [row] = await db
    .select({ contact: contacts, siteName: sites.name })
    .from(contacts)
    .innerJoin(sites, eq(sites.id, contacts.siteId))
    .where(eq(contacts.token, tokenValue));
  if (!row) return invalid;
  const base = { siteName: row.siteName, language: row.contact.language };
  if (row.contact.status === "subscribed") return { state: "subscribed", ...base };
  const fresh = now.getTime() - row.contact.consentedAt.getTime() < CONFIRM_VALID_MS;
  if (row.contact.status === "pending" && fresh) return { state: "confirmable", ...base };
  return { state: "invalid", ...base };
}
