"use client";

import { useActionState } from "react";
import { connectStoreAction, disconnectStoreAction, type SettingsState } from "./actions";

type Summary = { storeUrl: string; keyLast4: string; status: "connected" | "failing"; lastError: string | null };

export function StoreConnection({
  siteId,
  defaultUrl,
  summary,
}: {
  siteId: string;
  defaultUrl: string;
  summary: Summary | null;
}) {
  const [state, connect, connecting] = useActionState<SettingsState, FormData>(connectStoreAction.bind(null, siteId), {});
  const remove = disconnectStoreAction.bind(null, siteId);

  if (summary) {
    return (
      <section className="card">
        <h2>Sales tracking</h2>
        <p>
          Connected to {summary.storeUrl} · key ending {summary.keyLast4}
        </p>
        {summary.status === "failing" && (
          <p role="alert" className="text-danger">
            {summary.lastError} Reconnect with a new key.
          </p>
        )}
        <form action={remove}>
          <button type="submit" className="self-start">
            Remove
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Sales tracking</h2>
      <p className="text-sm text-ink-muted font-normal">
        In WordPress: WooCommerce → Settings → Advanced → REST API → Add key, with Read permission.
      </p>
      <form action={connect} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          Store address
          <input name="storeUrl" defaultValue={defaultUrl} required />
        </label>
        <label className="flex flex-col gap-1">
          Consumer key
          <input name="consumerKey" required autoComplete="off" spellCheck={false} className="font-mono" />
        </label>
        <label className="flex flex-col gap-1">
          Consumer secret
          <input
            name="consumerSecret"
            type="password"
            required
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </label>
        {state.error && (
          <p role="alert" className="text-danger">
            {state.error}
          </p>
        )}
        <button type="submit" disabled={connecting} className="btn-primary self-start">
          Connect WooCommerce
        </button>
      </form>
      <p className="text-sm text-ink-muted font-normal">
        Not on WooCommerce? Sales are still counted from your order-confirmation page, without amounts.
      </p>
    </section>
  );
}
