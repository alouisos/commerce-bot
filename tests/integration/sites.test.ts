import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { siteGreetings, sites } from "@/db/schema";
import { enqueuedJobs } from "@/lib/jobs";
import { PlanLimitError, ValidationError } from "@/lib/errors";
import { createSite, getSiteByPublicKey } from "@/lib/sites";
import { removeGreetingImage, setGreetingImage, updateSiteSettings } from "@/lib/site-settings";
import { getStorage } from "@/lib/storage";
import { makeAccount, makeSite } from "../helpers/factories";
import { resetDb } from "../helpers/db";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const settings = (greetings: { language: string; message: string }[]) => ({
  botName: "Mila",
  accentColor: "#112233",
  corner: "bottom-left",
  defaultLanguage: "el",
  guardrails: "No medical advice",
  greetings,
  allowedOrigins: ["https://a.com"],
  proactivity: "gentle",
});

beforeEach(resetDb);

describe("createSite", () => {
  it("creates, normalizes, enqueues, and enforces the plan limit", async () => {
    const account = await makeAccount({ plan: "starter" });
    const site = await createSite(account.id, { name: " Shop ", baseUrl: "https://www.milianjo.com/shop/" });
    expect(site.name).toBe("Shop");
    expect(site.baseUrl).toBe("https://www.milianjo.com/shop");
    expect(site.allowedOrigins).toEqual(["https://www.milianjo.com", "https://milianjo.com"]);
    expect(site.publicKey).toMatch(/^pk_[A-Za-z0-9]{24}$/);
    expect(enqueuedJobs()).toEqual([{ name: "crawl-site", data: { siteId: site.id }, options: { singletonKey: site.id } }]);
    await expect(createSite(account.id, { name: "Two", baseUrl: "https://two.com" })).rejects.toBeInstanceOf(PlanLimitError);
  });
  it("validates name and url", async () => {
    const account = await makeAccount({ plan: "pro" });
    await expect(createSite(account.id, { name: "", baseUrl: "https://a.com" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSite(account.id, { name: "x".repeat(101), baseUrl: "https://a.com" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSite(account.id, { name: "A", baseUrl: "nope" })).rejects.toBeInstanceOf(ValidationError);
  });
  it("getSiteByPublicKey joins the account", async () => {
    const account = await makeAccount();
    const site = await makeSite(account.id, { publicKey: "pk_abc" });
    const found = await getSiteByPublicKey("pk_abc");
    expect(found?.id).toBe(site.id);
    expect(found?.account.id).toBe(account.id);
    expect(await getSiteByPublicKey("pk_missing")).toBeNull();
  });
});

describe("updateSiteSettings", () => {
  it("saves fields and replaces greetings", async () => {
    const account = await makeAccount();
    const site = await makeSite(account.id);
    await updateSiteSettings(site.id, settings([{ language: "el", message: "Γεια" }, { language: "en", message: "Hi" }]));
    let rows = await db.select().from(siteGreetings).where(eq(siteGreetings.siteId, site.id));
    expect(rows.map((r) => r.language).sort()).toEqual(["el", "en"]);
    await updateSiteSettings(site.id, settings([{ language: "en", message: "Hello" }]));
    rows = await db.select().from(siteGreetings).where(eq(siteGreetings.siteId, site.id));
    expect(rows.map((r) => [r.language, r.message])).toEqual([["en", "Hello"]]);
    const [s] = await db.select().from(sites).where(eq(sites.id, site.id));
    expect(s).toMatchObject({ botName: "Mila", corner: "bottom-left", defaultLanguage: "el", allowedOrigins: ["https://a.com"] });
  });
  it("throws ValidationError on invalid input", async () => {
    const account = await makeAccount();
    const site = await makeSite(account.id);
    await expect(updateSiteSettings(site.id, { ...settings([]), accentColor: "red" })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateSiteSettings(site.id, { ...settings([]), proactivity: "loud" })).rejects.toBeInstanceOf(ValidationError);
  });
  it("saves the proactivity dial (gentle by default)", async () => {
    const account = await makeAccount();
    const site = await makeSite(account.id);
    expect(site.proactivity).toBe("gentle");
    await updateSiteSettings(site.id, { ...settings([]), proactivity: "off" });
    const [s] = await db.select().from(sites).where(eq(sites.id, site.id));
    expect(s.proactivity).toBe("off");
  });
});

describe("greeting image", () => {
  const png = (extra = 0) => new File([new Uint8Array([...PNG, ...new Array(extra).fill(0)])], "a.png", { type: "image/png" });
  it("rejects too large, wrong type, and mismatched content", async () => {
    const account = await makeAccount();
    const site = await makeSite(account.id);
    await expect(setGreetingImage(site.id, png(3 * 1024 * 1024))).rejects.toBeInstanceOf(ValidationError);
    const pdf = new File([new TextEncoder().encode("%PDF-1.4")], "a.pdf", { type: "application/pdf" });
    await expect(setGreetingImage(site.id, pdf)).rejects.toBeInstanceOf(ValidationError);
    const liar = new File([new TextEncoder().encode("%PDF-1.4")], "a.png", { type: "image/png" });
    await expect(setGreetingImage(site.id, liar)).rejects.toBeInstanceOf(ValidationError);
    const jpgAsPng = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "a.png", { type: "image/png" });
    await expect(setGreetingImage(site.id, jpgAsPng)).rejects.toBeInstanceOf(ValidationError);
  });
  it("stores, replaces and removes", async () => {
    const account = await makeAccount();
    const site = await makeSite(account.id);
    await setGreetingImage(site.id, png());
    const [a] = await db.select().from(sites).where(eq(sites.id, site.id));
    expect(a.greetingImageKey).toMatch(new RegExp(`^sites/${site.id}/greeting/.+\\.png$`));
    expect(await getStorage().get(a.greetingImageKey!)).not.toBeNull();
    await setGreetingImage(site.id, png(5));
    const [b] = await db.select().from(sites).where(eq(sites.id, site.id));
    expect(b.greetingImageKey).not.toBe(a.greetingImageKey);
    expect(await getStorage().get(a.greetingImageKey!)).toBeNull();
    await removeGreetingImage(site.id);
    const [c] = await db.select().from(sites).where(eq(sites.id, site.id));
    expect(c.greetingImageKey).toBeNull();
    expect(await getStorage().get(b.greetingImageKey!)).toBeNull();
  });
});
