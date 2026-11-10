/** @jsxImportSource preact */
import { useState } from "preact/hooks";
import type { WidgetStrings } from "../../../src/shared/widget-protocol";

/** The one-time email offer, shown after a real conversation. It never takes focus by itself. */
export function ConsentCard({
  strings,
  done,
  onYes,
  onNo,
}: {
  strings: WidgetStrings;
  done: boolean;
  onYes: (email: string) => Promise<void>;
  onNo: () => void;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  if (done) return <p class="consent thanks">{strings.consentThanks}</p>;

  return (
    <form
      class="consent"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || !email.trim()) return;
        setBusy(true);
        await onYes(email.trim());
      }}
    >
      <p class="consent-ask">{strings.consentAsk}</p>
      <div class="consent-row">
        <input
          type="email"
          required
          maxLength={254}
          aria-label={strings.emailLabel}
          placeholder={strings.emailLabel}
          value={email}
          onInput={(e) => setEmail(e.currentTarget.value)}
        />
        <button type="submit" class="send" disabled={busy}>
          {strings.consentYes}
        </button>
        <button type="button" class="consent-no" onClick={onNo}>
          {strings.consentNo}
        </button>
      </div>
      <p class="consent-fine">{strings.consentFine}</p>
    </form>
  );
}
