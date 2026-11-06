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
};

export function SettingsForm({ siteId, initial }: { siteId: string; initial: Initial }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveSettingsAction.bind(null, siteId), {});
  const [rows, setRows] = useState(initial.greetings.map((g, i) => ({ ...g, id: i })));
  const [nextId, setNextId] = useState(rows.length);

  return (
    <form action={action} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Widget settings</h2>
      <label className="flex flex-col gap-1">
        Bot name
        <input name="botName" defaultValue={initial.botName} required maxLength={40} className="border p-2" />
      </label>
      <label className="flex flex-col gap-1">
        Accent colour
        <input name="accentColor" type="color" defaultValue={initial.accentColor} className="h-10 w-20" />
      </label>
      <label className="flex flex-col gap-1">
        Corner
        <select name="corner" defaultValue={initial.corner} className="border p-2">
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
          className="w-20 border p-2"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Greeting message per language</legend>
        {rows.map((r) => (
          <div key={r.id} className="flex gap-2">
            <input
              name="greetingLanguage"
              defaultValue={r.language}
              aria-label="Language code"
              pattern="[a-z]{2}"
              required
              className="w-16 border p-2"
            />
            <input
              name="greetingMessage"
              defaultValue={r.message}
              aria-label={`Greeting (${r.language})`}
              maxLength={280}
              className="flex-1 border p-2"
            />
            <button
              type="button"
              onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
              aria-label={`Remove ${r.language} greeting`}
              className="border px-2"
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
          className="w-fit border p-2"
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
          className="border p-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        Allowed origins (one per line)
        <textarea
          name="allowedOrigins"
          defaultValue={initial.allowedOrigins.join("\n")}
          rows={3}
          className="border p-2 font-mono"
        />
      </label>

      {state.error && (
        <p role="alert" className="text-red-700">
          {state.error}
        </p>
      )}
      {state.saved && <p role="status">Settings saved.</p>}
      <button type="submit" disabled={pending} className="w-fit border p-2">
        Save settings
      </button>
    </form>
  );
}
