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
      return "couldn't read any pages (open the site to retry)";
    case "stale":
      return "the last crawl stopped early (open the site to retry)";
    default:
      return ready > 0 ? `ready, ${ready} pages learned` : "no pages learned yet";
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
      <section>
        <h1 className="mb-4 text-xl font-semibold">Your websites</h1>
        {list.length === 0 ? (
          <p>You have no websites yet. Add one below.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((s) => (
              <li key={s.id} className="border p-3">
                <Link href={`/app/sites/${s.id}/overview`} className="font-medium underline">
                  {s.name}
                </Link>
                <div>{s.baseUrl}</div>
                <div className="text-sm">
                  Last 30 days: {plural(totals.get(s.id)!.conversations, "conversation")} ·{" "}
                  {plural(totals.get(s.id)!.emailsCaptured, "email captured", "emails captured")}
                </div>
                <div className="text-sm">
                  Website: {crawlSummary(notices.get(s.id) ?? null, counts.get(s.id)!.ready)} · Last seen on site:{" "}
                  {s.lastSeenAt ? relativeTime(s.lastSeenAt) : "Not installed yet"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <AddSiteForm />
    </div>
  );
}
