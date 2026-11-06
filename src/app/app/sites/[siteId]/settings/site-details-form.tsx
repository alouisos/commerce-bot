"use client";

import { useActionState } from "react";
import { saveSiteDetailsAction, type SettingsState } from "./actions";

export function SiteDetailsForm({ siteId, name, baseUrl }: { siteId: string; name: string; baseUrl: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveSiteDetailsAction.bind(null, siteId), {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Website</h2>
      <label className="flex flex-col gap-1">
        Name
        <input name="name" defaultValue={name} required maxLength={100} className="border p-2" />
      </label>
      <label className="flex flex-col gap-1">
        Website URL
        <input name="baseUrl" type="url" defaultValue={baseUrl} required className="border p-2" />
      </label>
      <p className="text-sm">
        Changing the URL updates the allowed origins (any you added by hand are kept) and re-crawls the website.
      </p>
      {state.error && (
        <p role="alert" className="text-red-700">
          {state.error}
        </p>
      )}
      {state.saved && <p role="status">Website saved.</p>}
      <button type="submit" disabled={pending} className="w-fit border p-2">
        Save website
      </button>
    </form>
  );
}
