"use client";

import Link from "next/link";
import { useActionState } from "react";
import { approveDraftAction, discardDraftAction, saveDraftAction, type EmailActionState } from "./actions";

export function DraftEditor({
  siteId,
  draft,
}: {
  siteId: string;
  draft: { id: string; email: string; subject: string; body: string; step: number; conversationId: string | null };
}) {
  const [saveState, save, saving] = useActionState<EmailActionState, FormData>(
    saveDraftAction.bind(null, siteId, draft.id),
    {},
  );
  const [approveState, approve, approving] = useActionState<EmailActionState>(
    approveDraftAction.bind(null, siteId, draft.id),
    {},
  );
  const [discardState, discard, discarding] = useActionState<EmailActionState>(
    discardDraftAction.bind(null, siteId, draft.id),
    {},
  );
  const error = saveState.error ?? approveState.error ?? discardState.error;
  return (
    <article className="flex flex-col gap-2 border p-4">
      <p className="text-sm">
        To {draft.email} · email {draft.step}
        {draft.conversationId && (
          <>
            {" · "}
            <Link href={`/app/sites/${siteId}/conversations/${draft.conversationId}`} className="underline">
              View conversation
            </Link>
          </>
        )}
      </p>
      <form action={save} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          Subject
          <input name="subject" defaultValue={draft.subject} maxLength={120} required className="border p-2" />
        </label>
        <label className="flex flex-col gap-1">
          Email
          <textarea name="body" defaultValue={draft.body} maxLength={6000} rows={10} required className="border p-2" />
        </label>
        <p className="text-xs opacity-80">
          Links to your own site, written as [text](https://…), are kept and tracked; other links are removed.
        </p>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        {saveState.saved && <p role="status">Saved.</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="border p-2">
            Save
          </button>
          <button type="submit" formAction={approve} disabled={approving} className="border p-2">
            Approve &amp; send
          </button>
          <button type="submit" formAction={discard} formNoValidate disabled={discarding} className="border p-2">
            Discard
          </button>
        </div>
      </form>
    </article>
  );
}
