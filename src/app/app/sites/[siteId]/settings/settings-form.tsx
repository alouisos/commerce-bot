"use client";

import { useActionState, useState } from "react";
import { saveSettingsAction, type SettingsState } from "./actions";

type Initial = {
  botName: string;
  accentColor: string;
  corner: "bottom-right" | "bottom-left";
  defaultLanguage: string;
  guardrails: string;
  allowedOrigins: string[];
  greetings: { language: string; message: string }[];
  proactivity: "off" | "gentle" | "active";
};

const PROACTIVITY = [
  { value: "off", label: "Off", help: "Only answers when a visitor opens the chat." },
  { value: "gentle", label: "Gentle (recommended)", help: "Occasional, well-timed suggestions. At most 2 per visit." },
  { value: "active", label: "Active", help: "Suggests a little sooner, up to 3 times per visit." },
] as const;

export function SettingsForm({ siteId, initial }: { siteId: string; initial: Initial }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveSettingsAction.bind(null, siteId), {});
  const [rows, setRows] = useState(initial.greetings.map((g, i) => ({ ...g, id: i })));
  const [nextId, setNextId] = useState(rows.length);

  return (
    <form action={action} className="card">
      <h2>Widget settings</h2>
      <label className="flex flex-col gap-1">
        Bot name
        <input name="botName" defaultValue={initial.botName} required maxLength={40} />
      </label>
      <label className="flex flex-col gap-1">
        Accent colour
        <input name="accentColor" type="color" defaultValue={initial.accentColor} className="h-10 w-20" />
      </label>
      <label className="flex flex-col gap-1">
        Corner
        <select name="corner" defaultValue={initial.corner}>
          <option value="bottom-right">Bottom right</option>
          <option value="bottom-left">Bottom left</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Default language (two letters)
        <input
          name="defaultLanguage"
          defaultValue={initial.defaultLanguage}
          required
          pattern="[a-z]{2}"
          className="w-20"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend>How proactive should the bot be?</legend>
        {PROACTIVITY.map((o) => (
          <label key={o.value} className="flex items-start gap-2">
            <input
              type="radio"
              name="proactivity"
              value={o.value}
              defaultChecked={initial.proactivity === o.value}
              className="mt-1"
            />
            <span>
              {o.label}
              <span className="block text-sm text-ink-muted font-normal">{o.help}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend>Greeting message per language</legend>
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap gap-2">
            <input
              name="greetingLanguage"
              defaultValue={r.language}
              aria-label="Language code"
              pattern="[a-z]{2}"
              required
              className="w-16"
            />
            <input
              name="greetingMessage"
              defaultValue={r.message}
              aria-label={`Greeting (${r.language})`}
              maxLength={280}
              className="min-w-0 flex-1 basis-48"
            />
            <button
              type="button"
              onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
              aria-label={`Remove ${r.language} greeting`}
              className="btn-sm"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            setRows((rs) => [...rs, { id: nextId, language: "", message: "" }]);
            setNextId((n) => n + 1);
          }}
          className="self-start"
        >
          Add language
        </button>
        <p className="text-sm">Rows with an empty message are not saved.</p>
      </fieldset>

      <label className="flex flex-col gap-1">
        Guardrails
        <textarea
          name="guardrails"
          defaultValue={initial.guardrails}
          maxLength={2000}
          rows={4}
          placeholder="e.g. Never give medical advice; suggest seeing a dermatologist."
        />
      </label>

      <label className="flex flex-col gap-1">
        Allowed origins (one per line)
        <textarea
          name="allowedOrigins"
          defaultValue={initial.allowedOrigins.join("\n")}
          rows={3}
          className="font-mono"
        />
      </label>

      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      {state.saved && <p role="status">Settings saved.</p>}
      <button type="submit" disabled={pending} className="btn-primary self-start">
        Save settings
      </button>
    </form>
  );
}
