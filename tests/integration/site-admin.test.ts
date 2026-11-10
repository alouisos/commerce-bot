import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { conversations, kbChunks, kbSources, leads, messages, siteGreetings, sites, usageEvents } from "@/db/schema";
import { clearEnqueuedJobs, enqueuedJobs } from "@/lib/jobs";
import { replaceChunks } from "@/lib/kb/store";
import { createSite } from "@/lib/sites";
import { getStorage } from "@/lib/storage";
import { recordModelUsage } from "@/lib/usage/meter";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeMembership, makeMessage, makeSite, makeSource, makeUser } from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { renderToStaticMarkup } from "react-dom/server";
import { deleteSiteAction, saveEmailSettingsAction, saveSiteDetailsAction } from "@/app/app/sites/[siteId]/settings/actions";
import SettingsPage from "@/app/app/sites/[siteId]/settings/page";

beforeEach(async () => {
  await resetDb();
  clearEnqueuedJobs();
});

async function setup(plan: "starter" | "trial" = "starter") {
  const u = await makeUser();
  const account = await makeAccount({ plan });
  await makeMembership(account.id, u.id);
  current.user = { id: u.id, email: u.email };
  const site = await makeSite(account.id, {
    name: "Old Name",
    baseUrl: "https://old-shop.com",
    allowedOrigins: ["https://old-shop.com", "https://www.old-shop.com", "https://staging.old-shop.com"],
  });
  const foreign = await makeSite((await makeAccount()).id, { name: "Not yours" });
  return { account, site, foreign };
}

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const reload = async (id: string) => (await db.select().from(sites).where(eq(sites.id, id)))[0];

async function outcome(p: Promise<unknown>): Promise<{ value?: unknown; digest?: string }> {
  try {
    return { value: await p };
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (!digest) throw e;
    return { digest };
  }
}

describe("site details (name and URL)", () => {
  it("renames without touching origins or crawling", async () => {
    const { site } = await setup();
    const res = await saveSiteDetailsAction(site.id, {}, form({ name: "  New Name  ", baseUrl: "https://old-shop.com/" }));
    expect(res).toEqual({ saved: true });
    const row = await reload(site.id);
    expect(row.name).toBe("New Name");
    expect(row.baseUrl).toBe("https://old-shop.com");
    expect(row.allowedOrigins).toEqual(site.allowedOrigins);
    expect(enqueuedJobs()).toEqual([]);
  });

  it("a new URL is normalized, replaces the derived origins, keeps manual ones, and starts a crawl", async () => {
    const { site } = await setup();
    const res = await saveSiteDetailsAction(site.id, {}, form({ name: "Old Name", baseUrl: " https://www.new-shop.com/shop/ " }));
    expect(res).toEqual({ saved: true });
    const row = await reload(site.id);
    expect(row.baseUrl).toBe("https://www.new-shop.com/shop");
    expect(row.allowedOrigins).toEqual(["https://www.new-shop.com", "https://new-shop.com", "https://staging.old-shop.com"]);
    expect(enqueuedJobs()).toEqual([{ name: "crawl-site", data: { siteId: site.id }, options: { singletonKey: site.id } }]);
  });

  it("rejects an invalid name or URL and changes nothing", async () => {
    const { site } = await setup();
    expect((await saveSiteDetailsAction(site.id, {}, form({ name: "  ", baseUrl: "https://x.com" }))).error).toMatch(/Name/);
    expect((await saveSiteDetailsAction(site.id, {}, form({ name: "n".repeat(101), baseUrl: "https://x.com" }))).error).toMatch(/Name/);
    expect((await saveSiteDetailsAction(site.id, {}, form({ name: "Ok", baseUrl: "ftp://x.com" }))).error).toMatch(/http/);
    expect((await saveSiteDetailsAction(site.id, {}, form({ name: "Ok", baseUrl: "not a url" }))).error).toMatch(/valid/);
    const row = await reload(site.id);
    expect([row.name, row.baseUrl]).toEqual(["Old Name", "https://old-shop.com"]);
    expect(enqueuedJobs()).toEqual([]);
  });

  it("is not found for another account's site", async () => {
    const { foreign } = await setup();
    const r = await outcome(saveSiteDetailsAction(foreign.id, {}, form({ name: "Mine now", baseUrl: "https://evil.com" })));
    expect(r.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect((await reload(foreign.id)).name).toBe("Not yours");
  });
});

describe("delete website", () => {
  async function populated(siteId: string, accountId: string) {
    const storage = getStorage();
    const greetingKey = `sites/${siteId}/greeting/g.png`;
    await storage.put(greetingKey, new Uint8Array([1]), "image/png");
    await db.update(sites).set({ greetingImageKey: greetingKey }).where(eq(sites.id, siteId));
    const docKey = `sites/${siteId}/kb/doc/a.txt`;
    await storage.put(docKey, new Uint8Array([2]), "text/plain");
    const doc = await makeSource(siteId, { kind: "document", storageKey: docKey, mimeType: "text/plain" });
    await replaceChunks({ sourceId: doc.id, siteId, texts: ["hello"] });
    await db.insert(siteGreetings).values({ siteId, language: "en", message: "Hi" });
    const conv = await makeConversation(siteId);
    await makeMessage(conv.id);
    await db.insert(leads).values({ siteId, conversationId: conv.id, email: "a@b.co", message: "m" });
    await recordModelUsage({
      accountId,
      siteId,
      kind: "chat",
      model: "claude-opus-5-5",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
    return { greetingKey, docKey };
  }

  it("needs the site's name typed to confirm", async () => {
    const { site } = await setup();
    const r = await outcome(deleteSiteAction(site.id, {}, form({ confirmName: "old name" })));
    expect(r.value).toEqual({ error: expect.stringMatching(/type the website's name/i) });
    expect(await reload(site.id)).toBeDefined();
  });

  it("deletes the site, its children and storage objects, redirects to /app, and frees the plan slot", async () => {
    const { account, site } = await setup("starter");
    const keys = await populated(site.id, account.id);
    // Starter allows one website: this account is full.
    await expect(createSite(account.id, { name: "Another", baseUrl: "https://another.com" })).rejects.toThrow(/allows 1 website/);

    const r = await outcome(deleteSiteAction(site.id, {}, form({ confirmName: " Old Name " })));
    expect(r.digest).toMatch(/^NEXT_REDIRECT;[a-z]+;\/app;/);

    expect(await reload(site.id)).toBeUndefined();
    for (const table of [kbSources, kbChunks, siteGreetings, conversations, leads]) {
      expect(await db.select().from(table).where(eq(table.siteId, site.id))).toHaveLength(0);
    }
    expect(await db.select().from(messages)).toHaveLength(0);
    // Usage stays with the account (the month's AI spend is not reset by deleting a site).
    expect((await db.select().from(usageEvents)).map((e) => e.siteId)).toEqual([null]);
    expect(await getStorage().get(keys.greetingKey)).toBeNull();
    expect(await getStorage().get(keys.docKey)).toBeNull();

    await expect(createSite(account.id, { name: "Another", baseUrl: "https://another.com" })).resolves.toMatchObject({ name: "Another" });
  });

  it("still deletes the site when removing a storage object fails", async () => {
    const { account, site } = await setup();
    await populated(site.id, account.id);
    const storage = getStorage();
    const del = vi.spyOn(storage, "delete").mockRejectedValue(new Error("bucket down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await outcome(deleteSiteAction(site.id, {}, form({ confirmName: "Old Name" })));
    expect(r.digest).toMatch(/^NEXT_REDIRECT;/);
    expect(await reload(site.id)).toBeUndefined();
    expect(errors).toHaveBeenCalled();
    del.mockRestore();
    errors.mockRestore();
  });

  it("is not found for another account's site, which is left alone", async () => {
    const { foreign } = await setup();
    const r = await outcome(deleteSiteAction(foreign.id, {}, form({ confirmName: "Not yours" })));
    expect(r.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(await reload(foreign.id)).toBeDefined();
  });
});

describe("settings page", () => {
  it("shows the website name/URL form and the delete form", async () => {
    const { site } = await setup();
    const html = renderToStaticMarkup(await SettingsPage({ params: Promise.resolve({ siteId: site.id }) } as never));
    expect(html).toMatch(/<input[^>]*name="name" value="Old Name"/);
    expect(html).toMatch(/<input[^>]*name="baseUrl" value="https:\/\/old-shop.com"/);
    expect(html.match(/<textarea name="allowedOrigins"[^>]*>([^<]*)</)?.[1]).toBe(site.allowedOrigins.join("\n"));
    expect(html).toContain('name="confirmName"');
    expect(html).toContain("Delete website");
  });
});

describe("email & privacy settings", () => {
  const emailForm = (patch: Record<string, string> = {}) =>
    form({
      emailMode: "approval",
      emailIntervalDays: "6",
      emailMaxPerPerson: "2",
      emailFromName: "",
      emailFromLocal: "Shop",
      retentionMonths: "12",
      consentMode: "required",
      ...patch,
    });

  it("shows automatic sending as needing the Growth plan on starter", async () => {
    const { site } = await setup("starter");
    const html = renderToStaticMarkup(await SettingsPage({ params: Promise.resolve({ siteId: site.id }) } as never));
    expect(html).toContain("Email &amp; privacy");
    expect(html).toContain("Needs the Growth plan");
    expect(html).toMatch(/<input(?=[^>]*value="automatic")(?=[^>]*disabled)[^>]*>/);
    expect(html).toContain("@your domain");
  });

  it("saves through the action and reports errors", async () => {
    const { site } = await setup("starter");
    expect(await saveEmailSettingsAction(site.id, {}, emailForm())).toEqual({ saved: true });
    expect(await reload(site.id)).toMatchObject({
      emailIntervalDays: 6,
      emailMaxPerPerson: 2,
      emailFromLocal: "shop",
      retentionMonths: 12,
      consentMode: "required",
    });
    expect(await saveEmailSettingsAction(site.id, {}, emailForm({ emailMode: "automatic" }))).toEqual({
      error: "Automatic sending needs the Growth plan or higher",
    });
  });

  it("refuses another account's site", async () => {
    const { foreign } = await setup("starter");
    expect((await outcome(saveEmailSettingsAction(foreign.id, {}, emailForm()))).digest).toMatch(/404/);
  });
});
