import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db/client";
import { contacts, conversations, emailMessages } from "@/db/schema";
import type { ModelReply } from "@/lib/chat/model";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeSite } from "../helpers/factories";

vi.mock("@/lib/chat/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/model")>();
  return {
    ...actual,
    streamModelReply: (): ModelReply => {
      async function* textStream() {
        yield "Hello";
      }
      return {
        textStream: textStream(),
        done: Promise.resolve({
          text: "Hello",
          model: "claude-opus-5-5",
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        }),
      };
    },
  };
});
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: () => {},
}));

import { POST as chatPOST } from "@/app/api/widget/chat/route";
import { GET as clickGET } from "@/app/e/c/[messageId]/[index]/route";
import { GET as oneClickGET, POST as oneClickPOST } from "@/app/e/u/[token]/one-click/route";
import UnsubscribePage from "@/app/e/u/[token]/page";
import { unsubscribeAction } from "@/app/e/u/[token]/actions";

beforeEach(resetDb);

let n = 0;
async function contactOn(siteId: string, over: Partial<typeof contacts.$inferInsert> = {}) {
  n++;
  const [c] = await db
    .insert(contacts)
    .values({
      siteId,
      email: `p${n}@example.com`,
      language: "en",
      status: "subscribed",
      consentText: "x",
      consentLanguage: "en",
      consentedAt: new Date(),
      confirmedAt: new Date(),
      token: `token${n}`.padEnd(43, "x"),
      ref: `ref${n}`.padEnd(22, "y"),
      ...over,
    })
    .returning();
  return c;
}

async function setup() {
  const account = await makeAccount({ plan: "starter" });
  const site = await makeSite(account.id, { name: "Milian Jo", baseUrl: "https://milianjo.com" });
  const convo = await makeConversation(site.id);
  const a = await contactOn(site.id, { sequenceConversationId: convo.id });
  const b = await contactOn(site.id);
  const msg = async (contactId: string, status: "draft" | "sent" | "approved" = "sent") =>
    (
      await db
        .insert(emailMessages)
        .values({
          siteId: site.id,
          contactId,
          conversationId: convo.id,
          step: 1,
          status,
          subject: "s",
          body: "b",
          language: "en",
          links: ["https://milianjo.com/product/shampoo/", "https://milianjo.com/p?x=1#top"],
          scheduledFor: new Date(),
        })
        .returning()
    )[0];
  return { site, convo, a, b, msg };
}

const reload = async (id: string) => (await db.select().from(contacts).where(eq(contacts.id, id)))[0];
const statusOf = async (id: string) => (await db.select().from(emailMessages).where(eq(emailMessages.id, id)))[0];
const oneClick = (token: string) =>
  oneClickPOST(
    new Request(`http://localhost:3000/e/u/${token}/one-click`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    }),
    { params: Promise.resolve({ token }) },
  );

describe("unsubscribe", () => {
  it("one-click POST unsubscribes and discards the queued email; repeating is harmless", async () => {
    const { a, msg } = await setup();
    const draft = await msg(a.id, "draft");
    const res = await oneClick(a.token);
    expect(res.status).toBe(200);
    const c = await reload(a.id);
    expect(c.status).toBe("unsubscribed");
    expect(c.unsubscribedAt).toBeInstanceOf(Date);
    expect((await statusOf(draft.id)).status).toBe("discarded");
    expect((await oneClick(a.token)).status).toBe(200);
    expect((await reload(a.id)).unsubscribedAt).toEqual(c.unsubscribedAt);
  });

  it("an unknown token is answered the same way and changes nothing", async () => {
    const { a } = await setup();
    expect((await oneClick("no-such-token-at-all-000000")).status).toBe(200);
    expect((await reload(a.id)).status).toBe("subscribed");
  });

  it("a GET of the one-click address or the page never unsubscribes", async () => {
    const { a } = await setup();
    const res = await oneClickGET(new Request(`http://localhost:3000/e/u/${a.token}/one-click`), {
      params: Promise.resolve({ token: a.token }),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`http://localhost:3000/e/u/${a.token}`);
    const html = renderToStaticMarkup(await UnsubscribePage({ params: Promise.resolve({ token: a.token }) } as never));
    expect(html).toContain("Unsubscribe");
    expect(html).toContain("Stop receiving emails from Milian Jo?");
    expect((await reload(a.id)).status).toBe("subscribed");
  });

  it("the page's button unsubscribes, then the page says so (in Greek for el)", async () => {
    const { site } = await setup();
    const c = await contactOn(site.id, { language: "el" });
    await unsubscribeAction(c.token);
    expect((await reload(c.id)).status).toBe("unsubscribed");
    const html = renderToStaticMarkup(await UnsubscribePage({ params: Promise.resolve({ token: c.token }) } as never));
    expect(html).toContain("Διαγραφήκατε από το Milian Jo.");
  });

  it("contact A's token only affects A", async () => {
    const { a, b, msg } = await setup();
    const bDraft = await msg(b.id, "approved");
    await oneClick(a.token);
    expect((await reload(b.id)).status).toBe("subscribed");
    expect((await statusOf(bDraft.id)).status).toBe("approved");
  });
});

describe("click tracking", () => {
  const click = (id: string, index: string) =>
    clickGET(new Request(`http://localhost:3000/e/c/${id}/${index}`), { params: Promise.resolve({ messageId: id, index }) });

  it("redirects to the stored link with the contact's ref, and counts the click", async () => {
    const { a, msg } = await setup();
    const m = await msg(a.id);
    const res = await click(m.id, "0");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`https://milianjo.com/product/shampoo/?cc_ref=${a.ref}`);
    const row = await statusOf(m.id);
    expect(row.clicks).toBe(1);
    expect(row.clickedAt).toBeInstanceOf(Date);
    await click(m.id, "0");
    const again = await statusOf(m.id);
    expect(again.clicks).toBe(2);
    expect(again.clickedAt).toEqual(row.clickedAt);
    const second = await click(m.id, "1");
    expect(second.headers.get("Location")).toBe(`https://milianjo.com/p?x=1&cc_ref=${a.ref}#top`);
  });

  it("404s for an unknown index or message", async () => {
    const { a, msg } = await setup();
    const m = await msg(a.id);
    expect((await click(m.id, "7")).status).toBe(404);
    expect((await click(m.id, "-1")).status).toBe(404);
    expect((await click(m.id, "abc")).status).toBe(404);
    expect((await click("not-a-uuid", "0")).status).toBe(404);
    expect((await click("00000000-0000-4000-8000-000000000000", "0")).status).toBe(404);
  });

  it("an unsent draft's links aren't reachable", async () => {
    const { a, msg } = await setup();
    const m = await msg(a.id, "draft");
    expect((await click(m.id, "0")).status).toBe(404);
  });
});

describe("return attribution", () => {
  const page = {
    url: "https://example.com/product/shampoo/",
    title: "Shampoo",
    lang: "en",
    headings: [],
    visibleText: "",
    product: null,
    kind: "product",
  };
  const chat = async (key: string, body: Record<string, unknown>) => {
    const res = await chatPOST(
      new Request(`http://localhost:3000/api/widget/chat?key=${key}`, {
        method: "POST",
        headers: { Origin: "https://example.com", "Content-Type": "application/json" },
        body: JSON.stringify({ key, sid: "returning_visitor_1", cid: null, message: "Back again!", page, ...body }),
      }),
    );
    const text = await res.text();
    const start = text.split("\n\n").find((b) => b.includes('"start"'))!;
    return (JSON.parse(start.slice(6)) as { cid: string }).cid;
  };

  it("after clicking one of their emails, the subscriber's chat restarts the sequence", async () => {
    const { site, a, msg } = await setup();
    await db.update(contacts).set({ sequenceStartedAt: new Date(Date.now() - 5 * 86400_000) }).where(eq(contacts.id, a.id));
    const m = await msg(a.id);
    await clickGET(new Request(`http://localhost:3000/e/c/${m.id}/0`), { params: Promise.resolve({ messageId: m.id, index: "0" }) });
    const oldDraft = await msg(a.id, "draft");
    const cid = await chat(site.publicKey, { ref: a.ref });
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, cid));
    expect(conv.contactId).toBe(a.id);
    expect((await reload(a.id)).sequenceConversationId).toBe(cid);
    expect((await statusOf(oldDraft.id)).status).toBe("discarded");
  });

  it("a shared link restarts at most once per click; later chats with the ref are only attributed", async () => {
    const { site, a, msg } = await setup();
    await db.update(contacts).set({ sequenceStartedAt: new Date(Date.now() - 5 * 86400_000) }).where(eq(contacts.id, a.id));
    const m = await msg(a.id);
    await clickGET(new Request(`http://localhost:3000/e/c/${m.id}/0`), { params: Promise.resolve({ messageId: m.id, index: "0" }) });
    const first = await chat(site.publicKey, { ref: a.ref, sid: "visitor_first_1" });
    const second = await chat(site.publicKey, { ref: a.ref, sid: "visitor_second_1" });
    expect((await reload(a.id)).sequenceConversationId).toBe(first);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, second));
    expect(conv.contactId).toBe(a.id);
  });

  it("a ref with no recent click of their own email is only attributed, never restarts", async () => {
    const { site, a, convo, msg } = await setup();
    const oldDraft = await msg(a.id, "draft");
    // Clicked, but over 30 days ago.
    const m = await msg(a.id);
    await db.update(emailMessages).set({ clickedAt: new Date(Date.now() - 31 * 86400_000) }).where(eq(emailMessages.id, m.id));
    const cid = await chat(site.publicKey, { ref: a.ref });
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, cid));
    expect(conv.contactId).toBe(a.id);
    expect((await reload(a.id)).sequenceConversationId).toBe(convo.id);
    expect((await statusOf(oldDraft.id)).status).toBe("draft");
  });

  it("another site's ref, an unsubscribed contact's ref, or a malformed ref links nothing", async () => {
    const { site } = await setup();
    const other = await makeSite((await makeAccount()).id);
    const foreign = await contactOn(other.id);
    const gone = await contactOn(site.id, { status: "unsubscribed" });
    for (const ref of [foreign.ref, gone.ref, "<script>", "x".repeat(65)]) {
      const cid = await chat(site.publicKey, { ref, sid: `visitor_${Math.random().toString(36).slice(2)}` });
      const [conv] = await db.select().from(conversations).where(eq(conversations.id, cid));
      expect(conv.contactId).toBeNull();
    }
    expect((await reload(foreign.id)).sequenceConversationId).toBeNull();
  });
});
