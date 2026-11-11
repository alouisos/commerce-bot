"use client";

import { useTransition } from "react";
import { setInsightsEmailAction } from "./actions";

export function InsightsEmailToggle({ siteId, on }: { siteId: string; on: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn-sm"
      aria-pressed={on}
      disabled={pending}
      title="A daily email with these insights, sent at 06:00 UTC to your team members who have it on."
      onClick={() => start(() => setInsightsEmailAction(siteId, !on))}
    >
      Daily email: {on ? "On" : "Off"}
    </button>
  );
}
