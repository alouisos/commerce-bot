"use client";

import { useActionState } from "react";
import type { InsightWindow } from "@/lib/insights/prompt";
import { refreshInsightsAction, type RefreshResult } from "./actions";

export function RefreshInsightsButton({ siteId, window, disabled = false }: { siteId: string; window: InsightWindow; disabled?: boolean }) {
  const [state, action, pending] = useActionState<RefreshResult | null>(() => refreshInsightsAction(siteId, window), null);
  return (
    <form action={action} className="flex items-center gap-2 text-sm">
      <button type="submit" disabled={pending || disabled} className="btn-sm">
        {pending ? "Refreshing…" : "Refresh"}
      </button>
      {state?.ok === false && <span role="alert" className="text-danger">{state.error}</span>}
      {state?.ok && <span role="status" className="text-ink-muted">Refreshing. New insights appear here in a minute or two.</span>}
    </form>
  );
}
