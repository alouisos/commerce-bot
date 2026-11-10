import { and, asc, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, sites, usageEvents } from "@/db/schema";
import { getTotalsBySite, type Totals } from "./queries";
import type { StatsRange } from "./range";

export type AccountStats = Totals & { accountId: string; sites: number; aiCostMicros: number };

/** Every account's numbers for the range (platform owner only). Accounts with nothing get zeros. */
export async function getAccountStats(range: StatsRange): Promise<AccountStats[]> {
  const [accountRows, siteRows, costRows] = await Promise.all([
    db.select({ id: accounts.id }).from(accounts).orderBy(asc(accounts.createdAt)),
    db.select({ id: sites.id, accountId: sites.accountId }).from(sites),
    db
      .select({
        accountId: usageEvents.accountId,
        cost: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)`.mapWith(Number),
      })
      .from(usageEvents)
      .where(and(gte(usageEvents.createdAt, range.from), lte(usageEvents.createdAt, range.to)))
      .groupBy(usageEvents.accountId),
  ]);
  const bySite = await getTotalsBySite(
    siteRows.map((s) => s.id),
    range,
  );
  const out = new Map<string, AccountStats>(
    accountRows.map((a) => [
      a.id,
      { accountId: a.id, sites: 0, conversations: 0, visitorMessages: 0, emailsCaptured: 0, unanswered: 0, aiCostMicros: 0 },
    ]),
  );
  for (const s of siteRows) {
    const acc = out.get(s.accountId);
    const t = bySite.get(s.id);
    if (!acc || !t) continue;
    acc.sites += 1;
    acc.conversations += t.conversations;
    acc.visitorMessages += t.visitorMessages;
    acc.emailsCaptured += t.emailsCaptured;
    acc.unanswered += t.unanswered;
  }
  for (const c of costRows) {
    const acc = out.get(c.accountId);
    if (acc) acc.aiCostMicros = c.cost;
  }
  return [...out.values()];
}

/** The whole platform's numbers for the range. */
export async function getPlatformTotals(
  range: StatsRange,
): Promise<Totals & { accounts: number; sites: number; aiCostMicros: number }> {
  const stats = await getAccountStats(range);
  const sum = { accounts: stats.length, sites: 0, conversations: 0, visitorMessages: 0, emailsCaptured: 0, unanswered: 0, aiCostMicros: 0 };
  for (const s of stats) {
    sum.sites += s.sites;
    sum.conversations += s.conversations;
    sum.visitorMessages += s.visitorMessages;
    sum.emailsCaptured += s.emailsCaptured;
    sum.unanswered += s.unanswered;
    sum.aiCostMicros += s.aiCostMicros;
  }
  return sum;
}
