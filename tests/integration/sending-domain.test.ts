import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { monthlyUsage, sites } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { addSendingDomain, canOfferEmail, canSendEmail, refreshSendingDomain, removeSendingDomain } from "@/lib/email/domain";
import { EmailNotConfiguredError, setProviderForTests, type DnsRecord } from "@/lib/email/provider";
import { monthKey } from "@/lib/usage/meter";
import { resetDb } from "../helpers/db";
import { makeAccount, makeMembership, makeSite, makeUser } from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { addSendingDomainAction } from "@/app/app/sites/[siteId]/settings/actions";

const RECORDS: DnsRecord[] = [
  { type: "TXT", name: "resend._domainkey", value: "p=MIGf", status: "not_started" },
  { type: "MX", name: "send", value: "feedback-smtp.eu-west-1.amazonses.com", priority: 10, status: "not_started" },
];

let remote = "not_started";
const calls: string[] = [];
function fakeDomains() {
  setProviderForTests({
    createDomain: async (name) => {
      calls.push(`create:${name}`);
      return { id: "dom_1", status: "not_started", records: RECORDS };
    },
    getDomain: async (id) => {
      calls.push(`get:${id}`);
      return { id, status: remote, records: RECORDS };
    },
    verifyDomain: async (id) => {
      calls.push(`verify:${id}`);
    },
  });
}

beforeEach(async () => {
  await resetDb();
  remote = "not_started";
  calls.length = 0;
  fakeDomains();
});
afterEach(() => setProviderForTests(null));

const reload = async (id: string) => (await db.select().from(sites).where(eq(sites.id, id)))[0];
const now = new Date("2026-11-10T10:00:00Z");

async function shop() {
  const account = await makeAccount({ plan: "starter" });
  const site = await makeSite(account.id, { baseUrl: "https://www.milianjo.com" });
  return { account, site };
}

describe("sending domain", () => {
  it("adds the shop's own registrable domain as pending", async () => {
    const { site } = await shop();
    expect(await addSendingDomain(site.id, "  MilianJo.com ")).toEqual(RECORDS);
    expect(calls).toEqual(["create:milianjo.com"]);
    expect(await reload(site.id)).toMatchObject({
      sendingDomain: "milianjo.com",
      sendingDomainId: "dom_1",
      sendingDomainStatus: "pending",
    });
  });

  it.each(["evil.com", "com", "notmilianjo.com", "https://milianjo.com", "milianjo.com/path", "a b.com"])(
    "refuses %s",
    async (domain) => {
      const { site } = await shop();
      await expect(addSendingDomain(site.id, domain)).rejects.toThrow(ValidationError);
      expect(calls).toEqual([]);
      expect((await reload(site.id)).sendingDomainStatus).toBe("none");
    },
  );

  it("names the reason for another brand's domain", async () => {
    const { site } = await shop();
    await expect(addSendingDomain(site.id, "evil.com")).rejects.toThrow(
      new ValidationError("Use your website's own domain"),
    );
  });

  it("refresh maps verified, then canSendEmail turns true", async () => {
    const { account, site } = await shop();
    await addSendingDomain(site.id, "milianjo.com");
    expect(await canSendEmail(await reload(site.id), account, now)).toBe(false);

    expect((await refreshSendingDomain(site.id)).status).toBe("pending");
    remote = "verified";
    const res = await refreshSendingDomain(site.id);
    expect(res).toEqual({ status: "verified", records: RECORDS });
    expect(calls).toContain("verify:dom_1");
    expect(await canSendEmail(await reload(site.id), account, now)).toBe(true);

    remote = "failed";
    expect((await refreshSendingDomain(site.id)).status).toBe("failed");
  });

  it("the monthly email cap stops sending", async () => {
    const { account, site } = await shop();
    await db.update(sites).set({ sendingDomain: "milianjo.com", sendingDomainStatus: "verified" }).where(eq(sites.id, site.id));
    await db.insert(monthlyUsage).values({ accountId: account.id, month: monthKey(now), emails: 999 });
    expect(await canSendEmail(await reload(site.id), account, now)).toBe(true);
    await db.update(monthlyUsage).set({ emails: 1000 }).where(eq(monthlyUsage.accountId, account.id));
    expect(await canSendEmail(await reload(site.id), account, now)).toBe(false);
  });

  it("an expired trial can't send", async () => {
    const account = await makeAccount({ plan: "trial", trialEndsAt: new Date("2026-11-01T00:00:00Z") });
    const site = await makeSite(account.id, { sendingDomain: "example.com", sendingDomainStatus: "verified" });
    expect(await canSendEmail(site, account, now)).toBe(false);
  });

  it("remove clears the domain", async () => {
    const { site } = await shop();
    await addSendingDomain(site.id, "milianjo.com");
    await removeSendingDomain(site.id);
    expect(await reload(site.id)).toMatchObject({ sendingDomain: null, sendingDomainId: null, sendingDomainStatus: "none" });
  });

  it("without a provider key: EmailNotConfiguredError, and the action says so", async () => {
    setProviderForTests(null);
    const { account, site } = await shop();
    await expect(addSendingDomain(site.id, "milianjo.com")).rejects.toBeInstanceOf(EmailNotConfiguredError);

    const u = await makeUser();
    await makeMembership(account.id, u.id);
    current.user = { id: u.id, email: u.email };
    const fd = new FormData();
    fd.set("domain", "milianjo.com");
    expect(await addSendingDomainAction(site.id, {}, fd)).toEqual({ error: "Email isn't set up on this server yet." });
  });
});

describe("sending domain settings UI", () => {
  it("suggests the registrable host, then lists the records while pending", async () => {
    const { default: SettingsPage } = await import("@/app/app/sites/[siteId]/settings/page");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { account, site } = await shop();
    const u = await makeUser();
    await makeMembership(account.id, u.id);
    current.user = { id: u.id, email: u.email };
    const render = async () =>
      renderToStaticMarkup(await SettingsPage({ params: Promise.resolve({ siteId: site.id }) } as never));

    expect(await render()).toMatch(/name="domain"[^>]*value="milianjo.com"|value="milianjo.com"[^>]*name="domain"/);
    await addSendingDomain(site.id, "milianjo.com");
    const pending = await render();
    expect(pending).toContain("resend._domainkey");
    expect(pending).toContain("Add these records at your domain provider, then check.");
    expect(pending).toContain("Check now");
    remote = "verified";
    await refreshSendingDomain(site.id);
    expect(await render()).toContain("Emails are sent from hello@milianjo.com.");
  });
});

describe("canOfferEmail", () => {
  it("needs a verified domain on top of emailAsk, a live plan and emails left", async () => {
    const account = await makeAccount({ plan: "starter" });
    const unverified = await makeSite(account.id, { sendingDomain: "milianjo.com", sendingDomainStatus: "pending" });
    const verified = await makeSite(account.id, { sendingDomain: "milianjo.com", sendingDomainStatus: "verified" });
    expect(await canOfferEmail(unverified, account)).toBe(false);
    expect(await canOfferEmail({ ...unverified, sendingDomain: null, sendingDomainStatus: "none" }, account)).toBe(false);
    expect(await canOfferEmail(verified, account)).toBe(true);
    expect(await canOfferEmail({ ...verified, emailAsk: false }, account)).toBe(false);
  });
});
