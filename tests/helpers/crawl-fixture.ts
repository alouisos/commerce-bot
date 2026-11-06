import { readFileSync } from "node:fs";
import type { Fetcher, FetchResult } from "@/lib/crawl/fetcher";

const read = (n: string) => readFileSync(`tests/fixtures/crawl/${n}`, "utf8");
const HTML = "text/html; charset=utf-8";
const XML = "application/xml";

/** The mini shop, served from https://shop.test. Mutable, so tests can add or remove pages. */
export function shopFiles(): Map<string, { contentType: string; body: string }> {
  return new Map([
    ["https://shop.test/robots.txt", { contentType: "text/plain", body: read("robots.txt") }],
    ["https://shop.test/sitemap_index.xml", { contentType: XML, body: read("sitemap_index.xml") }],
    ["https://shop.test/page-sitemap.xml", { contentType: XML, body: read("page-sitemap.xml") }],
    ["https://shop.test/product-sitemap.xml", { contentType: XML, body: read("product-sitemap.xml") }],
    ["https://shop.test/", { contentType: HTML, body: read("home.html") }],
    ["https://shop.test/ingredients", { contentType: HTML, body: read("ingredients.html") }],
    ["https://shop.test/el", { contentType: HTML, body: read("el.html") }],
    ["https://shop.test/product/argan", { contentType: HTML, body: read("product-argan.html") }],
  ]);
}

export function fakeFetcher(
  files: Map<string, { contentType: string; body: string }>,
  hooks: { requested?: string[]; override?: (url: string) => FetchResult | undefined } = {},
): Fetcher {
  return async (url) => {
    hooks.requested?.push(url);
    const o = hooks.override?.(url);
    if (o) return o;
    // The fake server is lenient about trailing slashes and ignores the query string.
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    const key = u.href.length > 1 && u.pathname !== "/" ? u.href.replace(/\/$/, "") : u.href;
    const f = files.get(key);
    if (!f) return { status: 404, finalUrl: url, contentType: HTML, body: "not found" };
    return { status: 200, finalUrl: url, contentType: f.contentType, body: f.body };
  };
}
