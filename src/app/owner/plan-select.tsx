"use client";

import { useState, useTransition } from "react";
import type { PlanId } from "@/lib/plans";
import { setAccountPlan } from "./actions";

const PLANS: PlanId[] = ["trial", "starter", "growth", "pro", "complimentary"];

export function PlanSelect({ accountId, plan }: { accountId: string; plan: PlanId }) {
  const [value, setValue] = useState(plan);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(() => setAccountPlan(accountId, value));
      }}
    >
      <select aria-label="Plan" value={value} onChange={(e) => setValue(e.target.value as PlanId)}>
        {PLANS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending} className="btn-sm">
        {pending ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
