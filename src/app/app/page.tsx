import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sites } from "@/db/schema";
import { getAccountForUser } from "@/lib/accounts";
import { Poller } from "@/components/Poller";
import { crawlNotice, noticeIsLive, pageCounts, type CrawlNotice } from "@/lib/crawl/notice";
import { plural, relativeTime } from "@/lib/format";
import { getTotalsBySite } from "@/lib/stats/queries";
import { parseRange } from "@/lib/stats/range";
import { requireUser } from "@/lib/session";
import { AddSiteForm } from "./add-site-form";

function crawlSummary(notice: CrawlNotice | null, ready: number): string {
  switch (notice?.kind) {
    case "queued":
      return "getting ready to read your pages…";
    case "crawling":
      return `reading your pages… ${ready} learned so far`;
    case "failed":
      return "couldn't read any pages";
    case "stale":
      return "the last crawl stopped early";
    default:
      return ready > 0 ? `ready, ${ready} pages learned` : "no pages learned yet";
  }
}

/** The status lamp beside a website: red when its crawl failed, amber when stale, live while reading. */
function lampFor(notice: CrawlNotice | null, installed: boolean): string {
  switch (notice?.kind) {
    case "failed":
      return "lamp lamp-crit";
    case "stale":
      return "lamp lamp-warn";
    case "queued":
    case "crawling":
      return "lamp lamp-live";
    default:
      return installed ? "lamp lamp-ok" : "lamp";
  }
}

export default async function WebsitesPage() {
  const user = await requireUser();
  const account = await getAccountForUser(user.id);
  const list = await db.select().from(sites).where(eq(sites.accountId, account.id)).orderBy(desc(sites.createdAt));
  const counts = await pageCounts(list.map((s) => s.id));
  const notices = new Map(list.map((s) => [s.id, crawlNotice(s, counts.get(s.id)!)]));
  const live = [...notices.values()].some(noticeIsLive);
  const totals = await getTotalsBySite(
    list.map((s) => s.id),
    parseRange("30d"),
  );

  return (
    <div className="flex flex-col gap-8">
      <Poller active={live} />
      <section className="flex flex-col gap-4">
        <h1 className="page-title">Your websites</h1>
        {list.length === 0 ? (
          <p className="notice">You have no websites yet. Add one below and the bot starts reading it.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((s) => {
              const notice = notices.get(s.id) ?? null;
              const total = totals.get(s.id)!;
              return (
                <li key={s.id} className="panel site-row">
                  <span className={lampFor(notice, s.lastSeenAt !== null)} aria-hidden="true" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <Link href={`/app/sites/${s.id}/overview`} className="site-name">
                        {s.name}
                      </Link>
                      <span className="cell-mono text-ink-muted">{s.baseUrl}</span>
                    </div>
                    <p className="text-sm font-medium text-sodium">
                      Last 30 days: {plural(total.conversations, "conversation")} ·{" "}
                      {plural(total.emailsCaptured, "email captured", "emails captured")}
                    </p>
                    <p className="text-sm text-ink-muted">
                      Website: {crawlSummary(notice, counts.get(s.id)!.ready)} · Last seen on site:{" "}
                      {s.lastSeenAt ? relativeTime(s.lastSeenAt) : "Not installed yet"}
                    </p>
                    {(notice?.kind === "failed" || notice?.kind === "stale") && (
                      <Link href={`/app/sites/${s.id}/knowledge?tab=pages`} className="mt-1 self-start text-sm font-medium">
                        Retry reading pages
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <AddSiteForm />
    </div>
  );
}
