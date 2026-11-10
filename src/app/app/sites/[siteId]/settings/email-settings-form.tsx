"use client";

import { useActionState } from "react";
import { saveEmailSettingsAction, type SettingsState } from "./actions";

type Initial = {
  emailMode: "approval" | "automatic";
  emailIntervalDays: number;
  emailMaxPerPerson: number;
  emailFromName: string;
  emailFromLocal: string;
  retentionMonths: number;
  consentMode: "auto" | "required" | "off";
};

const CONSENT = [
  {
    value: "auto",
    label: "Follow the site's cookie banner (recommended)",
    help: "The chat always works. Behaviour tracking and suggestions wait until the visitor accepts preference or marketing cookies in Complianz, Cookiebot or CookieYes. Without a banner, behaviour is kept for one visit only.",
  },
  {
    value: "required",
    label: "Wait for consent",
    help: "The widget doesn't appear or store anything until the visitor consents through your banner or your site calls Concierge.consent(true).",
  },
  { value: "off", label: "Don't wait", help: "Behaviour is tracked for one visit from the start, as before." },
] as const;

export function EmailSettingsForm({
  siteId,
  initial,
  canAutoSend,
  domain,
  siteName,
}: {
  siteId: string;
  initial: Initial;
  canAutoSend: boolean;
  domain: string | null;
  siteName: string;
}) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    saveEmailSettingsAction.bind(null, siteId),
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Email &amp; privacy</h2>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">How are follow-up emails sent?</legend>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="emailMode"
            value="approval"
            defaultChecked={initial.emailMode !== "automatic" || !canAutoSend}
            className="mt-1"
          />
          <span>
            Approval queue (recommended)
            <span className="block text-sm opacity-80">Each email waits in Emails → Queue until you approve it.</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="emailMode"
            value="automatic"
            defaultChecked={initial.emailMode === "automatic" && canAutoSend}
            disabled={!canAutoSend}
            className="mt-1"
          />
          <span>
            Automatic
            <span className="block text-sm opacity-80">
              {canAutoSend ? "Emails go out as soon as they're written." : "Needs the Growth plan"}
            </span>
          </span>
        </label>
      </fieldset>

      <p className="flex flex-wrap items-center gap-2">
        Send at most
        <input
          name="emailMaxPerPerson"
          type="number"
          min={1}
          max={10}
          defaultValue={initial.emailMaxPerPerson}
          aria-label="Emails per person"
          className="w-16 border p-2"
        />
        emails per person, every
        <input
          name="emailIntervalDays"
          type="number"
          min={1}
          max={30}
          defaultValue={initial.emailIntervalDays}
          aria-label="Days between emails"
          className="w-16 border p-2"
        />
        days
      </p>

      <label className="flex flex-col gap-1">
        From name
        <input
          name="emailFromName"
          defaultValue={initial.emailFromName}
          maxLength={60}
          placeholder={siteName}
          className="border p-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        From address
        <span className="flex items-center gap-1">
          <input
            name="emailFromLocal"
            defaultValue={initial.emailFromLocal}
            required
            pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,63}"
            aria-label="From address, before the @"
            className="w-40 border p-2"
          />
          <span>@{domain ?? "your domain"}</span>
        </span>
      </label>

      <label className="flex flex-col gap-1">
        Keep conversations and email data for
        <select name="retentionMonths" defaultValue={String(initial.retentionMonths)} className="w-fit border p-2">
          <option value="6">6 months</option>
          <option value="12">12 months</option>
          <option value="24">24 months</option>
          <option value="36">36 months</option>
        </select>
        <span className="text-sm opacity-80">
          Older data is deleted every night. People who are still subscribed are kept.
        </span>
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Cookie consent</legend>
        {CONSENT.map((o) => (
          <label key={o.value} className="flex items-start gap-2">
            <input
              type="radio"
              name="consentMode"
              value={o.value}
              defaultChecked={initial.consentMode === o.value}
              className="mt-1"
            />
            <span>
              {o.label}
              <span className="block text-sm opacity-80">{o.help}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {state.error && (
        <p role="alert" className="text-red-700">
          {state.error}
        </p>
      )}
      {state.saved && <p role="status">Email &amp; privacy settings saved.</p>}
      <button type="submit" disabled={pending} className="w-fit border p-2">
        Save email &amp; privacy
      </button>
    </form>
  );
}
