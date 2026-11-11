import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { buyerOrders, buyers, kbChunks, kbSources, monthlyUsage, usageEvents } from "@/db/schema";
import { getEmbedder } from "@/lib/ai/embed";
import { writeBuyerEmail } from "@/lib/buyers/writer";
import type { CallModel } from "@/lib/email/writer";
import { monthKey } from "@/lib/usage/meter";
import { resetDb } from "../helpers/db";
import { makeAccount, makeSite } from "../helpers/factories";

beforeEach(resetDb);

const now = new Date("2026-11-15T10:00:00Z");
const usage = { inputTokens: 1000, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 };

async function page(siteId: string, title: string, url: string, content: string) {
  const [src] = await db.insert(kbSources).values({ siteId, kind: "page", title, url, status: "ready" }).returning();
  const [embedding] = await getEmbedder().embed([content], "document");
  await db.insert(kbChunks).values({ sourceId: src.id, siteId, ordinal: 0, content, embedding });
}

async function setup(opts: { items?: { productId: number; name: string; url: string | null }[] } = {}) {
  const account = await makeAccount({ plan: "starter" });
  const site = await makeSite(account.id, {
    name: "Milian Jo",
    baseUrl: "https://milianjo.com",
    allowedOrigins: ["https://milianjo.com"],
    defaultLanguage: "el",
    guardrails: "Never give medical advice.",
  });
  await page(site.id, "Olive oil", "https://milianjo.com/p/oil", "Olive oil for hair: warm a few drops and massage into dry ends.");
  await page(site.id, "Hair care guide", "https://milianjo.com/blog/hair-guide", "Guide: olive oil hair mask once a week for dry hair.");
  const [buyer] = await db
    .insert(buyers)
    .values({ siteId: site.id, email: "maria@example.com", firstName: "Maria", status: "subscribed", token: "b".repeat(43), ref: "q".repeat(22) })
    .returning();
  const [order] = await db
    .insert(buyerOrders)
    .values({
      siteId: site.id,
      buyerId: buyer.id,
      externalId: "1",
      orderedAt: new Date("2026-11-10T10:00:00Z"),
      items: opts.items ?? [{ productId: 7, name: "Olive oil", url: "https://milianjo.com/p/oil" }],
    })
    .returning();
  return { account, site: { ...site, account }, buyer, order };
}

const reply =
  (body: string, seen?: { system: string; input: string }[]): CallModel =>
  async (system, input) => {
    seen?.push({ system, input });
    return { content: { subject: "Your olive oil", body }, model: "claude-sonnet-5-5", usage };
  };

describe("writeBuyerEmail", () => {
  it("step 1 prompts with the products, the shop's knowledge, its language and rules", async () => {
    const { site, buyer, order } = await setup();
    const seen: { system: string; input: string }[] = [];
    const res = await writeBuyerEmail({ site, buyer, order, step: 1 }, { now, callModel: reply("Hi Maria!\n\nEnjoy it.", seen) });
    expect(res).toEqual({ subject: "Your olive oil", body: "Hi Maria!\n\nEnjoy it.", links: [] });
    const { system, input } = seen[0];
    expect(system).toContain("Milian Jo");
    expect(system).toContain("Never give medical advice.");
    expect(system).toMatch(/get the most from/i);
    expect(system).toMatch(/questions/i);
    expect(system).toMatch(/up to 2 .*articles/i);
    expect(input).toContain("Write in the language with ISO code el");
    expect(input).toContain("Olive oil (https://milianjo.com/p/oil)");
    expect(input).toContain("Maria");
    expect(input).toContain("massage into dry ends");
    expect(input).toContain("https://milianjo.com/blog/hair-guide");
  });

  it("step 2 asks how they like it, for feedback, and for up to 2 related products", async () => {
    const { site, buyer, order } = await setup();
    const seen: { system: string; input: string }[] = [];
    await writeBuyerEmail({ site, buyer, order, step: 2 }, { now, callModel: reply("Hi!", seen) });
    expect(seen[0].system).toMatch(/how they like/i);
    expect(seen[0].system).toMatch(/feedback/i);
    expect(seen[0].system).toMatch(/up to 2 other products/i);
    expect(seen[0].system).not.toMatch(/up to 2 .*articles/i);
  });

  it("keeps only links to the shop's own pages it was given; drops off-site and invented links and addresses", async () => {
    const { site, buyer, order } = await setup();
    const res = await writeBuyerEmail(
      { site, buyer, order, step: 2 },
      {
        now,
        callModel: reply(
          "Read the [guide](https://milianjo.com/blog/hair-guide) and see [oil](https://www.milianjo.com/p/oil).\n\n" +
            "Not [this](https://evil.com/x), not [made up](https://milianjo.com/p/invented), not https://evil.com/y or https://milianjo.com/fake.\n\n" +
            "Write to other@example.com or visit evil.shop.",
        ),
      },
    );
    expect(res!.links).toEqual(["https://milianjo.com/blog/hair-guide"]);
    expect(res!.body).toContain("[guide](https://milianjo.com/blog/hair-guide)");
    expect(res!.body).toContain("see oil.");
    expect(res!.body).toContain("not made up");
    expect(res!.body).not.toMatch(/evil|invented|fake|other@example\.com/);
    expect(res!.body).toContain("[email]");
  });

  it("copes with products whose page wasn't found", async () => {
    const { site, buyer, order } = await setup({ items: [{ productId: 9, name: "Mystery soap", url: null }] });
    const seen: { system: string; input: string }[] = [];
    const res = await writeBuyerEmail(
      { site, buyer, order, step: 1 },
      { now, callModel: reply("See [soap](https://milianjo.com/p/soap).", seen) },
    );
    expect(seen[0].input).toContain("- Mystery soap\n");
    expect(res!.links).toEqual([]);
    expect(res!.body).toBe("See soap.");
  });

  it("records usage as buyer_email on the owner budget, never on the visitors' bot budget", async () => {
    const { account, site, buyer, order } = await setup();
    await writeBuyerEmail({ site, buyer, order, step: 1 }, { now, callModel: reply("Hi!") });
    const events = await db.select().from(usageEvents);
    expect(events.map((e) => e.kind)).toEqual(["buyer_email"]);
    const [m] = await db.select().from(monthlyUsage).where(eq(monthlyUsage.accountId, account.id));
    expect(m.month).toBe(monthKey(now));
    expect(m.ownerAiCostMicros).toBeGreaterThan(0);
    expect(m.aiCostMicros).toBe(0);
  });

  it("returns null without calling the model when the owner budget is spent", async () => {
    const { account, site, buyer, order } = await setup();
    await db.insert(monthlyUsage).values({ accountId: account.id, month: monthKey(now), ownerAiCostMicros: 10_000_000_000 });
    let calls = 0;
    const res = await writeBuyerEmail({ site, buyer, order, step: 1 }, { now, callModel: async (...a) => (calls++, reply("x")(...a)) });
    expect(res).toBeNull();
    expect(calls).toBe(0);
  });

  it("throws on an unexpected reply, after metering it", async () => {
    const { site, buyer, order } = await setup();
    await expect(
      writeBuyerEmail({ site, buyer, order, step: 1 }, { now, callModel: async () => ({ content: null, model: "claude-sonnet-5-5", usage }) }),
    ).rejects.toThrow(/unexpected/);
    expect(await db.select().from(usageEvents)).toHaveLength(1);
  });
});
