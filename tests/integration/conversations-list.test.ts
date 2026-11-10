import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeLead, makeMembership, makeMessage, makeSite, makeUser } from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "", emailVerified: true } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));

import { listConversations, PAGE_SIZE } from "@/lib/conversations/list";
import { parseRange } from "@/lib/stats/range";
import ConversationsPage from "@/app/app/sites/[siteId]/conversations/page";

beforeEach(resetDb);

// "Now" a minute ahead, so rows made during a test fall inside the range.
const range = parseRange("30d", new Date(Date.now() + 60_000));

async function sites() {
  const account = await makeAccount();
  const a = await makeSite(account.id);
  const b = await makeSite((await makeAccount()).id);
  return { account, a, b };
}

async function conv(siteId: string, visitor: string, bot = "Happy to help", minutesAgo = 0) {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  const c = await makeConversation(siteId, { createdAt: at, lastMessageAt: at });
  await makeMessage(c.id, { content: visitor });
  await makeMessage(c.id, { role: "bot", content: bot });
  return c;
}

describe("listConversations", () => {
  it("pages 25 at a time, newest first, and clamps the page", async () => {
    const { a } = await sites();
    for (let i = 0; i < 30; i++) await conv(a.id, `question ${i}`, "ok", i);
    const p1 = await listConversations(a.id, { range });
    expect(PAGE_SIZE).toBe(25);
    expect(p1.rows).toHaveLength(25);
    expect(p1.total).toBe(30);
    expect(p1.pageCount).toBe(2);
    expect(p1.rows[0].preview).toBe("question 0");
    expect((await listConversations(a.id, { range, page: 2 })).rows).toHaveLength(5);
    const clamped = await listConversations(a.id, { range, page: 99 });
    expect(clamped.page).toBe(2);
    expect(clamped.rows).toHaveLength(5);
    expect((await listConversations(a.id, { range, page: -3 })).page).toBe(1);
  });

  it("an empty site has one empty page", async () => {
    const { a } = await sites();
    expect(await listConversations(a.id, { range })).toEqual({ rows: [], total: 0, page: 1, pageCount: 1 });
  });

  it("filters by email captured and by unanswered", async () => {
    const { a } = await sites();
    const withEmail = await conv(a.id, "email me");
    await makeLead(a.id, { conversationId: withEmail.id });
    const unanswered = await conv(a.id, "what about x");
    await makeMessage(unanswered.id, { role: "bot", kind: "fallback", content: "Sorry" });
    await makeMessage(unanswered.id, { role: "bot", kind: "fallback", content: "Sorry again" });
    await conv(a.id, "plain");

    const email = await listConversations(a.id, { range, filter: "email" });
    expect(email.rows.map((r) => r.id)).toEqual([withEmail.id]);
    expect(email.rows[0].hasEmail).toBe(true);
    const un = await listConversations(a.id, { range, filter: "unanswered" });
    expect(un.rows.map((r) => r.id)).toEqual([unanswered.id]);
    expect(un.rows[0]).toMatchObject({ unanswered: true, visitorMessages: 1 });
    expect((await listConversations(a.id, { range, filter: "all" })).total).toBe(3);
  });

  it("search matches any message, literally", async () => {
    const { a } = await sites();
    const byBot = await conv(a.id, "hello", "This one is for dry hair.");
    const percent = await conv(a.id, "Is it 100% natural?");
    await conv(a.id, "100 grams please");
    await conv(a.id, "plain_text and back\\slash");

    expect((await listConversations(a.id, { range, q: "  dry hair " })).rows.map((r) => r.id)).toEqual([byBot.id]);
    expect((await listConversations(a.id, { range, q: "100%" })).rows.map((r) => r.id)).toEqual([percent.id]);
    expect((await listConversations(a.id, { range, q: "_" })).total).toBe(1);
    expect((await listConversations(a.id, { range, q: "\\" })).total).toBe(1);
    expect((await listConversations(a.id, { range, q: "%" })).total).toBe(1);
    expect((await listConversations(a.id, { range, q: "it's \"quoted\"" })).total).toBe(0);
    expect((await listConversations(a.id, { range, q: "x".repeat(5000) })).total).toBe(0);
    // Postgres rejects NUL in text parameters; a hand-edited ?q=%00 must not 500.
    expect((await listConversations(a.id, { range, q: "100\u0000%" })).rows.map((r) => r.id)).toEqual([percent.id]);
  });

  it("never returns another site's conversations", async () => {
    const { a, b } = await sites();
    await conv(b.id, "dry hair");
    expect((await listConversations(a.id, { range, q: "dry hair" })).total).toBe(0);
    expect((await listConversations(a.id, { range })).total).toBe(0);
  });

  it("cuts long previews", async () => {
    const { a } = await sites();
    await conv(a.id, "y".repeat(300));
    const [row] = (await listConversations(a.id, { range })).rows;
    expect(row.preview).toBe(`${"y".repeat(140)}…`);
  });
});

describe("conversations page", () => {
  it("lists rows linking to the transcript and keeps the query in page links", async () => {
    const { account, a } = await sites();
    const u = await makeUser();
    await makeMembership(account.id, u.id);
    current.user = { id: u.id, email: u.email, emailVerified: true };
    for (let i = 0; i < 26; i++) await conv(a.id, `dry hair ${i}`, "ok", i);
    const html = renderToStaticMarkup(
      await ConversationsPage({
        params: Promise.resolve({ siteId: a.id }),
        searchParams: Promise.resolve({ q: "dry", range: "7d" }),
      } as never),
    );
    expect(html).toMatch(new RegExp(`href="/app/sites/${a.id}/conversations/[0-9a-f-]{36}"`));
    expect(html).toContain("q=dry");
    expect(html).toContain("page=2");
    expect(html).toContain('value="dry"');
    expect(html).toContain('name="range" value="7d"');
  });

  it("says when nothing matches", async () => {
    const { account, a } = await sites();
    const u = await makeUser();
    await makeMembership(account.id, u.id);
    current.user = { id: u.id, email: u.email, emailVerified: true };
    const html = renderToStaticMarkup(
      await ConversationsPage({ params: Promise.resolve({ siteId: a.id }), searchParams: Promise.resolve({}) } as never),
    );
    expect(html).toContain("No conversations match.");
  });
});
