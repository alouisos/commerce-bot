import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, memberships, type Account } from "@/db/schema";
import { NotFoundError } from "@/lib/errors";

const TRIAL_DAYS = 14;

export async function createAccountForUser(
  userId: string,
  email: string,
  now: Date = new Date(),
): Promise<Account> {
  const localPart = email.split("@")[0];
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  return db.transaction(async (tx) => {
    const [account] = await tx
      .insert(accounts)
      .values({ name: `${localPart}'s workspace`, plan: "trial", trialEndsAt })
      .returning();
    await tx.insert(memberships).values({ accountId: account.id, userId, role: "owner" });
    return account;
  });
}

/** One account per user in this stage: the account of the user's first membership. */
export async function getAccountForUser(userId: string): Promise<Account> {
  const [row] = await db
    .select({ account: accounts })
    .from(memberships)
    .innerJoin(accounts, eq(accounts.id, memberships.accountId))
    .where(eq(memberships.userId, userId))
    .orderBy(memberships.createdAt)
    .limit(1);
  if (!row) throw new NotFoundError("No account for user");
  return row.account;
}
