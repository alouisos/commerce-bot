import Link from "next/link";
import { RangePicker } from "@/components/RangePicker";
import { FILTERS, listConversations, parseFilter, type ConversationFilter } from "@/lib/conversations/list";
import { relativeTime } from "@/lib/format";
import { parseRange } from "@/lib/stats/range";
import { loadSite } from "../load-site";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ConversationsPage({ params, searchParams }: PageProps<"/app/sites/[siteId]/conversations">) {
  const { siteId } = await params;
  // requireUser + requireSiteAccess (404 otherwise), checked here and not only in the layout.
  const site = await loadSite(siteId);
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const filter = parseFilter(sp.filter);
  const q = (first(sp.q) ?? "").slice(0, 200);
  const result = await listConversations(site.id, { range, q, filter, page: Number(first(sp.page)) || 1 });
  const base = `/app/sites/${site.id}/conversations`;
  const keep = { q: q || undefined, filter: filter === "all" ? undefined : filter, range: range.key };
  const pageHref = (page: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, page: String(page) })) if (v) u.set(k, v);
    return `${base}?${u}`;
  };
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Conversations · {range.label}</h2>
        <RangePicker basePath={base} current={range.key} params={keep} />
      </div>
      <form method="get" action={base} className="flex flex-wrap gap-2 text-sm" role="search">
        <input type="hidden" name="range" value={range.key} />
        <label className="flex items-center gap-1">
          <span className="sr-only">Search messages</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            maxLength={200}
            placeholder="Search messages"
            className="border px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-1">
          Show
          <select name="filter" defaultValue={filter} className="border px-2 py-1">
            {(Object.keys(FILTERS) as ConversationFilter[]).map((f) => (
              <option key={f} value={f}>
                {FILTERS[f]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="border px-3 py-1">
          Apply
        </button>
      </form>
      <p className="text-sm">{result.total === 1 ? "1 conversation" : `${result.total} conversations`}</p>
      {result.rows.length === 0 ? (
        <p>No conversations match.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>Started</th>
              <th>First page</th>
              <th>Messages</th>
              <th>Preview</th>
              <th>Email</th>
              <th>Unanswered</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.id} className="border-t align-top">
                <td className="py-1">
                  <Link href={`${base}/${r.id}`} className="underline">
                    <time dateTime={r.createdAt.toISOString()}>{relativeTime(r.createdAt, now)}</time>
                  </Link>
                </td>
                <td className="max-w-48 truncate">{r.firstPageUrl ? new URL(r.firstPageUrl, site.baseUrl).pathname : ""}</td>
                <td>{r.visitorMessages}</td>
                <td className="whitespace-pre-wrap">{r.preview}</td>
                <td>{r.hasEmail ? "✓" : ""}</td>
                <td>{r.unanswered ? "✓" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result.pageCount > 1 && (
        <nav aria-label="Pages" className="flex gap-4 text-sm">
          {result.page > 1 && <Link href={pageHref(result.page - 1)}>← Newer</Link>}
          <span>
            Page {result.page} of {result.pageCount}
          </span>
          {result.page < result.pageCount && <Link href={pageHref(result.page + 1)}>Older →</Link>}
        </nav>
      )}
    </div>
  );
}
