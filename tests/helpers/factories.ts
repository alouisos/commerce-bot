import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { accounts, conversations, kbSources, leads, memberships, messages, promptImpressions, sites, user } from "@/db/schema";

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

export async function makeSource(siteId: string, overrides: Partial<typeof kbSources.$inferInsert> = {}) {
  const [row] = await db
    .insert(kbSources)
    .values({ siteId, kind: "text", title: "Test", status: "ready", ...overrides })
    .returning();
  return row;
}

export async function makeConversation(siteId: string, overrides: Partial<typeof conversations.$inferInsert> = {}) {
  const [row] = await db
    .insert(conversations)
    .values({ siteId, visitorSessionId: `sid-${randomUUID()}`, language: "en", ...overrides })
    .returning();
  return row;
}

export async function makeMessage(conversationId: string, overrides: Partial<typeof messages.$inferInsert> = {}) {
  const [row] = await db
    .insert(messages)
    .values({ conversationId, role: "visitor", content: "Hello", ...overrides })
    .returning();
  return row;
}

export async function makeLead(siteId: string, overrides: Partial<typeof leads.$inferInsert> = {}) {
  const [row] = await db
    .insert(leads)
    .values({ siteId, email: `lead-${randomUUID()}@example.com`, message: "Please follow up", ...overrides })
    .returning();
  return row;
}

export async function makeImpression(
  siteId: string,
  overrides: Partial<typeof promptImpressions.$inferInsert> = {},
) {
  const [row] = await db
    .insert(promptImpressions)
    .values({
      siteId,
      visitorSessionId: `sid-${randomUUID()}`,
      kind: "question",
      intent: "exploring",
      confidence: 0.8,
      language: "en",
      pageUrl: "https://example.com/product/shampoo/",
      text: "Want to know how to use it?",
      question: "How do I use it?",
      ...overrides,
    })
    .returning();
  return row;
}
