import Link from "next/link";
import { contactEmail } from "@/lib/brand";
import { usageLevels } from "@/lib/usage/levels";
import { getQuota } from "@/lib/usage/meter";
import type { Account } from "@/db/schema";

export const AI_LIMIT_TEXT =
  "Your bot has reached this month's AI usage limit: visitors can leave their email but get no AI replies until next month.";

const pct = (ratio: number) => Math.floor(ratio * 100);

export async function QuotaBanner({ account }: { account: Account }) {
  const now = new Date();
  const [q, levels] = await Promise.all([getQuota(account, now), usageLevels(account, now)]);
  const contact = contactEmail();
  let text: string | null = null;
  let role: "status" | "alert" = "status";
  if (q.expired) {
    text = "Your free trial has ended. Your bot is in fallback mode.";
    role = "alert";
  } else if (q.state === "ceiling") {
    text = "Your bot is in fallback mode: visitors can leave their email but get no AI replies until next month.";
    role = "alert";
  } else if (q.aiBudgetReached) {
    text = AI_LIMIT_TEXT;
    role = "alert";
  } else if (levels.conversations.level === "full" || levels.emails.level === "full") {
    const what = levels.conversations.level === "full" ? "conversations" : "emails";
    text = `You've reached this month's ${what}. Your bot keeps answering, but makes no new suggestions or emails until next month.${
      contact ? ` Contact ${contact} to raise your limit.` : ""
    }`;
  } else if (levels.conversations.level === "warning") {
    text = `You've used ${pct(levels.conversations.ratio)} % of this month's conversations.`;
  } else if (levels.emails.level === "warning") {
    text = `You've used ${pct(levels.emails.ratio)} % of this month's emails.`;
  } else if (levels.storage.level !== "ok") {
    text = `You've used ${pct(Math.min(1, levels.storage.ratio))} % of your knowledge-base storage.`;
  }
  if (!text) return null;
  return (
    <div role={role} className={`notice notice-bar ${role === "alert" ? "notice-crit" : "notice-warn"}`}>
      <span className={role === "alert" ? "lamp lamp-crit" : "lamp lamp-warn"} aria-hidden="true" />
      <p>
        {text} <Link href="/app/usage">See usage</Link>
      </p>
    </div>
  );
}
