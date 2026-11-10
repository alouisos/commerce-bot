"use client";

import { useActionState } from "react";
import { refreshInsightsAction, type RefreshResult } from "./actions";

export function RefreshInsightsButton({ siteId }: { siteId: string }) {
  const [state, action, pending] = useActionState<RefreshResult | null>(() => refreshInsightsAction(siteId), null);
  return (
    <form action={action} className="flex items-center gap-2 text-sm">
      <button type="submit" disabled={pending} className="btn-sm">
        {pending ? "Refreshing…" : "Refresh"}
      </button>
      {state?.ok === false && <span role="alert" className="text-danger">{state.error}</span>}
      {state?.ok && <span role="status" className="text-ink-muted">Refreshing. New insights appear here in a minute or two.</span>}
    </form>
  );
}
