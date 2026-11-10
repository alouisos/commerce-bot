// Every 15 minutes: write the follow-up emails that are due, then send the approved ones.
// Every unclear case means no email.
import { and, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  accounts,
  contacts,
  conversations,
  emailMessages,
  kbSources,
  sites,
  type Account,
  type Contact,
  type EmailMessage,
  type Site,
} from "@/db/schema";
import { effectiveEmailMode } from "@/lib/site-settings";
import { countEmailSent } from "@/lib/usage/meter";
import { appBaseUrl } from "@/lib/widget/config";
import { canSendEmail, fromAddress } from "./domain";
import { sendMail } from "./provider";
import { oneClickUrl, renderEmail, unsubscribePageUrl } from "./render";
import { writeEmail, type CallModel } from "./writer";

const H = 3600_000;
const D = 24 * H;
const FIRST_EMAIL_DELAY_MS = 2 * H;
/** Model calls per tick, whether they succeed or not. */
const MAX_WRITES_PER_TICK = 50;
const MAX_SENDS_PER_TICK = 500;
const MAX_SEND_ATTEMPTS = 3;
/** Resend allows about 2 requests a second by default; a burst of approvals must not turn into failures. */
const SEND_INTERVAL_MS = 600;
/** After a failed write or send, wait a day before writing again; after 3 failures, stop the sequence. */
const FAILURE_BACKOFF_MS = D;
const MAX_FAILURES_PER_SEQUENCE = 3;


type SiteWithAccount = Site & { account: Account };

/** Moves a contact's sequence to a new conversation and drops any email not sent yet. */
export async function restartSequence(contactId: string, conversationId: string, now: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(contacts)
      .set({ sequenceConversationId: conversationId, sequenceStartedAt: now })
      .where(eq(contacts.id, contactId));
    await tx
      .update(emailMessages)
      .set({ status: "discarded", updatedAt: now })
      .where(and(eq(emailMessages.contactId, contactId), inArray(emailMessages.status, ["draft", "approved"])));
  });
}


/**
 * Restarts a contact's sequence from a conversation that arrived with their email ref, but only when they
 * clicked one of their own emails since the sequence last started, within 30 days. A link someone shares
 * carries the same ref; this way it can restart a sequence at most once per real click.
 */
export async function restartAfterClick(contactId: string, conversationId: string, now: Date = new Date()): Promise<boolean> {
  const at = sql`${now.toISOString()}::timestamp`;
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.status, "subscribed"),
        sql`exists (select 1 from ${emailMessages} e where e.contact_id = ${contacts.id}
          and e.last_clicked_at > coalesce(${contacts.sequenceStartedAt}, 'epoch'::timestamp)
          and e.last_clicked_at > ${at} - interval '30 days')`,
      ),
    );
  if (!row) return false;
  await restartSequence(contactId, conversationId, now);
  return true;
}

async function sequenceHistory(contact: Contact, conversationId: string) {
  return db
    .select({
      status: emailMessages.status,
      subject: emailMessages.subject,
      sentAt: emailMessages.sentAt,
      createdAt: emailMessages.createdAt,
    })
    .from(emailMessages)
    .where(and(eq(emailMessages.contactId, contact.id), eq(emailMessages.conversationId, conversationId)))
    .orderBy(desc(emailMessages.createdAt));
}

/** The step and due time of the next email in a contact's sequence, or null when none is due. */
async function nextEmail(
  site: Site,
  contact: Contact,
  now: Date,
): Promise<{ step: number; previousSubjects: string[] } | null> {
  const conversationId = contact.sequenceConversationId;
  if (!conversationId || !contact.confirmedAt) return null;
  const history = await sequenceHistory(contact, conversationId);
  const sent = history.filter((m) => m.status === "sent");
  if (sent.length >= site.emailMaxPerPerson) return null;
  const failures = history.filter((m) => m.status === "failed");
  if (failures.length >= MAX_FAILURES_PER_SEQUENCE) return null;
  if (failures.some((m) => now.getTime() - m.createdAt.getTime() < FAILURE_BACKOFF_MS)) return null;

  let due: number;
  if (sent.length === 0) {
    const [convo] = await db
      .select({ lastMessageAt: conversations.lastMessageAt })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!convo) return null;
    due = Math.max(convo.lastMessageAt.getTime(), contact.confirmedAt.getTime()) + FIRST_EMAIL_DELAY_MS;
  } else {
    const last = Math.max(...sent.map((m) => m.sentAt?.getTime() ?? 0));
    due = last + site.emailIntervalDays * D;
  }
  if (now.getTime() < due) return null;
  return { step: sent.length + 1, previousSubjects: sent.map((m) => m.subject).reverse() };
}

async function draftDueEmails(now: Date, callModel: CallModel | undefined): Promise<number> {
  // Subscribed contacts with a sequence and nothing waiting to go out.
  const rows = await db
    .select({ contact: contacts, site: sites, account: accounts })
    .from(contacts)
    .innerJoin(sites, eq(sites.id, contacts.siteId))
    .innerJoin(accounts, eq(accounts.id, sites.accountId))
    .where(
      and(
        eq(contacts.status, "subscribed"),
        isNotNull(contacts.sequenceConversationId),
        eq(sites.sendingDomainStatus, "verified"),
        sql`not exists (select 1 from ${emailMessages} where ${emailMessages.contactId} = ${contacts.id} and ${emailMessages.status} in ('draft', 'approved', 'sending'))`,
      ),
    )
    .orderBy(contacts.confirmedAt);

  let written = 0;
  let attempts = 0;
  const sendable = new Map<string, boolean>();
  for (const { contact, site: s, account } of rows) {
    if (attempts >= MAX_WRITES_PER_TICK) break;
    const site: SiteWithAccount = { ...s, account };
    if (!sendable.has(site.id)) sendable.set(site.id, await canSendEmail(site, account, now));
    if (!sendable.get(site.id)) continue;
    const next = await nextEmail(site, contact, now);
    if (!next) continue;
    const conversationId = contact.sequenceConversationId!;

    let email;
    attempts++;
    try {
      email = await writeEmail(
        { site, contact, conversationId, step: next.step, previousSubjects: next.previousSubjects },
        { callModel, now },
      );
    } catch (err) {
      console.error("email write failed", { contactId: contact.id }, err);
      await db.insert(emailMessages).values({
        siteId: site.id,
        contactId: contact.id,
        conversationId,
        step: next.step,
        status: "failed",
        subject: "",
        body: "",
        language: contact.language,
        scheduledFor: now,
        error: `Write failed: ${(err as Error).message}`.slice(0, 500),
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }
    if (!email) {
      // The account can't use AI right now (aiBlocked): nothing for this site this tick.
      sendable.set(site.id, false);
      continue;
    }
    const status = effectiveEmailMode(site, account, now) === "automatic" ? "approved" : "draft";
    const inserted = await db
      .insert(emailMessages)
      .values({
        siteId: site.id,
        contactId: contact.id,
        conversationId,
        step: next.step,
        status,
        subject: email.subject,
        body: email.body,
        language: contact.language,
        links: email.links,
        scheduledFor: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: emailMessages.id });
    // A conflict means another tick already queued this person's next email.
    if (inserted.length > 0) written++;
  }
  return written;
}

/** The site's own knowledge images named in the body, as URLs the email can load. */
async function imageResolver(site: Site, body: string): Promise<(id: string) => string | null> {
  const ids = [...body.matchAll(/\[\[image:([0-9a-f-]{36})\]\]/g)].map((m) => m[1]);
  if (ids.length === 0) return () => null;
  const rows = await db
    .select({ id: kbSources.id })
    .from(kbSources)
    .where(and(eq(kbSources.siteId, site.id), eq(kbSources.kind, "image"), inArray(kbSources.id, ids)));
  const known = new Set(rows.map((r) => r.id));
  return (id) =>
    known.has(id) ? `${appBaseUrl()}/api/widget/image/${id}?key=${encodeURIComponent(site.publicKey)}` : null;
}

async function setStatus(id: string, patch: Partial<EmailMessage>, now: Date) {
  await db
    .update(emailMessages)
    .set({ ...patch, updatedAt: now })
    .where(eq(emailMessages.id, id));
}

async function sendOne(id: string, now: Date): Promise<"sent" | "skipped" | "error" | null> {
  // Claim: only one tick can move a message from approved to sending.
  const [claimed] = await db
    .update(emailMessages)
    .set({ status: "sending", updatedAt: now })
    .where(and(eq(emailMessages.id, id), eq(emailMessages.status, "approved")))
    .returning();
  if (!claimed) return null;

  const [row] = await db
    .select({ contact: contacts, site: sites, account: accounts })
    .from(contacts)
    .innerJoin(sites, eq(sites.id, contacts.siteId))
    .innerJoin(accounts, eq(accounts.id, sites.accountId))
    .where(eq(contacts.id, claimed.contactId));
  if (!row || row.contact.status !== "subscribed" || !(await canSendEmail(row.site, row.account, now))) {
    await setStatus(id, { status: "skipped" }, now);
    return "skipped";
  }
  const { contact, site, account } = row;
  const { html, text } = renderEmail({
    body: claimed.body,
    links: claimed.links,
    messageId: claimed.id,
    siteName: site.name,
    unsubscribeUrl: unsubscribePageUrl(contact.token),
    imageUrl: await imageResolver(site, claimed.body),
    language: claimed.language,
  });
  try {
    const { id: providerId } = await sendMail({
      from: fromAddress(site),
      to: contact.email,
      subject: claimed.subject,
      text,
      html,
      headers: {
        "List-Unsubscribe": `<${oneClickUrl(contact.token)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    await setStatus(id, { status: "sent", sentAt: now, providerId, error: null }, now);
    await countEmailSent(account.id, now);
    return "sent";
  } catch (err) {
    const attempts = claimed.attempts + 1;
    await setStatus(
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

async function sendApproved(now: Date, intervalMs: number): Promise<{ sent: number; skipped: number }> {
  const due = await db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(and(eq(emailMessages.status, "approved"), lte(emailMessages.scheduledFor, now)))
    .orderBy(emailMessages.scheduledFor)
    .limit(MAX_SENDS_PER_TICK);
  let sent = 0;
  let skipped = 0;
  let lastSend = 0;
  for (const { id } of due) {
    const wait = lastSend + intervalMs - Date.now();
    if (lastSend && wait > 0) await new Promise((r) => setTimeout(r, wait));
    const r = await sendOne(id, now);
    if (r === "sent" || r === "error") lastSend = Date.now();
    if (r === "sent") sent++;
    else if (r === "skipped") skipped++;
  }
  return { sent, skipped };
}

export async function emailTick(
  now: Date = new Date(),
  opts: { callModel?: CallModel; sendIntervalMs?: number } = {},
): Promise<{ drafted: number; sent: number; skipped: number }> {
  const drafted = await draftDueEmails(now, opts.callModel);
  const { sent, skipped } = await sendApproved(now, opts.sendIntervalMs ?? SEND_INTERVAL_MS);
  return { drafted, sent, skipped };
}

