// The site's WooCommerce connection. The secret is stored encrypted and only ever decrypted on the server.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { sites, storeConnections } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { testConnection, type WooCredentials } from "./woocommerce";

const schema = z.object({
  storeUrl: z.string().trim().min(1, "Enter your shop's address"),
  consumerKey: z
    .string()
    .trim()
    .regex(/^ck_[a-f0-9]{40}$/, "The consumer key starts with ck_ followed by 40 letters and numbers"),
  consumerSecret: z
    .string()
    .trim()
    .regex(/^cs_[a-f0-9]{40}$/, "The consumer secret starts with cs_ followed by 40 letters and numbers"),
});

function hostsOf(site: { baseUrl: string; allowedOrigins: string[] }): Set<string> {
  const out = new Set<string>();
  for (const u of [site.baseUrl, ...site.allowedOrigins]) {
    try {
      out.add(new URL(u).hostname.toLowerCase());
    } catch {
      // ignore
    }
  }
  return out;
}

/** https only, no path, and on the website's own host: the key is never sent anywhere else. */
function storeOrigin(raw: string, site: { baseUrl: string; allowedOrigins: string[] }): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new ValidationError("Enter your shop's address, like https://example.com");
  }
  if (u.protocol !== "https:") throw new ValidationError("The shop's address must start with https://");
  if ((u.pathname !== "/" && u.pathname !== "") || u.search || u.hash || u.username || u.password) {
    throw new ValidationError("Enter only the shop's address, like https://example.com, without a path");
  }
  if (!hostsOf(site).has(u.hostname.toLowerCase())) throw new ValidationError("Use your website's own address");
  return u.origin;
}

export async function connectWooCommerce(siteId: string, input: unknown): Promise<void> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
  const [site] = await db
    .select({ baseUrl: sites.baseUrl, allowedOrigins: sites.allowedOrigins })
    .from(sites)
    .where(eq(sites.id, siteId));
  if (!site) throw new NotFoundError("Site not found");
  const creds: WooCredentials = {
    storeUrl: storeOrigin(parsed.data.storeUrl, site),
    consumerKey: parsed.data.consumerKey,
    consumerSecret: parsed.data.consumerSecret,
  };
  const test = await testConnection(creds);
  if (!test.ok) throw new ValidationError(test.error);
  const values = {
    platform: "woocommerce" as const,
    storeUrl: creds.storeUrl,
    consumerKey: creds.consumerKey,
    consumerSecretEnc: encryptSecret(creds.consumerSecret),
    status: "connected" as const,
    lastError: null,
    verifiedAt: new Date(),
  };
  await db
    .insert(storeConnections)
    .values({ siteId, ...values })
    .onConflictDoUpdate({ target: storeConnections.siteId, set: values });
}

/** For server use only: the decrypted credentials, or null when the site has no connection. */
export async function getStoreCredentials(siteId: string): Promise<WooCredentials | null> {
  const [row] = await db.select().from(storeConnections).where(eq(storeConnections.siteId, siteId));
  if (!row) return null;
  return { storeUrl: row.storeUrl, consumerKey: row.consumerKey, consumerSecret: decryptSecret(row.consumerSecretEnc) };
}

export async function hasStoreConnection(siteId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: storeConnections.id })
    .from(storeConnections)
    .where(eq(storeConnections.siteId, siteId));
  return !!row;
}

/** What the admin may see: never the secret. */
export async function getStoreConnectionSummary(siteId: string): Promise<{
  storeUrl: string;
  keyLast4: string;
  status: "connected" | "failing";
  lastError: string | null;
} | null> {
  const [row] = await db
    .select({
      storeUrl: storeConnections.storeUrl,
      consumerKey: storeConnections.consumerKey,
      status: storeConnections.status,
      lastError: storeConnections.lastError,
    })
    .from(storeConnections)
    .where(eq(storeConnections.siteId, siteId));
  if (!row) return null;
  return { storeUrl: row.storeUrl, keyLast4: row.consumerKey.slice(-4), status: row.status, lastError: row.lastError };
}

export async function markConnectionFailing(siteId: string, error: string): Promise<void> {
  await db
    .update(storeConnections)
    .set({ status: "failing", lastError: error })
    .where(eq(storeConnections.siteId, siteId));
}

export async function disconnectStore(siteId: string): Promise<void> {
  await db.delete(storeConnections).where(eq(storeConnections.siteId, siteId));
}
