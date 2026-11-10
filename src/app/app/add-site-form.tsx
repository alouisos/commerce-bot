"use client";

import { useActionState } from "react";
import { addSiteAction, type AddSiteState } from "./actions";

export function AddSiteForm() {
  const [state, action, pending] = useActionState<AddSiteState, FormData>(addSiteAction, {});
  return (
    <form action={action} className="panel max-w-xl">
      <h2 className="panel-head">Add website</h2>
      <div className="panel-body form-stack">
      <label className="flex flex-col gap-1">
        Name
        <input name="name" required maxLength={100} />
      </label>
      <label className="flex flex-col gap-1">
        Website URL
        <input name="baseUrl" type="url" required placeholder="https://example.com" />
      </label>
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary self-start">
        {pending ? "Adding…" : "Add website"}
      </button>
      </div>
    </form>
  );
}
