import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { leads, monthlyUsage, siteGreetings, sites } from "@/db/schema";
import { getStorage } from "@/lib/storage";
import { monthKey } from "@/lib/usage/meter";
import { COPY } from "@/lib/copy/defaults";
import { GET as configGET, OPTIONS as configOPTIONS } from "@/app/api/widget/config/route";
import { GET as conversationGET } from "@/app/api/widget/conversation/route";
import { GET as imageGET } from "@/app/api/widget/image/[sourceId]/route";
import { GET as greetingImageGET } from "@/app/api/widget/greeting-image/route";
import { POST as leadPOST } from "@/app/api/widget/lead/route";
import type { StoredMessage, WidgetConfig } from "@/shared/widget-protocol";
import { makeAccount, makeConversation, makeMessage, makeSite, makeSource } from "../helpers/factories";
import { resetDb } from "../helpers/db";

beforeEach(resetDb);

const ORIGIN = "https://example.com";
const get = (path: string, origin?: string) =>
  new Request(`http://localhost:3000${path}`, { headers: origin ? { Origin: origin } : {} });
const post = (path: string, body: unknown, origin = ORIGIN, ip?: string) =>
  new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...(ip ? { "X-Forwarded-For": ip } : {}) },
    body: JSON.stringify(body),
  });
const ctx = (sourceId: string) => ({ params: Promise.resolve({ sourceId }) });

async function setup(plan: "trial" | "starter" | "complimentary" = "starter", siteOverrides = {}) {
  const account = await makeAccount({ plan });
  const site = await makeSite(account.id, siteOverrides);
  return { account, site };
}

describe("config", () => {
  it("404 unknown key, 403 bad origin, 200 with CORS", async () => {
    const { site } = await setup();
    expect((await configGET(get("/api/widget/config?key=nope", ORIGIN))).status).toBe(404);
    expect((await configGET(get(`/api/widget/config?key=${site.publicKey}`, "https://evil.com"))).status).toBe(403);
    expect((await configGET(get(`/api/widget/config?key=${site.publicKey}`))).status).toBe(403);
    const res = await configGET(get(`/api/widget/config?key=${site.publicKey}`, ORIGIN));
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const cfg = (await res.json()) as WidgetConfig;
    expect(cfg.mode).toBe("ai");
    expect(cfg.botName).toBe(site.botName);
  });

  it("error responses carry CORS when origin allowed", async () => {
    const { site } = await setup();
    const res = await leadPOST(post(`/api/widget/lead?key=${site.publicKey}`, { key: site.publicKey, sid: "s", cid: null, email: "bad", message: "x" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const bad = await configGET(get(`/api/widget/config?key=${site.publicKey}`, "https://evil.com"));
    expect(bad.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("OPTIONS preflight", async () => {
    const { site } = await setup();
    const ok = await configOPTIONS(new Request(`http://localhost:3000/api/widget/config?key=${site.publicKey}`, { method: "OPTIONS", headers: { Origin: ORIGIN } }));
    expect(ok.status).toBe(204);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(ok.headers.get("Access-Control-Max-Age")).toBe("600");
    const bad = await configOPTIONS(new Request(`http://localhost:3000/api/widget/config?key=${site.publicKey}`, { method: "OPTIONS", headers: { Origin: "https://evil.com" } }));
    expect(bad.status).toBe(403);
    expect(bad.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("greetings by language and defaults", async () => {
    const { site } = await setup();
    const url = (q: string) => `/api/widget/config?key=${site.publicKey}${q}`;
    let cfg = (await (await configGET(get(url("&lang=el-GR"), ORIGIN))).json()) as WidgetConfig;
    expect(cfg.language).toBe("el");
    expect(cfg.greeting.message).toBe(COPY.el.defaultGreeting);
    await db.insert(siteGreetings).values([
      { siteId: site.id, language: "el", message: "Γεια!" },
      { siteId: site.id, language: "en", message: "Hello there" },
    ]);
    cfg = (await (await configGET(get(url("&lang=el-GR"), ORIGIN))).json()) as WidgetConfig;
    expect(cfg.language).toBe("el");
    expect(cfg.greeting.message).toBe("Γεια!");
    expect(cfg.strings.send).toBe(COPY.el.send);
    cfg = (await (await configGET(get(url("&lang=EL"), ORIGIN))).json()) as WidgetConfig;
    expect(cfg.language).toBe("el");
    cfg = (await (await configGET(get(url(""), ORIGIN))).json()) as WidgetConfig;
    expect(cfg.greeting.message).toBe("Hello there");
    await db.delete(siteGreetings).where(eq(siteGreetings.siteId, site.id));
    await db.update(sites).set({ defaultLanguage: "el" }).where(eq(sites.id, site.id));
    cfg = (await (await configGET(get(url("&lang=el"), ORIGIN))).json()) as WidgetConfig;
    expect(cfg.greeting.message).toBe(COPY.el.defaultGreeting);
  });

  it("badge and mode by plan and quota", async () => {
    const comp = await setup("complimentary");
    const starter = await setup("starter");
    const cfg = async (s: { site: { publicKey: string } }) =>
      (await (await configGET(get(`/api/widget/config?key=${s.site.publicKey}`, ORIGIN))).json()) as WidgetConfig;
    expect((await cfg(comp)).showBadge).toBe(false);
    expect((await cfg(starter)).showBadge).toBe(true);

    const expired = await makeAccount({ plan: "trial", trialEndsAt: new Date(Date.now() - 1000) });
    const es = await makeSite(expired.id);
    expect((await cfg({ site: es })).mode).toBe("fallback");

    await db.insert(monthlyUsage).values({ accountId: starter.account.id, month: monthKey(new Date()), conversations: 750 });
    expect((await cfg(starter)).mode).toBe("fallback");
  });

  it("mode is fallback once this month's AI cost reaches the plan's ceiling", async () => {
    const s = await setup("starter");
    const cfg = async () =>
      (await (await configGET(get(`/api/widget/config?key=${s.site.publicKey}`, ORIGIN))).json()) as WidgetConfig;
    await db.insert(monthlyUsage).values({ accountId: s.account.id, month: monthKey(new Date()), aiCostMicros: 24_999_999 });
    expect((await cfg()).mode).toBe("ai");
    await db.update(monthlyUsage).set({ aiCostMicros: 25_000_000 }).where(eq(monthlyUsage.accountId, s.account.id));
    expect((await cfg()).mode).toBe("fallback");
  });

  it("updates lastSeenAt at most once a minute", async () => {
    const { site } = await setup();
    await configGET(get(`/api/widget/config?key=${site.publicKey}`, ORIGIN));
    const [a] = await db.select().from(sites).where(eq(sites.id, site.id));
    expect(a.lastSeenAt).not.toBeNull();
    await configGET(get(`/api/widget/config?key=${site.publicKey}`, ORIGIN));
    const [b] = await db.select().from(sites).where(eq(sites.id, site.id));
    expect(b.lastSeenAt!.getTime()).toBe(a.lastSeenAt!.getTime());
  });

  it("greeting image url carries a version hash", async () => {
    const { site } = await setup("starter", { greetingImageKey: "sites/x/greeting/a.png" });
    const cfg = (await (await configGET(get(`/api/widget/config?key=${site.publicKey}`, ORIGIN))).json()) as WidgetConfig;
    expect(cfg.greeting.imageUrl).toMatch(
      new RegExp(`^http://localhost:3000/api/widget/greeting-image\\?key=${site.publicKey}&v=[0-9a-f]{8}$`),
    );
  });
});

describe("conversation", () => {
  it("requires matching site and sid; returns ordered messages with images", async () => {
    const { site } = await setup();
    const img = await makeSource(site.id, { kind: "image", caption: "A cap", storageKey: "k" });
    const conv = await makeConversation(site.id, { visitorSessionId: "sid-1" });
    await makeMessage(conv.id, { role: "visitor", content: "one", createdAt: new Date("2026-01-01T00:00:00Z") });
    await makeMessage(conv.id, {
      role: "bot",
      content: "two",
      imageIds: [img.id, "00000000-0000-4000-8000-000000000000"],
      createdAt: new Date("2026-01-01T00:00:01Z"),
    });
    const q = (sid: string, cid = conv.id) => `/api/widget/conversation?key=${site.publicKey}&sid=${sid}&cid=${cid}`;
    expect((await conversationGET(get(q("wrong"), ORIGIN))).status).toBe(404);
    const res = await conversationGET(get(q("sid-1"), ORIGIN));
    expect(res.status).toBe(200);
    const { messages } = (await res.json()) as { messages: StoredMessage[] };
    expect(messages.map((m) => m.content)).toEqual(["one", "two"]);
    expect(messages[1].images).toEqual([
      { id: img.id, url: `http://localhost:3000/api/widget/image/${img.id}?key=${site.publicKey}`, caption: "A cap" },
    ]);
  });

  it("never serves another site's conversation", async () => {
    const a = await setup();
    const b = await setup();
    const conv = await makeConversation(b.site.id, { visitorSessionId: "s" });
    const res = await conversationGET(get(`/api/widget/conversation?key=${a.site.publicKey}&sid=s&cid=${conv.id}`, ORIGIN));
    expect(res.status).toBe(404);
  });
});

describe("images", () => {
  it("serves own image, 404 for another site's", async () => {
    const a = await setup();
    const b = await setup();
    await getStorage().put("t9/img.png", new Uint8Array([1, 2, 3]), "image/png");
    const mine = await makeSource(a.site.id, { kind: "image", storageKey: "t9/img.png", mimeType: "image/png" });
    const theirs = await makeSource(b.site.id, { kind: "image", storageKey: "t9/img.png", mimeType: "image/png" });
    const ok = await imageGET(get(`/api/widget/image/${mine.id}?key=${a.site.publicKey}`), ctx(mine.id));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/png");
    expect(ok.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(ok.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await imageGET(get(`/api/widget/image/${theirs.id}?key=${a.site.publicKey}`), ctx(theirs.id))).status).toBe(404);
    expect((await imageGET(get(`/api/widget/image/not-a-uuid?key=${a.site.publicKey}`), ctx("not-a-uuid"))).status).toBe(404);
    expect((await imageGET(get(`/api/widget/image/${mine.id}?key=bad`), ctx(mine.id))).status).toBe(404);
  });

  it("serves the greeting image", async () => {
    const { site } = await setup("starter", { greetingImageKey: "t9/greet.png" });
    await getStorage().put("t9/greet.png", new Uint8Array([9]), "image/png");
    const res = await greetingImageGET(get(`/api/widget/greeting-image?key=${site.publicKey}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
    const { site: none } = await setup();
    expect((await greetingImageGET(get(`/api/widget/greeting-image?key=${none.publicKey}`))).status).toBe(404);
  });
});

describe("lead", () => {
  it("validates, rate-limits per sid, stores", async () => {
    const { site } = await setup();
    const body = (o: object = {}) => ({ key: site.publicKey, sid: "visitor_sid_9", cid: null, email: " Foo@Example.COM ", message: " Hi ", ...o });
    const url = `/api/widget/lead?key=${site.publicKey}`;
    expect((await leadPOST(post(url, body({ email: "nope" })))).status).toBe(400);
    expect((await leadPOST(post(url, body({ message: "   " })))).status).toBe(400);
    expect((await leadPOST(post(url, body({ message: "x".repeat(2001) })))).status).toBe(400);
    expect((await leadPOST(post("/api/widget/lead?key=nope", body()))).status).toBe(404);
    expect((await leadPOST(post(url, body(), "https://evil.com"))).status).toBe(403);

    const res = await leadPOST(post(url, body()));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await db.select().from(leads).where(eq(leads.siteId, site.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "foo@example.com", message: "Hi", source: "fallback", conversationId: null });
    for (let i = 0; i < 4; i++) expect((await leadPOST(post(url, body()))).status).toBe(201);
    expect((await leadPOST(post(url, body()))).status).toBe(429);
    expect((await leadPOST(post(url, body({ sid: "other_visitor" })))).status).toBe(201);
  });

  it("rejects a sid outside 8-100 of [A-Za-z0-9_-], like chat", async () => {
    const { site } = await setup();
    const url = `/api/widget/lead?key=${site.publicKey}`;
    const body = (sid: unknown) => ({ key: site.publicKey, sid, cid: null, email: "a@b.co", message: "m" });
    for (const sid of ["short", "has spaces in it", "x".repeat(101), "bad/chars!", 12345678]) {
      expect((await leadPOST(post(url, body(sid)))).status).toBe(400);
    }
    expect((await leadPOST(post(url, body("a".repeat(8))))).status).toBe(201);
    expect((await leadPOST(post(url, body("A_b-".repeat(25))))).status).toBe(201);
  });

  it("the 31st lead in an hour from one IP is rate limited, even with rotating sids", async () => {
    const { site } = await setup();
    const url = `/api/widget/lead?key=${site.publicKey}`;
    const body = (i: number) => ({ key: site.publicKey, sid: `rotating_sid_${i}`, cid: null, email: "a@b.co", message: "m" });
    for (let i = 0; i < 30; i++) expect((await leadPOST(post(url, body(i), ORIGIN, "198.51.100.7"))).status).toBe(201);
    const res = await leadPOST(post(url, body(30), ORIGIN, "198.51.100.7"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect((await leadPOST(post(url, body(31), ORIGIN, "198.51.100.8"))).status).toBe(201);
  });

  it("stores cid only when it belongs to the site and sid", async () => {
    const a = await setup();
    const b = await setup();
    const mine = await makeConversation(a.site.id, { visitorSessionId: "visitor_s1" });
    const foreign = await makeConversation(b.site.id, { visitorSessionId: "visitor_s1" });
    const url = `/api/widget/lead?key=${a.site.publicKey}`;
    const base = { key: a.site.publicKey, sid: "visitor_s1", email: "a@b.co", message: "m" };
    expect((await leadPOST(post(url, { ...base, cid: mine.id }))).status).toBe(201);
    expect((await leadPOST(post(url, { ...base, cid: foreign.id }))).status).toBe(201);
    expect((await leadPOST(post(url, { ...base, cid: "garbage" }))).status).toBe(201);
    const rows = await db.select().from(leads).where(eq(leads.siteId, a.site.id));
    expect(rows.map((r) => r.conversationId).sort()).toEqual([mine.id, null, null].sort());
  });
});
