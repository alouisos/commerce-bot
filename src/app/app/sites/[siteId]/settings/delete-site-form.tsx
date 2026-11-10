"use client";

import { useActionState } from "react";
import { deleteSiteAction, type SettingsState } from "./actions";

export function DeleteSiteForm({ siteId, name }: { siteId: string; name: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(deleteSiteAction.bind(null, siteId), {});
  return (
    <form action={action} className="card card-danger">
      <h2>Delete website</h2>
      <p>
        This permanently deletes <strong>{name}</strong>: its settings, knowledge base and uploaded files,
        conversations and leads. The widget stops working on the website. This cannot be undone.
      </p>
      <label className="flex flex-col gap-1">
        Type the website&apos;s name to confirm
        <input name="confirmName" required autoComplete="off" />
      </label>
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-danger self-start">
        Delete website
      </button>
    </form>
  );
}
