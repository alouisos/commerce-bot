import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db/client";
import { contacts, emailMessages, sales } from "@/db/schema";
import { getSalesTotals } from "@/lib/stats/sales";
import { parseRange } from "@/lib/stats/range";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeMembership, makeMessage, makeSite, makeUser } from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import OverviewPage from "@/app/app/sites/[siteId]/overview/page";
import ConversationsPage from "@/app/app/sites/[siteId]/conversations/page";
import ConversationPage from "@/app/app/sites/[siteId]/conversations/[conversationId]/page";
import EmailsPage from "@/app/app/sites/[siteId]/emails/page";

beforeEach(resetDb);

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

async function setup() {
  const u = await makeUser();
  const account = await makeAccount({ plan: "starter" });
  await makeMembership(account.id, u.id);
  current.user = { id: u.id, email: u.email };
  const site = await makeSite(account.id);
  const withSale = await makeConversation(site.id, { visitorSessionId: "sid_a_1" });
  await makeMessage(withSale.id, { content: "Which shampoo?" });
  const plain = await makeConversation(site.id, { visitorSessionId: "sid_b_1" });
  await makeMessage(plain.id, { content: "Just browsing" });
  const [contact] = await db
    .insert(contacts)
    .values({
      siteId: site.id,
      email: "m@example.com",
      language: "en",
      status: "subscribed",
      consentText: "x",
      consentLanguage: "en",
      consentedAt: hoursAgo(100),
      token: "t".repeat(43),
      ref: "r".repeat(22),
    })
    .returning();
  const [mail] = await db
    .insert(emailMessages)
    .values({ siteId: site.id, contactId: contact.id, step: 1, status: "sent", subject: "Your routine", body: "b", language: "en", scheduledFor: hoursAgo(50), sentAt: hoursAgo(50) })
    .returning();
  const base = { siteId: site.id, visitorSessionId: "sid_a_1" };
  await db.insert(sales).values([
    { ...base, source: "woocommerce", externalId: "1234", verified: true, amountMinor: 3490, currency: "EUR", orderedAt: hoursAgo(2), pageUrl: "https://example.com/o/1234", viaChat: true, conversationId: withSale.id },
    { ...base, source: "woocommerce", externalId: "1235", verified: true, amountMinor: 1000, currency: "EUR", orderedAt: hoursAgo(3), pageUrl: "https://example.com/o/1235", viaEmail: true, viaPrompt: true, contactId: contact.id, emailMessageId: mail.id },
    { ...base, source: "page", externalId: null, verified: false, orderedAt: hoursAgo(4), pageUrl: "https://example.com/thank-you", viaChat: true },
    { ...base, source: "page", externalId: null, verified: false, orderedAt: hoursAgo(24 * 60), pageUrl: "https://example.com/old", viaChat: true },
  ]);
  const other = await makeSite((await makeAccount()).id);
  await db.insert(sales).values({ siteId: other.id, visitorSessionId: "x", source: "page", verified: false, orderedAt: hoursAgo(1), pageUrl: "https://other.com/t", viaChat: true });
  return { site, withSale, plain, mail };
}

describe("sales in the admin", () => {
  it("totals by range: count, ways, revenue per currency and sales without an amount", async () => {
    const { site } = await setup();
    expect(await getSalesTotals([site.id], parseRange("30d"))).toEqual({
      count: 3,
      viaChat: 2,
      viaPrompt: 1,
      viaEmail: 1,
      revenue: [{ currency: "EUR", minor: 4490 }],
      withoutAmount: 1,
    });
  });

  it("the overview shows the sales tile", async () => {
    const { site } = await setup();
    const html = renderToStaticMarkup(
      await OverviewPage({ params: Promise.resolve({ siteId: site.id }), searchParams: Promise.resolve({}) } as never),
    );
    expect(html).toContain("€44.90");
    expect(html).toContain("2 after a chat");
    expect(html).toContain("1 from a suggestion");
    expect(html).toContain("1 from an email");
    expect(html).toContain("1 without an amount");
  });

  it("with no sales and no connection, the tile points to Settings", async () => {
    const u = await makeUser();
    const account = await makeAccount();
    await makeMembership(account.id, u.id);
    current.user = { id: u.id, email: u.email };
    const site = await makeSite(account.id);
    const html = renderToStaticMarkup(
      await OverviewPage({ params: Promise.resolve({ siteId: site.id }), searchParams: Promise.resolve({}) } as never),
    );
    expect(html).toContain("Connect WooCommerce in Settings to see amounts.");
  });

  it("conversations can be filtered to those a sale followed", async () => {
    const { site } = await setup();
    const html = renderToStaticMarkup(
      await ConversationsPage({
        params: Promise.resolve({ siteId: site.id }),
        searchParams: Promise.resolve({ filter: "sale" }),
      } as never),
    );
    expect(html).toContain("Which shampoo?");
    expect(html).not.toContain("Just browsing");
    expect(html).toContain("Sale followed");
  });

  it("the conversation shows the sale", async () => {
    const { site, withSale, plain } = await setup();
    const render = async (id: string) =>
      renderToStaticMarkup(
        await ConversationPage({ params: Promise.resolve({ siteId: site.id, conversationId: id }) } as never),
      );
    expect(await render(withSale.id)).toContain("Sale followed: €34.90 · order #1234");
    expect(await render(plain.id)).not.toContain("Sale followed");
  });

  it("sent emails show the sales they led to", async () => {
    const { site } = await setup();
    const html = renderToStaticMarkup(
      await EmailsPage({ params: Promise.resolve({ siteId: site.id }), searchParams: Promise.resolve({ tab: "sent" }) } as never),
    );
    expect(html).toContain("<th>Sales</th>");
    expect(html).toMatch(/Your routine<\/td><td>0<\/td><td>1<\/td>/);
  });
});
