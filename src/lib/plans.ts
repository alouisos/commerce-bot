export type PlanId = "trial" | "starter" | "growth" | "pro" | "complimentary";

export type PlanLimits = {
  websites: number;
  conversationsPerMonth: number;
  emailsPerMonth: number;
  storageBytes: number;
  admins: number | null;
  autoSendEmails: boolean;
  removeBadge: boolean;
  /** Monthly AI spend ceiling in micro-USD; at or above it the bot goes to the fallback until next month. */
  aiCostCeilingMicros: number;
};

/** Past this many visitor messages in one conversation, the bot answers with the fallback (no model call). */
export const MAX_VISITOR_MESSAGES_PER_CONVERSATION = 40;

const USD = 1_000_000;

const MB = 1024 ** 2;
const GB = 1024 ** 3;

const starter: PlanLimits = {
  websites: 1,
  conversationsPerMonth: 500,
  emailsPerMonth: 1000,
  storageBytes: 100 * MB,
  admins: 2,
  autoSendEmails: false,
  removeBadge: false,
  aiCostCeilingMicros: 25 * USD,
};
const growth: PlanLimits = {
  websites: 3,
  conversationsPerMonth: 2000,
  emailsPerMonth: 5000,
  storageBytes: 1 * GB,
  admins: 5,
  autoSendEmails: true,
  removeBadge: true,
  aiCostCeilingMicros: 70 * USD,
};
const pro: PlanLimits = {
  websites: 10,
  conversationsPerMonth: 10000,
  emailsPerMonth: 25000,
  storageBytes: 5 * GB,
  admins: null,
  autoSendEmails: true,
  removeBadge: true,
  aiCostCeilingMicros: 180 * USD,
};

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  starter,
  growth,
  pro,
  // Growth features with a lower AI spend ceiling: a trial is not paid for.
  trial: { ...growth, aiCostCeilingMicros: 10 * USD },
  complimentary: { ...pro },
};

/** What the platform owner set for one account; an unset key means the plan's value. */
export type LimitOverrides = Partial<
  Pick<
    PlanLimits,
    "websites" | "conversationsPerMonth" | "emailsPerMonth" | "storageBytes" | "aiCostCeilingMicros" | "autoSendEmails" | "removeBadge"
  >
>;

/**
 * The account's plan, its limits (the plan's, with the account's overrides on top) and whether a trial ended.
 * `limitOverrides` is required so every caller passes the account's own row, not just its plan.
 */
export function planStatus(
  account: { plan: PlanId; trialEndsAt: Date | null; limitOverrides: LimitOverrides | null },
  now: Date,
): { plan: PlanId; limits: PlanLimits; expired: boolean } {
  const expired =
    account.plan === "trial" && account.trialEndsAt !== null && now.getTime() >= account.trialEndsAt.getTime();
  const base = PLAN_LIMITS[account.plan];
  const set = Object.entries(account.limitOverrides ?? {}).filter(([, v]) => v !== undefined && v !== null);
  const limits = set.length ? { ...base, ...Object.fromEntries(set) } : base;
  return { plan: account.plan, limits, expired };
}
