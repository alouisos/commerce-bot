// What the links in our emails do: unsubscribe, and tracked clicks back to the shop.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { contacts, emailMessages, sites } from "@/db/schema";
import { isUuid } from "@/lib/widget/conversation";

const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

/** Unsubscribes the token's contact (once) and drops anything queued for them. Null for an unknown token. */
export async function unsubscribe(
  token: string,
  now: Date = new Date(),
): Promise<{ siteName: string; language: string } | null> {
  if (!TOKEN.test(token)) return null;
  const [row] = await db
    .select({ id: contacts.id, status: contacts.status, language: contacts.language, siteName: sites.name })
    .from(contacts)
    .innerJoin(sites, eq(sites.id, contacts.siteId))
    .where(eq(contacts.token, token));
  if (!row) return null;
  await db.transaction(async (tx) => {
    if (row.status !== "unsubscribed") {
      await tx
        .update(contacts)
        .set({ status: "unsubscribed", unsubscribedAt: now })
        .where(and(eq(contacts.id, row.id), sql`${contacts.status} <> 'unsubscribed'`));
    }
    await tx
      .update(emailMessages)
      .set({ status: "discarded", updatedAt: now })
      .where(and(eq(emailMessages.contactId, row.id), inArray(emailMessages.status, ["draft", "approved"])));
  });
  return { siteName: row.siteName, language: row.language };
}

/** For the unsubscribe page, without changing anything. */
export async function unsubscribeState(
  token: string,
): Promise<{ state: "subscribed" | "unsubscribed" | "invalid"; siteName: string; language: string }> {
  const invalid = { state: "invalid" as const, siteName: "", language: "en" };
  if (!TOKEN.test(token)) return invalid;
  const [row] = await db
    .select({ status: contacts.status, language: contacts.language, siteName: sites.name })
    .from(contacts)
    .innerJoin(sites, eq(sites.id, contacts.siteId))
    .where(eq(contacts.token, token));
  if (!row) return invalid;
  return { state: row.status === "unsubscribed" ? "unsubscribed" : "subscribed", siteName: row.siteName, language: row.language };
}

/** The stored link behind a tracked URL, with the contact's attribution ref; null when unknown. */
export async function trackClick(messageId: string, index: number, now: Date = new Date()): Promise<string | null> {
  if (!isUuid(messageId) || !Number.isInteger(index) || index < 0) return null;
  const [row] = await db
    .select({ links: emailMessages.links, ref: contacts.ref })
    .from(emailMessages)
    .innerJoin(contacts, eq(contacts.id, emailMessages.contactId))
    .where(and(eq(emailMessages.id, messageId), eq(emailMessages.status, "sent")));
  const target = row?.links[index];
  if (!target) return null;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.searchParams.set("cc_ref", row.ref);
  await db
    .update(emailMessages)
    .set({
      clicks: sql`${emailMessages.clicks} + 1`,
      clickedAt: sql`coalesce(${emailMessages.clickedAt}, ${now.toISOString()}::timestamp)`,
      lastClickedAt: now,
    })
    .where(eq(emailMessages.id, messageId));
  return url.toString();
}
