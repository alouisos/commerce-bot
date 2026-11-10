import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resetDb } from "../helpers/db";
import { makeAccount, makeMembership, makeSite, makeSource, makeUser } from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "", emailVerified: true } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));
// The banner's Poller calls useRouter(); there is no mounted app router when rendering in a test.
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {} }),
}));

import { crawlNotice, noticeIsLive, pageCounts, READY_NOTICE_MS } from "@/lib/crawl/notice";
import { CrawlBanner } from "@/app/app/sites/[siteId]/crawl-banner";
import WebsitesPage from "@/app/app/page";

beforeEach(resetDb);

const now = new Date("2026-11-10T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const counts = { ready: 12, failed: 3, working: 2 };

describe("crawlNotice", () => {
  it("a new site is queued until the worker starts the crawl", () => {
    const n = crawlNotice({ crawlStatus: "idle", crawlStartedAt: null, lastCrawledAt: null }, counts, now);
    expect(n).toEqual({ kind: "queued" });
    expect(noticeIsLive(n)).toBe(true);
  });

  it("a running crawl reports progress and keeps the page live", () => {
    const n = crawlNotice({ crawlStatus: "crawling", crawlStartedAt: ago(60_000), lastCrawledAt: null }, counts, now);
    expect(n).toEqual({ kind: "crawling", counts });
    expect(noticeIsLive(n)).toBe(true);
  });

  it("a finished crawl is ready for a week, then says nothing", () => {
    const finished = ago(60_000);
    const n = crawlNotice({ crawlStatus: "done", crawlStartedAt: ago(120_000), lastCrawledAt: finished }, counts, now);
    expect(n).toEqual({ kind: "ready", counts, finishedAt: finished });
    expect(noticeIsLive(n)).toBe(false);
    const old = ago(READY_NOTICE_MS + 1);
    expect(crawlNotice({ crawlStatus: "done", crawlStartedAt: old, lastCrawledAt: old }, counts, now)).toBeNull();
  });

  it("failed and stale crawls are reported, not live", () => {
    expect(crawlNotice({ crawlStatus: "failed", crawlStartedAt: ago(1), lastCrawledAt: ago(1) }, counts, now)).toEqual({
      kind: "failed",
    });
    const stale = crawlNotice({ crawlStatus: "crawling", crawlStartedAt: ago(4 * 3600_000), lastCrawledAt: null }, counts, now);
    expect(stale).toEqual({ kind: "stale" });
    expect(noticeIsLive(stale)).toBe(false);
  });

  it("an idle site that was crawled before says nothing", () => {
    expect(crawlNotice({ crawlStatus: "idle", crawlStartedAt: null, lastCrawledAt: ago(1) }, counts, now)).toBeNull();
  });
});

describe("pageCounts", () => {
  it("counts crawled pages by status per site, ignoring files", async () => {
    const account = await makeAccount();
    const a = await makeSite(account.id);
    const b = await makeSite(account.id);
    await makeSource(a.id, { kind: "page", status: "ready" });
    await makeSource(a.id, { kind: "page", status: "ready" });
    await makeSource(a.id, { kind: "page", status: "failed" });
    await makeSource(a.id, { kind: "page", status: "processing" });
    await makeSource(a.id, { kind: "document", status: "ready" });
    const out = await pageCounts([a.id, b.id]);
    expect(out.get(a.id)).toEqual({ ready: 2, failed: 1, working: 1 });
    expect(out.get(b.id)).toEqual({ ready: 0, failed: 0, working: 0 });
  });
});

/** The banner's visible element (its first child is the Poller). */
function bannerBody(el: ReactElement): ReactElement {
  const kids = (el.props as { children: ReactNode[] }).children;
  return kids[1] as ReactElement;
}

describe("CrawlBanner", () => {
  it("says the site is being read, with progress", () => {
    const el = CrawlBanner({ siteId: "s", host: "shop.example", notice: { kind: "crawling", counts } })!;
    const html = renderToStaticMarkup(el);
    expect(html).toContain('role="status"');
    expect(html).toContain("Reading shop.example…");
    expect(html).toContain("12 pages learned so far.");
  });

  it("says when the website is ready, with what couldn't be added (dismissible)", () => {
    const el = CrawlBanner({
      siteId: "s",
      host: "shop.example",
      notice: { kind: "ready", counts, finishedAt: now },
    })!;
    const body = bannerBody(el);
    const props = body.props as { storageKey: string; children: ReactNode };
    expect(props.storageKey).toBe(`crawl-ready:s:${now.toISOString()}`);
    const html = renderToStaticMarkup(createElement("div", null, props.children));
    expect(html).toContain("Your website is ready.");
    expect(html).toContain("The assistant learned 12 pages from shop.example");
    expect(html).toContain("(3 pages couldn&#x27;t be added)");
    expect(html).toContain('href="/app/sites/s/knowledge?tab=pages"');
  });

  it("alerts on a failed crawl and offers a re-crawl", () => {
    const html = renderToStaticMarkup(CrawlBanner({ siteId: "s", host: "shop.example", notice: { kind: "failed" } })!);
    expect(html).toContain('role="alert"');
    expect(html).toContain("couldn&#x27;t read any pages from shop.example");
    expect(html).toContain("Re-crawl now");
  });

  it("renders nothing without a notice", () => {
    expect(CrawlBanner({ siteId: "s", host: "h", notice: null })).toBeNull();
    expect(isValidElement(CrawlBanner({ siteId: "s", host: "h", notice: { kind: "queued" } }))).toBe(true);
  });
});

describe("websites list", () => {
  it("shows live crawl progress per site", async () => {
    const u = await makeUser();
    const account = await makeAccount();
    await makeMembership(account.id, u.id);
    current.user = { id: u.id, email: u.email, emailVerified: false };
    const site = await makeSite(account.id, { crawlStatus: "crawling", crawlStartedAt: new Date() });
    await makeSource(site.id, { kind: "page", status: "ready" });
    const html = renderToStaticMarkup(await WebsitesPage());
    expect(html).toContain("Website: reading your pages… 1 learned so far");
  });
});
