"use client";

import { useActionState } from "react";
import { removeGreetingImageAction, uploadGreetingImageAction, type SettingsState } from "./actions";

export function GreetingImageForm({ siteId, hasImage, version }: { siteId: string; hasImage: boolean; version: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    uploadGreetingImageAction.bind(null, siteId),
    {},
  );
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Greeting image</h2>
      {hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/app/sites/${siteId}/settings/greeting-image?v=${encodeURIComponent(version)}`}
          alt="Greeting image preview"
          className="max-h-40 w-fit border"
        />
      ) : (
        <p>No greeting image yet.</p>
      )}
      <form action={action} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          Upload an image (PNG, JPEG or WEBP, up to 2 MB)
          <input name="image" type="file" accept="image/png,image/jpeg,image/webp" required />
        </label>
        {state.error && (
          <p role="alert" className="text-red-700">
            {state.error}
          </p>
        )}
        {state.saved && <p role="status">Image saved.</p>}
        <button type="submit" disabled={pending} className="w-fit border p-2">
          Upload image
        </button>
      </form>
      {hasImage && (
        <form action={removeGreetingImageAction.bind(null, siteId)}>
          <button type="submit" className="border p-2">
            Remove image
          </button>
        </form>
      )}
    </section>
  );
}
