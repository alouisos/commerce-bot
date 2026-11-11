"use client";

import { useActionState } from "react";
import { approveBuyerDraftAction, discardBuyerDraftAction, saveBuyerDraftAction, type BuyerActionState } from "./actions";

export function BuyerDraftEditor({
  siteId,
  draft,
}: {
  siteId: string;
  draft: { id: string; email: string; subject: string; body: string; step: number };
}) {
  const [saveState, save, saving] = useActionState<BuyerActionState, FormData>(
    saveBuyerDraftAction.bind(null, siteId, draft.id),
    {},
  );
  const [approveState, approve, approving] = useActionState<BuyerActionState, FormData>(
    approveBuyerDraftAction.bind(null, siteId, draft.id),
    {},
  );
  const [discardState, discard, discarding] = useActionState<BuyerActionState>(
    discardBuyerDraftAction.bind(null, siteId, draft.id),
    {},
  );
  const error = saveState.error ?? approveState.error ?? discardState.error;
  return (
    <article className="panel">
      <p className="panel-head">
        To {draft.email} · email {draft.step}
      </p>
      <form action={save} className="panel-body form-stack">
        <label className="flex flex-col gap-1">
          Subject
          <input name="subject" defaultValue={draft.subject} maxLength={120} required />
        </label>
        <label className="flex flex-col gap-1">
          Email
          <textarea name="body" defaultValue={draft.body} maxLength={6000} rows={10} required />
        </label>
        <p className="field-hint">
          Links to your own site, written as [text](https://…), are kept and tracked; other links and email addresses are removed.
        </p>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {saveState.saved && <p role="status" className="text-ok">Saved.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={saving}>
            Save
          </button>
          <button type="submit" formAction={approve} disabled={approving} className="btn-primary">
            Approve &amp; send
          </button>
          <button type="submit" formAction={discard} formNoValidate disabled={discarding} className="btn-danger ml-auto">
            Discard
          </button>
        </div>
      </form>
    </article>
  );
}
