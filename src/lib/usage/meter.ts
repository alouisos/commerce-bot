import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { monthlyUsage, usageEvents, type Account } from "@/db/schema";
import { costMicros, type TokenUsage } from "@/lib/ai/pricing";
import { planStatus, type PlanId } from "@/lib/plans";
import { quotaState, type QuotaState } from "./quota";

export function monthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export async function countConversation(accountId: string, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .insert(monthlyUsage)
    .values({ accountId, month: monthKey(now), conversations: 1 })
    .onConflictDoUpdate({
      target: [monthlyUsage.accountId, monthlyUsage.month],
      set: { conversations: sql`${monthlyUsage.conversations} + 1` },
    })
    .returning({ conversations: monthlyUsage.conversations });
  return row.conversations;
}

/** One marketing email handed to the provider this month. */
export async function countEmailSent(accountId: string, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .insert(monthlyUsage)
    .values({ accountId, month: monthKey(now), emails: 1 })
    .onConflictDoUpdate({
      target: [monthlyUsage.accountId, monthlyUsage.month],
      set: { emails: sql`${monthlyUsage.emails} + 1` },
    })
    .returning({ emails: monthlyUsage.emails });
  return row.emails;
}

/** Model calls made for the owner (not visitors): metered to the owner AI budget, never to `aiCostMicros`. */
export const OWNER_KINDS = ["insights", "ask", "buyer_email"] as const;
type OwnerKind = (typeof OWNER_KINDS)[number];

export async function recordModelUsage(input: {
  accountId: string;
  siteId: string | null;
  kind: "chat" | "image_description" | "prompt" | "email" | OwnerKind;
  model: string;
  usage: TokenUsage;
  now?: Date;
}): Promise<void> {
  const cost = costMicros(input.model, input.usage);
  const month = monthKey(input.now ?? new Date());
  const owner = (OWNER_KINDS as readonly string[]).includes(input.kind);
  await db.transaction(async (tx) => {
    await tx.insert(usageEvents).values({
      accountId: input.accountId,
      siteId: input.siteId,
      kind: input.kind,
      model: input.model,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      cacheReadTokens: input.usage.cacheReadTokens,
      cacheWriteTokens: input.usage.cacheWriteTokens,
      costMicros: cost,
    });
    await tx
      .insert(monthlyUsage)
      .values({
        accountId: input.accountId,
        month,
        ...(owner ? { ownerAiCostMicros: cost } : { aiCostMicros: cost }),
      })
      .onConflictDoUpdate({
        target: [monthlyUsage.accountId, monthlyUsage.month],
        set: owner
          ? { ownerAiCostMicros: sql`${monthlyUsage.ownerAiCostMicros} + ${cost}` }
          : { aiCostMicros: sql`${monthlyUsage.aiCostMicros} + ${cost}` },
      });
  });
}

export async function getMonthUsage(
  accountId: string,
  now: Date = new Date(),
): Promise<{ conversations: number; aiCostMicros: number; ownerAiCostMicros: number; emails: number }> {
  const [row] = await db
    .select({
      conversations: monthlyUsage.conversations,
      aiCostMicros: monthlyUsage.aiCostMicros,
      ownerAiCostMicros: monthlyUsage.ownerAiCostMicros,
      emails: monthlyUsage.emails,
    })
    .from(monthlyUsage)
    .where(and(eq(monthlyUsage.accountId, accountId), eq(monthlyUsage.month, monthKey(now))));
  return row ?? { conversations: 0, aiCostMicros: 0, ownerAiCostMicros: 0, emails: 0 };
}

export type Quota = {
  plan: PlanId;
  expired: boolean;
  used: number;
  limit: number;
  state: QuotaState;
  aiCostMicros: number;
  aiCostCeilingMicros: number;
  /** This month's AI spend has reached the plan's ceiling: no AI replies until next month. */
  aiBudgetReached: boolean;
};

export async function getQuota(account: Account, now: Date = new Date()): Promise<Quota> {
  const status = planStatus(account, now);
  const { conversations, aiCostMicros } = await getMonthUsage(account.id, now);
  const limit = status.limits.conversationsPerMonth;
  const aiCostCeilingMicros = status.limits.aiCostCeilingMicros;
  return {
    plan: status.plan,
    expired: status.expired,
    used: conversations,
    limit,
    state: quotaState(conversations, limit),
    aiCostMicros,
    aiCostCeilingMicros,
    aiBudgetReached: aiCostMicros >= aiCostCeilingMicros,
  };
}

/** True when the bot must not call the model this month: trial over, conversation ceiling, or AI budget spent. */
export function aiBlocked(q: Quota): boolean {
  return q.expired || q.state === "ceiling" || q.aiBudgetReached;
}

/** True when owner-facing AI (insights, Ask, buyer emails) must not run: trial over or this month's owner budget spent. */
export async function ownerAiBlocked(account: Account, now: Date = new Date()): Promise<boolean> {
  const status = planStatus(account, now);
  if (status.expired) return true;
  const { ownerAiCostMicros } = await getMonthUsage(account.id, now);
  return ownerAiCostMicros >= status.limits.ownerAiCeilingMicros;
}
