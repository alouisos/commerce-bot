"use client";

import Link from "next/link";
import { useActionState, type KeyboardEvent } from "react";
import { Markdown } from "@/components/Markdown";
import { askAction, type AskState } from "./actions";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Enter sends; Shift+Enter makes a new line. */
function sendOnEnter(e: KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
  e.preventDefault();
  e.currentTarget.form?.requestSubmit();
}

export function AskChat({ siteId, questionMax, disabled = false }: { siteId: string; questionMax: number; disabled?: boolean }) {
  const [state, action, pending] = useActionState<AskState, FormData>(askAction.bind(null, siteId), { messages: [] });
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {state.messages.length > 0 && (
        <ol className="flex flex-col gap-3" aria-label="Questions and answers">
          {state.messages.map((m, i) => (
            <li key={i} className={m.role === "user" ? "msg msg-visitor" : "msg msg-bot"}>
              <div className="msg-who">{m.role === "user" ? "You" : "Concierge"}</div>
              {m.role === "user" ? (
                <div className="whitespace-pre-wrap">{m.content}</div>
              ) : (
                <>
                  <Markdown text={m.content} />
                  {m.sources && m.sources.length > 0 && (
                    <ol className="flex flex-col gap-1 text-sm" aria-label="Sources">
                      {m.sources.map((s, j) => (
                        <li key={s.id}>
                          [{j + 1}]{" "}
                          <Link href={`/app/sites/${siteId}/conversations/${s.id}`}>Conversation of {day(s.startedAt)}</Link>
                        </li>
                      ))}
                    </ol>
                  )}
                  <p className="text-xs text-ink-subtle">Written by AI from your conversations; check before acting on it.</p>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {pending && (
        <p role="status" className="text-sm text-ink-muted">
          Reading your conversations…
        </p>
      )}
      <form action={action} className="panel">
        <div className="panel-body form-stack">
          <label className="flex flex-col gap-1">
            {state.messages.length > 0 ? "Ask a follow-up" : "Your question"}
            <textarea
              name="question"
              required
              rows={3}
              maxLength={questionMax}
              defaultValue={state.draft ?? ""}
              placeholder="What do people ask about shipping?"
              onKeyDown={sendOnEnter}
              disabled={disabled}
            />
          </label>
          {state.error && (
            <p role="alert" className="notice notice-warn text-sm">
              {state.error}
            </p>
          )}
          <button type="submit" disabled={pending || disabled} className="btn-primary self-start">
            {pending ? "Asking…" : "Ask"}
          </button>
        </div>
      </form>
    </div>
  );
}
