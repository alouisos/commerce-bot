import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { accounts, memberships, sites, user } from "@/db/schema";

export async function makeUser(email?: string) {
  const id = randomUUID();
  const [row] = await db
    .insert(user)
    .values({ id, name: "Test User", email: email ?? `user-${id}@example.com`, emailVerified: true })
    .returning();
  return row;
}

export async function makeAccount(opts: { plan?: (typeof accounts.$inferInsert)["plan"]; trialEndsAt?: Date | null } = {}) {
  const [row] = await db
    .insert(accounts)
    .values({ name: "Test Account", plan: opts.plan ?? "trial", trialEndsAt: opts.trialEndsAt ?? null })
    .returning();
  return row;
}

export async function makeMembership(accountId: string, userId: string, role: "owner" | "admin" = "owner") {
  const [row] = await db.insert(memberships).values({ accountId, userId, role }).returning();
  return row;
}

export async function makeSite(accountId: string, overrides: Partial<typeof sites.$inferInsert> = {}) {
  const [row] = await db
    .insert(sites)
    .values({
      accountId,
      name: "Test Site",
      baseUrl: "https://example.com",
      allowedOrigins: ["https://example.com"],
      publicKey: `pk_${randomUUID()}`,
      ...overrides,
    })
    .returning();
  return row;
}
