export type PlanId = "trial" | "starter" | "growth" | "pro" | "complimentary";

export type PlanLimits = {
  websites: number;
  conversationsPerMonth: number;
  emailsPerMonth: number;
  storageBytes: number;
  admins: number | null;
  autoSendEmails: boolean;
  removeBadge: boolean;
};

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
};
const growth: PlanLimits = {
  websites: 3,
  conversationsPerMonth: 2000,
  emailsPerMonth: 5000,
  storageBytes: 1 * GB,
  admins: 5,
  autoSendEmails: true,
  removeBadge: true,
};
const pro: PlanLimits = {
  websites: 10,
  conversationsPerMonth: 10000,
  emailsPerMonth: 25000,
  storageBytes: 5 * GB,
  admins: null,
  autoSendEmails: true,
  removeBadge: true,
};

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  starter,
  growth,
  pro,
  trial: { ...growth },
  complimentary: { ...pro },
};

export function planStatus(
  account: { plan: PlanId; trialEndsAt: Date | null },
  now: Date,
): { plan: PlanId; limits: PlanLimits; expired: boolean } {
  const expired =
    account.plan === "trial" && account.trialEndsAt !== null && now.getTime() >= account.trialEndsAt.getTime();
  return { plan: account.plan, limits: PLAN_LIMITS[account.plan], expired };
}
