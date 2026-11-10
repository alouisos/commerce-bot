import { DailyBarChart } from "@/components/DailyBarChart";
import { RangePicker } from "@/components/RangePicker";
import { StatTile } from "@/components/StatTile";
import { httpUrl, money } from "@/lib/format";
import { hasStoreConnection } from "@/lib/sales/connections";
import { getSalesTotals, type SalesTotals } from "@/lib/stats/sales";
import { getDailyConversations, getTopStartPages, getTotals } from "@/lib/stats/queries";
import { parseRange } from "@/lib/stats/range";
import { loadSite } from "../load-site";
import { InsightsSection } from "./insights-section";
import { PromptPerformance } from "./prompt-performance";

export default async function OverviewPage({ params, searchParams }: PageProps<"/app/sites/[siteId]/overview">) {
  const { siteId } = await params;
  // requireUser + requireSiteAccess (404 otherwise), checked here and not only in the layout.
  const site = await loadSite(siteId);
  const range = parseRange((await searchParams).range);
  const ids = [site.id];
  // The insights section is awaited here rather than rendered as an async child, so the whole page
  // renders in one pass (and in tests with renderToStaticMarkup).
  const [totals, daily, starts, insights, suggestions, sold, connected] = await Promise.all([
    getTotals(ids, range),
    getDailyConversations(ids, range),
    getTopStartPages(ids, range),
    InsightsSection({ siteId: site.id }),
    PromptPerformance({ siteId: site.id, proactivity: site.proactivity, range }),
    getSalesTotals(ids, range),
    hasStoreConnection(site.id),
  ]);
  const average = totals.conversations > 0 ? (totals.visitorMessages / totals.conversations).toFixed(1) : "–";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Overview · {range.label}</h2>
        <RangePicker basePath={`/app/sites/${site.id}/overview`} current={range.key} />
      </div>
      <section aria-label="Numbers">
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Conversations" value={String(totals.conversations)} />
          <StatTile label="Emails captured" value={String(totals.emailsCaptured)} />
          <StatTile
            label="Unanswered"
            value={String(totals.unanswered)}
            note="conversations where the bot couldn't reply"
          />
          <StatTile label="Sales" value={String(sold.count)} note={salesNote(sold, connected)} />
        </dl>
        <p className="mt-2 text-sm">Average messages per conversation: {average}</p>
      </section>
      <DailyBarChart data={daily} title="Conversations per day (UTC)" />
      <section>
        <h3 className="font-medium">Where conversations start</h3>
        {starts.length === 0 ? (
          <p className="text-sm">No conversations in this period.</p>
        ) : (
          <ol className="text-sm">
            {starts.map((s) => {
              const href = httpUrl(s.url);
              return (
                <li key={s.url}>
                  {href ? (
                    <a href={href} className="underline" target="_blank" rel="noreferrer">
                      {s.url}
                    </a>
                  ) : (
                    s.url
                  )}{" "}
                  · {s.conversations}
                </li>
              );
            })}
          </ol>
        )}
      </section>
      {suggestions}
      {insights}
    </div>
  );
}

function salesNote(s: SalesTotals, connected: boolean): string {
  if (s.count === 0) return connected ? "after a chat, a suggestion or an email" : "Connect WooCommerce in Settings to see amounts.";
  const parts: string[] = [];
  if (s.revenue.length > 0) {
    const [top, ...rest] = s.revenue;
    parts.push(`${money(top.minor, top.currency)}${rest.length ? ` + ${rest.length} more ${rest.length === 1 ? "currency" : "currencies"}` : ""}`);
  }
  parts.push(`${s.viaChat} after a chat`, `${s.viaPrompt} from a suggestion`, `${s.viaEmail} from an email`);
  if (s.withoutAmount > 0) parts.push(`${s.withoutAmount} without an amount`);
  return parts.join(" · ");
}
