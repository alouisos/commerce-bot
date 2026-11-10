import Link from "next/link";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { Poller } from "@/components/Poller";
import { noticeIsLive, type CrawlNotice } from "@/lib/crawl/notice";
import { recrawlNowAction } from "./knowledge/actions";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Tells the admin what the website crawl is doing, and keeps itself up to date while it runs. */
export function CrawlBanner({ siteId, host, notice }: { siteId: string; host: string; notice: CrawlNotice | null }) {
  if (!notice) return null;
  const pagesHref = `/app/sites/${siteId}/knowledge?tab=pages`;
  const recrawl = (
    <form action={recrawlNowAction.bind(null, siteId)} className="mt-2">
      <button type="submit" className="border bg-white px-2 py-1">
        Re-crawl now
      </button>
    </form>
  );

  let body;
  switch (notice.kind) {
    case "queued":
      body = (
        <div role="status" className="border border-blue-300 bg-blue-50 p-3">
          <strong>Getting ready to read {host}…</strong> The crawl starts within a minute. This page updates on its own.
        </div>
      );
      break;
    case "crawling":
      body = (
        <div role="status" className="border border-blue-300 bg-blue-50 p-3">
          <strong>Reading {host}…</strong>{" "}
          {notice.counts.ready > 0
            ? `${plural(notice.counts.ready, "page")} learned so far.`
            : "Finding your pages."}{" "}
          You can keep working; this updates on its own and tells you when your website is ready.
        </div>
      );
      break;
    case "ready":
      body = (
        <DismissibleNotice
          storageKey={`crawl-ready:${siteId}:${notice.finishedAt.toISOString()}`}
          className="border border-green-300 bg-green-50 p-3"
        >
          <strong>Your website is ready.</strong> The assistant learned {plural(notice.counts.ready, "page")} from {host}
          {notice.counts.failed > 0 && ` (${plural(notice.counts.failed, "page")} couldn't be added)`}.{" "}
          <Link href={pagesHref} className="underline">
            See website pages
          </Link>
        </DismissibleNotice>
      );
      break;
    case "failed":
      body = (
        <div role="alert" className="border border-red-300 bg-red-50 p-3">
          <strong>We couldn&apos;t read any pages from {host}.</strong> Check that the address is right and the site is
          public, then try again.
          {recrawl}
        </div>
      );
      break;
    case "stale":
      body = (
        <div role="alert" className="border border-amber-300 bg-amber-50 p-3">
          <strong>The last crawl of {host} stopped before it finished.</strong> Start it again to pick up the rest.
          {recrawl}
        </div>
      );
      break;
  }
  return (
    <>
      <Poller active={noticeIsLive(notice)} />
      {body}
    </>
  );
}
