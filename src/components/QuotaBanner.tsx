import { getQuota } from "@/lib/usage/meter";
import type { Account } from "@/db/schema";

export async function QuotaBanner({ account }: { account: Account }) {
  const q = await getQuota(account);
  let text: string | null = null;
  let role: "status" | "alert" = "status";
  if (q.expired) {
    text = "Your free trial has ended. Your bot is in fallback mode.";
    role = "alert";
  } else if (q.state === "ceiling") {
    text = "Your bot is in fallback mode: visitors can leave their email but get no AI replies until next month.";
    role = "alert";
  } else if (q.state === "limit") {
    text = "You've reached this month's conversation limit. Visitors can still chat for now.";
  } else if (q.state === "warning") {
    text = `You've used ${Math.floor((q.used / q.limit) * 100)}% of this month's conversations.`;
  }
  if (!text) return null;
  return (
    <div role={role} className="border-b px-6 py-2">
      {text}
    </div>
  );
}
