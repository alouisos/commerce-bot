import Link from "next/link";
import { RangePicker } from "@/components/RangePicker";
import { FILTERS, listConversations, parseFilter, type ConversationFilter } from "@/lib/conversations/list";
import { relativeTime } from "@/lib/format";
import { parseRange } from "@/lib/stats/range";
import { INTENT_LABELS } from "@/shared/intent";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "@/components/icons";
import { loadSite } from "../load-site";

/** The path of a stored page URL, for a compact column; the raw text if it doesn't parse. */
function pathOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

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
        <h2 className="text-2xl">Conversations · {range.label}</h2>
        <RangePicker basePath={base} current={range.key} params={keep} />
      </div>
      <form method="get" action={base} className="panel flex flex-wrap items-center gap-3 p-3" role="search">
        <input type="hidden" name="range" value={range.key} />
        <label className="flex min-w-56 flex-1 items-center gap-1">
          <span className="sr-only">Search messages</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            maxLength={200}
            placeholder="Search messages"
            className="w-full"
          />
        </label>
        <label className="flex items-center gap-2">
          Show
          <select name="filter" defaultValue={filter}>
            {(Object.keys(FILTERS) as ConversationFilter[]).map((f) => (
              <option key={f} value={f}>
                {FILTERS[f]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-primary">
          Apply
        </button>
      </form>
      <p className="text-sm text-ink-muted">{result.total === 1 ? "1 conversation" : `${result.total} conversations`}</p>
      {result.rows.length === 0 ? (
        <p className="notice">No conversations match. Try another search or filter, or a longer date range.</p>
      ) : (
        <div className="panel table-wrap table-stack">
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>First page</th>
              <th>Messages</th>
              <th>Intent</th>
              <th>Preview</th>
              <th>Email</th>
              <th>Unanswered</th>
              <th>Sale</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.id}>
                <td className="stack-lead whitespace-nowrap">
                  <Link href={`${base}/${r.id}`}>
                    <time dateTime={r.createdAt.toISOString()}>{relativeTime(r.createdAt, now)}</time>
                  </Link>
                </td>
                <td data-label="Page" className="cell-mono max-w-48 truncate">{pathOf(r.firstPageUrl)}</td>
                <td data-label="Messages">{r.visitorMessages}</td>
                <td data-label="Intent">{r.intent ? INTENT_LABELS[r.intent] : ""}</td>
                <td className="stack-full min-w-64 whitespace-pre-wrap text-ink-muted">{r.preview}</td>
                <td data-label="Email" className="text-ok">{r.hasEmail ? <CheckIcon label="Yes" /> : ""}</td>
                <td data-label="Unanswered" className="text-danger">{r.unanswered ? <CheckIcon label="Yes" /> : ""}</td>
                <td data-label="Sale" className="text-sodium">{r.hasSale ? <CheckIcon label="Yes" /> : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {result.pageCount > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-4 text-sm">
          {result.page > 1 && (
            <Link href={pageHref(result.page - 1)} className="inline-flex items-center gap-1">
              <ArrowLeftIcon /> Newer
            </Link>
          )}
          <span className="text-ink-muted">
            Page {result.page} of {result.pageCount}
          </span>
          {result.page < result.pageCount && (
            <Link href={pageHref(result.page + 1)} className="inline-flex items-center gap-1">
              Older <ArrowRightIcon />
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
