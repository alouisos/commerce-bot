"use client";

import { useActionState } from "react";
import { inviteAction, type OwnerFormState } from "./actions";

const PLANS = [
  { value: "trial", label: "Trial (14 days)" },
  { value: "starter", label: "Starter" },
  { value: "growth", label: "Growth" },
  { value: "pro", label: "Pro" },
  { value: "complimentary", label: "Complimentary" },
];

export function InviteForm() {
  const [state, action, pending] = useActionState<OwnerFormState, FormData>(inviteAction, {});
  return (
    <form action={action} className="flex flex-col gap-2 border p-4">
      <h2 className="text-lg font-semibold">Invite a customer</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          Email
          <input name="email" type="email" required className="border p-2" />
        </label>
        <label className="flex flex-col gap-1">
          Account name
          <input name="accountName" required maxLength={80} className="border p-2" />
        </label>
        <label className="flex flex-col gap-1">
          Plan
          <select name="plan" defaultValue="starter" className="border p-2">
            {PLANS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className="border p-2">
          Send invite
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-red-700">
          {state.error}
        </p>
      )}
      {state.saved && <p role="status">Invite sent.</p>}
    </form>
  );
}
