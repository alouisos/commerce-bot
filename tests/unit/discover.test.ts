import { describe, expect, it } from "vitest";
// discover imports sites.ts, which imports the db client (needs env at import; connection is lazy).
import "../apply-test-env";
import { discoverUrls, normalizeUrl } from "@/lib/crawl/discover";
import type { FetchResult } from "@/lib/crawl/fetcher";
import { fakeFetcher, shopFiles } from "../helpers/crawl-fixture";

describe("normalizeUrl", () => {
  it("lowercases host, drops fragment/tracking params and trailing slash", () => {
    expect(normalizeUrl("https://Shop.Test/Product/a/?utm_source=x&fbclid=1&gclid=2&color=red#top")).toBe(
      "https://shop.test/Product/a?color=red",
    );
    expect(normalizeUrl("https://shop.test/")).toBe("https://shop.test/");
    expect(normalizeUrl("not a url")).toBeNull();
  });
});

describe("discoverUrls", () => {
  it("returns page and product URLs, excluding pdf, off-domain and disallowed", async () => {
    const urls = await discoverUrls("https://shop.test", fakeFetcher(shopFiles()));
    expect(urls.sort()).toEqual(
      [
        "https://shop.test/",
        "https://shop.test/el",
        "https://shop.test/ingredients",
        "https://shop.test/product/argan",
      ].sort(),
    );
  });

  it("caps at max", async () => {
    const files = shopFiles();
    const locs = Array.from({ length: 10000 }, (_, i) => `<url><loc>https://shop.test/p/${i}</loc></url>`).join("");
    files.set("https://shop.test/page-sitemap.xml", {
      contentType: "application/xml",
      body: `<urlset>${locs}</urlset>`,
    });
    expect(await discoverUrls("https://shop.test", fakeFetcher(files))).toHaveLength(300);
    expect(await discoverUrls("https://shop.test", fakeFetcher(files), 7)).toHaveLength(7);
  });

  it("falls back to a link crawl when there is no sitemap", async () => {
    const files = shopFiles();
    for (const k of ["robots.txt", "sitemap_index.xml", "page-sitemap.xml", "product-sitemap.xml"]) {
      files.delete(`https://shop.test/${k}`);
    }
    const urls = await discoverUrls("https://shop.test", fakeFetcher(files));
    expect(urls).toContain("https://shop.test/");
    expect(urls).toContain("https://shop.test/product/argan");
    expect(urls).toContain("https://shop.test/el");
    expect(urls.some((u) => u.includes("other.test") || u.endsWith(".pdf") || u.includes("wp-admin"))).toBe(false);
  });

  it("skips .xml.gz sitemaps and survives failing fetches", async () => {
    const files = shopFiles();
    files.set("https://shop.test/sitemap_index.xml", {
      contentType: "application/xml",
      body: "<sitemapindex><sitemap><loc>https://shop.test/a.xml.gz</loc></sitemap><sitemap><loc>https://shop.test/product-sitemap.xml</loc></sitemap></sitemapindex>",
    });
    const boom = (u: string): FetchResult | undefined =>
      u.endsWith("page-sitemap.xml") ? { status: 0, finalUrl: u, contentType: "", body: "" } : undefined;
    const requested: string[] = [];
    const urls = await discoverUrls("https://shop.test", fakeFetcher(files, { override: boom, requested }));
    expect(urls).toEqual(["https://shop.test/product/argan"]);
    expect(requested.some((u) => u.endsWith(".gz"))).toBe(false);
  });

  it("treats apex and www as the same site", async () => {
    const files = shopFiles();
    files.set("https://shop.test/page-sitemap.xml", {
      contentType: "application/xml",
      body: "<urlset><url><loc>https://www.shop.test/about</loc></url></urlset>",
    });
    const urls = await discoverUrls("https://shop.test", fakeFetcher(files));
    expect(urls).toContain("https://www.shop.test/about");
  });

  it("ignores off-site and internal Sitemap: lines in robots.txt", async () => {
    const files = shopFiles();
    files.set("https://shop.test/robots.txt", {
      contentType: "text/plain",
      body: "User-agent: *\nSitemap: http://169.254.169.254/latest/sitemap.xml\nSitemap: https://other.test/sitemap.xml\nSitemap: https://shop.test/sitemap_index.xml",
    });
    const requested: string[] = [];
    const urls = await discoverUrls("https://shop.test", fakeFetcher(files, { requested }));
    expect(urls).toContain("https://shop.test/product/argan");
    expect(requested.some((u) => u.includes("169.254") || u.includes("other.test"))).toBe(false);
  });

  it("fetches at most 50 sitemap files", async () => {
    const files = shopFiles();
    const kids = Array.from({ length: 10000 }, (_, i) => `<sitemap><loc>https://shop.test/s/${i}.xml</loc></sitemap>`).join("");
    files.set("https://shop.test/sitemap_index.xml", { contentType: "application/xml", body: `<sitemapindex>${kids}</sitemapindex>` });
    for (const k of ["page-sitemap.xml", "product-sitemap.xml"]) files.delete(`https://shop.test/${k}`);
    const requested: string[] = [];
    await discoverUrls("https://shop.test", fakeFetcher(files, { requested }));
    expect(requested.filter((u) => u.endsWith(".xml")).length).toBeLessThanOrEqual(50);
  });

  it("stops the link-crawl fallback at 600 attempts when every link 404s", async () => {
    const links = Array.from({ length: 2000 }, (_, i) => `<a href="/p${i}">x</a>`).join("");
    const files = new Map([["https://shop.test/", { contentType: "text/html", body: `<html><body>${links}</body></html>` }]]);
    const requested: string[] = [];
    await discoverUrls("https://shop.test", fakeFetcher(files, { requested }));
    const attempts = requested.filter((u) => !/robots\.txt|sitemap/.test(u));
    expect(attempts.length).toBeLessThanOrEqual(600);
    expect(attempts.length).toBeGreaterThan(100);
  });
});
