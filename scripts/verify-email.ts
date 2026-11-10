/**
 * Mark a user's email as verified. Platform-owner access requires a verified email
 * (see isPlatformOwner), and verification emails are not sent yet, so this is how an
 * operator with server access verifies their own owner account:
 *
 *   cd /srv/concierge && set -a && . /etc/concierge.env && set +a && npm run user:verify-email -- you@example.com
 *
 * Sign up in the app FIRST, then run this. If the address already had an account you
 * did not create (check the printed creation time), do not verify it: delete that user.
 */
export {};

async function main() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file; rely on the process environment
  }
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    console.error("usage: npm run user:verify-email -- <email>");
    process.exit(2);
  }
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/db/client");
  const { user } = await import("@/db/schema");
  const { env } = await import("@/lib/env");

  const [row] = await db.select().from(user).where(eq(user.email, email));
  if (!row) {
    console.error(`no user with email ${email}; sign up in the app first`);
    process.exit(1);
  }
  console.log(`user ${row.id} <${row.email}> created ${row.createdAt.toISOString()}`);
  if (row.emailVerified) {
    console.log("already verified");
  } else {
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, row.id));
    console.log("marked verified");
  }
  const listed = env.PLATFORM_OWNER_EMAILS.includes(email);
  console.log(listed ? "this address is in PLATFORM_OWNER_EMAILS: platform-owner access on next request"
                     : "note: this address is not in PLATFORM_OWNER_EMAILS");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
