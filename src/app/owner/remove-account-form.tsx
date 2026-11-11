"use client";

import { useActionState } from "react";
import { removeAccountAction, restoreAccountAction, type OwnerFormState } from "./actions";

export function RemoveAccountForm({ accountId, name }: { accountId: string; name: string }) {
  const [state, action, pending] = useActionState<OwnerFormState, FormData>(removeAccountAction.bind(null, accountId), {});
  return (
    <details>
      <summary className="btn-sm">Remove</summary>
      <form action={action} className="card card-danger">
        <h2>Remove customer</h2>
        <p>
          This deletes the logins of everyone on <strong>{name}</strong> and turns its chatbot off. Its websites,
          conversations and leads are kept, and you can restore the account later.
        </p>
        <label className="flex flex-col gap-1">
          Type the account&apos;s name to confirm
          <input name="confirmName" required autoComplete="off" />
        </label>
        {state.error && (
          <p role="alert" className="text-danger">
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn-danger self-start">
          Remove customer
        </button>
      </form>
    </details>
  );
}

export function RestoreAccountForm({ accountId }: { accountId: string }) {
  const [state, action, pending] = useActionState<OwnerFormState, FormData>(restoreAccountAction.bind(null, accountId), {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="email" type="email" required placeholder="Email to invite" aria-label="Email to invite" />
      <button type="submit" disabled={pending} className="btn-sm">
        Restore
      </button>
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
