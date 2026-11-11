"use client";

import { useActionState } from "react";
import { saveBuyerEmailsAction, type SettingsState } from "./actions";

export function BuyerEmailsForm({
  siteId,
  mode,
  canAutoSend,
  paused = false,
}: {
  siteId: string;
  mode: "off" | "approval" | "automatic";
  canAutoSend: boolean;
  /** The owner AI budget is used up: drafting is on hold until next month. */
  paused?: boolean;
}) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveBuyerEmailsAction.bind(null, siteId), {});
  const current = mode === "automatic" && !canAutoSend ? "approval" : mode;
  return (
    <form action={action} className="card">
      <h2>Buyer emails</h2>
      <p className="text-sm text-ink-muted">
        Emails every customer who buys, about the products they bought. It&apos;s your responsibility that customers were
        offered an opt-out at checkout; every email includes one-click unsubscribe.
      </p>
      {paused && (
        <p role="status" className="notice notice-warn">
          <span className="lamp lamp-warn" aria-hidden="true" />
          <span>Buyer emails are paused until next month: this month&apos;s owner AI budget is used up.</span>
        </p>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend>How are buyer emails sent?</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="buyerEmails" value="off" defaultChecked={current === "off"} className="mt-1" />
          <span>
            Off
            <span className="block text-sm text-ink-muted font-normal">No emails to buyers.</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="buyerEmails" value="approval" defaultChecked={current === "approval"} className="mt-1" />
          <span>
            Approval queue (recommended)
            <span className="block text-sm text-ink-muted font-normal">Each email waits in Buyers → Queue until you approve it.</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="buyerEmails"
            value="automatic"
            defaultChecked={current === "automatic"}
            disabled={!canAutoSend}
            className="mt-1"
          />
          <span>
            Automatic
            <span className="block text-sm text-ink-muted font-normal">
              {canAutoSend ? "Emails go out as soon as they're written." : "Needs the Growth plan"}
            </span>
          </span>
        </label>
      </fieldset>
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      {state.saved && <p role="status">Buyer email settings saved.</p>}
      <button type="submit" disabled={pending} className="btn-primary self-start">
        Save buyer emails
      </button>
    </form>
  );
}
