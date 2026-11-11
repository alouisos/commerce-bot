import { DailyBarChart } from "@/components/DailyBarChart";
import { RangePicker } from "@/components/RangePicker";
import { StatTile } from "@/components/StatTile";
import { parseInsightWindow } from "@/lib/insights/prompt";
import { httpUrl, money } from "@/lib/format";
import { getStoreConnectionSummary } from "@/lib/sales/connections";
import { getSalesTotals, type SalesTotals } from "@/lib/stats/sales";
import { getDailyConversations, getTopStartPages, getTotals } from "@/lib/stats/queries";
import { parseRange } from "@/lib/stats/range";
import { requireUser } from "@/lib/session";
import { loadSite } from "../load-site";
import { InsightsSection } from "./insights-section";
import { PromptPerformance } from "./prompt-performance";

export default async function OverviewPage({ params, searchParams }: PageProps<"/app/sites/[siteId]/overview">) {
  const { siteId } = await params;
  // requireUser + requireSiteAccess (404 otherwise), checked here and not only in the layout.
  const site = await loadSite(siteId);
  const user = await requireUser();
  const query = await searchParams;
  const range = parseRange(query.range);
  const window = parseInsightWindow(query.insights) ?? "24h";
  const keep = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const ids = [site.id];
  // The insights section is awaited here rather than rendered as an async child, so the whole page
  // renders in one pass (and in tests with renderToStaticMarkup).
  const [totals, daily, starts, insights, suggestions, sold, store] = await Promise.all([
    getTotals(ids, range),
    getDailyConversations(ids, range),
    getTopStartPages(ids, range),
    InsightsSection({ siteId: site.id, window, params: { range: keep(query.range) }, userId: user.id }),
    PromptPerformance({ siteId: site.id, proactivity: site.proactivity, range }),
    getSalesTotals(ids, range),
    getStoreConnectionSummary(site.id),
  ]);
  const average = totals.conversations > 0 ? (totals.visitorMessages / totals.conversations).toFixed(1) : "–";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl">Overview · {range.label}</h2>
        <RangePicker basePath={`/app/sites/${site.id}/overview`} current={range.key} />
      </div>
      <section aria-label="Numbers" className="flex flex-col gap-2">
        <dl className="stat-strip grid-cols-2 lg:grid-cols-4">
          <StatTile label="Conversations" value={String(totals.conversations)} />
          <StatTile label="Emails captured" value={String(totals.emailsCaptured)} />
          <StatTile
            label="Unanswered"
            value={String(totals.unanswered)}
            note="conversations where the bot couldn't reply"
            alert={totals.unanswered > 0}
            action={
              totals.unanswered > 0
                ? { href: `/app/sites/${site.id}/conversations?filter=unanswered&range=${range.key}`, label: "Review unanswered" }
                : undefined
            }
          />
          <StatTile label="Sales" value={String(sold.count)} note={salesNote(sold, store)} />
        </dl>
        <p className="text-sm text-ink-muted">Average messages per conversation: {average}</p>
      </section>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <DailyBarChart data={daily} title="Conversations per day (UTC)" />
        <section className="panel">
          <h3 className="panel-head">Where conversations start</h3>
          <div className="panel-body">
            {starts.length === 0 ? (
              <p className="text-sm text-ink-muted">No conversations in this period.</p>
            ) : (
              <ol className="text-sm">
                {starts.map((s) => {
                  const href = httpUrl(s.url);
                  return (
                    <li key={s.url} className="flex items-baseline justify-between gap-4 border-t py-2 first:border-t-0 first:pt-0">
                      <span className="cell-mono min-w-0 truncate" title={s.url}>
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer">
                            {pathOf(s.url)}
                          </a>
                        ) : (
                          pathOf(s.url)
                        )}
                      </span>
                      <span className="shrink-0 font-semibold text-sodium tabular-nums">{s.conversations}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </section>
      </div>
      {suggestions}
      {insights}
    </div>
  );
}

/** The path of a page URL for a compact list; the raw text if it doesn't parse. */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function salesNote(
  s: SalesTotals,
  store: { status: "connected" | "failing"; lastError: string | null } | null,
): string {
  if (store?.status === "failing") return `Sales aren't being checked: ${store.lastError ?? "the WooCommerce connection is failing."}`;
  if (s.count === 0) return store ? "after a chat, a suggestion or an email" : "Connect WooCommerce in Settings to see amounts.";
  const parts: string[] = [];
  if (s.revenue.length > 0) {
    const [top, ...rest] = s.revenue;
    parts.push(`${money(top.minor, top.currency)}${rest.length ? ` + ${rest.length} more ${rest.length === 1 ? "currency" : "currencies"}` : ""}`);
  }
  parts.push(`${s.viaChat} after a chat`, `${s.viaPrompt} from a suggestion`, `${s.viaEmail} from an email`);
  if (s.withoutAmount > 0) parts.push(`${s.withoutAmount} without an amount`);
  return parts.join(" · ");
}
