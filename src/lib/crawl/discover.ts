import * as cheerio from "cheerio";
import { deriveAllowedOrigins } from "@/lib/sites";
import type { Fetcher } from "./fetcher";
import { parseRobots, sitemapsFromRobots } from "./robots";

export const MAX_PAGES = 300;
const MAX_SITEMAP_FETCHES = 50;
const MAX_LINK_FETCHES = 600;
const NON_HTML = /\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|css|js|xml)$/i;
const DEFAULT_SITEMAPS = ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"];

/** Lowercased host, no fragment, no tracking params, no trailing slash except on the root path. */
export function normalizeUrl(input: string, base?: string): string | null {
  let u: URL;
  try {
    u = new URL(input, base);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) {
    if (k.startsWith("utm_") || k === "fbclid" || k === "gclid") u.searchParams.delete(k);
  }
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  return u.href;
}

export function isSameSite(url: string, baseUrl: string): boolean {
  try {
    return deriveAllowedOrigins(baseUrl).includes(new URL(url).origin);
  } catch {
    return false;
  }
}

export async function discoverUrls(baseUrl: string, fetcher: Fetcher, max = MAX_PAGES): Promise<string[]> {
  const origin = new URL(baseUrl).origin;
  const robotsRes = await fetcher(`${origin}/robots.txt`);
  const robotsTxt = robotsRes.status === 200 ? robotsRes.body : "";
  const allowed = parseRobots(robotsTxt);

  const found = new Set<string>();
  const accept = (raw: string, base?: string): string | null => {
    const n = normalizeUrl(raw, base);
    if (!n || !isSameSite(n, baseUrl)) return null;
    const { pathname } = new URL(n);
    if (NON_HTML.test(pathname) || !allowed(pathname)) return null;
    return n;
  };

  const seenMaps = new Set<string>();
  let sitemapFetches = 0;
  async function readSitemap(url: string, depth: number): Promise<void> {
    if (found.size >= max || depth > 3 || seenMaps.has(url)) return;
    seenMaps.add(url);
    if (/\.xml\.gz(\?|$)/i.test(url)) return;
    if (sitemapFetches >= MAX_SITEMAP_FETCHES) return;
    sitemapFetches++;
    const res = await fetcher(url);
    if (res.status !== 200) return;
    const $ = cheerio.load(res.body, { xml: true });
    const children = $("sitemapindex > sitemap > loc")
      .map((_, el) => $(el).text().trim())
      .get();
    for (const child of children) {
      const n = normalizeUrl(child);
      if (n && isSameSite(n, baseUrl)) await readSitemap(n, depth + 1);
    }
    $("urlset > url > loc").each((_, el) => {
      if (found.size >= max) return;
      const n = accept($(el).text().trim());
      if (n) found.add(n);
    });
  }

  const fromRobots = sitemapsFromRobots(robotsTxt)
    .map((u) => normalizeUrl(u))
    .filter((u): u is string => !!u && isSameSite(u, baseUrl));
  const candidates = [...fromRobots, ...DEFAULT_SITEMAPS.map((p) => origin + p)];
  for (const c of candidates) {
    if (found.size >= max) break;
    await readSitemap(c, 0);
  }
  if (found.size > 0) return [...found].slice(0, max);

  // No sitemap: breadth-first link crawl to depth 3.
  const start = accept(baseUrl) ?? normalizeUrl(baseUrl);
  if (!start) return [];
  const visited = new Set<string>([start]);
  let level = [start];
  let linkFetches = 0;
  for (let depth = 0; depth <= 3 && level.length && linkFetches < MAX_LINK_FETCHES; depth++) {
    const next: string[] = [];
    for (const url of level) {
      if (found.size >= max || linkFetches >= MAX_LINK_FETCHES) break;
      linkFetches++;
      const res = await fetcher(url);
      if (res.status !== 200 || !/html/i.test(res.contentType)) continue;
      found.add(url);
      if (depth === 3) continue;
      const $ = cheerio.load(res.body);
      $("a[href]").each((_, el) => {
        const n = accept($(el).attr("href") ?? "", res.finalUrl);
        if (n && !visited.has(n)) {
          visited.add(n);
          next.push(n);
        }
      });
    }
    level = next;
  }
  return [...found].slice(0, max);
}
