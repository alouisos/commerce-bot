import { DailyBarChart } from "@/components/DailyBarChart";
import { RangePicker } from "@/components/RangePicker";
import { StatTile } from "@/components/StatTile";
import { httpUrl } from "@/lib/format";
import { getDailyConversations, getTopStartPages, getTotals } from "@/lib/stats/queries";
import { parseRange } from "@/lib/stats/range";
import { loadSite } from "../load-site";
import { InsightsSection } from "./insights-section";

export default async function OverviewPage({ params, searchParams }: PageProps<"/app/sites/[siteId]/overview">) {
  const { siteId } = await params;
  // requireUser + requireSiteAccess (404 otherwise), checked here and not only in the layout.
  const site = await loadSite(siteId);
  const range = parseRange((await searchParams).range);
  const ids = [site.id];
  // The insights section is awaited here rather than rendered as an async child, so the whole page
  // renders in one pass (and in tests with renderToStaticMarkup).
  const [totals, daily, starts, insights] = await Promise.all([
    getTotals(ids, range),
    getDailyConversations(ids, range),
    getTopStartPages(ids, range),
    InsightsSection({ siteId: site.id }),
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
          <StatTile label="Sales" value="–" note="Sales tracking arrives with the WooCommerce connection." />
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
      {insights}
    </div>
  );
}
