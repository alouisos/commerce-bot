// The platform owner invites a customer: the account exists from the start (so its plan and limits can be
// set), and a single-use link lets the invitee create their login.
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { accountInvites, accounts, memberships, sites, user } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { appBaseUrl } from "@/lib/widget/config";

export const INVITE_PLANS = ["trial", "starter", "growth", "pro", "complimentary"] as const;
export type InvitePlan = (typeof INVITE_PLANS)[number];

const INVITE_DAYS = 7;
const TRIAL_DAYS = 14;
const DAY = 86400_000;

const schema = z.object({
  email: z.string().trim().toLowerCase().max(320).pipe(z.email("Enter a valid email")),
  accountName: z.string().trim().min(1, "Enter the account name").max(80, "The account name is at most 80 characters"),
  plan: z.enum(INVITE_PLANS, { error: "Choose a plan" }),
});

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function sendInviteEmail(to: string, accountName: string, token: string): Promise<void> {
  await sendEmail({
    to,
    subject: "You're invited to Concierge",
    text: `You've been invited to set up ${accountName} on Concierge. Create your password here (the link works for ${INVITE_DAYS} days):\n\n${appBaseUrl()}/invite/${token}`,
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The invite-only sign-up invariant, shared by every way of inviting: one invite per address at a time,
 * and never to someone who already has a login. Serialised per address by an advisory lock.
 */
async function insertInviteTx(
  tx: Tx,
  input: { accountId: string; email: string; token: string },
  now: Date,
): Promise<{ inviteId: string }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invite:${input.email}`}))`);
  const [existingUser] = await tx.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${input.email}`);
  if (existingUser) throw new ValidationError("This person already has an account.");
  const [pending] = await tx
    .select({ id: accountInvites.id })
    .from(accountInvites)
    .where(and(eq(accountInvites.email, input.email), isNull(accountInvites.acceptedAt), gt(accountInvites.expiresAt, now)));
  if (pending) throw new ValidationError("There's already a pending invite for this email. Resend it instead.");
  const [invite] = await tx
    .insert(accountInvites)
    .values({ accountId: input.accountId, email: input.email, tokenHash: hashToken(input.token), expiresAt: new Date(now.getTime() + INVITE_DAYS * DAY), createdAt: now })
    .returning();
  return { inviteId: invite.id };
}

export async function createInvite(
  input: { email: string; accountName: string; plan: InvitePlan },
  now: Date = new Date(),
): Promise<{ inviteId: string; accountId: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
  const { email, accountName, plan } = parsed.data;
  const token = randomBytes(32).toString("base64url");

  const created = await db.transaction(async (tx) => {
    const [account] = await tx
      .insert(accounts)
      .values({ name: accountName, plan, trialEndsAt: plan === "trial" ? new Date(now.getTime() + TRIAL_DAYS * DAY) : null })
      .returning();
    const { inviteId } = await insertInviteTx(tx, { accountId: account.id, email, token }, now);
    return { inviteId, accountId: account.id };
  });
  await sendInviteEmail(email, accountName, token);
  return created;
}

/** An invite to join an account that already exists (e.g. restoring a removed customer). */
export async function createInviteForAccount(
  input: { accountId: string; email: string },
  now: Date = new Date(),
): Promise<{ inviteId: string }> {
  const parsed = schema.pick({ email: true }).safeParse({ email: input.email });
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
  const { email } = parsed.data;
  const token = randomBytes(32).toString("base64url");

  const { inviteId, accountName } = await db.transaction(async (tx) => {
    const [account] = await tx.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, input.accountId));
    if (!account) throw new NotFoundError("Account not found");
    const { inviteId } = await insertInviteTx(tx, { accountId: input.accountId, email, token }, now);
    return { inviteId, accountName: account.name };
  });
  await sendInviteEmail(email, accountName, token);
  return { inviteId };
}

async function pendingInvite(inviteId: string) {
  const [row] = await db
    .select({ invite: accountInvites, accountName: accounts.name })
    .from(accountInvites)
    .innerJoin(accounts, eq(accounts.id, accountInvites.accountId))
    .where(and(sql`${accountInvites.id}::text = ${inviteId}`, isNull(accountInvites.acceptedAt)));
  if (!row) throw new NotFoundError("Invite not found");
  return row;
}

/** A new link (the old one stops working) valid for another 7 days. */
export async function resendInvite(inviteId: string, now: Date = new Date()): Promise<void> {
  const { invite, accountName } = await pendingInvite(inviteId);
  const token = randomBytes(32).toString("base64url");
  await db
    .update(accountInvites)
    .set({ tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + INVITE_DAYS * DAY) })
    .where(eq(accountInvites.id, invite.id));
  await sendInviteEmail(invite.email, accountName, token);
}

/** Removes an unaccepted invite, and its account when nobody joined it and it has no websites. */
export async function cancelInvite(inviteId: string): Promise<void> {
  const { invite } = await pendingInvite(inviteId);
  await db.transaction(async (tx) => {
    await tx.delete(accountInvites).where(eq(accountInvites.id, invite.id));
    const members = await tx.$count(memberships, eq(memberships.accountId, invite.accountId));
    const siteCount = await tx.$count(sites, eq(sites.accountId, invite.accountId));
    if (members === 0 && siteCount === 0) await tx.delete(accounts).where(eq(accounts.id, invite.accountId));
  });
}

export async function listPendingInvites(): Promise<
  { id: string; email: string; accountName: string; plan: string; createdAt: Date; expiresAt: Date }[]
> {
  return db
    .select({
      id: accountInvites.id,
      email: accountInvites.email,
      accountName: accounts.name,
      plan: accounts.plan,
      createdAt: accountInvites.createdAt,
      expiresAt: accountInvites.expiresAt,
    })
    .from(accountInvites)
    .innerJoin(accounts, eq(accounts.id, accountInvites.accountId))
    .where(isNull(accountInvites.acceptedAt))
    .orderBy(accountInvites.createdAt);
}

/** The unaccepted, unexpired invite behind a link's token, or null. */
export async function findUsableInvite(
  token: string,
  now: Date = new Date(),
): Promise<{ id: string; accountId: string; email: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await db
    .select({ id: accountInvites.id, accountId: accountInvites.accountId, email: accountInvites.email })
    .from(accountInvites)
    .where(
      and(eq(accountInvites.tokenHash, hashToken(token)), isNull(accountInvites.acceptedAt), gt(accountInvites.expiresAt, now)),
    );
  return row ?? null;
}
