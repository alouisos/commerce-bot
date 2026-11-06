import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { accounts, siteGreetings, sites } from "../../src/db/schema";

/** Public key baked into tests/e2e/fixture-site/*.html. */
export const E2E_PUBLIC_KEY = "pk_e2e_fixture";
export const E2E_GREETING_EL = "Καλώς ήρθατε στο e2e κατάστημα!";
export const E2E_GREETING_EN = "Welcome to the e2e shop!";

/**
 * Idempotent: removes only the rows this seed created (matched by its fixed
 * public key) and recreates them. Never truncates anything.
 */
export async function seed(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql);
  try {
    const old = await db.select().from(sites).where(eq(sites.publicKey, E2E_PUBLIC_KEY));
    for (const s of old) await db.delete(accounts).where(eq(accounts.id, s.accountId)); // cascades
    const [account] = await db.insert(accounts).values({ name: "E2E Account", plan: "complimentary" }).returning();
    const [site] = await db
      .insert(sites)
      .values({
        accountId: account.id,
        name: "E2E Shop",
        baseUrl: "http://localhost:4100",
        allowedOrigins: ["http://localhost:4100"],
        publicKey: E2E_PUBLIC_KEY,
        defaultLanguage: "el",
        botName: "Ask Jo",
      })
      .returning();
    await db.insert(siteGreetings).values([
      { siteId: site.id, language: "el", message: E2E_GREETING_EL },
      { siteId: site.id, language: "en", message: E2E_GREETING_EN },
    ]);
  } finally {
    await sql.end();
  }
}

export default async function globalSetup() {
  await seed(process.env.DATABASE_URL ?? "postgres://concierge:concierge@localhost:5433/concierge");
}
