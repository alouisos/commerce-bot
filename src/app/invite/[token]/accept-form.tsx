"use client";

import { useActionState } from "react";
import { acceptInviteAction, type AcceptState } from "./actions";

export function AcceptForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInviteAction.bind(null, token), {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        Your name
        <input name="name" required maxLength={80} autoComplete="name" />
      </label>
      <label className="flex flex-col gap-1">
        Password (at least 10 characters)
        <input name="password" type="password" required minLength={10} autoComplete="new-password" />
      </label>
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary">
        Create account
      </button>
    </form>
  );
}
