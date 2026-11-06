"use client";

import { useActionState } from "react";
import { addSiteAction, type AddSiteState } from "./actions";

export function AddSiteForm() {
  const [state, action, pending] = useActionState<AddSiteState, FormData>(addSiteAction, {});
  return (
    <form action={action} className="flex max-w-md flex-col gap-3">
      <h2 className="text-lg font-semibold">Add website</h2>
      <label className="flex flex-col gap-1">
        Name
        <input name="name" required maxLength={100} className="border p-2" />
      </label>
      <label className="flex flex-col gap-1">
        Website URL
        <input name="baseUrl" type="url" required placeholder="https://example.com" className="border p-2" />
      </label>
      {state.error && (
        <p role="alert" className="text-red-700">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="border p-2">
        Add website
      </button>
    </form>
  );
}
