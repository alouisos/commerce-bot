import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeLead, makeMembership, makeMessage, makeSite, makeUser } from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "", emailVerified: true } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {} }),
}));

import OverviewPage from "@/app/app/sites/[siteId]/overview/page";
import WebsitesPage from "@/app/app/page";

beforeEach(resetDb);

async function signedInSite() {
  const u = await makeUser();
  const account = await makeAccount();
  await makeMembership(account.id, u.id);
  current.user = { id: u.id, email: u.email, emailVerified: true };
  return makeSite(account.id, { name: "Shop" });
}

const render = async (siteId: string, range?: string) =>
  renderToStaticMarkup(
    await OverviewPage({
      params: Promise.resolve({ siteId }),
      searchParams: Promise.resolve(range ? { range } : {}),
    } as never),
  );

/** The text of a stat tile: its label followed by its value. */
const tile = (html: string, label: string) => new RegExp(`${label}</dt><dd[^>]*>([^<]*)<`).exec(html)?.[1];

describe("site overview", () => {
  it("shows the headline numbers for the site", async () => {
    const site = await signedInSite();
    const withLead = await makeConversation(site.id, { firstPageUrl: "https://example.com/shampoo" });
    await makeMessage(withLead.id);
    await makeLead(site.id, { conversationId: withLead.id });
    const unanswered = await makeConversation(site.id);
    await makeMessage(unanswered.id);
    await makeMessage(unanswered.id, { role: "bot", kind: "fallback", content: "Sorry" });
    const plain = await makeConversation(site.id);
    await makeMessage(plain.id);
    await makeMessage(plain.id, { content: "again" });

    const html = await render(site.id);
    expect(tile(html, "Conversations")).toBe("3");
    expect(tile(html, "Emails captured")).toBe("1");
    expect(tile(html, "Unanswered")).toBe("1");
    expect(tile(html, "Sales")).toBe("0");
    expect(html).toContain("Connect WooCommerce in Settings to see amounts.");
    expect(html).toContain("Average messages per conversation: 1.3");
    expect(html).toContain('href="https://example.com/shampoo"');
    expect(html).toContain('id="insights"');
  });

  it("an empty site shows zeros, no average and an all-zero chart", async () => {
    const site = await signedInSite();
    const html = await render(site.id, "7d");
    expect(tile(html, "Conversations")).toBe("0");
    expect(html).toContain("Average messages per conversation: –");
    expect(html).toContain("Conversations per day (UTC)");
    expect(html).toContain("<svg");
    expect((html.match(/<th scope="row">\d{4}-\d{2}-\d{2}<\/th><td>0<\/td>/g) ?? []).length).toBe(7);
    expect(html).toContain('aria-current="page"');
  });

  it("another account's site is not found", async () => {
    const other = await makeSite((await makeAccount()).id);
    await signedInSite();
    await expect(render(other.id)).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("the websites list shows 30-day numbers per site", async () => {
    const site = await signedInSite();
    for (let i = 0; i < 3; i++) await makeConversation(site.id);
    await makeLead(site.id);
    const html = renderToStaticMarkup(await WebsitesPage());
    expect(html).toContain("Last 30 days: 3 conversations · 1 email captured");
    expect(html).toContain(`href="/app/sites/${site.id}/overview"`);
  });
});
