"use client";

import { useActionState } from "react";
import { addDocumentAction, addImageAction, addTextAction, type KnowledgeState } from "./actions";

function Feedback({ state }: { state: KnowledgeState }) {
  return (
    <>
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      {state.saved && <p role="status" className="text-ok">Added. Processing will start shortly.</p>}
    </>
  );
}

export function AddForms({ siteId }: { siteId: string }) {
  const [docState, docAction, docPending] = useActionState<KnowledgeState, FormData>(addDocumentAction.bind(null, siteId), {});
  const [imgState, imgAction, imgPending] = useActionState<KnowledgeState, FormData>(addImageAction.bind(null, siteId), {});
  const [txtState, txtAction, txtPending] = useActionState<KnowledgeState, FormData>(addTextAction.bind(null, siteId), {});
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <form action={docAction} className="panel">
        <h2 className="panel-head">Upload a document</h2>
        <div className="panel-body form-stack">
        <label className="flex flex-col gap-1">
          PDF, DOCX, TXT or Markdown, up to 20 MB
          <input
            name="file"
            type="file"
            required
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
          />
        </label>
        <Feedback state={docState} />
        <button type="submit" disabled={docPending} className="btn-primary self-start">
          Upload document
        </button>
        </div>
      </form>
      <form action={imgAction} className="panel">
        <h2 className="panel-head">Upload an image</h2>
        <div className="panel-body form-stack">
        <label className="flex flex-col gap-1">
          PNG, JPEG, WEBP or GIF, up to 5 MB
          <input name="file" type="file" required accept="image/png,image/jpeg,image/webp,image/gif" />
        </label>
        <label className="flex flex-col gap-1">
          Caption (optional)
          <input name="caption" type="text" maxLength={300} />
        </label>
        <Feedback state={imgState} />
        <button type="submit" disabled={imgPending} className="btn-primary self-start">
          Upload image
        </button>
        </div>
      </form>
      <form action={txtAction} className="panel">
        <h2 className="panel-head">Paste text</h2>
        <div className="panel-body form-stack">
        <label className="flex flex-col gap-1">
          Title
          <input name="title" type="text" required maxLength={200} />
        </label>
        <label className="flex flex-col gap-1">
          Text
          <textarea name="text" required maxLength={100000} rows={5} />
        </label>
        <Feedback state={txtState} />
        <button type="submit" disabled={txtPending} className="btn-primary self-start">
          Add text
        </button>
        </div>
      </form>
    </div>
  );
}
