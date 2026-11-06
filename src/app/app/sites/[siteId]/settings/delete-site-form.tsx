"use client";

import { useActionState } from "react";
import { deleteSiteAction, type SettingsState } from "./actions";

export function DeleteSiteForm({ siteId, name }: { siteId: string; name: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(deleteSiteAction.bind(null, siteId), {});
  return (
    <form action={action} className="flex flex-col gap-3 border border-red-700 p-4">
      <h2 className="text-lg font-semibold">Delete website</h2>
      <p>
        This permanently deletes <strong>{name}</strong>: its settings, knowledge base and uploaded files,
        conversations and leads. The widget stops working on the website. This cannot be undone.
      </p>
      <label className="flex flex-col gap-1">
        Type the website&apos;s name to confirm
        <input name="confirmName" required autoComplete="off" className="border p-2" />
      </label>
      {state.error && (
        <p role="alert" className="text-red-700">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="w-fit border border-red-700 p-2 text-red-700">
        Delete website
      </button>
    </form>
  );
}
