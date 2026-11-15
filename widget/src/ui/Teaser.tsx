/** @jsxImportSource preact */
import { useEffect, useRef } from "preact/hooks";

/** Shows the greeting. Never takes focus. Dismisses on the first scroll, pointerdown or keydown anywhere. */
export function Teaser({
  message,
  imageUrl,
  closeLabel,
  onOpen,
  onDismiss,
  onClose,
  leaving = false,
}: {
  message: string;
  imageUrl: string | null;
  closeLabel: string;
  onOpen: () => void;
  /** Goes away on its own (the visitor scrolled, clicked or typed elsewhere). */
  onDismiss: () => void;
  /** The visitor closed it with ×. Defaults to `onDismiss`. */
  onClose?: () => void;
  /** Gone and playing its exit animation. */
  leaving?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (leaving) return;
    const types = ["scroll", "pointerdown", "keydown"] as const;
    const opts = { passive: true, once: true } as const;
    const handler = (e: Event) => {
      // An interaction with the teaser itself is its own click, not a dismissal:
      // unmounting on pointerdown would swallow the click. `once` consumed this
      // listener, so re-arm it.
      if (wrapRef.current && e.composedPath().includes(wrapRef.current)) {
        window.addEventListener(e.type, handler, opts);
        return;
      }
      onDismiss();
    };
    for (const t of types) window.addEventListener(t, handler, opts);
    return () => {
      for (const t of types) window.removeEventListener(t, handler);
    };
  }, [onDismiss, leaving]);

  return (
    <div
      class={leaving ? "teaser-wrap leaving" : "teaser-wrap"}
      ref={wrapRef}
      aria-hidden={leaving ? "true" : undefined}
      inert={leaving}
    >
      <button type="button" class="teaser" onClick={onOpen}>
        {imageUrl && <img src={imageUrl} alt="" />}
        <span>{message}</span>
      </button>
      <button type="button" class="teaser-close" aria-label={closeLabel} onClick={onClose ?? onDismiss}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
