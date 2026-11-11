import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const current = vi.hoisted(() => ({ user: { id: "", email: "", emailVerified: true } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));

import { db } from "@/db/client";
import { usageEvents } from "@/db/schema";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeMembership, makeMessage, makeSite, makeUser } from "../helpers/factories";
import { findRelevantConversations } from "@/lib/ask/search";
import { answerQuestion, type AskCallModel } from "@/lib/ask/answer";
import { askAction } from "@/app/app/sites/[siteId]/ask/actions";
import { getMonthUsage } from "@/lib/usage/meter";
import { renderToStaticMarkup } from "react-dom/server";
import AskPage from "@/app/app/sites/[siteId]/ask/page";

beforeEach(resetDb);

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-11T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const usage = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 };
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/;

async function chat(siteId: string, at: Date, lines: string[]) {
  const c = await makeConversation(siteId, { createdAt: at, lastMessageAt: at });
  for (const [i, content] of lines.entries()) {
    await makeMessage(c.id, { role: i % 2 === 0 ? "visitor" : "bot", content, createdAt: new Date(at.getTime() + i * 1000) });
  }
  return c;
}

async function shop(accountOpts: Parameters<typeof makeAccount>[0] = {}) {
  const account = await makeAccount(accountOpts);
  const site = await makeSite(account.id, { baseUrl: "https://shop.example" });
  return { account, site };
}

const replying = (text: string) => vi.fn<AskCallModel>(async () => ({ text, model: "claude-opus-5-5", usage }));

describe("findRelevantConversations", () => {
  it("ranks the conversation that mentions the words first, only for this site and the last 90 days", async () => {
    const { site } = await shop();
    const other = await shop();
    await chat(site.id, ago(1), ["Do you ship to Cyprus?", "Yes, in 3 days."]);
    const butter = await chat(site.id, ago(5), ["Is the Hair Therapy Butter good for curls?", "Yes, it is."]);
    await chat(site.id, ago(2), ["Hello", "Hi! How can I help?"]);
    await chat(site.id, ago(120), ["I love the butter", "Thanks!"]);
    await chat(other.site.id, ago(1), ["Butter butter butter", "Sure."]);

    const found = await findRelevantConversations(site.id, "butter", { now });
    expect(found[0].id).toBe(butter.id);
    expect(found).toHaveLength(1);
    expect(found[0].startedAt).toEqual(butter.createdAt);
    expect(found[0].transcript).toContain("Visitor: Is the Hair Therapy Butter good for curls?");
    expect(found[0].transcript).toContain("Bot: Yes, it is.");
  });

  it("matches any of the question's words", async () => {
    const { site } = await shop();
    const butter = await chat(site.id, ago(3), ["Is the butter vegan?", "Yes."]);
    const found = await findRelevantConversations(site.id, "What do people say about the butter?", { now });
    expect(found.map((f) => f.id)).toContain(butter.id);
  });

  it("falls back to the newest conversations when nothing matches, and respects the limit", async () => {
    const { site } = await shop();
    const older = await chat(site.id, ago(10), ["Hello", "Hi"]);
    const newer = await chat(site.id, ago(1), ["Hey there", "Hi"]);
    await chat(site.id, ago(100), ["Ancient", "Hi"]);
    expect((await findRelevantConversations(site.id, "zebra", { now })).map((f) => f.id)).toEqual([newer.id, older.id]);
    expect((await findRelevantConversations(site.id, "zebra", { now, limit: 1 })).map((f) => f.id)).toEqual([newer.id]);
  });

  it("redacts email addresses in transcripts", async () => {
    const { site } = await shop();
    await chat(site.id, ago(1), ["Mail me at eleni@shop.gr about the butter", "Sure"]);
    const [found] = await findRelevantConversations(site.id, "butter", { now });
    expect(found.transcript).toContain("Mail me at [email] about the butter");
    expect(found.transcript).not.toMatch(EMAIL);
  });
});

describe("answerQuestion", () => {
  it("answers from the transcripts with citations mapped to real conversations, redacted, and metered as ask", async () => {
    const { account, site } = await shop();
    const user = await makeUser();
    const a = await chat(site.id, ago(1), ["Is the butter vegan? write to nikos@mail.com", "Yes."]);
    const b = await chat(site.id, ago(2), ["Does the butter smell nice?", "It smells of shea."]);
    const callModel = replying("People ask if it is vegan [c2] and how it smells [c1][c9]. Email eleni@shop.gr. See https://evil.example/x");

    const out = await answerQuestion(
      {
        siteId: site.id,
        userId: user.id,
        question: "What do people say about the butter? (I'm owner@shop.example)",
        history: [
          { role: "user", content: "Hi, I'm boss@shop.example" },
          { role: "assistant", content: "Hello [c3]" },
        ],
      },
      { callModel, now },
    );
    if ("error" in out) throw new Error(out.error);

    const [system, msgs] = callModel.mock.calls[0];
    const input = JSON.stringify([system, msgs]);
    expect(input).not.toMatch(EMAIL);
    expect(input).toContain("[email]");
    expect(system).toMatch(/only/i);
    expect(msgs.at(-1)?.role).toBe("user");
    expect(msgs.at(-1)?.content).toContain("What do people say about the butter?");
    expect(msgs.map((m) => m.content).join("\n")).not.toContain("[c3]");

    // Labels follow the order the conversations were given to the model.
    const last = msgs.at(-1)!.content;
    const label = (id: string, transcriptLine: string) => {
      const m = new RegExp(`<conversation id="(c\\d+)"[^>]*>\\n[^<]*${transcriptLine}`).exec(last);
      return m?.[1];
    };
    const la = label(a.id, "Is the butter vegan");
    const lb = label(b.id, "Does the butter smell nice");
    expect(la).toBeTruthy();
    expect(lb).toBeTruthy();
    const byLabel: Record<string, string> = { [la!]: a.id, [lb!]: b.id };
    expect(out.sources.map((s) => s.id)).toEqual([byLabel.c2, byLabel.c1]);
    expect(out.sources[0].startedAt).toBeInstanceOf(Date);

    expect(out.answer).not.toMatch(EMAIL);
    expect(out.answer).toContain("[email]");
    expect(out.answer).not.toContain("evil.example");
    expect(out.answer).not.toMatch(/\[c\d+\]/);
    expect(out.answer).toContain("vegan [1]");
    expect(out.answer).toContain("smells [2].");

    const events = await db.select().from(usageEvents).where(eq(usageEvents.accountId, account.id));
    expect(events.map((e) => e.kind)).toEqual(["ask"]);
    expect(events[0].siteId).toBe(site.id);
    expect(await getMonthUsage(account.id, now)).toMatchObject({ aiCostMicros: 0 });
  });

  it("is paused when the owner AI budget is used up", async () => {
    const { site } = await shop({ plan: "trial", trialEndsAt: new Date(now.getTime() - 1000) });
    await chat(site.id, ago(1), ["butter?", "yes"]);
    const callModel = replying("x");
    expect(await answerQuestion({ siteId: site.id, userId: "u1", question: "butter", history: [] }, { callModel, now })).toEqual({
      error: "Ask the Concierge is paused until next month: this month's owner AI budget is used up.",
    });
    expect(callModel).not.toHaveBeenCalled();
  });

  it("allows 20 questions an hour per user", async () => {
    const { site } = await shop();
    await chat(site.id, ago(1), ["butter?", "yes"]);
    const callModel = replying("Yes [c1]");
    const ask = (userId: string) => answerQuestion({ siteId: site.id, userId, question: "butter", history: [] }, { callModel, now });
    for (let i = 0; i < 20; i++) expect(await ask("user-a")).not.toHaveProperty("error");
    expect(await ask("user-a")).toEqual({ error: "Too many questions. Try again in a few minutes." });
    expect(await ask("user-b")).not.toHaveProperty("error");
    expect(callModel).toHaveBeenCalledTimes(21);
  });

  it("says so without calling the model when there are no conversations to read", async () => {
    const { site } = await shop();
    const callModel = replying("x");
    const out = await answerQuestion({ siteId: site.id, userId: "u1", question: "butter", history: [] }, { callModel, now });
    expect(out).toHaveProperty("error");
    expect(callModel).not.toHaveBeenCalled();
  });

  it("rejects an empty question", async () => {
    const { site } = await shop();
    const callModel = replying("x");
    expect(await answerQuestion({ siteId: site.id, userId: "u1", question: "  ", history: [] }, { callModel, now })).toEqual({
      error: "Type a question.",
    });
    expect(callModel).not.toHaveBeenCalled();
  });
});

describe("askAction", () => {
  const form = (question: string) => {
    const f = new FormData();
    f.set("question", question);
    return f;
  };

  it("404s for a site the user can't access", async () => {
    const { site } = await shop();
    const u = await makeUser();
    current.user = { id: u.id, email: u.email, emailVerified: true };
    await expect(askAction(site.id, { messages: [] }, form("butter"))).rejects.toThrow();
  });

  it("appends the question and answer to the thread", async () => {
    const { account, site } = await shop();
    const u = await makeUser();
    await makeMembership(account.id, u.id);
    current.user = { id: u.id, email: u.email, emailVerified: true };
    await chat(site.id, new Date(Date.now() - DAY), ["butter?", "yes"]);
    const out = await askAction(site.id, { messages: [] }, form("What about butter?"));
    expect(out.error).toBeUndefined();
    expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(out.messages[0].content).toBe("What about butter?");
  });

  it("keeps the draft and the thread on an error", async () => {
    const { account, site } = await shop({ plan: "trial", trialEndsAt: new Date(Date.now() - 1000) });
    const u = await makeUser();
    await makeMembership(account.id, u.id);
    current.user = { id: u.id, email: u.email, emailVerified: true };
    const prev = { messages: [{ role: "user" as const, content: "earlier" }, { role: "assistant" as const, content: "ok", sources: [] }] };
    const out = await askAction(site.id, prev, form("butter?"));
    expect(out.error).toMatch(/paused/);
    expect(out.draft).toBe("butter?");
    expect(out.messages).toEqual(prev.messages);
  });
});

describe("Ask page", () => {
  const render = async (siteId: string) =>
    renderToStaticMarkup(await AskPage({ params: Promise.resolve({ siteId }) } as never));

  it("shows the question box, and the paused notice when the owner budget is used up", async () => {
    const { account, site } = await shop();
    const u = await makeUser();
    await makeMembership(account.id, u.id);
    current.user = { id: u.id, email: u.email, emailVerified: true };
    const html = await render(site.id);
    expect(html).toContain("Ask the Concierge");
    expect(html).toContain('name="question"');
    expect(html).not.toContain("paused until next month");

    const expired = await shop({ plan: "trial", trialEndsAt: new Date(Date.now() - 1000) });
    await makeMembership(expired.account.id, u.id);
    expect(await render(expired.site.id)).toContain("paused until next month");
  });
});
