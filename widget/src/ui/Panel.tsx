/** @jsxImportSource preact */
import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { LIMITS, type WidgetConfig, type WidgetImage } from "../../../src/shared/widget-protocol";
import { renderMessage } from "../render";
import { ConsentCard } from "./ConsentCard";
import { FallbackForm } from "./FallbackForm";
import { growSheet, previewText, shrinkSheet, type Sheet } from "./sheet";

export type UiMessage = { id: string; role: "visitor" | "bot"; content: string; images: WidgetImage[] };

/** A drag shorter than this is a tap; one longer than DRAG_SNAP moves the sheet to the next height. */
const DRAG_START = 6;
const DRAG_SNAP = 40;
const MINI_HEIGHT = 64;

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
  onFollowLink,
  onClose,
  onExitTest,
  consent,
  leaving = false,
  sheet = null,
  onSheet,
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
  /** A link to the shop's own site was followed from the chat. */
  onFollowLink?: () => void;
  onClose: () => void;
  /** Set in the owner's test tab: shows the TEST MODE tag and an Exit button. */
  onExitTest?: (() => void) | null;
  /** The email offer, when it should be shown. */
  consent?: { done: boolean; onYes: (email: string) => Promise<void>; onNo: () => void } | null;
  /** Closed and playing its exit animation: hidden from assistive tech and not interactive. */
  leaving?: boolean;
  /** Phones: the bottom sheet's height; null for the floating panel. */
  sheet?: Sheet | null;
  onSheet?: (s: Sheet) => void;
}) {
  const { strings } = config;
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const dragRef = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const draggedRef = useRef(false);
  // Only the full-screen sheet (and the floating panel) is modal: otherwise the page stays usable around it.
  const modal = sheet === null || sheet === "full";
  const isSheet = sheet !== null;

  // On opening, and again when reopened during the exit animation. A sheet takes focus itself rather than the
  // message box, which would bring up the phone's keyboard and cover the page.
  useEffect(() => {
    if (leaving) return;
    if (isSheet) {
      panelRef.current?.focus();
      return;
    }
    const el = textareaRef.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    el?.focus();
    // Focus moves on opening only, not when the sheet changes height.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, pending]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !modal) return;
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

  // Dragging the handle or the header resizes the sheet; letting go snaps it to the next height that way.
  function onPointerDown(e: PointerEvent) {
    const panel = panelRef.current;
    if (!sheet || !panel || e.button > 0) return;
    if ((e.target as Element | null)?.closest?.("button:not(.grabber), a")) return;
    dragRef.current = { y: e.clientY, h: panel.getBoundingClientRect().height, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    const d = dragRef.current;
    const panel = panelRef.current;
    if (!d || !panel) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < DRAG_START) return;
    d.moved = true;
    const max = panel.ownerDocument.defaultView?.innerHeight ?? d.h;
    panel.style.transition = "none";
    panel.style.height = `${Math.min(max, Math.max(MINI_HEIGHT, d.h - dy))}px`;
  }
  function onPointerUp(e: PointerEvent) {
    const d = dragRef.current;
    const panel = panelRef.current;
    dragRef.current = null;
    if (!d || !panel || !sheet) return;
    panel.style.transition = "";
    panel.style.height = "";
    if (!d.moved) return;
    // The click that follows a drag is not a tap.
    draggedRef.current = true;
    const dy = e.clientY - d.y;
    if (dy < -DRAG_SNAP) onSheet?.(growSheet(sheet));
    else if (dy > DRAG_SNAP) onSheet?.(shrinkSheet(sheet));
  }
  /** A tap on the handle or the header: a bar or half sheet grows, a full one goes back to half. */
  function onSheetTap(e: MouseEvent) {
    if (!sheet) return;
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    const target = e.target as Element | null;
    if (target?.closest?.("button:not(.grabber), a")) return;
    onSheet?.(sheet === "full" ? "peek" : growSheet(sheet));
  }

  const lastBot = [...messages].reverse().find((m) => m.role === "bot");
  const preview = previewText(pending || lastBot?.content || "") || strings.continueChat;

  function submit() {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft("");
    onSend(text);
  }

  return (
    <div
      class={`panel${isSheet ? " sheet" : ""}${leaving ? " leaving" : ""}`}
      data-sheet={sheet ?? undefined}
      aria-hidden={leaving ? "true" : undefined}
      inert={leaving}
      role="dialog"
      aria-modal={modal ? "true" : "false"}
      aria-labelledby="cc-title"
      tabIndex={isSheet ? -1 : undefined}
      ref={panelRef as RefObject<HTMLDivElement>}
      onKeyDown={onKeyDown}
    >
      {isSheet && (
        <button
          type="button"
          class="grabber"
          aria-label={sheet === "full" ? strings.shrinkChat : strings.expandChat}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={onSheetTap}
        >
          <span aria-hidden="true" />
        </button>
      )}
      <div
        class="header"
        onPointerDown={isSheet ? onPointerDown : undefined}
        onPointerMove={isSheet ? onPointerMove : undefined}
        onPointerUp={isSheet ? onPointerUp : undefined}
        onPointerCancel={isSheet ? onPointerUp : undefined}
        onClick={isSheet ? onSheetTap : undefined}
      >
        <div class="title">
          <h2 id="cc-title">{config.botName}</h2>
          {sheet === "mini" && (
            <p class="sheet-preview" data-testid="sheet-preview">
              {preview}
            </p>
          )}
        </div>
        {onExitTest && (
          <div class="test-mode">
            <span class="test-tag">TEST MODE</span>
            <button type="button" class="test-exit" onClick={onExitTest}>
              Exit
            </button>
          </div>
        )}
        <button type="button" class="close" aria-label={strings.close} onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div
        class="scroll"
        onClick={(e) => {
          // Covers finished replies and one still streaming in.
          const link = (e.target as Element | null)?.closest?.("a[data-cc-nav]");
          if (link) onFollowLink?.();
        }}
      >
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
      {consent && !fallback && <ConsentCard strings={strings} {...consent} />}
      {fallback ? (
        <FallbackForm strings={strings} onSubmit={onLead} />
      ) : (
        <div class="composer">
          <textarea
            ref={textareaRef}
            onFocus={() => {
              // Typing on a phone brings up the keyboard: give the conversation the whole screen.
              if (sheet && sheet !== "full") onSheet?.("full");
            }}
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
      {/* The AI note: visible from the moment the chat opens (AI Act transparency), under the message box. */}
      <p class="disclosure">{strings.disclosure}</p>
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
