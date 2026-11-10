import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contacts, emailMessages, monthlyUsage, sites } from "@/db/schema";
import { setProviderForTests, type OutgoingEmail } from "@/lib/email/provider";
import { emailTick, restartSequence } from "@/lib/email/schedule";
import type { CallModel } from "@/lib/email/writer";
import { monthKey } from "@/lib/usage/meter";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeMessage, makeSite } from "../helpers/factories";

const H = 3600_000;
const D = 24 * H;
const T0 = new Date("2026-11-10T10:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

let sent: OutgoingEmail[] = [];
let fail = 0;
let modelCalls = 0;
const callModel: CallModel = async () => {
  modelCalls++;
  return {
    content: { subject: `Subject ${modelCalls}`, body: "Hi!\n\nSee [Shampoo](https://milianjo.com/product/shampoo/)." },
    model: "claude-sonnet-5-5",
    usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
};

beforeEach(async () => {
  await resetDb();
  sent = [];
  fail = 0;
  modelCalls = 0;
  setProviderForTests({
    send: async (m) => {
      if (fail > 0) {
        fail--;
        throw new Error("provider down");
      }
      sent.push(m);
      return { id: `re_${sent.length}` };
    },
  });
});
afterEach(() => setProviderForTests(null));

async function setup(opts: { plan?: "starter" | "growth"; mode?: "approval" | "automatic"; status?: "subscribed" | "pending" } = {}) {
  const account = await makeAccount({ plan: opts.plan ?? "starter" });
  const site = await makeSite(account.id, {
    name: "Milian Jo",
    baseUrl: "https://milianjo.com",
    allowedOrigins: ["https://milianjo.com"],
    sendingDomain: "milianjo.com",
    sendingDomainStatus: "verified",
    emailMode: opts.mode ?? "approval",
  });
  const convo = await makeConversation(site.id, { lastMessageAt: T0 });
  await makeMessage(convo.id, { content: "Dry hair, what should I use?" });
  const [contact] = await db
    .insert(contacts)
    .values({
      siteId: site.id,
      email: "maria@example.com",
      language: "en",
      status: opts.status ?? "subscribed",
      consentText: "x",
      consentLanguage: "en",
      consentedAt: T0,
      confirmedAt: opts.status === "pending" ? null : at(H),
      token: "t".repeat(43),
      ref: "r".repeat(22),
      sequenceConversationId: convo.id,
      sequenceStartedAt: at(H),
    })
    .returning();
  return { account, site, convo, contact };
}

const messagesOf = (contactId: string) => db.select().from(emailMessages).where(eq(emailMessages.contactId, contactId));
const tick = (now: Date) => emailTick(now, { callModel });

async function approveAll() {
  await db.update(emailMessages).set({ status: "approved" }).where(eq(emailMessages.status, "draft"));
}

describe("emailTick: the first email", () => {
  it("is due 2 hours after the later of the chat and the confirmation; approval mode drafts it", async () => {
    const { contact } = await setup();
    expect(await tick(at(H + 2 * H - 60_000))).toEqual({ drafted: 0, sent: 0, skipped: 0 });
    expect(modelCalls).toBe(0);
    expect(await tick(at(3 * H))).toEqual({ drafted: 1, sent: 0, skipped: 0 });
    const [m] = await messagesOf(contact.id);
    expect(m).toMatchObject({ status: "draft", step: 1, subject: "Subject 1", language: "en" });
    expect(m.links).toEqual(["https://milianjo.com/product/shampoo/"]);
    expect(sent).toHaveLength(0);
    // A waiting draft means no second draft.
    await tick(at(4 * H));
    expect(await messagesOf(contact.id)).toHaveLength(1);
    expect(modelCalls).toBe(1);
  });

  it("automatic mode on growth sends in the same tick, with one-click unsubscribe and tracked links", async () => {
    const { account, contact } = await setup({ plan: "growth", mode: "automatic" });
    expect(await tick(at(3 * H))).toEqual({ drafted: 1, sent: 1, skipped: 0 });
    expect(sent).toHaveLength(1);
    const [m] = await messagesOf(contact.id);
    expect(m).toMatchObject({ status: "sent", providerId: "re_1" });
    expect(m.sentAt).toEqual(at(3 * H));
    expect(sent[0]).toMatchObject({ from: '"Milian Jo" <hello@milianjo.com>', to: "maria@example.com", subject: "Subject 1" });
    expect(sent[0].headers).toEqual({
      "List-Unsubscribe": `<http://localhost:3000/e/u/${contact.token}/one-click>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(sent[0].html).toContain(`http://localhost:3000/e/c/${m.id}/0`);
    expect(sent[0].html).toContain(`http://localhost:3000/e/u/${contact.token}`);
    expect(sent[0].text).toContain(`/e/c/${m.id}/0`);
    const [usage] = await db.select().from(monthlyUsage).where(eq(monthlyUsage.accountId, account.id));
    expect(usage.emails).toBe(1);
  });

  it("automatic stored on a starter plan still drafts", async () => {
    const { contact } = await setup({ plan: "starter", mode: "automatic" });
    await tick(at(3 * H));
    expect((await messagesOf(contact.id))[0].status).toBe("draft");
    expect(sent).toHaveLength(0);
  });
});

describe("emailTick: frequency", () => {
  it("step 2 is due after the interval, and nothing after the maximum", async () => {
    const { contact } = await setup({ plan: "growth", mode: "automatic" });
    await tick(at(3 * H));
    await tick(at(3 * H + 3 * D));
    expect(sent).toHaveLength(1);
    await tick(at(3 * H + 4 * D));
    expect(sent).toHaveLength(2);
    await tick(at(3 * H + 8 * D));
    expect(sent).toHaveLength(3);
    await tick(at(3 * H + 30 * D));
    expect(sent).toHaveLength(3);
    const steps = (await messagesOf(contact.id)).map((m) => m.step).sort();
    expect(steps).toEqual([1, 2, 3]);
    expect(modelCalls).toBe(3);
  });

  it("previous subjects are passed to the writer", async () => {
    await setup({ plan: "growth", mode: "automatic" });
    const inputs: string[] = [];
    const spy: CallModel = async (s, i) => {
      inputs.push(i);
      return callModel(s, i);
    };
    await emailTick(at(3 * H), { callModel: spy });
    await emailTick(at(3 * H + 4 * D), { callModel: spy });
    expect(inputs[1]).toContain("Subject 1");
  });
});

describe("emailTick: never emailing who shouldn't be emailed", () => {
  it("an approved email for a contact who unsubscribed since is skipped, not sent", async () => {
    const { contact } = await setup();
    await tick(at(3 * H));
    await approveAll();
    await db.update(contacts).set({ status: "unsubscribed", unsubscribedAt: at(3 * H) });
    expect(await tick(at(4 * H))).toMatchObject({ sent: 0, skipped: 1 });
    expect(sent).toHaveLength(0);
    expect((await messagesOf(contact.id))[0].status).toBe("skipped");
  });

  it("a pending contact gets nothing", async () => {
    await setup({ status: "pending" });
    expect(await tick(at(30 * D))).toEqual({ drafted: 0, sent: 0, skipped: 0 });
    expect(modelCalls).toBe(0);
  });
});

describe("emailTick: caps and the domain", () => {
  it("at the monthly cap: no drafts, no sends, no model call", async () => {
    const { account, contact } = await setup();
    await tick(at(3 * H));
    await approveAll();
    await db
      .insert(monthlyUsage)
      .values({ accountId: account.id, month: monthKey(T0), emails: 1000 })
      .onConflictDoUpdate({ target: [monthlyUsage.accountId, monthlyUsage.month], set: { emails: 1000 } });
    const other = await makeConversation((await db.select().from(sites))[0].id, { lastMessageAt: T0 });
    await db.insert(contacts).values({
      siteId: contact.siteId,
      email: "b@example.com",
      language: "en",
      status: "subscribed",
      consentText: "x",
      consentLanguage: "en",
      consentedAt: T0,
      confirmedAt: T0,
      token: "u".repeat(43),
      ref: "s".repeat(22),
      sequenceConversationId: other.id,
    });
    modelCalls = 0;
    expect(await tick(at(5 * H))).toMatchObject({ drafted: 0, sent: 0 });
    expect(modelCalls).toBe(0);
    expect(sent).toHaveLength(0);
    expect((await messagesOf(contact.id))[0].status).toBe("skipped");
  });

  it("a domain that's no longer verified skips approved emails", async () => {
    const { site, contact } = await setup();
    await tick(at(3 * H));
    await approveAll();
    await db.update(sites).set({ sendingDomainStatus: "failed" }).where(eq(sites.id, site.id));
    expect(await tick(at(4 * H))).toMatchObject({ sent: 0, skipped: 1 });
    expect((await messagesOf(contact.id))[0].status).toBe("skipped");
  });
});

describe("emailTick: concurrency and errors", () => {
  it("two ticks at once send exactly once", async () => {
    const { contact } = await setup({ plan: "growth", mode: "automatic" });
    await Promise.all([tick(at(3 * H)), tick(at(3 * H))]);
    expect(sent).toHaveLength(1);
    expect(await messagesOf(contact.id)).toHaveLength(1);
  });

  it("a send error goes back to approved; the third makes it failed", async () => {
    const { contact } = await setup();
    await tick(at(3 * H));
    await approveAll();
    fail = 3;
    await tick(at(4 * H));
    expect((await messagesOf(contact.id))[0]).toMatchObject({ status: "approved", attempts: 1, error: "Failed: provider down" });
    await tick(at(5 * H));
    await tick(at(6 * H));
    expect((await messagesOf(contact.id))[0]).toMatchObject({ status: "failed", attempts: 3 });
    expect(sent).toHaveLength(0);
  });

  it("a writer error doesn't stop other contacts, and isn't retried for a day", async () => {
    const { contact } = await setup();
    let calls = 0;
    const broken: CallModel = async () => {
      calls++;
      return { content: { nope: true }, model: "claude-sonnet-5-5", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    };
    expect(await emailTick(at(3 * H), { callModel: broken })).toMatchObject({ drafted: 0 });
    await emailTick(at(4 * H), { callModel: broken });
    expect(calls).toBe(1);
    await emailTick(at(3 * H + D + 60_000), { callModel: broken });
    expect(calls).toBe(2);
    const rows = await messagesOf(contact.id);
    expect(rows.every((r) => r.status === "failed")).toBe(true);
  });
});

describe("restartSequence", () => {
  it("moves the sequence to the new conversation and discards the unsent draft", async () => {
    const { site, contact } = await setup();
    await tick(at(3 * H));
    const next = await makeConversation(site.id, { lastMessageAt: at(D) });
    await restartSequence(contact.id, next.id);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(c.sequenceConversationId).toBe(next.id);
    const [m] = await messagesOf(contact.id);
    expect(m.status).toBe("discarded");
    expect(
      await db.select().from(emailMessages).where(and(eq(emailMessages.contactId, contact.id), eq(emailMessages.status, "draft"))),
    ).toHaveLength(0);
  });
});
