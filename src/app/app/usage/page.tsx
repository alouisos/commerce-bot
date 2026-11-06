import { AI_LIMIT_TEXT } from "@/components/QuotaBanner";
import { getAccountForUser } from "@/lib/accounts";
import { requireUser } from "@/lib/session";
import { getQuota } from "@/lib/usage/meter";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const DAY = 86_400_000;

const STATE_TEXT = {
  ok: "Within your monthly limit.",
  warning: "You are close to this month's conversation limit.",
  limit: "You've reached this month's conversation limit. Visitors can still chat for now.",
  ceiling: "Your bot is in fallback mode until next month.",
} as const;

export default async function UsagePage() {
  const user = await requireUser();
  const account = await getAccountForUser(user.id);
  const now = new Date();
  const quota = await getQuota(account, now);
  const planName = quota.plan.charAt(0).toUpperCase() + quota.plan.slice(1);
  const pct = Math.min(100, Math.floor((quota.used / quota.limit) * 100));

  let trial: string | null = null;
  if (quota.plan === "trial") {
    if (quota.expired) trial = "Trial ended";
    else if (account.trialEndsAt) {
      const days = Math.max(0, Math.ceil((account.trialEndsAt.getTime() - now.getTime()) / DAY));
      trial = `${days} ${days === 1 ? "day" : "days"} left in trial`;
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-xl font-semibold">Usage</h1>
      <p>
        Plan: <strong>{planName}</strong>
        {trial ? ` · ${trial}` : ""}
      </p>
      <section className="flex flex-col gap-1">
        <p>
          Conversations this month: {quota.used} / {quota.limit}
        </p>
        <div
          role="progressbar"
          aria-label="Conversations used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-3 w-full border"
        >
          <div className="h-full bg-current" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-sm">{quota.expired ? "Your free trial has ended. Your bot is in fallback mode." : STATE_TEXT[quota.state]}</p>
      </section>
      <section className="flex flex-col gap-1">
        <p>
          AI usage this month: {usd.format(quota.aiCostMicros / 1e6)} of {usd.format(quota.aiCostCeilingMicros / 1e6)}
        </p>
        {quota.aiBudgetReached && (
          <p role="alert" className="text-sm">
            {AI_LIMIT_TEXT}
          </p>
        )}
      </section>
    </div>
  );
}
