import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { kbSources, type KbSource } from "@/db/schema";
import { deleteSourceAction, recrawlNowAction, setExcludedAction } from "./actions";
import { AddForms } from "./add-forms";
import { Poller } from "./poller";
import { loadSite } from "../load-site";

function formatBytes(n: number): string {
  if (n === 0) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

function SourcesTable({ siteId, rows }: { siteId: string; rows: KbSource[] }) {
  if (rows.length === 0) return <p>Nothing here yet.</p>;
  return (
    <table className="w-full text-left">
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
          <tr key={s.id} className="border-t align-top">
            <td className="flex items-center gap-2 py-1">
              {s.kind === "image" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/app/sites/${siteId}/knowledge/image/${s.id}`}
                  alt={s.caption ?? s.title}
                  className="h-10 w-10 border object-cover"
                />
              )}
              <span>{s.title}</span>
            </td>
            <td>{s.kind}</td>
            <td>
              {s.status}
              {s.error && (
                <span role="alert" className="block text-red-700">
                  {s.error}
                </span>
              )}
            </td>
            <td>{formatBytes(s.bytes)}</td>
            <td>
              <form action={setExcludedAction.bind(null, siteId, s.id, !s.excluded)}>
                <button type="submit" className="border px-2" aria-pressed={s.excluded}>
                  {s.excluded ? "Excluded (include)" : "Included (exclude)"}
                </button>
              </form>
            </td>
            <td>
              <form action={deleteSourceAction.bind(null, siteId, s.id)}>
                <button type="submit" className="border px-2">
                  Delete
                </button>
              </form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
  const busy = site.crawlStatus === "crawling" || all.some((s) => s.status === "pending" || s.status === "processing");
  const base = `/app/sites/${site.id}/knowledge`;

  return (
    <div className="flex flex-col gap-6">
      <Poller active={busy} />
      <AddForms siteId={site.id} />
      <nav aria-label="Source type" className="flex gap-4 border-b pb-2">
        <Link href={base} aria-current={pagesTab ? undefined : "page"} className={pagesTab ? "" : "font-semibold"}>
          Your files
        </Link>
        <Link href={`${base}?tab=pages`} aria-current={pagesTab ? "page" : undefined} className={pagesTab ? "font-semibold" : ""}>
          Website pages
        </Link>
      </nav>
      {pagesTab && (
        <div className="flex items-center gap-4">
          <form action={recrawlNowAction.bind(null, site.id)}>
            <button type="submit" disabled={site.crawlStatus === "crawling"} className="border p-2">
              Re-crawl now
            </button>
          </form>
          <p>
            Crawl status: {site.crawlStatus}
            {site.lastCrawledAt && ` (last crawled ${site.lastCrawledAt.toISOString().slice(0, 16).replace("T", " ")} UTC)`}
          </p>
        </div>
      )}
      <SourcesTable siteId={site.id} rows={rows} />
    </div>
  );
}
