import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { kbSources, sites } from "@/db/schema";
import { NotFoundError } from "@/lib/errors";
import { chunkText } from "@/lib/kb/chunk";
import { replaceChunks } from "@/lib/kb/store";
import { discoverUrls, isSameSite, normalizeUrl } from "./discover";
import { extractPage, type ExtractedPage } from "./extract-page";
import { createHttpFetcher, type Fetcher } from "./fetcher";

export type CrawlOptions = { delayMs?: number; concurrency?: number };
export type CrawlResult = { pages: number; changed: number; removed: number };

/** Spaces out request starts by at least delayMs, shared by every worker. */
function throttled(fetcher: Fetcher, delayMs: number): Fetcher {
  if (delayMs <= 0) return fetcher;
  let next = 0;
  return async (url) => {
    const now = Date.now();
    const start = Math.max(now, next);
    next = start + delayMs;
    if (start > now) await new Promise((r) => setTimeout(r, start - now));
    return fetcher(url);
  };
}

function productLine(p: NonNullable<ExtractedPage["product"]>): string {
  const price = [p.price, p.currency].filter(Boolean).join(" ");
  return `Product: ${p.name}${price ? ` — ${price}` : ""}`;
}

function chunkTexts(page: ExtractedPage, title: string): string[] {
  const header =
    `Page: ${title}\nURL: ${page.url}\n` + (page.product ? `${productLine(page.product)}\n` : "");
  return chunkText(page.text).map((c) => header + c);
}

function pathTitle(url: string): string {
  return new URL(url).pathname;
}

export async function crawlSite(siteId: string, fetcher?: Fetcher, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId));
  if (!site) throw new NotFoundError("Site not found");
  const fetch = throttled(fetcher ?? createHttpFetcher(), opts.delayMs ?? 500);
  const concurrency = Math.max(1, opts.concurrency ?? 2);

  await db.update(sites).set({ crawlStatus: "crawling", crawlStartedAt: new Date() }).where(eq(sites.id, siteId));
  let status: "done" | "failed" = "failed";
  const result: CrawlResult = { pages: 0, changed: 0, removed: 0 };
  try {
    const urls = await discoverUrls(site.baseUrl, fetch);
    // URLs we must not delete: processed ones, plus ones that failed transiently (network error or 5xx).
    const keep = new Set<string>();
    const done = new Set<string>();

    async function processUrl(url: string): Promise<void> {
      const res = await fetch(url);
      if (res.status === 0 || res.status >= 500) {
        keep.add(url);
        return;
      }
      if (res.status !== 200 || !/html/i.test(res.contentType)) return;
      const final = normalizeUrl(res.finalUrl);
      if (!final || !isSameSite(final, site.baseUrl) || done.has(final)) return;
      done.add(final);
      const page = extractPage(res.body, final);
      if (!page.text.trim()) return;

      const title = page.title || pathTitle(final);
      const hash = createHash("sha256")
        .update(title + page.text + (page.product ? productLine(page.product) : ""))
        .digest("hex");
      const [existing] = await db
        .select()
        .from(kbSources)
        .where(and(eq(kbSources.siteId, siteId), eq(kbSources.kind, "page"), eq(kbSources.url, final)));
      keep.add(final);
      result.pages++;
      if (existing && existing.contentHash === hash && existing.status === "ready") return;

      let sourceId = existing?.id;
      try {
        if (existing) {
          await db.update(kbSources).set({ title, status: "processing", error: null }).where(eq(kbSources.id, existing.id));
        } else {
          const [row] = await db
            .insert(kbSources)
            .values({ siteId, kind: "page", title, url: final, bytes: 0, status: "processing" })
            .returning({ id: kbSources.id });
          sourceId = row.id;
        }
        await replaceChunks({ sourceId: sourceId!, siteId, texts: chunkTexts(page, title) });
        await db.update(kbSources).set({ contentHash: hash, status: "ready" }).where(eq(kbSources.id, sourceId!));
        result.changed++;
      } catch (err) {
        result.pages--;
        if (sourceId) {
          await db
            .update(kbSources)
            .set({ status: "failed", error: err instanceof Error ? err.message : String(err) })
            .where(eq(kbSources.id, sourceId));
        }
      }
    }

    let i = 0;
    const worker = async () => {
      while (i < urls.length) {
        const url = urls[i++];
        try {
          await processUrl(url);
        } catch {
          keep.add(url);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));

    if (result.pages > 0) {
      status = "done";
      const stored = await db
        .select({ id: kbSources.id, url: kbSources.url })
        .from(kbSources)
        .where(and(eq(kbSources.siteId, siteId), eq(kbSources.kind, "page")));
      const gone = stored.filter((s) => s.url && !keep.has(s.url)).map((s) => s.id);
      if (gone.length) await db.delete(kbSources).where(inArray(kbSources.id, gone));
      result.removed = gone.length;
    }
    return result;
  } finally {
    await db.update(sites).set({ crawlStatus: status, lastCrawledAt: new Date() }).where(eq(sites.id, siteId));
  }
}
