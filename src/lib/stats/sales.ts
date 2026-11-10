import { and, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sales } from "@/db/schema";
import type { StatsRange } from "./range";

export type SalesTotals = {
  count: number;
  viaChat: number;
  viaPrompt: number;
  viaEmail: number;
  /** Per currency, largest first. */
  revenue: { currency: string; minor: number }[];
  withoutAmount: number;
};

/** Sales the bot helped with, ordered in the range. */
export async function getSalesTotals(siteIds: string[], range: StatsRange): Promise<SalesTotals> {
  const empty: SalesTotals = { count: 0, viaChat: 0, viaPrompt: 0, viaEmail: 0, revenue: [], withoutAmount: 0 };
  if (siteIds.length === 0) return empty;
  const where = and(inArray(sales.siteId, siteIds), gte(sales.orderedAt, range.from), lte(sales.orderedAt, range.to));
  const [totals] = await db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      viaChat: sql<number>`count(*) filter (where ${sales.viaChat})`.mapWith(Number),
      viaPrompt: sql<number>`count(*) filter (where ${sales.viaPrompt})`.mapWith(Number),
      viaEmail: sql<number>`count(*) filter (where ${sales.viaEmail})`.mapWith(Number),
      withoutAmount: sql<number>`count(*) filter (where ${sales.amountMinor} is null)`.mapWith(Number),
    })
    .from(sales)
    .where(where);
  const revenue = await db
    .select({ currency: sales.currency, minor: sql<number>`sum(${sales.amountMinor})`.mapWith(Number) })
    .from(sales)
    .where(and(where, sql`${sales.amountMinor} is not null and ${sales.currency} is not null`))
    .groupBy(sales.currency)
    .orderBy(sql`sum(${sales.amountMinor}) desc`);
  return { ...totals, revenue: revenue.map((r) => ({ currency: r.currency!, minor: r.minor })) };
}
