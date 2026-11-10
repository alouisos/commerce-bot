import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships, sites, type Site } from "@/db/schema";
import { env } from "@/lib/env";
import { NotFoundError } from "@/lib/errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the site if the user is a member of its account; otherwise throws NotFoundError. */
export async function requireSiteAccess(userId: string, siteId: string): Promise<Site> {
  if (!UUID_RE.test(siteId)) throw new NotFoundError("Site not found");
  const [row] = await db
    .select({ site: sites })
    .from(sites)
    .innerJoin(
      memberships,
      and(eq(memberships.accountId, sites.accountId), eq(memberships.userId, userId)),
    )
    .where(eq(sites.id, siteId))
    .limit(1);
  if (!row) throw new NotFoundError("Site not found");
  return row.site;
}

/**
 * Platform-owner access needs the listed address AND a verified email. Sign-up is open and does
 * not verify addresses, so the address alone proves nothing: anyone could register a listed owner
 * address that has no account yet. Verification is set with `npm run user:verify-email` on the server.
 */
export function isPlatformOwner(
  user: { email: string; emailVerified: boolean },
  owners: readonly string[] = env.PLATFORM_OWNER_EMAILS,
): boolean {
  return user.emailVerified === true && owners.includes(user.email.trim().toLowerCase());
}
