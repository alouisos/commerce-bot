"use client";

import { useActionState } from "react";
import { CheckIcon } from "@/components/icons";
import { requestAccessAction, type RequestAccessState } from "./actions";

export function RequestAccessForm() {
  const [state, action, pending] = useActionState<RequestAccessState, FormData>(requestAccessAction, {});
  if (state.sentTo) {
    return (
      <p role="status" className="notice notice-ok">
        <CheckIcon className="mt-0.5 shrink-0 text-ok" />
        <span>
          Thanks. We&apos;ll email an invite to <strong>{state.sentTo}</strong>.
        </span>
      </p>
    );
  }
  return (
    <form action={action} className="form-stack">
      <label className="flex flex-col gap-1">
        Your email
        <input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@yourshop.com" />
      </label>
      {/* Honeypot: hidden from people and assistive tech; bots that fill it are dropped. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "Sending…" : "Request an invite"}
      </button>
    </form>
  );
}
