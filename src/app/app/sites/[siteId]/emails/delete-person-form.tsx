"use client";

import { useActionState, useState } from "react";
import { deletePersonAction, type EmailActionState } from "./actions";

/** "Delete all data" for one email address, behind a step where the admin types the address. */
export function DeletePersonForm({ siteId, email }: { siteId: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<EmailActionState, FormData>(
    deletePersonAction.bind(null, siteId),
    {},
  );
  if (state.saved) return <span role="status">Deleted.</span>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="border px-2">
        Delete all data
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="email" value={email} />
      <label className="flex flex-col gap-1 text-sm">
        Deletes this person&apos;s conversations, messages, emails and consent. Type {email} to confirm.
        <input name="confirm" autoComplete="off" required className="border p-1" />
      </label>
      {state.error && (
        <p role="alert" className="text-red-700">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="border px-2">
          Delete all data
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-2">
          Cancel
        </button>
      </div>
    </form>
  );
}
