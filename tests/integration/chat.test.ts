import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { conversations, messages, monthlyUsage, promptImpressions, usageEvents } from "@/db/schema";
import { COPY } from "@/lib/copy/defaults";
import { replaceChunks } from "@/lib/kb/store";
import { monthKey } from "@/lib/usage/meter";
import type { ModelReply, ModelRequest } from "@/lib/chat/model";
import type { ChatEvent, PageContext } from "@/shared/widget-protocol";
import { hit } from "@/lib/usage/rate-limit";
import { makeAccount, makeConversation, makeImpression, makeMessage, makeSite, makeSource } from "../helpers/factories";
import { resetDb } from "../helpers/db";

const model = vi.hoisted(() => ({
  override: null as null | ((req: ModelRequest) => ModelReply),
  calls: [] as ModelRequest[],
}));
vi.mock("@/lib/chat/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/model")>();
  return {
    ...actual,
    streamModelReply: (req: ModelRequest) => {
      model.calls.push(req);
      return model.override ? model.override(req) : actual.streamModelReply(req);
    },
  };
});

import { OPTIONS, POST } from "@/app/api/widget/chat/route";
import { handleChat } from "@/lib/chat/handle-chat";

const ORIGIN = "https://example.com";
const SID = "visitor_session_1";
const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

beforeEach(async () => {
  await resetDb();
  model.override = null;
  model.calls = [];
});

const page: PageContext = {
  url: "https://example.com/products/argan",
  title: "Argan Oil",
  lang: "en-US",
  headings: ["Argan Oil"],
  visibleText: "Cold-pressed argan oil.",
  product: { name: "Argan Oil", price: "24.00", currency: "EUR" },
  kind: "product",
};

function chatRequest(
  key: string,
  body: Record<string, unknown>,
  opts: { origin?: string; signal?: AbortSignal; ip?: string } = {},
): Request {
  const headers: Record<string, string> = { Origin: opts.origin ?? ORIGIN, "Content-Type": "application/json" };
  if (opts.ip) headers["X-Forwarded-For"] = opts.ip;
  return new Request(`http://localhost:3000/api/widget/chat?key=${key}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ key, sid: SID, cid: null, message: "Is argan oil good for dry hair?", page, ...body }),
    signal: opts.signal,
  });
}

function parseSse(text: string): ChatEvent[] {
  return text
    .split("\n\n")
    .filter((b) => b.startsWith("data: "))
    .map((b) => JSON.parse(b.slice("data: ".length)) as ChatEvent);
}

async function send(key: string, body: Record<string, unknown> = {}, opts = {}) {
  const res = await POST(chatRequest(key, body, opts));
  const events = res.headers.get("Content-Type") === "text/event-stream" ? parseSse(await res.text()) : [];
  return { res, events };
}

async function setup(acc: { plan?: "trial" | "starter"; trialEndsAt?: Date | null } = {}) {
  const account = await makeAccount({ plan: acc.plan ?? "starter", trialEndsAt: acc.trialEndsAt ?? null });
  const site = await makeSite(account.id);
  return { account, site };
}

const conversationCount = async (accountId: string) =>
  (
    await db
      .select({ c: monthlyUsage.conversations })
      .from(monthlyUsage)
      .where(and(eq(monthlyUsage.accountId, accountId), eq(monthlyUsage.month, monthKey(new Date()))))
  )[0]?.c ?? 0;

const messagesOf = (cid: string) =>
  db.select().from(messages).where(eq(messages.conversationId, cid)).orderBy(asc(messages.createdAt), asc(messages.id));

function scriptedReply(chunks: string[], opts: { throwAfter?: number; gate?: Promise<void> } = {}): ModelReply {
  let fail: (e: unknown) => void = () => {};
  let ok: (v: Awaited<ModelReply["done"]>) => void = () => {};
  const done = new Promise<Awaited<ModelReply["done"]>>((res, rej) => {
    ok = res;
    fail = rej;
  });
  done.catch(() => {});
  async function* textStream() {
    for (let i = 0; i < chunks.length; i++) {
      if (opts.throwAfter === i) {
        const err = new Error("model exploded");
        fail(err);
        throw err;
      }
      yield chunks[i];
      if (i === 0 && opts.gate) await opts.gate;
    }
    ok({ text: chunks.join(""), model: "claude-opus-5-5", usage: { ...zero, inputTokens: 100, outputTokens: 20 } });
  }
  return { textStream: textStream(), done };
}

describe("POST /api/widget/chat", () => {
  it("first message streams start, deltas, done and saves the conversation", async () => {
    const { account, site } = await setup();
    const { res, events } = await send(site.publicKey);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);

    expect(events[0].type).toBe("start");
    expect(events.at(-1)?.type).toBe("done");
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.map((d) => (d.type === "delta" ? d.text : "")).join("")).toBe(
      "Test reply about: Is argan oil good for dry hair?.",
    );

    const cid = events[0].type === "start" ? events[0].cid : "";
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, cid));
    expect(conv).toMatchObject({ siteId: site.id, visitorSessionId: SID, language: "en", firstPageUrl: page.url });
    expect(await conversationCount(account.id)).toBe(1);

    const saved = await messagesOf(cid);
    expect(saved.map((m) => [m.role, m.kind])).toEqual([
      ["visitor", "chat"],
      ["bot", "chat"],
    ]);
    expect(saved[1].content).toBe("Test reply about: Is argan oil good for dry hair?.");
    const done = events.at(-1);
    expect(done?.type === "done" && done.messageId).toBe(saved[1].id);

    const usage = await db.select().from(usageEvents).where(eq(usageEvents.accountId, account.id));
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ kind: "chat", model: "claude-sonnet-5-5", siteId: site.id });

    expect(model.calls[0].system).toContain(site.botName);
    expect(model.calls[0].context).toContain("PAGE");
    expect(model.calls[0].message).toBe("Is argan oil good for dry hair?");
  });

  it("second message with the same cid reuses the conversation and does not recount", async () => {
    const { account, site } = await setup();
    const first = await send(site.publicKey);
    const cid = first.events[0].type === "start" ? first.events[0].cid : "";
    const second = await send(site.publicKey, { cid, message: "And for curly hair?" });
    expect(second.events[0]).toEqual({ type: "start", cid });
    expect(await conversationCount(account.id)).toBe(1);
    expect(await messagesOf(cid)).toHaveLength(4);
    expect(model.calls[1].history).toEqual([
      { role: "user", content: "Is argan oil good for dry hair?" },
      { role: "assistant", content: "Test reply about: Is argan oil good for dry hair?." },
    ]);
  });

  it("a cid from another visitor session starts a new conversation", async () => {
    const { account, site } = await setup();
    const other = await makeConversation(site.id, { visitorSessionId: "someone_else_1" });
    const { events } = await send(site.publicKey, { cid: other.id });
    const cid = events[0].type === "start" ? events[0].cid : "";
    expect(cid).not.toBe(other.id);
    expect(await messagesOf(other.id)).toHaveLength(0);
    expect(await conversationCount(account.id)).toBe(1);
  });

  it("a cid from another site starts a new conversation", async () => {
    const { site } = await setup();
    const otherSite = await makeSite(site.accountId);
    const other = await makeConversation(otherSite.id, { visitorSessionId: SID });
    const { events } = await send(site.publicKey, { cid: other.id });
    expect(events[0].type === "start" && events[0].cid).not.toBe(other.id);
  });

  it("at the ceiling answers with the fallback and makes no AI call", async () => {
    const { account, site } = await setup();
    await db.insert(monthlyUsage).values({ accountId: account.id, month: monthKey(new Date()), conversations: 750 });
    const { events } = await send(site.publicKey);
    expect(events.map((e) => e.type)).toEqual(["start", "fallback"]);
    const cid = events[0].type === "start" ? events[0].cid : "";
    expect(events[1]).toEqual({ type: "fallback", cid, text: COPY.en.fallback });
    expect(model.calls).toHaveLength(0);
    expect(await db.select().from(usageEvents)).toHaveLength(0);
    const saved = await messagesOf(cid);
    expect(saved.map((m) => [m.role, m.kind, m.content])).toEqual([
      ["visitor", "chat", "Is argan oil good for dry hair?"],
      ["bot", "fallback", COPY.en.fallback],
    ]);
  });

  it("a conversation with 40 visitor messages gets the fallback and no model call", async () => {
    const { site } = await setup();
    const conv = await makeConversation(site.id, { visitorSessionId: SID });
    for (let i = 0; i < 39; i++) await makeMessage(conv.id, { content: `q${i}` });
    // The 40th visitor message is still answered by the model.
    const ok = await send(site.publicKey, { cid: conv.id, message: "q39" });
    expect(ok.events.at(-1)?.type).toBe("done");
    expect(model.calls).toHaveLength(1);

    const { events } = await send(site.publicKey, { cid: conv.id, message: "q40" });
    expect(events).toEqual([
      { type: "start", cid: conv.id },
      { type: "fallback", cid: conv.id, text: COPY.en.fallback },
    ]);
    expect(model.calls).toHaveLength(1);
    const last = (await messagesOf(conv.id)).slice(-2);
    expect(last.map((m) => [m.role, m.kind, m.content])).toEqual([
      ["visitor", "chat", "q40"],
      ["bot", "fallback", COPY.en.fallback],
    ]);
  });

  it("an account at this month's AI cost ceiling gets the fallback and no model call", async () => {
    const { account, site } = await setup({ plan: "starter" });
    await db.insert(monthlyUsage).values({ accountId: account.id, month: monthKey(new Date()), aiCostMicros: 25_000_000 });
    const { events } = await send(site.publicKey);
    expect(events.map((e) => e.type)).toEqual(["start", "fallback"]);
    expect(model.calls).toHaveLength(0);
    expect(await db.select().from(usageEvents)).toHaveLength(0);
  });

  it("the 301st message for one site in 5 minutes is rate limited, whatever the sid and IP", async () => {
    const { site } = await setup();
    // Pin the clock to the start of a rate-limit window so the test never straddles a window boundary.
    const windowMs = 300_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Math.floor(Date.now() / windowMs) * windowMs + 1000);
    try {
      for (let i = 0; i < 299; i++) await hit(`chat:site:${site.id}`, 300, 300);
      const ok = await send(site.publicKey, { sid: "visitor_rotating_300" }, { ip: "203.0.113.30" });
      expect(ok.res.status).toBe(200);
      const { res } = await send(site.publicKey, { sid: "visitor_rotating_301" }, { ip: "203.0.113.31" });
      expect(res.status).toBe(429);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    } finally {
      vi.useRealTimers();
    }
  });

  it("one IP can start at most 20 new conversations an hour; its existing conversation keeps working", async () => {
    const { site } = await setup();
    const windowMs = 3600_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Math.floor(Date.now() / windowMs) * windowMs + 1000);
    try {
      let cid: string | null = null;
      for (let i = 0; i < 20; i++) {
        const { res, events } = await send(site.publicKey, { sid: `visitor_burner_${i}` }, { ip: "198.51.100.7" });
        expect(res.status).toBe(200);
        if (i === 0) cid = (events.find((e) => e.type === "start") as { cid: string }).cid;
      }
      const { res } = await send(site.publicKey, { sid: "visitor_burner_99" }, { ip: "198.51.100.7" });
      expect(res.status).toBe(429);
      const again = await send(site.publicKey, { sid: "visitor_burner_0", cid }, { ip: "198.51.100.7" });
      expect(again.res.status).toBe(200);
      expect(await conversationCount(site.accountId)).toBe(20);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a site gets at most a fifth of its monthly conversations (and at least 50) as new ones per day", async () => {
    const { site } = await setup();
    const dayMs = 86_400_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Math.floor(Date.now() / dayMs) * dayMs + 1000);
    try {
      // Starter: 500 a month → 100 new conversations a day.
      for (let i = 0; i < 99; i++) await hit(`chat:newconv:site:${site.id}`, 100, 86_400);
      const ok = await send(site.publicKey, { sid: "visitor_daily_100" }, { ip: "203.0.113.60" });
      expect(ok.res.status).toBe(200);
      const { res } = await send(site.publicKey, { sid: "visitor_daily_101" }, { ip: "203.0.113.61" });
      expect(res.status).toBe(429);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an unknown site key is refused before the body is read", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/widget/chat?key=pk_unknown", {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: "x".repeat(1000),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("an expired trial answers with the fallback in the visitor's language", async () => {
    const { site } = await setup({ plan: "trial", trialEndsAt: new Date(Date.now() - 1000) });
    const { events } = await send(site.publicKey, { page: { ...page, lang: "el" } });
    expect(events.map((e) => e.type)).toEqual(["start", "fallback"]);
    expect(events[1].type === "fallback" && events[1].text).toBe(COPY.el.fallback);
    expect(model.calls).toHaveLength(0);
  });

  it("a model error mid-stream sends a fallback and saves a fallback message", async () => {
    const { site } = await setup();
    model.override = () => scriptedReply(["Partial ", "never"], { throwAfter: 1 });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { events } = await send(site.publicKey);
    expect(events.map((e) => e.type)).toEqual(["start", "delta", "fallback"]);
    expect(events[1]).toEqual({ type: "delta", text: "Partial " });
    const cid = events[0].type === "start" ? events[0].cid : "";
    const saved = await messagesOf(cid);
    expect(saved.map((m) => [m.role, m.kind])).toEqual([
      ["visitor", "chat"],
      ["bot", "fallback"],
    ]);
    expect(await db.select().from(usageEvents)).toHaveLength(0);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("a model that throws before streaming sends a fallback", async () => {
    const { site } = await setup();
    model.override = () => scriptedReply(["x"], { throwAfter: 0 });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { events } = await send(site.publicKey);
    expect(events.map((e) => e.type)).toEqual(["start", "fallback"]);
    errors.mockRestore();
  });

  it("image markers are stripped from deltas and returned as images on done", async () => {
    const { site } = await setup();
    const img = await makeSource(site.id, { kind: "image", title: "label.png", caption: "Argan label" });
    await replaceChunks({ sourceId: img.id, siteId: site.id, texts: ["Argan oil label with ingredients"] });
    model.override = () => scriptedReply(["Here it is:\n[[ima", `ge:${img.id}]]\n[[image:not-allowed]]`, "\nEnjoy"]);
    const { events } = await send(site.publicKey, { message: "Show me the argan oil label" });
    const streamed = events.map((e) => (e.type === "delta" ? e.text : "")).join("");
    expect(streamed).not.toContain("[[");
    const done = events.at(-1);
    expect(done).toMatchObject({
      type: "done",
      images: [
        {
          id: img.id,
          url: `http://localhost:3000/api/widget/image/${img.id}?key=${site.publicKey}`,
          caption: "Argan label",
        },
      ],
    });
    const cid = events[0].type === "start" ? events[0].cid : "";
    const bot = (await messagesOf(cid))[1];
    expect(bot.content).toBe("Here it is:\n\nEnjoy");
    expect(bot.imageIds).toEqual([img.id]);
    expect(model.calls[0].context).toContain(`${img.id} — Argan label`);
  });

  it("a client abort after the first delta still saves the completed reply", async () => {
    const { site } = await setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    model.override = () => scriptedReply(["First ", "second ", "third."], { gate });
    const ac = new AbortController();
    let settled: Promise<void> | undefined;
    const res = await handleChat(chatRequest(site.publicKey, {}, { signal: ac.signal }), {
      onSettled: (p) => (settled = p),
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes('"type":"delta"')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    const cid = parseSse(text)[0].type === "start" ? (parseSse(text)[0] as { cid: string }).cid : "";
    ac.abort();
    await reader.cancel();
    release();
    expect(settled).toBeDefined();
    await expect(settled).resolves.toBeUndefined();
    const saved = await messagesOf(cid);
    expect(saved.map((m) => [m.role, m.kind, m.content])).toEqual([
      ["visitor", "chat", "Is argan oil good for dry hair?"],
      ["bot", "chat", "First second third."],
    ]);
    expect(await db.select().from(usageEvents)).toHaveLength(1);
  });

  it("the 21st message in 5 minutes for one sid is rate limited", async () => {
    const { site } = await setup();
    for (let i = 0; i < 20; i++) {
      const { res } = await send(site.publicKey, { message: `q${i}` });
      expect(res.status).toBe(200);
    }
    const { res } = await send(site.publicKey);
    expect(res.status).toBe(429);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("validates the request", async () => {
    const { site } = await setup();
    expect((await send(site.publicKey, { message: "a".repeat(2001) })).res.status).toBe(400);
    expect((await send(site.publicKey, { message: "a".repeat(2000) })).res.status).toBe(200);
    expect((await send(site.publicKey, { message: "   " })).res.status).toBe(400);
    expect((await send(site.publicKey, { sid: "short" })).res.status).toBe(400);
    expect((await send(site.publicKey, { sid: "has spaces in it" })).res.status).toBe(400);
    expect((await send(site.publicKey, { page: { ...page, title: "t".repeat(301) } })).res.status).toBe(400);
    expect((await send(site.publicKey, { page: { ...page, visibleText: "v".repeat(4001) } })).res.status).toBe(400);
    expect((await send(site.publicKey, { page: { ...page, headings: Array(21).fill("h") } })).res.status).toBe(400);
    const bad = await POST(
      new Request(`http://localhost:3000/api/widget/chat?key=${site.publicKey}`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: "{not json",
      }),
    );
    expect(bad.status).toBe(400);
  });

  it("rejects disallowed origins and unknown keys", async () => {
    const { site } = await setup();
    expect((await send(site.publicKey, {}, { origin: "https://evil.com" })).res.status).toBe(403);
    expect((await send("pk_nope")).res.status).toBe(404);
  });

  it("answers the CORS preflight", async () => {
    const { site } = await setup();
    const res = await OPTIONS(
      new Request(`http://localhost:3000/api/widget/chat?key=${site.publicKey}`, { method: "OPTIONS", headers: { Origin: ORIGIN } }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });
});

describe("chat context from the visit", () => {
  const visit = (over: Record<string, unknown> = {}) => ({
    intent: "buying",
    confidence: 0.85,
    pages: [
      { url: "https://example.com/product/shampoo/", title: "Shampoo", seconds: 40 },
      { url: "https://example.com/cart/", title: "Cart", seconds: 12 },
    ],
    addedToCart: true,
    cartSeen: true,
    ...over,
  });
  const conversationOf = async (cid: string) => (await db.select().from(conversations).where(eq(conversations.id, cid)))[0];
  const startOf = (events: ChatEvent[]) => (events.find((e) => e.type === "start") as { cid: string }).cid;

  it("stores the visit and the tapped suggestion, and tells the model", async () => {
    const { site } = await setup();
    const imp = await makeImpression(site.id, { visitorSessionId: SID, text: "Want to know why?" });
    const { events } = await send(site.publicKey, { visit: visit(), promptId: imp.id });
    const conv = await conversationOf(startOf(events));
    expect(conv).toMatchObject({ intent: "buying", intentConfidence: 0.85, promptImpressionId: imp.id });
    expect(conv.visit?.pages).toHaveLength(2);
    const [row] = await db.select().from(promptImpressions).where(eq(promptImpressions.id, imp.id));
    expect(row.outcome).toBe("tapped");
    expect(model.calls[0].context).toContain("Likely intent: Ready to buy (85%)");
    expect(model.calls[0].context).toContain('Started from the suggestion: "Want to know why?"');
  });

  it("ignores another visit's suggestion id", async () => {
    const { site } = await setup();
    const imp = await makeImpression(site.id, { visitorSessionId: "someone_else_1" });
    const { events } = await send(site.publicKey, { visit: visit(), promptId: imp.id });
    expect((await conversationOf(startOf(events))).promptImpressionId).toBeNull();
    const [row] = await db.select().from(promptImpressions).where(eq(promptImpressions.id, imp.id));
    expect(row.outcome).toBeNull();
  });

  it("an invalid visit summary is ignored, never blocks the chat", async () => {
    const { site } = await setup();
    const pages = Array.from({ length: 11 }, (_, i) => ({ url: `https://example.com/p/${i}`, title: "P", seconds: 1 }));
    for (const bad of [visit({ pages }), visit({ confidence: 3 }), visit({ pages: [{ url: "u", title: "t", seconds: 90_000 }] })]) {
      const { res, events } = await send(site.publicKey, { visit: bad });
      expect(res.status).toBe(200);
      expect((await conversationOf(startOf(events))).visit).toBeNull();
    }
  });

  it("later messages update the intent and keep the starting suggestion", async () => {
    const { site } = await setup();
    const imp = await makeImpression(site.id, { visitorSessionId: SID });
    const first = await send(site.publicKey, { visit: visit(), promptId: imp.id });
    const cid = startOf(first.events);
    await send(site.publicKey, { cid, visit: visit({ intent: "exploring", confidence: 0.6 }), promptId: null });
    expect(await conversationOf(cid)).toMatchObject({ intent: "exploring", intentConfidence: 0.6, promptImpressionId: imp.id });
  });

  it("works without a visit (older widget)", async () => {
    const { site } = await setup();
    const { res, events } = await send(site.publicKey);
    expect(res.status).toBe(200);
    expect((await conversationOf(startOf(events))).intent).toBeNull();
    expect(model.calls[0].context).not.toContain("VISIT");
  });
});
