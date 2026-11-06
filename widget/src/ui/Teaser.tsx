/** @jsxImportSource preact */
import { useEffect, useRef } from "preact/hooks";

/** Shows the greeting. Never takes focus. Dismisses on the first scroll, pointerdown or keydown anywhere. */
export function Teaser({
  message,
  imageUrl,
  closeLabel,
  onOpen,
  onDismiss,
}: {
  message: string;
  imageUrl: string | null;
  closeLabel: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
  }, [onDismiss]);

  return (
    <div class="teaser-wrap" ref={wrapRef}>
      <button type="button" class="teaser" onClick={onOpen}>
        {imageUrl && <img src={imageUrl} alt="" />}
        <span>{message}</span>
      </button>
      <button type="button" class="teaser-close" aria-label={closeLabel} onClick={onDismiss}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
