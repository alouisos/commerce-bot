"use client";

import { useActionState } from "react";
import { acceptInviteAction, type AcceptState } from "./actions";

export function AcceptForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInviteAction.bind(null, token), {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        Your name
        <input name="name" required maxLength={80} autoComplete="name" className="border p-2" />
      </label>
      <label className="flex flex-col gap-1">
        Password (at least 10 characters)
        <input name="password" type="password" required minLength={10} autoComplete="new-password" className="border p-2" />
      </label>
      {state.error && (
        <p role="alert" className="text-red-700">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="border p-2">
        Create account
      </button>
    </form>
  );
}
