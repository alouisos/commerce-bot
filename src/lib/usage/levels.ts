// How close an account is to its limits: 80 % warns, 100 % stops new suggestions and new emails.
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { kbSources, sites, type Account } from "@/db/schema";
import { planStatus } from "@/lib/plans";
import { getMonthUsage } from "./meter";

/** "off": a limit of 0 the platform owner set to switch the feature off (emails), not a limit reached. */
export type Level = { used: number; limit: number; ratio: number; level: "ok" | "warning" | "full" | "off" };

function level(used: number, limit: number, zeroMeansOff = false): Level {
  if (limit <= 0 && zeroMeansOff) return { used, limit, ratio: 0, level: "off" };
  const ratio = limit > 0 ? used / limit : 1;
  return { used, limit, ratio, level: limit <= 0 || ratio >= 1 ? "full" : ratio >= 0.8 ? "warning" : "ok" };
}

async function storageUsed(accountId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${kbSources.bytes}), 0)::bigint` })
    .from(kbSources)
    .innerJoin(sites, eq(sites.id, kbSources.siteId))
    .where(eq(sites.accountId, accountId));
  return Number(row?.total ?? 0);
}

export async function usageLevels(
  account: Account,
  now: Date = new Date(),
): Promise<{ conversations: Level; emails: Level; storage: Level }> {
  const { limits } = planStatus(account, now);
  const [month, storage] = await Promise.all([getMonthUsage(account.id, now), storageUsed(account.id)]);
  return {
    conversations: level(month.conversations, limits.conversationsPerMonth),
    emails: level(month.emails, limits.emailsPerMonth, true),
    storage: level(storage, limits.storageBytes),
  };
}

/** This month's conversations or emails are used up (or email is off): no email offers or new drafts. */
export async function atMonthlyLimit(account: Account, now: Date = new Date()): Promise<boolean> {
  const l = await usageLevels(account, now);
  return l.conversations.level === "full" || l.emails.level === "full" || l.emails.level === "off";
}

/** This month's conversations are used up: the bot keeps answering, but makes no new suggestions. */
export async function atConversationLimit(account: Account, now: Date = new Date()): Promise<boolean> {
  return (await usageLevels(account, now)).conversations.level === "full";
}
