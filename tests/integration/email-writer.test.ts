import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { contacts, monthlyUsage, usageEvents } from "@/db/schema";
import { writeEmail } from "@/lib/email/writer";
import { monthKey } from "@/lib/usage/meter";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeMessage, makeSite } from "../helpers/factories";

beforeEach(resetDb);

const now = new Date("2026-11-10T10:00:00Z");
const usage = { inputTokens: 1000, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 };

async function setup(plan: "starter" | "trial" = "starter") {
  const account = await makeAccount({ plan, trialEndsAt: plan === "trial" ? new Date("2026-11-01T00:00:00Z") : null });
  const site = await makeSite(account.id, {
    name: "Milian Jo",
    baseUrl: "https://milianjo.com",
    allowedOrigins: ["https://www.milianjo.com"],
    guardrails: "Never give medical advice.",
  });
  const convo = await makeConversation(site.id, {
    language: "el",
    visit: {
      intent: "buying",
      confidence: 0.8,
      pages: [{ url: "https://milianjo.com/product/shampoo/", title: "Shampoo", seconds: 40 }],
      addedToCart: true,
      cartSeen: false,
    },
  });
  await makeMessage(convo.id, { role: "visitor", content: "Έχω ξηρά μαλλιά, τι να πάρω;" });
  await makeMessage(convo.id, { role: "bot", content: "Δοκιμάστε το Hydra σαμπουάν." });
  const [contact] = await db
    .insert(contacts)
    .values({
      siteId: site.id,
      email: "maria@example.com",
      language: "el",
      status: "subscribed",
      consentText: "x",
      consentLanguage: "el",
      consentedAt: now,
      confirmedAt: now,
      token: "t".repeat(43),
      ref: "r".repeat(22),
      sequenceConversationId: convo.id,
    })
    .returning();
  return { account, site: { ...site, account }, convo, contact };
}

describe("writeEmail", () => {
  it("prompts with the transcript, the language and the shop's rules, and records usage once", async () => {
    const { site, convo, contact } = await setup();
    let seen = "";
    const res = await writeEmail(
      { site, contact, conversationId: convo.id, step: 1, previousSubjects: [] },
      {
        now,
        callModel: async (system, input) => {
          seen = `${system}\n${input}`;
          return {
            content: {
              subject: "Για τα ξηρά σας μαλλιά",
              body: "Γεια σας!\n\nΔείτε το [Hydra](https://milianjo.com/product/shampoo/) και το [άλλο](https://www.milianjo.com/p/2) — όχι το [κακό](https://evil.com/x) ή https://evil.com/y.",
            },
            model: "claude-sonnet-5-5",
            usage,
          };
        },
      },
    );
    expect(seen).toContain("Έχω ξηρά μαλλιά, τι να πάρω;");
    expect(seen).toContain("Write in the language with ISO code el");
    expect(seen).toContain("Never give medical advice.");
    expect(seen).toContain("Added something to the cart");
    expect(seen).toContain("https://milianjo.com/product/shampoo/");
    expect(await db.select().from(usageEvents)).toHaveLength(1);
    expect((await db.select().from(usageEvents))[0].kind).toBe("email");

    expect(res!.links).toEqual(["https://milianjo.com/product/shampoo/", "https://www.milianjo.com/p/2"]);
    expect(res!.body).toContain("[Hydra](https://milianjo.com/product/shampoo/)");
    expect(res!.body).not.toContain("evil.com");
    expect(res!.body).toContain("κακό");
  });

  it("previous subjects are passed on for later steps", async () => {
    const { site, convo, contact } = await setup();
    let seen = "";
    await writeEmail(
      { site, contact, conversationId: convo.id, step: 2, previousSubjects: ["First subject"] },
      {
        now,
        callModel: async (_s, input) => {
          seen = input;
          return { content: { subject: "s", body: "b" }, model: "claude-sonnet-5-5", usage };
        },
      },
    );
    expect(seen).toContain("First subject");
    expect(seen).toContain("Email 2");
  });

  it("the subject keeps no off-site URL or host; the shop's own stay", async () => {
    const { site, convo, contact } = await setup();
    const res = await writeEmail(
      { site, contact, conversationId: convo.id, step: 1, previousSubjects: [] },
      {
        now,
        callModel: async () => ({
          content: { subject: "Deals at evil.com/x and https://evil.shop/y, [here](https://evil.com), milianjo.com", body: "b" },
          model: "claude-sonnet-5-5",
          usage,
        }),
      },
    );
    expect(res!.subject).not.toMatch(/evil|https?:/);
    expect(res!.subject).toContain("here");
    expect(res!.subject).toContain("milianjo.com");
  });

  it("cleans the subject: one line, at most 120 characters", async () => {
    const { site, convo, contact } = await setup();
    const res = await writeEmail(
      { site, contact, conversationId: convo.id, step: 1, previousSubjects: [] },
      {
        now,
        callModel: async () => ({
          content: { subject: `Line one\nline two ${"x".repeat(300)}`, body: "b" },
          model: "claude-sonnet-5-5",
          usage,
        }),
      },
    );
    expect(res!.subject).toHaveLength(120);
    expect(res!.subject).not.toMatch(/[\r\n]/);
    expect(res!.subject.startsWith("Line one line two")).toBe(true);
  });

  it("drops image markers that aren't the site's knowledge images", async () => {
    const { site, convo, contact } = await setup();
    const res = await writeEmail(
      { site, contact, conversationId: convo.id, step: 1, previousSubjects: [] },
      {
        now,
        callModel: async () => ({
          content: { subject: "s", body: "Hi\n\n[[image:00000000-0000-0000-0000-000000000000]]" },
          model: "claude-sonnet-5-5",
          usage,
        }),
      },
    );
    expect(res!.body).not.toContain("[[image:");
  });

  it("an unexpected shape throws after recording usage", async () => {
    const { site, convo, contact } = await setup();
    await expect(
      writeEmail(
        { site, contact, conversationId: convo.id, step: 1, previousSubjects: [] },
        { now, callModel: async () => ({ content: { foo: 1 }, model: "claude-sonnet-5-5", usage }) },
      ),
    ).rejects.toThrow("The model returned an unexpected email");
    expect(await db.select().from(usageEvents)).toHaveLength(1);
  });

  it("an AI-blocked account gets null without a model call", async () => {
    const { site, convo, contact } = await setup("trial");
    let called = false;
    const res = await writeEmail(
      { site, contact, conversationId: convo.id, step: 1, previousSubjects: [] },
      {
        now,
        callModel: async () => {
          called = true;
          return { content: { subject: "s", body: "b" }, model: "claude-sonnet-5-5", usage };
        },
      },
    );
    expect(res).toBeNull();
    expect(called).toBe(false);
  });

  it("the AI budget being spent also blocks", async () => {
    const { account, site, convo, contact } = await setup();
    await db.insert(monthlyUsage).values({ accountId: account.id, month: monthKey(now), aiCostMicros: 25_000_000 });
    let called = false;
    const res = await writeEmail(
      { site, contact, conversationId: convo.id, step: 1, previousSubjects: [] },
      { now, callModel: async () => ((called = true), { content: {}, model: "m", usage }) },
    );
    expect(res).toBeNull();
    expect(called).toBe(false);
  });

  it("FAKE_MODEL writes a fixed email", async () => {
    const { site, convo, contact } = await setup();
    const res = await writeEmail({ site, contact, conversationId: convo.id, step: 1, previousSubjects: [] }, { now });
    expect(res).toMatchObject({ subject: "Your recommendations", body: "Hello!\n\nThanks for chatting.", links: [] });
  });
});
