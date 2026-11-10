import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { accounts, memberships, sites, user } from "@/db/schema";
import { DailyBarChart } from "@/components/DailyBarChart";
import { RangePicker } from "@/components/RangePicker";
import { StatTile } from "@/components/StatTile";
import { isPlatformOwner } from "@/lib/access";
import { crawlStatusLabel } from "@/lib/crawl/recrawl";
import { relativeTime, usd } from "@/lib/format";
import { getDailyConversations, getTotals, getTotalsBySite } from "@/lib/stats/queries";
import { parseRange } from "@/lib/stats/range";
import { requireUser } from "@/lib/session";
import { isUuid } from "@/lib/widget/conversation";
import { getAccountStats } from "@/lib/stats/platform";
import { PLAN_LIMITS } from "@/lib/plans";
import { LimitsForm } from "./limits-form";

/** One account's numbers for the platform owner. Numbers only: no transcripts, no visitors' emails. */
export default async function OwnerAccountPage({ params, searchParams }: PageProps<"/owner/accounts/[accountId]">) {
  // Checked here as well as in the layout: a page must not rely on its layout for authorization.
  const currentUser = await requireUser();
  if (!isPlatformOwner(currentUser)) notFound();
  const { accountId } = await params;
  if (!isUuid(accountId)) notFound();
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) notFound();

  const range = parseRange((await searchParams).range);
  const [siteRows, owners] = await Promise.all([
    db.select().from(sites).where(eq(sites.accountId, account.id)).orderBy(asc(sites.createdAt)),
    db
      .select({ email: user.email })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(and(eq(memberships.accountId, account.id), eq(memberships.role, "owner"))),
  ]);
  const ids = siteRows.map((s) => s.id);
  const [totals, bySite, daily, accountStats] = await Promise.all([
    getTotals(ids, range),
    getTotalsBySite(ids, range),
    getDailyConversations(ids, range),
    getAccountStats(range),
  ]);
  const cost = accountStats.find((s) => s.accountId === account.id)?.aiCostMicros ?? 0;
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="page-title">{account.name}</h1>
        <p className="text-sm text-ink-muted">
          Plan: {account.plan}
          {account.trialEndsAt && ` (trial ends ${account.trialEndsAt.toISOString().slice(0, 10)})`} · Owner:{" "}
          {owners.map((o) => o.email).join(", ") || "none"}
        </p>
      </header>
      <LimitsForm
        accountId={account.id}
        plan={PLAN_LIMITS[account.plan]}
        overrides={account.limitOverrides ?? {}}
        trialEndsOn={account.plan === "trial" ? (account.trialEndsAt?.toISOString().slice(0, 10) ?? "") : null}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl">{range.label}</h2>
        <RangePicker basePath={`/owner/accounts/${account.id}`} current={range.key} />
      </div>
      <dl className="stat-strip grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Sites" value={String(siteRows.length)} />
        <StatTile label="Conversations" value={String(totals.conversations)} />
        <StatTile label="Emails captured" value={String(totals.emailsCaptured)} />
        <StatTile label="Unanswered" value={String(totals.unanswered)} />
        <StatTile label="AI cost" value={usd(cost)} />
      </dl>
      <DailyBarChart data={daily} title="Conversations per day (UTC), all sites" />
      <div className="panel table-wrap">
          <table>
        <thead>
          <tr>
            <th>Site</th>
            <th>URL</th>
            <th>Conversations</th>
            <th>Emails</th>
            <th>Unanswered</th>
            <th>Crawl</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {siteRows.map((s) => {
            const t = bySite.get(s.id)!;
            return (
              <tr key={s.id} className="border-t">
                <td>{s.name}</td>
                <td>{s.baseUrl}</td>
                <td>{t.conversations}</td>
                <td>{t.emailsCaptured}</td>
                <td>{t.unanswered}</td>
                <td>{crawlStatusLabel(s, now)}</td>
                <td>{s.lastSeenAt ? relativeTime(s.lastSeenAt, now) : "Not installed yet"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
          </div>
      {siteRows.length === 0 && <p className="notice">This account has no websites yet.</p>}
    </div>
  );
}
