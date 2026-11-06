import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { kbChunks, kbSources, sites } from "@/db/schema";
import { clearEnqueuedJobs, enqueuedJobs } from "@/lib/jobs";
import { crawlSite } from "@/lib/crawl/crawl-site";
import { crawlStatusLabel, isCrawlRunning, recrawlNow, weeklyRecrawl } from "@/lib/crawl/recrawl";
import { resetDb } from "../helpers/db";
import { makeAccount, makeSite } from "../helpers/factories";
import { fakeFetcher, shopFiles } from "../helpers/crawl-fixture";

const opts = { delayMs: 0 };

async function setup() {
  const acc = await makeAccount();
  return makeSite(acc.id, { baseUrl: "https://shop.test", allowedOrigins: ["https://shop.test", "https://www.shop.test"] });
}
const site$ = async (id: string) => (await db.select().from(sites).where(eq(sites.id, id)))[0];
const pages = (id: string) => db.select().from(kbSources).where(and(eq(kbSources.siteId, id), eq(kbSources.kind, "page")));

describe("crawlSite", () => {
  beforeEach(async () => {
    await resetDb();
    clearEnqueuedJobs();
  });

  it("records when the crawl started, while it is crawling", async () => {
    const site = await setup();
    const before = Date.now();
    let during: { crawlStatus: string; crawlStartedAt: Date | null } | undefined;
    const files = shopFiles();
    const inner = fakeFetcher(files);
    await crawlSite(
      site.id,
      async (url) => {
        during ??= await site$(site.id);
        return inner(url);
      },
      opts,
    );
    expect(during?.crawlStatus).toBe("crawling");
    expect(during?.crawlStartedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const after = await site$(site.id);
    expect(after.crawlStartedAt?.getTime()).toBe(during?.crawlStartedAt?.getTime());
  });

  it("first crawl stores pages, product chunk and status", async () => {
    const site = await setup();
    const r = await crawlSite(site.id, fakeFetcher(shopFiles()), opts);
    expect(r.pages).toBe(4);
    expect(r.changed).toBe(r.pages);
    expect(r.removed).toBe(0);
    const s = await site$(site.id);
    expect(s.crawlStatus).toBe("done");
    expect(s.lastCrawledAt).not.toBeNull();
    const rows = await pages(site.id);
    expect(rows.every((p) => p.status === "ready")).toBe(true);
    const chunks = await db.select().from(kbChunks).where(eq(kbChunks.siteId, site.id));
    const product = chunks.find((c) => c.content.includes("Product: Argan Leave-In — 24.90 EUR"));
    expect(product?.content).toContain("Page: Argan Leave-In\nURL: https://shop.test/product/argan\n");
  });

  it("second crawl with nothing changed re-chunks nothing", async () => {
    const site = await setup();
    await crawlSite(site.id, fakeFetcher(shopFiles()), opts);
    const r = await crawlSite(site.id, fakeFetcher(shopFiles()), opts);
    expect(r).toMatchObject({ pages: 4, changed: 0, removed: 0 });
  });

  it("re-chunks a changed page and preserves excluded", async () => {
    const site = await setup();
    const files = shopFiles();
    await crawlSite(site.id, fakeFetcher(files), opts);
    const [ing] = (await pages(site.id)).filter((p) => p.url === "https://shop.test/ingredients");
    await db.update(kbSources).set({ excluded: true }).where(eq(kbSources.id, ing.id));
    const f = files.get("https://shop.test/ingredients")!;
    files.set("https://shop.test/ingredients", { ...f, body: f.body.replace("aloe vera", "honey") });
    const r = await crawlSite(site.id, fakeFetcher(files), opts);
    expect(r.changed).toBe(1);
    const after = (await pages(site.id)).find((p) => p.id === ing.id)!;
    expect(after.excluded).toBe(true);
    const ch = await db.select().from(kbChunks).where(eq(kbChunks.sourceId, ing.id));
    expect(ch.map((c) => c.content).join("")).toContain("honey");
  });

  it("deletes pages that disappeared from the sitemap", async () => {
    const site = await setup();
    const files = shopFiles();
    await crawlSite(site.id, fakeFetcher(files), opts);
    files.set("https://shop.test/page-sitemap.xml", {
      contentType: "application/xml",
      body: "<urlset><url><loc>https://shop.test/</loc></url><url><loc>https://shop.test/ingredients/</loc></url></urlset>",
    });
    const r = await crawlSite(site.id, fakeFetcher(files), opts);
    // /el is gone; /product/argan remains via the product sitemap.
    expect(r.removed).toBe(1);
    expect((await pages(site.id)).map((p) => p.url).sort()).toEqual([
      "https://shop.test/",
      "https://shop.test/ingredients",
      "https://shop.test/product/argan",
    ]);
  });

  it("survives a 500 and an off-site redirect", async () => {
    const site = await setup();
    const fetcher = fakeFetcher(shopFiles(), {
      override: (u) => {
        if (u === "https://shop.test/ingredients") return { status: 500, finalUrl: u, contentType: "text/html", body: "err" };
        if (u === "https://shop.test/el") return { status: 200, finalUrl: "https://evil.test/", contentType: "text/html", body: "<p>hi</p>" };
        return undefined;
      },
    });
    const r = await crawlSite(site.id, fetcher, opts);
    expect(r.pages).toBe(2);
    expect((await site$(site.id)).crawlStatus).toBe("done");
  });

  it("does not delete knowledge when the site is entirely down", async () => {
    const site = await setup();
    await crawlSite(site.id, fakeFetcher(shopFiles()), opts);
    const down = fakeFetcher(shopFiles(), {
      override: (u) => ({ status: 503, finalUrl: u, contentType: "text/html", body: "" }),
    });
    const r = await crawlSite(site.id, down, opts);
    expect(r.removed).toBe(0);
    expect((await site$(site.id)).crawlStatus).toBe("failed");
    expect(await pages(site.id)).toHaveLength(4);
  });

  it("skips empty pages and never leaves status crawling after an exception", async () => {
    const site = await setup();
    const files = shopFiles();
    files.set("https://shop.test/el", { contentType: "text/html", body: "<html><body><script>1</script></body></html>" });
    const r = await crawlSite(site.id, fakeFetcher(files), opts);
    expect(r.pages).toBe(3);
    const boom = async () => {
      throw new Error("boom");
    };
    await expect(crawlSite(site.id, boom, opts)).rejects.toThrow("boom");
    expect((await site$(site.id)).crawlStatus).toBe("failed");
  });
});

describe("recrawl", () => {
  beforeEach(async () => {
    await resetDb();
    clearEnqueuedJobs();
  });
  const HOUR = 3_600_000;
  const crawlJob = (siteId: string) => ({ name: "crawl-site", data: { siteId }, options: { singletonKey: siteId } });

  it("recrawlNow enqueues unless a crawl is running", async () => {
    const site = await setup();
    await recrawlNow(site.id);
    expect(enqueuedJobs()).toEqual([crawlJob(site.id)]);
    clearEnqueuedJobs();
    await db.update(sites).set({ crawlStatus: "crawling", crawlStartedAt: new Date(Date.now() - 60_000) }).where(eq(sites.id, site.id));
    await recrawlNow(site.id);
    expect(enqueuedJobs()).toEqual([]);
  });
  it("recrawlNow re-enqueues a crawl that started more than 3 hours ago (stale)", async () => {
    const site = await setup();
    await db.update(sites).set({ crawlStatus: "crawling", crawlStartedAt: new Date(Date.now() - 4 * HOUR) }).where(eq(sites.id, site.id));
    await recrawlNow(site.id);
    expect(enqueuedJobs()).toEqual([crawlJob(site.id)]);
  });
  it("a crawling site with no recorded start (pre-migration row) counts as stale", async () => {
    const site = await setup();
    await db.update(sites).set({ crawlStatus: "crawling", crawlStartedAt: null }).where(eq(sites.id, site.id));
    await recrawlNow(site.id);
    expect(enqueuedJobs()).toEqual([crawlJob(site.id)]);
  });
  it("weeklyRecrawl enqueues for every site, keyed by site", async () => {
    const a = await setup();
    const b = await setup();
    await weeklyRecrawl();
    expect([...enqueuedJobs()].sort((x, y) => ((x.data as { siteId: string }).siteId < (y.data as { siteId: string }).siteId ? -1 : 1))).toEqual(
      [crawlJob(a.id), crawlJob(b.id)].sort((x, y) => (x.data.siteId < y.data.siteId ? -1 : 1)),
    );
  });
  it("labels a crawl stale after 3 hours, and only a fresh crawl counts as running", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    const at = (h: number) => new Date(now.getTime() - h * HOUR);
    expect(isCrawlRunning({ crawlStatus: "crawling", crawlStartedAt: at(1) }, now)).toBe(true);
    expect(isCrawlRunning({ crawlStatus: "crawling", crawlStartedAt: at(4) }, now)).toBe(false);
    expect(isCrawlRunning({ crawlStatus: "done", crawlStartedAt: at(1) }, now)).toBe(false);
    expect(crawlStatusLabel({ crawlStatus: "crawling", crawlStartedAt: at(1) }, now)).toBe("crawling");
    expect(crawlStatusLabel({ crawlStatus: "crawling", crawlStartedAt: at(4) }, now)).toBe("stale");
    expect(crawlStatusLabel({ crawlStatus: "crawling", crawlStartedAt: null }, now)).toBe("stale");
    expect(crawlStatusLabel({ crawlStatus: "done", crawlStartedAt: at(4) }, now)).toBe("done");
  });
});
