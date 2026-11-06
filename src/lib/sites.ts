import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, sites, type Account, type Site } from "@/db/schema";
import { PlanLimitError, ValidationError } from "@/lib/errors";
import { enqueue, JOBS } from "@/lib/jobs";
import { planStatus } from "@/lib/plans";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generatePublicKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  // 256 % 62 is non-zero, so reject values that would bias the result.
  let out = "";
  let pool = bytes;
  let i = 0;
  while (out.length < 24) {
    if (i >= pool.length) {
      pool = crypto.getRandomValues(new Uint8Array(24));
      i = 0;
    }
    const b = pool[i++];
    if (b < 248) out += ALPHABET[b % 62];
  }
  return `pk_${out}`;
}

function parseHttpUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ValidationError("Enter a valid website URL, for example https://example.com");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("The website URL must start with http:// or https://");
  }
  return url;
}

export function normalizeBaseUrl(input: string): string {
  const url = parseHttpUrl(input);
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export function deriveAllowedOrigins(baseUrl: string): string[] {
  const url = parseHttpUrl(baseUrl);
  const origins = [url.origin];
  const host = url.hostname;
  const noTwin = host === "localhost" || host.includes(":") || /^\d+(\.\d+){3}$/.test(host) || !host.includes(".");
  if (!noTwin) {
    const twin = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
    const twinUrl = new URL(url.origin);
    twinUrl.hostname = twin;
    origins.push(twinUrl.origin);
  }
  return origins;
}

/** Exact match of the normalized origin; never prefix or suffix matching. */
export function isOriginAllowed(site: { allowedOrigins: string[] }, origin: string | null): boolean {
  if (!origin) return false;
  let normalized: string;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    normalized = url.origin;
  } catch {
    return false;
  }
  return site.allowedOrigins.includes(normalized);
}

export async function createSite(
  accountId: string,
  input: { name: string; baseUrl: string },
  now: Date = new Date(),
): Promise<Site> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 100) {
    throw new ValidationError("Name must be between 1 and 100 characters");
  }
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const allowedOrigins = deriveAllowedOrigins(baseUrl);

  const site = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${accountId}))`);
    const [account] = await tx.select().from(accounts).where(eq(accounts.id, accountId));
    if (!account) throw new ValidationError("Account not found");
    const { limits } = planStatus(account, now);
    const existing = await tx.$count(sites, eq(sites.accountId, accountId));
    if (existing >= limits.websites) {
      throw new PlanLimitError(
        `Your plan allows ${limits.websites} ${limits.websites === 1 ? "website" : "websites"}. Upgrade to add more.`,
      );
    }
    const [row] = await tx
      .insert(sites)
      .values({ accountId, name, baseUrl, allowedOrigins, publicKey: generatePublicKey() })
      .returning();
    return row;
  });
  await enqueue(JOBS.crawlSite, { siteId: site.id });
  return site;
}

export async function getSiteByPublicKey(key: string): Promise<(Site & { account: Account }) | null> {
  const [row] = await db
    .select({ site: sites, account: accounts })
    .from(sites)
    .innerJoin(accounts, eq(accounts.id, sites.accountId))
    .where(eq(sites.publicKey, key))
    .limit(1);
  return row ? { ...row.site, account: row.account } : null;
}
