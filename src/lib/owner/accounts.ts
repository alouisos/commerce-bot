// The platform owner removing and restoring a customer. Removing deletes the customer's logins (and,
// by cascade, their sessions, credentials and memberships) and turns their bot off; sites, conversations
// and leads are kept so a restore brings everything back.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { accountInvites, accounts, memberships, user } from "@/db/schema";
import { session as sessionTable, account as credentialTable } from "@/db/auth-schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { createInviteForAccount } from "@/lib/invites";

export async function removeAccount(accountId: string, actingUserId: string, now: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const [target] = await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).for("update");
    if (!target) throw new NotFoundError("Account not found");
    // Only users who are members of THIS account are ever deleted.
    const members = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.accountId, accountId));
    const userIds = members.map((m) => m.userId);
    if (userIds.includes(actingUserId)) throw new ValidationError("You can't remove your own account.");
    if (userIds.length > 0) {
      // These cascade from `user`; deleted explicitly too so logins die even if the schema's cascades change.
      await tx.delete(sessionTable).where(inArray(sessionTable.userId, userIds));
      await tx.delete(credentialTable).where(inArray(credentialTable.userId, userIds));
      await tx.delete(user).where(inArray(user.id, userIds));
    }
    // An unaccepted invite would let someone log straight back in.
    await tx.delete(accountInvites).where(and(eq(accountInvites.accountId, accountId), isNull(accountInvites.acceptedAt)));
    await tx.update(accounts).set({ removedAt: now }).where(eq(accounts.id, accountId));
  });
}

/** Turns the bot back on and invites `email` to set up a login for the account. */
export async function restoreAccount(accountId: string, email: string, now: Date = new Date()): Promise<{ inviteId: string }> {
  const [row] = await db.select({ removedAt: accounts.removedAt }).from(accounts).where(eq(accounts.id, accountId));
  if (!row) throw new NotFoundError("Account not found");
  if (!row.removedAt) throw new ValidationError("This account isn't removed.");
  const { inviteId } = await createInviteForAccount({ accountId, email }, now);
  await db.update(accounts).set({ removedAt: null }).where(eq(accounts.id, accountId));
  return { inviteId };
}
