import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { leads, memberships, user, type Lead } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { appBaseUrl } from "@/lib/widget/config";

export const LEADS_PAGE_LIMIT = 200;

/** The site's leads, newest first. Callers must have checked access to the site. */
export function listLeads(siteId: string, limit = LEADS_PAGE_LIMIT): Promise<Lead[]> {
  return db
    .select()
    .from(leads)
    .where(eq(leads.siteId, siteId))
    .orderBy(desc(leads.createdAt), desc(leads.id))
    .limit(limit);
}

async function ownerEmails(accountId: string): Promise<string[]> {
  const rows = await db
    .select({ email: user.email })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(eq(memberships.accountId, accountId), eq(memberships.role, "owner")));
  return rows.map((r) => r.email);
}

/** Emails the account's owners about a new lead. Rejects on failure; callers decide how to handle that. */
export async function notifyNewLead(
  site: { id: string; name: string; accountId: string },
  lead: { email: string; message: string },
): Promise<void> {
  const link = `${appBaseUrl()}/app/sites/${site.id}/leads`;
  const text = [
    `A visitor left a message on ${site.name}.`,
    "",
    `Email: ${lead.email}`,
    "Message:",
    lead.message,
    "",
    `See all messages: ${link}`,
  ].join("\n");
  for (const to of await ownerEmails(site.accountId)) {
    await sendEmail({ to, subject: `New message from a visitor on ${site.name}`, text });
  }
}
