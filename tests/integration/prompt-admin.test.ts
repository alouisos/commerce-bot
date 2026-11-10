import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { resetDb } from "../helpers/db";
import {
  makeAccount,
  makeConversation,
  makeImpression,
  makeMembership,
  makeMessage,
  makeSite,
  makeUser,
} from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "", emailVerified: true } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {} }),
}));

import OverviewPage from "@/app/app/sites/[siteId]/overview/page";
import ConversationsPage from "@/app/app/sites/[siteId]/conversations/page";
import ConversationPage from "@/app/app/sites/[siteId]/conversations/[conversationId]/page";

beforeEach(resetDb);

async function memberSite(overrides: Parameters<typeof makeSite>[1] = {}) {
  const u = await makeUser();
  const account = await makeAccount();
  await makeMembership(account.id, u.id);
  current.user = { id: u.id, email: u.email, emailVerified: true };
  return makeSite(account.id, overrides);
}

const overview = async (siteId: string) =>
  renderToStaticMarkup(
    await OverviewPage({ params: Promise.resolve({ siteId }), searchParams: Promise.resolve({}) } as never),
  );

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

describe("suggestion performance", () => {
  it("shows shown, tapped, dismissed and the rates per type", async () => {
    const site = await memberSite();
    await makeImpression(site.id, { shownAt: hoursAgo(1), outcome: "tapped" });
    await makeImpression(site.id, { shownAt: hoursAgo(1), outcome: "dismissed" });
    await makeImpression(site.id, { shownAt: hoursAgo(1), outcome: "dismissed" });
    await makeImpression(site.id, { shownAt: hoursAgo(1) });
    const html = await overview(site.id);
    expect(html).toContain("Suggestions");
    expect(html).toMatch(/Questions about the page<\/td><td>4<\/td><td>1<\/td><td>2<\/td><td>25%<\/td><td>50%<\/td>/);
    expect(html).toMatch(/Pairing suggestions<\/td><td>0<\/td><td>0<\/td><td>0<\/td><td>–<\/td><td>–<\/td>/);
  });

  it("says when a type is paused, also in insights", async () => {
    const site = await memberSite();
    for (let i = 0; i < 20; i++) await makeImpression(site.id, { kind: "pairing", shownAt: hoursAgo(2), outcome: "dismissed" });
    const html = await overview(site.id);
    expect(html).toContain("Paused");
    expect(html).toContain("Visitors kept dismissing pairing suggestions, so the bot has paused them.");
    expect(html).toContain("Prompts visitors keep dismissing");
  });

  it("explains when suggestions are off", async () => {
    const site = await memberSite({ proactivity: "off" });
    const html = await overview(site.id);
    expect(html).toContain("Suggestions are off for this website.");
    expect(html).toContain(`href="/app/sites/${site.id}/settings"`);
  });
});

describe("conversation context", () => {
  async function seeded() {
    const site = await memberSite();
    const imp = await makeImpression(site.id, { text: "Want to know why?", kind: "pairing", outcome: "tapped" });
    const conv = await makeConversation(site.id, {
      intent: "buying",
      intentConfidence: 0.85,
      promptImpressionId: imp.id,
      visit: {
        intent: "buying",
        confidence: 0.85,
        pages: [
          { url: "https://example.com/product/shampoo/", title: "Shampoo page", seconds: 40 },
          { url: "javascript:alert(1)", title: "Odd page", seconds: 3 },
        ],
        addedToCart: true,
        cartSeen: false,
      },
    });
    await makeMessage(conv.id, { content: "Why?" });
    return { site, conv };
  }

  it("the transcript page shows intent, the starting suggestion and the pages", async () => {
    const { site, conv } = await seeded();
    const html = renderToStaticMarkup(
      await ConversationPage({ params: Promise.resolve({ siteId: site.id, conversationId: conv.id }) } as never),
    );
    expect(html).toContain("Ready to buy (85%)");
    expect(html).toContain("Started from a suggestion: “Want to know why?”");
    expect(html).toContain('href="https://example.com/product/shampoo/"');
    expect(html).toContain("Shampoo page");
    expect(html).toContain("Odd page");
    expect(html).not.toContain('href="javascript:');
  });

  it("the list shows each conversation's intent", async () => {
    const { site } = await seeded();
    const html = renderToStaticMarkup(
      await ConversationsPage({ params: Promise.resolve({ siteId: site.id }), searchParams: Promise.resolve({}) } as never),
    );
    expect(html).toContain("<th>Intent</th>");
    expect(html).toContain("Ready to buy");
  });
});
