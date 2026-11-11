import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeLead, makeMembership, makeMessage, makeSite, makeUser } from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "", emailVerified: true } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));

import { getConversation } from "@/lib/conversations/detail";
import ConversationPage from "@/app/app/sites/[siteId]/conversations/[conversationId]/page";
import LeadsPage from "@/app/app/sites/[siteId]/leads/page";

beforeEach(resetDb);

async function setup() {
  const accA = await makeAccount();
  const userA = await makeUser();
  await makeMembership(accA.id, userA.id);
  const siteA = await makeSite(accA.id, { botName: "Mia" });
  const accB = await makeAccount();
  const userB = await makeUser();
  await makeMembership(accB.id, userB.id);
  const siteB = await makeSite(accB.id);
  const convA = await makeConversation(siteA.id, { firstPageUrl: "https://example.com/shampoo" });
  await makeMessage(convA.id, { content: "Do you ship to Cyprus?", createdAt: new Date("2026-11-10T10:00:00Z") });
  await makeMessage(convA.id, {
    role: "bot",
    content: "<img src=x onerror=alert(1)>",
    createdAt: new Date("2026-11-10T10:00:01Z"),
  });
  await makeMessage(convA.id, {
    role: "bot",
    kind: "fallback",
    content: "I'm not sure. Leave your email?",
    createdAt: new Date("2026-11-10T10:00:02Z"),
  });
  const convB = await makeConversation(siteB.id);
  return { userA, userB, siteA, siteB, convA, convB };
}

const render = async (siteId: string, conversationId: string) =>
  renderToStaticMarkup(
    await ConversationPage({ params: Promise.resolve({ siteId, conversationId }) } as never),
  );

async function digestOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return (e as { digest?: string }).digest;
  }
  return undefined;
}

describe("getConversation", () => {
  it("returns the transcript oldest first with its leads", async () => {
    const { siteA, convA } = await setup();
    const lead = await makeLead(siteA.id, { conversationId: convA.id });
    const out = await getConversation(siteA.id, convA.id);
    expect(out?.conversation.id).toBe(convA.id);
    expect(out?.messages.map((m) => m.content)).toEqual([
      "Do you ship to Cyprus?",
      "<img src=x onerror=alert(1)>",
      "I'm not sure. Leave your email?",
    ]);
    expect(out?.leads.map((l) => l.id)).toEqual([lead.id]);
  });

  it("is null for another site's conversation or a malformed id", async () => {
    const { siteA, convB } = await setup();
    expect(await getConversation(siteA.id, convB.id)).toBeNull();
    expect(await getConversation(siteA.id, "not-a-uuid")).toBeNull();
  });
});

describe("conversation page", () => {
  it("shows the transcript as plain text, labelled, with no email captured", async () => {
    const { userA, siteA, convA } = await setup();
    current.user = { id: userA.id, email: userA.email, emailVerified: true };
    const html = await render(siteA.id, convA.id);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("Visitor");
    expect(html).toContain("Mia");
    expect(html).toContain("Couldn&#x27;t answer");
    expect(html).toContain("No email captured");
    expect(html).toContain('href="https://example.com/shampoo"');
    expect(html).toContain(`href="/app/sites/${siteA.id}/conversations"`);
  });

  it("renders a bot reply's bold and keeps visitor text plain", async () => {
    const { userA, siteA, convA } = await setup();
    await makeMessage(convA.id, { role: "bot", content: "**Yes**", createdAt: new Date("2026-11-10T10:00:03Z") });
    await makeMessage(convA.id, { content: "**no**", createdAt: new Date("2026-11-10T10:00:04Z") });
    current.user = { id: userA.id, email: userA.email, emailVerified: true };
    const html = await render(siteA.id, convA.id);
    expect(html).toContain("<strong>Yes</strong>");
    expect(html).toContain("**no**");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
  });

  it("shows a captured email", async () => {
    const { userA, siteA, convA } = await setup();
    await makeLead(siteA.id, { conversationId: convA.id, email: "maria@example.com" });
    current.user = { id: userA.id, email: userA.email, emailVerified: true };
    expect(await render(siteA.id, convA.id)).toContain("maria@example.com");
  });

  it("is not found for another account, another site's conversation, or a bad id", async () => {
    const { userA, userB, siteA, siteB, convA, convB } = await setup();
    current.user = { id: userB.id, email: userB.email, emailVerified: true };
    expect(await digestOf(render(siteA.id, convA.id))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(await digestOf(render(siteB.id, convA.id))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    current.user = { id: userA.id, email: userA.email, emailVerified: true };
    expect(await digestOf(render(siteA.id, convB.id))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(await digestOf(render(siteA.id, "not-a-uuid"))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});

describe("leads page", () => {
  it("links each lead to its conversation", async () => {
    const { userA, siteA, convA } = await setup();
    await makeLead(siteA.id, { conversationId: convA.id });
    await makeLead(siteA.id);
    current.user = { id: userA.id, email: userA.email, emailVerified: true };
    const html = renderToStaticMarkup(await LeadsPage({ params: Promise.resolve({ siteId: siteA.id }) } as never));
    expect(html).toContain(`href="/app/sites/${siteA.id}/conversations/${convA.id}"`);
    expect((html.match(/>View</g) ?? []).length).toBe(1);
  });
});
