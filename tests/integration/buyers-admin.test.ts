import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db/client";
import { buyerEmails, buyerFeedback, buyerOrders, buyers, sites, storeConnections } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { approveBuyerDraft, discardBuyerDraft, listBuyerQueue, setBuyerEmails, updateBuyerDraft } from "@/lib/buyers/admin";
import { resetDb } from "../helpers/db";
import { makeAccount, makeMembership, makeSite, makeUser } from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "", emailVerified: true } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import BuyersPage from "@/app/app/sites/[siteId]/buyers/page";
import { approveBuyerDraftAction, discardBuyerDraftAction } from "@/app/app/sites/[siteId]/buyers/actions";
import { saveBuyerEmailsAction } from "@/app/app/sites/[siteId]/settings/actions";

beforeEach(resetDb);

async function setup(opts: { verified?: boolean; woo?: boolean; plan?: "starter" | "growth" } = {}) {
  const u = await makeUser();
  const account = await makeAccount({ plan: opts.plan ?? "growth" });
  await makeMembership(account.id, u.id);
  current.user = { id: u.id, email: u.email, emailVerified: true };
  const site = await makeSite(account.id, {
    name: "Milian Jo",
    baseUrl: "https://milianjo.com",
    allowedOrigins: ["https://milianjo.com"],
    sendingDomain: "milianjo.com",
    sendingDomainStatus: opts.verified === false ? "pending" : "verified",
  });
  if (opts.woo !== false) {
    await db.insert(storeConnections).values({
      siteId: site.id,
      platform: "woocommerce",
      storeUrl: "https://milianjo.com",
      consumerKey: "ck_x",
      consumerSecretEnc: "x",
      verifiedAt: new Date(),
    });
  }
  return site;
}

const since = async (siteId: string) =>
  (await db.select({ s: sites.buyerEmailsSince, m: sites.buyerEmails }).from(sites).where(eq(sites.id, siteId)))[0];

let n = 0;
async function buyer(siteId: string, email: string) {
  n++;
  const [b] = await db
    .insert(buyers)
    .values({ siteId, email, firstName: "Maria", status: "subscribed", token: `t${n}`.padEnd(43, "x"), ref: `r${n}`.padEnd(22, "y") })
    .returning();
  return b;
}
async function order(siteId: string, buyerId: string, ext: string, names: string[]) {
  const [o] = await db
    .insert(buyerOrders)
    .values({ siteId, buyerId, externalId: ext, orderedAt: new Date("2026-11-01T10:00:00Z"), items: names.map((name, i) => ({ productId: i, name, url: null })) })
    .returning();
  return o;
}
async function mail(siteId: string, b: { id: string }, o: { id: string }, over: Partial<typeof buyerEmails.$inferInsert> = {}) {
  const [m] = await db
    .insert(buyerEmails)
    .values({ siteId, buyerId: b.id, orderId: o.id, step: 1, status: "draft", subject: "Tips", body: "Hello", language: "en", scheduledFor: new Date("2026-11-06T10:00:00Z"), ...over })
    .returning();
  return m;
}

describe("setBuyerEmails", () => {
  it("needs a verified sending domain, then WooCommerce", async () => {
    const site = await setup({ verified: false, woo: false });
    await expect(setBuyerEmails(site.id, "approval")).rejects.toThrow("Verify your sending domain first.");
    await db.update(sites).set({ sendingDomainStatus: "verified" }).where(eq(sites.id, site.id));
    await expect(setBuyerEmails(site.id, "approval")).rejects.toThrow("Connect WooCommerce first.");
    expect((await since(site.id)).m).toBe("off");
  });

  it("automatic needs a plan that allows it", async () => {
    const site = await setup({ plan: "starter" });
    await expect(setBuyerEmails(site.id, "automatic")).rejects.toBeInstanceOf(ValidationError);
    await setBuyerEmails(site.id, "approval");
    expect((await since(site.id)).m).toBe("approval");
  });

  it("rejects an unknown mode", async () => {
    const site = await setup();
    await expect(setBuyerEmails(site.id, "sometimes")).rejects.toBeInstanceOf(ValidationError);
  });

  it("resets buyerEmailsSince on every switch-on from off, and only then", async () => {
    const site = await setup();
    const t1 = new Date("2026-11-01T00:00:00Z");
    const t2 = new Date("2026-11-05T00:00:00Z");
    const t3 = new Date("2026-11-09T00:00:00Z");
    await setBuyerEmails(site.id, "approval", t1);
    expect((await since(site.id)).s).toEqual(t1);
    await setBuyerEmails(site.id, "automatic", t2);
    expect((await since(site.id)).s).toEqual(t1);
    await setBuyerEmails(site.id, "approval", t2);
    expect((await since(site.id)).s).toEqual(t1);
    await setBuyerEmails(site.id, "off", t2);
    expect((await since(site.id)).s).toEqual(t1);
    await setBuyerEmails(site.id, "automatic", t3);
    expect((await since(site.id)).s).toEqual(t3);
  });
});

describe("buyer drafts", () => {
  it("approving sets scheduledFor to now", async () => {
    const site = await setup();
    const b = await buyer(site.id, "maria@example.com");
    const o = await order(site.id, b.id, "1", ["Oil"]);
    const m = await mail(site.id, b, o);
    const now = new Date("2026-11-11T12:00:00Z");
    await approveBuyerDraft(site.id, m.id, now);
    const [row] = await db.select().from(buyerEmails).where(eq(buyerEmails.id, m.id));
    expect(row.status).toBe("approved");
    expect(row.scheduledFor).toEqual(now);
  });

  it("editing scrubs addresses and off-site links and recomputes links", async () => {
    const site = await setup();
    const b = await buyer(site.id, "maria@example.com");
    const o = await order(site.id, b.id, "1", ["Oil"]);
    const m = await mail(site.id, b, o, { links: ["https://milianjo.com/old"] });
    await updateBuyerDraft(site.id, m.id, {
      subject: "Write to bob@example.com [now](https://evil.com/x)",
      body: "Hi\n\nSee [guide](https://milianjo.com/guide) and [bad](https://evil.com/p), mail bob@example.com. https://evil.com/q",
    });
    const [row] = await db.select().from(buyerEmails).where(eq(buyerEmails.id, m.id));
    expect(row.links).toEqual(["https://milianjo.com/guide"]);
    expect(row.body).toContain("[guide](https://milianjo.com/guide)");
    expect(row.body).not.toMatch(/evil|bob@/);
    expect(row.subject).not.toMatch(/evil|bob@|https?:/);
    expect(row.subject.length).toBeGreaterThan(0);
  });

  it("only drafts can be changed, and only on the caller's site", async () => {
    const site = await setup();
    const other = await makeSite((await makeAccount()).id);
    const b = await buyer(site.id, "maria@example.com");
    const o = await order(site.id, b.id, "1", ["Oil"]);
    const sent = await mail(site.id, b, o, { status: "sent" });
    await expect(discardBuyerDraft(site.id, sent.id)).rejects.toBeInstanceOf(ValidationError);
    const m = await mail(site.id, b, o, { step: 2 });
    await expect(discardBuyerDraft(other.id, m.id)).rejects.toThrow("Email not found");
    expect(await listBuyerQueue(other.id)).toHaveLength(0);
    expect(await listBuyerQueue(site.id)).toHaveLength(1);
  });
});

describe("Buyers page and actions", () => {
  const render = async (siteId: string, tab?: string) =>
    renderToStaticMarkup(
      await BuyersPage({ params: Promise.resolve({ siteId }), searchParams: Promise.resolve(tab ? { tab } : {}) } as never),
    );

  it("lists buyers with order count, products, sequence status and rating", async () => {
    const site = await setup();
    const b = await buyer(site.id, "maria@example.com");
    const o1 = await order(site.id, b.id, "1", ["Argan Oil", "Shampoo"]);
    await order(site.id, b.id, "2", ["Argan Oil"]);
    const m = await mail(site.id, b, o1, { status: "sent", sentAt: new Date("2026-11-06T10:00:00Z") });
    await db.insert(buyerFeedback).values({ siteId: site.id, buyerEmailId: m.id, rating: 4, comment: "Lovely <b>stuff</b>" });
    await mail(site.id, b, o1, { step: 2, status: "scheduled" });
    const html = await render(site.id);
    expect(html).toContain("maria@example.com");
    expect(html).toContain("Argan Oil, Shampoo");
    expect(html).toContain("Email 2: scheduled");
    expect(html).toContain("4 / 5");
    const fb = await render(site.id, "feedback");
    expect(fb).toContain("4 / 5");
    expect(fb).toContain("Lovely &lt;b&gt;stuff&lt;/b&gt;");
    expect(await render(site.id, "sent")).toContain("maria@example.com");
  });

  it("shows the queue and approves through the action", async () => {
    const site = await setup();
    const b = await buyer(site.id, "maria@example.com");
    const o = await order(site.id, b.id, "1", ["Oil"]);
    const m = await mail(site.id, b, o);
    expect(await render(site.id, "queue")).toContain("To maria@example.com");
    const fd = new FormData();
    fd.set("subject", "New subject");
    fd.set("body", "New body");
    expect(await approveBuyerDraftAction(site.id, m.id, {}, fd)).toEqual({ saved: true });
    const [row] = await db.select().from(buyerEmails).where(eq(buyerEmails.id, m.id));
    expect([row.status, row.subject]).toEqual(["approved", "New subject"]);
  });

  it("another account gets a 404 on the page and the actions", async () => {
    const site = await setup();
    const b = await buyer(site.id, "maria@example.com");
    const o = await order(site.id, b.id, "1", ["Oil"]);
    const m = await mail(site.id, b, o);
    const u = await makeUser();
    await makeMembership((await makeAccount()).id, u.id);
    current.user = { id: u.id, email: u.email, emailVerified: true };
    await expect(render(site.id)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(discardBuyerDraftAction(site.id, m.id)).rejects.toThrow("NEXT_NOT_FOUND");
    const fd = new FormData();
    fd.set("buyerEmails", "approval");
    await expect(saveBuyerEmailsAction(site.id, {}, fd)).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await since(site.id)).m).toBe("off");
  });

  it("the settings action reports the error messages", async () => {
    const site = await setup({ woo: false });
    const fd = new FormData();
    fd.set("buyerEmails", "approval");
    expect(await saveBuyerEmailsAction(site.id, {}, fd)).toEqual({ error: "Connect WooCommerce first." });
  });
});
