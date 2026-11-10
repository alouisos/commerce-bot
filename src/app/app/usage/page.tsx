import { AI_LIMIT_TEXT } from "@/components/QuotaBanner";
import { getAccountForUser } from "@/lib/accounts";
import { requireUser } from "@/lib/session";
import { usageLevels } from "@/lib/usage/levels";
import { getQuota } from "@/lib/usage/meter";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const DAY = 86_400_000;

const STATE_TEXT = {
  ok: "Within your monthly limit.",
  warning: "You are close to this month's conversation limit.",
  limit: "You've reached this month's conversations. Your bot keeps answering, but makes no new suggestions or emails until next month.",
  ceiling: "Your bot is in fallback mode until next month.",
} as const;

export default async function UsagePage() {
  const user = await requireUser();
  const account = await getAccountForUser(user.id);
  const now = new Date();
  const [quota, levels] = await Promise.all([getQuota(account, now), usageLevels(account, now)]);
  const mb = (b: number) => `${Math.round(b / (1024 * 1024)).toLocaleString("en")} MB`;
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
          Emails this month: {levels.emails.used} / {levels.emails.limit}
        </p>
        {levels.emails.level !== "ok" && (
          <p className="text-sm">
            {levels.emails.level === "off"
              ? "Email is switched off for this account."
              : levels.emails.level === "full"
                ? "This month's emails are used up: no new emails until next month."
                : "You are close to this month's email limit."}
          </p>
        )}
        <p>
          Knowledge-base storage: {mb(levels.storage.used)} / {mb(levels.storage.limit)}
        </p>
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
