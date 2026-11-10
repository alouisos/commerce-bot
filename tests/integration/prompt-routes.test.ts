import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { promptCache, promptImpressions, usageEvents } from "@/db/schema";
import { resetDb } from "../helpers/db";
import { makeAccount, makeImpression, makeSite, makeSource } from "../helpers/factories";
import { offerPrompt } from "@/lib/prompts/offer";
import { getSiteByPublicKey } from "@/lib/sites";
import { POST as promptPOST } from "@/app/api/widget/prompt/route";
import { POST as eventPOST } from "@/app/api/widget/prompt-event/route";
import type { PageContext } from "@/shared/widget-protocol";

beforeEach(resetDb);

const ORIGIN = "https://example.com";
const post = (path: string, body: unknown) =>
  new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const page = (over: Partial<PageContext> = {}): PageContext => ({
  url: "https://example.com/product/shampoo/?utm_source=x#top",
  title: "Shampoo",
  lang: "en",
  headings: ["Shampoo"],
  visibleText: "A gentle shampoo for dry hair.",
  product: { name: "Shampoo", price: "22,00 €", currency: "EUR" },
  kind: "product",
  ...over,
});

const usage = { inputTokens: 500, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 };
const reply = (content: unknown) => vi.fn(async () => ({ content, model: "claude-opus-5-5", usage }));
const good = { show: true, text: "Want to know if it suits colour-treated hair?", question: "Does it suit colour-treated hair?" };

async function widgetSite(overrides: Parameters<typeof makeSite>[1] = {}, plan: Parameters<typeof makeAccount>[0] = {}) {
  const site = await makeSite((await makeAccount(plan)).id, overrides);
  await makeSource(site.id, { kind: "text", title: "Shampoo", status: "ready" });
  return (await getSiteByPublicKey(site.publicKey))!;
}

const input = (over: Partial<Parameters<typeof offerPrompt>[1]> = {}) => ({
  sid: "sid-aaaaaaaa",
  page: page(),
  intent: "exploring" as const,
  confidence: 0.8,
  ...over,
});

describe("offerPrompt", () => {
  it("writes a suggestion, records the impression and meters the call", async () => {
    const site = await widgetSite();
    const callModel = reply(good);
    const offer = await offerPrompt(site, input(), { callModel });
    expect(offer).toMatchObject({ text: good.text, question: good.question });
    const [imp] = await db.select().from(promptImpressions).where(eq(promptImpressions.id, offer!.id));
    expect(imp).toMatchObject({ siteId: site.id, visitorSessionId: "sid-aaaaaaaa", kind: "question", shownAt: null });
    const events = await db.select().from(usageEvents).where(eq(usageEvents.siteId, site.id));
    expect(events.map((e) => e.kind)).toEqual(["prompt"]);
    const [, userText] = (callModel.mock.calls[0] as unknown as [string, string]);
    expect(userText).toContain("Write in the language with ISO code en.");
    expect(userText).toContain("question");
  });

  it("reuses the page's suggestion (ignoring query and hash) without calling the model", async () => {
    const site = await widgetSite();
    const callModel = reply(good);
    const a = await offerPrompt(site, input(), { callModel });
    const b = await offerPrompt(site, input({ page: page({ url: "https://example.com/product/shampoo/?ref=2" }) }), { callModel });
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(b!.id).not.toBe(a!.id);
    expect(b!.text).toBe(good.text);
  });

  it("remembers when there is nothing useful to say", async () => {
    const site = await widgetSite();
    const callModel = reply({ show: false, text: "", question: "" });
    expect(await offerPrompt(site, input(), { callModel })).toBeNull();
    expect(await offerPrompt(site, input(), { callModel })).toBeNull();
    expect(callModel).toHaveBeenCalledTimes(1);
    const [row] = await db.select().from(promptCache).where(eq(promptCache.siteId, site.id));
    expect(row.text).toBeNull();
  });

  it("buying intent asks for a pairing", async () => {
    const site = await widgetSite();
    const callModel = reply(good);
    const offer = await offerPrompt(site, input({ intent: "buying" }), { callModel });
    const [imp] = await db.select().from(promptImpressions).where(eq(promptImpressions.id, offer!.id));
    expect(imp.kind).toBe("pairing");
  });

  it("makes no model call when suggestions are off, on checkout, paused or AI is blocked", async () => {
    const callModel = reply(good);
    const off = await widgetSite({ proactivity: "off" });
    expect(await offerPrompt(off, input(), { callModel })).toBeNull();
    const on = await widgetSite();
    expect(await offerPrompt(on, input({ page: page({ kind: "checkout" }) }), { callModel })).toBeNull();
    for (let i = 0; i < 20; i++) await makeImpression(on.id, { kind: "question", shownAt: new Date(), outcome: "dismissed" });
    expect(await offerPrompt(on, input(), { callModel })).toBeNull();
    const blocked = await widgetSite({}, { plan: "trial", trialEndsAt: new Date(Date.now() - 1000) });
    expect(await offerPrompt(blocked, input(), { callModel })).toBeNull();
    expect(callModel).not.toHaveBeenCalled();
  });

  it("drops a reply with a link but still meters it once", async () => {
    const site = await widgetSite();
    const callModel = reply({ ...good, text: "See https://evil.example" });
    expect(await offerPrompt(site, input(), { callModel })).toBeNull();
    expect(await db.select().from(usageEvents).where(eq(usageEvents.siteId, site.id))).toHaveLength(1);
    expect(await db.select().from(promptImpressions)).toHaveLength(0);
  });
});

describe("POST /api/widget/prompt", () => {
  const body = (key: string, over: Record<string, unknown> = {}) => ({
    key,
    sid: "sid-bbbbbbbb",
    page: page(),
    intent: "exploring",
    confidence: 0.8,
    ...over,
  });

  it("returns a suggestion (fake model)", async () => {
    const site = await widgetSite();
    const res = await promptPOST(post(`/api/widget/prompt?key=${site.publicKey}`, body(site.publicKey)));
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const offer = (await res.json()) as { id: string; text: string; question: string };
    expect(offer.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(offer.text).toBeTruthy();
    expect(offer.question).toBeTruthy();
  });

  it("204 when there is no suggestion", async () => {
    const site = await widgetSite({ proactivity: "off" });
    const res = await promptPOST(post(`/api/widget/prompt?key=${site.publicKey}`, body(site.publicKey)));
    expect(res.status).toBe(204);
  });

  it("rejects bad input", async () => {
    const site = await widgetSite();
    const url = `/api/widget/prompt?key=${site.publicKey}`;
    expect((await promptPOST(post(url, body(site.publicKey, { confidence: 2 })))).status).toBe(400);
    expect((await promptPOST(post(url, body(site.publicKey, { intent: "shopping" })))).status).toBe(400);
    expect((await promptPOST(post(url, body(site.publicKey, { sid: "x" })))).status).toBe(400);
  });

  it("limits each visit to 6 requests per 30 minutes", async () => {
    const site = await widgetSite();
    const url = `/api/widget/prompt?key=${site.publicKey}`;
    for (let i = 0; i < 6; i++) expect((await promptPOST(post(url, body(site.publicKey)))).status).not.toBe(429);
    expect((await promptPOST(post(url, body(site.publicKey)))).status).toBe(429);
  });
});

describe("POST /api/widget/prompt-event", () => {
  const send = (key: string, sid: string, id: string, event: string) =>
    eventPOST(post(`/api/widget/prompt-event?key=${key}`, { key, sid, id, event }));

  it("records shown, then the first outcome only", async () => {
    const site = await widgetSite();
    const imp = await makeImpression(site.id, { visitorSessionId: "sid-cccccccc" });
    expect((await send(site.publicKey, "sid-cccccccc", imp.id, "shown")).status).toBe(204);
    expect((await send(site.publicKey, "sid-cccccccc", imp.id, "dismissed")).status).toBe(204);
    await send(site.publicKey, "sid-cccccccc", imp.id, "tapped");
    const [row] = await db.select().from(promptImpressions).where(eq(promptImpressions.id, imp.id));
    expect(row.shownAt).toBeInstanceOf(Date);
    expect(row.outcome).toBe("dismissed");
    expect(row.outcomeAt).toBeInstanceOf(Date);
  });

  it("ignores another visit's or another site's impression", async () => {
    const site = await widgetSite();
    const other = await widgetSite();
    const imp = await makeImpression(site.id, { visitorSessionId: "sid-cccccccc" });
    expect((await send(site.publicKey, "sid-dddddddd", imp.id, "dismissed")).status).toBe(204);
    expect((await send(other.publicKey, "sid-cccccccc", imp.id, "dismissed")).status).toBe(204);
    const [row] = await db
      .select()
      .from(promptImpressions)
      .where(and(eq(promptImpressions.id, imp.id), eq(promptImpressions.siteId, site.id)));
    expect(row.outcome).toBeNull();
  });

  it("rejects an unknown event", async () => {
    const site = await widgetSite();
    const imp = await makeImpression(site.id);
    expect((await send(site.publicKey, "sid-cccccccc", imp.id, "clicked")).status).toBe(400);
  });
});

