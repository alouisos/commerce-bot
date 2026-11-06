/** @jsxImportSource preact */
import { useState } from "preact/hooks";
import type { WidgetStrings } from "../../../src/shared/widget-protocol";

export function FallbackForm({
  strings,
  onSubmit,
}: {
  strings: WidgetStrings;
  onSubmit: (email: string, message: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (done) return <p class="thanks">{strings.leadThanks}</p>;

  return (
    <form
      class="lead"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          await onSubmit(email.trim(), message.trim());
          setDone(true);
        } catch {
          setBusy(false);
        }
      }}
    >
      <label>
        {strings.emailLabel}
        <input type="email" required maxLength={254} value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
      </label>
      <label>
        {strings.questionLabel}
        <textarea rows={3} maxLength={2000} value={message} onInput={(e) => setMessage(e.currentTarget.value)} />
      </label>
      <button type="submit" class="send" disabled={busy}>
        {strings.send}
      </button>
    </form>
  );
}
