// Sending domains: a shop sends only from its own website's domain, once the provider has verified it.
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sites, type Account, type Site } from "@/db/schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { planStatus } from "@/lib/plans";
import { atMonthlyLimit } from "@/lib/usage/levels";
import { getMonthUsage } from "@/lib/usage/meter";
import { EmailNotConfiguredError, createDomain, getDomain, verifyDomain, type DnsRecord } from "./provider";

export type DomainStatus = "none" | "pending" | "verified" | "failed";

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** The host a site's URL points at, without a leading "www.": the domain to suggest for sending. */
export function registrableHost(baseUrl: string): string {
  return new URL(baseUrl).hostname.replace(/^www\./, "");
}

async function loadSite(siteId: string): Promise<Site> {
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId));
  if (!site) throw new NotFoundError("Site not found");
  return site;
}

export async function addSendingDomain(siteId: string, input: string): Promise<DnsRecord[]> {
  const site = await loadSite(siteId);
  const domain = input.trim().toLowerCase();
  if (!HOSTNAME.test(domain)) throw new ValidationError("Enter a domain like example.com (no https:// or path)");
  const host = new URL(site.baseUrl).hostname.toLowerCase();
  // The website's own host or a parent of it: a shop can't send as another brand.
  if (host !== domain && !host.endsWith(`.${domain}`)) throw new ValidationError("Use your website's own domain");
  let created;
  try {
    created = await createDomain(domain);
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) throw err;
    throw new ValidationError(`The email provider couldn't add ${domain}: ${(err as Error).message}`);
  }
  await db
    .update(sites)
    .set({ sendingDomain: domain, sendingDomainId: created.id, sendingDomainStatus: "pending" })
    .where(eq(sites.id, siteId));
  return created.records;
}

function mapStatus(remote: string): Exclude<DomainStatus, "none"> {
  if (remote === "verified") return "verified";
  if (remote === "failed") return "failed";
  return "pending";
}

/** Asks the provider to check the DNS records again, and stores what it reports. */
export async function refreshSendingDomain(siteId: string): Promise<{ status: DomainStatus; records: DnsRecord[] }> {
  const site = await loadSite(siteId);
  if (!site.sendingDomainId) return { status: "none", records: [] };
  let remote;
  try {
    await verifyDomain(site.sendingDomainId);
    remote = await getDomain(site.sendingDomainId);
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) throw err;
    throw new ValidationError(`The email provider couldn't check ${site.sendingDomain}: ${(err as Error).message}`);
  }
  const status = mapStatus(remote.status);
  await db.update(sites).set({ sendingDomainStatus: status }).where(eq(sites.id, siteId));
  return { status, records: remote.records };
}

/** The DNS records to show for a domain still being set up; empty when the provider can't be reached. */
export async function sendingDomainRecords(site: Pick<Site, "sendingDomainId">): Promise<DnsRecord[]> {
  if (!site.sendingDomainId) return [];
  try {
    return (await getDomain(site.sendingDomainId)).records;
  } catch {
    return [];
  }
}

export async function removeSendingDomain(siteId: string): Promise<void> {
  await db
    .update(sites)
    .set({ sendingDomain: null, sendingDomainId: null, sendingDomainStatus: "none" })
    .where(eq(sites.id, siteId));
}

/** A verified domain, a plan that's still active, and emails left this month. */
export async function canSendEmail(
  site: Pick<Site, "sendingDomain" | "sendingDomainStatus">,
  account: Account,
  now: Date = new Date(),
): Promise<boolean> {
  if (!site.sendingDomain || site.sendingDomainStatus !== "verified") return false;
  const status = planStatus(account, now);
  if (status.expired) return false;
  const { emails } = await getMonthUsage(account.id, now);
  return emails < status.limits.emailsPerMonth;
}

/** Whether to offer emails or write new ones: sendable, and this month's conversations and emails aren't used up. */
export async function canDraftEmail(
  site: Pick<Site, "sendingDomain" | "sendingDomainStatus">,
  account: Account,
  now: Date = new Date(),
): Promise<boolean> {
  return (await canSendEmail(site, account, now)) && !(await atMonthlyLimit(account, now));
}

/** `{local}@{domain}` for a verified site, with the shop's name in front. */
export function fromAddress(site: Pick<Site, "name" | "emailFromName" | "emailFromLocal" | "sendingDomain">): string {
  const name = (site.emailFromName || site.name).replace(/["<>\r\n]/g, "").trim();
  return `"${name}" <${site.emailFromLocal}@${site.sendingDomain}>`;
}
