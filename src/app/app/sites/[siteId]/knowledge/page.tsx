import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { kbSources, type KbSource } from "@/db/schema";
import { crawlStatusLabel, isCrawlRunning } from "@/lib/crawl/recrawl";
import { deleteSourceAction, recrawlNowAction, setExcludedAction } from "./actions";
import { AddForms } from "./add-forms";
import { Poller } from "@/components/Poller";
import { loadSite } from "../load-site";

function formatBytes(n: number): string {
  if (n === 0) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

/** A status word as a badge: ready reads green, failures red, work in progress amber. */
function statusBadge(status: string): string {
  if (status === "ready") return "badge badge-ok";
  if (status === "failed" || status === "error") return "badge badge-crit";
  if (status === "pending" || status === "processing") return "badge badge-warn";
  return "badge";
}

function SourcesTable({ siteId, rows }: { siteId: string; rows: KbSource[] }) {
  if (rows.length === 0) return <p className="notice">Nothing here yet.</p>;
  return (
    <div className="panel table-wrap table-stack">
    <table>
      <thead>
        <tr>
          <th>Title</th>
          <th>Kind</th>
          <th>Status</th>
          <th>Size</th>
          <th>Excluded</th>
          <th>Delete</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id}>
            <td className="stack-lead flex items-center gap-3">
              {s.kind === "image" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/app/sites/${siteId}/knowledge/image/${s.id}`}
                  alt={s.caption ?? s.title}
                  className="h-10 w-10 rounded border object-cover"
                />
              )}
              <span>{s.title}</span>
            </td>
            <td data-label="Kind" className="text-ink-muted">{s.kind}</td>
            <td>
              <span className={statusBadge(s.status)}>{s.status}</span>
              {s.error && (
                <span role="alert" className="mt-1 block text-danger">
                  {s.error}
                </span>
              )}
            </td>
            <td data-label="Size" className="whitespace-nowrap tabular-nums text-ink-muted">{formatBytes(s.bytes)}</td>
            <td>
              <form action={setExcludedAction.bind(null, siteId, s.id, !s.excluded)}>
                <button type="submit" className="btn-sm whitespace-nowrap" aria-pressed={s.excluded}>
                  {s.excluded ? "Excluded (include)" : "Included (exclude)"}
                </button>
              </form>
            </td>
            <td>
              <form action={deleteSourceAction.bind(null, siteId, s.id)}>
                <button type="submit" className="btn-danger-quiet btn-sm">
                  Delete
                </button>
              </form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

export default async function KnowledgePage({
  params,
  searchParams,
}: PageProps<"/app/sites/[siteId]/knowledge">) {
  const { siteId } = await params;
  const { tab } = await searchParams;
  const site = await loadSite(siteId);
  const pagesTab = tab === "pages";
  const all = await db
    .select()
    .from(kbSources)
    .where(eq(kbSources.siteId, site.id))
    .orderBy(pagesTab ? asc(kbSources.title) : desc(kbSources.createdAt));
  const rows = all.filter((s) => (s.kind === "page") === pagesTab);
  const now = new Date();
  const crawling = isCrawlRunning(site, now);
  // While a crawl runs, the site layout's crawl banner refreshes the page; this covers uploads.
  const busy = !crawling && all.some((s) => s.status === "pending" || s.status === "processing");
  const base = `/app/sites/${site.id}/knowledge`;

  return (
    <div className="flex flex-col gap-6">
      <Poller active={busy} />
      <AddForms siteId={site.id} />
      <nav aria-label="Source type" className="tabs">
        <Link href={base} aria-current={pagesTab ? undefined : "page"}>
          Your files
        </Link>
        <Link href={`${base}?tab=pages`} aria-current={pagesTab ? "page" : undefined}>
          Website pages
        </Link>
      </nav>
      {pagesTab && (
        <div className="flex flex-wrap items-center gap-4">
          <form action={recrawlNowAction.bind(null, site.id)}>
            <button type="submit" disabled={crawling} className="btn-primary">
              Re-crawl now
            </button>
          </form>
          <p className="text-sm text-ink-muted">
            Crawl status: {crawlStatusLabel(site, now)}
            {site.lastCrawledAt && ` (last crawled ${site.lastCrawledAt.toISOString().slice(0, 16).replace("T", " ")} UTC)`}
          </p>
        </div>
      )}
      <SourcesTable siteId={site.id} rows={rows} />
    </div>
  );
}
