/** @jsxImportSource preact */
import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { LIMITS, type WidgetConfig, type WidgetImage } from "../../../src/shared/widget-protocol";
import { renderMessage } from "../render";
import { FallbackForm } from "./FallbackForm";

export type UiMessage = { id: string; role: "visitor" | "bot"; content: string; images: WidgetImage[] };

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Body({ text, images, apiBase }: { text: string; images: WidgetImage[]; apiBase: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.replaceChildren(renderMessage(el.ownerDocument, text, images, apiBase));
  }, [text, images, apiBase]);
  return <div ref={ref} />;
}

export function Panel({
  config,
  apiBase,
  messages,
  pending,
  streaming,
  fallback,
  onSend,
  onLead,
  onClose,
}: {
  config: WidgetConfig;
  apiBase: string;
  messages: UiMessage[];
  /** Text of the reply being streamed. Kept outside the live region so only completed replies are announced. */
  pending: string;
  streaming: boolean;
  fallback: boolean;
  onSend: (text: string) => void;
  onLead: (email: string, message: string) => Promise<void>;
  onClose: () => void;
}) {
  const { strings } = config;
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const el = textareaRef.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    el?.focus();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, pending]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const root = panel.getRootNode() as Document | ShadowRoot;
    const active = root.activeElement;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  function submit() {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft("");
    onSend(text);
  }

  return (
    <div
      class="panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cc-title"
      ref={panelRef as RefObject<HTMLDivElement>}
      onKeyDown={onKeyDown}
    >
      <div class="header">
        <h2 id="cc-title">{config.botName}</h2>
        <button type="button" class="close" aria-label={strings.close} onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p class="disclosure">{strings.disclosure}</p>
      <div class="scroll">
        <div class="messages" role="log" aria-live="polite" aria-relevant="additions">
          {messages.map((m) => (
            <div key={m.id} class={`msg ${m.role}`}>
              <Body text={m.content} images={m.images} apiBase={apiBase} />
            </div>
          ))}
        </div>
        {pending && (
          <div class="msg bot" data-testid="pending">
            <Body text={pending} images={[]} apiBase={apiBase} />
          </div>
        )}
        {streaming && (
          <div class="typing" data-testid="typing" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
        <div ref={endRef} />
      </div>
      {fallback ? (
        <FallbackForm strings={strings} onSubmit={onLead} />
      ) : (
        <div class="composer">
          <textarea
            ref={textareaRef}
            rows={1}
            maxLength={LIMITS.messageMaxChars}
            placeholder={strings.placeholder}
            aria-label={strings.placeholder}
            value={draft}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button type="button" class="send" aria-label={strings.send} disabled={streaming || !draft.trim()} onClick={submit}>
            {strings.send}
          </button>
        </div>
      )}
      {config.showBadge && (
        <div class="badge">
          <a href={apiBase} target="_blank" rel="noopener noreferrer">
            {strings.poweredBy}
          </a>
        </div>
      )}
    </div>
  );
}
