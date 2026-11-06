import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, memberships, user, type Account } from "@/db/schema";
import { NotFoundError } from "@/lib/errors";

const TRIAL_DAYS = 14;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function findAccount(tx: Tx, userId: string): Promise<Account | undefined> {
  const [row] = await tx
    .select({ account: accounts })
    .from(memberships)
    .innerJoin(accounts, eq(accounts.id, memberships.accountId))
    .where(eq(memberships.userId, userId))
    .orderBy(memberships.createdAt)
    .limit(1);
  return row?.account;
}

/**
 * Creates the user's trial account and owner membership, or returns the existing
 * account. Serialised per user with an advisory lock so the sign-up hook and a
 * self-heal can never create two accounts.
 */
export async function createAccountForUser(
  userId: string,
  email: string,
  now: Date = new Date(),
): Promise<Account> {
  const localPart = email.split("@")[0];
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const existing = await findAccount(tx, userId);
    if (existing) return existing;
    const [account] = await tx
      .insert(accounts)
      .values({ name: `${localPart}'s workspace`, plan: "trial", trialEndsAt })
      .returning();
    await tx.insert(memberships).values({ accountId: account.id, userId, role: "owner" });
    return account;
  });
}

/**
 * One account per user in this stage: the account of the user's first membership.
 * Self-heals a user whose sign-up hook failed by creating the trial account.
 */
export async function getAccountForUser(userId: string): Promise<Account> {
  const existing = await findAccount(db as unknown as Tx, userId);
  if (existing) return existing;
  const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
  if (!u) throw new NotFoundError("User not found");
  return createAccountForUser(userId, u.email);
}
