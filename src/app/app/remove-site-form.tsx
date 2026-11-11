"use client";

import { useActionState, useState } from "react";
import { removeSiteAction, type RemoveSiteState } from "./actions";

/** "Remove" for one website in the list, behind a step where the admin types its name. */
export function RemoveSiteForm({ siteId, name }: { siteId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<RemoveSiteState, FormData>(removeSiteAction.bind(null, siteId), {});
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-danger-quiet btn-sm self-start">
        Remove
      </button>
    );
  }
  return (
    <form action={action} className="flex max-w-md flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        Permanently deletes this website, its knowledge base, conversations and leads. Type {name} to confirm.
        <input name="confirmName" autoComplete="off" required />
      </label>
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-danger btn-sm">
          Delete website
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost btn-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}
